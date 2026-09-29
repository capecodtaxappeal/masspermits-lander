import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost as webhook } from '../functions/api/stripe-webhook.js';

// This file is standalone: all storage and mail are synthetic and network is closed.
const SECRET = 'whsec_TEST_offline';
const RealDate = Date;
function signedRequest(payload) {
  const body = JSON.stringify(payload), t = String(Math.floor(Date.now() / 1000));
  const mac = createHmac('sha256', SECRET).update(t + '.' + body).digest('hex');
  return new Request('https://example.invalid/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': 't=' + t + ',v1=' + mac }, body,
  });
}
async function withWorld(fn, { now = '2026-09-28T14:00:00.000Z' } = {}) {
  const objects = new Map(), faults = [], mail = [], ops = [];
  let version = 0;
  const r2 = {
    ops,
    set(key, value) {
      const body = typeof value === 'string' ? value : JSON.stringify(value);
      const object = { body, etag: 'etag_TEST_' + (++version) };
      objects.set(key, object); return object;
    },
    text(key) { return objects.get(key)?.body ?? null; },
    json(key) { const text = this.text(key); return text === null ? null : JSON.parse(text); },
    failNext(op, key, error) { faults.push({ op, key, error }); },
    check(op, key) {
      const i = faults.findIndex(f => f.op === op && f.key === key);
      if (i >= 0) throw faults.splice(i, 1)[0].error;
    },
    async get(key) {
      ops.push({ op: 'get', key }); this.check('get', key);
      const item = objects.get(key); if (!item) return null;
      const { body, etag } = item; // Immutable body and etag from the same snapshot.
      return { etag, text: async () => body,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    },
    async put(key, value, options = {}) {
      ops.push({ op: 'put', key, onlyIf: structuredClone(options.onlyIf) });
      this.check('put', key);
      const current = objects.get(key), condition = options.onlyIf;
      if (condition?.etagMatches && current?.etag !== condition.etagMatches) return null;
      if (condition?.etagDoesNotMatch === '*' && current) return null;
      return this.set(key, value);
    },
  };
  const env = { BUNDLES: r2, STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 're_TEST',
    FROM_EMAIL: 'casey@example.com', OWNER_EMAIL: 'casey+owner@example.com' };
  const oldFetch = globalThis.fetch, oldDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return RealDate.parse(now); }
  };
  const world = { r2, env, mail, providerStatus: 200, providerBody: '{"id":"mail_TEST"}',
    async call(handler, path, init) {
      return handler({ request: new Request('https://example.invalid' + path, init), env });
    },
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.resend.com/emails', 'unexpected network route');
    mail.push(JSON.parse(init.body));
    return new Response(world.providerBody, { status: world.providerStatus });
  };
  try { return await fn(world); }
  finally { globalThis.fetch = oldFetch; globalThis.Date = oldDate; }
}
const NOW = '2026-09-28T14:00:00.000Z';
const EMAIL = 'casey@example.com', OTHER = 'casey+second@example.com';
const CUSTOMER = 'cus_TEST_primary', SECOND_ID = 'cus_TEST_second';
const TOKEN = '1'.repeat(32), OTHER_TOKEN = '2'.repeat(32);
const KEY = 'subscribers.json';
const check = (name, fn) => test(name, { concurrency: false, timeout: 10000 }, fn);

