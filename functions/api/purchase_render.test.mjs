// Purchase-email CI render: the SHIPPED stripe-webhook.js, imported as it is,
// given a synthetic checkout.session.completed signed with a made-up secret.
//
//   node functions/api/purchase_render.test.mjs
//
// The fetch stub answers only the Resend URL (captured, nothing leaves the
// process). The test asserts the delivery path ran (one email, to the synthetic
// buyer, one recipient) and REPORTS the two copy facts the rehearsal's C5 reads:
//   purchase.link_first  the first <a href> is the private &k=monthly download link
//   purchase.month_line  the email promises "you both get a month"
// The facts are printed, not pinned: C5 judges them (R2a/R3a), this proves the
// render can be produced offline from shipped code.

import { onRequestPost } from "./stripe-webhook.js";
import {
  fakeR2, makeFetchStub, resendFixture, makeRunner, stripeSignature, purchaseFacts,
  TEST_WEBHOOK_SECRET, zipBytes,
} from "../../test/rehearsal/harness.mjs";

const resend = resendFixture("https://api.resend.com/emails");
const stub = makeFetchStub({ [resend.url]: resend.handler });
globalThis.fetch = stub.fetch;

const { check, done } = makeRunner("purchase_render.test.mjs");

const BUYER = "pat.invented@example.com";
const event = {
  id: "evt_TEST1", object: "event", type: "checkout.session.completed",
  data: { object: {
    id: "cs_TEST1", object: "checkout.session", mode: "subscription", amount_total: 9900,
    customer: "cus_TEST9", client_reference_id: "",
    customer_details: { email: BUYER, name: "Pat Invented" },
  } },
};

function env(r2) {
  return { BUNDLES: r2.bucket, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
           RESEND_API_KEY: "re_test_x", FROM_EMAIL: "MassPermits <leads@example.com>",
           OWNER_EMAIL: "owner@example.com" };
}
const world = () => fakeR2({
  "subscribers.json": [],
  "latest-monthly.zip": { __r2: {}, value: zipBytes(256) },
  "latest-weekly.zip": { __r2: {}, value: zipBytes(128) },
});
const post = (payload, sig) => new Request("https://rehearsal.test/stripe", {
  method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: payload,
});

let facts = { link_first: false, month_line: false };
let render = "error";

// 1. a correctly signed purchase renders and is captured
{
  const r2 = world();
  const payload = JSON.stringify(event);
  const res = await onRequestPost({ request: post(payload, stripeSignature(payload)), env: env(r2), waitUntil() {} });
  check("signed checkout.session.completed -> 200", res.status === 200, res.status);
  check("exactly 1 Resend body", resend.sent.length === 1, resend.sent.length);
  const b = resend.sent[0] || {};
  check("addressed to the synthetic buyer only, one recipient",
    Array.isArray(b.to) && b.to.length === 1 && b.to[0] === BUYER);
  check("subject is the lead-pack subject", b.subject === "Your MassPermits lead pack", b.subject);
  check("the monthly bundle is attached", Array.isArray(b.attachments) && /^MassPermits-monthly-\d{4}-\d{2}-\d{2}\.zip$/.test(b.attachments[0].filename));
  const rows = r2.json("subscribers.json") || [];
  check("the fake roster gained the buyer's row with a 32-hex token",
    rows.length === 1 && /^[0-9a-f]{32}$/.test(rows[0].token || ""));
  if (typeof b.html === "string" && b.html.length > 0) {
    render = "ok";
    facts = purchaseFacts(b.html);
    check("the rendered html links the row's own token",
      rows[0] && b.html.includes("t=" + rows[0].token + "&k=monthly"));
  }
}

// 2. a bad signature sends nothing and writes nothing
{
  const r2 = world();
  const before = resend.sent.length;
  const payload = JSON.stringify(event);
  const res = await onRequestPost({
    request: post(payload, stripeSignature(payload, "whsec_wrong_" + "1".repeat(24))),
    env: env(r2), waitUntil() {} });
  check("wrong secret -> 400", res.status === 400, res.status);
  check("wrong secret -> 0 Resend calls", resend.sent.length === before);
  check("wrong secret -> 0 R2 writes", r2.writes().length === 0);
}

// 3. the facts helper itself, on hand-made html (so a pass is not vacuous)
{
  const good = '<p><a href="https://masspermits.com/api/my-leads?t=' + "d".repeat(32) + '&k=monthly">x</a></p>';
  const bad = '<p><a href="https://masspermits.com/r/abc">x</a> you both get a month</p>' + good;
  const g = purchaseFacts(good), x = purchaseFacts(bad);
  check("purchaseFacts: download link first -> link_first true", g.link_first === true && g.month_line === false);
  check("purchaseFacts: referral link first + month line -> link_first false, month_line true",
    x.link_first === false && x.month_line === true);
}

console.log(`PURCHASE facts (shipped stripe-webhook.js): render=${render} ` +
            `link_first=${facts.link_first} month_line=${facts.month_line}`);
check("purchase.render ok", render === "ok");
check("fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
done();
