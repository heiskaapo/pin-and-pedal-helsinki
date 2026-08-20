const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const origin = [60.1699, 24.9384]; // Kamppi Depot, Helsinki (lat, lng)

// 5 Real Helsinki & Espoo Seed Bookings (Scheduled between 08:30 and 15:45)
const initialSeed = [
  {
    id: 'H-1042',
    address: 'Töölöntorinkatu 4, Töölö',
    coords: [60.1782, 24.9248],
    timeSlot: '08:30–09:15',
    startMin: 510,
    endMin: 555,
    timed: true,
    price: 39,
    status: 'Completed',
    contact: '+358 40 551 2291',
    access: 'Key lock: Met customer outside bakery.'
  },
  {
    id: 'H-1043',
    address: 'Hämeentie 22, Kallio',
    coords: [60.1856, 24.9567],
    timeSlot: '10:15–11:00',
    startMin: 615,
    endMin: 660,
    timed: true,
    price: 39,
    status: 'Completed',
    contact: '+358 50 492 1104',
    access: 'Key lock: Met by courtyard gate.'
  },
  {
    id: 'H-1044',
    address: 'Mannerheimintie 100, Meilahti',
    coords: [60.1912, 24.9085],
    timeSlot: '11:45–12:30',
    startMin: 705,
    endMin: 750,
    timed: true,
    price: 39,
    status: 'En route',
    contact: '+358 44 883 7120',
    access: 'Number lock: 4821 - rack next to pharmacy.'
  },
  {
    id: 'H-1045',
    address: 'Otakaari 1, Otaniemi, Espoo',
    coords: [60.1868, 24.8277],
    timeSlot: '13:30–14:15',
    startMin: 810,
    endMin: 855,
    timed: true,
    price: 39,
    status: 'Booked',
    contact: '+358 45 619 4432',
    access: 'Key lock: Meeting outside main building.'
  },
  {
    id: 'H-1046',
    address: 'Itämerenkatu 12, Ruoholahti',
    coords: [60.1634, 24.9152],
    timeSlot: '15:00–15:45',
    startMin: 900,
    endMin: 945,
    timed: true,
    price: 39,
    status: 'Booked',
    contact: '+358 40 339 8812',
    access: 'Number lock: 0912 - metro station bike park.'
  }
];

let jobs = JSON.parse(localStorage.getItem('pp_jobs') || 'null') || JSON.parse(JSON.stringify(initialSeed));
let step = 1;
let accessType = 'Meet in person';
let pinSet = false;
let quote = null;
let bookingMap = null;
let marker = null;
let routeLayerGroup = null;
let photos = {};
let mapInitializing = false;

let calculatedSlotsData = null;
let selectedSlot = null;

// Workday Constraints & Discretization (07:00 to 17:00 in 15-minute steps)
const SLOTS_COUNT = 41;
const WORKDAY_START = 420; // 07:00 in minutes from midnight
const WORKDAY_END = 1020;  // 17:00 in minutes from midnight
const REPAIR_DURATION = 30; // 30 minutes on-site repair

const saveJobs = () => {
  localStorage.setItem('pp_jobs', JSON.stringify(jobs));
  renderOperatorDashboard();
};

const toast = text => {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
};

// Distance and travel time calculation
const d = (a, b) => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 55);

// Realistic cycling transit in Helsinki/Espoo (18 km/h + city stops)
const travelTimeMinutes = (a, b) => {
  const km = d(a, b);
  return Math.max(3, Math.ceil(km * 3.4));
};

const minToTimeStr = m => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

