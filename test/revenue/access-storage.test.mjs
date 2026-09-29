// S2 access/storage characterization: real exported handlers, synthetic state only.
// TODO tests execute their desired assertion; they are not skipped or softened.
// Empty ZIP fixtures identify streamed bytes; they do not certify a business release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withWorld, loadHandlers } from '../harness/index.mjs';

const NOW = Date.parse('2026-09-28T13:00:00Z');
const DAY = 86400_000;
const TOKEN = 'a'.repeat(32);
const UNKNOWN = 'b'.repeat(32);
const TAMPERED = 'a'.repeat(31) + 'c';
const EMAIL = 'casey@example.com';
const COOKIE = `mp_sess=${TOKEN}`;
const FRESH = { uploaded: new Date(NOW), etag: 'artifact_FRESH_TEST' };
const STALE = { uploaded: new Date(NOW - 10 * DAY), etag: 'artifact_STALE_TEST' };

function zipFixture(comment) {
  const note = Buffer.from(comment);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(note.length, 20);
  return Buffer.concat([end, note]);
}
const WEEKLY = zipFixture('weekly_TEST');
const MONTHLY = zipFixture('monthly_TEST');
const HTML = '<!doctype html><html><head></head><body><span class="fresh">SYNTHETIC_TEST</span></body></html>';
const row = (extra = {}) => ({ email: EMAIL, name: 'Casey TEST', customer: 'cus_ACCESS_TEST',
  since: '2026-09-01', active: true, token: TOKEN, ...extra });

