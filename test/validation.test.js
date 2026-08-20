const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../lib/validation');

test('accepts a valid Helsinki coordinate', () => {
  assert.deepEqual(validation.coordinates([60.1699, 24.9384]), [60.1699, 24.9384]);
});

test('rejects a coordinate outside the service area', () => {
  assert.throws(() => validation.coordinates([61.5, 24.9]), error => error.code === 'OUTSIDE_SERVICE_AREA');
});

test('rejects malformed phone and email values', () => {
  assert.throws(() => validation.phone('123'), error => error.code === 'VALIDATION');
  assert.throws(() => validation.email('not-an-email'), error => error.code === 'VALIDATION');
});

test('allows only known workflow statuses', () => {
  assert.equal(validation.status('Completed'), 'Completed');
  assert.throws(() => validation.status('Paid-ish'), error => error.code === 'VALIDATION');
});
