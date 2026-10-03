import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadHandlers, withWorld } from '../harness/index.mjs';

// Real source exports, including under REVENUE_SOURCE_ROOT mutation overrides.
// These are helper contracts. They neither enable notices nor establish that
// the frozen weekly sender enforces a pre-send verdict.
const { presend: P, notice: N } = await loadHandlers();
const NOW = Date.parse('2026-09-28T14:00:00.000Z');
const FRESH = '2026-09-28T10:00:00.000Z';
const HASH = 'a'.repeat(64), ROWSET = 'b'.repeat(64);
const DEFAULTS = {
  send_dow: 1, send_hour: 12, hold_until_hour: 20,
  max_bundle_age_h: 48, max_status_age_h: 36, divergence_h: 6,
  size_tolerance: 0.6, verify_sha256: true, enforce: false, notice: false,
};
const check = (name, fn) => test(name, { concurrency: false, timeout: 10000 }, fn);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function input() {
  return {
    policy: { ...DEFAULTS },
    status: { ok: true, ran_at: FRESH,
      coverage: { live_sources: 1, expected_sources: 1, disclose: false },
      bundle: { built_at: FRESH, weekly: {
        sha256: HASH, rowset_sha256: ROWSET, rows: 12, distinct_rows: 12,
        max_issued_date: '2026-09-28', distinct_sources: 1,
        opens_as_zip: true, has_all_leads: true,
      } } },
    weekly: { key: 'latest-weekly.zip', etag: 'WEEKLY_TEST', size: 1000, uploaded: FRESH },
    monthly: { key: 'latest-monthly.zip', etag: 'MONTHLY_TEST', size: 2000, uploaded: FRESH },
    log: [], attempt: null, sha256: HASH,
  };
}

function prior(extra = {}) {
  return { at: '2026-09-21T12:05:00.000Z', bundle_etag: 'PRIOR_TEST',
    sent: [{ to: 'casey@example.com', ok: true }], subscribers: 1,
    bundle_rows: 10, bundle_bytes: 1000, bundle_rowset: 'c'.repeat(64),
    bundle_max_issued: '2026-09-21', ...extra };
}

function evaluate(facts, now = NOW) {
  const before = structuredClone(facts);
  const result = P.evaluate(now, freeze(facts));
  assert.deepEqual(facts, before, 'evaluation must not mutate its inputs');
  assert.deepEqual(P.evaluate(now, facts), result, 'equal inputs must produce equal output');
  return result;
}

function decision(result, verdict, code) {
  assert.equal(result.verdict, verdict);
  assert.equal(result.code, code);
  assert.equal(result.go, verdict === 'GO' || verdict === 'GO_WITH_DISCLOSURE');
  assert.equal(result.customer_gets_nothing, verdict === 'NO_GO');
}

check('S7 policy defaults and invalid top-level values remain conservative and explicit', () => {
  assert.deepEqual(P.POLICY_DEFAULTS, DEFAULTS);
  for (const raw of [undefined, null, false, 42, 'true', []]) {
    assert.deepEqual(P.normalisePolicy(raw), DEFAULTS);
  }
});

for (const [key, minimum, maximum] of [
  ['send_dow', 0, 6], ['send_hour', 0, 23], ['hold_until_hour', 0, 23],
  ['max_bundle_age_h', 1, 336], ['max_status_age_h', 1, 336],
  ['divergence_h', 1, 72], ['size_tolerance', 0.05, 0.95],
]) {
  check(`S7 policy ${key} accepts inclusive bounds and defaults invalid types/ranges`, () => {
    for (const value of [minimum, maximum]) assert.equal(P.normalisePolicy({ [key]: value })[key], value);
    for (const value of [minimum - 0.01, maximum + 0.01, NaN, Infinity, -Infinity,
      String(minimum), true, false, null, undefined]) {
      assert.equal(P.normalisePolicy({ [key]: value })[key], DEFAULTS[key], `${key} must not coerce ${String(value)}`);
    }
  });
}

