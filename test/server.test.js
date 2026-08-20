const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = 18081;
const baseUrl = `http://127.0.0.1:${port}`;
let child;

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
}

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: baseUrl, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer();
});

test.after(() => child?.kill('SIGTERM'));

test('serves health without claiming production readiness', async () => {
  const health = await fetch(`${baseUrl}/api/healthz`);
  assert.equal(health.status, 200);
  const ready = await fetch(`${baseUrl}/api/readyz`);
  assert.equal(ready.status, 503);
  const state = await ready.json();
  assert.equal(state.ready, false);
  assert.ok(state.missing.includes('STRIPE_SECRET_KEY'));
});

test('serves the application with defensive browser headers', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('does not expose a hardcoded Maps key when none is configured', async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  const config = await response.json();
  assert.equal(config.mapsBrowserApiKey, '');
  assert.equal(config.paymentsConfigured, false);
  assert.equal(config.workday.minimumLeadMinutes, 30);
});
