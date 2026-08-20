const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'https://canonical.example';
process.env.ALLOWED_ORIGINS = 'https://public.example|https://canonical.example';

const { assertSameOrigin } = require('../lib/http');

test('accepts configured public aliases for state-changing requests', () => {
  assert.doesNotThrow(() => assertSameOrigin({ headers: { origin: 'https://public.example' } }));
  assert.doesNotThrow(() => assertSameOrigin({ headers: { origin: 'https://canonical.example' } }));
});

test('rejects unconfigured and malformed origins', () => {
  assert.throws(
    () => assertSameOrigin({ headers: { origin: 'https://attacker.example' } }),
    error => error.code === 'ORIGIN_NOT_ALLOWED'
  );
  assert.throws(
    () => assertSameOrigin({ headers: { origin: 'not-an-origin' } }),
    error => error.code === 'ORIGIN_NOT_ALLOWED'
  );
});
