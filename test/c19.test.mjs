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

const EMAIL = 'casey@example.com';
const payload = { id: 'evt_TEST_privacy', type: 'checkout.session.completed', data: { object: {
  id: 'cs_TEST_privacy', mode: 'payment', amount_total: 4900, customer: 'cus_TEST_primary',
  customer_details: { email: EMAIL, name: 'Casey' },
} } };
async function invoke(w) {
  const response = await webhook({ request: signedRequest(payload), env: w.env });
  return { status: response.status, body: await response.json() };
}
test('C19 success response omits the recipient while mail delivery remains addressed', async () => withWorld(async w => {
  w.r2.set('latest-monthly.zip', 'BUNDLE_TEST');
  const result = await invoke(w);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, delivered: 'monthly', bundle: 'latest-monthly.zip' });
  assert.equal(w.mail.length, 1); assert.deepEqual(w.mail[0].to, [EMAIL]);
}));
test('C19 provider rejection stays retryable without provider text in the response', async () => withWorld(async w => {
  w.r2.set('latest-monthly.zip', 'BUNDLE_TEST');
  w.providerStatus = 429; w.providerBody = 'PRIVATE_TEST ' + EMAIL;
  const result = await invoke(w);
  assert.deepEqual(result, { status: 500, body: { ok: false, error: 'webhook_failed' } });
}));
for (const error of [
  'PRIVATE_TEST ' + EMAIL,
  'subscriber enrollment unavailable: PRIVATE_TEST',
  'subscriber roster update unavailable: PRIVATE_TEST',
]) {
  test('C19 untrusted storage error is replaced with a fixed response ' + error.replace('PRIVATE_TEST ' + EMAIL, 'private error').replace(': PRIVATE_TEST', ' lookalike'), async () => withWorld(async w => {
    w.r2.failNext('get', 'latest-monthly.zip', new Error(error));
    assert.deepEqual(await invoke(w), { status: 500, body: { ok: false, error: 'webhook_failed' } });
  }));
}
for (const error of ['subscriber enrollment unavailable', 'subscriber roster update unavailable']) {
  test('C19 preserves the fixed retry contract ' + error, async () => withWorld(async w => {
    w.r2.failNext('get', 'latest-monthly.zip', new Error(error));
    assert.deepEqual(await invoke(w), { status: 500, body: { ok: false, error } });
  }));
}
test('C19 missing bundle retains its fixed response and retry status', async () => withWorld(async w => {
  assert.deepEqual(await invoke(w), { status: 500, body: { ok: false, error: 'bundle latest-monthly.zip not in R2' } });
  assert.equal(w.mail.length, 0);
}));
test('C19 signature rejection retains its fixed reason without attempting mail', async () => withWorld(async w => {
  const request = new Request('https://example.invalid/api/stripe-webhook', { method: 'POST', body: '{}' });
  const response = await webhook({ request, env: w.env });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'bad signature', reason: 'no-signature-header' });
  assert.equal(w.mail.length, 0);
}));
