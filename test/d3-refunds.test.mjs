import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestGet as download } from '../functions/api/my-leads.js';
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
  return event('customer.subscription.deleted', { id: 'sub_primary_TEST',
    customer, customer_email: email, status: 'canceled' }, 'cancel_' + customer);
}
function flag(email = EMAIL, customer = CUSTOMER) {
  return event('invoice.payment_failed', { id: 'in_' + customer + '_TEST',
    customer, customer_email: email, attempt_count: 2, amount_due: 9900 }, 'flag_' + customer);
}

const REF = { customer: CUSTOMER, subscription: 'sub_primary_TEST',
  refs: { charges: ['ch_primary_TEST'], payment_intents: ['pi_primary_TEST'], invoices: ['in_primary_TEST'] },
  reviews: {}, blocks: [], activated_at: 1790603970 };
async function using(fn, extra = {}) {
  return withWorld(async w => {
    w.r2.set(KEY, [row({ billing_access: structuredClone(REF), ...extra }), other()]);
    w.r2.set('latest-monthly.zip', 'SYNTHETIC_MONTHLY_BYTES_TEST');
    w.r2.set('latest-weekly.zip', 'SYNTHETIC_WEEKLY_BYTES_TEST');
    return fn(w);
  });
}
async function invoke(w, payload) {
  const response = await webhook({ request: signedRequest(payload), env: w.env });
  return { status: response.status, body: await response.json() };
}
const review = (type = 'review.opened', id = 'prv_primary_TEST', extra = {}) =>
  event(type, { id, charge: 'ch_primary_TEST', payment_intent: 'pi_primary_TEST',
    ...(type === 'review.closed' ? { closed_reason: 'approved' } : {}), ...extra });
