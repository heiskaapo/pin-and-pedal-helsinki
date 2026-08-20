const { OAuth2Client } = require('google-auth-library');
const { auth } = require('./firebase');
const { config } = require('./config');
const { parseCookies } = require('./http');
const { signPayload, verifyPayload } = require('./tokens');

const COOKIE_NAME = '__Host-pp_operator';
const SESSION_MS = 8 * 60 * 60 * 1000;
const oidcClient = new OAuth2Client();

function isAllowedOperator(decoded) {
  const email = String(decoded.email || '').toLowerCase();
  return decoded.operator === true || (email && config.operatorAllowedEmails.includes(email));
}

async function createOperatorSession(idToken) {
  const decoded = await auth().verifyIdToken(idToken, false);
  if (!isAllowedOperator(decoded)) throw Object.assign(new Error('Operator access denied'), { code: 'FORBIDDEN' });
  return signPayload({ type: 'operator-session', uid: decoded.uid, email: decoded.email || '', operator: decoded.operator === true }, Math.floor(SESSION_MS / 1000));
}

async function requireOperator(req) {
  const sessionCookie = parseCookies(req)[COOKIE_NAME];
  if (!sessionCookie) throw Object.assign(new Error('Operator sign-in required'), { code: 'UNAUTHENTICATED' });
  const decoded = verifyPayload(sessionCookie);
  if (decoded.type !== 'operator-session') throw Object.assign(new Error('Operator sign-in required'), { code: 'UNAUTHENTICATED' });
  if (!isAllowedOperator(decoded)) throw Object.assign(new Error('Operator access denied'), { code: 'FORBIDDEN' });
  return decoded;
}

function sessionCookieHeader(value) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`
  ];
  if (config.secureCookies) attributes.push('Secure');
  return attributes.join('; ');
}

function clearSessionCookieHeader() {
  const attributes = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (config.secureCookies) attributes.push('Secure');
  return attributes.join('; ');
}

async function requireInternalOidc(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !config.internalServiceAccountEmail) throw Object.assign(new Error('Internal authentication required'), { code: 'UNAUTHENTICATED' });
  const ticket = await oidcClient.verifyIdToken({ idToken: token, audience: config.publicBaseUrl });
  const payload = ticket.getPayload();
  if (String(payload.email || '').toLowerCase() !== config.internalServiceAccountEmail || payload.email_verified !== true) {
    throw Object.assign(new Error('Internal access denied'), { code: 'FORBIDDEN' });
  }
  return payload;
}

module.exports = {
  clearSessionCookieHeader,
  createOperatorSession,
  requireInternalOidc,
  requireOperator,
  sessionCookieHeader
};
