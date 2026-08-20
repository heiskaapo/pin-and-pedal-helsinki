process.env.SESSION_COOKIE_SECRET = 'test-only-secret-with-at-least-32-characters';
const test = require('node:test');
const assert = require('node:assert/strict');
const { signPayload, verifyPayload } = require('../lib/tokens');

test('round-trips a signed quote token', () => {
  const token = signPayload({ type: 'quote', quoteId: 'q-123' }, 60);
  const payload = verifyPayload(token);
  assert.equal(payload.type, 'quote');
  assert.equal(payload.quoteId, 'q-123');
});

test('rejects a modified token', () => {
  const token = signPayload({ type: 'quote', quoteId: 'q-123' }, 60);
  assert.throws(() => verifyPayload(`${token.slice(0, -1)}x`), error => error.code === 'INVALID_TOKEN');
});

test('rejects an expired token', () => {
  const token = signPayload({ type: 'quote', quoteId: 'q-123' }, -1);
  assert.throws(() => verifyPayload(token), error => error.code === 'TOKEN_EXPIRED');
});
