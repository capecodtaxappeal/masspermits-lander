// Pay path audit: functions/api/stripe-webhook.js against the SHIPPED source.
//   node --test test/paypath-audit/stripe-webhook.audit.test.mjs
// See _harness.mjs for the DEFECT / OK naming rule and the no-network guard.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO, load, fakeR2, env, ev, stripeRequest, mail, resetMail, OWNER, sub, zip, body } from "./_harness.mjs";

const sw = await load("functions/api/stripe-webhook.js");
const post = (r2, event, opts) => sw.onRequestPost({ request: stripeRequest(event, opts), env: env(r2) });
const toSub = (addr) => mail.filter((x) => x.to === addr);
const toOwner = () => mail.filter((x) => x.to === OWNER);

function world(subs = [], extra = {}, opt) {
  return fakeR2({ "subscribers.json": subs, "latest-monthly.zip": zip("monthly"), "latest-weekly.zip": zip("weekly"), ...extra }, opt);
}
const checkout = (email, o = {}) => ev("checkout.session.completed", {
  id: "cs_test_" + Math.random().toString(36).slice(2, 8), mode: "subscription", amount_total: 9900,
  payment_status: "paid", customer: "cus_test1", customer_details: { email, name: "Test Buyer" }, ...o });

// ---------------------------------------------------------------- idempotency
test("DEFECT F1a: a redelivered checkout.session.completed (same event id) sends the welcome bundle twice", async () => {
  resetMail();
  const r2 = world();
  const e = checkout("sub001@example.test");
  assert.equal((await post(r2, e)).status, 200);
  assert.equal((await post(r2, e)).status, 200);   // Stripe retry / duplicate delivery
  assert.equal(toSub("sub001@example.test").length, 1, "one event id must produce one welcome email");
});

test("DEFECT F1b: a redelivered referral checkout tells the owner to credit the referrer twice ($198 instead of $99)", async () => {
  resetMail();
  const r2 = world();
  // referrer buys first, which mints their code
  const first = checkout("sub001@example.test", { customer: "cus_test1" });
  await post(r2, first);
  const code = [...r2.m.keys()].find((k) => k.startsWith("referral/codes/")).slice("referral/codes/".length);
  resetMail();
  const e = checkout("sub002@example.test", { customer: "cus_test2", client_reference_id: "ref-" + code });
  await post(r2, e);
  await post(r2, e);
  const credits = [...r2.m.keys()].filter((k) => k.startsWith("referral/credits/"));
  const ownerReferral = toOwner().filter((x) => /Referral landed/.test(x.subject));
  assert.equal(credits.length, 1, "one referral must produce one credit record, got " + credits.length);
  assert.equal(ownerReferral.length, 1, "owner must be asked to pay one credit, got " + ownerReferral.length);
});

test("DEFECT F2: a signed event with a years-old timestamp is accepted (no replay tolerance window)", async () => {
  resetMail();
  const r2 = world();
  const old = Math.floor(Date.parse("2021-01-01T00:00:00Z") / 1000);
  const res = await post(r2, checkout("sub001@example.test"), { t: old });
  assert.equal(res.status, 400, "Stripe's own libraries reject t older than 300 s; got " + res.status);
});

// ---------------------------------------------------------------- async payment (ACH)
test("DEFECT F3a: checkout.session.completed with payment_status=unpaid (ACH pending) delivers and activates before any money settles", async () => {
  resetMail();
  const r2 = world();
  await post(r2, checkout("sub001@example.test", { payment_status: "unpaid" }));
  assert.equal(toSub("sub001@example.test").length, 0, "nothing should ship before async_payment_succeeded");
});

test("DEFECT F3b: checkout.session.async_payment_failed is ignored, so the unpaid buyer stays an active subscriber", async () => {
  resetMail();
  const r2 = world();
  await post(r2, checkout("sub001@example.test", { payment_status: "unpaid" }));
  const res = await body(await post(r2, ev("checkout.session.async_payment_failed", {
    mode: "subscription", customer: "cus_test1", payment_status: "unpaid",
    customer_details: { email: "sub001@example.test" } })));
  const row = r2.json("subscribers.json").find((s) => s.email === "sub001@example.test");
  assert.notEqual(res.skipped, "checkout.session.async_payment_failed", "event must be handled");
  assert.equal(row && row.active, false, "a failed ACH payment must not leave the row active");
});

// ---------------------------------------------------------------- disputes, fraud, refunds
const DISPUTE = { id: "dp_test1", object: "dispute", amount: 9900, charge: "ch_test1", payment_intent: "pi_test1",
  reason: "fraudulent", status: "needs_response", evidence: { customer_email_address: "sub001@example.test" } };
