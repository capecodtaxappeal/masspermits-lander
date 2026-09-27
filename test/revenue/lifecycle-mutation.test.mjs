import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { loadHandlers, withWorld } from '../harness/index.mjs';

// Synthetic, offline contracts for the real exported helper. The loader must
// honor REVENUE_SOURCE_ROOT so mutation runs exercise the selected source copy.
// A recorded request/acceptance is evidence of neither human use nor receipt.
const { lifecycle: L } = await loadHandlers();
const NOW = '2026-10-26T14:00:00.000Z';
const TIME = Date.parse(NOW), DUE = Date.parse('2026-10-26T12:00:00.000Z');
const DAY = 86400_000, WEEK = 7 * DAY;
const check = (name, fn) => test(name, { concurrency: false, timeout: 10000 }, fn);
const iso = ms => new Date(ms).toISOString();
const token = n => n.toString(16).padStart(8, '0') + 'a'.repeat(24);
const sub = (n = 1, extra = {}) => ({ token: token(n), email: n === 1 ? 'casey@example.com' : `casey+${n}@example.com`,
  name: 'Casey TEST', since: '2026-09-08', active: true, ...extra });
const event = (at, n = 1, extra = {}) => ({ key: `dl/${iso(at).slice(0, 10)}/${at}-TEST`,
  customMetadata: { t: token(n).slice(0, 8), d: 'd', ...extra } });
const send = (cycle, sent = [{ to: 'casey@example.com', ok: true }], extra = {}) => ({
  at: iso(DUE - cycle * WEEK + 60_000), sent, ...extra });
const feed = (subs = [sub()]) => [1, 2, 3, 4].map(c => send(c, subs.map(s => ({ to: s.email, ok: true }))));
const clicks = (n = 1, cycles = [1, 2, 3]) => cycles.map(c => event(DUE - c * WEEK + DAY, n));
function roll(extra = {}) {
  const input = { subs: [sub()], events: clicks(), sendLog: feed(), now: TIME,
    instrumentedAt: '2026-09-08', prev: null, ...extra };
  const before = structuredClone(input);
  const out = L.rollup(input);
  assert.deepEqual(input, before, 'a rollup must not alter its source evidence');
  return out;
}
function facts(extra = {}) {
  return { active: true, payment_failing: false, payment_failing_days: null, collided: false,
    observed_cycles: 4, downloads: 3, days_since_download: 1, cycles_hit_4: 3,
    have_send_log: true, cycles_missing_4: 0, cycles_delivered_4: 4, cycles_due_4: 4,
    cycles_no_product_4: 0, machine_suspect: 0, inactive_clicks: 0, no_file: 0, ...extra };
}
function storageSeed(w, extra = {}) {
  w.r2.set('subscribers.json', [sub()]); w.r2.set('feed-send-log.json', feed());
  w.r2.set('engagement.json', { instrumented_at: '2026-09-08', rows: [], ...extra });
  for (const e of clicks()) w.r2.set(e.key, '', { customMetadata: e.customMetadata });
}
async function noMail(w) { await w.drain(); assert.equal(w.mail.length, 0); assert.equal(w.fetchCalls.length, 0); }

check('S7 lifecycle warm-up ends at two observed cycles and never-sent requires an actual due cycle', () => {
  for (const [observed, state] of [[1, 'warming'], [2, 'never-downloaded'], [3, 'never-downloaded']])
    assert.equal(L.classifyRow(facts({ observed_cycles: observed, downloads: 0 })).state, state);
  for (const [due, expected] of [[0, false], [1, true]]) {
    const result = L.classifyRow(facts({ cycles_due_4: due, cycles_delivered_4: 0 }));
    assert.equal(result.flags.includes('never_sent'), expected);
  }
});

