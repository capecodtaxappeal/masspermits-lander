// C18 optional preconditions: real handler, synthetic OIDC and closed network.
// Local workerd checks the R2 primitive separately; it is not a production probe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withWorld, loadHandlers, MemoryR2 } from '../harness/index.mjs';
import { Miniflare } from '../harness/platform.mjs';

const KEY = 'latest-weekly.zip';
const PATH = `/api/upload-bundle?key=${KEY}`;
function zipFixture(comment) {
  const note = Buffer.from(comment);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(note.length, 20);
  return Buffer.concat([end, note]);
}
const OLD = zipFixture('old_TEST');
const NEXT = zipFixture('next_TEST');
const OTHER = zipFixture('other_TEST');
const UPLOADS = [
  ['latest-monthly.zip', NEXT, 'application/zip'],
  ['latest-weekly.zip', NEXT, 'application/zip'],
  ['latest-sample.zip', NEXT, 'application/zip'],
  ['refresh-status.json', '{"ok":true,"marker":"TEST"}', 'application/json'],
  ['run-log.txt', 'log_TEST', 'text/plain'],
  ['cold-state.json', '{}', 'application/json'],
  ['cold-log.txt', 'log_TEST', 'text/plain'],
  ['source-health.json', '{}', 'application/json'],
  ['latest-weekly.html', '<!doctype html><html><body>town-a TEST</body></html>', 'text/html'],
];

function scenario(fn) {
  return withWorld(async (w) => {
    const h = await loadHandlers();
    const auth = await w.oidcHeaders();
    await fn(w, h.upload, auth);
    assert.equal(w.mail.length, 0);
    assert.ok(w.fetchCalls.every(({ url }) => url === 'https://token.actions.githubusercontent.com/.well-known/jwks'));
  });
}
async function snapshot(bucket, key = KEY) {
  const obj = await bucket.get(key);
  return obj && { bytes: Buffer.from(await obj.arrayBuffer()), etag: obj.etag,
    uploaded: obj.uploaded.getTime(), httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata };
}
async function seed(w) {
  w.r2.set(KEY, OLD, { uploaded: new Date('2026-09-28T12:00:00Z'),
    httpMetadata: { contentType: 'application/zip' }, customMetadata: { marker: 'TEST' } });
  return snapshot(w.r2);
}
function oneAttempt(w, start, onlyIf, key = KEY) {
  assert.deepEqual(w.r2.ops.slice(start), [{ op: 'put', key, onlyIf }],
    'one atomic put, no read-before-put and no unconditional fallback');
}
async function success(response, bytes, bucket = null, key = KEY) {
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, key, bytes: Buffer.byteLength(bytes) });
  if (bucket) {
    const stored = await snapshot(bucket, key);
    assert.deepEqual(stored.bytes, Buffer.from(bytes));
    assert.equal(response.headers.get('etag'), `"${stored.etag}"`);
  }
}

test('C18 I22 unconditional PUT and POST preserve every declared key, bytes, metadata and success JSON', () => scenario(async (w, upload, auth) => {
  for (const method of ['PUT', 'POST']) {
    for (const [key, body, contentType] of UPLOADS) {
      w.r2.set(key, 'previous_TEST');
      const start = w.r2.ops.length;
      const response = await w.call(upload, `/api/upload-bundle?key=${key}`, { method, headers: auth, body });
      oneAttempt(w, start, undefined, key);
      await success(response, body, null, key);
      const stored = await snapshot(w.r2, key);
      assert.deepEqual(stored.bytes, Buffer.from(body));
      assert.equal(stored.httpMetadata.contentType, contentType);
    }
  }
}));

for (const method of ['PUT', 'POST']) {
  test(`C18 I23 ${method} matching strong If-Match replaces bytes and returns the new ETag`, () => scenario(async (w, upload, auth) => {
    const old = await seed(w);
    const start = w.r2.ops.length;
    const response = await w.call(upload, PATH, { method,
      headers: { ...auth, 'If-Match': `"${old.etag}"` }, body: NEXT });
    oneAttempt(w, start, { etagMatches: old.etag });
    await success(response, NEXT, w.r2);
  }));
}

for (const [label, exists] of [['stale', true], ['missing object', false]]) {
  test(`C18 I23 ${label} If-Match returns 412 without changing stored bytes or ETag`, () => scenario(async (w, upload, auth) => {
    const before = exists ? await seed(w) : null;
    const start = w.r2.ops.length;
    const response = await w.call(upload, PATH, { method: 'PUT',
      headers: { ...auth, 'If-Match': '"obsolete_TEST"' }, body: NEXT });
    oneAttempt(w, start, { etagMatches: 'obsolete_TEST' });
    assert.equal(response.status, 412);
    assert.equal((await response.json()).ok, false);
    assert.equal(response.headers.get('etag'), null);
    assert.deepEqual(await snapshot(w.r2), before);
  }));
}