const EFW = { id: "issfr_test1", object: "radar.early_fraud_warning", charge: "ch_test1", payment_intent: "pi_test1",
  fraud_type: "made_with_stolen_card", actionable: true };
const REVIEW = { id: "prv_test1", object: "review", charge: "ch_test1", payment_intent: "pi_test1", reason: "rule", open: true };

for (const [type, obj] of [["charge.dispute.created", DISPUTE], ["radar.early_fraud_warning.created", EFW], ["review.opened", REVIEW]]) {
  test(`DEFECT F4: ${type} with Stripe's real object shape (no customer, no customer_email) stops nobody`, async () => {
    resetMail();
    const r2 = world([sub(1)]);
    const res = await body(await post(r2, ev(type, obj)));
    assert.ok(res.stopped >= 1, `the hold must stop the disputed subscriber; stopped=${res.stopped}`);
  });
}

test("DEFECT F5: a held (active:false after dispute) subscriber still gets the weekly bundle from the next invoice.paid renewal", async () => {
  resetMail();
  const r2 = world([sub(1, { active: false, payment_detail: { radar: "charge.dispute.created" } })]);
  await post(r2, ev("invoice.paid", { billing_reason: "subscription_cycle", amount_paid: 9900, customer: "cus_test1",
    customer_email: "sub001@example.test" }));
  assert.equal(toSub("sub001@example.test").length, 0, "\"Nothing further ships to them until you decide\"");
});

test("DEFECT F6: charge.refunded is not handled: no flag, no owner alert, feed continues", async () => {
  resetMail();
  const r2 = world([sub(1)]);
  const res = await body(await post(r2, ev("charge.refunded", { id: "ch_test1", object: "charge", customer: "cus_test1",
    amount: 9900, amount_refunded: 9900, refunded: true, billing_details: { email: "sub001@example.test" } })));
  const row = r2.json("subscribers.json")[0];
  const noticed = toOwner().length > 0 || row.active === false || !!row.payment_detail;
  assert.ok(noticed, "a full refund must at least reach the owner; response was " + JSON.stringify(res));
});

// ---------------------------------------------------------------- lifecycle
test("DEFECT F7: buyer subscribes twice, cancels the newer duplicate, and is cut off while the first subscription still bills", async () => {
  resetMail();
  const r2 = world();
  await post(r2, checkout("sub001@example.test", { customer: "cus_testA", subscription: "sub_testA" }));
  await post(r2, checkout("sub001@example.test", { customer: "cus_testB", subscription: "sub_testB" }));
  await post(r2, ev("customer.subscription.deleted", { id: "sub_testB", customer: "cus_testB", status: "canceled" }));
  const row = r2.json("subscribers.json").find((s) => s.email === "sub001@example.test");
  assert.equal(row.active, true, "sub_testA (cus_testA) is still active and billing $99");
});

test("DEFECT F8: customer.subscription.updated to unpaid/paused is ignored, so a non-paying row stays active", async () => {
  resetMail();
  const r2 = world([sub(1)]);
  await post(r2, ev("customer.subscription.updated", { id: "sub_test1", customer: "cus_test1", status: "unpaid" }));
  assert.equal(r2.json("subscribers.json")[0].active, false, "status=unpaid means Stripe stopped collecting");
});

test("DEFECT F9: email case/whitespace variant on re-subscribe creates a second row instead of reactivating", async () => {
  resetMail();
  const r2 = world([sub(1, { active: false, cancelled: "2026-10-01" })]);
  await post(r2, checkout(" Sub001@Example.TEST", { customer: "cus_test9" }));
  const rows = r2.json("subscribers.json");
  assert.equal(rows.length, 1, "one person, one row; got " + rows.length);
});

// ---------------------------------------------------------------- R2 failure handling
test("DEFECT F10a: a transient R2 read failure on subscribers.json loses a new paying subscriber silently (200, no row)", async () => {
  resetMail();
  const r2 = world([sub(2)]);
  r2.throwOn.add("get:subscribers.json");
  const res = await post(r2, checkout("sub001@example.test"));
  const rows = r2.json("subscribers.json");
  const stored = rows.some((s) => s.email === "sub001@example.test");
  assert.ok(stored || res.status >= 500, `either store the row or return 5xx so Stripe retries; status=${res.status} stored=${stored}`);
});