check('S7 lifecycle known healthy fleet is quiet and public output has counts without identity', () => {
  const r = roll();
  assert.equal(r.alert, false); assert.equal(r.response.ok, true);
  assert.equal(r.response.have_send_log, true); assert.equal(r.response.healthy, 1);
  assert.equal(r.response.engaged, 1); assert.equal(r.response.casual, 0);
  assert.equal(r.response.fleet_zero_last_cycle, false);
  assert.equal(r.rows[0].cycles_delivered_4, 4); assert.equal(r.rows[0].cycles_missing_4, 0);
  assert.doesNotMatch(JSON.stringify(r.response), /casey|example\.com|00000001/);
  assert.doesNotMatch(JSON.stringify(r.rows), /casey|example\.com|Casey TEST/);
});

check('S7 lifecycle historical delivery join is case-insensitive and ignores unrelated or missing recipients', () => {
  const sent = [{ to: 'CASEY@EXAMPLE.COM', ok: true }, { to: 'casey+other@example.com', ok: true }, null, { ok: true }];
  const r = roll({ sendLog: [1, 2, 3, 4].map(c => send(c, sent)), subs: [sub(), sub(2)] });
  assert.equal(r.rows[0].cycles_delivered_4, 4); assert.equal(r.rows[0].cycles_missing_4, 0);
  assert.equal(r.rows[1].cycles_delivered_4, 0); assert.equal(r.rows[1].cycles_missing_4, 4);
  assert.equal(r.response.never_sent, 1); assert.equal(r.response.delivery_gap, 1);
});

check('S7 lifecycle a successful recipient result wins over skips and failures in either retained order', () => {
  const accepted = send(1), failed = send(1, [{ to: 'casey@example.com', ok: false }]);
  const skipped = send(1, [], { skipped: 'identical_bundle' });
  for (const entries of [[accepted, failed, skipped], [skipped, failed, accepted], [failed, accepted, skipped]]) {
    const r = roll({ sendLog: [...entries, ...feed().slice(1)] });
    assert.equal(r.rows[0].cycles_delivered_4, 4);
    assert.equal(r.rows[0].cycles_no_product_4, 0); assert.equal(r.rows[0].cycles_missing_4, 0);
    assert.equal(r.alert, false);
  }
});

check('S7 lifecycle completed cycles one through four are counted and current, older and invalid dates are excluded', () => {
  const r = roll({ sendLog: [send(0), send(1), send(4), send(5), { at: 'INVALID_TEST', sent: [] }, null] });
  assert.equal(r.rows[0].cycles_delivered_4, 2); assert.equal(r.rows[0].cycles_missing_4, 2);
  assert.equal(r.rows[0].cycles_no_product_4, 0);
});

check('S7 lifecycle failed recipient evidence is not acceptance and explicit skipped cycles remain separate', () => {
  const r = roll({ sendLog: [send(1), send(2, [], { skipped: 'identical_bundle' }),
    send(3, [{ to: 'casey@example.com', ok: false }]), send(4, [{ to: 'casey@example.com', ok: 'true' }])] });
  assert.deepEqual([r.rows[0].cycles_delivered_4, r.rows[0].cycles_no_product_4, r.rows[0].cycles_missing_4], [1, 1, 2]);
  assert.equal(r.response.delivery_gap, 1); assert.equal(r.response.never_sent, 0);
  assert.equal(r.rows[0].action, 'fix_delivery_first');
});

check('S7 lifecycle absent or malformed log evidence remains unknown rather than a fabricated known send history', () => {
  for (const sendLog of [null, {}, [], [null]]) {
    const r = roll({ sendLog });
    assert.equal(r.response.have_send_log, false); assert.equal(r.rows[0].blame, 'unknown');
    assert.equal(r.response.never_sent, 0); assert.equal(r.response.delivery_gap, 0);
  }
});

