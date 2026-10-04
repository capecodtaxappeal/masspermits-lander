import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadHandlers, withWorld } from '../harness/index.mjs';

// Real exported handlers and their real OIDC verifier; every object and address
// below is synthetic. TODO cases EXECUTE the desired assertion. They do not
// authorize changing the frozen sender/watchdog or enabling customer notices.
const NOW = '2026-09-28T14:00:00.000Z';
const BUILT = '2026-09-28T10:05:00.000Z';
const SENT = '2026-09-28T12:05:00.000Z';
const EMAILS = ['casey@example.com', 'casey+two@example.com',
  'casey+three@example.com', 'casey+four@example.com'];
// Exercise retention in the future, after a real-shaped download record can
// age past 400 days. This is not evidence of a present-day retention incident.
const RETENTION_NOW = '2027-11-01T14:00:00.000Z';
const OLD_EVENT_AT = '2026-09-09T14:00:00.000Z';
const OLD_DL = `dl/2026-09-09/${Date.parse(OLD_EVENT_AT)}-00000001`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// A genuine, tiny STORE ZIP, so healthy tests do not depend on accepting a fake
// PK prefix. These bytes contain only a synthetic CSV and HTML fixture.
function zipFixture(suffix = '1') {
  const files = [
    ['ALL-leads.csv', 'Source,City,Issued Date,Permit Number,Description,Status\r\n' +
      `town-a,town-a,2026-09-28,PERMIT_TEST_${suffix},Synthetic fixture,Issued\r\n`],
    ['MassPermits-Leads.html', '<!doctype html><title>Synthetic town-a fixture</title>' +
      `<p>PERMIT_TEST_${suffix}</p>`],
  ];
  const local = [], central = [];
  let offset = 0;
  for (const [filename, text] of files) {
    const name = Buffer.from(filename), body = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(33, 12); // 1980-01-01, deterministic DOS date.
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(body.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(33, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(body.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    local.push(lh, name, body); central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const ZIP = zipFixture();

function subscriber(index = 0, extra = {}) {
  return {
    email: EMAILS[index], name: 'Casey', active: true,
    customer: `cus_${index}_TEST`,
    token: sha256(Buffer.from(`SUBSCRIBER_${index}_TEST`)).slice(0, 32),
    since: '2026-09-01', ...extra,
  };
}

function statusFor(bytes = ZIP, extra = {}) {
  return {
    ok: true, ran_at: BUILT,
    coverage: { disclose: false, live_sources: 1, expected_sources: 1 },
    bundle: {
      built_at: BUILT,
      weekly: {
        opens_as_zip: true, has_all_leads: true, rows: 1, distinct_rows: 1,
        distinct_sources: 1, max_issued_date: '2026-09-28',
        rowset_sha256: 'a'.repeat(64), sha256: sha256(bytes),
      },
    },
    ...extra,
  };
}

function seed(w, { subs = [subscriber()], bytes = ZIP, status = statusFor(bytes),
  omit = [], log = [], policy = {} } = {}) {
  const objects = {
    'subscribers.json': subs, 'refresh-status.json': status,
    'feed-send-log.json': log,
    'presend-policy.json': { enforce: false, notice: false, verify_sha256: true, ...policy },
  };
  for (const [key, value] of Object.entries(objects)) {
    if (!omit.includes(key)) w.r2.set(key, value);
  }
  for (const key of ['latest-weekly.zip', 'latest-monthly.zip']) {
    if (!omit.includes(key)) w.r2.set(key, bytes, { etag: 'BUNDLE_1_TEST', uploaded: BUILT });
  }
  if (!omit.includes('latest-weekly.html')) {
    w.r2.set('latest-weekly.html', '<!doctype html><p>Synthetic town-a</p>', { uploaded: BUILT });
  }
}

function sendEntry(recipients = [EMAILS[0]], extra = {}) {
  return { at: SENT, subscribers: recipients.length,
    sent: recipients.map(to => ({ to, ok: true })), bundle_etag: 'BUNDLE_1_TEST',
    bundle_bytes: ZIP.length, bundle_rows: 1, bundle_rowset: 'a'.repeat(64),
    bundle_max_issued: '2026-09-28', ...extra };
}

function scenario(name, run, { todo, ...options } = {}) {
  test(name, { concurrency: false, ...(todo ? { todo } : {}) }, async () => {
    await withWorld(async w => run(w, await loadHandlers()), { now: NOW, ...options });
  });
}

async function call(w, handler, path, options = {}) {
  const headers = { ...await w.oidcHeaders(), ...options.headers };
  const response = await w.call(handler, path, { ...options, headers });
  return { response, body: await response.json() };
}

function mutations(w) {
  return w.r2.ops.filter(op => op.op === 'put' || op.op === 'delete');
}

scenario('I08/I14 one subscriber: actual sender records the attempt and exact accepted attachment', async (w, h) => {
  seed(w);
  const { response, body } = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(response.status, 200);
  assert.equal(body.delivered, 1); assert.equal(body.failed, 0);
  assert.equal(w.mail.length, 1); assert.deepEqual(w.mail[0].to, [EMAILS[0]]);
  assert.deepEqual(Buffer.from(w.mail[0].attachments[0].content, 'base64'), ZIP);
  assert.equal(w.r2.json('last-send-attempt.json').subscribers, 1);
  assert.deepEqual(w.r2.json('feed-send-log.json')[0].sent, [{ to: EMAILS[0], ok: true }]);
});

scenario('I11 zero subscribers is an observed no-op, not evidence of paid fulfillment', async (w, h) => {
  seed(w, { subs: [] });
  const { body } = await call(w, h.weeklySend, '/api/weekly-send');
  assert.match(body.note, /no active subscribers/);
  assert.equal(w.mail.length, 0); assert.equal(mutations(w).length, 0);
});

scenario('I12 many subscribers: active false is excluded and roster bytes are not rewritten', async (w, h) => {
  const subs = [subscriber(), subscriber(1), subscriber(2, { active: false })];
  seed(w, { subs });
  const { body } = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(body.delivered, 2);
  assert.deepEqual(w.mail.map(mail => mail.to[0]), EMAILS.slice(0, 2));
  assert.deepEqual(w.r2.json('subscribers.json'), subs);
  assert.ok(!mutations(w).some(op => op.key === 'subscribers.json'));
});

scenario('I12 missing and null active flags remain unchanged while current sender includes them', async (w, h) => {
  const absent = subscriber(1); delete absent.active;
  const subs = [subscriber(), absent, subscriber(2, { active: null }), subscriber(3, { active: false })];
  seed(w, { subs });
  await call(w, h.weeklySend, '/api/weekly-send');
  assert.deepEqual(w.mail.map(mail => mail.to[0]), EMAILS.slice(0, 3));
  assert.deepEqual(w.r2.json('subscribers.json'), subs);
  assert.ok(!Object.hasOwn(w.r2.json('subscribers.json')[1], 'active'));
});

// Main now guards each recipient's delivery week before the older etag guard.
// A settled week must preserve the original acceptance evidence without writes.
scenario('I08 control: repeated served-week skips preserve the existing guard', async (w, h) => {
  seed(w);
  await call(w, h.weeklySend, '/api/weekly-send');
  const log = w.r2.json('feed-send-log.json');
  const marker = w.r2.json('last-send-attempt.json');
  const writes = mutations(w).length;
  for (let i = 0; i < 2; i++) {
    const { body } = await call(w, h.weeklySend, '/api/weekly-send');
    assert.equal(body.skipped, "every active subscriber already has this week's email");
    assert.equal(body.already_delivered, 1);
  }
  assert.deepEqual(w.r2.json('feed-send-log.json'), log);
  assert.deepEqual(w.r2.json('last-send-attempt.json'), marker);
  assert.equal(mutations(w).length, writes);
  assert.equal(w.mail.length, 1);
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.verdict, 'ok'); assert.equal(body.retry_safe, false);
});

scenario('I08 changed bytes in one New York delivery week do not repeat an ordinary Monday delivery', async (w, h) => {
  seed(w);
  await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(w.mail.length, 1);
  const next = zipFixture('2');
  const refreshed = '2026-09-28T15:00:00.000Z';
  w.setNow(refreshed);
  const status = statusFor(next, { ran_at: refreshed });
  status.bundle.built_at = refreshed; status.bundle.weekly.rowset_sha256 = 'b'.repeat(64);
  w.r2.set('latest-weekly.zip', next, { etag: 'BUNDLE_2_TEST', uploaded: refreshed });
  w.r2.set('refresh-status.json', status);
  const repeated = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.skipped, "every active subscriber already has this week's email");
  assert.equal(repeated.body.already_delivered, 1);
  assert.equal(w.mail.length, 1, 'a new artifact is not a second weekly entitlement');
});

scenario('I08 overlapping handlers cannot both send after reading the same prior log', async (w, h) => {
  seed(w);
  const originalGet = w.r2.get.bind(w.r2);
  let arrivals = 0, release;
  const bothRead = new Promise(resolve => { release = resolve; });
  w.r2.get = async key => {
    const snapshot = await originalGet(key);
    if (key === 'feed-send-log.json' && ++arrivals <= 2) {
      if (arrivals === 2) release();
      await bothRead;
    }
    return snapshot;
  };
  await Promise.all([
    call(w, h.weeklySend, '/api/weekly-send'),
    call(w, h.weeklySend, '/api/weekly-send'),
  ]);
  assert.equal(w.mail.length, 1, 'two valid triggers require one durable recipient claim');
}, { todo: 'C06 concurrent readers can both pass the recipient-week guard before either records acceptance' });

scenario('I09 a retry of a partially accepted bundle reaches only the failed recipient', async (w, h) => {
  seed(w, { subs: [subscriber(), subscriber(1)] });
  const first = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(first.body.delivered, 1); assert.equal(first.body.failed, 1);
  assert.equal(w.mail.length, 2);
  const retry = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(retry.body.delivered, 1); assert.equal(retry.body.failed, 0);
  assert.equal(retry.body.already_delivered, 1);
  assert.equal(w.mail.length, 3, 'one failed recipient still needs this artifact');
  assert.deepEqual(w.mail.map(mail => mail.to[0]), [EMAILS[0], EMAILS[1], EMAILS[1]]);
  assert.deepEqual(w.r2.json('feed-send-log.json')[0].sent, [{ to: EMAILS[1], ok: true }]);
  assert.equal(w.r2.json('last-send-attempt.json').subscribers, 1);
  const status = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(status.body.verdict, 'ok');
  assert.equal(status.body.roster_gap, 0); assert.equal(status.body.last_failed, 0);
}, { mailResponses: [{ status: 200, body: { id: 'mail_1_TEST' } },
    { status: 500, body: { message: 'synthetic rejection TEST' } },
    { status: 200, body: { id: 'mail_2_TEST' } }] });

scenario('I11 all provider rejections do not claim successful fulfillment', async (w, h) => {
  seed(w, { subs: [subscriber(), subscriber(1)] });
  const { body } = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(body.delivered, 0); assert.equal(body.failed, 2);
  assert.equal(body.ok, false, 'all failed is not a successful send result');
}, { todo: 'C08 endpoint returns ok:true even when every provider call fails',
  mailResponses: [{ status: 500 }, { status: 500 }] });

for (const fixture of [
  { name: 'missing bundle', omit: ['latest-weekly.zip'] },
  { name: 'stale refresh', status: statusFor(ZIP, { ran_at: '2026-09-18T10:05:00.000Z' }) },
  { name: 'failed refresh', status: statusFor(ZIP, { ok: false, error: 'SYNTHETIC_TEST' }) },
  { name: 'invalid roster JSON', subs: '{INVALID_TEST' },
  { name: 'non-array roster', subs: { invalid: 'SCHEMA_TEST' } },
]) {
  scenario(`I10 existing boundary: ${fixture.name} fails before provider calls`, async (w, h) => {
    seed(w, fixture);
    const { response, body } = await call(w, h.weeklySend, '/api/weekly-send');
    assert.equal(response.status, 500); assert.equal(body.ok, false);
    assert.equal(w.mail.length, 0);
    assert.ok(!mutations(w).some(op => op.key === 'last-send-attempt.json'));
  });
}

scenario('I10 pre-send evaluates real bytes read-only and verifies the fixture hash', async (w, h) => {
  seed(w);
  const { response, body } = await call(w, h.preSend, '/api/pre-send-check');
  assert.equal(response.status, 200); assert.equal(body.verdict, 'GO');
  assert.equal(body.evidence.sha256_verified, true);
  assert.equal(body.enforcing, false); assert.equal(body.notice_enabled, false);
  assert.equal(w.mail.length, 0); assert.equal(mutations(w).length, 0);
});

for (const fault of ['missing status', 'hash mismatch', 'invalid archive', 'stale object']) {
  scenario(`I10 enabled pre-send policy blocks actual sender on ${fault}`, async (w, h) => {
    const status = statusFor();
    seed(w, { status, omit: fault === 'missing status' ? ['refresh-status.json'] : [],
      policy: { enforce: true } });
    if (fault === 'hash mismatch') {
      status.bundle.weekly.sha256 = '0'.repeat(64); w.r2.set('refresh-status.json', status);
    } else if (fault === 'invalid archive') {
      const invalid = Buffer.from('NOT_A_ZIP_TEST');
      status.bundle.weekly.sha256 = sha256(invalid); status.bundle.weekly.opens_as_zip = false;
      w.r2.set('refresh-status.json', status);
      w.r2.set('latest-weekly.zip', invalid, { etag: 'INVALID_TEST', uploaded: BUILT });
    } else if (fault === 'stale object') {
      w.r2.set('latest-weekly.zip', ZIP, { etag: 'OLD_TEST', uploaded: '2026-09-21T10:05:00.000Z' });
    }
    const gate = await call(w, h.preSend, '/api/pre-send-check');
    assert.equal(gate.body.enforcing, true); assert.equal(gate.body.verdict, 'NO_GO');
    assert.equal(w.mail.length, 0);
    await call(w, h.weeklySend, '/api/weekly-send');
    assert.equal(w.mail.length, 0, 'an explicitly enforcing NO_GO must govern the actual sender');
  }, { todo: 'C07 pre-send diagnosis is not an enforced boundary in weekly-send' });
}

scenario('I13 C10 fail-open sends and records delivery after a prior-log read failure', async (w, h) => {
  const prior = sendEntry();
  seed(w, { log: [prior] });
  w.r2.failNext('get', 'feed-send-log.json');
  const { response, body } = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(response.status, 200); assert.equal(body.ok, true);
  assert.equal(body.delivered, 1); assert.equal(body.failed, 0);
  assert.equal(body.skipped, undefined);
  assert.deepEqual(w.mail.map(mail => mail.to), [[EMAILS[0]]],
    'this call sends exactly once to the active subscriber despite unreadable history');
  const attempt = w.r2.json('last-send-attempt.json');
  assert.equal(attempt.at, NOW); assert.equal(attempt.subscribers, 1);
  const log = w.r2.json('feed-send-log.json');
  assert.equal(log.length, 2);
  assert.equal(log[0].at, NOW); assert.equal(log[0].subscribers, 1);
  assert.deepEqual(log[0].sent, [{ to: EMAILS[0], ok: true }]);
  assert.deepEqual(log[1], prior, 'a later successful read preserves the original delivery evidence');
});

for (const timing of [
  { now: '2026-09-28T13:29:59.000Z', verdict: 'not_due', retry: false },
  { now: '2026-09-28T13:30:00.000Z', verdict: 'missed', retry: true },
]) {
  scenario(`I13 watchdog UTC grace boundary at ${timing.now}`, async (w, h) => {
    seed(w);
    const { body } = await call(w, h.sendStatus, '/api/send-status');
    assert.equal(body.verdict, timing.verdict); assert.equal(body.retry_safe, timing.retry);
    assert.equal(body.due_at, '2026-09-28T12:00:00.000Z');
    assert.equal(w.mail.length, 0); assert.equal(mutations(w).length, 0);
  }, { now: timing.now });
}

scenario('I13 a late-week check preserves the accepted Monday result', async (w, h) => {
  seed(w, { log: [sendEntry()] });
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.verdict, 'ok'); assert.equal(body.retry_safe, false);
  assert.equal(body.due_at, '2026-09-28T12:00:00.000Z');
}, { now: '2026-10-02T18:00:00.000Z' });

scenario('I13 success then later rejection in the same week does not erase fulfilled coverage', async (w, h) => {
  seed(w, { log: [sendEntry([], { at: '2026-09-28T13:00:00.000Z',
    sent: [{ to: EMAILS[0], ok: false, error: 'SYNTHETIC_TEST' }] }), sendEntry()] });
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.verdict, 'ok'); assert.equal(body.retry_safe, false);
});

scenario('I12 explicitly active roster member absent from the recorded send raises a gap', async (w, h) => {
  seed(w, { subs: [subscriber(), subscriber(1)], log: [sendEntry()] });
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.verdict, 'roster_gap'); assert.equal(body.roster_gap, 1);
  assert.equal(body.retry_safe, false);
});

