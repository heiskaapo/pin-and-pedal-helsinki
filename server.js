const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { config, readiness } = require('./lib/config');
const { clearSessionCookieHeader, createOperatorSession, requireInternalOidc, requireOperator, sessionCookieHeader } = require('./lib/auth');
const { draftMarketing, recommendSlots } = require('./lib/ai');
const { applySecurityHeaders, assertSameOrigin, clientIp, json, readBody, readJson, text } = require('./lib/http');
const { notifyCustomer } = require('./lib/notifications');
const payments = require('./lib/payments');
const { runRetention } = require('./lib/retention');
const { calculateSlotOptions, routeForJobs } = require('./lib/routing');
const social = require('./lib/social');
const storage = require('./lib/storage');
const store = require('./lib/store');
const { currentMinute, dayKey } = require('./lib/time');
const { randomToken, signPayload, verifyPayload } = require('./lib/tokens');
const validate = require('./lib/validation');

const publicRoot = path.resolve(__dirname, 'public');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

const limits = new Map();
function rateLimit(req, scope, max, windowMs) {
  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();
  const current = limits.get(key);
  if (!current || current.resetAt <= now) {
    limits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > max) throw Object.assign(new Error('Too many requests. Please try again later.'), { code: 'RATE_LIMITED' });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of limits.entries()) if (value.resetAt <= now) limits.delete(key);
}, 10 * 60 * 1000).unref();

function errorStatus(error) {
  return {
    BODY_TOO_LARGE: 413, CONFIG: 503, FORBIDDEN: 403, INVALID_JSON: 400, INVALID_TOKEN: 401, INVALID_WEBHOOK: 400,
    NO_ROUTE: 422, NOT_FOUND: 404, ORIGIN_NOT_ALLOWED: 403, OUTSIDE_SERVICE_AREA: 422,
    PAYMENTS_NOT_CONFIGURED: 503, PAYMENT_REFERENCE_MISSING: 409, QUOTE_EXPIRED: 409, QUOTE_NOT_FOUND: 404, RATE_LIMITED: 429,
    ROUTING_UNAVAILABLE: 503, SLOT_UNAVAILABLE: 409, SOCIAL_NOT_CONFIGURED: 503,
    SOCIAL_PUBLISH_FAILED: 502, TOKEN_EXPIRED: 401, UNAUTHENTICATED: 401, VALIDATION: 400
  }[error.code] || 500;
}