const refund = (amount_refunded = 9900, extra = {}) => event('charge.refunded', {
  id: 'ch_primary_TEST', customer: CUSTOMER, invoice: 'in_primary_TEST',
  payment_intent: 'pi_primary_TEST', amount: 9900, amount_refunded,
  refunded: amount_refunded === 9900, ...extra,
});
const first = w => w.r2.json(KEY)[0];
const customerMail = w => w.mail.filter(m => !m.to.includes('casey+owner@example.com'));
function noCustomerMail(w) { assert.equal(customerMail(w).length, 0); }
async function access(w) {
  const pending=[];
  const response = await download({ request: new Request('https://example.invalid/api/my-leads?t='+TOKEN),
    env:w.env, waitUntil(p){pending.push(p);} });
  await Promise.all(pending);
  return response.status;
}
check('D3 full refund immediately revokes the real download token', () => using(async w => {
  const result=await invoke(w,refund()); assert.equal(result.status,200);
  assert.equal(first(w).active,false); assert.equal(await access(w),403); noCustomerMail(w);
}));
check('D3 partial refund retains access until actual subscription deletion', () => using(async w => {
  await invoke(w,refund(2500)); assert.equal(first(w).active,true); assert.equal(await access(w),200);
  await invoke(w,cancel()); assert.equal(await access(w),403); noCustomerMail(w);
}));
check('D3 partial refund does not invent a paid-period deadline or active field', () => using(async w => {
  const rows=w.r2.json(KEY); delete rows[0].active; w.r2.set(KEY,rows);
  const before=first(w); await invoke(w,refund(100)); assert.deepEqual(first(w),before); noCustomerMail(w);
}));
check('D3 ordinary charge-only review opens and approval restores access automatically', () => using(async w => {
  assert.equal((await invoke(w,review())).status,200); assert.equal(await access(w),403);
  assert.equal((await invoke(w,review('review.closed'))).status,200);
  assert.equal(first(w).active,true); assert.equal(await access(w),200); noCustomerMail(w);
}));
check('D3 payment-intent-only review resolves without fictitious customer fields', () => using(async w => {
  const payload=review(); delete payload.data.object.charge;
  assert.equal((await invoke(w,payload)).status,200); assert.equal(first(w).active,false);
  payload.type='review.closed'; payload.data.object.closed_reason='approved';
  assert.equal((await invoke(w,payload)).status,200); assert.equal(first(w).active,true); noCustomerMail(w);
}));
check('D3 missing active field is restored as missing after the matching review clears', () => using(async w => {
  const rows=w.r2.json(KEY); delete rows[0].active; w.r2.set(KEY,rows);
  await invoke(w,review()); await invoke(w,review('review.closed'));
  assert.equal(Object.hasOwn(first(w),'active'),false); assert.equal(await access(w),200); noCustomerMail(w);
}));
check('D3 previously inactive customer is not reactivated by review approval', () => using(async w => {
  await invoke(w,review()); await invoke(w,review('review.closed'));
  assert.equal(first(w).active,false); noCustomerMail(w);
},{active:false}));
check('D3 approving one review cannot clear a different open review', () => using(async w => {
  await invoke(w,review()); await invoke(w,review('review.opened','prv_second_TEST'));
  await invoke(w,review('review.closed')); assert.equal(first(w).active,false);
  await invoke(w,review('review.closed','prv_second_TEST')); assert.equal(first(w).active,true); noCustomerMail(w);
}));
check('D3 duplicate review delivery is idempotent without replacing the saved eligibility', () => using(async w => {
  await invoke(w,review()); const held=first(w);
  await invoke(w,review()); assert.deepEqual(first(w),held);
  await invoke(w,review('review.closed')); const restored=first(w);
  await invoke(w,review('review.closed')); assert.deepEqual(first(w),restored); noCustomerMail(w);
}));
check('D3 approved close arriving before open prevents the late open from holding access', () => using(async w => {
  await invoke(w,review('review.closed')); await invoke(w,review());
  assert.equal(first(w).active,true); noCustomerMail(w);
}));
check('D3 a closed unapproved review never restores access', () => using(async w => {
  await invoke(w,review()); await invoke(w,review('review.closed','prv_primary_TEST',{closed_reason:'refunded'}));
  assert.equal(first(w).active,false); noCustomerMail(w);
}));
for(const [label,block] of [
  ['cancellation',()=>cancel()], ['full refund',()=>refund()],
  ['dispute',()=>event('charge.dispute.created',{id:'dp_TEST',charge:'ch_primary_TEST',payment_intent:'pi_primary_TEST'})],
  ['early fraud warning',()=>event('radar.early_fraud_warning.created',{id:'issfr_TEST',charge:'ch_primary_TEST',payment_intent:'pi_primary_TEST'})],
]) check('D3 '+label+' while already held supersedes later review approval', () => using(async w => {
  await invoke(w,review()); assert.equal((await invoke(w,block())).status,200);
  await invoke(w,review('review.closed')); assert.equal(first(w).active,false); noCustomerMail(w);
}));
check('D3 stale partial refund cannot undo a full refund', () => using(async w => {
  await invoke(w,refund()); const after=first(w); await invoke(w,refund(500));
  assert.equal(first(w).active,false); assert.deepEqual(first(w),after); noCustomerMail(w);
}));
check('D3 unknown realistic review identity returns retryable fixed error without edits', () => using(async w => {
  const before=w.r2.text(KEY); const result=await invoke(w,review('review.opened','prv_unknown_TEST',
    {charge:'ch_unknown_TEST',payment_intent:'pi_unknown_TEST'}));
  assert.equal(result.status,503); assert.equal(result.body.error,'billing policy update failed');
  assert.equal(w.r2.text(KEY),before); noCustomerMail(w);
}));
check('D3 unlinked refund from the other product does not revoke this customer', () => using(async w => {
  const before=w.r2.text(KEY); const result=await invoke(w,refund(435,
    {id:'ch_IRWATCH_TEST',invoice:'in_IRWATCH_TEST',payment_intent:'pi_IRWATCH_TEST',amount:435}));
  assert.equal(result.status,503); assert.equal(w.r2.text(KEY),before); noCustomerMail(w);
}));
check('D3 conflicting customer overrides a matching payment reference', () => using(async w => {
  const before=w.r2.text(KEY); const result=await invoke(w,refund(9900,{customer:SECOND_ID}));
  assert.equal(result.status,503); assert.equal(w.r2.text(KEY),before); noCustomerMail(w);
}));
check('D3 replaced customer cannot be restored by an old matching review', () => using(async w => {
  await invoke(w,review()); const rows=w.r2.json(KEY); rows[0].customer='cus_replaced_TEST'; w.r2.set(KEY,rows);
  const result=await invoke(w,review('review.closed'));
  assert.equal(result.status,503); assert.equal(first(w).active,false); noCustomerMail(w);
}));
check('D3 ambiguous payment reference returns retryable error rather than changing two rows', () => using(async w => {
  const rows=w.r2.json(KEY); rows[1].billing_access={...structuredClone(REF),customer:SECOND_ID}; w.r2.set(KEY,rows);
  const before=w.r2.text(KEY); const result=await invoke(w,review());
  assert.equal(result.status,503); assert.equal(w.r2.text(KEY),before); noCustomerMail(w);
}));
for(const [label,setup] of [
  ['read failure',w=>w.r2.failNext('get',KEY,new Error('STORAGE_SECRET_TEST'))],
  ['write failure',w=>w.r2.failNext('put',KEY,new Error('STORAGE_SECRET_TEST'))],
  ['corrupt roster',w=>w.r2.set(KEY,'bad json')],
  ['wrong-shaped roster',w=>w.r2.set(KEY,{wrong:[]})],
]) check('D3 '+label+' is retryable and never leaks raw storage error',()=>using(async w=>{
  setup(w);const result=await invoke(w,refund()); assert.equal(result.status,503);
  assert.equal(result.body.error,'billing policy update failed'); noCustomerMail(w);
}));
check('D3 CAS conflict rereads and preserves a concurrent unrelated update',()=>using(async w=>{
  const put=w.r2.put.bind(w.r2); let conflict=true;
  w.r2.put=async (key,value,options)=>{
    if(key===KEY&&conflict){ conflict=false;const rows=w.r2.json(KEY); rows[1].fresh='concurrent_TEST';w.r2.set(KEY,rows); }
    return put(key,value,options);
  };
  assert.equal((await invoke(w,refund())).status,200); assert.equal(first(w).active,false);
  assert.equal(w.r2.json(KEY)[1].fresh,'concurrent_TEST');
  assert.ok(w.r2.ops.filter(o=>o.op==='put'&&o.key===KEY).every(o=>o.onlyIf?.etagMatches)); noCustomerMail(w);
}));
check('D3 CAS exhaustion fails rather than acknowledging an unrecorded access change',()=>using(async w=>{
  const put=w.r2.put.bind(w.r2); w.r2.put=async(key,value,options)=> key===KEY?null:put(key,value,options);
  const result=await invoke(w,refund()); assert.equal(result.status,503);
  assert.equal(first(w).active,true); noCustomerMail(w);
}));
check('D3 checkout and scoped invoice retain references needed by a later actual Review payload',()=>using(async w=>{
  const rows=w.r2.json(KEY);delete rows[0].billing_access;w.r2.set(KEY,rows);
  const purchase=checkout();purchase.data.object.subscription='sub_primary_TEST';purchase.data.object.invoice='in_initial_TEST';
  assert.equal((await invoke(w,purchase)).status,200);
  const paid=event('invoice.paid',{id:'in_cycle_TEST',customer:CUSTOMER,customer_email:EMAIL,
    subscription:'sub_primary_TEST',billing_reason:'subscription_cycle',amount_paid:9900,
    charge:'ch_cycle_TEST',payment_intent:'pi_cycle_TEST'});
  assert.equal((await invoke(w,paid)).status,200);w.mail.length=0;
  assert.equal((await invoke(w,review('review.opened','prv_cycle_TEST',
    {charge:'ch_cycle_TEST',payment_intent:'pi_cycle_TEST'}))).status,200);
  assert.equal(first(w).active,false);noCustomerMail(w);
}));
check('D3 low-price other-product invoice cannot add payment references',()=>using(async w=>{
  const before=structuredClone(first(w).billing_access);
  await invoke(w,event('invoice.paid',{id:'in_IRWATCH_TEST',customer:CUSTOMER,customer_email:EMAIL,
    subscription:'sub_IRWATCH_TEST',billing_reason:'subscription_cycle',amount_paid:435,
    charge:'ch_IRWATCH_TEST',payment_intent:'pi_IRWATCH_TEST'}));
  assert.deepEqual(first(w).billing_access,before);noCustomerMail(w);
}));
check('D3 duplicate checkout and renewal cannot undo full refund or send another bundle',()=>using(async w=>{
  await invoke(w,refund());const purchase=checkout();purchase.data.object.subscription='sub_primary_TEST';
  assert.equal((await invoke(w,purchase)).status,200);
  assert.equal((await invoke(w,event('invoice.paid',{id:'in_retry_TEST',customer:CUSTOMER,customer_email:EMAIL,
    subscription:'sub_primary_TEST',billing_reason:'subscription_cycle',amount_paid:9900}))).status,200);
  assert.equal(first(w).active,false);noCustomerMail(w);
}));