check('S7 policy boolean switches require literal booleans and unknown keys disappear', () => {
  for (const key of ['verify_sha256', 'enforce', 'notice']) {
    for (const value of [true, false]) assert.equal(P.normalisePolicy({ [key]: value })[key], value);
    for (const value of ['true', 'false', 1, 0, null, [], {}]) {
      assert.equal(P.normalisePolicy({ [key]: value })[key], DEFAULTS[key]);
    }
  }
  assert.deepEqual(P.normalisePolicy({ unknown_TEST: true }), DEFAULTS);
});

check('S7 policy normalization neither mutates input nor shares mutable default state', () => {
  const raw = freeze({ enforce: true, max_status_age_h: 72, unknown_TEST: 'ignored' });
  const first = P.normalisePolicy(raw);
  assert.equal(first.enforce, true); assert.equal(first.max_status_age_h, 72);
  first.send_hour = 23;
  assert.equal(P.normalisePolicy(raw).send_hour, 12);
  assert.deepEqual(P.POLICY_DEFAULTS, DEFAULTS);
  assert.equal(raw.unknown_TEST, 'ignored');
});

check('S7 UTC window, due time and hold deadline have distinct Monday boundaries', () => {
  for (const [instant, window, due, hold] of [
    ['2026-09-27T23:59:59Z', '2026-09-21T00:00:00Z', '2026-09-21T12:00:00Z', '2026-09-21T20:00:00Z'],
    ['2026-09-28T00:00:00Z', '2026-09-28T00:00:00Z', '2026-09-21T12:00:00Z', '2026-09-28T20:00:00Z'],
    ['2026-09-28T11:59:59Z', '2026-09-28T00:00:00Z', '2026-09-21T12:00:00Z', '2026-09-28T20:00:00Z'],
    ['2026-09-28T12:00:00Z', '2026-09-28T00:00:00Z', '2026-09-28T12:00:00Z', '2026-09-28T20:00:00Z'],
    ['2026-09-28T20:00:00Z', '2026-09-28T00:00:00Z', '2026-09-28T12:00:00Z', '2026-09-28T20:00:00Z'],
    ['2026-09-29T08:00:00Z', '2026-09-28T00:00:00Z', '2026-09-28T12:00:00Z', '2026-09-28T20:00:00Z'],
  ]) {
    const at = Date.parse(instant);
    assert.equal(P.windowStart(at), Date.parse(window), instant);
    assert.equal(P.dueAt(at), Date.parse(due), instant);
    assert.equal(P.holdDeadline(at), Date.parse(hold), instant);
  }
});

check('S7 explicit schedule policy controls all three UTC boundaries', () => {
  const policy = freeze({ ...DEFAULTS, send_dow: 3, send_hour: 9, hold_until_hour: 17 });
  assert.equal(P.windowStart(Date.parse('2026-09-30T08:59:59Z'), policy), Date.parse('2026-09-30T00:00:00Z'));
  assert.equal(P.dueAt(Date.parse('2026-09-30T08:59:59Z'), policy), Date.parse('2026-09-23T09:00:00Z'));
  assert.equal(P.dueAt(Date.parse('2026-09-30T09:00:00Z'), policy), Date.parse('2026-09-30T09:00:00Z'));
  assert.equal(P.holdDeadline(Date.parse('2026-09-30T09:00:00Z'), policy), Date.parse('2026-09-30T17:00:00Z'));
});

check('S7 log helpers handle unavailable or empty arrays without inventing a result', () => {
  for (const log of [null, undefined, {}, 'invalid_TEST', []]) {
    assert.equal(P.lastEtagEntry(log), null);
    assert.equal(P.bestSince(log, NOW), null);
  }
});

check('S7 lastEtagEntry retains skip fingerprints past newer entries without an etag', () => {
  const skipped = { at: FRESH, bundle_etag: 'SKIP_TEST', skipped: 'same bytes', sent: [] };
  const older = prior();
  const log = freeze([null, {}, { bundle_etag: '' }, skipped, older]);
  assert.deepEqual(P.lastEtagEntry(log), skipped);
});