function row(extra = {}) {
  return { email: EMAIL, customer: CUSTOMER, name: 'Casey', token: TOKEN,
    since: '2026-09-01', active: true, custom: { keep: ['nested_TEST', 0, false] }, ...extra };
}
function other(extra = {}) {
  return row({ email: OTHER, customer: SECOND_ID, token: OTHER_TOKEN, label: 'unrelated_TEST', ...extra });
}
function event(type, object, suffix = 'primary') {
  return { id: 'evt_' + suffix + '_TEST', type, created: Date.parse(NOW) / 1000 - 30,
    livemode: false, data: { object } };
}
function checkout(email = EMAIL, customer = CUSTOMER) {
  return event('checkout.session.completed', {
    id: 'cs_' + customer + '_TEST', mode: 'subscription', amount_total: 9900,
    currency: 'usd', payment_status: 'paid', customer,
    customer_details: { email, name: 'Casey' },
  }, 'checkout_' + customer);
}
function cancel(email = EMAIL, customer = CUSTOMER) {
  return event('customer.subscription.deleted', { id: 'sub_' + customer + '_TEST',
    customer, customer_email: email, status: 'canceled' }, 'cancel_' + customer);
}
function flag(email = EMAIL, customer = CUSTOMER) {
  return event('invoice.payment_failed', { id: 'in_' + customer + '_TEST',
    customer, customer_email: email, attempt_count: 2, amount_due: 9900 }, 'flag_' + customer);
}
function clear(email = EMAIL, customer = CUSTOMER) {
  return event('review.closed', { id: 'prv_' + customer + '_TEST',
    customer, customer_email: email, closed_reason: 'approved' }, 'clear_' + customer);
}
const writers = [
  { name: 'enrollment', payload: checkout,
    initial: () => { const r = row({ customer: 'cus_TEST_previous' }); delete r.active; return r; },
    verify: r => { assert.equal(r.customer, CUSTOMER); assert.equal(Object.hasOwn(r, 'active'), false); },
    missingMail: 1 },
  { name: 'deactivation', payload: cancel,
    initial: () => { const r = row(); delete r.active; return r; },
    verify: r => { assert.equal(r.active, false); assert.equal(r.cancelled, '2026-09-28'); },
    missingMail: 0 },
  { name: 'payment flag', payload: flag,
    initial: () => { const r = row(); delete r.active; return r; },
    verify: r => { assert.equal(Object.hasOwn(r, 'active'), false); assert.equal(r.payment_failing, '2026-09-28'); },
    missingMail: 1 },
  { name: 'payment clear', payload: clear,
    initial: () => { const r = row({ payment_failing: '2026-09-27', payment_detail: { keepUntilCleared: true } }); delete r.active; return r; },
    verify: r => { assert.equal(Object.hasOwn(r, 'active'), false); assert.equal(Object.hasOwn(r, 'payment_failing'), false); assert.equal(Object.hasOwn(r, 'payment_detail'), false); },
    missingMail: 1 },
];
async function using(fn, { rows = [row(), other()], missing = false } = {}) {
  return withWorld(async w => {
    w.env.OWNER_EMAIL = 'casey+owner@example.com'; w.env.FROM_EMAIL = 'casey@example.com';
    w.r2.set('latest-monthly.zip', 'SYNTHETIC_MONTHLY_BYTES_TEST');
    w.r2.set('latest-weekly.zip', 'SYNTHETIC_WEEKLY_BYTES_TEST');
    if (!missing) w.r2.set(KEY, rows);
    return fn(w);
  }, { now: NOW });
}
async function invoke(w, payload) {
  const request = signedRequest(payload);
  const response = await w.call(webhook, '/api/stripe-webhook', {
    method: 'POST', headers: request.headers, body: await request.text(),
  });
  return { status: response.status, body: await response.json() };
}
function rosterPuts(w) { return w.r2.ops.filter(op => op.op === 'put' && op.key === KEY); }
function conditionalPuts(w) {
  const puts = rosterPuts(w);
  assert.ok(puts.length > 0);
  for (const op of puts) {
    assert.ok(op.onlyIf && (typeof op.onlyIf.etagMatches === 'string' || op.onlyIf.etagDoesNotMatch === '*'),
      'every roster writer must retain a conditional storage boundary');
  }
}
function overlapTwoReads(w) {
  const get = w.r2.get.bind(w.r2);
  let count = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  w.r2.get = async (key, ...args) => {
    const snapshot = await get(key, ...args);
    if (key === KEY && count < 2) {
      count++;
      if (count === 2) release();
      await barrier;
    }
    return snapshot;
  };
}
function assertUnavailable(result, w) {
  assert.equal(result.status, 500); assert.equal(result.body.ok, false);
  assert.match(result.body.error, /^subscriber (?:enrollment|roster update) unavailable$/);
  assert.equal(w.mail.length, 0, 'failed roster work must stop before customer AND owner requests');
  assert.doesNotMatch(JSON.stringify(result.body), /CASEY_PRIVATE_TEST|casey@example\.com|cus_TEST/);
}

for (const writer of writers) {
  check('C05 ' + writer.name + ' conditions its write on the body snapshot and preserves unrelated fields', async () => {
    const primary = writer.initial(), unrelated = other(); delete unrelated.active;
    await using(async w => {
      let snapshotEtag;
      const get = w.r2.get.bind(w.r2);
      w.r2.get = async (key, ...args) => {
        const object = await get(key, ...args);
        if (key === KEY) snapshotEtag = object?.etag;
        return object;
      };
      const result = await invoke(w, writer.payload());
      assert.equal(result.status, 200);
      conditionalPuts(w);
      assert.deepEqual(rosterPuts(w).map(op => op.onlyIf), [{ etagMatches: snapshotEtag }]);
      assert.equal(w.r2.ops.some(op => op.op === 'head' && op.key === KEY), false,
        'body and etag must come from one get, never a separate head');
      const saved = w.r2.json(KEY);
      assert.equal(saved[0].token, TOKEN); assert.equal(saved[0].since, primary.since);
      assert.deepEqual(saved[0].custom, primary.custom); assert.deepEqual(saved[1], unrelated);
      writer.verify(saved[0]);
    }, { rows: [primary, unrelated] });
  });
}

