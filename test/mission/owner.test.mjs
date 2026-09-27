// D31: the owner's answers to the nine build-session questions (2026-09-27),
// plus the replaced-account invoice (2026-09-26). The changed answers (a, f,
// g, i and the replaced account) each have a test here that fails on the code
// before this change; g's hand-worked case is also in cor.test.mjs (4). The
// "keep" answers (b, c, d, e, h) are pinned so a later edit cannot flip them
// quietly. All fixtures are synthetic: @example.com, cus_TEST..., sub_TEST...
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, stub, get, owner } = await H.setup();
const V = m.view;
const { T, DAY, HOUR } = H;
const NOW = T("2026-09-30T18:00:00Z"); // a Wednesday
const MON = (hms) => T("2026-09-28T" + hms + "Z");
const STRIPE_ENV = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A + "," + H.PRICE_B };
const tileOf = (res, id) => H.tileOf(res.body, id);
const lineOf = (res, id) => res.body.needs_you.find((l) => l.id === id);
const withStripe = async (data, fn) => {
  stub.stripe = H.stripeFake(data);
  try { return await fn(); } finally { stub.stripe = null; }
};
const openInvoice = (id, customer, o = {}) => ({
  id, object: "invoice", customer, status: "open", amount_due: 4900, amount_paid: 0, currency: "usd",
  created: Math.floor(NOW / 1000) - 20 * DAY / 1000, attempt_count: o.attempts ?? 3, billing_reason: "subscription_cycle",
  subscription: o.subscription, ...(o.email ? { customer_email: o.email } : {}),
  lines: { data: [{ price: { id: H.PRICE_A } }] },
});

// ── a. a failed Monday send is also listed as "not delivered" ───────────────
test("a. every send failed and nobody was delivered: the failed addresses are also listed as not delivered", async () => {
  const w = await H.healthyWorld(MON("21:00:00"), { mondayLog: false, roster: 3 });
  w.r2.set("feed-send-log.json", [H.logEntry(MON("15:40:00"), w.roster.map((r) => ({ to: r.email, ok: false })))]);
  const res = await get(w);
  const d = res.body.detail.monday;
  assert.equal(tileOf(res, "monday").state, "red");
  assert.equal(d.failed.length, 3);
  assert.deepEqual(d.missing.map((r) => r.t8).sort(), d.failed.map((r) => r.t8).sort(),
    "each failed subscriber is also under Expected but not delivered");
  // and with one delivered, the failed one is on both lists (unchanged)
  const v = await H.healthyWorld(MON("21:00:00"), { mondayLog: false, roster: 3 });
  v.r2.set("feed-send-log.json", [H.logEntry(MON("15:40:00"), v.roster.map((r, i) => ({ to: r.email, ok: i !== 1 })))]);
  const d2 = (await get(v)).body.detail.monday;
  assert.deepEqual([d2.failed.length, d2.missing.length], [1, 1]);
  assert.equal(d2.missing[0].t8, d2.failed[0].t8);
});