check('S7 lifecycle request timing exactly two minutes from a send is scanner-shaped, beyond it is not', () => {
  const sentAt = Date.parse(send(1).at);
  for (const [offset, scanner] of [[-120001, false], [-120000, true], [120000, true], [120001, false]]) {
    const r = roll({ events: [event(sentAt + offset)] });
    assert.equal(r.response.machine_suspect, Number(scanner));
    assert.equal(r.rows[0].machine_suspect, Number(scanner));
    assert.equal(r.rows[0].downloads, scanner ? 0 : 1);
  }
});

check('S7 lifecycle recent denied-request count excludes exactly 28 days while preserving the total', () => {
  const r = roll({ events: [event(TIME - 28 * DAY - 1, 1, { r: 'no_match' }),
    event(TIME - 28 * DAY, 1, { r: 'no_match' }), event(TIME - 28 * DAY + 1, 1, { r: 'no_match' }),
    { key: 'dl/2026-10-01/INVALID_TEST-x', customMetadata: {} }, event(TIME - DAY, 1, { t: '' })] });
  assert.equal(r.response.unmatched_403, 3); assert.equal(r.response.unmatched_403_28d, 1);
  assert.equal(r.response.malformed_events, 2); assert.equal(r.rows[0].downloads, 0);
  assert.equal(r.rows[0].no_file, 0); assert.equal(r.rows[0].inactive_clicks, 0);
});

check('S7 lifecycle denied and missing-file events remain attributed without becoming successful downloads', () => {
  const r = roll({ events: [event(TIME - DAY, 1, { r: 'inactive' }), event(TIME - DAY + 1, 1, { r: 'no_file' }),
    event(TIME - DAY + 2, 1, { m: '1' })] });
  assert.equal(r.rows[0].inactive_clicks, 1); assert.equal(r.rows[0].no_file, 1);
  assert.equal(r.rows[0].machine_suspect, 1); assert.equal(r.rows[0].downloads, 0);
  assert.equal(r.response.inactive_403, 1); assert.equal(r.response.no_file, 1);
});

check('S7 lifecycle unsorted clicks dedupe by the last retained click and preserve first, last and device', () => {
  const first = TIME - DAY;
  const r = roll({ events: [event(first + 600001, 1, { d: 'm' }), event(first + 600000), event(first)] });
  assert.equal(r.rows[0].downloads, 2); assert.equal(r.rows[0].device, 'm');
  assert.equal(r.rows[0].first_download, iso(first)); assert.equal(r.rows[0].last_download, iso(first + 600001));
});

check('S7 lifecycle completed download cycles exclude current and fifth-oldest and recent count has a strict 28-day bound', () => {
  const r = roll({ sendLog: [], events: [event(DUE + 1), event(DUE - WEEK), event(DUE - 4 * WEEK), event(DUE - 5 * WEEK)] });
  assert.equal(r.rows[0].cycles_hit_4, 2); assert.equal(r.rows[0].downloads, 4);
  for (const [offset, expected] of [[-1, 0], [0, 0], [1, 1]]) {
    const at = TIME - 28 * DAY + offset;
    const out = roll({ sendLog: [], events: [event(at)] });
    assert.equal(out.rows[0].downloads_28d, expected); assert.equal(out.response.downloads_28d, expected);
  }
});

check('S7 lifecycle date-derived lapse and dunning thresholds do not round a day down', () => {
  for (const [age, expected] of [[21 * DAY, 'healthy'], [21 * DAY + 1, 'lapsed']])
    assert.equal(roll({ sendLog: [], events: [event(TIME - age)] }).rows[0].state, expected);
  const at = Date.parse('2026-10-26T00:00:00.000Z');
  for (const [now, stale] of [[at, false], [at + 1, true]]) {
    const r = roll({ now, subs: [sub(1, { payment_failing: '2026-09-26' })] });
    assert.equal(r.rows[0].flags.includes('dunning_stale'), stale);
  }
});

