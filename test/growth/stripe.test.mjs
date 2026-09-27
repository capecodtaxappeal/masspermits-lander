// Road to 100: what Stripe numbers count, what never counts, and what
// "unavailable" looks like.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
// Sunday 2026-09-27 14:00 in Boston. This week started Monday 2026-09-21 04:00Z.
const NOW = H.T("2026-09-27T18:00:00Z");
const WEEK_START = H.T("2026-09-21T04:00:00Z");
const STRIPE_KEYS = ["checkouts", "abandoned", "paid", "in_progress", "subscribers"];

async function run(data, env = H.stripeEnv(), o = {}) {
  g.stripe.resetGrowthCaches();
  const r2 = new H.GrowthR2();
  r2.hit(NOW - H.HOUR);
  stub.stripe = H.stripeServer(data, o);
  stub.reset();
  const res = await call({ env: envOf(r2, env), now: o.now ?? NOW });
  assert.equal(res.status, 200);
  return res;
}
const thisWeek = (res) => res.body.weeks[res.body.weeks.length - 1];

test("IRWatch-priced sessions and subscriptions on the shared account never count", async () => {
  const res = await run({
    sessions: [
      H.session(NOW - H.DAY, "complete"),
      H.session(NOW - H.DAY, "complete", H.IRWATCH),
      H.session(NOW - 2 * H.DAY, "expired", H.IRWATCH),
      H.session(NOW - 2 * H.DAY, "open", H.IRWATCH),
    ],
    subscriptions: [H.sub(NOW - 30 * H.DAY, "active"), H.sub(NOW - 30 * H.DAY, "active", { price: H.IRWATCH }),
      H.sub(NOW - 30 * H.DAY, "past_due", { price: H.IRWATCH })],
  });
  const w = thisWeek(res);
  assert.equal(w.checkouts, 1);
  assert.equal(w.paid, 1);
  assert.equal(w.abandoned, 0);
  assert.equal(w.subscribers, 1);
  assert.equal(res.body.paying_now, 1);
});

test("with MASSPERMITS_FEED_PRICE_IDS set, only the Weekly Feed counts; unset, every MassPermits price does and the page says so", async () => {
  const data = {
    sessions: [H.session(NOW - H.DAY, "complete"), H.session(NOW - H.DAY, "complete", H.PACK)],
    subscriptions: [H.sub(NOW - 30 * H.DAY, "active"), H.sub(NOW - 30 * H.DAY, "active", { price: H.PACK })],
  };
  const feed = await run(data);
  assert.equal(thisWeek(feed).checkouts, 1);
  assert.equal(feed.body.paying_now, 1);
  assert.equal(feed.body.sources.stripe.scope, "feed");
  const env = H.stripeEnv();
  delete env.MASSPERMITS_FEED_PRICE_IDS;
  const all = await run(data, env);
  assert.equal(thisWeek(all).checkouts, 2);
  assert.equal(all.body.paying_now, 2);
  assert.equal(all.body.sources.stripe.scope, "all");
});

test("a feed price that is not on the MassPermits price list is refused, so IRWatch cannot be let in by it", async () => {
  const res = await run({ sessions: [H.session(NOW - H.DAY, "complete", H.IRWATCH)], subscriptions: [] },
    H.stripeEnv({ MASSPERMITS_FEED_PRICE_IDS: H.IRWATCH }));
  assert.equal(stub.stripeCalls().length, 0);
  assert.equal(thisWeek(res).checkouts, "not connected");
  assert.equal(res.body.paying_now, null);
});