check('D3 first invoice retains payment references only after its checkout subscription is linked',()=>using(async w=>{
  const rows=w.r2.json(KEY);delete rows[0].billing_access;w.r2.set(KEY,rows);
  const firstInvoice=event('invoice.paid',{id:'in_first_TEST',customer:CUSTOMER,customer_email:EMAIL,
    subscription:'sub_primary_TEST',billing_reason:'subscription_create',amount_paid:9900,
    charge:'ch_first_TEST',payment_intent:'pi_first_TEST'});
  assert.equal((await invoke(w,firstInvoice)).status,503);
  const purchase=checkout();purchase.data.object.subscription='sub_primary_TEST';purchase.data.object.invoice='in_first_TEST';
  assert.equal((await invoke(w,purchase)).status,200);w.mail.length=0;
  assert.equal((await invoke(w,firstInvoice)).status,200);noCustomerMail(w);
  assert.equal((await invoke(w,review('review.opened','prv_first_TEST',
    {charge:'ch_first_TEST',payment_intent:'pi_first_TEST'}))).status,200);
  assert.equal(first(w).active,false);noCustomerMail(w);
}));
check('D3 initially absent roster gets checkout references before first bundle is accepted',()=>using(async w=>{
  w.r2.set(KEY,[]);
  const purchase=checkout();purchase.data.object.subscription='sub_primary_TEST';purchase.data.object.invoice='in_first_TEST';
  assert.equal((await invoke(w,purchase)).status,200);
  assert.equal(first(w).billing_access.customer,CUSTOMER);
  assert.deepEqual(first(w).billing_access.refs.invoices,['in_first_TEST']);
  assert.equal(customerMail(w).length,1);
}));
check('D3 a newer subscription checkout restores access without preserving old refund references',()=>using(async w=>{
  await invoke(w,refund());
  const purchase=checkout();purchase.created=REF.activated_at+3600;
  purchase.data.object.subscription='sub_new_TEST';purchase.data.object.invoice='in_new_TEST';
  assert.equal((await invoke(w,purchase)).status,200);assert.equal(first(w).active,true);
  const after=first(w);w.mail.length=0;
  assert.equal((await invoke(w,refund())).status,503);assert.deepEqual(first(w),after);noCustomerMail(w);
}));
check('D3 older subscription checkout cannot replace or reactivate the current relationship',()=>using(async w=>{
  await invoke(w,refund());const before=first(w);
  const purchase=checkout();purchase.created=REF.activated_at-3600;purchase.data.object.subscription='sub_old_TEST';
  assert.equal((await invoke(w,purchase)).status,200);assert.deepEqual(first(w),before);noCustomerMail(w);
}));
for(const amount of [undefined,-1,0,'9900',NaN])
  check('D3 invalid original refund amount '+String(amount)+' is retryable without a state change',()=>using(async w=>{
    const before=w.r2.text(KEY);const result=await invoke(w,refund(9900,{amount}));
    assert.equal(result.status,503);assert.equal(w.r2.text(KEY),before);noCustomerMail(w);
  }));