// Optimal Route Scheduling & Feasibility Engine (07:00–17:00)
function evaluateAllSlots(customerCoords) {
  const timedJobs = jobs
    .filter(j => j.timed && j.coords && j.coords.length === 2)
    .map(j => {
      let [sH, sM] = (j.timeSlot.split('–')[0] || '09:00').split(':').map(Number);
      let [eH, eM] = (j.timeSlot.split('–')[1] || '10:00').split(':').map(Number);
      return {
        id: j.id,
        address: j.address,
        coords: j.coords,
        startMin: isNaN(sH) ? 540 : sH * 60 + sM,
        endMin: isNaN(eH) ? 600 : eH * 60 + eM,
        status: j.status
      };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const routeStops = [
    { id: 'DEPOT_START', address: 'Kamppi Hub (Depot)', coords: origin, startMin: WORKDAY_START, endMin: WORKDAY_START },
    ...timedJobs,
    { id: 'DEPOT_END', address: 'Kamppi Hub (Depot)', coords: origin, startMin: WORKDAY_END, endMin: WORKDAY_END }
  ];

  const slots = [];

  for (let i = 0; i < SLOTS_COUNT; i++) {
    const startMin = WORKDAY_START + i * 15;
    const finishMin = startMin + REPAIR_DURATION;
    const timeStr = minToTimeStr(startMin);
    const slotLabel = `${timeStr}–${minToTimeStr(startMin + 45)}`;

    if (startMin < WORKDAY_START || finishMin > WORKDAY_END) {
      slots.push({ index: i, startMin, finishMin, timeStr, slotLabel, isFeasible: false, reason: 'Outside 07:00–17:00' });
      continue;
    }

    const directOverlap = timedJobs.some(j => (startMin < j.endMin && finishMin > j.startMin));
    if (directOverlap) {
      slots.push({ index: i, startMin, finishMin, timeStr, slotLabel, isFeasible: false, reason: 'Mechanic busy with scheduled repair' });
      continue;
    }

    let prevStop = routeStops[0];
    let nextStop = routeStops[routeStops.length - 1];

    for (let k = 0; k < routeStops.length; k++) {
      if (routeStops[k].endMin <= startMin) {
        prevStop = routeStops[k];
      }
      if (routeStops[k].startMin >= finishMin) {
        nextStop = routeStops[k];
        break;
      }
    }

    const tPrevToCust = travelTimeMinutes(prevStop.coords, customerCoords);
    const tCustToNext = travelTimeMinutes(customerCoords, nextStop.coords);
    const tDirect = travelTimeMinutes(prevStop.coords, nextStop.coords);

    const canArriveOnTime = (startMin >= prevStop.endMin + tPrevToCust);
    const canReachNextOnTime = (finishMin + tCustToNext <= nextStop.startMin);

    if (!canArriveOnTime || !canReachNextOnTime) {
      slots.push({ index: i, startMin, finishMin, timeStr, slotLabel, isFeasible: false, reason: 'Transit route constraint' });
      continue;
    }

    const detourMinutes = Math.max(1, tPrevToCust + tCustToNext - tDirect);
    const travelSurcharge = Math.ceil(detourMinutes * 0.75);
    const price = 29 + travelSurcharge;

    slots.push({
      index: i,
      startMin,
      finishMin,
      timeStr,
      slotLabel,
      isFeasible: true,
      prevStop,
      nextStop,
      detourMinutes,
      travelSurcharge,
      price
    });
  }

  const feasibleSlots = slots.filter(s => s.isFeasible);
  const minPrice = feasibleSlots.length ? Math.min(...feasibleSlots.map(s => s.price)) : 29;
  const maxPrice = feasibleSlots.length ? Math.max(...feasibleSlots.map(s => s.price)) : 49;

  slots.forEach(s => {
    if (!s.isFeasible) {
      s.color = '#c5cdc8';
      s.tag = 'Unavailable';
    } else if (s.price <= minPrice + 2) {
      s.color = '#38b000';
      s.tag = 'Best fit 🔥';
    } else if (s.price <= minPrice + 6) {
      s.color = '#f2ab43';
      s.tag = 'Minor detour';
    } else {
      s.color = '#ff6647';
      s.tag = 'Large detour';
    }
  });

  return { slots, feasibleSlots, minPrice, maxPrice, timedJobs };
}

// Update Slider Track Gradient & Floating Bubble
function updateSliderUI(slotsData, preferredIndex) {
  const slider = $('#timeSlider');
  if (!slider || !slotsData) return;

  const gradientStops = slotsData.slots.map((s, idx) => {
    const pct = ((idx / (SLOTS_COUNT - 1)) * 100).toFixed(1);
    return `${s.color} ${pct}%`;
  }).join(', ');

  slider.style.background = `linear-gradient(90deg, ${gradientStops})`;
  slider.disabled = false;

  let targetIndex = preferredIndex !== undefined ? preferredIndex : +slider.value;
  let chosen = slotsData.slots[targetIndex];

  // If chosen slot is not feasible, automatically snap to the nearest feasible slot
  if (!chosen || !chosen.isFeasible) {
    if (slotsData.feasibleSlots.length) {
      chosen = slotsData.feasibleSlots.reduce((prev, curr) =>
        Math.abs(curr.index - targetIndex) < Math.abs(prev.index - targetIndex) ? curr : prev
      );
      slider.value = chosen.index;
    }
  }

  selectedSlot = chosen;
  renderSliderBubble(chosen);
}

function renderSliderBubble(slot) {
  const bubble = $('#sliderBubble');
  const badge = $('#selectedSlotBadge');
  const slider = $('#timeSlider');
  if (!bubble || !slider) return;

  if (!slot || !slot.isFeasible) {
    bubble.style.display = 'none';
    if (badge) {
      badge.textContent = slot ? `${slot.timeStr} (Unavailable)` : 'Place pin first';
      badge.className = 'slotBadge disabled';
    }
    return;
  }

  bubble.style.display = 'flex';
  $('#bubblePrice').textContent = `€${slot.price}`;
  $('#bubbleTime').textContent = slot.timeStr;
  $('#bubbleTag').textContent = slot.tag;

  const val = +slider.value;
  const pct = (val / (SLOTS_COUNT - 1)) * 100;
  bubble.style.left = `calc(${pct}% + ${(0.5 - pct / 100) * 24}px)`;

  if (badge) {
    badge.textContent = `${slot.slotLabel} · €${slot.price}`;
    badge.className = 'slotBadge';
  }
}

// Source: Google Maps Platform Code Assist
let googleMap = null;
let googleAdvancedMarkers = [];
let googlePolylines = [];
let googleGeocoder = null;

// Live Map Route Polyline & Markers (Supports Google Maps Platform & Mapbox)
function renderMapPlannedRoute(customerCoords, chosenSlot) {
  // --- A. Google Maps Platform Rendering ---
  if (googleMap && window.google && window.google.maps) {
    // Clear previous Google markers & polylines
    googleAdvancedMarkers.forEach(m => m.map = null);
    googleAdvancedMarkers = [];
    googlePolylines.forEach(p => p.setMap(null));
    googlePolylines = [];

    const activeJobs = jobs.filter(j => j.coords && j.coords.length === 2);

    // 1. Kamppi Depot Marker
    const depotDiv = document.createElement('div');
    depotDiv.className = 'depot-marker';
    depotDiv.innerHTML = '🚲';
    depotDiv.style.cursor = 'pointer';

    if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
      const depotMarker = new google.maps.marker.AdvancedMarkerElement({
        map: googleMap,
        position: { lat: origin[0], lng: origin[1] },
        title: '🏛️ Kamppi Hub (Depot) - 07:00 dispatch & 17:00 return',
        content: depotDiv
      });
      googleAdvancedMarkers.push(depotMarker);
    }

    // 2. Active Scheduled Stops 1..5
    activeJobs.forEach((j, i) => {
      const stopDiv = document.createElement('div');
      stopDiv.className = 'stop-number-marker';
      stopDiv.innerHTML = `<span>${i + 1}</span>`;
      stopDiv.title = `Stop ${i + 1}: ${j.address} (${j.timeSlot})`;

      if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
        const stopMarker = new google.maps.marker.AdvancedMarkerElement({
          map: googleMap,
          position: { lat: j.coords[0], lng: j.coords[1] },
          title: `Stop ${i + 1}: ${j.address}`,
          content: stopDiv
        });
        googleAdvancedMarkers.push(stopMarker);
      }
    });

    // 3. Customer Marker
    if (customerCoords) {
      const pinDiv = document.createElement('div');
      pinDiv.className = 'custom-pin-marker';
      pinDiv.innerHTML = '<div style="background:#ff6647;width:24px;height:24px;border-radius:50%;border:3px solid #fff;box-shadow:0 3px 10px rgba(255,102,71,0.5);position:relative;"><div style="position:absolute;bottom:-7px;left:9px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:7px solid #ff6647;"></div></div>';
      pinDiv.title = 'Your Bike Location';

      if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
        const custMarker = new google.maps.marker.AdvancedMarkerElement({
          map: googleMap,
          position: { lat: customerCoords[0], lng: customerCoords[1] },
          title: '📍 Your Bike Location',
          content: pinDiv
        });
        googleAdvancedMarkers.push(custMarker);
      }
    }

    // 4. Sequenced Google Route Polylines
    const routeLatLngs = [{ lat: origin[0], lng: origin[1] }];
    activeJobs.forEach(j => routeLatLngs.push({ lat: j.coords[0], lng: j.coords[1] }));
    routeLatLngs.push({ lat: origin[0], lng: origin[1] });

    if (customerCoords && chosenSlot && chosenSlot.isFeasible) {
      const customerSeq = [{ lat: origin[0], lng: origin[1] }];
      let inserted = false;

      activeJobs.forEach(j => {
        if (!inserted && j.timeSlot > chosenSlot.slotLabel) {
          customerSeq.push({ lat: customerCoords[0], lng: customerCoords[1] });
          inserted = true;
        }
        customerSeq.push({ lat: j.coords[0], lng: j.coords[1] });
      });

      if (!inserted) customerSeq.push({ lat: customerCoords[0], lng: customerCoords[1] });
      customerSeq.push({ lat: origin[0], lng: origin[1] });

      const basePolyline = new google.maps.Polyline({
        path: customerSeq,
        geodesic: true,
        strokeColor: '#2b7336',
        strokeOpacity: 0.8,
        strokeWeight: 4,
        map: googleMap
      });
      googlePolylines.push(basePolyline);

      if (chosenSlot.prevStop && chosenSlot.nextStop) {
        const detourPolyline = new google.maps.Polyline({
          path: [
            { lat: chosenSlot.prevStop.coords[0], lng: chosenSlot.prevStop.coords[1] },
            { lat: customerCoords[0], lng: customerCoords[1] },
            { lat: chosenSlot.nextStop.coords[0], lng: chosenSlot.nextStop.coords[1] }
          ],
          geodesic: true,
          strokeColor: '#ff6647',
          strokeOpacity: 0.95,
          strokeWeight: 5,
          map: googleMap
        });
        googlePolylines.push(detourPolyline);
      }
    } else {
      const basePolyline = new google.maps.Polyline({
        path: routeLatLngs,
        geodesic: true,
        strokeColor: '#4fa168',
        strokeOpacity: 0.7,
        strokeWeight: 3.5,
        map: googleMap
      });
      googlePolylines.push(basePolyline);
    }
    return;
  }

  // --- B. Leaflet / Mapbox Rendering ---
  if (!bookingMap) return;

  if (!routeLayerGroup) {
    routeLayerGroup = L.layerGroup().addTo(bookingMap);
  } else {
    routeLayerGroup.clearLayers();
  }

  // 1. Kamppi Depot Base
  const depotIcon = L.divIcon({
    className: 'depot-marker',
    html: '🚲',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  L.marker(origin, { icon: depotIcon })
    .bindPopup('<strong>🏛️ Kamppi Hub (Depot)</strong><br>07:00 mechanic dispatch & 17:00 return')
    .addTo(routeLayerGroup);

  // 2. Active Seed Bookings (1..5)
  const activeJobs = jobs.filter(j => j.coords && j.coords.length === 2);
  activeJobs.forEach((j, i) => {
    const stopNumIcon = L.divIcon({
      className: 'stop-number-marker',
      html: `<span>${i + 1}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker(j.coords, { icon: stopNumIcon })
      .bindPopup(`<strong>Stop ${i + 1}: ${j.address}</strong><br>Time: ${j.timeSlot}<br>Status: ${j.status}`)
      .addTo(routeLayerGroup);
  });

  // 3. Customer Marker
  if (customerCoords) {
    const pinIcon = L.divIcon({
      className: 'custom-pin-marker',
      html: '<div style="background:#ff6647;width:24px;height:24px;border-radius:50%;border:3px solid #fff;box-shadow:0 3px 10px rgba(255,102,71,0.5);position:relative;"><div style="position:absolute;bottom:-7px;left:9px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:7px solid #ff6647;"></div></div>',
      iconSize: [24, 31],
      iconAnchor: [12, 31]
    });
    const priceText = chosenSlot && chosenSlot.isFeasible ? ` · €${chosenSlot.price}` : '';
    const slotText = chosenSlot && chosenSlot.isFeasible ? chosenSlot.timeStr : 'Pinned location';
    L.marker(customerCoords, { icon: pinIcon })
      .bindPopup(`<strong>📍 Your Bike Location</strong><br>Time: ${slotText}${priceText}`)
      .addTo(routeLayerGroup);
  }

  // 4. Sequenced Route Line
  const routePoints = [origin];
  activeJobs.forEach(j => routePoints.push(j.coords));
  routePoints.push(origin);

  if (customerCoords && chosenSlot && chosenSlot.isFeasible) {
    const customerRouteSequence = [origin];
    let inserted = false;

    activeJobs.forEach(j => {
      if (!inserted && j.timeSlot > chosenSlot.slotLabel) {
        customerRouteSequence.push(customerCoords);
        inserted = true;
      }
      customerRouteSequence.push(j.coords);
    });

    if (!inserted) {
      customerRouteSequence.push(customerCoords);
    }
    customerRouteSequence.push(origin);

    L.polyline(customerRouteSequence, {
      color: '#2b7336',
      weight: 4,
      opacity: 0.8,
      dashArray: '4, 6',
      lineJoin: 'round'
    }).addTo(routeLayerGroup);

    if (chosenSlot.prevStop && chosenSlot.nextStop) {
      L.polyline([chosenSlot.prevStop.coords, customerCoords, chosenSlot.nextStop.coords], {
        color: '#ff6647',
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(routeLayerGroup);
    }
  } else {
    L.polyline(routePoints, {
      color: '#4fa168',
      weight: 3.5,
      opacity: 0.7,
      dashArray: '4, 6'
    }).addTo(routeLayerGroup);
  }
}

// Calculate and Update Quotes & Form Steps
async function calculate() {
  if (!pinSet) return;
  const rawCoords = $('#coords').value;
  if (!rawCoords) return;
  const p = rawCoords.split(',').map(Number);
  if (p.some(isNaN)) return;

  calculatedSlotsData = evaluateAllSlots(p);

  let targetSlot = null;
  if (accessType === 'Meet in person') {
    updateSliderUI(calculatedSlotsData, +$('#timeSlider').value || 16);
    targetSlot = selectedSlot;
  } else {
    // Number Lock Flexible: Pick global best fit / lowest cost
    targetSlot = calculatedSlotsData.feasibleSlots.reduce((min, s) => s.price < min.price ? s : min, calculatedSlotsData.feasibleSlots[0]);
    selectedSlot = targetSlot;
    $('#selectedSlotBadge').textContent = `Flexible gap: ${targetSlot.timeStr} (Lowest price)`;
    $('#selectedSlotBadge').className = 'slotBadge';
    $('#timeSlider').disabled = true;
    $('#sliderBubble').style.display = 'none';
  }

  if (!targetSlot) return;

  const price = targetSlot.price;
  const isFlex = accessType === 'Lock code';
  const slot = isFlex ? `Flexible gap · ${targetSlot.slotLabel}` : targetSlot.slotLabel;
  const added = targetSlot.detourMinutes || 2;
  const travel = targetSlot.travelSurcharge || 2;

  quote = { price, slot, added };

  const detail = `Adds ~${added} travel min from active route. €29 base repair + €${travel} travel surcharge.`;
  const quoteEl = $('#quoteTitle');
  if (quoteEl) {
    quoteEl.textContent = accessType === 'Meet in person'
      ? `Appointment ${slot} · €${price}`
      : `Flexible repair · €${price}`;
  }
  if ($('#quoteBody')) $('#quoteBody').textContent = detail;
  if ($('#quotePrice')) $('#quotePrice').textContent = `€${price}`;
  if ($('#priceState')) $('#priceState').textContent = slot;
  if ($('#priceLarge')) $('#priceLarge').textContent = `€${price}`;
  if ($('#priceDetail')) $('#priceDetail').textContent = detail;
  if ($('#paymentPrice')) $('#paymentPrice').textContent = `€${price}`;
  if ($('#paymentSummary')) $('#paymentSummary').textContent = `${slot} · optimal route pricing`;
  if ($('#checkout')) $('#checkout').innerHTML = `Pay €${price} & book repair <span>→</span>`;

  renderMapPlannedRoute(p, targetSlot);
}

// Map Initialization
function triggerMapResize() {
  if (bookingMap && typeof bookingMap.invalidateSize === 'function') {
    bookingMap.invalidateSize();
  }
  if (googleMap && window.google && window.google.maps) {
    google.maps.event.trigger(googleMap, 'resize');
  }
}

async function initOrResizeMap() {
  const mapContainer = $('#map');
  if (!mapContainer) return;

  if (bookingMap || googleMap) {
    triggerMapResize();
    return;
  }
  if (mapInitializing) return;
  mapInitializing = true;

  let config = {};
  try {
    config = await fetch('/api/config').then(r => r.json());
  } catch {}

  const gmapsKey = config.googleMapsApiKey || '';
  const mapboxToken = config.mapboxPublicToken || '';

  // If Google Maps API key is configured, load Google Maps Platform
  if (gmapsKey) {
    try {
      if (!window.google || !window.google.maps) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `https://maps.googleapis.com/maps/api/js?key=${gmapsKey}&v=weekly&libraries=marker,places,geometry`;
          script.async = true;
          script.defer = true;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      googleMap = new google.maps.Map(mapContainer, {
        center: { lat: 60.178, lng: 24.920 },
        zoom: 12,
        mapId: 'DEMO_MAP_ID',
        internalUsageAttributionIds: ['gmp_git_agentskills_v1'],
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false
      });

      googleGeocoder = new google.maps.Geocoder();

      googleMap.addListener('click', e => {
        if (!e.latLng) return;
        setPinLocation(e.latLng.lat(), e.latLng.lng());
      });

      $('#pinStatus').textContent = 'Tap anywhere on Google Maps to place your bike pin.';
      renderMapPlannedRoute(null, null);
      mapInitializing = false;
      return;
    } catch (err) {
      console.warn('Google Maps load fallback to Leaflet:', err);
    }
  }

  try {
    bookingMap = L.map('map', {
      center: [60.178, 24.920], // Center over Helsinki/Espoo service corridor
      zoom: 12,
      zoomControl: true,
      fadeAnimation: true,
      zoomAnimation: true
    });

    const mapboxTileUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${mapboxToken}`;
    const cartoTileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

    const tiles = L.tileLayer(mapboxTileUrl, {
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1,
      attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(bookingMap);

    tiles.on('tileerror', () => {
      L.tileLayer(cartoTileUrl, {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '© CARTO © OpenStreetMap'
      }).addTo(bookingMap);
    });

    $('#pinStatus').textContent = 'Tap anywhere on the map to place your bike pin.';
    [50, 150, 300, 600].forEach(ms => setTimeout(triggerMapResize, ms));

    // Render baseline seed route on load
    renderMapPlannedRoute(null, null);

    if (pinSet && $('#coords').value) {
      const [lat, lng] = $('#coords').value.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lng)) {
        setPinLocation(lat, lng);
      }
    }

    bookingMap.on('click', e => {
      const { lat, lng } = e.latlng;
      if (isNaN(lat) || isNaN(lng)) return;
      setPinLocation(lat, lng);
    });
  } catch (err) {
    console.error('Map initialization error:', err);
    $('#pinStatus').textContent = 'Tap to select location or refresh.';
  } finally {
    mapInitializing = false;
  }
}

function setPinLocation(lat, lng) {
  $('#coords').value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  pinSet = true;
  $('#pinStatus').textContent = `✓ Pin placed at ${lat.toFixed(4)}, ${lng.toFixed(4)} — route schedule & pricing calculated.`;
  $('#pinStatus').classList.add('ready');

  // If Google Geocoder is available, reverse-geocode location name
  if (googleGeocoder && window.google && window.google.maps) {
    googleGeocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        const shortAddress = results[0].formatted_address.split(',')[0];
        $('#pinStatus').textContent = `✓ Pin placed at ${shortAddress} (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      }
    });
  }

  calculate();
}

// Mobile-First GPS Geolocation
$('#locateMeBtn')?.addEventListener('click', () => {
  if (!navigator.geolocation) {
    toast('Geolocation is not supported by your browser.');
    return;
  }
  toast('Locating your position via GPS…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (googleMap) {
        googleMap.panTo({ lat, lng });
        googleMap.setZoom(14);
      } else if (bookingMap) {
        bookingMap.flyTo([lat, lng], 14, { animate: true, duration: 1 });
      }
      setPinLocation(lat, lng);
      toast('✓ Location pinned successfully!');
    },
    err => {
      toast('Could not access GPS. Please tap your location on the map.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// Form Fullscreen Expansion
function expandForm() {
  const hero = $('#heroContainer');
  if (hero && !hero.classList.contains('expanded')) {
    hero.classList.add('expanded');
    [60, 150, 350].forEach(ms => setTimeout(triggerMapResize, ms));
  }
}

function collapseForm() {
  const hero = $('#heroContainer');
  if (hero && hero.classList.contains('expanded')) {
    hero.classList.remove('expanded');
    [60, 150, 350].forEach(ms => setTimeout(triggerMapResize, ms));
  }
}

// Step Navigation & Validation
function showStep(n) {
  step = n;
  $$('.bookStep').forEach(x => x.classList.toggle('active', +x.dataset.step === n));
  $$('.stepDots b').forEach((x, i) => x.classList.toggle('current', i === n - 1));

  if (n > 1) {
    expandForm();
  }

  if (n === 2) {
    initOrResizeMap();
    [50, 150, 300, 500].forEach(ms => setTimeout(triggerMapResize, ms));
  }
}

function validStep() {
  if (step === 2 && !pinSet) {
    toast('Please place your bike pin on the map first.');
    return false;
  }
  if (step === 3 && !quote) {
    toast('Calculating your route price…');
    return false;
  }
  if (step === 4) {
    const requiredFields = ['access', 'phone'];
    const missingField = requiredFields.some(id => !$('#' + id).value.trim());
    const missingPhotos = !photos['scenePhoto'] || !photos['framePhoto'] || !photos['tirePhoto'];
    if (missingField || missingPhotos) {
      toast('Please upload all 3 photos and fill in your contact details.');
      return false;
    }
  }
  return true;
}

// Event Listeners for Booking Flow
$$('.next').forEach(b => {
  b.onclick = () => {
    expandForm();
    if (validStep()) {
      showStep(Math.min(5, step + 1));
    }
  };
});

$$('.back').forEach(b => {
  b.onclick = () => showStep(Math.max(1, step - 1));
});

$('#bookingCard')?.addEventListener('click', () => {
  expandForm();
});

// Slider Event Listeners (Real-time live price and map route update)
const timeSlider = $('#timeSlider');
if (timeSlider) {
  timeSlider.addEventListener('input', e => {
    if (!calculatedSlotsData) return;
    const idx = +e.target.value;
    const slot = calculatedSlotsData.slots[idx];
    if (slot) {
      selectedSlot = slot;
      renderSliderBubble(slot);
      if (slot.isFeasible) {
        quote = { price: slot.price, slot: slot.slotLabel, added: slot.detourMinutes };
        $('#priceLarge').textContent = `€${slot.price}`;
        $('#priceState').textContent = slot.slotLabel;
        $('#paymentPrice').textContent = `€${slot.price}`;
        $('#paymentSummary').textContent = `${slot.slotLabel} · optimal route pricing`;
        const rawCoords = $('#coords').value.split(',').map(Number);
        renderMapPlannedRoute(rawCoords, slot);
      }
    }
  });

  timeSlider.addEventListener('change', e => {
    calculate();
  });
}

$('#accessType').onclick = e => {
  expandForm();
  const b = e.target.closest('button');
  if (!b) return;
  $$('#accessType button').forEach(x => x.classList.remove('selected'));
  b.classList.add('selected');
  accessType = b.dataset.value;

  const isFlex = accessType === 'Lock code';
  $('#slotSection').style.display = isFlex ? 'none' : 'block';
  $('#accessLabel').childNodes[0].textContent = isFlex ? 'Number-lock code and access details' : 'When can we meet?';
  $('#access').placeholder = isFlex ? 'Enter number-lock code and specific access instructions' : 'Tell us when you will be at the bike location';

  if (pinSet) {
    calculate();
  }
};

// File Upload Handlers with visual label feedback
[
  ['scenePhoto', 'sceneName', '✓ Surroundings photo attached'],
  ['framePhoto', 'frameName', '✓ Frame photo attached'],
  ['tirePhoto', 'tireName', '✓ Tire markings photo attached']
].forEach(([inputId, labelId, successMsg]) => {
  const input = $('#' + inputId);
  if (!input) return;
  input.onchange = e => {
    const file = e.target.files[0];
    if (file) {
      const r = new FileReader();
      r.onload = () => {
        photos[inputId] = r.result;
        $('#' + labelId).textContent = successMsg;
        $('#' + labelId).style.color = '#2b7336';
      };
      r.readAsDataURL(file);
    }
  };
});

// Booking Submission
$('#bookingForm').onsubmit = async e => {
  e.preventDefault();
  if (!quote) return;

  const rawCoords = $('#coords').value.split(',').map(Number);
  const newJob = {
    id: 'H-' + Math.floor(1000 + Math.random() * 8999),
    address: 'Pinned Helsinki location',
    coords: rawCoords,
    timeSlot: quote.slot,
    timed: accessType === 'Meet in person',
    price: quote.price,
    status: 'Booked',
    contact: $('#phone').value.trim(),
    access: `${accessType}: ${$('#access').value.trim()}`,
    ...photos
  };

  jobs.push(newJob);
  saveJobs();

  let pay = { demo: true };
  try {
    pay = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: newJob.price, description: `Pin & Pedal repair (${newJob.id})` })
    }).then(r => r.json());
  } catch {}

  if (pay.checkoutUrl) {
    location.href = pay.checkoutUrl;
    return;
  }

  toast(`Demo payment accepted — ${newJob.id} booked!`);
  // Reset booking form state
  $('#bookingForm').reset();
  pinSet = false;
  quote = null;
  photos = {};
  if (marker) {
    marker.remove();
    marker = null;
  }
  $('#pinStatus').textContent = 'Tap anywhere on the map to place your bike pin.';
  $('#pinStatus').classList.remove('ready');
  $('#sceneName').textContent = 'Show where it is parked';
  $('#frameName').textContent = 'Make the full frame visible';
  $('#tireName').textContent = 'Show tire numbers and markings';
  collapseForm();
  showStep(1);

  // Switch to operator dashboard view so user sees the newly created job
  setTimeout(() => {
    $$('.nav').forEach(x => x.classList.toggle('active', x.dataset.view === 'ops'));
    $$('.view').forEach(x => x.classList.toggle('active', x.id === 'ops'));
  }, 1000);
};