scenario('I12 watchdog membership agrees with sender for the preserved missing-active row', async (w, h) => {
  const absent = subscriber(1); delete absent.active;
  seed(w, { subs: [subscriber(), absent] });
  await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(w.mail.length, 2, 'establish actual sender membership first');
  assert.ok(!Object.hasOwn(w.r2.json('subscribers.json')[1], 'active'));
  w.r2.set('feed-send-log.json', [sendEntry()]);
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.roster_gap, 1, 'the sender-selected member was not served in this log');
  assert.notEqual(body.verdict, 'ok');
}, { todo: 'C09 D2 approved: sender serves missing-active rows but watchdog excludes them' });

for (const fault of ['unavailable', 'malformed']) {
  scenario(`I13 ${fault} roster evidence cannot certify a complete send`, async (w, h) => {
    seed(w, { log: [sendEntry()] });
    if (fault === 'unavailable') w.r2.failNext('get', 'subscribers.json');
    else w.r2.set('subscribers.json', '{INVALID_TEST');
    const { body } = await call(w, h.sendStatus, '/api/send-status');
    assert.equal(body.retry_safe, false);
    assert.notEqual(body.verdict, 'ok', 'unreadable membership is not verified complete coverage');
  }, { todo: 'C10 watchdog swallows roster read/parse failures and returns an apparent clean send' });
}