check('S7 bestSince ranks acceptance above skip above a bare attempt', () => {
  const due = Date.parse('2026-09-28T12:00:00Z');
  const attempt = { at: '2026-09-28T13:30:00Z', sent: [{ to: 'casey@example.com', ok: false }] };
  const skipped = { at: '2026-09-28T13:00:00Z', skipped: 'same bytes', sent: [] };
  const accepted = { at: '2026-09-28T12:05:00Z', sent: [{ to: 'casey@example.com', ok: true }] };
  assert.deepEqual(P.bestSince(freeze([attempt, skipped, accepted]), due), accepted);
  assert.deepEqual(P.bestSince(freeze([attempt, skipped]), due), skipped);
  assert.deepEqual(P.bestSince(freeze([attempt]), due), attempt);
});

check('S7 bestSince includes the exact due instant, excludes older records and preserves newest qualifying order', () => {
  const due = Date.parse('2026-09-28T12:00:00Z');
  const old = { at: '2026-09-28T11:59:59Z', sent: [{ ok: true }], id: 'OLD_TEST' };
  const exact = { at: '2026-09-28T12:00:00Z', sent: [{ ok: true }], id: 'EXACT_TEST' };
  const newest = { at: '2026-09-28T13:00:00Z', sent: [{ ok: true }], id: 'NEW_TEST' };
  assert.equal(P.bestSince(freeze([null, {}, old]), due), null);
  assert.deepEqual(P.bestSince(freeze([exact, old]), due), exact);
  assert.deepEqual(P.bestSince(freeze([newest, exact, old]), due), newest);
});

check('S7 clean evaluator result is deterministic, verified and ready without disclosure', () => {
  const result = evaluate(input());
  decision(result, 'GO', 'clean');
  assert.deepEqual(result.disclosure, []);
  assert.equal(result.evidence.sha256_verified, true);
  assert.equal(result.evidence.rowset_verifiable, true);
  assert.equal(result.evidence.bundle_in_window, true);
  assert.equal(result.evidence.object_bytes, 1000);
  assert.equal(result.previously_at, null);
});

check('S7 monthly absence or staleness stays context rather than blocking the weekly decision', () => {
  for (const monthly of [null, { uploaded: '2026-09-01T10:00:00Z', size: 2000, etag: 'OLD_MONTH_TEST' }]) {
    const facts = input(); facts.monthly = monthly;
    const result = evaluate(facts);
    decision(result, 'GO', 'clean');
    assert.ok(result.notes.some(note => /latest-monthly\.zip/.test(note)));
    assert.ok(result.reasons.every(reason => !/latest-monthly\.zip/.test(reason)));
  }
});

check('S7 missing weekly object and unusable refresh status give explicit NO_GO results', () => {
  const missing = input(); missing.weekly = null;
  decision(evaluate(missing), 'NO_GO', 'no_bundle');
  for (const status of [null, { ok: true }, { ok: true, ran_at: 'INVALID_DATE_TEST' }]) {
    const facts = input(); facts.status = status;
    const result = evaluate(facts);
    decision(result, 'NO_GO', 'broken');
    assert.match(result.reasons[0], /refresh-status/);
  }
});

check('S7 status age threshold is inclusive and becomes blocking beyond its reported precision', () => {
  decision(evaluate(input(), Date.parse('2026-09-29T22:00:00Z')), 'GO', 'clean');
  const stale = evaluate(input(), Date.parse('2026-09-29T22:00:36Z'));
  decision(stale, 'NO_GO', 'broken');
  assert.equal(stale.evidence.status_age_h, 36.01);
  assert.match(stale.reasons[0], /refresh has not run/);
});

check('S7 healthy-status/object divergence blocks strictly after six hours', () => {
  for (const [ranAt, expected] of [['2026-09-28T16:00:00Z', 'GO'], ['2026-09-28T16:00:01Z', 'NO_GO']]) {
    const facts = input(); facts.status.ran_at = ranAt;
    const result = evaluate(facts, Date.parse(ranAt));
    decision(result, expected, expected === 'GO' ? 'clean' : 'broken');
    if (expected === 'NO_GO') assert.match(result.reasons[0], /upload did not land/);
  }
});

