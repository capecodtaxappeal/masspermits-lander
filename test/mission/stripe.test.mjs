// P1-9, P1-10: the Stripe key rule, the failed tile, and the outbound lock.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { m, stub, get } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");
const PRICES = H.PRICE_A + "," + H.PRICE_B;
const connected = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: PRICES };
const PATHS = new Set(["/v1/subscriptions", "/v1/invoices", "/v1/checkout/sessions", "/v1/webhook_endpoints"]);

async function world(o = {}) {
  const w = await H.healthyWorld(NOW, o);
  stub.stripe = H.stripeFake(H.stripeData(w.roster, NOW, o), o.fake || {});
  stub.reset();
  return w;
}

test("P1-9 key shapes other than rk_live_ are refused with 0 calls", async () => {
  for (const key of ["sk_" + "live_" + "S".repeat(24), "rk_" + "test_" + "T".repeat(24),
    "sk_" + "test_" + "T".repeat(24), " " + H.liveKey(), H.liveKey() + "\n", "   ", "rk_" + "live_" + "short"]) {
    const w = await world();
    const res = await get(w, { env: { STRIPE_READ_KEY: key, MASSPERMITS_PRICE_IDS: PRICES } });
    assert.equal(res.status, 200);
    assert.equal(res.body.detail.setup.stripe, "refused", JSON.stringify(key));
    assert.equal(stub.stripeCalls().length, 0);
    assert.ok(H.lineIds(res.body, "amber").includes("stripe_refused"));
    for (const id of ["revenue", "renewals"]) {
      const t = H.tileOf(res.body, id);
      assert.equal(t.state, "grey");
      assert.equal(t.value, null);
    }
  }
});

test("P1-9 unset key -> not-connected; revenue and renewals grey with value null, never 0", async () => {
  const w = await world();
  const res = await get(w);
  assert.equal(res.body.detail.setup.stripe, "not-connected");
  for (const id of ["revenue", "renewals"]) {
    const t = H.tileOf(res.body, id);
    assert.deepEqual([t.state, t.grey, t.value, t.source], ["grey", "not-connected", null, "none"]);
  }
  assert.ok(H.lineIds(res.body, "known").includes("stripe_not_connected"));
  assert.equal(stub.stripeCalls().length, 0);
});

test("P1-9 empty price list -> not-connected with 0 calls", async () => {
  for (const list of ["", " , ", undefined]) {
    const w = await world();
    const res = await get(w, { env: { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: list } });
    assert.equal(res.body.detail.setup.stripe, "not-connected");
    assert.equal(res.body.detail.setup.price_list, "missing");
    assert.equal(stub.stripeCalls().length, 0);
  }
});

test("connected: numbers from both invoice line shapes, other product never counted", async () => {
  const w = await world();
  const res = await get(w, { env: connected });
  assert.equal(res.body.detail.setup.stripe, "ok");
  const t = (id) => H.tileOf(res.body, id);
  assert.deepEqual([t("paying").value, t("paying").source], [5, "stripe"]);
  assert.equal(t("revenue").value, 4900 + 4900 + 2900);
  assert.equal(t("revenue").sub, "list-price run rate $245.00/mo");
  assert.equal(t("renewals").value, 0);
  assert.deepEqual([t("failed").state, t("failed").value, t("failed").source], ["green", 0, "stripe"]);
  assert.equal(res.body.detail.sales.new_subscription_cents, 4900);
  assert.equal(res.body.detail.sales.pack_cents, 2900);
  assert.equal(res.body.detail.customers.rows[0].plan, "monthly");
  assert.ok(stub.stripeCalls().length <= 6);
  H.assertClean(assert, res, w.r2, "connected");
});

test("P1-9 failed tile (a): Stripe unset, no payment_failing row -> grey unverified, value 0, never green", async () => {
  const w = await world();
  const f = H.tileOf((await get(w)).body, "failed");
  assert.deepEqual([f.state, f.grey, f.value, f.source, f.sub],
    ["grey", "unverified", 0, "r2", "webhook flags only; registration not verified"]);
});

async function failedTile(fake, envOver, rosterFailing = 0) {
  const w = await world({ fake });
  if (rosterFailing) {
    w.roster[0].payment_failing = true;
    w.r2.set("subscribers.json", w.roster, { uploaded: NOW - H.DAY });
  }
  const res = await get(w, { env: envOver });
  return { res, f: H.tileOf(res.body, "failed") };
}

test("P1-9 failed tile (b): refused, partial and unavailable Stripe -> grey unverified as well", async () => {
  const cases = {
    refused: [{}, { STRIPE_READ_KEY: "sk_" + "live_" + "S".repeat(24), MASSPERMITS_PRICE_IDS: PRICES }],
    partial: [{ pageSize: 2, alwaysMore: (route) => route === "/v1/subscriptions" }, connected],
    unavailable: [{ fail: (route, status) => route === "/v1/invoices" && status === "open"
      ? { status: 500, body: { error: { message: "boom" } } } : null }, connected],
  };
  for (const [name, [fake, e]] of Object.entries(cases)) {
    const { res, f } = await failedTile(fake, e);
    const marker = { refused: "stripe_refused", partial: "stripe_partial", unavailable: null }[name];
    if (marker) assert.ok(H.lineIds(res.body).includes(marker), name);
    assert.deepEqual([f.state, f.grey, f.value, f.source], ["grey", "unverified", 0, "r2"], name);
  }
});

