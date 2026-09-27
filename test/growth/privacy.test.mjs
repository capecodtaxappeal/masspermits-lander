// Road to 100: no personal data in any response. Counts only.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
const NOW = H.T("2026-09-27T18:00:00Z");

// Every member name the payload may carry. A new one is a review decision.
const ALLOWED_KEYS = new Set([
  "as_of", "timezone", "goal", "paying_now", "paying_state", "sources", "stripe", "state", "scope", "reason",
  "visits", "data_starts", "old_offer_clicks_left_out", "clicks", "free", "weeks", "week", "last_day", "current",
  "at_least", "buy_clicks", "other_buy_clicks", "checkouts", "abandoned", "paid", "in_progress", "subscribers",
  "free_signups", "free_readers", "funnel", "this_week", "last_4_weeks", "all_weeks", "totals", "rates",
  "visit_to_click", "click_to_checkout", "checkout_to_paid", "checkout_abandoned", "visit_to_paid", "n", "d", "pct",
]);

async function richWorld() {
  const r2 = new H.GrowthR2();
  // hostile or personal-looking metadata in first-party objects: none of it may leave
  r2.hit(NOW - H.DAY, { p: "/permits/jane.doe@example.com", s: "owner@example.com", ci: "Plymouth", la: "41.9", lo: "-70.6", o: "Comcast", lang: "pt-br" });
  r2.hit(NOW - 2 * H.DAY, { p: "/offer/click" });
  r2.click(NOW - H.DAY, "dRmdR80Ms8WzctM9ZJ4gg01", { p: "/offer/", s: "customer01@example.com" });
  r2.set("subscribers.json", [{ email: "customer01@example.com", name: "Avery Testwood", customer: "cus_TEST000001" }]);
  r2.set("funnel-metrics.json", [{ at: new Date(NOW - H.HOUR).toISOString(), newsletter: { total: 3, confirmed: 2, by_town: { Plymouth: 2 } },
    prospects: { total: 2, by_trade: { Roofing: 2 } }, paying: 1 }]);
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer({
    sessions: [H.session(NOW - H.DAY, "complete"), H.session(NOW - 2 * H.DAY, "expired"), H.session(NOW - H.DAY, "complete", H.IRWATCH)],
    subscriptions: [H.sub(NOW - 40 * H.DAY, "active"), H.sub(NOW - 40 * H.DAY, "canceled", { ended: NOW - 3 * H.DAY })],
  });
  return r2;
}

function walk(v, keys, strings) {
  if (typeof v === "string") strings.push(v);
  else if (Array.isArray(v)) v.forEach((x) => walk(x, keys, strings));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x, keys, strings); }
}

test("the full payload: only allowed member names, and no email, name, id, path, town or key", async () => {
  const r2 = await richWorld();
  const res = await call({ env: envOf(r2, H.stripeEnv()), now: NOW });
  assert.equal(res.status, 200);
  const keys = new Set(), strings = [];
  walk(res.body, keys, strings);
  for (const k of keys) assert.ok(ALLOWED_KEYS.has(k), "unexpected member " + k);
  const bad = [/@/, /(cus|cs|sub|si|in|pi|ch|price)_[A-Za-z0-9]*[A-Z0-9]|rk_live|sk_live/, /Testwood|Avery|Plymouth|Comcast|Roofing/i,
    /\/permits|\/offer|buy\.stripe|dRmdR80/, /41\.9|70\.6|pt-br/];
  for (const s of strings) for (const re of bad) assert.ok(!re.test(s), JSON.stringify(s) + " matches " + re);
  for (const re of bad) assert.ok(!re.test(res.text), "raw text matches " + re);
  // the numbers are there
  assert.equal(res.body.paying_now, 1);
  assert.equal(res.body.weeks[12].visits, 1);
});

test("never reads the customer list or any email-keyed prefix", async () => {
  const r2 = await richWorld();
  await call({ env: envOf(r2, H.stripeEnv()), now: NOW });
  for (const o of r2.ops) {
    assert.ok(["list", "get"].includes(o.op), o.op);
    if (o.op === "get") assert.equal(o.key, "funnel-metrics.json");
    if (o.op === "list") assert.ok(o.key === "hits/" || o.key === "clicks/", o.key);
  }
});

test("refusals and errors carry no personal data either", async () => {
  const r2 = await richWorld();
  for (const o of [{ token: null }, { growth: false }, { query: "?email=owner@example.com" }]) {
    const res = await call({ ...o, env: envOf(r2, H.stripeEnv()), now: NOW });
    assert.ok(res.status >= 400);
    assert.ok(!/cus_|Testwood|customer01/.test(res.text));
  }
});