for (const key of ['feed-send-log.json', 'last-send-attempt.json']) {
  scenario(`I13 unavailable ${key} cannot authorize a retry`, async (w, h) => {
    seed(w);
    w.r2.failNext('get', key);
    const { body } = await call(w, h.sendStatus, '/api/send-status');
    assert.equal(body.retry_safe, false, 'absence and failed evidence reads have different safety implications');
  }, { todo: 'C10 failed reads collapse to absent evidence and retry_safe:true' });
}

scenario('I14 durable attempt plus failed result write reports unknown and forbids retry', async (w, h) => {
  seed(w);
  w.r2.failNext('put', 'feed-send-log.json');
  await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(w.mail.length, 1);
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.verdict, 'unknown'); assert.equal(body.retry_safe, false);
});

scenario('I14 lost attempt and result writes cannot coexist with provider acceptance and a safe retry', async (w, h) => {
  seed(w);
  w.r2.failNext('put', 'last-send-attempt.json');
  w.r2.failNext('put', 'feed-send-log.json');
  await call(w, h.weeklySend, '/api/weekly-send');
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.ok(!(w.mail.length > 0 && body.retry_safe),
    'accepted mail whose bookkeeping vanished must not be classified as a known-safe fresh send');
}, { todo: 'C11 sender proceeds after attempt write failure and can lose every delivery marker' });

