import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadHandlers, withWorld, TEST_JWK, REPO } from '../harness/index.mjs';

// Passing contracts only. Policy/known-defect TODOs stay in their existing files.
const h = await loadHandlers();
// loadHandlers validated this source root before this namespace import.
const portalModule = await import(pathToFileURL(resolve(process.env.REVENUE_SOURCE_ROOT || REPO,
  'functions/leads.js')).href);
assert.equal(portalModule.onRequestGet, h.portal);
const portalHead = portalModule.onRequestHead;
const DAY = 86400_000;
const HOUR = 3600_000;
const TOKEN = 'a'.repeat(32);
const UNKNOWN = 'b'.repeat(32);
const GITHUB_JWKS = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const ACCESS_JWKS = 'https://test.cloudflareaccess.com/cdn-cgi/access/certs';
const OTHER_ACCESS_JWKS = 'https://rotation-test.cloudflareaccess.com/cdn-cgi/access/certs';
const CERT_URLS = new Set([GITHUB_JWKS, ACCESS_JWKS, OTHER_ACCESS_JWKS]);
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ROTATED_JWK = { ...publicKey.export({ format: 'jwk' }),
  kid: 'rotated_ACCESS_TEST', alg: 'RS256', use: 'sig' };
let nextClock = Date.parse('2026-09-28T14:00:00.000Z');

function scenario(name, run) {
  const now = nextClock;
  nextClock += 2 * DAY; // Auth caches survive imports; each world starts later.
  test(name, { concurrency: false }, async () => withWorld(w => run(w), { now }));
}
const iso = ms => new Date(ms).toISOString();
const puts = (w, prefix) => w.r2.ops.filter(op => op.op === 'put' && op.key.startsWith(prefix));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function zip(label) {
  const comment = Buffer.from(label);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([end, comment]);
}
const WEEKLY = zip('WEEKLY_ACCESS_TEST');
const MONTHLY = zip('MONTHLY_ACCESS_TEST');
const HTML = '<!doctype html><html><head><title>town-a TEST</title></head><body>' +
  '<span class="fresh">BUNDLED_TIMESTAMP_TEST</span>' +
  '<table id="permits"><tr><td>ROW_ACCESS_TEST</td></tr></table></body></html>';
function seed(w, row = {}) {
  w.r2.set('subscribers.json', [{ token: TOKEN, active: true, email: 'casey@example.com',
    name: 'Casey TEST', customer: 'cus_ACCESS_MUTATION_TEST', since: '2026-09-01', ...row }]);
  w.r2.set('latest-weekly.zip', WEEKLY, { uploaded: new Date(w.now) });
  w.r2.set('latest-monthly.zip', MONTHLY, { uploaded: new Date(w.now) });
  w.r2.set('latest-weekly.html', HTML, { uploaded: new Date(w.now) });
  w.r2.set('refresh-status.json', { ok: true, ran_at: iso(w.now - DAY) });
}
function privatePage(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.match(response.headers.get('x-robots-tag') || '', /noindex.*nofollow.*noarchive.*nosnippet/);
}
function eventKey(key, prefix, now) {
  assert.match(key, new RegExp('^' + prefix + '/' + iso(now).slice(0, 10) +
    '/' + now + '-[0-9a-f]{8}$'));
}
function portalRequest(w, headers = {}) {
  return w.request('/leads', { headers: { cookie: 'mp_sess=' + TOKEN, ...headers } });
}
async function oidcRequest(w, options = {}) {
  return w.request('/api/get-object?key=source-health.json', { headers: await w.oidcHeaders(options) });
}
async function accessToken(w, claims = {}, header = {}) {
  return (await w.oidcHeaders({ claims: { iss: 'https://test.cloudflareaccess.com',
    aud: 'aud_TEST_only', email: 'casey@example.com', ...claims }, header })).authorization.slice(7);
}
function accessRequest(w, token) {
  return w.request('/admin/mission', { headers: { 'cf-access-jwt-assertion': token } });
}
function signRotated(payload) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: ROTATED_JWK.kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = head + '.' + body;
  return unsigned + '.' + createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
}
function payloadOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}
function serveCertificates(w, answer) {
  const closedFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!CERT_URLS.has(url)) return closedFetch(input, init);
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    assert.equal(method, 'GET');
    w.fetchCalls.push({ url, method });
    const value = await answer(url);
    return value instanceof Response ? value :
      new Response(JSON.stringify({ keys: value }), { headers: { 'content-type': 'application/json' } });
  };
}
const certCalls = (w, url) => w.fetchCalls.filter(call => call.url === url).length;