$('.brand')?.addEventListener('click', e => {
  e.preventDefault();
  collapseForm();
  showStep(1);
  $$('.nav').forEach(x => x.classList.toggle('active', x.dataset.view === 'book'));
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'book'));
});

// Operator Console & Navigation
$$('.nav').forEach(b => {
  b.onclick = () => {
    $$('.nav').forEach(x => x.classList.remove('active'));
    $$('.view').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const viewId = b.dataset.view;
    $('#' + viewId).classList.add('active');
    if (viewId === 'book') {
      if (step === 2) {
        setTimeout(initOrResizeMap, 100);
      }
    }
  };
});

// Operator Tabs
$$('.tab').forEach(b => {
  b.onclick = () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#' + b.dataset.panel).classList.add('active');
  };
});

// Reset Demo button
$('#reset').onclick = () => {
  jobs = JSON.parse(JSON.stringify(initialSeed));
  saveJobs();
  toast('Demo reset to initial 5 Helsinki/Espoo repair jobs.');
};

// Generate Route Button
$('#buildRoute').onclick = () => {
  renderRoutePlan();
  toast('Route generated and ordered for proximity from Kamppi hub.');
};

function renderOperatorDashboard() {
  $('#summary').textContent = `${jobs.length} Helsinki repairs in today’s queue.`;
  $('#jobCount').textContent = jobs.length;

  // Render Repair Queue
  $('#jobList').innerHTML = jobs.map(j => `
    <article class="job status-${j.status.replace(/\s+/g, '.')}">
      <div class="jobtop">
        <div>
          <h3>${j.id} · ${j.address}</h3>
          <div class="meta">${j.timeSlot} · €${j.price} · ${j.timed ? 'customer present' : 'number-lock flexible'}</div>
        </div>
        <span class="badge">${j.status}</span>
      </div>
      <div class="private">
        <strong>Access:</strong> ${j.access}<br>
        <strong>Phone:</strong> ${j.contact || 'N/A'}
      </div>
      <div class="controls">
        <select data-id="${j.id}" class="statusSelect">
          <option value="Booked" ${j.status === 'Booked' ? 'selected' : ''}>Booked</option>
          <option value="En route" ${j.status === 'En route' ? 'selected' : ''}>En route</option>
          <option value="In progress" ${j.status === 'In progress' ? 'selected' : ''}>In progress</option>
          <option value="Completed" ${j.status === 'Completed' ? 'selected' : ''}>Completed</option>
        </select>
        ${j.status === 'Completed' ? `<button class="mini alt makePostBtn" data-id="${j.id}">Draft Post</button>` : ''}
      </div>
    </article>
  `).join('');

  // Attach status change handlers
  $$('.statusSelect').forEach(sel => {
    sel.onchange = e => {
      const jobId = e.target.dataset.id;
      const targetJob = jobs.find(j => j.id === jobId);
      if (targetJob) {
        targetJob.status = e.target.value;
        saveJobs();
        toast(`Updated ${jobId} status to ${targetJob.status}`);
      }
    };
  });

  // Attach draft post handlers
  $$('.makePostBtn').forEach(btn => {
    btn.onclick = e => {
      const jobId = e.target.dataset.id;
      $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.panel === 'marketing'));
      $$('.panel').forEach(x => x.classList.toggle('active', x.id === 'marketing'));
      toast(`Switched to Marketing Studio for completed job ${jobId}`);
    };
  });

  renderRoutePlan();
  renderMarketingStudio();
}