check('S7 lifecycle observation begins at the later of enrollment and instrumentation and never goes below zero', () => {
  for (const [since, observed, due] of [['2026-10-27', 0, 0], ['2026-10-12', 2, 2], [null, 6, 4]]) {
    const r = roll({ subs: [sub(1, { since })] });
    assert.equal(r.rows[0].observed_cycles, observed); assert.equal(r.rows[0].cycles_due_4, due);
    assert.equal(r.rows[0].since, since);
  }
});

check('S7 lifecycle row metadata preserves cancellation, payment trouble and approved missing-active semantics', () => {
  const rows = [sub(1, { active: false, cancelled: '2026-10-20' }), sub(2, { payment_failing: '2026-10-01' }), sub(3)];
  delete rows[2].active;
  const r = roll({ subs: rows, sendLog: feed(rows), events: [...clicks(1), ...clicks(2), ...clicks(3)] });
  assert.deepEqual(r.rows.map(x => x.active), [false, true, true]);
  assert.deepEqual(r.rows.map(x => x.cancelled), ['2026-10-20', null, null]);
  assert.deepEqual(r.rows.map(x => x.payment_failing), [null, '2026-10-01', null]);
  assert.equal(r.response.active, 2); assert.equal(r.response.cancelled, 1); assert.equal(r.response['payment-failing'], 1);
});

check('S7 lifecycle zero-download rows retain explicit null dates and device', () => {
  const r = roll({ events: [] });
  assert.deepEqual([r.rows[0].first_download, r.rows[0].last_download, r.rows[0].device], [null, null, null]);
  assert.equal(r.rows[0].downloads, 0); assert.equal(r.rows[0].machine_suspect, 0);
});

check('S7 lifecycle state transitions count each changed row once and ignore unchanged or missing history', () => {
  const subs = [sub(), sub(2), sub(3)];
  const prev = { rows: [null, {}, { t8: token(1).slice(0, 8), state: 'warming' },
    { t8: token(2).slice(0, 8), state: 'lapsed' }, { t8: token(3).slice(0, 8), state: 'healthy' }] };
  const r = roll({ subs, sendLog: feed(subs), events: [...clicks(1), ...clicks(2), ...clicks(3)], prev });
  assert.equal(r.transitions.length, 2); assert.deepEqual(r.response.transitions_to, { healthy: 2 });
  assert.equal(r.response.transitions, 2); assert.equal(r.alert, false);
});

check('S7 lifecycle fleet zero starts before the previous due boundary and requires an active row', () => {
  for (const [at, zero] of [[DUE - WEEK - 1, true], [DUE - WEEK, false]])
    assert.equal(roll({ sendLog: [], events: [event(at)] }).response.fleet_zero_last_cycle, zero);
  assert.equal(roll({ subs: [], events: [], sendLog: [] }).response.fleet_zero_last_cycle, false);
  assert.equal(roll({ subs: [sub(1, { active: false })], events: [] }).response.fleet_zero_last_cycle, false);
});

for (const [name, extra, count] of [
  ['delivery gap', { sendLog: [send(1, [{ to: 'casey@example.com', ok: false }]), ...feed().slice(1)] }, 'delivery_gap'],
  ['never sent', { sendLog: [1, 2, 3, 4].map(c => send(c, [], { skipped: 'identical_bundle' })) }, 'never_sent'],
  ['stale dunning', { subs: [sub(1, { payment_failing: '2026-09-01' })] }, 'dunning_stale'],
  ['missing file', { events: [...clicks(), event(TIME - DAY, 1, { r: 'no_file' })] }, 'served_no_file'],
  ['inactive click', { subs: [sub(1, { active: false })], events: [...clicks(), event(TIME - DAY, 1, { r: 'inactive' })] }, 'winback_signal'],
]) check(`S7 lifecycle isolated ${name} signal requests owner review`, () => {
  const r = roll(extra);
  assert.equal(r.response.fleet_zero_last_cycle, false); assert.equal(r.response[count], 1); assert.equal(r.alert, true);
});