check('S7 failed refresh blocks while explicitly degraded or disclosed coverage yields disclosure', () => {
  const failed = input(); failed.status.ok = false; failed.status.error = 'FAILURE_TEST';
  decision(evaluate(failed), 'NO_GO', 'broken');
  for (const change of ['degraded', 'coverage']) {
    const facts = input();
    if (change === 'degraded') { facts.status.ok = false; facts.status.degraded = true; }
    else facts.status.coverage.disclose = true;
    const result = evaluate(facts);
    decision(result, 'GO_WITH_DISCLOSURE', 'disclose');
    assert.deepEqual(result.disclosure, ['reduced_coverage']);
  }
});

check('S7 declared invalid archives, missing master CSV and zero rows each block', () => {
  for (const [field, value, reason] of [
    ['opens_as_zip', false, /does not open as a zip/],
    ['has_all_leads', false, /no ALL-leads\.csv/],
    ['rows', 0, /zero rows/],
  ]) {
    const facts = input(); facts.status.bundle.weekly[field] = value;
    const result = evaluate(facts); decision(result, 'NO_GO', 'broken');
    assert.ok(result.reasons.some(text => reason.test(text)));
  }
});

check('S7 mismatched hashes block and unavailable fingerprints never claim verification', () => {
  const mismatch = input(); mismatch.sha256 = 'f'.repeat(64);
  const bad = evaluate(mismatch); decision(bad, 'NO_GO', 'broken');
  assert.equal(bad.evidence.sha256_verified, false);
  assert.ok(bad.reasons.some(reason => /sha256/.test(reason)));
  const unreadable = input(); unreadable.sha256 = null;
  assert.equal(evaluate(unreadable).evidence.sha256_verified, false);
  const absent = input(); delete absent.status.bundle;
  const result = evaluate(absent);
  assert.equal(result.evidence.rowset_verifiable, false);
  assert.ok(result.notes.some(note => /UNVERIFIABLE/.test(note)));
  // No assertion blesses GO on a failed hash read; sender enforcement remains
  // separately covered by the frozen integration TODOs.
});

check('S7 size sanity accepts its inclusive band and rejects either outside edge', () => {
  for (const [size, allowed] of [[400, true], [1600, true], [399, false], [1601, false]]) {
    const facts = input(); facts.weekly.size = size; facts.log = [prior()];
    const result = evaluate(facts);
    decision(result, allowed ? 'GO' : 'NO_GO', allowed ? 'clean' : 'broken');
    assert.deepEqual(result.evidence.size_band, [400, 1600]);
  }
});

check('S7 row fingerprints distinguish identical rows, no newer issue dates and new data', () => {
  const identical = input();
  identical.log = [prior({ bundle_rowset: ROWSET, bundle_rows: 12, bundle_max_issued: '2026-09-28' })];
  const same = evaluate(identical); decision(same, 'GO_WITH_DISCLOSURE', 'disclose');
  assert.deepEqual(same.disclosure, ['no_new_rows']);
  assert.equal(same.evidence.rows_delta, 0); assert.equal(same.evidence.rowset_matches_last_delivered, true);
  const dateOnly = input(); dateOnly.log = [prior({ bundle_max_issued: '2026-09-28' })];
  const noNewer = evaluate(dateOnly); decision(noNewer, 'GO_WITH_DISCLOSURE', 'disclose');
  assert.deepEqual(noNewer.disclosure, ['no_newer_permits']);
  assert.equal(noNewer.evidence.rows_delta, 2);
  const fresh = input(); fresh.log = [prior()];
  decision(evaluate(fresh), 'GO', 'clean');
});