scenario('I14 provider acceptance identity survives in durable per-recipient evidence', async (w, h) => {
  seed(w);
  await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(w.mail.length, 1);
  assert.ok(JSON.stringify(w.r2.json('feed-send-log.json')).includes('mail_ACCEPTED_TEST'),
    'the accepted provider ID is required for later reconciliation, not human-receipt proof');
}, { todo: 'C11 weekly sender discards the successful provider response ID',
  mailResponses: [{ status: 200, body: { id: 'mail_ACCEPTED_TEST' } }] });

scenario('I15 scope control: a clean roster verdict performs no payment reconciliation', async (w, h) => {
  // This intentionally documents a LIMIT, not completion of I15. The existing
  // Mission reconciliation oracle owns payment classification/pagination tests.
  seed(w, { log: [sendEntry()] });
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.verdict, 'ok');
  assert.ok(!JSON.stringify(w.fetchCalls).includes('api.stripe.com'));
  assert.equal(w.mail.length, 0); assert.equal(mutations(w).length, 0);
});

function heartbeat(extra = {}) {
  return { last_live_run_at: '2026-09-28T12:00:00.000Z',
    last: { roster_armed: true, roster_active: 1, roster_cancelled: 0,
      waiting: 0, oldest_hours: 0, scanned: 1, errors: 0,
      customers_waiting: 0, humans_waiting: 0, cold_replies_waiting: 0 },
    history: [], ...extra };
}