check('D3 failed hold write succeeds on Stripe retry with no early acknowledgment',()=>using(async w=>{
  w.r2.failNext('put',KEY,new Error('FAILED_POLICY_WRITE_TEST'));
  assert.equal((await invoke(w,review())).status,503);assert.equal(first(w).active,true);
  assert.equal((await invoke(w,review())).status,200);assert.equal(first(w).active,false);noCustomerMail(w);
}));

check('D3 old subscription cancellation cannot revoke a newer subscription for the same customer',()=>using(async w=>{
  const purchase=checkout();purchase.created=REF.activated_at+3600;
  purchase.data.object.subscription='sub_new_TEST';purchase.data.object.invoice='in_new_TEST';
  await invoke(w,purchase);w.mail.length=0;
  assert.equal((await invoke(w,cancel())).status,200);assert.equal(first(w).active,true);noCustomerMail(w);
}));
check('D3 owner alert identifies the private event while the public response carries no identity',()=>using(async w=>{
  const result=await invoke(w,review());assert.equal(result.status,200);
  assert.ok(w.mail[0].html.includes('prv_primary_TEST'));
  assert.ok(w.mail[0].html.includes(EMAIL));assert.ok(w.mail[0].html.includes(CUSTOMER));
  const body=JSON.stringify(result.body);assert.ok(!body.includes(EMAIL));assert.ok(!body.includes(CUSTOMER));
  noCustomerMail(w);
}));