scenario('S7 I19 download bytes, UTC filename and minimal device telemetry agree for both tiers', async w => {
  seed(w);
  for (const [tier, agent, device, expected] of [
    ['weekly', 'Desktop_BROWSER_TEST', 'd', WEEKLY],
    ['monthly', 'Mobile iPhone_BROWSER_TEST', 'm', MONTHLY],
  ]) {
    const before = puts(w, 'dl/').length;
    const response = await w.call(h.download, '/api/my-leads?t=' + TOKEN + '&k=' + tier,
      { headers: { 'user-agent': agent } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'),
      'attachment; filename="MassPermits-' + tier + '-' + iso(w.now).slice(0, 10) + '.zip"');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    const written = puts(w, 'dl/').slice(before);
    assert.equal(written.length, 1);
    eventKey(written[0].key, 'dl', w.now);
    const event = await w.r2.get(written[0].key);
    assert.equal(event.size, 0);
    assert.deepEqual(event.customMetadata, { t: TOKEN.slice(0, 8), k: tier, d: device });
  }
});

scenario('S7 I19 bot link scanners receive their authorized file without download telemetry', async w => {
  seed(w);
  const response = await w.call(h.download, '/api/my-leads?t=' + TOKEN,
    { headers: { 'user-agent': 'PreviewBot_BROWSER_TEST' } });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEEKLY);
  assert.equal(puts(w, 'dl/').length, 0);
});

scenario('S7 I19 inactive and missing-file clicks keep distinct minimal telemetry', async w => {
  seed(w, { active: false });
  const inactive = await w.call(h.download, '/api/my-leads?t=' + TOKEN);
  assert.equal(inactive.status, 403);
  assert.deepEqual((await w.r2.get(puts(w, 'dl/')[0].key)).customMetadata,
    { r: 'inactive', t: TOKEN.slice(0, 8) });
  seed(w);
  await w.r2.delete('latest-weekly.zip');
  const missing = await w.call(h.download, '/api/my-leads?t=' + TOKEN);
  assert.equal(missing.status, 404);
  assert.equal(puts(w, 'dl/').length, 2);
  assert.deepEqual((await w.r2.get(puts(w, 'dl/')[1].key)).customMetadata,
    { r: 'no_file', t: TOKEN.slice(0, 8), k: 'weekly' });
});

scenario('S7 I19 unknown-token telemetry is capped without suppressing known subscriber evidence', async w => {
  seed(w);
  for (let i = 0; i < 205; i++) {
    assert.equal((await w.call(h.download, '/api/my-leads?t=' + UNKNOWN)).status, 403);
  }
  const unmatched = puts(w, 'dl/');
  assert.equal(unmatched.length, 200);
  for (const op of unmatched) {
    eventKey(op.key, 'dl', w.now);
    assert.deepEqual((await w.r2.get(op.key)).customMetadata, { r: 'no_match' });
  }
  const accepted = await w.call(h.download, '/api/my-leads?t=' + TOKEN);
  assert.equal(accepted.status, 200);
  assert.equal(puts(w, 'dl/').length, 201);
  assert.deepEqual((await w.r2.get(puts(w, 'dl/')[200].key)).customMetadata,
    { t: TOKEN.slice(0, 8), k: 'weekly', d: 'd' });
});

scenario('S7 I19 download waitUntil remains pending for deferred telemetry without delaying file response', async w => {
  seed(w);
  const originalPut = w.r2.put.bind(w.r2);
  let release, complete, entered = false, backgroundSettled = false;
  const gate = new Promise(resolve => { release = resolve; });
  const done = new Promise(resolve => { complete = resolve; });
  w.r2.put = async (...args) => {
    entered = true;
    await gate;
    try { return await originalPut(...args); } finally { complete(); }
  };
  const pending = [];
  try {
    const response = await h.download({ request: w.request('/api/my-leads?t=' + TOKEN),
      env: w.env, waitUntil(promise) { pending.push(Promise.resolve(promise)); } });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEEKLY);
    assert.equal(pending.length, 1);
    Promise.all(pending).then(() => { backgroundSettled = true; });
    await tick();
    assert.equal(entered, true);
    assert.equal(backgroundSettled, false);
    release();
    await done;
    await Promise.all(pending);
    assert.equal(puts(w, 'dl/').length, 1);
  } finally {
    release();
    if (entered) await done;
    await Promise.allSettled(pending);
  }
});