check('S7 matching etags remain duplicate evidence for accepted and skipped entries', () => {
  for (const skipped of [false, true]) {
    const facts = input();
    facts.log = [prior({ bundle_etag: 'WEEKLY_TEST', bundle_rowset: ROWSET,
      bundle_rows: 12, bundle_max_issued: '2026-09-28',
      ...(skipped ? { sent: [], skipped: 'identical bytes TEST' } : {}) })];
    const result = evaluate(facts); decision(result, 'NO_GO', 'already_delivered');
    assert.equal(result.previously_at, '2026-09-21T12:05:00.000Z');
    assert.match(result.reasons[0], skipped ? /SKIPPED/ : /already delivered/);
  }
});

check('S7 broken refresh diagnosis outranks a simultaneous duplicate consequence', () => {
  const facts = input(); facts.status.ok = false; facts.status.error = 'FAILED_TEST';
  facts.log = [prior({ bundle_etag: 'WEEKLY_TEST' })];
  const result = evaluate(facts); decision(result, 'NO_GO', 'broken');
  assert.match(result.reasons[0], /refresh FAILED/);
  assert.ok(result.reasons.some(reason => /already delivered/.test(reason)));
});

function olderInput(uploaded) {
  const facts = input();
  facts.weekly.uploaded = uploaded; facts.status.ran_at = uploaded;
  facts.status.bundle.built_at = uploaded;
  facts.status.bundle.weekly.max_issued_date = uploaded.slice(0, 10);
  return facts;
}

check('S7 HOLD ends exactly at the deadline, with bounded old-data disclosure afterward', () => {
  const recentOld = '2026-09-27T21:00:00Z';
  decision(evaluate(olderInput(recentOld), Date.parse('2026-09-28T19:59:59Z')), 'HOLD', 'waiting_for_refresh');
  const released = evaluate(olderInput(recentOld), Date.parse('2026-09-28T20:00:00Z'));
  decision(released, 'GO_WITH_DISCLOSURE', 'disclose');
  assert.ok(released.disclosure.includes('data_from_earlier_day'));
  assert.equal(released.evidence.past_hold_deadline, true);
  for (const [uploaded, allowed] of [['2026-09-26T20:00:00Z', true], ['2026-09-26T19:59:59Z', false]]) {
    const facts = olderInput(uploaded); facts.policy.max_status_age_h = 336;
    const result = evaluate(facts, Date.parse('2026-09-28T20:00:00Z'));
    decision(result, allowed ? 'GO_WITH_DISCLOSURE' : 'NO_GO', allowed ? 'disclose' : 'too_old');
  }
});

check('S7 headlines preserve decision priority rather than promoting contextual notes', () => {
  assert.equal(P.headline({ verdict: 'GO' }), 'Ready to send.');
  assert.match(P.headline({ verdict: 'GO_WITH_DISCLOSURE', disclosure: ['no_new_rows', 'reduced_coverage'] }),
    /no new rows, reduced coverage/);
  assert.match(P.headline({ verdict: 'HOLD' }), /Waiting for this morning/);
  assert.equal(P.headline({ verdict: 'NO_GO', reasons: ['REASON_TEST'], notes: ['CONTEXT_TEST'] }), 'Will not send: REASON_TEST');
});

// gather tests use opaque digest bytes, not a claim that this tiny payload is a
// valid archive. Archive/schema verdicts above use explicit builder evidence.
const DIGEST_BYTES = Buffer.from('SYNTHETIC_HASH_INPUT_TEST');
const DIGEST_HASH = createHash('sha256').update(DIGEST_BYTES).digest('hex');
function seedGather(w) {
  w.r2.set('presend-policy.json', { enforce: true, notice: false });
  w.r2.set('refresh-status.json', { ok: true, ran_at: FRESH,
    bundle: { weekly: { sha256: DIGEST_HASH } } });
  w.r2.set('feed-send-log.json', [prior()]);
  w.r2.set('last-send-attempt.json', { at: FRESH, subscribers: 1 });
  w.r2.set('latest-weekly.zip', DIGEST_BYTES, { etag: 'DIGEST_TEST', uploaded: FRESH });
  w.r2.set('latest-monthly.zip', DIGEST_BYTES, { etag: 'MONTHLY_TEST', uploaded: FRESH });
}
function readOnly(w) {
  assert.equal(w.r2.ops.filter(op => op.op === 'put' || op.op === 'delete').length, 0);
  assert.ok(!w.r2.ops.some(op => op.key === 'subscribers.json'));
  assert.equal(w.fetchCalls.length, 0); assert.equal(w.mail.length, 0);
}