check('D3 uncertain same-second replacement checkout retries rather than discarding entitlement',()=>using(async w=>{
  const purchase=checkout();purchase.created=REF.activated_at;purchase.data.object.subscription='sub_new_TEST';
  const before=w.r2.text(KEY);assert.equal((await invoke(w,purchase)).status,503);
  assert.equal(w.r2.text(KEY),before);noCustomerMail(w);
}));
check('D3 different-subscription renewal does not import unrelated payment references',()=>using(async w=>{
  const before=first(w);
  assert.equal((await invoke(w,event('invoice.paid',{id:'in_unrelated_TEST',customer:CUSTOMER,customer_email:EMAIL,
    subscription:'sub_unrelated_TEST',billing_reason:'subscription_cycle',amount_paid:9900,
    charge:'ch_unrelated_TEST',payment_intent:'pi_unrelated_TEST'}))).status,503);
  assert.deepEqual(first(w),before);noCustomerMail(w);
}));

check('D3 failed first enrollment cannot acknowledge or mail before required reference capture',()=>using(async w=>{
  w.r2.set(KEY,[]);w.r2.failNext('put',KEY,new Error('ENROLLMENT_WRITE_TEST'));
  const purchase=checkout();purchase.data.object.subscription='sub_primary_TEST';purchase.data.object.invoice='in_first_TEST';
  assert.equal((await invoke(w,purchase)).status,503);assert.deepEqual(w.r2.json(KEY),[]);noCustomerMail(w);
  assert.equal((await invoke(w,purchase)).status,200);
  assert.equal(first(w).billing_access.customer,CUSTOMER);assert.equal(customerMail(w).length,1);
}));

check('D3 failed existing-row token write cannot send an unusable first-delivery link',()=>using(async w=>{
  const rows=w.r2.json(KEY);delete rows[0].token;w.r2.set(KEY,rows);
  w.r2.failNext('put',KEY,new Error('TOKEN_WRITE_TEST'));
  const purchase=checkout();purchase.data.object.subscription='sub_primary_TEST';
  assert.equal((await invoke(w,purchase)).status,503);assert.equal(first(w).token,undefined);noCustomerMail(w);
  assert.equal((await invoke(w,purchase)).status,200);assert.match(first(w).token,/^[a-f0-9]{32}$/);
  assert.equal(customerMail(w).length,1);
}));