scenario('S7 I19 missing waitUntil does not break an authorized download', async w => {
  seed(w);
  const response = await h.download({ request: w.request('/api/my-leads?t=' + TOKEN), env: w.env });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), WEEKLY);
});

scenario('S7 I22 declared reader key absent from storage returns an empty 404 object', async w => {
  const response = await w.call(h.getObject, await oidcRequest(w));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), {});
});

scenario('S7 I22 authorized upload acknowledges exact persisted bytes', async w => {
  const body = JSON.stringify({ ok: true, ran_at: iso(w.now), sources: { 'town-a': 1 } });
  const response = await w.call(h.upload, '/api/upload-bundle?key=refresh-status.json',
    { method: 'PUT', headers: await w.oidcHeaders(), body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(),
    { ok: true, key: 'refresh-status.json', bytes: Buffer.byteLength(body) });
  assert.equal(w.r2.text('refresh-status.json'), body);
});

scenario('S7 I22 failed upload storage cannot claim successful acknowledgment', async w => {
  w.r2.failNext('put', 'refresh-status.json');
  const response = await w.call(h.upload, '/api/upload-bundle?key=refresh-status.json',
    { method: 'PUT', headers: await w.oidcHeaders(), body: '{"ok":true}' });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
  assert.equal(await w.r2.get('refresh-status.json'), null);
  // Do not assert raw error text: that would pin the separate privacy finding.
});

scenario('S7 I22 upload acknowledgment waits for storage completion', async w => {
  const originalPut = w.r2.put.bind(w.r2);
  let release, reached, entered = false, settled = false;
  const gate = new Promise(resolve => { release = resolve; });
  const enteredPut = new Promise(resolve => { reached = resolve; });
  w.r2.put = async (...args) => {
    entered = true;
    reached();
    await gate;
    return originalPut(...args);
  };
  const request = w.request('/api/upload-bundle?key=refresh-status.json',
    { method: 'PUT', headers: await w.oidcHeaders(), body: '{"ok":true}' });
  const pending = w.call(h.upload, request).then(response => { settled = true; return response; });
  try {
    await Promise.race([enteredPut, pending]);
    await tick();
    assert.equal(entered, true);
    assert.equal(settled, false);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(w.r2.text('refresh-status.json'), '{"ok":true}');
  } finally {
    release();
    await pending.catch(() => {});
  }
});

scenario('S7 I25 GitHub algorithm and malformed expiry claims fail before storage', async w => {
  for (const options of [
    { header: { alg: 'HS256' } },
    { claims: { exp: String(Math.floor(w.now / 1000) + 300) } },
    { claims: { exp: Math.floor(w.now / 1000) } },
    { claims: { aud: { value: 'masspermits-cron' } } },
  ]) {
    const response = await w.call(h.getObject, await oidcRequest(w, options));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'unauthorized');
  }
  assert.equal(w.r2.ops.length, 0);
  assert.equal(w.fetchCalls.length, 0);
  const accepted = await h.githubOIDC.verifyGitHubOIDC(await oidcRequest(w,
    { claims: { aud: ['unrelated_TEST', 'masspermits-cron'] } }));
  assert.equal(accepted.ok, true);
});

scenario('S7 I25 Access rejects typed-invalid or expired claims and accepts audience arrays', async w => {
  for (const claims of [
    { exp: String(Math.floor(w.now / 1000) + 300) },
    { exp: Math.floor(w.now / 1000) },
    { aud: { value: 'aud_TEST_only' } },
  ]) {
    const result = await h.cfAccess.verifyCfAccess(accessRequest(w, await accessToken(w, claims)), w.env);
    assert.equal(result.ok, false);
  }
  assert.equal(w.fetchCalls.length, 0);
  const accepted = await h.cfAccess.verifyCfAccess(accessRequest(w,
    await accessToken(w, { aud: ['unrelated_TEST', 'aud_TEST_only'] })), w.env);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.email, 'casey@example.com');
});