function renderRoutePlan() {
  const sorted = jobs.slice().sort((a, b) => {
    if (a.timed && !b.timed) return -1;
    if (!a.timed && b.timed) return 1;
    if (a.timed && b.timed) return a.timeSlot.localeCompare(b.timeSlot);
    return d(origin, a.coords) - d(origin, b.coords);
  });

  $('#routeList').innerHTML = sorted.map((j, i) => {
    const distFromOrigin = d(origin, j.coords).toFixed(1);
    return `<li><strong>${j.address} (${j.id})</strong><small>${j.timeSlot} · ${distFromOrigin} km from Kamppi hub · Status: ${j.status}</small></li>`;
  }).join('');
}

function renderMarketingStudio() {
  const completedJobs = jobs.filter(j => j.status === 'Completed');
  $('#draftCount').textContent = completedJobs.length;

  if (!completedJobs.length) {
    $('#marketingList').innerHTML = '<div class="empty">Complete a repair job in the queue to generate marketing drafts.</div>';
    return;
  }

  $('#marketingList').innerHTML = completedJobs.map(j => {
    const area = j.address.split(' ')[0] || 'Helsinki';
    return `
      <article class="post">
        <div class="postStatus">READY FOR REVIEW · PRIVACY SAFE</div>
        <h3>Same-day puncture repair in ${area}</h3>
        <p>Another rider rescued today! Fast, mobile puncture repair on-site in ${area}. Book online with live route pricing.</p>
        <div class="placeholder"></div>
        <button class="mini primary pubBtn" data-id="${j.id}">Approve & Publish</button>
      </article>
    `;
  }).join('');

  $$('.pubBtn').forEach(btn => {
    btn.onclick = () => toast('Marketing post approved & scheduled for publication!');
  });
}

// Initial render
renderOperatorDashboard();