check('S7 lifecycle fresh adverse transition and fourth-cycle referral signal are independently actionable', () => {
  const cancelled = roll({ subs: [sub(1, { active: false })], prev: { rows: [{ t8: token(1).slice(0, 8), state: 'healthy' }] } });
  assert.equal(cancelled.response.fleet_zero_last_cycle, false); assert.equal(cancelled.response.winback_signal, 0);
  assert.equal(cancelled.alert, true);
  const referral = roll({ events: clicks(1, [1, 2, 3, 4]) });
  assert.equal(referral.rows[0].action, 'ask_referral'); assert.equal(referral.alert, true);
});

check('S7 lifecycle digest escapes identity, keeps action/date evidence, and does not mutate the aggregate', () => {
  const subs = [sub(1, { name: 'Casey & <TEST> "Example"' })];
  const r = roll({ subs, events: [], prev: { rows: [{ t8: token(1).slice(0, 8), state: 'healthy' }] } });
  const before = structuredClone(r), d = L.buildDigest(r, subs);
  assert.equal(d.actionable, 1); assert.match(d.subject, /1 subscriber\(s\) need a look/);
  assert.match(d.html, /Casey &amp; &lt;TEST&gt; &quot;Example&quot;/);
  assert.doesNotMatch(d.html, /<TEST>/); assert.match(d.html, /casey@example\.com/);
  assert.match(d.html, /week of 2026-10-26/); assert.match(d.html, /never downloaded/);
  assert.match(d.html, /4\/4 cycles actually delivered/); assert.match(d.html, /Changed since last run/);
  assert.match(d.html, /NOBODY fetched anything last cycle/); assert.deepEqual(r, before);
});

check('S7 lifecycle quiet and empty digest omit action and transition sections', () => {
  for (const r of [roll(), roll({ subs: [], events: [], sendLog: [] })]) {
    const d = L.buildDigest(r, []);
    assert.equal(d.actionable, 0); assert.match(d.subject, /no action needed/);
    assert.match(d.html, /Nothing needs a human this week/);
    assert.doesNotMatch(d.html, /<h3[^>]*>Needs a human|Changed since last run|NOBODY fetched/);
  }
  assert.match(L.buildDigest(roll({ subs: [], events: [], sendLog: [] }), null).html, /none classified/);
});

check('S7 lifecycle digest uses available date and flags with a safe row fallback for an unmatched identity', () => {
  const r = roll({ sendLog: [send(1, [{ to: 'casey@example.com', ok: false }]), ...feed().slice(1)] });
  const d = L.buildDigest(r, [null, {}]);
  assert.match(d.html, /\(row 00000001\)/); assert.match(d.html, /last 2026-10-20/);
  assert.match(d.html, /flags: delivery_gap, low_opportunity/);
  assert.match(d.html, /this one is ours, not theirs/); assert.match(d.html, /fix_delivery_first/);
  assert.doesNotMatch(d.html, /casey@example\.com|never downloaded/);
});

check('S7 lifecycle reader preserves a valid aggregate and rejects malformed shapes without writes', async () => {
  await withWorld(async w => {
    const valid = { at: NOW, instrumented_at: '2026-09-08', rows: [{ t8: token(1).slice(0, 8), state: 'healthy' }], extra: 'PRESERVE_TEST' };
    w.r2.set('engagement.json', valid); assert.deepEqual(await L.readLifecycle(w.r2), valid);
    for (const value of ['{BROKEN_TEST', 'null', '{}', '{"rows":{}}', '[]']) {
      w.r2.set('engagement.json', value); assert.equal(await L.readLifecycle(w.r2), null);
    }
    w.r2.store.delete('engagement.json'); assert.equal(await L.readLifecycle(w.r2), null);
    w.r2.failNext('get', 'engagement.json'); assert.equal(await L.readLifecycle(w.r2), null);
    assert.equal(w.r2.ops.filter(x => x.op !== 'get').length, 0); await noMail(w);
  }, { now: NOW });
});

