import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHandlers, signedRequest, stripeEvent, withWorld } from '../harness/index.mjs';

const h = await loadHandlers();
const EMAIL = 'casey@example.com';
const CUSTOMER = 'cus_TEST_casey';
const TOKEN = 'a'.repeat(32);
const DETAIL = 'PRIVATE_TEST ' + EMAIL + ' ' + CUSTOMER + ' ' + TOKEN;
const MONTHLY = 'MONTHLY_RESPONSE_PRIVACY_TEST';
const WEEKLY = 'WEEKLY_RESPONSE_PRIVACY_TEST';
const JWKS = 'https://token.actions.githubusercontent.com/.well-known/jwks';
let nextClock = Date.parse('2027-01-04T14:00:00.000Z');

function scenario(name, run, options = {}) {
  const now = nextClock;
  nextClock += 2 * 86400_000;
  test(name, { concurrency: false }, () => withWorld(run, { ...options, now }));
}
function seed(w) {
  w.r2.set('latest-monthly.zip', MONTHLY);
  w.r2.set('latest-weekly.zip', WEEKLY);
  w.r2.set('subscribers.json', [{ email: EMAIL, name: 'Casey TEST', customer: CUSTOMER,
    active: true, token: TOKEN, since: '2026-09-01' }]);
  w.r2.set('delivery-log.json', []);
}
async function webhook(w, type = 'checkout.session.completed') {
  return w.call(h.webhook, signedRequest(stripeEvent(type)));
}
async function safeFailure(response, status, expected) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const body = await response.json();
  assert.deepEqual(body, expected);
  const text = JSON.stringify(body);
  for (const forbidden of [EMAIL, CUSTOMER, TOKEN, DETAIL]) assert.equal(text.includes(forbidden), false);
}
function noDelivery(w) {
  assert.equal(w.mail.length, 0);
  assert.deepEqual(w.r2.json('delivery-log.json'), []);
  assert.equal(w.r2.ops.filter(op => op.op === 'put').length, 0);
}

for (const [type, kind, bytes] of [
  ['checkout.session.completed', 'monthly', MONTHLY],
  ['invoice.paid', 'weekly', WEEKLY],
]) {
  scenario('I24 C19 ' + kind + ' webhook acknowledgment keeps operational fields and the real delivery', async w => {
    seed(w);
    const response = await webhook(w, type);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(),
      { ok: true, delivered: kind, bundle: 'latest-' + kind + '.zip' });
    assert.equal(w.mail.length, 1);
    assert.deepEqual(w.mail[0].to, [EMAIL]);
    assert.equal(w.mail[0].from, w.env.FROM_EMAIL);
    assert.equal(w.mail[0].attachments.length, 1);
    assert.equal(Buffer.from(w.mail[0].attachments[0].content, 'base64').toString(), bytes);
    assert.deepEqual(w.r2.json('delivery-log.json').map(({ to, kind: sentKind, bundle }) =>
      ({ to, kind: sentKind, bundle })), [{ to: EMAIL, kind, bundle: 'latest-' + kind + '.zip' }]);
  });
}

scenario('I24 C19 webhook bundle storage exceptions return a static failure before delivery', async w => {
  seed(w);
  w.r2.failNext('get', 'latest-monthly.zip', new Error(DETAIL));
  await safeFailure(await webhook(w), 500, { ok: false, error: 'webhook_failed' });
  noDelivery(w);
});

scenario('I24 C19 webhook bundle body exceptions return a static failure before delivery', async w => {
  seed(w);
  const get = w.r2.get.bind(w.r2);
  let reads = 0;
  w.r2.get = async (key, ...args) => {
    const object = await get(key, ...args);
    if (key === 'latest-monthly.zip' && object) {
      object.arrayBuffer = async () => { reads++; throw new Error(DETAIL); };
    }
    return object;
  };
  await safeFailure(await webhook(w), 500, { ok: false, error: 'webhook_failed' });
  assert.equal(reads, 1);
  noDelivery(w);
});

scenario('I24 C19 webhook provider network exceptions retain failure without echoing details', async w => {
  seed(w);
  await safeFailure(await webhook(w), 500, { ok: false, error: 'webhook_failed' });
  assert.equal(w.mail.length, 1, 'the provider request was attempted once');
  assert.deepEqual(w.mail[0].to, [EMAIL]);
  assert.deepEqual(w.r2.json('delivery-log.json'), []);
}, { mailResponses: [{ throw: new Error(DETAIL) }] });

scenario('I24 C19 owner relay acknowledgment omits destination and echoed subject while preserving the mail', async w => {
  const subject = 'Privacy TEST ' + EMAIL + ' ' + TOKEN;
  const html = '<p>town-a TEST ' + TOKEN + '</p>';
  const response = await w.call(h.mailOwner, '/api/mail-owner?subject=' + encodeURIComponent(subject), {
    method: 'POST', headers: await w.oidcHeaders(), body: html,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(w.mail, [{ from: w.env.FROM_EMAIL, to: [w.env.OWNER_EMAIL], subject, html }]);
  assert.equal(w.r2.ops.length, 0);
});

scenario('I24 C19 owner relay authentication failures omit verifier exception text and perform no work', async w => {
  const closedFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url !== JWKS) return closedFetch(input, init);
    w.fetchCalls.push({ url, method: 'GET' });
    throw new Error(DETAIL);
  };
  const request = w.request('/api/mail-owner', {
    method: 'POST', headers: await w.oidcHeaders(), body: 'BODY_TEST',
  });
  let bodyReads = 0;
  request.text = async () => { bodyReads++; return 'BODY_TEST'; };
  await safeFailure(await w.call(h.mailOwner, request), 401, { error: 'unauthorized' });
  assert.equal(w.fetchCalls.length, 1);
  assert.equal(bodyReads, 0);
  assert.equal(w.r2.ops.length, 0);
  assert.equal(w.mail.length, 0);
});