for (const [label, header, onlyIf, exists, status] of [
  ['If-Match wildcard on existing object', 'If-Match', { etagMatches: '*' }, true, 200],
  ['If-Match wildcard on absent object', 'If-Match', { etagMatches: '*' }, false, 412],
  ['If-None-Match wildcard creates absent object', 'If-None-Match', { etagDoesNotMatch: '*' }, false, 200],
  ['If-None-Match wildcard preserves existing object', 'If-None-Match', { etagDoesNotMatch: '*' }, true, 412],
]) {
  test(`C18 I23 ${label}`, () => scenario(async (w, upload, auth) => {
    const before = exists ? await seed(w) : null;
    const start = w.r2.ops.length;
    const response = await w.call(upload, PATH, { method: 'POST', headers: { ...auth, [header]: '*' }, body: NEXT });
    oneAttempt(w, start, onlyIf);
    assert.equal(response.status, status);
    if (status === 200) await success(response, NEXT, w.r2);
    else {
      assert.equal((await response.json()).ok, false);
      assert.deepEqual(await snapshot(w.r2), before);
    }
  }));
}

for (const [label, exists, matches, status] of [
  ['same tag', true, true, 412], ['different tag', true, false, 200], ['absent object', false, false, 200],
]) {
  test(`C18 I23 strong If-None-Match with ${label}`, () => scenario(async (w, upload, auth) => {
    const before = exists ? await seed(w) : null;
    const tag = matches ? before.etag : 'different_TEST';
    const start = w.r2.ops.length;
    const response = await w.call(upload, PATH, { method: 'PUT',
      headers: { ...auth, 'If-None-Match': `"${tag}"` }, body: NEXT });
    oneAttempt(w, start, { etagDoesNotMatch: tag });
    assert.equal(response.status, status);
    if (status === 200) await success(response, NEXT, w.r2);
    else {
      assert.equal((await response.json()).ok, false);
      assert.deepEqual(await snapshot(w.r2), before);
    }
  }));
}

test('C18 I23 surrounding header whitespace is ignored and an opaque ETag stays exact', () => scenario(async (w, upload, auth) => {
  const tag = 'opaque_TEST,back\\slash';
  w.r2.set(KEY, OLD, { etag: tag });
  const start = w.r2.ops.length;
  const response = await w.call(upload, PATH, { method: 'PUT',
    headers: { ...auth, 'iF-mAtCh': `  "${tag}"\t` }, body: NEXT });
  oneAttempt(w, start, { etagMatches: tag });
  await success(response, NEXT, w.r2);
}));

const REJECTED = [
  ['empty If-Match', { 'If-Match': '' }],
  ['empty If-None-Match', { 'If-None-Match': '' }],
  ['bare tag', { 'If-Match': 'obsolete_TEST' }],
  ['empty quoted tag', { 'If-Match': '""' }],
  ['weak If-Match', { 'If-Match': 'W/"tag_TEST"' }],
  ['weak If-None-Match', { 'If-None-Match': 'W/"tag_TEST"' }],
  ['tag list', { 'If-Match': '"one_TEST", "two_TEST"' }],
  ['wildcard list', { 'If-None-Match': '*, "tag_TEST"' }],
  ['quoted wildcard', { 'If-Match': '"*"' }],
  ['space inside tag', { 'If-Match': '"tag TEST"' }],
  ['embedded quote', { 'If-Match': '"tag"TEST"' }],
  ['both ETag preconditions', { 'If-Match': '*', 'If-None-Match': '"tag_TEST"' }],
  ['If-Modified-Since', { 'If-Modified-Since': 'Mon, 28 Sep 2026 12:00:00 GMT' }],
  ['If-Unmodified-Since', { 'If-Unmodified-Since': 'Mon, 28 Sep 2026 12:00:00 GMT' }],
  ['If-Range', { 'If-Range': '"tag_TEST"' }],
  ['ETag plus date precondition', { 'If-Match': '*', 'If-Unmodified-Since': 'Mon, 28 Sep 2026 12:00:00 GMT' }],
];
for (const [label, conditions] of REJECTED) {
  test(`C18 I23 unsupported ${label} fails before storage`, () => scenario(async (w, upload, auth) => {
    const before = await seed(w);
    const start = w.r2.ops.length;
    const response = await w.call(upload, PATH, { method: 'PUT', headers: { ...auth, ...conditions }, body: NEXT });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
    assert.equal(w.r2.ops.length, start);
    assert.deepEqual(await snapshot(w.r2), before);
  }));
}