test("P1-9 failed tile (c): any non-ok Stripe state with one payment_failing row -> red 1", async () => {
  for (const e of [{}, { STRIPE_READ_KEY: "rk_" + "test_" + "T".repeat(24), MASSPERMITS_PRICE_IDS: PRICES }]) {
    const { res, f } = await failedTile({}, e, 1);
    assert.deepEqual([f.state, f.value, f.source], ["red", 1, "r2"]);
    assert.equal(res.body.needs_you[0].id, "failed_payments");
  }
  const { f } = await failedTile({ pageSize: 2, alwaysMore: (r) => r === "/v1/subscriptions" }, connected, 1);
  assert.deepEqual([f.state, f.value], ["red", 1]);
});

test("P1-9 failed tile (d): Stripe ok, nothing failing -> green even without invoice.payment_failed registered", async () => {
  const w = await world({ webhooks: [{ id: "we_TEST000002", status: "enabled", enabled_events: ["checkout.session.completed"] }] });
  const res = await get(w, { env: connected });
  const f = H.tileOf(res.body, "failed");
  assert.deepEqual([f.state, f.value, f.source], ["green", 0, "stripe"]);
  assert.ok(H.lineIds(res.body, "amber").includes("webhook_events"));
  assert.deepEqual(res.body.detail.setup.webhook_events,
    { "invoice.payment_failed": false, "customer.subscription.deleted": false });
});

test("P1-9 failed tile (e): Stripe ok, one open MassPermits invoice with attempt_count 1 -> red", async () => {
  const w = await world({ openInvoices: [
    { id: "in_TESTopen0001", customer: "cus_TEST000002", status: "open", amount_due: 4900, amount_paid: 0,
      currency: "usd", created: Math.floor(NOW / 1000) - 86400, attempt_count: 1, billing_reason: "subscription_cycle",
      lines: { data: [{ pricing: { price_details: { price: H.PRICE_A } } }] } },
    { id: "in_TESTopen0002", customer: "cus_TESTother01", status: "open", amount_due: 99900, amount_paid: 0,
      currency: "usd", created: Math.floor(NOW / 1000) - 86400, attempt_count: 3, billing_reason: "subscription_cycle",
      lines: { data: [{ price: { id: H.PRICE_OTHER } }] } },
  ] });
  const res = await get(w, { env: connected });
  const f = H.tileOf(res.body, "failed");
  assert.deepEqual([f.state, f.value, f.source], ["red", 1, "stripe"]);
  assert.equal(res.body.detail.failed_payments.rows.length, 1);
  assert.equal(res.body.detail.failed_payments.rows[0].stripe_url, "https://dashboard.stripe.com/invoices/in_TESTopen0001");
});

test("P1-9 failed tile (f): roster unreadable and Stripe unset -> grey unavailable, value null", async () => {
  const w = await world();
  w.r2.fail.add("get:subscribers.json");
  const res = await get(w);
  const f = H.tileOf(res.body, "failed");
  assert.deepEqual([f.state, f.grey, f.value], ["grey", "unavailable", null]);
});

test("P1-9 the failed tile is green only when Stripe is ok", async () => {
  for (const e of [{}, { STRIPE_READ_KEY: "sk_" + "live_" + "S".repeat(24), MASSPERMITS_PRICE_IDS: PRICES }]) {
    const { f } = await failedTile({}, e);
    assert.notEqual(f.state, "green");
  }
});

test("P1-10 stripeGet refuses anything that is not a GET to api.stripe.com, with 0 calls", async () => {
  stub.reset();
  for (const [url, method] of [["https://masspermits.com/x", "GET"], ["https://api.stripe.com.evil.example/x", "GET"],
    ["http://api.stripe.com/v1/x", "GET"], ["https://api.stripe.com/v1/x", "POST"],
    ["https://api.stripe.com@evil.example/v1/x", "GET"], ["not a url", "GET"]]) {
    await assert.rejects(m.stripe.stripeGet(url, H.liveKey(), method), /outbound_blocked/, url + " " + method);
  }
  assert.equal(stub.calls.length, 0);
});

test("P1-10 every Stripe call is a GET to one of the five paths, never expanding customer", async () => {
  const w = await world({ fake: { pageSize: 2 } });
  await get(w, { env: connected });
  const calls = stub.stripeCalls();
  assert.ok(calls.length >= 5);
  for (const c of calls) {
    const u = new URL(c.url);
    assert.equal(c.method, "GET");
    assert.ok(PATHS.has(u.pathname), u.pathname);
    assert.ok(!decodeURIComponent(c.url).includes("data.customer"), c.url);
    assert.equal(c.headers["Stripe-Version"], "2026-08-26.dahlia");
    assert.equal(c.headers.Accept, "application/json");
    assert.equal(c.headers.Authorization, "Bearer " + H.liveKey());
    if (u.pathname === "/v1/checkout/sessions") assert.equal(u.searchParams.get("expand[]"), "data.line_items");
    assert.equal(u.searchParams.get("limit"), "100");
  }
});

test("P1-10 a hostile starting_after id is refused and the section goes partial", async () => {
  const w = await world();
  const data = H.stripeData(w.roster, NOW);
  data.subscriptions[0].id = "sub_1&expand[]=data.customer";
  stub.stripe = H.stripeFake({ ...data, subscriptions: [data.subscriptions[0]] }, { alwaysMore: (r) => r === "/v1/subscriptions" });
  stub.reset();
  const res = await get(w, { env: connected });
  const subCalls = stub.stripeCalls().filter((c) => c.url.includes("/v1/subscriptions"));
  assert.equal(subCalls.length, 1, "no second page requested");
  for (const c of stub.stripeCalls()) assert.ok(!decodeURIComponent(c.url).includes("data.customer"));
  assert.ok(H.lineIds(res.body, "known").includes("stripe_partial"));
});