for (const writer of writers.slice(1)) {
  check('C05 missing roster stays a storage no-op for ' + writer.name, async () => {
    await using(async w => {
      const result = await invoke(w, writer.payload());
      assert.equal(result.status, 200); assert.equal(w.r2.text(KEY), null);
      assert.equal(rosterPuts(w).length, 0);
      // Preserve the existing non-enrollment caller's owner-notification policy.
      assert.equal(w.mail.length, writer.missingMail);
    }, { missing: true });
  });

  for (const fault of ['read', 'corrupt', 'put']) {
    check('C05 ' + writer.name + ' ' + fault + ' failure cannot overwrite or announce success', async () => {
      await using(async w => {
        if (fault === 'read') w.r2.failNext('get', KEY, new Error('CASEY_PRIVATE_TEST'));
        if (fault === 'corrupt') w.r2.set(KEY, '{CASEY_PRIVATE_TEST');
        if (fault === 'put') w.r2.failNext('put', KEY, new Error('CASEY_PRIVATE_TEST'));
        const before = w.r2.text(KEY);
        assertUnavailable(await invoke(w, writer.payload()), w);
        assert.equal(w.r2.text(KEY), before);
        if (fault !== 'put') assert.equal(rosterPuts(w).length, 0);
      }, { rows: [writer.initial(), other()] });
    });
  }
}

for (const combination of [
  { name: 'different-row payment flag and clear', events: [flag(), clear(OTHER, SECOND_ID)],
    rows: [row(), other({ payment_failing: '2026-09-27', payment_detail: { attempt: 1 } })],
    verify: rows => { assert.ok(rows[0].payment_failing); assert.equal(rows[1].payment_failing, undefined); } },
  { name: 'same-row deactivation and payment flag', events: [cancel(), flag()],
    rows: [row(), other()],
    verify: rows => { assert.equal(rows[0].active, false); assert.ok(rows[0].payment_failing); } },
  { name: 'same-row deactivation and payment clear', events: [cancel(), clear()],
    rows: [row({ payment_failing: '2026-09-27', payment_detail: { attempt: 1 } }), other()],
    verify: rows => { assert.equal(rows[0].active, false); assert.equal(rows[0].payment_failing, undefined); } },
  { name: 'new enrollment and existing payment flag', events: [checkout(OTHER, SECOND_ID), flag()],
    rows: [row()],
    verify: rows => { assert.equal(rows.length, 2); assert.ok(rows.find(r => r.email === EMAIL).payment_failing); assert.equal(rows.find(r => r.email === OTHER).active, true); } },
]) {
  check('C05 competing ' + combination.name + ' both survive', async () => {
    await using(async w => {
      overlapTwoReads(w);
      const results = await Promise.all(combination.events.map(payload => invoke(w, payload)));
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      conditionalPuts(w);
      const saved = w.r2.json(KEY);
      combination.verify(saved);
      assert.equal(saved.find(r => r.email === EMAIL).token, TOKEN);
      assert.deepEqual(saved.find(r => r.email === EMAIL).custom, combination.rows[0].custom);
      if (combination.rows.length === 2) {
        assert.equal(saved[1].token, OTHER_TOKEN); assert.deepEqual(saved[1].custom, combination.rows[1].custom);
      }
    }, { rows: combination.rows });
  });
}