scenario('S7 I25 structurally malformed signed claims stay denied by both verifiers', async w => {
  const signedNull = signRotated(null);
  const github = await h.githubOIDC.verifyGitHubOIDC(w.request('/api/get-object',
    { headers: { authorization: 'Bearer ' + signedNull } }));
  const access = await h.cfAccess.verifyCfAccess(accessRequest(w, signedNull), w.env);
  assert.equal(github.ok, false);
  assert.equal(access.ok, false);
  assert.equal(w.fetchCalls.length, 0);
  assert.equal(w.r2.ops.length, 0);
});

scenario('S7 I25 GitHub cached certificates are reused and refreshed after their lifetime', async w => {
  serveCertificates(w, () => [TEST_JWK]);
  assert.equal((await h.githubOIDC.verifyGitHubOIDC(await oidcRequest(w))).ok, true);
  assert.equal(certCalls(w, GITHUB_JWKS), 1);
  assert.equal((await h.githubOIDC.verifyGitHubOIDC(await oidcRequest(w))).ok, true);
  assert.equal(certCalls(w, GITHUB_JWKS), 1);
  w.setNow(w.now + HOUR + 1);
  assert.equal((await h.githubOIDC.verifyGitHubOIDC(await oidcRequest(w))).ok, true);
  assert.equal(certCalls(w, GITHUB_JWKS), 2);
});

scenario('S7 I25 GitHub key rotation recovers through fresh signed certificates', async w => {
  let keys = [TEST_JWK];
  serveCertificates(w, () => keys);
  assert.equal((await h.githubOIDC.verifyGitHubOIDC(await oidcRequest(w))).ok, true);
  keys = [ROTATED_JWK];
  const original = (await w.oidcHeaders()).authorization.slice(7);
  const rotated = signRotated(payloadOf(original));
  const request = w.request('/api/get-object', { headers: { authorization: 'Bearer ' + rotated } });
  let result = await h.githubOIDC.verifyGitHubOIDC(request);
  if (!result.ok) {
    assert.equal(result.reason, 'kid');
    result = await h.githubOIDC.verifyGitHubOIDC(request);
  }
  assert.equal(result.ok, true);
  assert.equal(certCalls(w, GITHUB_JWKS), 2);
  assert.equal((await h.githubOIDC.verifyGitHubOIDC(await oidcRequest(w))).ok, false);
});

scenario('S7 I25 unavailable certificate services fail closed without storage effects', async w => {
  serveCertificates(w, () => new Response('TEMPORARY_CERT_TEST', { status: 503 }));
  const github = await w.call(h.getObject, await oidcRequest(w));
  assert.equal(github.status, 401);
  const access = await h.cfAccess.verifyCfAccess(accessRequest(w, await accessToken(w)), w.env);
  assert.equal(access.ok, false);
  assert.equal(w.r2.ops.length, 0);
  assert.equal(w.mail.length, 0);
});

scenario('S7 I25 Access certificate cache refreshes with time and isolates issuers', async w => {
  serveCertificates(w, url => url === OTHER_ACCESS_JWKS ? [ROTATED_JWK] : [TEST_JWK]);
  assert.equal((await h.cfAccess.verifyCfAccess(accessRequest(w, await accessToken(w)), w.env)).ok, true);
  assert.equal((await h.cfAccess.verifyCfAccess(accessRequest(w, await accessToken(w)), w.env)).ok, true);
  assert.equal(certCalls(w, ACCESS_JWKS), 1);
  w.setNow(w.now + HOUR + 1);
  assert.equal((await h.cfAccess.verifyCfAccess(accessRequest(w, await accessToken(w)), w.env)).ok, true);
  assert.equal(certCalls(w, ACCESS_JWKS), 2);
  const otherEnv = { ...w.env, CF_ACCESS_TEAM_DOMAIN: 'rotation-test.cloudflareaccess.com' };
  const payload = payloadOf(await accessToken(w, { iss: 'https://rotation-test.cloudflareaccess.com' }));
  assert.equal((await h.cfAccess.verifyCfAccess(accessRequest(w, signRotated(payload)), otherEnv)).ok, true);
  assert.equal(certCalls(w, OTHER_ACCESS_JWKS), 1);
});

