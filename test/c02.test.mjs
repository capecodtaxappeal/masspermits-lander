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

const KEY = 'subscribers.json', EMAIL = 'casey@example.com';
const checkout = { id: 'evt_TEST_enroll', type: 'checkout.session.completed', data: { object: {
  id: 'cs_TEST_enroll', mode: 'subscription', amount_total: 9900, customer: 'cus_TEST_primary',
  customer_details: { email: EMAIL, name: 'Casey' },
} } };
async function invoke(w) {
  const response = await webhook({ request: signedRequest(checkout), env: w.env });
  return { status: response.status, body: await response.json() };
}
function setup(w, rows = []) { w.r2.set(KEY, rows); w.r2.set('latest-monthly.zip', 'BUNDLE_TEST'); }
for (const fault of ['read', 'body read', 'invalid JSON', 'object', 'null', 'write']) {
  test('C02 enrollment ' + fault + ' failure is retryable before customer mail', async () => withWorld(async w => {
    setup(w);
    if (fault === 'read') w.r2.failNext('get', KEY, new Error('PRIVATE_TEST'));
    if (fault === 'write') w.r2.failNext('put', KEY, new Error('PRIVATE_TEST'));
    if (fault === 'invalid JSON') w.r2.set(KEY, '{PRIVATE_TEST');
    if (fault === 'object') w.r2.set(KEY, {});
    if (fault === 'null') w.r2.set(KEY, 'null');
    if (fault === 'body read') {
      const get = w.r2.get.bind(w.r2);
      w.r2.get = async key => key === KEY ? { text: async () => { throw new Error('PRIVATE_TEST'); } } : get(key);
    }
    const original = w.r2.text(KEY);
    const result = await invoke(w);
    assert.equal(result.status, 500); assert.equal(result.body.ok, false);
    assert.equal(result.body.error, 'subscriber enrollment unavailable');
    assert.equal(w.mail.length, 0); assert.equal(w.r2.text(KEY), original);
  }));
}
test('C02 a rejected write can retry and persist the token before one customer mail', async () => withWorld(async w => {
  setup(w); w.r2.failNext('put', KEY, new Error('PRIVATE_TEST'));
  assert.equal((await invoke(w)).status, 500); assert.equal(w.mail.length, 0);
  assert.equal((await invoke(w)).status, 200);
  const saved = w.r2.json(KEY)[0]; assert.equal(saved.active, true); assert.equal(saved.customer, 'cus_TEST_primary');
  assert.match(saved.token, /^[a-f0-9]{32}$/); assert.equal(w.mail.length, 1);
  assert.ok(w.mail[0].html.includes('/api/my-leads?t=' + saved.token));
}));
test('C02 an absent roster is created before a successful purchase acknowledgement', async () => withWorld(async w => {
  w.r2.set('latest-monthly.zip', 'BUNDLE_TEST');
  assert.equal((await invoke(w)).status, 200);
  assert.equal(w.r2.json(KEY)[0].email, EMAIL); assert.equal(w.mail.length, 1);
}));
test('C02 reactivation write failure preserves the old row and sends nothing', async () => withWorld(async w => {
  const row = { email: EMAIL, customer: 'cus_TEST_old', active: false, token: 'token_TEST', cancelled: '2026-09-01' };
  setup(w, [row]); w.r2.failNext('put', KEY, new Error('PRIVATE_TEST'));
  assert.equal((await invoke(w)).status, 500); assert.deepEqual(w.r2.json(KEY), [row]); assert.equal(w.mail.length, 0);
}));
test('C02 provider request observes an already durable enrollment token', async () => withWorld(async w => {
  setup(w);
  const capture = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const saved = w.r2.json(KEY); assert.equal(saved.length, 1); assert.ok(saved[0].token);
    return capture(...args);
  };
  assert.equal((await invoke(w)).status, 200); assert.equal(w.mail.length, 1);
}));
