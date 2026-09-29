import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadHandlers, withWorld } from '../harness/index.mjs';

// S6: bounded failures through real handlers. Storage, OIDC and provider calls
// remain inside the synthetic world. Nothing invokes a workflow or real API.
const NOW = '2026-09-28T14:00:00.000Z';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const email = index => index === 0 ? 'casey@example.com' : `casey+${index}@example.com`;
const row = index => ({ email: email(index), name: 'Casey', active: true,
  customer: `cus_S6_${index}_TEST`, since: '2026-01-01',
  token: hash(Buffer.from(`S6_SUBSCRIBER_${index}_TEST`)).slice(0, 32) });

function fixtureZip(issuedDate) {
  const entries = [
    ['ALL-leads.csv', 'Source,City,Issued Date,Permit Number,Description,Status\r\n' +
      `town-a,town-a,${issuedDate},PERMIT_S6_TEST,Synthetic fixture,Issued\r\n`],
    ['MassPermits-Leads.html', '<!doctype html><title>town-a TEST</title><p>PERMIT_S6_TEST</p>'],
  ];
  const local = [], central = [];
  let offset = 0;
  for (const [filename, text] of entries) {
    const name = Buffer.from(filename), bytes = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const lh = Buffer.alloc(30), ch = Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(33, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(bytes.length, 18);
    lh.writeUInt32LE(bytes.length, 22); lh.writeUInt16LE(name.length, 26);
    ch.writeUInt32LE(0x02014b50); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(33, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(bytes.length, 20); ch.writeUInt32LE(bytes.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    local.push(lh, name, bytes); central.push(ch, name);
    offset += lh.length + name.length + bytes.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

function seed(w, count = 1) {
  const uploaded = new Date(w.now - 3600_000).toISOString();
  const bundle = fixtureZip(uploaded.slice(0, 10));
  w.r2.set('subscribers.json', Array.from({ length: count }, (_, i) => row(i)));
  w.r2.set('feed-send-log.json', []);
  w.r2.set('presend-policy.json', { enforce: false, notice: false, verify_sha256: true });
  w.r2.set('refresh-status.json', {
    ran_at: uploaded, ok: true,
    coverage: { disclose: false, live_sources: 1, expected_sources: 1 },
    bundle: { built_at: uploaded, weekly: { sha256: hash(bundle), rows: 1,
      distinct_rows: 1, distinct_sources: 1, max_issued_date: uploaded.slice(0, 10),
      rowset_sha256: '6'.repeat(64), opens_as_zip: true, has_all_leads: true } },
  });
  w.r2.set('latest-weekly.zip', bundle, { etag: 'BUNDLE_S6_TEST', uploaded });
  w.r2.set('latest-weekly.html', '<!doctype html><p>town-a TEST</p>', { uploaded });
}

function scenario(name, run, { todo, ...options } = {}) {
  test(name, { concurrency: false, timeout: 10000, ...(todo ? { todo } : {}) }, async () => {
    await withWorld(async w => run(w, await loadHandlers()), { now: NOW, ...options });
  });
}

async function call(w, handler, path, options = {}) {
  const response = await w.call(handler, path,
    { ...options, headers: { ...await w.oidcHeaders(), ...options.headers } });
  return { response, body: await response.json() };
}

const writes = w => w.r2.ops.filter(op => op.op === 'put' || op.op === 'delete');
const providerResponses = statuses => statuses.map((status, i) => ({ status,
  body: status === 200 ? { id: `mail_S6_${i}_TEST` } : { message: `SYNTHETIC_${status}_TEST` } }));

for (const count of [0, 1, 50, 250]) {
  scenario(`S6 I08/I12 ${count} eligible rows have bounded attempts and no roster mutation`, async (w, h) => {
    seed(w, count);
    const before = w.r2.text('subscribers.json');
    const { body } = await call(w, h.weeklySend, '/api/weekly-send');
    assert.equal(w.mail.length, count);
    assert.equal(new Set(w.mail.map(mail => mail.to[0])).size, count);
    for (let i = 0; i < count; i++) assert.equal(w.mail[i].to[0], email(i));
    assert.ok(w.r2.text('subscribers.json') === before, 'the source roster must remain byte-identical');
    assert.equal(writes(w).filter(op => op.key === 'subscribers.json').length, 0);
    if (count) {
      assert.equal(body.delivered, count); assert.equal(body.failed, 0);
      const result = w.r2.json('feed-send-log.json')[0];
      assert.equal(result.sent.length, count);
      assert.equal(result.sent.filter(item => item.ok).length, count);
      assert.equal(w.r2.json('last-send-attempt.json').subscribers, count);
    } else {
      assert.match(body.note, /no active subscribers/);
      assert.equal(writes(w).length, 0);
    }
  });
}

scenario('S6 I09/I13 mixed 429, 500 and 200 outcomes record every recipient and preserve a partial verdict', async (w, h) => {
  seed(w, 3);
  const { body } = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(w.mail.length, 3, 'one provider rejection must not drop later recipients');
  assert.equal(body.delivered, 1); assert.equal(body.failed, 2);
  assert.deepEqual(w.r2.json('feed-send-log.json')[0].sent.map(item => item.ok), [false, false, true]);
  const checked = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(checked.body.verdict, 'partial');
  assert.equal(checked.body.retry_safe, false);
  assert.equal(w.mail.length, 3, 'the diagnostic handler never retries provider calls');
}, { mailResponses: providerResponses([429, 500, 200]) });

scenario('S6 I10 bundle-body read failure stops before the attempt marker or provider request', async (w, h) => {
  seed(w);
  const get = w.r2.get.bind(w.r2);
  let bodyReads = 0;
  w.r2.get = async (key, options) => {
    const object = await get(key, options);
    if (key === 'latest-weekly.zip' && object) {
      object.arrayBuffer = async () => {
        bodyReads++;
        throw new Error('SYNTHETIC_BODY_READ_FAILURE_TEST');
      };
    }
    return object;
  };
  const { response, body } = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(response.status, 500); assert.equal(body.ok, false);
  assert.equal(bodyReads, 1, 'the failed body is neither hung nor silently retried');
  assert.equal(w.mail.length, 0); assert.equal(writes(w).length, 0);
});

const clockCases = [
  { name: 'Monday UTC midnight', now: '2026-09-28T00:00:00.000Z',
    due: '2026-09-21T12:00:00.000Z', accepted: '2026-09-21T12:05:00.000Z', verdict: 'ok', retry: false },
  { name: 'Monday just before noon UTC', now: '2026-09-28T11:59:59.000Z',
    due: '2026-09-21T12:00:00.000Z', accepted: '2026-09-21T12:05:00.000Z', verdict: 'ok', retry: false },
  { name: 'Monday noon opens the new grace window', now: '2026-09-28T12:00:00.000Z',
    due: '2026-09-28T12:00:00.000Z', accepted: '2026-09-21T12:05:00.000Z', verdict: 'not_due', retry: false },
  { name: 'Monday after spring DST still uses 13:30 UTC', now: '2026-03-09T13:30:00.000Z',
    due: '2026-03-09T12:00:00.000Z', accepted: '2026-03-02T12:05:00.000Z', verdict: 'missed', retry: true },
  { name: 'Monday after fall DST still uses 13:30 UTC', now: '2026-11-02T13:30:00.000Z',
    due: '2026-11-02T12:00:00.000Z', accepted: '2026-10-26T12:05:00.000Z', verdict: 'missed', retry: true },
];

for (const clock of clockCases) {
  scenario(`S6 I13 ${clock.name}`, async (w, h) => {
    seed(w);
    w.r2.set('feed-send-log.json', [{ at: clock.accepted, subscribers: 1,
      sent: [{ to: email(0), ok: true }], bundle_etag: 'PRIOR_WEEK_TEST' }]);
    const { body } = await call(w, h.sendStatus, '/api/send-status');
    assert.equal(body.due_at, clock.due); assert.equal(body.verdict, clock.verdict);
    assert.equal(body.retry_safe, clock.retry);
    assert.equal(w.mail.length, 0); assert.equal(writes(w).length, 0);
  }, { now: clock.now });
}

scenario('S6 I13 both fall-back 01:30 New York instants retain the same UTC weekly window', async (w, h) => {
  seed(w);
  w.r2.set('feed-send-log.json', [{ at: '2026-10-26T12:05:00.000Z', subscribers: 1,
    sent: [{ to: email(0), ok: true }], bundle_etag: 'PRIOR_WEEK_TEST' }]);
  for (const instant of ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']) {
    w.setNow(instant);
    const { body } = await call(w, h.sendStatus, '/api/send-status');
    assert.equal(body.due_at, '2026-10-26T12:00:00.000Z');
    assert.equal(body.verdict, 'ok'); assert.equal(body.retry_safe, false);
  }
  assert.equal(w.mail.length, 0); assert.equal(writes(w).length, 0);
}, { now: '2026-11-01T05:30:00.000Z' });

// Explicit force is used only to construct legitimate multiple-run histories.
// These cases test the watchdog's aggregate verdict, not a new force policy.
for (const history of [
  { name: 'earlier complete then later partial', statuses: [200, 200, 200, 500],
    first: 2, second: 1, todo: 'C08 a later partial entry hides earlier complete weekly coverage' },
  { name: 'disjoint accepted recipients across two partial runs', statuses: [200, 500, 500, 200],
    first: 1, second: 1, todo: 'C08 selecting one best entry misses complete per-recipient coverage across runs' },
  { name: 'later complete recovery after an earlier partial run', statuses: [200, 500, 200, 200],
    first: 1, second: 2 },
]) {
  scenario(`S6 I13 ${history.name}`, async (w, h) => {
    seed(w, 2);
    const first = await call(w, h.weeklySend, '/api/weekly-send');
    assert.equal(first.body.delivered, history.first);
    w.setNow('2026-09-28T14:05:00.000Z');
    const second = await call(w, h.weeklySend, '/api/weekly-send?force=1');
    assert.equal(second.body.delivered, history.second);
    const accepted = new Set(w.r2.json('feed-send-log.json')
      .flatMap(entry => entry.sent || []).filter(item => item.ok).map(item => item.to));
    assert.equal(accepted.size, 2, 'the fixture records provider acceptance for both roster members');
    const { body } = await call(w, h.sendStatus, '/api/send-status');
    assert.equal(body.retry_safe, false);
    assert.equal(body.verdict, 'ok', 'weekly fulfillment is per recipient, not per chosen log entry');
  }, { mailResponses: providerResponses(history.statuses), ...(history.todo ? { todo: history.todo } : {}) });
}

scenario('S6 I13 twelve identical-bundle skips do not erase a known accepted weekly outcome', async (w, h) => {
  seed(w);
  const sent = await call(w, h.weeklySend, '/api/weekly-send');
  assert.equal(sent.body.delivered, 1);
  for (let i = 1; i <= 12; i++) {
    w.setNow(Date.parse(NOW) + i * 60_000);
    const skipped = await call(w, h.weeklySend, '/api/weekly-send');
    assert.match(skipped.body.skipped, /identical bundle/);
  }
  assert.equal(w.mail.length, 1, 'the existing duplicate guard still works');
  assert.equal(w.r2.json('feed-send-log.json').length, 12);
  const { body } = await call(w, h.sendStatus, '/api/send-status');
  assert.equal(body.retry_safe, false);
  assert.equal(body.verdict, 'ok', 'diagnostic retention must not convert an accepted week into a missed product');
}, { todo: 'C08 the bounded log retains skips while discarding the current-week accepted entry' });

function seedDownloadPages(w, count = 1005) {
  seed(w);
  w.r2.set('engagement.json', { instrumented_at: '2026-09-08', rows: [], counts: {}, transitions: [] });
  const start = Date.parse('2026-09-09T00:00:00.000Z');
  for (let i = 0; i < count; i++) {
    // Eleven-minute spacing stays outside the actual ten-minute click dedupe.
    const at = start + i * 11 * 60_000;
    const day = new Date(at).toISOString().slice(0, 10);
    w.r2.set(`dl/${day}/${at}-${i.toString(16).padStart(8, '0')}`, '',
      { customMetadata: { t: row(0).token.slice(0, 8), k: 'weekly', d: 'd' } });
  }
}

scenario('S6 I30 engagement reads all 1005 metadata events across the R2 page boundary', async (w, h) => {
  seedDownloadPages(w);
  const { response, body } = await call(w, h.engagement, '/api/engagement');
  assert.equal(response.status, 200); assert.equal(body.stored, true);
  assert.equal(body.malformed_events, 0); assert.equal(body.downloads_28d, 1005);
  assert.equal(w.r2.json('engagement.json').rows[0].downloads, 1005);
  assert.equal(body.pruned, 0);
  assert.equal(w.r2.ops.filter(op => op.op === 'list' && op.key === 'dl/').length, 2);
  assert.equal(w.r2.ops.filter(op => op.op === 'get' && op.key.startsWith('dl/')).length, 0);
  assert.equal(w.mail.length, 0);
});

scenario('S6 I27/I30 second-page list failure cannot publish a partial aggregate or prune evidence', async (w, h) => {
  seedDownloadPages(w);
  const before = w.r2.text('engagement.json');
  const list = w.r2.list.bind(w.r2);
  w.r2.list = async options => {
    if (options.prefix === 'dl/' && options.cursor) w.r2.failNext('list', 'dl/');
    return list(options);
  };
  const { response, body } = await call(w, h.engagement, '/api/engagement');
  assert.equal(response.status, 500); assert.equal(body.ok, false);
  assert.equal(w.r2.ops.filter(op => op.op === 'list' && op.key === 'dl/').length, 2);
  assert.ok(w.r2.text('engagement.json') === before, 'the prior complete aggregate must survive');
  assert.equal(writes(w).length, 0); assert.equal(w.mail.length, 0);
});