check('S7 lifecycle token lookup returns only the matching row and tolerates absent history and null slots', () => {
  const row = { t8: token(1).slice(0, 8), state: 'healthy' };
  assert.equal(L.rowForToken({ rows: [null, { t8: token(2).slice(0, 8) }, row] }, token(1)), row);
  for (const [history, value] of [[null, token(1)], [{}, token(1)], [{ rows: {} }, token(1)],
    [{ rows: [row] }, ''], [{ rows: [row] }, token(2)], [{ rows: [] }, token(1)]])
    assert.equal(L.rowForToken(history, value), null);
});

check('S7 lifecycle storage respects a monotonic instrumentation floor and an explicit observation clock', async () => {
  for (const [stored, expected] of [[null, '2026-10-26'], ['2026-09-01', '2026-09-08'], ['2026-10-01', '2026-10-01']]) {
    await withWorld(async w => {
      storageSeed(w); if (stored === null) w.r2.store.delete('engagement.json');
      else w.r2.set('engagement.json', { instrumented_at: stored, rows: [] });
      const r = await L.runRollup(w.r2, { now: TIME });
      assert.equal(r.instrumented_at, expected); assert.equal(r.at, NOW);
      assert.equal(w.r2.json('engagement.json').instrumented_at, expected);
      assert.equal(r.response.stored, true); await noMail(w);
    }, { now: '2026-11-02T14:00:00.000Z' });
  }
});

check('S7 lifecycle save failure is reported and preserves the last aggregate without manufacturing a successful save', async () => {
  await withWorld(async w => {
    storageSeed(w); const previous = w.r2.text('engagement.json');
    w.r2.failNext('put', 'engagement.json');
    const r = await L.runRollup(w.r2);
    assert.equal(r.response.stored, false); assert.equal(r.response.pruned, 0);
    assert.equal(w.r2.text('engagement.json'), previous); assert.equal(r.rows[0].downloads, 3);
    await noMail(w);
    // No stale events here: C20's failed-save retention behavior remains a
    // separate executed TODO, not a passing assertion of the faulty behavior.
  }, { now: NOW });
});

function oldEvents(w, count) {
  const at = TIME - 401 * DAY;
  for (let i = 0; i < count; i++) {
    const e = event(at + i); w.r2.set(e.key, '', { customMetadata: e.customMetadata });
  }
}

check('S7 lifecycle retention deletes at most 200 records in two bounded batches after saving the aggregate', async () => {
  await withWorld(async w => {
    storageSeed(w); oldEvents(w, 203);
    const batches = [], remove = w.r2.delete.bind(w.r2);
    w.r2.delete = async keys => { batches.push(keys.length); return remove(keys); };
    const r = await L.runRollup(w.r2);
    assert.equal(r.response.stored, true); assert.equal(r.response.pruned, 200); assert.equal(r.response.prune_remaining, 3);
    assert.deepEqual(batches, [100, 100]);
    assert.ok(w.r2.ops.findIndex(x => x.op === 'put' && x.key === 'engagement.json') < w.r2.ops.findIndex(x => x.op === 'delete'));
    assert.equal(w.r2.ops.filter(x => x.op === 'delete').length, 200); await noMail(w);
  }, { now: NOW });
});

check('S7 lifecycle retention reports only completed batches when a later delete fails', async () => {
  await withWorld(async w => {
    storageSeed(w); oldEvents(w, 203);
    const remove = w.r2.delete.bind(w.r2); let batch = 0;
    w.r2.delete = async keys => { if (++batch === 2) throw new Error('DELETE_TEST'); return remove(keys); };
    const r = await L.runRollup(w.r2);
    assert.equal(r.response.stored, true); assert.equal(r.response.pruned, 100); assert.equal(r.response.prune_remaining, 103);
    assert.equal(batch, 2); assert.equal(w.r2.ops.filter(x => x.op === 'delete').length, 100); await noMail(w);
  }, { now: NOW });
});