check('S7 gather hashes actual read bytes and preserves only the declared metadata view', async () => {
  await withWorld(async w => {
    seedGather(w);
    const result = await P.gather(w.env);
    assert.equal(result.sha256, DIGEST_HASH); assert.equal(result.policy.enforce, true);
    assert.equal(result.weekly.etag, 'DIGEST_TEST');
    assert.equal(result.weekly.size, DIGEST_BYTES.length); assert.equal(result.weekly.uploaded, FRESH);
    assert.equal(result.attempt.subscribers, 1); assert.equal(result.log.length, 1);
    assert.equal(result.monthly.etag, 'MONTHLY_TEST');
    assert.equal(w.r2.ops.filter(op => op.op === 'get' && op.key === 'latest-weekly.zip').length, 1);
    readOnly(w);
  }, { now: NOW });
});

check('S7 both documented hash opt-outs avoid the weekly body read', async () => {
  for (const policyOptOut of [false, true]) {
    await withWorld(async w => {
      seedGather(w);
      if (policyOptOut) w.r2.set('presend-policy.json', { verify_sha256: false });
      const result = await P.gather(w.env, policyOptOut ? {} : { hash: false });
      assert.equal(result.sha256, null);
      assert.equal(w.r2.ops.filter(op => op.op === 'get' && op.key === 'latest-weekly.zip').length, 0);
      readOnly(w);
    }, { now: NOW });
  }
});

check('S7 gather missing, malformed and unavailable status cannot become a ready decision', async () => {
  for (const fault of ['missing', 'malformed', 'unavailable']) {
    await withWorld(async w => {
      seedGather(w);
      if (fault === 'missing') w.r2.store.delete('refresh-status.json');
      else if (fault === 'malformed') w.r2.set('refresh-status.json', '{INVALID_TEST');
      else w.r2.failNext('get', 'refresh-status.json');
      const result = await P.gather(w.env);
      assert.equal(result.status, null); assert.equal(result.sha256, null);
      decision(P.evaluate(NOW, result), 'NO_GO', 'broken');
      readOnly(w);
    }, { now: NOW });
  }
});

check('S7 gather unavailable object metadata yields no usable weekly object', async () => {
  await withWorld(async w => {
    seedGather(w); w.r2.failNext('head', 'latest-weekly.zip');
    const result = await P.gather(w.env);
    assert.equal(result.weekly, null); assert.equal(result.sha256, null);
    decision(P.evaluate(NOW, result), 'NO_GO', 'no_bundle');
    readOnly(w);
  }, { now: NOW });
});

check('S7 gather failed hash read stays explicitly unverified', async () => {
  await withWorld(async w => {
    seedGather(w); w.r2.failNext('get', 'latest-weekly.zip');
    const result = await P.gather(w.env);
    assert.equal(result.sha256, null);
    assert.equal(P.evaluate(NOW, result).evidence.sha256_verified, false);
    readOnly(w);
  }, { now: NOW });
});

check('S7 disclosure rendering omits unknown codes and facts that are unavailable', () => {
  for (const codes of [undefined, null, 'no_new_rows', [], ['UNKNOWN_TEST'], ['no_new_rows'], ['data_from_earlier_day'], ['no_newer_permits']]) {
    assert.equal(N.disclosureBlock(codes, freeze({})), '');
  }
});

check('S7 disclosure rendering deduplicates codes and avoids contradictory freshness paragraphs', () => {
  const facts = freeze({ data_date: '2026-09-27', previous_date: '2026-09-21', max_issued_date: '2026-09-20' });
  const html = N.disclosureBlock(freeze(['data_from_earlier_day', 'data_from_earlier_day', 'no_new_rows', 'no_newer_permits']), facts);
  assert.equal((html.match(/were collected on/g) || []).length, 1);
  assert.equal((html.match(/same permits as the one/g) || []).length, 1);
  assert.doesNotMatch(html, /newest permit in this file/);
  const fallback = N.disclosureBlock(['no_new_rows', 'no_newer_permits'], { max_issued_date: '2026-09-20' });
  assert.match(fallback, /newest permit in this file/);
});

