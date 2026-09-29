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

const EMAIL = 'casey@example.com', CUSTOMER = 'cus_TEST_primary';
for (const type of ['invoice.payment_failed', 'invoice.payment_succeeded']) {
  for (const identity of ['different customer', 'same customer', 'missing stored customer', 'missing event customer']) {
    test('C04a ' + type + ' respects ' + identity, async () => withWorld(async w => {
      const row = { email: EMAIL, customer: CUSTOMER, active: true, token: 'token_TEST',
        payment_failing: '2026-09-01', payment_detail: { attempt: 1 } };
      const eventCustomer = identity === 'different customer' ? 'cus_TEST_old' : CUSTOMER;
      if (identity === 'missing stored customer') delete row.customer;
      const object = { customer: eventCustomer, customer_email: EMAIL, amount_due: 9900, attempt_count: 2 };
      if (identity === 'missing event customer') delete object.customer;
      w.r2.set('subscribers.json', [row]);
      const response = await webhook({ request: signedRequest({ id: 'evt_TEST_identity', type, data: { object } }), env: w.env });
      assert.equal(response.status, 200);
      const saved = w.r2.json('subscribers.json')[0];
      if (identity === 'different customer') assert.deepEqual(saved, row);
      else if (type === 'invoice.payment_failed') assert.equal(saved.payment_failing, '2026-09-28');
      else { assert.equal(saved.payment_failing, undefined); assert.equal(saved.payment_detail, undefined); }
      assert.equal(saved.token, row.token); assert.equal(saved.active, true);
      if (identity === 'missing stored customer') assert.equal(saved.customer, CUSTOMER);
    }));
  }
}