for (const fixture of [
  { name: 'missing installation', state: null, verdict: 'never', alert: true },
  { name: 'dry run only', state: heartbeat({ last_live_run_at: null,
    last_dry_run_at: '2026-09-28T13:00:00.000Z' }), verdict: 'never', alert: true },
  { name: 'healthy', state: heartbeat(), verdict: 'ok', alert: false },
  { name: 'stale live heartbeat', state: heartbeat({ last_live_run_at: '2026-09-27T07:00:00.000Z' }),
    verdict: 'stale', alert: true },
  { name: 'unarmed roster', state: heartbeat({ last: { ...heartbeat().last, roster_armed: false } }),
    verdict: 'unarmed', alert: true },
  { name: 'under escalation threshold', state: heartbeat({ last: { ...heartbeat().last, waiting: 1, oldest_hours: 71 } }),
    verdict: 'waiting', alert: false },
  { name: 'at escalation threshold', state: heartbeat({ last: { ...heartbeat().last, waiting: 1, oldest_hours: 72 } }),
    verdict: 'backlog', alert: true },
]) {
  scenario(`I27 inbox handler ${fixture.name}`, async (w, h) => {
    if (fixture.state) w.r2.set('inbox-watchdog-state.json', fixture.state);
    const { response, body } = await call(w, h.inboxStatus, '/api/inbox-status');
    assert.equal(response.status, 200); assert.equal(body.verdict, fixture.verdict);
    assert.equal(body.alert, fixture.alert);
    assert.equal(w.mail.length, 0); assert.equal(mutations(w).length, 0);
  });
}

