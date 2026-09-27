import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadHandlers, withWorld } from '../harness/index.mjs';

// Complementary contracts from the first S7 mutation sample. All inputs are
// synthetic. Real helper/endpoint imports honor REVENUE_SOURCE_ROOT. These
// diagnostics do not establish sender enforcement or complete roster coverage.
const H = await loadHandlers();
const P = H.presend;
const NOW = '2026-09-28T14:00:00.000Z';
const BUILT = '2026-09-28T10:05:00.000Z';
const SENT = '2026-09-28T13:05:00.000Z';
const check = (name, fn) => test(name, { concurrency: false, timeout: 10000 }, fn);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// A small STORE ZIP containing only a synthetic main CSV. This is fixture
// construction, not a second implementation of any production gate check.
function zipFixture() {
  const name = Buffer.from('ALL-leads.csv');
  const body = Buffer.from('Source,City,Permit Number\r\ntown-a,town-a,PERMIT_TEST\r\n');
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
const ZIP = zipFixture();

function status() {
  return { ok: true, ran_at: BUILT, coverage: { live_sources: 1, expected_sources: 1 },
    bundle: { built_at: BUILT, weekly: {
      sha256: sha(ZIP), rowset_sha256: 'b'.repeat(64),
      rows: 1, distinct_rows: 1, distinct_sources: 1,
      max_issued_date: '2026-09-28', opens_as_zip: true, has_all_leads: true,
    } } };
}
function previous(overrides = {}) {
  return { at: '2026-09-21T13:00:00.000Z', bundle_etag: 'PRIOR_ETAG_TEST',
    bundle_bytes: ZIP.length, bundle_rows: 2, bundle_rowset: 'a'.repeat(64),
    bundle_max_issued: '2026-09-21', subscribers: 1,
    sent: [{ to: 'casey@example.com', ok: true }], ...overrides };
}
function facts() {
  return { policy: P.normalisePolicy({}), status: status(), log: [previous()], attempt: null,
    weekly: { key: 'latest-weekly.zip', size: ZIP.length, etag: 'CURRENT_ETAG_TEST', uploaded: BUILT },
    monthly: { key: 'latest-monthly.zip', size: ZIP.length, etag: 'MONTHLY_ETAG_TEST', uploaded: BUILT },
    sha256: sha(ZIP) };
}
function evaluate(input) {
  const before = structuredClone(input);
  const result = P.evaluate(Date.parse(NOW), input);
  assert.deepEqual(input, before, 'evaluation must not repair or mutate evidence');
  return result;
}
function seed(w, { log = [], policy = {}, refresh = status() } = {}) {
  w.r2.set('presend-policy.json', policy);
  w.r2.set('refresh-status.json', refresh);
  w.r2.set('feed-send-log.json', log);
  w.r2.set('last-send-attempt.json', { at: SENT, subscribers: 4 });
  w.r2.set('latest-weekly.zip', ZIP, { etag: 'CURRENT_ETAG_TEST', uploaded: BUILT });
  w.r2.set('latest-monthly.zip', ZIP, { etag: 'MONTHLY_ETAG_TEST', uploaded: BUILT });
}
function readOnly(w) {
  assert.deepEqual(w.r2.ops.filter(op => op.op === 'put' || op.op === 'delete'), []);
  assert.equal(w.r2.ops.some(op => op.key === 'subscribers.json'), false);
  assert.equal(w.mail.length, 0);
  assert.ok(w.fetchCalls.every(call => call.url === 'https://token.actions.githubusercontent.com/.well-known/jwks'));
}
async function endpoint(w, path = '/api/pre-send-check') {
  const response = await w.call(H.preSend, path, { headers: await w.oidcHeaders() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const body = await response.json();
  readOnly(w);
  assert.doesNotMatch(JSON.stringify(body), /casey(?:\+[^@]+)?@example\.com|PRIOR_ETAG_TEST|CURRENT_ETAG_TEST/);
  return body;
}

check('S7 gate evidence retains distinct build, upload and status timestamps and counts', () => {
  const input = facts();
  input.status.bundle.built_at = '2026-09-28T10:00:00.000Z';
  input.status.ran_at = '2026-09-28T10:10:00.000Z';
  input.status.coverage = { live_sources: 5, expected_sources: 7 };
  Object.assign(input.status.bundle.weekly, { rows: 17, distinct_rows: 16, distinct_sources: 5 });
  const { evidence: ev } = evaluate(input);
  assert.equal(ev.fingerprint_built_at, '2026-09-28T10:00:00.000Z');
  assert.equal(ev.object_uploaded, BUILT);
  assert.equal(ev.status_ran_at, '2026-09-28T10:10:00.000Z');
  assert.equal(ev.live_sources, 5); assert.equal(ev.expected_sources, 7);
  assert.equal(ev.rows, 17); assert.equal(ev.distinct_rows, 16); assert.equal(ev.distinct_sources, 5);
  assert.equal(ev.max_issued_date, '2026-09-28');
  assert.equal(ev.object_bytes, ZIP.length); assert.equal(ev.object_etag_known, true);
  assert.equal(ev.sha256_verified, true); assert.equal(ev.rowset_verifiable, true);
});

check('S7 gate unknown build time stays null without borrowing a different clock', () => {
  for (const value of [undefined, null, '']) {
    const input = facts(); input.status.bundle.built_at = value;
    assert.equal(evaluate(input).evidence.fingerprint_built_at, null);
  }
});

check('S7 gate failed refresh preserves its diagnostic rather than substituting a fallback', () => {
  const input = facts(); Object.assign(input.status, { ok: false, error: 'SYNTHETIC_REFRESH_FAILURE_TEST' });
  const result = evaluate(input);
  assert.equal(result.verdict, 'NO_GO'); assert.equal(result.code, 'broken');
  assert.ok(result.reasons.includes('the last refresh FAILED (SYNTHETIC_REFRESH_FAILURE_TEST)'));
  assert.match(P.headline(result), /SYNTHETIC_REFRESH_FAILURE_TEST/);
});

check('S7 gate failed-refresh diagnostic is bounded at 160 characters without erasing the prefix', () => {
  const prefix = 'REFRESH_TEST ' + 'x'.repeat(147);
  assert.equal(prefix.length, 160);
  const input = facts(); Object.assign(input.status, { ok: false, error: prefix + 'TAIL_TEST' });
  const result = evaluate(input);
  assert.ok(result.reasons.includes('the last refresh FAILED (' + prefix + ')'));
  assert.doesNotMatch(result.reasons.join(' '), /TAIL_TEST/);
});

check('S7 gate missing failure text has an explicit fallback and numeric text is not lost', () => {
  for (const value of [undefined, null, '']) {
    const input = facts(); Object.assign(input.status, { ok: false, error: value });
    assert.ok(evaluate(input).reasons.includes('the last refresh FAILED (no error recorded)'));
  }
  const input = facts(); Object.assign(input.status, { ok: false, error: 0 });
  assert.ok(evaluate(input).reasons.includes('the last refresh FAILED (0)'));
});

for (const missing of ['prior', 'current', 'both']) {
  check(`S7 gate row delta is unknown when ${missing} numeric count is absent`, () => {
    const input = facts();
    if (missing !== 'current') delete input.log[0].bundle_rows;
    if (missing !== 'prior') delete input.status.bundle.weekly.rows;
    const ev = evaluate(input).evidence;
    assert.equal(Object.hasOwn(ev, 'rows_delta'), false, 'missing counts cannot become NaN or a made-up delta');
    assert.doesNotMatch(JSON.stringify(ev), /"rows_delta"/);
  });
}

check('S7 gate row delta requires numeric evidence on both sides without coercing text or null', () => {
  for (const [oldRows, newRows] of [['2', 1], [2, '1'], [null, 1], [2, null]]) {
    const input = facts(); input.log[0].bundle_rows = oldRows; input.status.bundle.weekly.rows = newRows;
    assert.equal(Object.hasOwn(evaluate(input).evidence, 'rows_delta'), false);
  }
});

check('S7 gate finite row deltas distinguish growth, equality and shrinkage', () => {
  for (const [oldRows, newRows, expected] of [[2, 5, 3], [2, 2, 0], [5, 2, -3]]) {
    const input = facts(); input.log[0].bundle_rows = oldRows; input.status.bundle.weekly.rows = newRows;
    assert.equal(evaluate(input).evidence.rows_delta, expected);
  }
});

check('S7 pre-send summary counts accepted and failed results while ignoring null slots', async () => {
  await withWorld(async w => {
    seed(w, { log: [previous({ at: SENT, subscribers: 4, sent: [
      { to: 'casey@example.com', ok: true }, { to: 'casey+two@example.com', ok: false }, null,
      { to: 'casey+three@example.com', ok: true }, { to: 'casey+four@example.com', ok: false },
    ] })] });
    const body = await endpoint(w);
    assert.deepEqual(body.this_window, { at: SENT, delivered: 2, failed: 2, subscriber_count: 4, skipped: false });
  }, { now: NOW });
});

check('S7 pre-send skip summary remains explicit even when its sent list is empty', async () => {
  await withWorld(async w => {
    seed(w, { log: [previous({ at: SENT, subscribers: 4, sent: [], skipped: 'identical_bundle' })] });
    const body = await endpoint(w);
    assert.deepEqual(body.this_window, { at: SENT, delivered: 0, failed: 0, subscriber_count: 4, skipped: true });
  }, { now: NOW });
});

check('S7 pre-send absent or nonnumeric subscriber count stays unknown, while zero remains zero', async () => {
  for (const [count, expected] of [[undefined, null], [null, null], ['4', null], [0, 0]]) {
    await withWorld(async w => {
      seed(w, { log: [previous({ at: SENT, subscribers: count })] });
      const body = await endpoint(w);
      assert.equal(body.this_window.subscriber_count, expected);
      assert.equal(body.this_window.delivered, 1); assert.equal(body.this_window.failed, 0);
    }, { now: NOW });
  }
});

check('S7 pre-send summary picks the existing acceptance ahead of later skip and failed attempts', async () => {
  await withWorld(async w => {
    seed(w, { log: [
      previous({ at: '2026-09-28T13:40:00.000Z', subscribers: 1, sent: [], skipped: 'identical_bundle' }),
      previous({ at: '2026-09-28T13:20:00.000Z', subscribers: 1, sent: [{ to: 'casey@example.com', ok: false }] }),
      previous({ at: SENT, subscribers: 1 }),
    ] });
    const body = await endpoint(w);
    assert.deepEqual(body.this_window, { at: SENT, delivered: 1, failed: 0, subscriber_count: 1, skipped: false });
    // A summary of one chosen entry is not reconciliation of every subscriber.
  }, { now: NOW });
});

check('S7 pre-send this-window summary excludes records before due and includes the exact due instant', async () => {
  for (const [at, included] of [['2026-09-28T11:59:59.999Z', false], ['2026-09-28T12:00:00.000Z', true]]) {
    await withWorld(async w => {
      seed(w, { log: [previous({ at })] });
      const body = await endpoint(w);
      assert.equal(body.this_window === null, !included);
      if (included) assert.equal(body.this_window.at, at);
    }, { now: NOW });
  }
});

check('S7 pre-send replay clock is separate from the checked-at clock and invalid replay falls back', async () => {
  for (const [at, expected] of [['2026-09-28T12:30:00.000Z', '2026-09-28T12:30:00.000Z'], ['INVALID_TEST', NOW]]) {
    await withWorld(async w => {
      seed(w);
      const body = await endpoint(w, '/api/pre-send-check?at=' + encodeURIComponent(at));
      assert.equal(body.checked_at, NOW); assert.equal(body.evaluated_at, expected);
      assert.equal(body.evidence.now, expected); assert.equal(body.this_window, null);
    }, { now: NOW });
  }
});

check('S7 pre-send reports explicit policy switches without sending or enabling a sender', async () => {
  for (const [value, expected] of [[true, true], [false, false], ['true', false]]) {
    await withWorld(async w => {
      seed(w, { policy: { enforce: value, notice: value } });
      const body = await endpoint(w);
      assert.equal(body.enforcing, expected); assert.equal(body.notice_enabled, expected);
      assert.equal(body.evidence.fingerprint_built_at, BUILT);
      assert.equal(body.evidence.sha256_verified, true);
    }, { now: NOW });
  }
});

check('S7 pre-send hash opt-out reports lack of verification and does not fetch bundle body', async () => {
  await withWorld(async w => {
    seed(w);
    const body = await endpoint(w, '/api/pre-send-check?hash=0');
    assert.equal(body.evidence.sha256_verified, false);
    assert.equal(w.r2.ops.filter(op => op.op === 'get' && op.key === 'latest-weekly.zip').length, 0);
  }, { now: NOW });
});

check('S7 pre-send normal storage-read failure yields a diagnostic rather than an invented gather exception', async () => {
  await withWorld(async w => {
    seed(w); w.r2.failNext('get', 'refresh-status.json');
    const body = await endpoint(w);
    assert.equal(body.verdict, 'NO_GO'); assert.equal(body.go, false);
    assert.equal(body.code, 'broken'); assert.equal(body.customer_gets_nothing, true);
    assert.equal(body.evidence.status_ran_at, null);
    assert.ok(body.reasons.some(reason => reason.includes('no refresh-status.json')));
  }, { now: NOW });
});

// Follow-up to the exhaustive operator run. These are real normal-path and
// evidence contracts, not manufactured exceptions in the defensive catch.
check('S7 pre-send rejects missing authentication with 401 before reading any bundle or customer evidence', async () => {
  await withWorld(async w => {
    seed(w);
    const response = await w.call(H.preSend, '/api/pre-send-check');
    assert.equal(response.status, 401);
    const body = await response.json(); assert.equal(body.error, 'unauthorized');
    assert.equal(w.r2.ops.length, 0); assert.equal(w.mail.length, 0); assert.equal(w.fetchCalls.length, 0);
  }, { now: NOW });
});

check('S7 gate best-entry selection retains the first acceptance or first explicit skip within its class', () => {
  const due = Date.parse('2026-09-28T12:00:00.000Z');
  const newest = previous({ at: '2026-09-28T13:50:00.000Z' });
  const older = previous({ at: SENT });
  assert.equal(P.bestSince([newest, older], due), newest);
  const skip = previous({ at: '2026-09-28T13:40:00.000Z', sent: [], skipped: 'identical_bundle' });
  const oldSkip = previous({ at: SENT, sent: [], skipped: 'identical_bundle' });
  const fail = previous({ at: '2026-09-28T13:55:00.000Z', sent: [{ to: 'casey@example.com', ok: false }] });
  assert.equal(P.bestSince([fail, skip, oldSkip], due), skip);
  assert.equal(P.bestSince([fail, skip, newest, older], due), newest);
  // This is a chosen-entry summary; it does not union coverage across attempts.
});

check('S7 gate metadata prefers the unquoted etag and retains the explicit httpEtag fallback', async () => {
  await withWorld(async w => {
    seed(w);
    const first = await P.gather(w.env, { hash: false });
    assert.equal(first.weekly.etag, (await w.r2.head('latest-weekly.zip')).etag);
    const head = w.r2.head.bind(w.r2);
    w.r2.head = async key => { const value = await head(key); if (key === 'latest-weekly.zip') delete value.etag; return value; };
    const fallback = await P.gather(w.env, { hash: false });
    assert.equal(fallback.weekly.etag, (await w.r2.head('latest-weekly.zip')).httpEtag);
    assert.equal(w.mail.length, 0);
  }, { now: NOW });
});

check('S7 gate missing or invalid upload age remains null while a known age remains numeric', () => {
  for (const uploaded of [null, '', 'INVALID_TEST']) {
    const input = facts(); input.weekly.uploaded = uploaded;
    assert.equal(evaluate(input).evidence.object_age_h, null);
  }
  const input = facts(); input.weekly.uploaded = NOW;
  assert.equal(evaluate(input).evidence.object_age_h, 0);
});

check('S7 gate monthly age warning starts beyond eight days and reports calendar-day age without blocking a healthy weekly', () => {
  for (const [hours, warning, days] of [[192, false, null], [193, true, 8], [600, true, 25]]) {
    const input = facts(); input.monthly.uploaded = new Date(Date.parse(NOW) - hours * 3600_000).toISOString();
    const result = evaluate(input);
    assert.equal(result.verdict, 'GO');
    assert.equal(result.notes.some(n => n.startsWith('latest-monthly.zip is ')), warning);
    if (warning) assert.ok(result.notes.some(n => n.startsWith(`latest-monthly.zip is ${days} days old`)));
  }
});

check('S7 gate size-band diagnostic reports the actual configured percentage', () => {
  const input = facts(); input.weekly.size = ZIP.length * 3;
  const r = evaluate(input);
  assert.equal(r.verdict, 'NO_GO'); assert.equal(r.code, 'broken');
  assert.ok(r.reasons.some(x => x.includes('(±60%)')));
});

check('S7 gate duplicate diagnosis tolerates null result slots while retaining an actual accepted result', () => {
  const input = facts();
  input.log[0].bundle_etag = input.weekly.etag;
  input.log[0].sent = [null, { to: 'casey@example.com', ok: true }];
  const r = evaluate(input);
  assert.equal(r.code, 'already_delivered');
  assert.ok(r.reasons.some(x => x.includes('these exact bytes were already delivered')));
  assert.ok(r.reasons.every(x => !x.includes('were SKIPPED')));
});

check('S7 gate a clean result retains the useful nonempty explanation', () => {
  const r = evaluate(facts());
  assert.equal(r.verdict, 'GO');
  assert.deepEqual(r.reasons, ['fresh bundle, uploaded inside this send window, byte-verified, not yet delivered']);
});