test("abandoned versus paid, including the 24 hour open rule", async () => {
  const M = 60000;
  const res = await run({
    sessions: [
      H.session(NOW - 2 * H.HOUR, "complete"),                 // paid
      H.session(NOW - 3 * H.DAY, "expired"),                   // abandoned
      H.session(NOW - 24 * H.HOUR, "open"),                    // open exactly 24h: abandoned
      H.session(NOW - 30 * H.HOUR, "open"),                    // open 30h: abandoned
      H.session(NOW - 24 * H.HOUR + M, "open"),                // open 23h59m: still in progress
      H.session(NOW - 10 * M, "open"),                         // just opened: in progress
    ],
    subscriptions: [],
  });
  const w = thisWeek(res);
  assert.equal(w.checkouts, 6);
  assert.equal(w.paid, 1);
  assert.equal(w.abandoned, 3);
  assert.equal(w.in_progress, 2);
  // the rule on its own
  const c = g.data.classifySession;
  assert.equal(c({ status: "open", created: (NOW - 24 * H.HOUR) / 1000 }, NOW), "abandoned");
  assert.equal(c({ status: "open", created: (NOW - 24 * H.HOUR + 1000) / 1000 }, NOW), "in_progress");
  assert.equal(c({ status: "complete", created: 1 }, NOW), "paid");
  assert.equal(c({ status: "expired", created: NOW / 1000 }, NOW), "abandoned");
  // a checkout that expired and was never completed is abandoned, not paid, whatever its age
  assert.equal(c({ status: "expired", created: (NOW - H.HOUR) / 1000 }, NOW), "abandoned");
});

test("the sessions list asks for every status since the first week, GET only, with the read key", async () => {
  await run({ sessions: [], subscriptions: [] });
  const calls = stub.stripeCalls();
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.method, "GET");
    assert.match(c.headers.Authorization, /^Bearer rk_live_/);
  }
  const s = new URL(calls.find((c) => c.url.includes("/v1/checkout/sessions")).url);
  assert.equal(s.searchParams.get("status"), null, "no status filter: open, expired and complete all come back");
  assert.equal(s.searchParams.get("expand[]"), "data.line_items");
  const first = g.data.weekGrid(NOW).start;
  assert.equal(Number(s.searchParams.get("created[gte]")), Math.floor(first / 1000));
  const u = new URL(calls.find((c) => c.url.includes("/v1/subscriptions")).url);
  assert.equal(u.searchParams.get("status"), "all");
});

test("Stripe unavailable shows as \"unavailable\", never zero", async () => {
  for (const fail of [() => true, (p) => p === "/v1/subscriptions", (p) => p === "/v1/checkout/sessions"]) {
    const res = await run({ sessions: [H.session(NOW - H.DAY, "complete")], subscriptions: [H.sub(NOW - 9 * H.DAY, "active")] },
      H.stripeEnv(), { fail });
    const subsDown = fail("/v1/subscriptions");
    const sessDown = fail("/v1/checkout/sessions");
    for (const w of res.body.weeks) {
      for (const k of ["checkouts", "abandoned", "paid", "in_progress"]) {
        if (sessDown) assert.equal(w[k], "unavailable", k);
        else assert.equal(typeof w[k], "number");
      }
      if (subsDown) assert.equal(w.subscribers, "unavailable");
      else assert.equal(typeof w.subscribers, "number");
    }
    assert.equal(res.body.paying_now, subsDown ? null : 1);
    if (subsDown) assert.equal(res.body.paying_state, "unavailable");
    assert.equal(res.body.sources.stripe.state, "unavailable");
  }
  // a thrown fetch, too
  g.stripe.resetGrowthCaches();
  const r2 = new H.GrowthR2();
  stub.stripe = () => { throw new Error("socket hang up"); };
  const res = await call({ env: envOf(r2, H.stripeEnv()), now: NOW });
  assert.equal(res.status, 200);
  for (const w of res.body.weeks) for (const k of STRIPE_KEYS) assert.equal(w[k], "unavailable");
  assert.ok(!res.text.includes("socket hang up"));
});

