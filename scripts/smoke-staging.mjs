import assert from 'node:assert/strict';
const base = process.env.SMOKE_ORIGIN;
if (!base) throw new Error('Set SMOKE_ORIGIN to the staging HTTPS origin.');
const url = new URL(base);
if (
  url.origin !== base ||
  (url.protocol !== 'https:' &&
    !(process.argv.includes('--allow-local') && ['localhost', '127.0.0.1'].includes(url.hostname)))
)
  throw new Error('Smoke target must be HTTPS, or explicitly allowed loopback only.');
async function call(path, status, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, status, `Unexpected status for ${path}`);
  return response;
}
const live = await call('/api/v1/health/live', 200);
assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
assert.ok(live.headers.get('content-security-policy')?.includes("default-src 'self'"));
assert.ok(live.headers.get('strict-transport-security'));
assert.ok(live.headers.get('x-request-id'));
const ready = await (await call('/api/v1/health/ready', 200)).json();
assert.equal(ready.checks.database, 'ok');
assert.equal(ready.checks.lifecycle, 'accepting_traffic');
assert.equal(ready.checks.dependencies?.worker, 'ok');
assert.equal(ready.checks.dependencies?.web, 'ok');
assert.equal(ready.checks.dependencies?.storage, 'ok');
const home = await call('/', 200);
assert.ok((await home.text()).includes('<div id="root">'));
await call('/api/v1/clinical/portal', 401);
await call('/api/v1/billing/portal', 401);
await call('/api/v1/imaging/capabilities', 401);
await call('/api/v1/health/live', 403, { origin: 'https://attacker.example.invalid' });
const contract = await (await call('/api/v1/contracts/v1?format=openapi', 200)).json();
assert.ok(contract.paths['/api/v1/appointments']);
console.log(
  'Staging foundation smoke passed: web, API, DB, worker, private storage, headers, CORS and anonymous denial. Authenticated workflow checks remain separate.',
);