function safeErrorMessage(error, status) {
  if (status >= 500 && !['CONFIG', 'PAYMENTS_NOT_CONFIGURED', 'SOCIAL_NOT_CONFIGURED', 'ROUTING_UNAVAILABLE'].includes(error.code)) return 'The service could not complete the request';
  return error.message || 'Request failed';
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && ['/healthz', '/api/healthz'].includes(url.pathname)) return json(res, 200, { ok: true });
  if (req.method === 'GET' && ['/readyz', '/api/readyz'].includes(url.pathname)) {
    const state = readiness();
    return json(res, state.ready ? 200 : 503, state);
  }
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return json(res, 200, {
      mapsBrowserApiKey: config.mapsBrowserApiKey,
      identityPlatformApiKey: config.identityPlatformApiKey,
      projectId: config.projectId,
      depot: config.depot,
      serviceArea: config.serviceArea,
      workday: config.workday,
      paymentsConfigured: Boolean(config.stripeSecretKey && config.stripeWebhookSecret)
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/public/live') return json(res, 200, await store.getPublicLive());

  if (req.method === 'POST' && url.pathname === '/api/quotes') {
    rateLimit(req, 'quotes', 20, 10 * 60 * 1000);
    assertSameOrigin(req);
    const body = await readJson(req, 32 * 1024);
    const customerCoords = validate.coordinates(body.customerCoords);
    const requestedAccessType = validate.accessType(body.accessType);
    const currentDay = dayKey();
    const jobs = await store.getJobsForDay(currentDay);
    const options = await calculateSlotOptions(customerCoords, jobs);
    if (!options.length) throw Object.assign(new Error('No feasible same-day appointments remain'), { code: 'SLOT_UNAVAILABLE' });
    const recommendation = await recommendSlots(options);
    const saved = await store.saveQuote({ dayKey: currentDay, customerCoords, accessType: requestedAccessType, area: 'Helsinki/Espoo', options });
    return json(res, 200, {
      quoteToken: signPayload({ type: 'quote', quoteId: saved.id }, config.quoteTtlMinutes * 60),
      expiresAt: saved.expiresAt,
      options,
      recommendation
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    rateLimit(req, 'bookings', 6, 60 * 60 * 1000);
    assertSameOrigin(req);
    if (!config.stripeSecretKey || !config.stripeWebhookSecret) throw Object.assign(new Error('Payments are temporarily unavailable'), { code: 'PAYMENTS_NOT_CONFIGURED' });
    const body = await readJson(req);
    const quotePayload = verifyPayload(body.quoteToken);
    if (quotePayload.type !== 'quote') throw Object.assign(new Error('Quote token is invalid'), { code: 'INVALID_TOKEN' });
    const details = {
      quoteId: quotePayload.quoteId,
      optionId: validate.requiredString(body.optionId, 'Appointment option', 32),
      phone: validate.phone(body.phone),
      email: validate.email(body.email),
      accessType: validate.accessType(body.accessType),
      accessInstructions: validate.requiredString(body.accessInstructions, 'Access instructions', 1000)
    };
    const customerSecret = randomToken();
    const bookingId = await store.createPendingBooking({ ...details, customerToken: customerSecret });
    try {
      const photoPaths = await storage.uploadBookingPhotos(bookingId, body.photos);
      await store.setBookingPhotos(bookingId, photoPaths);
      const booking = await store.getBooking(bookingId);
      return json(res, 201, await payments.createCheckout(booking, customerSecret));
    } catch (error) {
      await storage.deleteBookingPhotos(bookingId).catch(() => {});
      await store.deleteFailedBooking(bookingId).catch(() => {});
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/bookings/status') {
    rateLimit(req, 'booking-status', 60, 10 * 60 * 1000);
    const booking = await store.getCustomerBooking(url.searchParams.get('token'));
    if (!booking) throw Object.assign(new Error('Booking not found'), { code: 'NOT_FOUND' });
    return json(res, 200, booking);
  }
  if (req.method === 'POST' && url.pathname === '/api/bookings/cancel') {
    rateLimit(req, 'booking-cancel', 10, 60 * 60 * 1000);
    assertSameOrigin(req);
    const body = await readJson(req, 16 * 1024);
    const booking = await store.getCustomerBookingRecord(body.token);
    if (!booking) throw Object.assign(new Error('Booking not found'), { code: 'NOT_FOUND' });
    if (booking.status === 'Completed') throw Object.assign(new Error('A completed appointment cannot be cancelled'), { code: 'VALIDATION' });
    if (booking.status !== 'Cancelled' && booking.dayKey === dayKey() && currentMinute() >= booking.startMinute - 60) {
      throw Object.assign(new Error('Online cancellation closes 60 minutes before the appointment. Please contact the mechanic.'), { code: 'VALIDATION' });
    }
    const cancelled = await payments.cancelBooking(booking);
    await notifyCustomer(cancelled, cancelled.paymentStatus === 'refunded' ? 'refunded' : 'Cancelled');
    return json(res, 200, { booking: await store.getCustomerBooking(body.token) });
  }
  if (req.method === 'POST' && url.pathname === '/api/stripe/webhook') {
    const rawBody = await readBody(req, 1024 * 1024);
    return json(res, 200, await payments.handleWebhook(rawBody, req.headers['stripe-signature']));
  }

  if (req.method === 'POST' && url.pathname === '/api/operator/session') {
    rateLimit(req, 'operator-login', 10, 15 * 60 * 1000);
    assertSameOrigin(req);
    const body = await readJson(req, 32 * 1024);
    const session = await createOperatorSession(validate.requiredString(body.idToken, 'Identity token', 10000));
    return json(res, 200, { authenticated: true }, { 'Set-Cookie': sessionCookieHeader(session) });
  }
  if (req.method === 'DELETE' && url.pathname === '/api/operator/session') {
    assertSameOrigin(req);
    return json(res, 200, { authenticated: false }, { 'Set-Cookie': clearSessionCookieHeader() });
  }

  if (url.pathname.startsWith('/api/operator/')) {
    const operator = await requireOperator(req);
    if (req.method !== 'GET') assertSameOrigin(req);
    if (req.method === 'GET' && url.pathname === '/api/operator/me') return json(res, 200, { email: operator.email || '', operator: true });
    if (req.method === 'GET' && url.pathname === '/api/operator/jobs') return json(res, 200, { jobs: await store.listOperatorJobs(url.searchParams.get('day') || dayKey()) });
    if (req.method === 'GET' && url.pathname === '/api/operator/route') {
      const jobs = await store.listOperatorJobs(url.searchParams.get('day') || dayKey());
      return json(res, 200, await routeForJobs(jobs));
    }
    if (req.method === 'POST' && url.pathname === '/api/operator/location') {
      rateLimit(req, `operator-location-${operator.uid}`, 240, 60 * 60 * 1000);
      const body = await readJson(req, 16 * 1024);
      const [lat, lng] = validate.coordinates([body.lat, body.lng]);
      await store.saveMechanicLocation({ lat, lng, accuracy: Math.max(0, Math.min(10000, Number(body.accuracy) || 0)), operatorEmail: operator.email || '' });
      return json(res, 200, { saved: true });
    }

    const statusMatch = url.pathname.match(/^\/api\/operator\/jobs\/([^/]+)\/status$/);
    if (req.method === 'PATCH' && statusMatch) {
      const body = await readJson(req, 32 * 1024);
      const newStatus = validate.status(body.status);
      const existing = await store.getBooking(statusMatch[1]);
      if (!existing) throw Object.assign(new Error('Booking not found'), { code: 'NOT_FOUND' });
      const booking = newStatus === 'Cancelled'
        ? await payments.cancelBooking(existing)
        : await store.updateBookingStatus(statusMatch[1], newStatus, validate.optionalString(body.publicNote, 300));
      await notifyCustomer(booking, newStatus);
      return json(res, 200, { job: booking });
    }

    const completionMatch = url.pathname.match(/^\/api\/operator\/jobs\/([^/]+)\/completion-photo$/);
    if (req.method === 'POST' && completionMatch) {
      const body = await readJson(req, 6 * 1024 * 1024);
      await store.setCompletionPhoto(completionMatch[1], await storage.uploadCompletionPhoto(completionMatch[1], body.data));
      return json(res, 201, { uploaded: true });
    }

    const photoMatch = url.pathname.match(/^\/api\/operator\/jobs\/([^/]+)\/photos\/([^/]+)$/);
    if (req.method === 'GET' && photoMatch) {
      const booking = await store.getBooking(photoMatch[1]);
      const objectName = photoMatch[2] === 'completion' ? booking?.completionPhoto : booking?.photos?.[photoMatch[2]];
      if (!objectName) throw Object.assign(new Error('Photo not found'), { code: 'NOT_FOUND' });
      const file = await storage.getPhotoStream(objectName);
      applySecurityHeaders(res);
      res.writeHead(200, { 'Content-Type': file.contentType, 'Cache-Control': 'private, no-store, max-age=0' });
      file.stream.pipe(res);
      return;
    }

    const draftMatch = url.pathname.match(/^\/api\/operator\/jobs\/([^/]+)\/marketing\/draft$/);
    if (req.method === 'POST' && draftMatch) {
      const booking = await store.getBooking(draftMatch[1]);
      if (!booking || booking.status !== 'Completed') throw Object.assign(new Error('Only completed repairs can create a marketing draft'), { code: 'VALIDATION' });
      const draft = await draftMarketing({ area: booking.area, completedAt: booking.completedAt?.toDate?.().toISOString(), publicPhotoAvailable: Boolean(booking.completionPhoto) });
      await store.saveMarketingDraft(booking.id, draft);
      return json(res, 201, { draft });
    }

    const publishMatch = url.pathname.match(/^\/api\/operator\/jobs\/([^/]+)\/marketing\/publish$/);
    if (req.method === 'POST' && publishMatch) {
      const booking = await store.getBooking(publishMatch[1]);
      if (!booking?.marketing || booking.marketing.status !== 'draft') throw Object.assign(new Error('Create and approve a draft first'), { code: 'VALIDATION' });
      const result = await social.publishSocial({ bookingId: booking.id, title: booking.marketing.title, caption: booking.marketing.caption });
      await store.markMarketingPublished(booking.id, result);
      return json(res, 200, { published: true, reference: result.reference });
    }
  }

  if (req.method === 'POST' && url.pathname === '/internal/retention') {
    await requireInternalOidc(req);
    return json(res, 200, await runRetention());
  }
  throw Object.assign(new Error('API route not found'), { code: 'NOT_FOUND' });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const file = path.resolve(publicRoot, requested);
  const rootPrefix = `${publicRoot}${path.sep}`.toLowerCase();
  if (file.toLowerCase() !== path.join(publicRoot, 'index.html').toLowerCase() && !file.toLowerCase().startsWith(rootPrefix)) return text(res, 404, 'Not found');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return text(res, 404, 'Not found');
  applySecurityHeaders(res);
  const extension = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300, must-revalidate'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 100);
  const startedAt = Date.now();
  try {
    const url = new URL(req.url, config.publicBaseUrl);
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/') || url.pathname === '/healthz' || url.pathname === '/readyz') await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else text(res, 405, 'Method not allowed');
  } catch (error) {
    const status = errorStatus(error);
    console.error(JSON.stringify({ severity: status >= 500 ? 'ERROR' : 'WARNING', event: 'request_failed', requestId: res.requestId, method: req.method, path: req.url?.split('?')[0], code: error.code || 'INTERNAL', message: error.message, elapsedMs: Date.now() - startedAt }));
    if (!res.headersSent) json(res, status, { error: safeErrorMessage(error, status), code: error.code || 'INTERNAL', requestId: res.requestId });
    else res.destroy();
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
server.listen(config.port, () => {
  const state = readiness();
  console.log(JSON.stringify({ severity: 'INFO', event: 'server_started', port: config.port, ready: state.ready, missing: state.missing }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ severity: 'INFO', event: 'server_shutdown', signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { server };