test("not connected and key refused make zero Stripe calls and say so", async () => {
  const cases = [
    [{ STRIPE_READ_KEY: "" }, "not connected"],
    [{ MASSPERMITS_PRICE_IDS: "" }, "not connected"],
    [{ STRIPE_READ_KEY: "sk_" + "live_" + "S".repeat(24) }, "key refused"],
    [{ STRIPE_READ_KEY: "rk_" + "test_" + "S".repeat(24) }, "key refused"],
    [{ STRIPE_READ_KEY: " " + H.liveKey() }, "key refused"],
  ];
  for (const [over, word] of cases) {
    const res = await run({ sessions: [H.session(NOW - H.DAY, "complete")], subscriptions: [] }, H.stripeEnv(over));
    assert.equal(stub.stripeCalls().length, 0, word);
    for (const w of res.body.weeks) for (const k of STRIPE_KEYS) assert.equal(w[k], word);
    assert.equal(res.body.paying_now, null);
    assert.equal(res.body.paying_state, word);
  }
});

test("Stripe reads are cached for 10 minutes; an unavailable read is never cached", async () => {
  g.stripe.resetGrowthCaches();
  const r2 = new H.GrowthR2();
  stub.stripe = H.stripeServer({ sessions: [H.session(NOW - H.DAY, "complete")], subscriptions: [] });
  stub.reset();
  const env = envOf(r2, H.stripeEnv());
  await call({ env, now: NOW });
  assert.equal(stub.stripeCalls().length, 2);
  await call({ env, now: NOW + 9 * 60000 });
  assert.equal(stub.stripeCalls().length, 2, "still cached at 9 minutes");
  await call({ env, now: NOW + 10 * 60000 });
  assert.equal(stub.stripeCalls().length, 4, "read again at 10 minutes");
  // failure then recovery: the failure is not served from cache
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer({ sessions: [], subscriptions: [] }, { fail: () => true });
  stub.reset();
  const bad = await call({ env, now: NOW });
  assert.equal(bad.body.sources.stripe.state, "unavailable");
  stub.stripe = H.stripeServer({ sessions: [], subscriptions: [H.sub(NOW - 9 * H.DAY, "active")] });
  const good = await call({ env, now: NOW + 1000 });
  assert.equal(good.body.paying_now, 1);
});

test("a list still going after its page cap marks the weeks it may be missing as \"at least\"", async () => {
  const sessions = [];
  for (let i = 0; i < 12; i++) sessions.push(H.session(NOW - i * 7 * H.DAY - H.HOUR, "complete"));
  g.stripe.resetGrowthCaches();
  const r2 = new H.GrowthR2();
  stub.stripe = H.stripeServer({ sessions, subscriptions: [H.sub(NOW - 9 * H.DAY, "active")] }, { pageSize: 1 });
  stub.reset();
  const res = await call({ env: envOf(r2, H.stripeEnv()), now: NOW });
  const L = g.stripe.GROWTH_STRIPE_LIMITS.MAX_PAGES;
  assert.ok(stub.stripeCalls().length <= L.sessions + L.subscriptions);
  assert.equal(res.body.sources.stripe.state, "partial");
  const weeks = res.body.weeks;
  // the 10 newest sessions came back; the weeks they cover are complete
  assert.ok(!weeks[weeks.length - 1].at_least.includes("checkouts"));
  assert.ok(weeks[0].at_least.includes("checkouts"), "the oldest week may be missing sessions");
  assert.equal(typeof weeks[0].checkouts, "number");
});

test("the Stripe projection keeps no id, customer, email, name or amount", async () => {
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer({ sessions: [H.session(NOW - H.DAY, "complete")], subscriptions: [H.sub(NOW - 9 * H.DAY, "active")] });
  const snap = await g.stripe.growthStripe(H.stripeEnv(), NOW, WEEK_START);
  assert.deepEqual(Object.keys(snap.sessions.items[0]).sort(), ["created", "status"]);
  assert.deepEqual(Object.keys(snap.subscriptions.items[0]).sort(), ["ended", "start", "status"]);
  const text = JSON.stringify(snap);
  for (const bad of ["cs_TEST", "cus_TEST", "sub_TEST", "@example.com", "Testwood", "9900", "price_"]) assert.ok(!text.includes(bad), bad);
});
