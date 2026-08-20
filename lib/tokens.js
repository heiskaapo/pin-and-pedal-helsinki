const crypto = require('crypto');
const { config } = require('./config');

const base64url = value => Buffer.from(value).toString('base64url');

function signPayload(payload, ttlSeconds = 900) {
  if (!config.sessionCookieSecret) throw Object.assign(new Error('Token signing is not configured'), { code: 'CONFIG' });
  const body = base64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const signature = crypto.createHmac('sha256', config.sessionCookieSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyPayload(token) {
  if (!config.sessionCookieSecret || typeof token !== 'string') throw Object.assign(new Error('Invalid token'), { code: 'INVALID_TOKEN' });
  const [body, signature] = token.split('.');
  if (!body || !signature) throw Object.assign(new Error('Invalid token'), { code: 'INVALID_TOKEN' });
  const expected = crypto.createHmac('sha256', config.sessionCookieSecret).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw Object.assign(new Error('Invalid token'), { code: 'INVALID_TOKEN' });
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid token'), { code: 'INVALID_TOKEN' });
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('Token expired'), { code: 'TOKEN_EXPIRED' });
  }
  return payload;
}

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

module.exports = { hashToken, randomToken, signPayload, verifyPayload };