test("DEFECT F10b: a transient R2 write failure on subscribers.json loses a new paying subscriber silently", async () => {
  resetMail();
  const r2 = world([]);
  r2.throwOn.add("put:subscribers.json");
  const res = await post(r2, checkout("sub001@example.test"));
  const stored = r2.json("subscribers.json").some((s) => s.email === "sub001@example.test");
  assert.ok(stored || res.status >= 500, `status=${res.status} stored=${stored}`);
});

test("DEFECT F11: two checkouts landing together lose one subscriber row (read-modify-write race on subscribers.json)", async () => {
  resetMail();
  const r2 = world([], {}, { latencyMs: 5 });
  await Promise.all([
    post(r2, checkout("sub001@example.test", { customer: "cus_test1" })),
    post(r2, checkout("sub002@example.test", { customer: "cus_test2" })),
  ]);
  const emails = r2.json("subscribers.json").map((s) => s.email).sort();
  assert.deepEqual(emails, ["sub001@example.test", "sub002@example.test"]);
});

test("DEFECT F12: latest-monthly.zip missing at checkout returns 500 BEFORE the subscriber is recorded", async () => {
  resetMail();
  const r2 = fakeR2({ "subscribers.json": [], "latest-weekly.zip": zip() });
  const res = await post(r2, checkout("sub001@example.test"));
  const stored = r2.json("subscribers.json").some((s) => s.email === "sub001@example.test");
  assert.equal(res.status, 500);
  assert.ok(stored, "the paying subscriber should be on the Monday roster even if the welcome file is missing");
});

// ---------------------------------------------------------------- correct today
test("OK: bad, missing and tampered signatures are rejected with 400 and leak no HMAC material", async () => {
  resetMail();
  const r2 = world();
  const e = checkout("sub001@example.test");
  for (const res of [
    await post(r2, e, { secret: "whsec_wrong" }),
    await post(r2, e, { tamper: true }),
    await sw.onRequestPost({ request: new Request("https://masspermits.com/api/stripe-webhook", { method: "POST", body: "{}" }), env: env(r2) }),
  ]) {
    assert.equal(res.status, 400);
    const b = await res.text();
    assert.ok(!/computedPrefix|gotPrefix/.test(b), b);
  }
  assert.equal(mail.length, 0);
});

test("OK: MIN_CENTS = 500 is unchanged and a $4.35 sibling-product charge ships nothing", async () => {
  const src = readFileSync(path.join(REPO, "functions/api/stripe-webhook.js"), "utf8");
  assert.match(src, /^const MIN_CENTS = 500;$/m);
  resetMail();
  const r2 = world();
  await post(r2, checkout("sub001@example.test", { amount_total: 435, mode: "payment" }));
  await post(r2, ev("invoice.paid", { billing_reason: "subscription_cycle", amount_paid: 435, customer_email: "sub001@example.test" }));
  assert.equal(mail.length, 0);
});

test("OK: a $0 renewal ships only to a known active subscriber", async () => {
  resetMail();
  const r2 = world([sub(1)]);
  const inv = (e) => ev("invoice.paid", { billing_reason: "subscription_cycle", amount_paid: 0, total: 0, customer_email: e });
  await post(r2, inv("sub001@example.test"));
  await post(r2, inv("sub099@example.test"));
  assert.deepEqual(mail.map((m) => m.to), ["sub001@example.test"]);
});

test("OK: invoice.payment_failed flags the row, keeps it active, and alerts the owner", async () => {
  resetMail();
  const r2 = world([sub(1)]);
  await post(r2, ev("invoice.payment_failed", { customer: "cus_test1", customer_email: "sub001@example.test", attempt_count: 1 }));
  const row = r2.json("subscribers.json")[0];
  assert.equal(row.active, true);
  assert.ok(row.payment_failing);
  assert.equal(toOwner().length, 1);
});

test("OK: cancellation of a dead customer id does not revoke a row that re-subscribed under a new id", async () => {
  resetMail();
  const r2 = world([sub(1, { customer: "cus_testNEW" })]);
  await post(r2, ev("customer.subscription.deleted", { customer: "cus_testOLD", customer_email: "sub001@example.test" }));
  assert.equal(r2.json("subscribers.json")[0].active, true);
});

test("OK: new subscriber token is 32 lowercase hex (crypto.randomUUID, 122 random bits) and is in the welcome email", async () => {
  resetMail();
  const r2 = world();
  await post(r2, checkout("sub001@example.test"));
  const row = r2.json("subscribers.json")[0];
  assert.match(row.token, /^[0-9a-f]{32}$/);
  assert.ok(mail[0].body.html.includes("t=" + row.token));
});