check('S7 lifecycle retention keeps the exact 400-day boundary when observed at UTC midnight', async () => {
  const now = Date.parse('2026-11-02T00:00:00.000Z');
  await withWorld(async w => {
    storageSeed(w);
    const entries = [-1, 0, 1].map(day => event(now - 400 * DAY + day * DAY));
    for (const e of entries) w.r2.set(e.key, '', { customMetadata: e.customMetadata });
    const r = await L.runRollup(w.r2);
    assert.equal(r.response.pruned, 1); assert.equal(r.response.prune_remaining, 0);
    assert.equal(w.r2.store.has(entries[0].key), false);
    assert.equal(w.r2.store.has(entries[1].key), true); assert.equal(w.r2.store.has(entries[2].key), true);
    await noMail(w);
  }, { now: iso(now) });
});

for (const operation of ['put', 'delete']) check(`S7 lifecycle waits for ${operation} acknowledgement before returning completed storage evidence`, async () => {
  await withWorld(async w => {
    storageSeed(w); if (operation === 'delete') oldEvents(w, 1);
    const original = w.r2[operation].bind(w.r2);
    let release, entered, finished = false;
    const waiting = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    w.r2[operation] = async (...args) => { entered(); await blocked; return original(...args); };
    const pending = L.runRollup(w.r2).then(r => { finished = true; return r; });
    await waiting; await tick(); const returnedEarly = finished;
    release(); const r = await pending;
    assert.equal(returnedEarly, false, 'storage claims must await the corresponding operation');
    assert.equal(r.response.stored, true); assert.equal(r.response.pruned, operation === 'delete' ? 1 : 0);
    await noMail(w);
  }, { now: NOW });
});

check('S7 lifecycle one retained send is known evidence rather than an absent log', () => {
  const r = roll({sendLog:[send(1)]});
  assert.equal(r.response.have_send_log,true);
  assert.equal(r.rows[0].cycles_delivered_4,1);
});
check('S7 lifecycle storage uses the resolved send history for delivery diagnosis', async () => {
  await withWorld(async w => {
    storageSeed(w);
    const r = await L.runRollup(w.r2);
    assert.equal(r.response.have_send_log,true);
    assert.equal(r.rows[0].cycles_delivered_4,4);
    assert.equal(r.rows[0].cycles_missing_4,0);
    assert.equal(r.response.never_sent,0);
    await noMail(w);
  },{now:NOW});
});
check('S7 lifecycle a continuing winback signal alerts without a new adverse transition', () => {
  const r=roll({subs:[sub(1,{active:false})],
    events:[...clicks(),event(TIME-DAY,1,{r:'inactive'})],
    prev:{rows:[{t8:token(1).slice(0,8),state:'cancelled'}]}});
  assert.equal(r.transitions.length,0);assert.equal(r.response.fleet_zero_last_cycle,false);
  for(const name of ['delivery_gap','never_sent','dunning_stale','served_no_file','unattributable'])
    assert.equal(r.response[name],0);
  assert.equal(r.response.winback_signal,1);assert.equal(r.alert,true);
});
check('S7 lifecycle digest puts delivery repair and stale payment review ahead of engagement follow-up', () => {
  const r=roll(),base=r.rows[0];
  r.rows=[
    {...base,t8:'aaaa0001',state:'lapsed',action:'contact_48h'},
    {...base,t8:'aaaa0002',state:'payment-failing',action:'check_dunning_endstate'},
    {...base,t8:'aaaa0003',action:'fix_delivery_first'}
  ];
  const digest=L.buildDigest(r,[]);
  assert.equal(digest.actionable,3);
  assert.ok(digest.html.indexOf('aaaa0003') < digest.html.indexOf('aaaa0002'));
  assert.ok(digest.html.indexOf('aaaa0002') < digest.html.indexOf('aaaa0001'));
});