// ── f. when the map hides a value for privacy, the page says so ──────────────
test("f. a map payload with privacy redactions shows a sentence under the map; none when there are none", async () => {
  assert.equal(V.mapPrivacy({ privacy_redactions: 0 }), "");
  assert.equal(V.mapPrivacy(null), "");
  assert.equal(V.mapPrivacy({ privacy_redactions: 1 }), "The privacy check withheld 1 value from this map. The page needs a fix.");
  assert.equal(V.mapPrivacy({ privacy_redactions: 3 }), "The privacy check withheld 3 values from this map. The page needs a fix.");
  const html = fs.readFileSync(path.join(H.REPO, "admin/mission.html"), "utf8");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const geo = JSON.parse(fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"), "utf8"));
  const w = await H.healthyWorld(NOW);
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  const draw = (mapBody) => {
    const doc = H.fakeDocumentFrom(body);
    globalThis.document = doc;
    const root = doc.getElementById("mission");
    m.render.render(root, { main: { status: 200, json: main.body }, map: { status: 200, json: mapBody },
      towns: { status: 200, json: geo } }, { now: NOW, onRefresh() {}, onEdit() {}, inert: true });
    return root.byPart("map-privacy").map((n) => n.textContent);
  };
  assert.deepEqual(draw(map.body), []);
  assert.deepEqual(draw({ ...map.body, privacy_redactions: 2 }),
    ["The privacy check withheld 2 values from this map. The page needs a fix."]);
});

// ── g. a past-due customer with an open invoice counts once ──────────────────
test("g. one past-due subscription plus its open invoice: 1 failed payment, one row, one red line", async () => {
  const w = await H.healthyWorld(NOW, { roster: 2 });
  const data = H.stripeData(w.roster, NOW, { openInvoices: [
    openInvoice("in_TESTpd000001", w.roster[0].customer, { subscription: "sub_TEST000001", attempts: 2 }),
  ] });
  data.subscriptions[0].status = "past_due";
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  const t = tileOf(res, "failed");
  assert.deepEqual([t.state, t.value], ["red", 1]);
  assert.equal(lineOf(res, "failed_payments").text, "1 failed payment need attention.");
  assert.equal(res.body.detail.failed_payments.rows.length, 1);
  // matched by customer as well: the invoice carries no subscription id
  data.invoices_open[0].subscription = undefined;
  const res2 = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  assert.equal(tileOf(res2, "failed").value, 1);
  // an open invoice of ANOTHER customer is still its own failed payment
  data.invoices_open.push(openInvoice("in_TESTpd000002", w.roster[1].customer, { subscription: "sub_TEST000002", attempts: 1 }));
  const res3 = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  assert.equal(tileOf(res3, "failed").value, 2);
  assert.equal(tileOf(res3, "failed").sub, "1 subscription past due, 1 other open invoice retried");
});

// ── replaced account: an old invoice to void, amber, not ACT ─────────────────
async function replacedWorld(o = {}) {
  // Two roster rows: the active subscriber on the NEW Stripe customer, and
  // (optionally) the old row on the OLD customer, cancelled.
  const w = await H.healthyWorld(NOW, { roster: 2 });
  const person = w.roster[0];
  const oldCus = "cus_TESTold0001";
  if (o.oldRow) {
    w.roster.push({ ...person, customer: oldCus, active: false, cancelled: true, token: "0".repeat(32) });
    w.r2.set("subscribers.json", w.roster, { uploaded: NOW - DAY });
  }
  const data = H.stripeData(w.roster.slice(0, 2), NOW, { openInvoices: [
    openInvoice("in_TESTold00001", oldCus, { subscription: "sub_TESTold001", email: o.invoiceEmail === false ? undefined
      : (o.invoiceEmail || person.email.toUpperCase()), attempts: o.attempts ?? 4 }),
  ] });
  data.subscriptions.push({ ...H.subscription(77, oldCus, { now: NOW, status: o.oldStatus || "canceled" }), id: "sub_TESTold001" });
  return { w, data, person };
}

test("replaced account: an open invoice on a canceled subscription, same email as an active subscriber, is 'void it' (amber), not a failed payment", async () => {
  const { w, data, person } = await replacedWorld();
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  const t = tileOf(res, "failed");
  assert.deepEqual([t.state, t.value], ["amber", 0], "WATCH with no failed payment, never ACT");
  assert.equal(t.sub, "0 subscriptions past due, 0 open invoices retried; 1 old invoice on a replaced account");
  assert.equal(lineOf(res, "failed_payments"), undefined, "no red failed-payments line");
  const l = lineOf(res, "replaced_invoice");
  assert.deepEqual([l.severity, l.text, l.where], ["amber", "1 old invoice on a replaced account: void it.", "Stripe dashboard"]);
  assert.notEqual(res.body.headline.state, "red");
  const rows = res.body.detail.failed_payments.rows;
  assert.deepEqual(rows.map((r) => [r.status, r.stripe_url]),
    [["old invoice on a replaced account: void it", "https://dashboard.stripe.com/invoices/in_TESTold00001"]]);
  // the invoice's email is compared, never shown
  assert.equal(res.body.privacy_redactions, 0);
  assert.ok(!res.text.toLowerCase().includes(person.email.toLowerCase()));
  const page = V.sectionsView(res.body, null, "pending").find((s) => s.id === "money");
  assert.ok(page.lists[1].items[0].text.includes("old invoice on a replaced account: void it"));
});

test("replaced account: the email can come from the old customer's roster row when the invoice has none", async () => {
  const { w, data } = await replacedWorld({ invoiceEmail: false, oldRow: true });
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  assert.deepEqual([tileOf(res, "failed").state, tileOf(res, "failed").value], ["amber", 0]);
  assert.equal(lineOf(res, "replaced_invoice").severity, "amber");
});

test("replaced account controls: no active match, or a live subscription, is still a failed payment (ACT)", async () => {
  for (const o of [{ invoiceEmail: "someone.else@example.com" }, { oldStatus: "past_due" }, { invoiceEmail: false }]) {
    const { w, data } = await replacedWorld(o);
    const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
    assert.equal(tileOf(res, "failed").state, "red", JSON.stringify(o));
    assert.equal(lineOf(res, "replaced_invoice"), undefined, JSON.stringify(o));
    assert.ok(lineOf(res, "failed_payments"), JSON.stringify(o));
  }
});

// ── i. a clock that runs ahead gets its own sentence ─────────────────────────
test("i. a ran_at more than an hour ahead: its own words, never 'never reported'", async () => {
  const w = await H.healthyWorld(NOW);
  w.status.ran_at = new Date(NOW + 3 * HOUR).toISOString();
  w.save();
  const res = await get(w);
  const t = tileOf(res, "refresh");
  assert.deepEqual([t.state, t.sub], ["red", "the reported run time is ahead of this page's clock"]);
  const l = lineOf(res, "refresh");
  assert.equal(l.severity, "red");
  assert.equal(l.text, "The data refresh reported a run time more than an hour ahead of this page's clock, " +
    "so it is not counted as a run. Check the clock of the machine that runs the refresh.");
  assert.ok(!/never reported/.test(l.text + t.sub));
  // a missing ran_at still reads "never reported"
  delete w.status.ran_at;
  w.save();
  assert.match(lineOf(await get(w), "refresh").text, /never reported/);
});

// ── the "keep" answers, pinned ───────────────────────────────────────────────
test("b. keep: a save that would make the outreach object too large is refused as too_large, nothing written", async () => {
  const r2 = new H.FakeR2();
  const doc = { version: 1, updated_at: "2026-09-20T00:00:00Z", towns: { Adams: { outreach: "sent", since: "2026-09-20" } } };
  doc.history = [{ at: "2026-09-20T00:00:00Z", town: "Adams", from: null, to: "sent", pad: "" }];
  const base = JSON.stringify(doc).length;
  doc.history[0].pad = "x".repeat(64 * 1024 - base - 10);
  r2.set("admin/outreach.json", JSON.stringify(doc), { uploaded: NOW - DAY });
  r2.ops.length = 0;
  const headers = new Headers({ "Content-Type": "application/json", "X-MassPermits-Mission": "1",
    "Sec-Fetch-Site": "same-origin", "Cf-Access-Jwt-Assertion": owner() });
  const req = new Request("https://masspermits.com/admin/api/mission-outreach",
    { method: "POST", headers, body: JSON.stringify({ town: "Alford", outreach: "sent" }) });
  const res = await m.outreach.onRequestPost({ request: req, env: H.env(r2, { MISSION_OUTREACH_EDIT: "1" }), now: NOW });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "too_large" });
  assert.equal(r2.ops.filter((o) => o.op === "put" || o.op === "delete").length, 0);
});

