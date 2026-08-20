const { config } = require('./config');
const { currentMinute, slotLabel } = require('./time');

const routeCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

const keyFor = (a, b) => `${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}`;
const secondsFromDuration = value => Math.ceil(Number(String(value || '0s').replace(/s$/, '')) || 0);

async function routeLeg(a, b) {
  if (!config.routesApiKey) throw Object.assign(new Error('Cycling routing is not configured'), { code: 'CONFIG' });
  if (a[0] === b[0] && a[1] === b[1]) return { durationSeconds: 0, distanceMeters: 0, encodedPolyline: '' };
  const cacheKey = keyFor(a, b);
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.routesApiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a[0], longitude: a[1] } } },
      destination: { location: { latLng: { latitude: b[0], longitude: b[1] } } },
      travelMode: 'BICYCLE',
      computeAlternativeRoutes: false,
      languageCode: 'en'
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(JSON.stringify({ severity: 'ERROR', event: 'routes_api_failed', status: response.status, detail: detail.slice(0, 500) }));
    throw Object.assign(new Error('Cycling route could not be calculated'), { code: 'ROUTING_UNAVAILABLE' });
  }
  const payload = await response.json();
  const route = payload.routes?.[0];
  if (!route) throw Object.assign(new Error('No cycling route was found'), { code: 'NO_ROUTE' });
  const value = {
    durationSeconds: secondsFromDuration(route.duration),
    distanceMeters: Number(route.distanceMeters || 0),
    encodedPolyline: route.polyline?.encodedPolyline || ''
  };
  routeCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

function scheduledStops(jobs) {
  const active = jobs
    .filter(job => job.status !== 'Cancelled' && Number.isFinite(job.startMinute) && Number.isFinite(job.endMinute) && Array.isArray(job.coords))
    .map(job => ({ id: job.id, coords: job.coords, startMinute: job.startMinute, endMinute: job.endMinute }))
    .sort((a, b) => a.startMinute - b.startMinute);
  return [
    { id: 'DEPOT_START', coords: config.depot.coords, startMinute: config.workday.startMinute, endMinute: config.workday.startMinute },
    ...active,
    { id: 'DEPOT_END', coords: config.depot.coords, startMinute: config.workday.endMinute, endMinute: config.workday.endMinute }
  ];
}

async function calculateSlotOptions(customerCoords, jobs) {
  const stops = scheduledStops(jobs);
  const existing = stops.slice(1, -1);
  const candidates = [];
  const earliestStart = currentMinute() + config.workday.minimumLeadMinutes;

  for (let startMinute = config.workday.startMinute; startMinute + config.workday.repairMinutes <= config.workday.endMinute; startMinute += 15) {
    const endMinute = startMinute + config.workday.repairMinutes;
    if (startMinute < earliestStart) continue;
    if (existing.some(job => startMinute < job.endMinute && endMinute > job.startMinute)) continue;
    let previous = stops[0];
    let next = stops[stops.length - 1];
    for (const stop of stops) {
      if (stop.endMinute <= startMinute) previous = stop;
      if (stop.startMinute >= endMinute) {
        next = stop;
        break;
      }
    }
    candidates.push({ startMinute, endMinute, previous, next });
  }

  const options = [];
  for (const candidate of candidates) {
    const [fromPrevious, toNext, direct] = await Promise.all([
      routeLeg(candidate.previous.coords, customerCoords),
      routeLeg(customerCoords, candidate.next.coords),
      routeLeg(candidate.previous.coords, candidate.next.coords)
    ]);
    const buffer = config.workday.transitBufferMinutes;
    const fromMinutes = Math.ceil(fromPrevious.durationSeconds / 60) + buffer;
    const toMinutes = Math.ceil(toNext.durationSeconds / 60) + buffer;
    const directMinutes = Math.ceil(direct.durationSeconds / 60) + buffer;
    if (candidate.startMinute < candidate.previous.endMinute + fromMinutes) continue;
    if (candidate.endMinute + toMinutes > candidate.next.startMinute) continue;

    const detourMinutes = Math.max(buffer, fromMinutes + toMinutes - directMinutes);
    const detourMeters = Math.max(0, fromPrevious.distanceMeters + toNext.distanceMeters - direct.distanceMeters);
    const travelSurcharge = Math.ceil(detourMinutes * config.pricing.detourMinuteEur);
    options.push({
      id: `${candidate.startMinute}-${candidate.endMinute}`,
      startMinute: candidate.startMinute,
      endMinute: candidate.endMinute,
      label: slotLabel(candidate.startMinute, candidate.endMinute),
      price: config.pricing.baseEur + travelSurcharge,
      travelSurcharge,
      detourMinutes,
      detourKm: Number((detourMeters / 1000).toFixed(1)),
      previousStopId: candidate.previous.id,
      nextStopId: candidate.next.id,
      routePolylines: [fromPrevious.encodedPolyline, toNext.encodedPolyline].filter(Boolean)
    });
  }

  options.sort((a, b) => a.price - b.price || a.startMinute - b.startMinute);
  return options.slice(0, 10);
}

async function routeForJobs(jobs) {
  const ordered = jobs
    .filter(job => job.status !== 'Cancelled' && Array.isArray(job.coords))
    .sort((a, b) => a.startMinute - b.startMinute);
  const points = [config.depot.coords, ...ordered.map(job => job.coords), config.depot.coords];
  const legs = [];
  for (let index = 0; index < points.length - 1; index += 1) legs.push(await routeLeg(points[index], points[index + 1]));
  return {
    jobs: ordered,
    totalKm: Number((legs.reduce((sum, leg) => sum + leg.distanceMeters, 0) / 1000).toFixed(1)),
    totalMinutes: Math.ceil(legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) / 60),
    routePolylines: legs.map(leg => leg.encodedPolyline).filter(Boolean),
    navigationUrl: `https://www.google.com/maps/dir/?api=1&travelmode=bicycling&origin=${config.depot.coords.join(',')}&destination=${config.depot.coords.join(',')}&waypoints=${ordered.map(job => job.coords.join(',')).join('|')}`
  };
}

module.exports = { calculateSlotOptions, routeForJobs, routeLeg };