scenario('S7 I25 Access key rotation recovers without accepting the removed key', async w => {
  let keys = [TEST_JWK];
  serveCertificates(w, () => keys);
  assert.equal((await h.cfAccess.verifyCfAccess(accessRequest(w, await accessToken(w)), w.env)).ok, true);
  keys = [ROTATED_JWK];
  const token = signRotated(payloadOf(await accessToken(w)));
  let result = await h.cfAccess.verifyCfAccess(accessRequest(w, token), w.env);
  if (!result.ok) {
    assert.equal(result.reason, 'kid');
    result = await h.cfAccess.verifyCfAccess(accessRequest(w, token), w.env);
  }
  assert.equal(result.ok, true);
  assert.equal(certCalls(w, ACCESS_JWKS), 2);
  assert.equal((await h.cfAccess.verifyCfAccess(accessRequest(w, await accessToken(w)), w.env)).ok, false);
});

scenario('S7 I25 Access audience denial supplies the specific configuration remedy privately', async () => {
  const response = h.cfAccess.accessDenied({ reason: 'aud' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  const body = await response.text();
  assert.match(body, /audience does not match CF_ACCESS_AUD/);
  assert.match(body, /reason: <code>aud<\/code>/);
});

scenario('S7 I19 I25 complete portal applies publication metadata and structured private-page injection', async w => {
  seed(w);
  const request = portalRequest(w, { 'user-agent': 'Mobile iPhone_BROWSER_TEST' });
  Object.defineProperty(request, 'cf', { value: { country: 'US' } });
  const response = await w.call(h.portal, request);
  assert.equal(response.status, 200);
  privatePage(response);
  const body = await response.text();
  assert.match(body, /<table id="permits">/);
  assert.match(body, /ROW_ACCESS_TEST/);
  assert.ok(body.includes('Data refreshed ' + iso(w.now - DAY).slice(0, 10) + '.'));
  assert.ok(body.includes('This page published ' + iso(w.now).slice(0, 10) + '.'));
  assert.ok(body.includes('published ' + iso(w.now).slice(0, 10)));
  assert.doesNotMatch(body, /BUNDLED_TIMESTAMP_TEST|We cannot fully confirm/);
  const head = body.match(/<head>([\s\S]*?)<\/head>/)[1];
  assert.match(head, /<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/);
  assert.match(head, /<style>/);
  assert.doesNotMatch(head, /&lt;meta|&lt;style/);
  assert.doesNotMatch(body, new RegExp(TOKEN + '|example\\.com'));
  const written = puts(w, 'portal-access/');
  assert.equal(written.length, 1);
  eventKey(written[0].key, 'portal-access', w.now);
  assert.deepEqual((await w.r2.get(written[0].key)).customMetadata,
    { tok: TOKEN.slice(0, 8), ua: 'mobile', st: 'ok', cc: 'US' });
});

scenario('S7 I26 portal watermark bounds the local identifier and omits the email domain', async w => {
  seed(w, { email: 'x'.repeat(40) + 'Z_PRIVATE_TEST@example.com' });
  const response = await w.call(h.portal, portalRequest(w));
  privatePage(response);
  const body = await response.text();
  assert.ok(body.includes('Licensed to <b>' + 'x'.repeat(40) + '@&hellip;</b>'));
  assert.doesNotMatch(body, /Z_PRIVATE_TEST|example\.com/);
});

scenario('S7 I20 missing portal roster returns private unavailability without artifact reads', async w => {
  const response = await w.call(h.portal, '/leads?t=' + TOKEN);
  assert.equal(response.status, 503);
  privatePage(response);
  assert.match(await response.text(), /problem on our side, not with your subscription/);
  assert.equal(w.r2.ops.filter(op => /^latest-/.test(op.key)).length, 0);
});

scenario('S7 I21 CURRENT until D4: stale portal explains its known age and records red telemetry without reading rows', async w => {
  seed(w);
  const old = w.now - 9 * DAY;
  w.r2.set('latest-weekly.html', HTML, { uploaded: new Date(old) });
  w.r2.set('refresh-status.json', { ok: true, ran_at: iso(old) });
  const response = await w.call(h.portal, portalRequest(w));
  assert.equal(response.status, 200);
  privatePage(response);
  const body = await response.text();
  assert.match(body, /<b>9 days old<\/b>/);
  assert.doesNotMatch(body, /ROW_ACCESS_TEST|cannot confirm how old/);
  assert.equal(w.r2.ops.filter(op => op.op === 'get' && op.key === 'latest-weekly.html').length, 0);
  const written = puts(w, 'portal-access/');
  assert.equal(written.length, 1);
  eventKey(written[0].key, 'portal-access', w.now);
  assert.deepEqual((await w.r2.get(written[0].key)).customMetadata,
    { tok: TOKEN.slice(0, 8), ua: 'desktop', st: 'red' });
});

scenario('S7 I21 portal drift notices respect the display threshold and retain accurate units', async w => {
  seed(w);
  for (const [gap, expected] of [
    [15 * 60_000, null],
    [15 * 60_000 + 1, '15 minutes apart'],
    [45 * 60_000, '45 minutes apart'],
    [3 * HOUR, '3 hours apart'],
  ]) {
    w.r2.set('latest-weekly.zip', WEEKLY, { uploaded: new Date(w.now - gap) });
    const response = await w.call(h.portal, portalRequest(w));
    privatePage(response);
    const body = await response.text();
    if (expected) {
      assert.match(body, /This page and your download may disagree/);
      assert.ok(body.includes(expected));
    } else assert.doesNotMatch(body, /This page and your download may disagree/);
  }
});

scenario('S7 I21 portal coverage disclosure uses supplied numeric counts and escaped source labels', async w => {
  seed(w);
  w.r2.set('refresh-status.json', { ok: true, ran_at: iso(w.now - DAY),
    coverage: { disclose: true, live_sources: 1, expected_sources: 2,
      monthly_sources: ['town-a, MA', '<town-b_TEST>, MA'] } });
  const response = await w.call(h.portal, portalRequest(w));
  privatePage(response);
  const body = await response.text();
  assert.match(body, /Reduced coverage: please read/);
  assert.match(body, /<b>1 of 2<\/b> town sources/);
  assert.match(body, /town-a, &lt;town-b_TEST&gt; publish their permits <b>monthly or less often<\/b>/);
  assert.match(body, /batches when each town publishes, not every week\. Every row shows its date\./);
  assert.doesNotMatch(body, /<town-b_TEST>|real and current|(?:early|current) each month|issue date/i);
  assert.match(body, /ROW_ACCESS_TEST/);
});

scenario('S7 exhaustive I25 malformed GitHub JWT encodings reject before any storage or fetch', async w => {
  const valid = (await w.oidcHeaders()).authorization.slice(7).split('.');
  const brokenJSON = Buffer.from('{INVALID_TEST').toString('base64url');
  const malformed = [
    'single_part_TEST', 'a.b.c.d', brokenJSON + '.' + valid[1] + '.' + valid[2],
    valid[0] + '.' + brokenJSON + '.' + valid[2],
  ];
  for (const token of malformed) {
    const request = w.request('/api/get-object?key=source-health.json',
      { headers: { authorization: 'Bearer ' + token } });
    assert.equal((await h.githubOIDC.verifyGitHubOIDC(request)).ok, false);
    assert.equal((await w.call(h.getObject, request)).status, 401);
  }
  assert.equal(w.r2.ops.length, 0);
  assert.equal(w.fetchCalls.length, 0);
  assert.equal(w.mail.length, 0);
});

scenario('S7 exhaustive I25 missing and malformed Access assertions have false authorization', async w => {
  const valid = (await accessToken(w)).split('.');
  const brokenJSON = Buffer.from('{INVALID_TEST').toString('base64url');
  const requests = [
    w.request('/admin/mission'),
    accessRequest(w, ''),
    accessRequest(w, 'single_part_TEST'),
    accessRequest(w, 'a.b.c.d'),
    accessRequest(w, brokenJSON + '.' + valid[1] + '.' + valid[2]),
    accessRequest(w, valid[0] + '.' + brokenJSON + '.' + valid[2]),
    w.request('/admin/mission', { headers: { cookie: 'CF_Authorization=malformed_TEST' } }),
  ];
  for (const request of requests) {
    const result = await h.cfAccess.verifyCfAccess(request, w.env);
    assert.equal(result.ok, false);
    assert.equal(h.cfAccess.accessDenied(result).status, 403);
  }
  assert.equal(w.r2.ops.length, 0);
  assert.equal(w.fetchCalls.length, 0);
  assert.equal(w.mail.length, 0);
});

scenario('S7 exhaustive I25 each missing Access configuration value fails before certificate lookup', async w => {
  for (const overrides of [
    { CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: '' },
    { CF_ACCESS_TEAM_DOMAIN: '' },
    { CF_ACCESS_AUD: '' },
  ]) {
    const env = { ...w.env, ...overrides };
    const request = accessRequest(w, await accessToken(w,
      env.CF_ACCESS_AUD ? {} : { aud: '' }));
    const result = await h.cfAccess.verifyCfAccess(request, env);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-configured');
  }
  assert.equal(w.r2.ops.length, 0);
  assert.equal(w.fetchCalls.length, 0);
  assert.equal(w.mail.length, 0);
});

scenario('S7 exhaustive I25 Access common-name identity survives a valid token without email', async w => {
  const result = await h.cfAccess.verifyCfAccess(accessRequest(w,
    await accessToken(w, { email: null, common_name: 'casey@example.com' })), w.env);
  assert.equal(result.ok, true);
  assert.equal(result.email, 'casey@example.com');
  assert.equal(w.r2.ops.length, 0);
  assert.equal(w.mail.length, 0);
});

scenario('S7 exhaustive I25 Access missing-assertion remedy is distinct from ordinary sign-in rejection', async () => {
  const missing = h.cfAccess.accessDenied({ ok: false, reason: 'no-assertion' });
  const rejected = h.cfAccess.accessDenied({ ok: false, reason: 'iss' });
  assert.equal(missing.status, 403);
  assert.equal(rejected.status, 403);
  assert.match(await missing.text(), /No Cf-Access-Jwt-Assertion reached the origin/);
  const other = await rejected.text();
  assert.match(other, /Sign in through Cloudflare Access and retry/);
  assert.doesNotMatch(other, /No Cf-Access-Jwt-Assertion reached the origin/);
});

scenario('S7 exhaustive I19 I25 real portal HEAD retains GET access status and private headers with no body', async w => {
  seed(w);
  const cases = [
    ['/leads', {}, 403],
    ['/leads?t=malformed_TEST', {}, 400],
    ['/leads?t=' + TOKEN, {}, 302],
    ['/leads', { cookie: 'mp_sess=' + TOKEN }, 200],
  ];
  for (const [path, headers, status] of cases) {
    const response = await w.call(portalHead, path, { method: 'HEAD', headers });
    assert.equal(response.status, status);
    privatePage(response);
    assert.equal(response.body, null);
    assert.equal(await response.text(), '');
    if (status === 302) {
      assert.equal(response.headers.get('location'), '/leads');
      assert.match(response.headers.get('set-cookie') || '', /HttpOnly; Secure; SameSite=Lax/);
    }
  }
  seed(w, { active: false });
  const revoked = await w.call(portalHead, '/leads',
    { method: 'HEAD', headers: { cookie: 'mp_sess=' + TOKEN } });
  assert.equal(revoked.status, 403);
  privatePage(revoked);
  assert.equal(revoked.body, null);
  assert.equal(puts(w, 'portal-access/').length, 0);
});

scenario('S7 exhaustive I20 portal handles asynchronous metadata lookup rejection as a controlled response', async w => {
  for (const key of ['latest-weekly.html', 'latest-weekly.zip']) {
    seed(w);
    w.r2.failNext('head', key, new Error('ASYNC_HEAD_TEST'));
    const response = await w.call(h.portal, portalRequest(w));
    privatePage(response);
    assert.ok(response.status < 500 || response.status === 503);
    const body = await response.text();
    assert.doesNotMatch(body, /ASYNC_HEAD_TEST/);
    if (key.endsWith('.html')) assert.doesNotMatch(body, /ROW_ACCESS_TEST/);
  }
  // This contract does not choose whether a missing-HTML fallback may serve a stale ZIP.
});

scenario('S7 exhaustive I20 missing ZIP metadata cannot turn a fresh portal request into an exception', async w => {
  seed(w);
  await w.r2.delete('latest-weekly.zip');
  const response = await w.call(h.portal, portalRequest(w));
  privatePage(response);
  assert.ok(response.status < 500 || response.status === 503);
  await response.text();
  // No assertion approves missing-file availability or pins a particular fallback policy.
});

scenario('S7 exhaustive I21 incomplete refresh metadata discloses the remaining timestamp basis', async w => {
  for (const status of [null, {}, { ran_at: 'INVALID_DATE_TEST' }]) {
    seed(w);
    if (status === null) await w.r2.delete('refresh-status.json');
    else w.r2.set('refresh-status.json', status);
    const response = await w.call(h.portal, portalRequest(w));
    privatePage(response);
    const body = await response.text();
    assert.match(body, /We cannot fully confirm this page's freshness/);
    assert.match(body, /refresh record \(refresh-status.json\) is missing or unreadable/);
    assert.doesNotMatch(body, /This page's publish timestamp is unavailable/);
    assert.match(body, new RegExp('<span class="fresh"[^>]*>published ' + iso(w.now).slice(0, 10) + '</span>'));
  }
});

scenario('S7 exhaustive I19 inactive previews retain only available numeric aggregate counts', async w => {
  const cases = [
    [{ count: 1234, coverage: { live_sources: 3 } }, '1,234 permit records', '3 live town sources'],
    [{ count: 1234 }, '1,234 permit records', null],
    [{ coverage: { live_sources: 3 } }, 'our current corpus', '3 live town sources'],
    [{}, null, null],
    [{ count: '1234', coverage: { live_sources: '3' } }, null, null],
  ];
  for (const [status, rows, sources] of cases) {
    seed(w, { active: false });
    w.r2.set('refresh-status.json', status);
    const response = await w.call(h.portal, '/leads?t=' + TOKEN);
    assert.equal(response.status, 403);
    privatePage(response);
    const body = await response.text();
    if (rows) assert.ok(body.includes(rows));
    else assert.doesNotMatch(body, /permit records|our current corpus/);
    if (sources) assert.ok(body.includes(sources));
    else assert.doesNotMatch(body, /live town sources/);
    assert.doesNotMatch(body, /ROW_ACCESS_TEST|casey@example\.com/);
  }
  assert.equal(w.r2.ops.filter(op => op.op === 'get' && op.key === 'latest-weekly.html').length, 0);
  // Counts do not certify the separate wording about when the underlying records were filed.
});

scenario('S7 exhaustive I21 degraded coverage tolerates absent empty and non-list monthly metadata', async w => {
  for (const coverage of [null, { monthly_sources: [] }, { monthly_sources: null },
    { monthly_sources: 'NOT_LIST_TEST' }]) {
    seed(w);
    w.r2.set('refresh-status.json', { ran_at: iso(w.now), degraded: true, coverage });
    const response = await w.call(h.portal, portalRequest(w));
    privatePage(response);
    const body = await response.text();
    assert.match(body, /Reduced coverage: please read/);
    assert.match(body, /<b>fewer of our usual<\/b> town sources/);
    assert.doesNotMatch(body, /Note:|NOT_LIST_TEST/);
  }
});

scenario('S7 exhaustive I21 non-finite JSON coverage numbers use the unavailable-count wording', async w => {
  seed(w);
  // JSON.parse accepts an out-of-range numeric exponent as Infinity. JSON.stringify would erase this fixture.
  w.r2.set('refresh-status.json', '{"ran_at":"' + iso(w.now) +
    '","coverage":{"disclose":true,"live_sources":1e400,"expected_sources":1e400}}');
  const response = await w.call(h.portal, portalRequest(w));
  privatePage(response);
  const body = await response.text();
  assert.match(body, /<b>fewer of our usual<\/b> town sources/);
  assert.doesNotMatch(body, /Infinity|NaN/);
});

scenario('S7 exhaustive I19 portal country telemetry stays coarse even with malformed metadata', async w => {
  seed(w);
  const request = portalRequest(w);
  Object.defineProperty(request, 'cf', { value: { country: 'USextra_TEST' } });
  await (await w.call(h.portal, request)).text();
  const events = puts(w, 'portal-access/');
  assert.equal(events.length, 1);
  assert.deepEqual((await w.r2.get(events[0].key)).customMetadata,
    { tok: TOKEN.slice(0, 8), ua: 'desktop', st: 'ok', cc: 'US' });
});