const RAW = 'Casey <&>"\'';
const ESCAPED = 'Casey &lt;&amp;&gt;&quot;&#39;';
check('S7 disclosure fact text is escaped without executable markup or double escaping', () => {
  for (const [code, key] of [['data_from_earlier_day', 'data_date'], ['no_new_rows', 'previous_date'], ['no_newer_permits', 'max_issued_date']]) {
    const html = N.disclosureBlock([code], freeze({ [key]: RAW }));
    assert.ok(html.includes(ESCAPED)); assert.ok(!html.includes(RAW));
    assert.ok(!html.includes('&amp;lt;'));
  }
});

check('S7 nothing-this-week reason codes select specific explanations with a safe fallback', () => {
  for (const [reason_code, expected] of [
    ['broken', /data refresh failed overnight/], ['too_old', /not run cleanly for two days/],
    ['no_bundle', /file did not build, so/], ['already_delivered', /same permits you already have/],
    ['UNKNOWN_TEST', /file did not build correctly/],
  ]) {
    const result = N.nothingThisWeek(freeze({ first_name: 'Casey', reason_code }));
    assert.match(result.html, expected); assert.match(result.html, /Hi Casey,/);
    assert.doesNotMatch(result.html, /undefined|null/);
  }
  assert.match(N.nothingThisWeek().html, /Hi, your weekly file/);
});

check('S7 customer name and ETA are escaped while absent ETA remains a distinct fallback', () => {
  const result = N.nothingThisWeek(freeze({ first_name: RAW, eta: RAW, reason_code: 'no_bundle' }));
  assert.equal((result.html.match(/Casey &lt;&amp;&gt;&quot;&#39;/g) || []).length, 2);
  assert.ok(!result.html.includes(RAW));
  assert.match(N.nothingThisWeek({ first_name: 'Casey' }).html, /as soon as the data run is clean/);
});

check('S7 owner alert states supplied customer impact without inventing it', () => {
  assert.match(N.ownerAlert({ customer_gets_nothing: true, verdict: 'NO_GO' }).html, /A PAYING SUBSCRIBER GETS NOTHING/);
  assert.match(N.ownerAlert({ customer_gets_nothing: false, verdict: 'HOLD' }).html, /No customer impact yet/);
  assert.match(N.ownerAlert().subject, /unknown/);
  assert.doesNotMatch(N.ownerAlert({ reasons: [] }).html, /Context that did not decide/);
});

check('S7 owner alert escapes reason and context text and keeps the decisive reason first', () => {
  const gate = freeze({ verdict: RAW, reasons: [RAW + ' REASON_TEST'], notes: [RAW + ' NOTE_TEST'], customer_gets_nothing: true });
  const result = N.ownerAlert(gate);
  assert.ok(result.html.includes(ESCAPED)); assert.ok(!result.html.includes(RAW));
  assert.ok(result.html.indexOf('REASON_TEST') < result.html.indexOf('Context that did not decide'));
  assert.ok(result.html.indexOf('Context that did not decide') < result.html.indexOf('NOTE_TEST'));
});

check('S7 notice helpers remain pure and do not activate any customer or owner mail', async () => {
  await withWorld(async w => {
    N.disclosureBlock(['no_new_rows'], freeze({ previous_date: '2026-09-21' }));
    N.nothingThisWeek(freeze({ first_name: 'Casey', reason_code: 'no_bundle' }));
    N.ownerAlert(freeze({ verdict: 'NO_GO', reasons: ['REASON_TEST'], notes: ['CONTEXT_TEST'], customer_gets_nothing: true }));
    readOnly(w);
  }, { now: NOW });
  // Rendering/escaping coverage is not approval of dormant refund language.
});