for (const fault of ['read failure', 'invalid JSON']) {
  scenario(`I27 inbox ${fault} stays distinguishable from never installed`, async (w, h) => {
    w.r2.set('inbox-watchdog-state.json', fault === 'invalid JSON' ? '{INVALID_TEST' : heartbeat());
    if (fault === 'read failure') w.r2.failNext('get', 'inbox-watchdog-state.json');
    const { body } = await call(w, h.inboxStatus, '/api/inbox-status');
    assert.equal(body.alert, true);
    assert.notEqual(body.verdict, 'never', 'unreadable state does not establish absence of prior monitoring');
  }, { todo: 'C20 inbox safe reader erases the distinction between missing and unreadable evidence' });
}

scenario('I27 unusable heartbeat timestamp cannot look like a healthy live monitor', async (w, h) => {
  w.r2.set('inbox-watchdog-state.json', heartbeat({ last_live_run_at: 'INVALID_DATE_TEST' }));
  const { body } = await call(w, h.inboxStatus, '/api/inbox-status');
  assert.equal(body.alert, true);
  assert.notEqual(body.verdict, 'ok');
}, { todo: 'C20 invalid timestamp produces NaN age and falls through to ok' });

scenario('I27 owner relay exposes a provider rejection instead of claiming accepted mail', async (w, h) => {
  const { response, body } = await call(w, h.mailOwner, '/api/mail-owner?subject=ALERT_TEST',
    { method: 'POST', body: '<p>Synthetic owner alert TEST</p>' });
  assert.equal(response.status, 502); assert.equal(body.ok, false);
  assert.equal(w.mail.length, 1);
}, { mailResponses: [{ status: 500, body: { message: 'SYNTHETIC_TEST' } }] });