check('C05 concurrent first enrollments use create-only then reread without losing either token', async () => {
  await using(async w => {
    overlapTwoReads(w);
    const results = await Promise.all([invoke(w, checkout()), invoke(w, checkout(OTHER, SECOND_ID))]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    const saved = w.r2.json(KEY);
    assert.deepEqual(saved.map(r => r.email).sort(), [EMAIL, OTHER].sort());
    const puts = rosterPuts(w); conditionalPuts(w);
    assert.equal(puts.filter(op => op.onlyIf.etagDoesNotMatch === '*').length, 2);
    assert.equal(puts.filter(op => typeof op.onlyIf.etagMatches === 'string').length, 1);
    for (const entry of saved) {
      const customerMail = w.mail.filter(mail => mail.to.includes(entry.email));
      assert.equal(customerMail.length, 1);
      assert.ok(customerMail[0].html.includes('/api/my-leads?t=' + entry.token));
    }
    assert.notEqual(saved[0].token, saved[1].token);
  }, { missing: true });
});

check('C05 one lost conditional write rereads and preserves the winning writer fields', async () => {
  const initial = writers[0].initial();
  await using(async w => {
    const put = w.r2.put.bind(w.r2); let raced = false;
    w.r2.put = async (key, value, options) => {
      if (key === KEY && !raced) {
        raced = true;
        const winner = w.r2.json(KEY);
        winner[0].winner_note = { value: 'KEEP_WINNER_TEST' };
        winner.push(other());
        w.r2.set(KEY, winner); // A competing writer wins after our snapshot.
      }
      return put(key, value, options);
    };
    assert.equal((await invoke(w, checkout())).status, 200);
    assert.equal(rosterPuts(w).length, 2); conditionalPuts(w);
    const saved = w.r2.json(KEY);
    assert.equal(saved[0].customer, CUSTOMER); assert.equal(saved[0].token, TOKEN);
    assert.equal(Object.hasOwn(saved[0], 'active'), false);
    assert.deepEqual(saved[0].winner_note, { value: 'KEEP_WINNER_TEST' });
    assert.deepEqual(saved[1], other()); assert.equal(w.mail.length, 1);
  }, { rows: [initial] });
});

for (const writer of writers) {
  check('C05 ' + writer.name + ' stops after bounded conflicts and can retry before external requests', async () => {
    const primary = writer.initial();
    await using(async w => {
      const put = w.r2.put.bind(w.r2); let conflicts = 0;
      w.r2.put = async (key, value, options) => {
        if (key === KEY) {
          conflicts++;
          const concurrent = w.r2.json(KEY);
          concurrent[1].concurrent_revision = conflicts;
          w.r2.set(KEY, concurrent);
        }
        return put(key, value, options);
      };
      const payload = writer.payload();
      assertUnavailable(await invoke(w, payload), w);
      assert.equal(conflicts, 4, 'the conditional-write budget must be bounded');
      conditionalPuts(w);
      assert.deepEqual(w.r2.json(KEY)[0], primary);
      assert.equal(w.r2.json(KEY)[1].concurrent_revision, 4);
      w.r2.put = put;
      const retry = await invoke(w, payload);
      assert.equal(retry.status, 200);
      const saved = w.r2.json(KEY); writer.verify(saved[0]);
      assert.equal(saved[0].token, TOKEN); assert.equal(saved[1].concurrent_revision, 4);
      assert.equal(w.mail.length, writer.name === 'deactivation' ? 0 : 1);
    }, { rows: [primary, other()] });
  });
}

check('C05 missing etag cannot turn a roster update into an unconditional write', async () => {
  await using(async w => {
    const get = w.r2.get.bind(w.r2);
    w.r2.get = async (key, ...args) => {
      const object = await get(key, ...args);
      if (key === KEY && object) delete object.etag;
      return object;
    };
    const before = w.r2.text(KEY);
    assertUnavailable(await invoke(w, flag()), w);
    assert.equal(rosterPuts(w).length, 0); assert.equal(w.r2.text(KEY), before);
  });
});

check('C05 renewal flag-clear failure stops before the customer provider request', async () => {
  const initial = row({ payment_failing: '2026-09-27', payment_detail: { attempt: 2 } });
  await using(async w => {
    const payload = event('invoice.paid', { id: 'in_TEST_renewal', customer: CUSTOMER,
      customer_email: EMAIL, amount_paid: 9900, billing_reason: 'subscription_cycle' });
    w.r2.failNext('put', KEY, new Error('CASEY_PRIVATE_TEST'));
    assertUnavailable(await invoke(w, payload), w);
    assert.deepEqual(w.r2.json(KEY)[0], initial);
    assert.equal((await invoke(w, payload)).status, 200);
    assert.equal(w.mail.length, 1); assert.ok(w.mail[0].to.includes(EMAIL));
    assert.equal(w.r2.json(KEY)[0].payment_failing, undefined);
    assert.equal(w.r2.json(KEY)[0].token, TOKEN);
  }, { rows: [initial, other()] });
});

check('C05 Radar second-update failure keeps the first change but delays owner mail until retry', async () => {
  await using(async w => {
    const payload = event('review.opened', { id: 'prv_TEST_open', customer: CUSTOMER, customer_email: EMAIL });
    const put = w.r2.put.bind(w.r2); let writes = 0;
    w.r2.put = async (key, ...args) => {
      if (key === KEY && ++writes === 2) throw new Error('CASEY_PRIVATE_TEST');
      return put(key, ...args);
    };
    assertUnavailable(await invoke(w, payload), w);
    assert.equal(w.r2.json(KEY)[0].active, false);
    assert.equal(w.r2.json(KEY)[0].payment_failing, undefined);
    w.r2.put = put;
    assert.equal((await invoke(w, payload)).status, 200);
    const saved = w.r2.json(KEY);
    assert.equal(saved[0].active, false); assert.ok(saved[0].payment_failing);
    assert.equal(saved[0].token, TOKEN); assert.deepEqual(saved[1], other());
    assert.equal(w.mail.length, 1); assert.ok(w.mail[0].to.includes('casey+owner@example.com'));
    // Each roster update is conditional; the whole Radar event is not a transaction.
  });
});