async function seed(w, rows = [row()]) {
  await w.r2.set('subscribers.json', rows);
  await w.r2.set('latest-weekly.zip', WEEKLY, FRESH);
  await w.r2.set('latest-monthly.zip', MONTHLY, FRESH);
  await w.r2.set('refresh-status.json', { ok: true, ran_at: new Date(NOW).toISOString() }, FRESH);
}
function scenario(fn) {
  return withWorld(async (w) => {
    const h = await loadHandlers();
    await seed(w);
    await fn(w, h);
  }, { now: NOW });
}
const puts = (w) => w.r2.ops.filter((op) => op.op === 'put');
const artifactReads = (w) => w.r2.ops.filter((op) => op.op === 'get' && /^latest-/.test(op.key));
function privatePage(response) {
  assert.match(response.headers.get('cache-control') || '', /private/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  assert.match(response.headers.get('vary') || '', /cookie/i);
}
async function bytes(response) { return Buffer.from(await response.arrayBuffer()); }

for (const [tier, expected] of [['weekly', WEEKLY], ['monthly', MONTHLY]]) {
  test(`I19/I25 active token downloads the ${tier} bytes without public caching`, () => scenario(async (w, h) => {
    const response = await w.call(h.download, `/api/my-leads?t=${TOKEN}&k=${tier}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await bytes(response), expected);
    assert.equal(w.r2.json('subscribers.json')[0].active, true);
  }));
}

test('I19 malformed download tokens cannot read roster or artifact bytes', () => scenario(async (w, h) => {
  for (const value of ['', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(31), `${TOKEN}/extra`]) {
    const before = w.r2.ops.length;
    const response = await w.call(h.download, `/api/my-leads?t=${encodeURIComponent(value)}`);
    assert.equal(response.status, 400);
    assert.equal(w.r2.ops.length, before);
  }
}));

for (const [label, token] of [['unknown', UNKNOWN], ['tampered', TAMPERED]]) {
  test(`I19 ${label} well-formed token cannot obtain download bytes`, () => scenario(async (w, h) => {
    const response = await w.call(h.download, `/api/my-leads?t=${token}`);
    assert.equal(response.status, 403);
    assert.equal(artifactReads(w).length, 0);
    assert.doesNotMatch(await response.text(), /weekly_TEST|monthly_TEST/);
  }));
}

test('I19 explicit revocation denies the same download token immediately', () => scenario(async (w, h) => {
  assert.equal((await w.call(h.download, `/api/my-leads?t=${TOKEN}`)).status, 200);
  await w.r2.set('subscribers.json', [row({ active: false })]);
  const before = artifactReads(w).length;
  const response = await w.call(h.download, `/api/my-leads?t=${TOKEN}`);
  assert.equal(response.status, 403);
  assert.equal(artifactReads(w).length, before);
}));

test('I19/I25 valid portal link sets private scoped cookie and removes query token', () => scenario(async (w, h) => {
  const response = await w.call(h.portal, `/leads?t=${TOKEN}`);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/leads');
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, new RegExp(`^mp_sess=${TOKEN};`));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/leads', 'Max-Age=1209600']) {
    assert.ok(cookie.includes(flag), `cookie must include ${flag}`);
  }
  privatePage(response);
}));

test('I19 malformed query token cannot be rescued by a valid portal cookie', () => scenario(async (w, h) => {
  const response = await w.call(h.portal, '/leads?t=malformed_TEST', { headers: { cookie: COOKIE } });
  assert.equal(response.status, 400);
  assert.equal(artifactReads(w).length, 0);
  privatePage(response);
}));

test('I19 unknown portal token and stale revoked cookie cannot obtain the dashboard', () => scenario(async (w, h) => {
  assert.equal((await w.call(h.portal, `/leads?t=${UNKNOWN}`)).status, 403);
  assert.equal((await w.call(h.portal, `/leads?t=${TOKEN}`)).status, 302);
  await w.r2.set('subscribers.json', [row({ active: false })]);
  const response = await w.call(h.portal, '/leads', { headers: { cookie: COOKIE } });
  assert.equal(response.status, 403);
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal(artifactReads(w).length, 0);
  privatePage(response);
}));

test('I19 logout clears only the browser session; active bearer entitlement remains', () => scenario(async (w, h) => {
  const response = await w.call(h.logout, '/leads/out', { headers: { cookie: COOKIE } });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('set-cookie') || '', /mp_sess=;.*Max-Age=0/);
  privatePage(response);
  assert.equal(w.r2.json('subscribers.json')[0].token, TOKEN);
  assert.equal((await w.call(h.download, `/api/my-leads?t=${TOKEN}`)).status, 200);
}));

test('I12 D2: absent and null active flags remain access-eligible; false alone revokes', () => scenario(async (w, h) => {
  for (const variant of ['absent', null, true, false]) {
    const sub = row({ active: variant });
    if (variant === 'absent') delete sub.active;
    await w.r2.set('subscribers.json', [sub]);
    assert.equal((await w.call(h.download, `/api/my-leads?t=${TOKEN}`)).status, variant === false ? 403 : 200);
    assert.equal((await w.call(h.portal, `/leads?t=${TOKEN}`)).status, variant === false ? 403 : 302);
  }
}));

for (const handler of ['download', 'portal']) {
  test(`I20 ${handler} returns controlled unavailability on roster get failure`, () => scenario(async (w, h) => {
    w.r2.failNext('get', 'subscribers.json', new Error('SYNTHETIC_STORAGE_TEST'));
    const path = handler === 'download' ? `/api/my-leads?t=${TOKEN}` : `/leads?t=${TOKEN}`;
    const response = await w.call(h[handler], path);
    assert.equal(response.status, 503);
    assert.equal(artifactReads(w).length, 0);
    assert.doesNotMatch(await response.text(), /SYNTHETIC_STORAGE_TEST/);
  }));
  test(`I20 ${handler} returns controlled unavailability on malformed roster JSON`, () => scenario(async (w, h) => {
    await w.r2.set('subscribers.json', '{broken_TEST');
    const path = handler === 'download' ? `/api/my-leads?t=${TOKEN}` : `/leads?t=${TOKEN}`;
    const response = await w.call(h[handler], path);
    assert.equal(response.status, 503);
    assert.equal(artifactReads(w).length, 0);
  }));
}

for (const [label, value] of [['object', {}], ['null', null], ['string', 'wrong_schema_TEST']]) {
  test(`I20 portal controls ${label}-shaped roster JSON`, () => scenario(async (w, h) => {
    await w.r2.set('subscribers.json', JSON.stringify(value));
    const response = await w.call(h.portal, `/leads?t=${TOKEN}`);
    assert.equal(response.status, 503);
    assert.equal(artifactReads(w).length, 0);
  }));
  test(`I20 download controls ${label}-shaped roster JSON`,
    { todo: 'C15: download lacks consistent array-schema validation' },
    () => scenario(async (w, h) => {
      await w.r2.set('subscribers.json', JSON.stringify(value));
      const response = await w.call(h.download, `/api/my-leads?t=${TOKEN}`);
      assert.equal(response.status, 503);
      assert.equal(artifactReads(w).length, 0);
    }));
}

test('I20 missing roster is unavailable on both access routes',
  { todo: 'C15: download currently treats missing roster as inactive while portal reports unavailable' },
  () => withWorld(async (w) => {
    const h = await loadHandlers();
    const portal = await w.call(h.portal, `/leads?t=${TOKEN}`);
    const download = await w.call(h.download, `/api/my-leads?t=${TOKEN}`);
    assert.equal(portal.status, 503);
    assert.equal(download.status, 503);
  }, { now: NOW }));

test('I20 throwing bundle read produces controlled download unavailability',
  { todo: 'C15: download artifact get exception currently escapes the handler' },
  () => scenario(async (w, h) => {
    w.r2.failNext('get', 'latest-weekly.zip', new Error('SYNTHETIC_BUNDLE_READ_TEST'));
    const response = await w.call(h.download, `/api/my-leads?t=${TOKEN}`);
    assert.equal(response.status, 503);
  }));

test('I21 stale portal metadata hides paid rows without reading the HTML body', () => scenario(async (w, h) => {
  await w.r2.set('latest-weekly.html', HTML, STALE);
  const response = await w.call(h.portal, '/leads', { headers: { cookie: COOKIE } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Do not work from this page/);
  assert.equal(w.r2.ops.filter((op) => op.op === 'get' && op.key === 'latest-weekly.html').length, 0);
  privatePage(response);
}));

test('I21 malformed kill-switch JSON pauses an anonymous portal request', () => scenario(async (w, h) => {
  await w.r2.set('portal.json', '{broken_TEST');
  const response = await w.call(h.portal, '/leads');
  assert.equal(response.status, 503);
  assert.match(await response.text(), /portal is paused/);
  privatePage(response);
}));

test('I26 hostile Unicode portal message is escaped by the real page handler', () => scenario(async (w, h) => {
  const hostile = `town-a Δ 🧪 </p><script>globalThis.MARKUP_TEST=1</script><p> & "quoted" 'single'`;
  await w.r2.set('portal.json', { off: true, message: hostile });
  const response = await w.call(h.portal, '/leads');
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.ok(body.includes('town-a Δ 🧪'));
  assert.ok(body.includes('&lt;/p&gt;&lt;script&gt;'));
  assert.ok(body.includes('&amp; &quot;quoted&quot; &#39;single&#39;'));
  assert.doesNotMatch(body, /<script|<\/p><script/i);
  privatePage(response);
}));

test('I21 failed pause-switch read cannot silently establish an active portal session',
  { todo: 'C16 owner policy: pause-read uncertainty must have an explicit safe outcome' },
  () => scenario(async (w, h) => {
    w.r2.failNext('get', 'portal.json', new Error('SYNTHETIC_PAUSE_READ_TEST'));
    const response = await w.call(h.portal, `/leads?t=${TOKEN}`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null);
  }));

test('I21 missing HTML cannot redirect a subscriber to a known stale ZIP',
  { todo: 'C16 owner policy: fallback must not bypass stale-artifact handling' },
  () => scenario(async (w, h) => {
    await w.r2.set('latest-weekly.zip', WEEKLY, STALE);
    await w.r2.set('refresh-status.json', { ok: true, ran_at: new Date(NOW - 10 * DAY).toISOString() }, STALE);
    const response = await w.call(h.portal, '/leads', { headers: { cookie: COOKIE } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
  }));

test('I21 direct download gives a controlled outcome for a known stale ZIP',
  { todo: 'C16 owner policy: download currently has no artifact freshness gate' },
  () => scenario(async (w, h) => {
    await w.r2.set('latest-weekly.zip', WEEKLY, STALE);
    await w.r2.set('refresh-status.json', { ok: false, ran_at: new Date(NOW - 10 * DAY).toISOString() }, STALE);
    const response = await w.call(h.download, `/api/my-leads?t=${TOKEN}`);
    assert.equal(response.status, 503);
  }));

const ALLOWED_UPLOADS = [
  ['latest-monthly.zip', MONTHLY], ['latest-weekly.zip', WEEKLY], ['latest-sample.zip', WEEKLY],
  ['refresh-status.json', '{"ok":true}'], ['run-log.txt', 'SYNTHETIC_TEST'],
  ['cold-state.json', '{}'], ['cold-log.txt', 'SYNTHETIC_TEST'], ['source-health.json', '{}'],
  ['latest-weekly.html', HTML],
];
const READABLE = ['cold-queue.json', 'cold-state.json', 'suppression.json', 'source-health.json'];

test('I22 genuine OIDC reaches each declared upload key through PUT/POST', () => scenario(async (w, h) => {
  const headers = await w.oidcHeaders();
  for (const [index, [key, body]] of ALLOWED_UPLOADS.entries()) {
    const before = puts(w).length;
    const response = await w.call(h.upload, `/api/upload-bundle?key=${encodeURIComponent(key)}`,
      { method: index % 2 ? 'POST' : 'PUT', headers, body });
    assert.equal(response.status, 200, key);
    assert.equal(puts(w).length, before + 1, key);
    assert.equal(puts(w).at(-1).key, key);
  }
}));

test('I22/I25 get-object accepts only declared reader keys and disables response caching', () => scenario(async (w, h) => {
  const headers = await w.oidcHeaders();
  for (const key of READABLE) {
    await w.r2.set(key, { synthetic: 'town-a', records: [] });
    const before = puts(w).length;
    const response = await w.call(h.getObject, `/api/get-object?key=${encodeURIComponent(key)}`, { headers });
    assert.equal(response.status, 200, key);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { synthetic: 'town-a', records: [] });
    assert.equal(puts(w).length, before);
  }
}));

test('I22 roster, unknown and encoded undeclared keys never reach storage', () => scenario(async (w, h) => {
  const headers = await w.oidcHeaders();
  for (const key of ['subscribers.json', '../subscribers.json', 'unknown_TEST', '%73ubscribers.json', '%2573ubscribers.json']) {
    for (const [handler, route, method] of [[h.upload, '/api/upload-bundle', 'PUT'], [h.getObject, '/api/get-object', 'GET']]) {
      const before = w.r2.ops.length;
      const response = await w.call(handler, `${route}?key=${key}`, { method, headers, ...(method === 'PUT' ? { body: '{}' } : {}) });
      assert.equal(response.status, 400, key);
      assert.equal(w.r2.ops.length, before, key);
    }
  }
}));

for (const key of ['constructor', 'toString', '__proto__']) {
  test(`I22 upload own-key allowlist rejects inherited property ${key} before put`,
    { todo: 'C17: prototype-inclusive in check admits undeclared property names at the gate' },
    () => scenario(async (w, h) => {
      const headers = await w.oidcHeaders();
      const before = puts(w).length;
      const response = await w.call(h.upload, `/api/upload-bundle?key=${encodeURIComponent(key)}`,
        { method: 'PUT', headers, body: 'SYNTHETIC_TEST' });
      assert.equal(puts(w).length, before, 'undeclared key must never reach put, even if storage rejects its metadata');
      assert.equal(response.status, 400);
    }));
}

test('I22 get-object strict Set rejects prototype property names', () => scenario(async (w, h) => {
  const headers = await w.oidcHeaders();
  for (const key of ['constructor', 'toString', '__proto__']) {
    const before = w.r2.ops.length;
    const response = await w.call(h.getObject, `/api/get-object?key=${key}`, { headers });
    assert.equal(response.status, 400);
    assert.equal(w.r2.ops.length, before);
  }
}));

test('I22 upload method and byte limits reject before put', () => scenario(async (w, h) => {
  const headers = await w.oidcHeaders();
  const before = puts(w).length;
  assert.equal((await w.call(h.upload, '/api/upload-bundle?key=latest-weekly.zip', { method: 'GET' })).status, 405);
  assert.equal((await w.call(h.upload, '/api/upload-bundle?key=latest-weekly.zip', { method: 'PUT', headers, body: '' })).status, 400);
  assert.equal((await w.call(h.upload, '/api/upload-bundle?key=latest-weekly.zip',
    { method: 'PUT', headers, body: Buffer.alloc(25 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(puts(w).length, before);
}));

for (const [key, body] of [['latest-weekly.zip', 'NOT_A_ZIP_TEST'], ['refresh-status.json', '{INVALID_JSON_TEST']]) {
  test(`I23 invalid ${key} bytes cannot replace a published artifact`,
    { todo: 'C18: publication endpoint validates byte length but not artifact content' },
    () => scenario(async (w, h) => {
      const headers = await w.oidcHeaders();
      const before = puts(w).length;
      const response = await w.call(h.upload, `/api/upload-bundle?key=${key}`, { method: 'PUT', headers, body });
      assert.ok(response.status >= 400 && response.status < 500);
      assert.equal(puts(w).length, before);
    }));
}

test('I23 stale conditional upload cannot replace a newer object unnoticed',
  { todo: 'C18: upload does not forward or enforce the caller conditional write precondition' },
  () => scenario(async (w, h) => {
    const headers = { ...(await w.oidcHeaders()), 'If-Match': 'obsolete_ETAG_TEST' };
    const before = puts(w).length;
    const response = await w.call(h.upload, '/api/upload-bundle?key=latest-weekly.zip',
      { method: 'PUT', headers, body: MONTHLY });
    assert.ok([409, 412].includes(response.status), 'conflict must be visible');
    assert.equal(puts(w).length, before);
    assert.deepEqual(await bytes(await w.call(h.download, `/api/my-leads?t=${TOKEN}`)), WEEKLY);
  }));

test('I25 missing or malformed service JWT is rejected before storage effects', () => scenario(async (w, h) => {
  for (const headers of [{}, { authorization: 'Bearer malformed_TEST' }]) {
    for (const [handler, path, method] of [[h.upload, '/api/upload-bundle?key=latest-weekly.zip', 'PUT'],
      [h.getObject, '/api/get-object?key=source-health.json', 'GET']]) {
      const before = w.r2.ops.length;
      const response = await w.call(handler, path, { method, headers, ...(method === 'PUT' ? { body: WEEKLY } : {}) });
      assert.equal(response.status, 401);
      assert.equal(w.r2.ops.length, before);
    }
  }
}));

for (const [label, claims] of [
  ['issuer', { iss: 'https://issuer.invalid' }], ['audience', { aud: 'wrong-audience_TEST' }],
  ['repository', { repository: 'synthetic/other_TEST' }], ['ref', { ref: 'refs/heads/other_TEST' }],
  ['expiry', { exp: Math.floor(NOW / 1000) - 1 }],
]) {
  test(`I25 correctly signed JWT with wrong ${label} is rejected before storage`, () => scenario(async (w, h) => {
    const headers = await w.oidcHeaders({ claims });
    const before = w.r2.ops.length;
    const response = await w.call(h.upload, '/api/upload-bundle?key=latest-weekly.zip',
      { method: 'PUT', headers, body: WEEKLY });
    assert.equal(response.status, 401);
    assert.equal(w.r2.ops.length, before);
  }));
}

test('I25 tampered JWT signature cannot authorize a storage write', () => scenario(async (w, h) => {
  const headers = { ...(await w.oidcHeaders()) };
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
  assert.ok(key);
  const parts = headers[key].split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  headers[key] = parts.join('.');
  const before = w.r2.ops.length;
  const response = await w.call(h.upload, '/api/upload-bundle?key=latest-weekly.zip',
    { method: 'PUT', headers, body: WEEKLY });
  assert.equal(response.status, 401);
  assert.equal(w.r2.ops.length, before);
}));

test('I25 noncanonical host cannot reach paid portal/download handlers', () => scenario(async (w, h) => {
  for (const [host, path] of [['preview.invalid', '/leads'], ['preview.invalid', '/leads/out'],
    ['preview.invalid', '/api/my-leads'], ['www.masspermits.com', '/leads']]) {
    let nextCalls = 0;
    const before = w.r2.ops.length;
    const response = await h.middleware({ request: w.request(`https://${host}${path}`), env: w.env,
      next: async () => { nextCalls++; return new Response('NEXT_TEST'); } });
    assert.equal(response.status, 404);
    assert.equal(nextCalls, 0);
    assert.equal(w.r2.ops.length, before);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  }
}));

test('I25 canonical hostname passes middleware but does not itself grant token access', () => scenario(async (w, h) => {
  let nextCalls = 0;
  const request = w.request('https://masspermits.com/leads');
  const response = await h.middleware({ request, env: w.env, next: async () => {
    nextCalls++;
    return w.call(h.portal, '/leads');
  } });
  assert.equal(nextCalls, 1);
  assert.equal(response.status, 403);
  privatePage(response);
}));

test('I20 valid empty roster remains a denial and absent ZIP remains not-ready', () => withWorld(async (w) => {
  const h = await loadHandlers();
  await w.r2.set('subscribers.json', []);
  assert.equal((await w.call(h.download, `/api/my-leads?t=${TOKEN}`)).status, 403);
  assert.equal((await w.call(h.portal, `/leads?t=${TOKEN}`)).status, 403);
  await w.r2.set('subscribers.json', [row()]);
  const response = await w.call(h.download, `/api/my-leads?t=${TOKEN}`);
  assert.equal(response.status, 404);
  assert.equal(w.r2.json('subscribers.json')[0].active, true);
}, { now: NOW }));
