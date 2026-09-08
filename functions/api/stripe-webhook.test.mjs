// Regression test for stripe-webhook.js decideDelivery().
//
// WHY THIS FILE EXISTS. decideDelivery decides whether a Stripe event causes a
// paid product to be emailed to somebody. It is the single function in this
// repo where a wrong answer either (a) charges a customer and sends nothing, or
// (b) sends MassPermits data to a customer of the OTHER product on the same
// Stripe account. Both have happened: the $10 floor silently dropped every
// FIRST90 promo sale, and a 100%-off referral renewal was dropped for a year
// before anyone noticed the customer we had just thanked got no leads.
//
// It reads the SHIPPED source rather than a copy, so it cannot drift.
//
//   node functions/api/stripe-webhook.test.mjs
//
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "stripe-webhook.js"), "utf8");

// Lift MIN_CENTS + decideDelivery out of the module. The file is a Pages
// Function and exports only onRequestPost, so there is nothing to import.
const from = src.indexOf("const MIN_CENTS");
const to = src.indexOf("// Maintain the weekly-feed subscriber list");
if (from < 0 || to < 0 || to <= from) {
  console.error("could not locate decideDelivery in stripe-webhook.js — did the file move?");
  process.exit(1);
}
const decideDelivery = eval(`(function(){${src.slice(from, to)}return decideDelivery;})()`);

let failed = 0;
function t(name, event, want) {
  const d = decideDelivery(event);
  const got = d === null ? "null" : `${d.kind}${d.requireKnownSubscriber ? "+check" : ""}`;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name.padEnd(58)} -> ${got}` +
              (ok ? "" : `   (wanted ${want})`));
}

const checkout = (amount_total, mode) => ({
  type: "checkout.session.completed",
  data: { object: { amount_total, mode, customer_details: { email: "a@b.com" } } },
});
const invoice = (amt, billing_reason, customer_email = "a@b.com") => ({
  type: "invoice.paid",
  data: { object: { amount_paid: amt, total: amt, billing_reason, customer_email } },
});

console.log("UNCHANGED BEHAVIOUR — the paying path. Any FAIL here is a customer harmed.");
t("$99 subscription checkout", checkout(9900, "subscription"), "monthly");
t("$49 one-time pack checkout", checkout(4900, "payment"), "monthly");
t("$9.90 FIRST90 promo checkout (the $10 floor used to eat this)",
  checkout(990, "subscription"), "monthly");
t("$4.35 sibling-product checkout is NOT ours", checkout(435, "payment"), "null");
t("$0 subscription = a free-trial start, deliver", checkout(0, "subscription"), "monthly");
t("$0 one-time payment is not a trial", checkout(0, "payment"), "null");
t("$99 renewal", invoice(9900, "subscription_cycle"), "weekly");
t("first invoice skipped — checkout.session already delivered",
  invoice(9900, "subscription_create"), "null");
t("$4.35 sibling-product renewal is NOT ours", invoice(435, "subscription_cycle"), "null");
t("$2.00 renewal is still under the floor", invoice(200, "subscription_cycle"), "null");

console.log("\nTHE REFERRAL MONTH THAT USED TO VANISH (2026-09-08):");
t("$0 renewal with an email -> deliver, gated on being a known subscriber",
  invoice(0, "subscription_cycle"), "weekly+check");
t("$0 renewal with no email -> dropped", invoice(0, "subscription_cycle", ""), "null");
t("$0 subscription_create is still skipped", invoice(0, "subscription_create"), "null");

console.log("\nTHE GATE ITSELF. A $0 invoice must NEVER deliver on amount alone —");
console.log("the caller checks subscribers.json, and that check is what keeps the");
console.log("sibling product's customers out. If requireKnownSubscriber is ever");
console.log("dropped from the caller, this test still passes and the separation is");
console.log("gone; the caller's branch is the thing to protect in review.");
const zero = decideDelivery(invoice(0, "subscription_cycle"));
if (!zero || !zero.requireKnownSubscriber) {
  console.log("  FAIL  a $0 renewal decision must carry requireKnownSubscriber");
  failed++;
} else {
  console.log("  ok    a $0 renewal decision carries requireKnownSubscriber");
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