scenario('I28 notice helpers are pure renderers, not proof of customer-notice integration', async (w, h) => {
  // Customer-notice activation/wording is an owner decision. Exercise actual
  // helper contracts without blessing dormant refund wording or sending it.
  const rendered = h.notice.nothingThisWeek({ first_name: 'Casey <&>', reason_code: 'no_bundle' });
  assert.match(rendered.html, /Casey &lt;&amp;&gt;/);
  assert.doesNotMatch(rendered.html, /Casey <&>/);
  assert.equal(h.notice.disclosureBlock(['no_new_rows'], {}), '');
  assert.equal(w.mail.length, 0); assert.equal(mutations(w).length, 0);
});

scenario('I28 default pre-send policy does not claim customer notices are enabled', async (w, h) => {
  seed(w, { omit: ['latest-weekly.zip'] });
  const { body } = await call(w, h.preSend, '/api/pre-send-check');
  assert.equal(body.verdict, 'NO_GO'); assert.equal(body.code, 'no_bundle');
  assert.equal(body.notice_enabled, false); assert.equal(body.customer_gets_nothing, true);
  assert.equal(w.mail.length, 0);
});

scenario('I29 actual weekly customer mail contains neither prohibited long dash', async (w, h) => {
  seed(w);
  await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(w.mail.length, 1);
  assert.doesNotMatch(w.mail[0].subject + w.mail[0].html, /[\u2013\u2014]/u);
});

scenario('I29 owner-facing watchdog grace text contains neither prohibited long dash', async (w, h) => {
  seed(w);
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.verdict, 'not_due');
  assert.doesNotMatch(body.detail, /[\u2013\u2014]/u);
}, { now: '2026-09-28T13:00:00.000Z',
  todo: 'C19 owner-facing status wording still includes a prohibited long dash; workflows remain untouched' });

function seedOldEvent(w) {
  seed(w);
  w.r2.set('engagement.json', { instrumented_at: '2026-09-08', rows: [], counts: {}, transitions: [] });
  w.r2.set(OLD_DL, '', { customMetadata: { t: subscriber().token.slice(0, 8), k: 'weekly', d: 'd' } });
}

scenario('I30 future retention: successful save may prune an attributed event without mailing or billing mutation', async (w, h) => {
  seedOldEvent(w);
  const before = w.r2.json('subscribers.json');
  const { response, body } = await call(w, h.engagement, '/api/engagement');
  assert.equal(response.status, 200); assert.equal(body.stored, true);
  assert.equal(body.malformed_events, 0);
  assert.equal(w.r2.json('engagement.json').rows[0].downloads, 1);
  assert.equal(w.r2.json('engagement.json').rows[0].first_download, OLD_EVENT_AT);
  assert.equal(body.pruned, 1); assert.equal(await w.r2.get(OLD_DL), null);
  assert.deepEqual(w.r2.json('subscribers.json'), before); assert.equal(w.mail.length, 0);
}, { now: RETENTION_NOW });

scenario('I30 future retention: failed aggregate persistence retains attributed source telemetry for a rebuild', async (w, h) => {
  seedOldEvent(w);
  w.r2.failNext('put', 'engagement.json');
  const { body } = await call(w, h.engagement, '/api/engagement');
  assert.equal(body.stored, false);
  assert.equal(body.malformed_events, 0);
  assert.equal(body.pruned, 0, 'source events may not be discarded before their aggregate is durable');
  assert.notEqual(await w.r2.get(OLD_DL), null);
}, { now: RETENTION_NOW, todo: 'C20 runRollup prunes old events even after aggregate put fails' });

scenario('I27/I30 failed event listing is a visible rollup error and performs no retention writes', async (w, h) => {
  seedOldEvent(w);
  w.r2.failNext('list', 'dl/');
  const { response, body } = await call(w, h.engagement, '/api/engagement');
  assert.equal(response.status, 500); assert.equal(body.ok, false);
  assert.equal(mutations(w).length, 0); assert.equal(w.mail.length, 0);
}, { now: RETENTION_NOW });