test("c. keep: 'Not covered' is mid grey in dark mode (the same token in both dark blocks)", () => {
  const css = fs.readFileSync(path.join(H.REPO, "admin/mission-app.css"), "utf8");
  const vals = [...css.matchAll(/--m-none:\s*(#[0-9a-f]{6})/gi)].map((x) => x[1].toLowerCase());
  assert.equal(vals.length, 3, "light, dark (media), dark (data-theme)");
  assert.equal(vals[1], vals[2]);
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0) / 3;
  assert.ok(lum(vals[1]) > 64 && lum(vals[1]) < 192, "mid grey, not near black or white: " + vals[1]);
});

test("d. keep: an unreadable send log is grey 'unavailable' plus an amber could-not-read line", async () => {
  const w = await H.healthyWorld(MON("21:00:00"));
  w.r2.set("feed-send-log.json", "{not json");
  const res = await get(w);
  const t = tileOf(res, "monday");
  assert.deepEqual([t.state, t.grey], ["grey", "unavailable"]);
  const l = lineOf(res, "unreadable");
  assert.equal(l.severity, "amber");
  assert.ok(l.text.includes("Monday email"));
});

test("e. keep: a time more than 1 hour ahead does not count; within the hour it does", async () => {
  const w = await H.healthyWorld(NOW);
  w.status.ran_at = new Date(NOW + HOUR + 60_000).toISOString();
  w.save();
  assert.equal(tileOf(await get(w), "refresh").state, "red");
  w.status.ran_at = new Date(NOW + HOUR - 60_000).toISOString();
  w.save();
  assert.equal(tileOf(await get(w), "refresh").state, "green");
});

test("h. keep: the default view reads admin/outreach.json in full (a get, not a head), so a broken file warns", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.set("admin/outreach.json", "{broken", { uploaded: NOW - DAY });
  w.r2.ops.length = 0;
  const res = await get(w);
  assert.ok(w.r2.ops.some((o) => o.op === "get" && o.key === "admin/outreach.json"));
  assert.ok(!w.r2.ops.some((o) => o.op === "head" && o.key === "admin/outreach.json"));
  assert.equal(lineOf(res, "outreach_unreadable").severity, "amber");
});