test('C18 I23 two authorized writers with one base ETag have one winner and one unchanged-object conflict', () => scenario(async (w, upload, auth) => {
  const before = await seed(w);
  const start = w.r2.ops.length;
  const headers = { ...auth, 'If-Match': `"${before.etag}"` };
  const payloads = [NEXT, OTHER];
  const responses = await Promise.all(payloads.map(body => w.call(upload, PATH, { method: 'PUT', headers, body })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 412]);
  assert.deepEqual(w.r2.ops.slice(start), payloads.map(() => ({ op: 'put', key: KEY, onlyIf: { etagMatches: before.etag } })));
  const winner = responses.findIndex(r => r.status === 200);
  await success(responses[winner], payloads[winner], w.r2);
  assert.equal((await responses[1 - winner].json()).ok, false);
}));

test('C18 I23 conditional storage errors stay failures and never retry unconditionally', () => scenario(async (w, upload, auth) => {
  const before = await seed(w);
  w.r2.failNext('put', KEY, new Error('STORAGE_TEST'));
  const start = w.r2.ops.length;
  const response = await w.call(upload, PATH, { method: 'PUT',
    headers: { ...auth, 'If-Match': `"${before.etag}"` }, body: NEXT });
  oneAttempt(w, start, { etagMatches: before.etag });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
  assert.deepEqual(await snapshot(w.r2), before);
}));

test('C18 I22 preconditions do not bypass authorization, key, method or body limits', () => scenario(async (w, upload, auth) => {
  for (const [path, method, headers, body, status] of [
    [PATH, 'PUT', { 'If-Match': '*' }, NEXT, 401],
    ['/api/upload-bundle?key=subscribers.json', 'PUT', { ...auth, 'If-Match': '*' }, NEXT, 400],
    [PATH, 'DELETE', { ...auth, 'If-Match': '*' }, undefined, 405],
    [PATH, 'PUT', { ...auth, 'If-Match': '*' }, '', 400],
    [PATH, 'PUT', { ...auth, 'If-Match': '*' }, Buffer.alloc(25 * 1024 * 1024 + 1), 413],
  ]) {
    const start = w.r2.ops.length;
    const response = await w.call(upload, path, { method, headers, body });
    assert.equal(response.status, status);
    assert.equal(w.r2.ops.length, start);
  }
}));

test('C18 HARNESS supported R2 wildcard and strong-tag conditions agree with local workerd', async () => {
  let externalAttempts = 0;
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("TEST"); } };',
    compatibilityDate: '2026-07-01', r2Buckets: ['BUNDLES'], r2Persist: false, cf: false,
    outboundService: async () => { externalAttempts++; throw new Error('TEST external network forbidden'); } });
  async function trace(bucket) {
    const out = [];
    out.push(await bucket.put('absent-match_TEST', 'x', { onlyIf: { etagMatches: '*' } }) === null);
    out.push(await bucket.put('absent-tag_TEST', 'x', { onlyIf: { etagMatches: 'old_TEST' } }) === null);
    const first = await bucket.put('object_TEST', 'first_TEST');
    out.push(await bucket.put('object_TEST', 'denied_TEST', { onlyIf: { etagDoesNotMatch: first.etag } }) === null);
    out.push((await bucket.head('object_TEST')).etag === first.etag);
    const second = await bucket.put('object_TEST', 'second_TEST', { onlyIf: { etagMatches: '*' } });
    out.push(second !== null, second.httpEtag === `"${second.etag}"`);
    out.push(await bucket.put('object_TEST', 'denied_TEST', { onlyIf: { etagMatches: first.etag } }) === null);
    out.push(await bucket.put('object_TEST', 'denied_TEST', { onlyIf: { etagDoesNotMatch: '*' } }) === null);
    out.push(await bucket.put('new_TEST', 'created_TEST', { onlyIf: { etagDoesNotMatch: '*' } }) !== null);
    out.push(await bucket.put('new-tag_TEST', 'created_TEST', { onlyIf: { etagDoesNotMatch: 'old_TEST' } }) !== null);
    out.push(await bucket.put('object_TEST', 'third_TEST', { onlyIf: { etagDoesNotMatch: first.etag } }) !== null);
    const base = await bucket.head('object_TEST');
    const race = await Promise.all(['left_TEST', 'right_TEST'].map(body => bucket.put('object_TEST', body, { onlyIf: { etagMatches: base.etag } })));
    out.push(race.filter(Boolean).length === 1);
    const winner = race.find(Boolean);
    const stored = await bucket.get('object_TEST');
    out.push(stored.etag === winner.etag, ['left_TEST', 'right_TEST'].includes(await stored.text()));
    return out;
  }
  try {
    await mf.ready;
    const actual = await trace(await mf.getR2Bucket('BUNDLES'));
    assert.ok(actual.every(Boolean), 'all delegated R2 conditions must hold in local workerd');
    assert.deepEqual(await trace(new MemoryR2()), actual);
  } finally { await mf.dispose(); }
  assert.equal(externalAttempts, 0);
});
