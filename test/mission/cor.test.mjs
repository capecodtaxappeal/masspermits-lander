// P4-COR: correctness review. Every expected value here comes from the rules
// in the build prompt, never from running the code. The independent oracle
// (in test/mission/_harness.mjs) also runs after EVERY route call any test file
// makes through the harness; this file adds the edges, 200 random map worlds,
// hand-worked money, crafted Monday rosters, the fixed words, and one
// regression test per defect this review fixed (COR-1 .. COR-n).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, stub, get } = await H.setup();
const V = m.view;
const { T, DAY, HOUR } = H;
const NOW = T("2026-09-30T18:00:00Z"); // a Wednesday
const MON = (hms) => T("2026-09-28T" + hms + "Z");
const GEO = JSON.parse(fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"), "utf8"));
const KEYS = Object.keys(GEO.towns);
const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const PRICES = H.PRICE_A + "," + H.PRICE_B;
const STRIPE_ENV = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: PRICES };
const tileOf = (res, id) => H.tileOf(res.body, id);
const stateOf = (t) => (t.state === "grey" ? "grey " + t.grey : t.state);
const withStripe = async (data, fn, o = {}) => {
  stub.stripe = H.stripeFake(data, o);
  try { return await fn(); } finally { stub.stripe = null; }
};

// ════════════════════════════════════════════════════════════════════════════
// Regression tests for the defects this review fixed. Each failed on 519ba044.
// ════════════════════════════════════════════════════════════════════════════

test("COR-1 signups: the by-day counts cover the whole 7-day window and add up to the tile", async () => {
  // A prospect 6 days 22 hours ago is inside "7 days" (now - 7 d = last
  // Wednesday 18:00Z), but on the UTC day of last Wednesday.
  const w = await H.healthyWorld(NOW);
  w.r2.set("prospects/lead.three@example.com", "", { customMetadata: { stage: "sent", ts: String(NOW - 6 * DAY - 22 * HOUR), trade: "roofing" } });
  const res = await get(w);
  const t = tileOf(res, "signups");
  const s = res.body.detail.signups;
  const sum = Object.values(s.by_day).reduce((a, b) => a + b, 0);
  assert.equal(t.value, 4, "rule: 3 recent fixture signups + this one");
  assert.equal(sum, t.value, "by_day must add up to the tile");
  assert.ok("2026-09-23" in s.by_day, "the first day of the window is listed");
  // a timestamp more than an hour ahead is not a signup (the FUTURE_SKEW rule)
  w.r2.set("prospects/lead.four@example.com", "", { customMetadata: { stage: "sent", ts: String(NOW + 5 * HOUR), trade: "hvac" } });
  const res2 = await get(w);
  assert.equal(tileOf(res2, "signups").value, 4);
  assert.equal(Object.values(res2.body.detail.signups.by_day).reduce((a, b) => a + b, 0), 4);
});

test("COR-2 revenue: an unreadable subscription list never shows a $0.00 run rate", async () => {
  const w = await H.healthyWorld(NOW);
  const res = await withStripe(H.stripeData(w.roster, NOW), () => get(w, { env: STRIPE_ENV }),
    { fail: (route) => (route === "/v1/subscriptions" ? { status: 500, body: { error: { message: "x" } } } : null) });
  const t = tileOf(res, "revenue");
  assert.equal(t.state, "green", "gross itself is readable");
  assert.equal(t.value, 4900 + 4900 + 2900, "rule: two MassPermits invoices + one pack in 30 days");
  assert.ok(!/\$0\.00/.test(t.sub), "a run rate from no data read as $0.00: " + t.sub);
  assert.match(t.sub, /run rate not available/);
  assert.ok(res.body.needs_you.some((l) => l.id === "unreadable" && /Paying customers|Renewals/.test(l.text)) ||
    ["paying", "renewals"].some((id) => tileOf(res, id).grey === "unavailable"));
});

test("COR-3 Monday detail: an unreadable send log shows no delivered or expected count (never 0)", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("get:feed-send-log.json");
  const res = await get(w);
  assert.deepEqual([tileOf(res, "monday").state, tileOf(res, "monday").grey], ["grey", "unavailable"]);
  const d = res.body.detail.monday;
  assert.equal(d.delivered, null);
  assert.equal(d.expected, null);
  assert.deepEqual([d.missing.length, d.failed.length], [0, 0]);
  const sec = V.sectionsView(res.body, null, "pending").find((s) => s.id === "monday");
  assert.ok(!sec.paras.some((p) => /Delivered to 0\b/.test(p)), sec.paras.join(" | "));
  assert.ok(sec.paras.some((p) => p.includes("not reported")));
});

test("COR-4 outreach: an unparseable admin/outreach.json raises outreach_unreadable in the default view", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.set("admin/outreach.json", "{not json", { uploaded: NOW - DAY });
  const res = await get(w);
  assert.equal(res.body.detail.setup.outreach, "unreadable");
  assert.ok(H.lineIds(res.body, "amber").includes("outreach_unreadable"));
  assert.ok(w.r2.ops.length <= 25, "budget: " + w.r2.ops.length);
  // and the object whose towns is not an object, and one over 64 KB
  for (const body of [JSON.stringify({ version: 1, towns: [] }), JSON.stringify({ version: 1, towns: {}, pad: "x".repeat(70_000) })]) {
    w.r2.set("admin/outreach.json", body, { uploaded: NOW - DAY });
    const r = await get(w);
    assert.ok(H.lineIds(r.body, "amber").includes("outreach_unreadable"), body.slice(0, 30));
  }
  // control: a good object is present, with no line
  w.r2.set("admin/outreach.json", { version: 1, towns: { Adams: { outreach: "sent" } } }, { uploaded: NOW - DAY });
  const ok = await get(w);
  assert.equal(ok.body.detail.setup.outreach, "present");
  assert.ok(!H.lineIds(ok.body).includes("outreach_unreadable"));
  assert.ok(!H.lineIds(ok.body).includes("outreach_absent"));
});

test("COR-5 an alias production key names the same town in the sources list, the lines and the map", async () => {
  const w = await H.healthyWorld(NOW);
  w.status.errors["Foxboro, MA"] = "HTTP 500 from the portal";
  w.status.sources["Foxboro, MA"] = 0;
  w.save();
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  const src = main.body.detail.refresh.sources.find((s) => /^Foxbor/.test(s.town));
  assert.equal(src.town, "Foxborough");
  assert.equal(map.body.towns.Foxborough.k, "dead");
  assert.equal(map.body.towns.Foxborough.ek, src.ek);
  assert.match(main.body.needs_you.find((l) => l.id === "sources_failing").text, /Foxborough/);
});

test("COR-6 page: a partial total reads \"at least N\" on the tile itself", async () => {
  const w = await H.healthyWorld(NOW);
  for (let i = 0; i < 4; i++) w.r2.set("agent-prospects/extra" + i + "@example.com", "", { customMetadata: { ts: String(NOW - HOUR), town: "Barnstable" } });
  w.r2.listLimit = 1; // every list still truncated after 3 pages
  const res = await get(w);
  const t = tileOf(res, "signups");
  assert.match(t.sub, /^at least; /);
  assert.match(V.tileView(t).value, /^at least \d+$/);
  assert.match(V.tileView(t).name, /: at least \d+, OK$/);
  // the newsletter totals come from the same capped lists: lower bounds too
  const sales = V.sectionsView(res.body, null, "pending").find((x) => x.id === "sales");
  assert.ok(sales.paras.some((p) => /\(at least \d+ confirmed, at least \d+ pending\)/.test(p)), sales.paras.join(" | "));
  // Stripe partial: paying, revenue, renewals
  const data = H.stripeData(w.roster, NOW);
  const res2 = await withStripe(data, () => get(w, { env: STRIPE_ENV }), { alwaysMore: (r) => r === "/v1/subscriptions" });
  for (const id of ["paying", "revenue", "renewals"]) {
    assert.match(V.tileView(tileOf(res2, id)).value, /^at least /, id);
  }
  // not partial: no prefix
  assert.doesNotMatch(V.tileView(tileOf(await get(await H.healthyWorld(NOW)), "signups")).value, /at least/);
});

test("COR-7 page: a refresh with no status file is never described as \"failed\"", async () => {
  for (const spoil of [(w) => w.r2.remove("refresh-status.json"), (w) => w.r2.fail.add("get:refresh-status.json")]) {
    const w = await H.healthyWorld(NOW);
    spoil(w);
    const res = await get(w);
    const sec = V.sectionsView(res.body, null, "pending").find((s) => s.id === "refresh");
    assert.ok(!sec.paras.some((p) => /failed/.test(p)), sec.paras[0]);
    assert.match(sec.paras[0], /No run is reported/);
  }
  // control: the crash shape still reads "crashed"
  const w = await H.healthyWorld(NOW);
  w.status = H.crashedStatus(NOW - 3 * HOUR);
  w.save();
  const sec = V.sectionsView((await get(w)).body, null, "pending").find((s) => s.id === "refresh");
  assert.match(sec.paras[0], /The refresh crashed\./);
});

test("COR-8 page: outreach counts come from the outreach facts, not from the map colour", async () => {
  const w = await H.healthyWorld(NOW, { outreach: { version: 1, towns: {
    Adams: { outreach: "answered" }, Alford: { outreach: "sent" }, Ashfield: { outreach: "planned" } } } });
  // Adams goes live: its colour is weekly now, but its outreach is still answered
  w.status.sources["Adams, MA"] = 12;
  w.save();
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  assert.equal(map.body.towns.Adams.k, "weekly");
  assert.equal(map.body.towns.Adams.o, "answered");
  const sec = V.sectionsView(main.body, map.body, "ok").find((s) => s.id === "outreach");
  assert.match(sec.paras[0], /^Answered or declined: 1\. Sent: 1\. /);
  assert.match(sec.paras[0], /Planned \(dashed outline\): 1\./);
});

test("COR-9 sales: the gross split says \"at least\" when a Stripe list it sums was cut short", async () => {
  const w = await H.healthyWorld(NOW);
  const res = await withStripe(H.stripeData(w.roster, NOW), () => get(w, { env: STRIPE_ENV }),
    { alwaysMore: (r, s) => r === "/v1/invoices" && s === "paid" });
  assert.match(tileOf(res, "sales").sub, /^at least; \$/);
  const res2 = await withStripe(H.stripeData(w.roster, NOW), () => get(w, { env: STRIPE_ENV }));
  assert.match(tileOf(res2, "sales").sub, /^\$/);
});

test("COR-10 Stripe: a subscription holding two MassPermits prices counts both in the run rate and the row amount", async () => {
  const w = await H.healthyWorld(NOW, { roster: 1 });
  const data = H.stripeData(w.roster, NOW);
  // roster[0] holds the monthly feed (4900) and the yearly radar (58800 / 12 = 4900)
  const s = data.subscriptions[0];
  s.items.data.push({ id: "si_TESTradar01", price: { id: H.PRICE_B, unit_amount: 4900, currency: "usd",
    recurring: { interval: "month", interval_count: 1 } }, quantity: 1, current_period_end: s.items.data[0].current_period_end });
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  assert.match(tileOf(res, "revenue").sub, /run rate \$98\.00\/mo$/);
  assert.equal(res.body.detail.customers.rows[0].amount_cents, 9800);
});

test("COR-11 Monday: an unreadable last-send-attempt.json never hides a red the send log proves", async () => {
  // Monday 20:30Z, the log is readable and holds nothing since due: red by the
  // log alone ("nothing delivered by hold"), whatever the attempt file says.
  const w = await H.healthyWorld(MON("20:30:00"), { mondayLog: false });
  w.r2.set("feed-send-log.json", [], { uploaded: MON("09:00:00") });
  w.r2.set("last-send-attempt.json", "{not json", { uploaded: MON("09:00:00") });
  const res = await get(w);
  assert.equal(stateOf(tileOf(res, "monday")), "red");
  assert.ok(H.lineIds(res.body, "red").includes("monday"));
  // a failure with no later success, on a Wednesday, attempt file unreadable: red
  const w2 = await H.healthyWorld(NOW, { mondayLog: false });
  w2.r2.set("feed-send-log.json", [H.logEntry(MON("15:40:00"), [{ to: w2.roster[0].email, ok: false }])], { uploaded: MON("15:40:00") });
  w2.r2.fail.add("get:last-send-attempt.json");
  assert.equal(stateOf(tileOf(await get(w2), "monday")), "red");
  // but before the hold with nothing logged, an unreadable attempt file is
  // unknowable (it could be the "started, no result" red): grey unavailable
  const w3 = await H.healthyWorld(MON("16:00:00"), { mondayLog: false });
  w3.r2.set("feed-send-log.json", [], { uploaded: MON("09:00:00") });
  w3.r2.fail.add("get:last-send-attempt.json");
  assert.equal(stateOf(tileOf(await get(w3), "monday")), "grey unavailable");
});

// ════════════════════════════════════════════════════════════════════════════
// (2) Timing edges. Expected results are worked from TIMING and MONDAY.
// ════════════════════════════════════════════════════════════════════════════
const WED = (hms) => T("2026-09-30T" + hms + "Z");
const TUE_1420 = T("2026-09-29T14:20:00Z");
async function refreshAt(now, ranAt, zipAt) {
  const w = await H.healthyWorld(now, { ranAt });
  if (zipAt !== undefined) w.r2.set("latest-weekly.zip", "PK-" + zipAt, { uploaded: zipAt });
  return stateOf(tileOf(await get(w), "refresh"));
}
export const edges = [];
const edge = (id, expected, got) => { edges.push({ id, expected, got }); assert.equal(got, expected, id); };

test("(2) refresh edges: due, due + 8 h - 1 ms, due + 8 h, 36 h and 36 h + 1 ms", async () => {
  edge("E1 now exactly at due (09:00:00.000Z), ran yesterday 14:20Z", "grey pending", await refreshAt(WED("09:00:00"), TUE_1420));
  edge("E2 due + 8 h - 1 ms (16:59:59.999Z)", "grey pending", await refreshAt(WED("16:59:59.999"), TUE_1420));
  edge("E3 due + 8 h exactly (17:00:00.000Z)", "red", await refreshAt(WED("17:00:00"), TUE_1420));
  edge("E4 ran exactly at due", "green", await refreshAt(WED("12:00:00"), WED("09:00:00")));
  edge("E5 ran 1 ms before due, bundles after due", "amber", await refreshAt(WED("12:00:00"), WED("08:59:59.999"), WED("09:00:00")));
  // 36 h: rule 2 is "older than 36 h". Exactly 36 h falls through to rule 5
  // (bundles uploaded after due -> amber); 1 ms more is red.
  const now = WED("02:20:00"), due = T("2026-09-29T09:00:00Z");
  edge("E6 ran_at exactly 36 h old, zip after due", "amber", await refreshAt(now, now - 36 * HOUR, due + HOUR));
  edge("E7 ran_at 36 h + 1 ms old, zip after due", "red", await refreshAt(now, now - 36 * HOUR - 1, due + HOUR));
  edge("E8 Sunday 23:59Z after Sunday's 14:20Z run", "green", await refreshAt(T("2026-09-27T23:59:00Z"), T("2026-09-27T14:20:00Z")));
  edge("E9 Monday 00:00Z after Sunday's 14:20Z run", "green", await refreshAt(T("2026-09-28T00:00:00Z"), T("2026-09-27T14:20:00Z")));
  edge("E10 Monday 08:59:59Z after Sunday's run", "green", await refreshAt(T("2026-09-28T08:59:59Z"), T("2026-09-27T14:20:00Z")));
  edge("E11 run 59 min ahead of the clock (skew)", "green", await refreshAt(WED("15:00:00"), WED("15:59:00")));
  edge("E12 run 61 min ahead of the clock", "red", await refreshAt(WED("15:00:00"), WED("16:01:00")));
});

async function mondayAt(now, log, o = {}) {
  const w = await H.healthyWorld(now, { mondayLog: false, roster: o.roster ?? 5 });
  const rows = o.rows ? o.rows(w) : w.roster;
  w.r2.set("subscribers.json", rows, { uploaded: now - DAY });
  w.r2.set("feed-send-log.json", log(w), { uploaded: now - HOUR });
  w.r2.set("last-send-attempt.json", { at: new Date(o.attemptAt ?? T("2026-09-21T15:39:00Z")).toISOString(), subscribers: 5, degraded: false });
  const res = await get(w);
  return { res, t: tileOf(res, "monday"), d: res.body.detail.monday };
}
const lastWeekAll = (w) => [H.logEntry(T("2026-09-21T15:40:00Z"), w.roster.map((r) => ({ to: r.email, ok: true })))];

test("(2) Monday edges: 11:59:59Z, 12:00Z, the hold hour, Sunday 23:59Z and Monday 00:00Z", async () => {
  let r = await mondayAt(MON("11:59:59"), lastWeekAll);
  edge("E13 Monday 11:59:59Z shows last Monday", "green 2026-09-21", r.t.state + " " + r.d.monday_date);
  r = await mondayAt(MON("12:00:00"), lastWeekAll);
  edge("E14 Monday 12:00:00Z, nothing yet", "grey pending 2026-09-28", stateOf(r.t) + " " + r.d.monday_date);
  r = await mondayAt(MON("19:59:59.999"), lastWeekAll);
  edge("E15 1 ms before the hold hour", "grey pending", stateOf(r.t));
  r = await mondayAt(MON("20:00:00"), lastWeekAll);
  edge("E16 exactly at the hold hour, nothing", "red", stateOf(r.t));
  r = await mondayAt(T("2026-09-27T23:59:00Z"), lastWeekAll);
  edge("E17 Sunday 23:59Z", "green 2026-09-21", r.t.state + " " + r.d.monday_date);
  r = await mondayAt(MON("00:00:00"), lastWeekAll);
  edge("E18 Monday 00:00Z", "green 2026-09-21", r.t.state + " " + r.d.monday_date);
  // a delivery logged exactly at due counts ("at or after due")
  r = await mondayAt(MON("12:00:30"), (w) => [H.logEntry(MON("12:00:00"), w.roster.map((x) => ({ to: x.email, ok: true })))]);
  edge("E19 delivery logged exactly at due", "green", r.t.state);
  // one logged 1 ms before due belongs to no Monday
  r = await mondayAt(MON("20:30:00"), (w) => [H.logEntry(MON("11:59:59.999"), w.roster.map((x) => ({ to: x.email, ok: true })))]);
  edge("E20 delivery 1 ms before due, now after hold", "red", r.t.state);
});

test("(2) the refresh line's Monday clause at 11:59Z, 12:00Z and after a delivery", async () => {
  const clause = "Monday's email will not send while this is the latest run.";
  const crashAt = async (now, log) => {
    const w = await H.healthyWorld(now, { mondayLog: false });
    w.status = H.crashedStatus(now - 30 * 60_000);
    w.statusUploaded = now - 30 * 60_000;
    w.save();
    if (log) w.r2.set("feed-send-log.json", log(w), { uploaded: now });
    return (await get(w)).body.needs_you.find((l) => l.id === "refresh").text;
  };
  edge("E21 Monday 11:59Z crash", true, (await crashAt(MON("11:59:00"))).includes(clause));
  edge("E22 Monday 12:00Z crash", true, (await crashAt(MON("12:00:00"))).includes(clause));
  edge("E23 Monday 17:00Z crash after a 15:40Z delivery", false, (await crashAt(MON("17:00:00"),
    (w) => [H.logEntry(MON("15:40:00"), w.roster.map((x) => ({ to: x.email, ok: true })))])).includes(clause));
  edge("E24 Tuesday 10:00Z crash", false, (await crashAt(T("2026-09-29T10:00:00Z"))).includes(clause));
});

test("(2) displayed times across the US clock changes (America/New_York)", () => {
  const cases = [
    ["2026-11-01T05:30:00Z", "Nov 1, 1:30 AM ET"], // EDT, UTC-4
    ["2026-11-01T06:30:00Z", "Nov 1, 1:30 AM ET"], // EST, UTC-5: the repeated hour
    ["2026-11-01T04:59:00Z", "Nov 1, 12:59 AM ET"],
    ["2027-03-14T06:59:00Z", "Mar 14, 1:59 AM ET"], // EST
    ["2027-03-14T07:00:00Z", "Mar 14, 3:00 AM ET"], // EDT: 2 AM does not exist
    ["2026-12-31T23:30:00Z", "Dec 31, 6:30 PM ET"],
    ["2027-01-01T04:59:00Z", "Dec 31, 11:59 PM ET"],
    ["2027-01-01T05:00:00Z", "Jan 1, 12:00 AM ET"],
  ];
  for (const [iso, want] of cases) edge("when " + iso, want, V.when(iso).replace(/ /g, " "));
  // calendar dates are shown as written, never shifted by a zone
  edge("day 2026-11-01", "Nov 1, 2026", V.day("2026-11-01"));
  edge("day 2027-03-14", "Mar 14, 2027", V.day("2027-03-14"));
  edge("day 2027-01-01", "Jan 1, 2027", V.day("2027-01-01"));
  edge("dateline 2026-11-01T03:00Z", "Saturday, October 31, 2026", V.dateline(T("2026-11-01T03:00:00Z")));
  edge("dateline 2027-03-14T12:00Z", "Sunday, March 14, 2027", V.dateline(T("2027-03-14T12:00:00Z")));
});

test("(2) 7, 14 and 30 day windows at month end and year end", async () => {
  const now = T("2027-01-03T18:00:00Z"); // a Sunday; Monday 2026-12-28 is the send day
  const w = await H.healthyWorld(now, { roster: 3, mondayLog: false });
  const nowS = Math.floor(now / 1000);
  // roster: one joined exactly on the Monday (2026-12-28) and not delivered
  w.roster[2].since = "2026-12-28";
  w.r2.set("subscribers.json", w.roster, { uploaded: now - DAY });
  w.r2.set("feed-send-log.json", [H.logEntry(T("2026-12-28T15:40:00Z"), w.roster.slice(0, 2).map((r) => ({ to: r.email, ok: true })))]);
  w.r2.set("last-send-attempt.json", { at: "2026-12-28T15:39:00Z", subscribers: 3, degraded: false });
  // signups: exactly now - 7 d counts; 1 s earlier does not
  w.r2.set("prospects/edge.in@example.com", "", { customMetadata: { ts: String(now - 7 * DAY), trade: "roofing" } });
  w.r2.set("prospects/edge.out@example.com", "", { customMetadata: { ts: String(now - 7 * DAY - 1000), trade: "roofing" } });
  // sales: a new checkout exactly 7 d ago counts, one 7 d + 1 s ago does not
  w.r2.set("delivery-log.json", [
    { at: new Date(now - 7 * DAY).toISOString(), to: w.roster[0].email, kind: "monthly", bundle: "latest-monthly.zip" },
    { at: new Date(now - 7 * DAY - 1000).toISOString(), to: w.roster[1].email, kind: "monthly", bundle: "latest-monthly.zip" },
  ]);
  const data = H.stripeData(w.roster, now);
  data.subscriptions[0].items.data[0].current_period_end = nowS + 14 * 86400;      // day 14 exactly: in
  data.subscriptions[1].items.data[0].current_period_end = nowS + 14 * 86400 + 1;  // 1 s later: out
  data.subscriptions[2].items.data[0].current_period_end = nowS;                   // now: in
  data.invoices_paid[0].created = nowS - 30 * 86400;      // day 30 exactly: in
  data.invoices_paid[1].created = nowS - 30 * 86400 - 1;  // 1 s earlier: out
  data.sessions[0].created = nowS - 7 * 86400;            // a pack exactly 7 d ago: in sales and revenue
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  edge("Y1 signups at year end (3 fixture + 1 edge)", 4, tileOf(res, "signups").value);
  edge("Y2 sales at year end", 1, tileOf(res, "sales").value);
  edge("Y3 renewals within 14 d at year end", 2, tileOf(res, "renewals").value);
  edge("Y4 revenue at year end (one 30-day invoice + the pack)", 4900 + 2900, tileOf(res, "revenue").value);
  edge("Y5 sales gross (the pack only; the invoice is 30 d old)", "$29.00 gross: $0.00 new subscriptions, $29.00 packs", tileOf(res, "sales").sub);
  edge("Y6 Monday across year end: roster since == Monday date", "green 2026-12-28 1 0", tileOf(res, "monday").state + " " +
    res.body.detail.monday.monday_date + " " + res.body.detail.monday.joined_on_send_day.length + " " + res.body.detail.monday.missing.length);
  edge("Y7 by_day covers 2026-12-27 .. 2027-01-03", "2026-12-27..2027-01-03", Object.keys(res.body.detail.signups.by_day)[0] + ".." +
    Object.keys(res.body.detail.signups.by_day).at(-1));
});

// ════════════════════════════════════════════════════════════════════════════
// (3) Map truth: 200 seeded random worlds; the oracle in the harness compares
// every town's code, facts and ek; here the invariants and the page.
// ════════════════════════════════════════════════════════════════════════════
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ERRS = ["HTTP 500 Internal Server Error", "Read timed out", "returned 0 rows", "JSON decode error at column 3",
  "HTTP 403 from https://example.invalid/x. That is an authorization decision", "the owner name 'X' reached a shipped row (rule 5)",
  "something odd", "", "login wall at the portal", "URLError: connection refused"];
const STATES = ["ok", "ok", "ok", "dead", "failing", "collapsed", "vanished", "stale", "new"];
const ALIASES = Object.keys(GEO.aliases);

function randomWorld(seed) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const r2 = new H.FakeR2();
  const now = NOW;
  const status = { ok: true, degraded: false, ran_at: new Date(now - 4 * HOUR).toISOString(), count: 0,
    coverage: { live_sources: 1, expected_sources: 1, attempted_sources: 1, lost_sources: 0, rows: 1, disclose: false },
    sources: {}, errors: {}, cadence: {}, newest: {} };
  const sh = {};
  const reg = [];
  const out = {};
  const n = 20 + Math.floor(R() * 60);
  for (let i = 0; i < n; i++) {
    const town = R() < 0.1 ? pick(ALIASES).replace(/^./, (c) => c.toUpperCase()) : R() < 0.04 ? "Nowhere" + i : pick(KEYS);
    const key = town + ", MA";
    const roll = R();
    if (roll < 0.7) status.sources[key] = R() < 0.25 ? 0 : Math.floor(R() * 200);
    if (R() < 0.15) status.errors[key] = pick(ERRS);
    if (R() < 0.15) status.cadence[key] = "monthly";
    if (R() < 0.5) status.newest[key] = "2026-09-" + String(1 + Math.floor(R() * 29)).padStart(2, "0");
    if (R() < 0.75) {
      const state = pick(STATES);
      sh[key] = H.shRecord(state, now - 4 * HOUR, { lastGood: now - Math.floor(R() * 40) * DAY,
        consecutiveLow: Math.floor(R() * 20), lastError: state === "ok" ? null : pick(ERRS),
        cadence: R() < 0.1 ? "monthly" : undefined });
    }
  }
  for (let i = 0; i < 40; i++) {
    reg.push({ name: R() < 0.1 ? pick(ALIASES) : pick(KEYS), county: "Test", method: pick(["html", "opengov", "api", "opengov"]),
      feasibility: pick(["live", "built_not_wired", "blocked", "unknown"]), already_live: R() < 0.5 });
  }
  for (let i = 0; i < 15; i++) {
    const name = R() < 0.1 ? "Atlantis" + i : R() < 0.1 ? pick(ALIASES) : pick(KEYS);
    out[name] = { outreach: pick(["planned", "sent", "answered", "declined", "bogus", undefined]),
      since: R() < 0.5 ? "2026-09-" + String(1 + Math.floor(R() * 28)).padStart(2, "0") : undefined,
      locked: pick([true, false, undefined, "yes"]) };
  }
  if (R() < 0.2) { status.sources = null; status.errors = null; status.cadence = null; status.newest = null; status.ok = false; status.error = "refresh crashed"; status.coverage = null; }
  r2.set("refresh-status.json", status, { uploaded: now - 4 * HOUR });
  if (R() < 0.9) r2.set("source-health.json", H.sourceHealth(sh, now - 4 * HOUR), { uploaded: now - 4 * HOUR });
  r2.set("probe-map.json", { generated_at: new Date(now).toISOString(), registry: { available: true, generated: new Date(now).toISOString(), towns: reg } },
    { uploaded: now - 3 * DAY });
  if (R() < 0.85) r2.set("admin/outreach.json", { version: 1, updated_at: new Date(now).toISOString(), towns: out }, { uploaded: now - DAY });
  return { r2, now };
}

test("(3) 200 seeded random map worlds: the oracle agrees on every town; counts sum to 351; nothing dropped", async () => {
  const before = H.oracleRuns.map;
  for (let seed = 1; seed <= 200; seed++) {
    const w = randomWorld(seed);
    const res = await get(w, { query: "?view=map" }); // the harness hook compares with the oracle
    assert.equal(res.status, 200, "seed " + seed);
    const b = res.body;
    assert.equal(Object.values(b.counts).reduce((a, x) => a + x, 0), 351, "seed " + seed);
    // every production key is a town or in unmatched
    const st = w.r2.json("refresh-status.json");
    const sh = w.r2.objects.has("source-health.json") ? w.r2.json("source-health.json").sources : {};
    for (const k of [...Object.keys(st.sources || {}), ...Object.keys(st.errors || {}), ...Object.keys(sh)]) {
      const t = m.data.joinTown(k);
      if (t) assert.ok(b.towns[t], "seed " + seed + " " + k + " has facts");
      else assert.ok(b.unmatched.includes(k.replace(/, MA$/, "")), "seed " + seed + " " + k + " unmatched");
    }
    // planned only outlines: never a colour of its own
    for (const [t, f] of Object.entries(b.towns)) if (f.planned) assert.ok(["dead", "weekly", "monthly", "locked", "none"].includes(f.k), t);
    // the page: legend counts, list view and sheets show exactly the payload
    const legend = V.legendView(b);
    for (const l of legend) assert.equal(l.count, b.counts[l.code]);
    const groups = V.listGroups(b, KEYS);
    for (const g of groups) assert.equal(g.towns.length, b.counts[g.code], "seed " + seed + " list " + g.code);
    for (const [t, f] of Object.entries(b.towns)) {
      const s = V.townSheet(t, f);
      assert.equal(s.code, f.k);
      if (f.ek) assert.ok(s.lines.includes(V.ekSentence(f.ek)));
      if (typeof f.rows === "number") assert.ok(s.lines.includes("Rows in the latest run: " + f.rows.toLocaleString("en-US") + "."));
      if (f.state) assert.ok(s.lines.includes("Source state: " + f.state + "."));
    }
  }
  assert.equal(H.oracleRuns.map - before, 200, "the oracle ran on every world");
});

test("(3) already_live never colours; every alias resolves; the map and the sources list agree per town", async () => {
  for (const [alias, key] of Object.entries(GEO.aliases)) assert.equal(m.data.joinTown(alias + ", MA"), key, alias);
  const w = await H.healthyWorld(NOW);
  const reg = w.r2.json("probe-map.json");
  const [liveOnly] = await H.sourceTowns(1, 100);
  reg.registry.towns.push({ name: liveOnly, method: "html", feasibility: "live", already_live: true });
  w.r2.set("probe-map.json", reg, { uploaded: NOW - DAY });
  const [a, b, c] = await H.sourceTowns(3, 101);
  w.status.errors[a + ", MA"] = "HTTP 403 forbidden";
  w.shSources[b + ", MA"] = H.shRecord("collapsed", w.ranAt, { consecutiveLow: 12, lastError: "returned 2 rows" });
  w.shSources[c + ", MA"] = H.shRecord("stale", w.ranAt, { lastError: "Read timed out" });
  w.save();
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  assert.equal(map.body.towns[liveOnly], undefined, "already_live alone is Not covered");
  for (const s of main.body.detail.refresh.sources) {
    const f = map.body.towns[s.town];
    assert.ok(f, s.town);
    assert.equal(f.k, "dead", s.town);
    assert.equal(f.ek, s.ek, s.town);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (4) Money and Stripe, worked by hand.
// ════════════════════════════════════════════════════════════════════════════
test("(4) money worked by hand: gross, run rate, renewals, trials, failed, both line shapes", async () => {
  const w = await H.healthyWorld(NOW, { roster: 6 });
  const nowS = Math.floor(NOW / 1000);
  const c = (i) => w.roster[i].customer;
  const S = (i, o) => H.subscription(i, c(i - 1), { now: NOW, ...o });
  const subs = [
    S(1, { periodEnd: nowS + 5 * 86400, cancel: true }),                          // A 49/mo, renews in 5 d, cancels
    S(2, { price: H.PRICE_B, amount: 58800, interval: "year" }),                    // B 588/yr = 49/mo
    S(3, { status: "trialing" }),                                                   // C trial: not in the run rate
    S(4, { status: "past_due", periodEnd: nowS + 2 * 86400 }),                      // D past due, renews in 2 d
    S(5, { status: "canceled" }),                                                   // E not entitled
    S(6, { extraPrice: H.PRICE_OTHER }),                                            // F also holds another product
    H.subscription(900, "cus_TESTother01", { now: NOW, price: H.PRICE_OTHER, amount: 99900 }), // G not ours
  ];
  const data = H.stripeData(w.roster, NOW, { openInvoices: [
    { id: "in_TESTopen0004", customer: c(3), status: "open", amount_due: 4900, amount_paid: 0, currency: "usd",
      created: nowS - 86400, attempt_count: 2, billing_reason: "subscription_cycle", lines: { data: [{ price: { id: H.PRICE_A } }] } },
    { id: "in_TESTopen0099", customer: c(0), status: "open", amount_due: 4900, amount_paid: 0, currency: "usd",
      created: nowS - 86400, attempt_count: 0, billing_reason: "subscription_cycle", lines: { data: [{ price: { id: H.PRICE_A } }] } },
  ] });
  data.subscriptions = subs;
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  // entitled = A B C D F (5); trials 1
  assert.equal(tileOf(res, "paying").value, 5);
  assert.equal(tileOf(res, "paying").sub, "1 trial included");
  // gross = 4900 (in_TESTpaid0001, price.id shape) + 4900 (in_TESTpaid0002, pricing shape) + 2900 (pack)
  assert.equal(tileOf(res, "revenue").value, 12700);
  // run rate = A 4900 + B 58800/12 + D 4900 + F 4900 = 19600 (C is a trial)
  assert.equal(tileOf(res, "revenue").sub, "list-price run rate $196.00/mo");
  assert.equal(V.tileView(tileOf(res, "revenue")).value, "$127.00");
  // renewals: A (5 d) and D (2 d); A cancels
  assert.deepEqual([tileOf(res, "renewals").state, tileOf(res, "renewals").value, tileOf(res, "renewals").sub], ["amber", 2, "1 set to cancel"]);
  // failed: D past_due + D's own open invoice (attempt 2) = 2; the attempt-0 invoice is not counted
  assert.deepEqual([tileOf(res, "failed").state, tileOf(res, "failed").value], ["red", 2]);
  assert.equal(tileOf(res, "failed").sub, "1 subscription past due, 1 open invoice retried");
  // unknown_price: F's customer
  assert.ok(res.body.needs_you.some((l) => l.id === "unknown_price" && l.text.startsWith("1 customer")));
  // sales: 7 days: in_TESTpaid0001 is subscription_create 3 d ago (4900), the pack 1 d ago (2900)
  assert.equal(tileOf(res, "sales").sub, "$78.00 gross: $49.00 new subscriptions, $29.00 packs");
  // page money formatting: cents to dollars, two decimals, thousands separators
  assert.equal(V.money(1234567), "$12,345.67");
  assert.equal(V.money(0), "$0.00");
  assert.equal(V.money(-4900), "-$49.00");
});

test("(4) the failed tile counts a past_due subscription AND its own open invoice (rule as written; owner question)", async () => {
  const w = await H.healthyWorld(NOW, { roster: 1 });
  const nowS = Math.floor(NOW / 1000);
  const data = H.stripeData(w.roster, NOW, { openInvoices: [{ id: "in_TESTopen0001", customer: w.roster[0].customer,
    status: "open", amount_due: 4900, currency: "usd", created: nowS - 86400, attempt_count: 1,
    subscription: "sub_TEST000001", lines: { data: [{ price: { id: H.PRICE_A } }] } }] });
  data.subscriptions[0].status = "past_due";
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  assert.equal(tileOf(res, "failed").value, 2, "one customer, counted twice: see the owner question");
});

test("(4) \"at least\" totals: 3 pages of 100, still has_more", async () => {
  const w = await H.healthyWorld(NOW, { roster: 1 });
  const data = H.stripeData(w.roster, NOW);
  for (let i = 2; i <= 320; i++) data.subscriptions.push(H.subscription(i, "cus_TESTbulk" + String(i).padStart(4, "0"), { now: NOW }));
  const res = await withStripe(data, () => get(w, { env: STRIPE_ENV }));
  // 300 read (1 roster sub + the other-product sub + 298 bulk), 299 ours, entitled
  const t = tileOf(res, "paying");
  assert.equal(t.value, 299);
  assert.equal(t.sub, "at least 299; 0 trials included");
  assert.equal(V.tileView(t).value, "at least 299");
  assert.ok(H.lineIds(res.body, "known").includes("stripe_partial"));
});

// ════════════════════════════════════════════════════════════════════════════
// (5) Monday reach on crafted rosters.
// ════════════════════════════════════════════════════════════════════════════
test("(5) Monday on crafted rosters", async () => {
  const at = MON("15:40:00");
  const now = MON("21:00:00");
  const base = (w) => w.roster.map((r) => ({ ...r }));
  // case and whitespace in the roster and the log are one address
  let r = await mondayAt(now, (w) => [H.logEntry(at, w.roster.map((x) => ({ to: "  " + x.email.toUpperCase() + " ", ok: true })))],
    { rows: (w) => base(w).map((x) => ({ ...x, email: " " + x.email.replace("customer", "Customer") })) });
  edge("R1 case and whitespace", "green 5 5 0", r.t.state + " " + r.d.delivered + " " + r.d.expected + " " + r.d.missing.length);
  // active:false is not expected; a cancelled row that is still active is (the sender mails it: weekly-send.js filter)
  r = await mondayAt(now, (w) => [H.logEntry(at, w.roster.slice(0, 4).map((x) => ({ to: x.email, ok: true })))],
    { rows: (w) => base(w).map((x, i) => (i === 4 ? { ...x, active: false, cancelled: true } : x)) });
  edge("R2 active:false not expected", "green 4 4", r.t.state + " " + r.d.delivered + " " + r.d.expected);
  r = await mondayAt(now, (w) => [H.logEntry(at, w.roster.slice(0, 4).map((x) => ({ to: x.email, ok: true })))],
    { rows: (w) => base(w).map((x, i) => (i === 4 ? { ...x, cancelled: true } : x)) });
  edge("R3 cancelled but active: still expected, missing", "red 1", r.t.state + " " + r.d.missing.length);
  // a re-subscriber keeping an old since is expected like anyone
  r = await mondayAt(now, (w) => [H.logEntry(at, w.roster.map((x) => ({ to: x.email, ok: true })))],
    { rows: (w) => base(w).map((x, i) => (i === 0 ? { ...x, since: "2024-01-15" } : x)) });
  edge("R4 re-subscriber with an old since", "green 5", r.t.state + " " + r.d.expected);
  // since == Monday: joined on send day, not missing, not red; since > Monday: new since Monday
  r = await mondayAt(now, (w) => [H.logEntry(at, w.roster.slice(0, 3).map((x) => ({ to: x.email, ok: true })))],
    { rows: (w) => base(w).map((x, i) => (i === 3 ? { ...x, since: "2026-09-28" } : i === 4 ? { ...x, since: "2026-09-29" } : x)) });
  edge("R5 since == Monday and since > Monday", "green 3 1 1 0", r.t.state + " " + r.d.expected + " " +
    r.d.joined_on_send_day.length + " " + r.d.new_since_monday + " " + r.d.missing.length);
  // one address twice in one log entry: a duplicate (amber), not two people
  r = await mondayAt(now, (w) => [H.logEntry(at, [...w.roster.map((x) => ({ to: x.email, ok: true })), { to: w.roster[0].email, ok: true }])]);
  edge("R6 one address twice in one entry", "amber 5 1", r.t.state + " " + r.d.delivered + " " + r.d.duplicates);
  // ok:false then ok:true for the same address in one entry: delivered, not failed
  r = await mondayAt(now, (w) => [H.logEntry(at, [{ to: w.roster[0].email, ok: false }, ...w.roster.map((x) => ({ to: x.email, ok: true }))])]);
  edge("R7 a failure retried in the same entry", "green 0", r.t.state + " " + r.d.failed.length);
  // a log entry with no sent array
  r = await mondayAt(now, () => [{ at: new Date(at).toISOString(), subscribers: 5, skipped: true, bundle_etag: H.md5("x") }]);
  edge("R8 skipped entry with no sent array", "red", r.t.state);
  r = await mondayAt(MON("16:00:00"), () => [{ at: new Date(at).toISOString(), subscribers: 5, bundle_etag: H.md5("y") }]);
  edge("R9 entry with no sent array, before hold", "grey pending", stateOf(r.t));
  // a failure, then a later success in another entry: not failed
  r = await mondayAt(now, (w) => [H.logEntry(at + HOUR, w.roster.map((x) => ({ to: x.email, ok: true }))),
    H.logEntry(at, [{ to: w.roster[1].email, ok: false }])]);
  edge("R10 failure then a later success", "green 0", r.t.state + " " + r.d.failed.length);
  // a success, then a later failure for the same address: failed (no later ok)
  r = await mondayAt(now, (w) => [H.logEntry(at + HOUR, [{ to: w.roster[1].email, ok: false }]),
    H.logEntry(at, w.roster.map((x) => ({ to: x.email, ok: true })))]);
  edge("R11 success then a later failure", "red 1", r.t.state + " " + r.d.failed.length);
});

// ════════════════════════════════════════════════════════════════════════════
// (6) Words: every fixed sentence in the prompt is in the shipped code, byte
// for byte; state words match states; counts in sentences match the tiles.
// ════════════════════════════════════════════════════════════════════════════
const PAGE_WORDS = [
  "Nothing is wrong that this page can see.",
  "Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself.",
  "The engine's privacy guard stopped this town's rows (a parser fix is needed; nothing was published)",
  "Returned no rows", "The town's site timed out", "The town's site returned an error",
  "The town's page changed shape (parser)", "Failed (the reason is not shown on this page)",
  "crashed", "stopped by its quality gate",
  "Stale or dead source", "Live, weekly", "Live, monthly or slower", "Outreach answered", "Outreach sent",
  "Locked behind OpenGov", "Not covered",
  "OK", "WATCH", "ACT", "NOT CONNECTED", "UNAVAILABLE", "UNVERIFIED", "NOT YET",
  "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024",
  "Not signed in as the owner. Reload to sign in again.",
  "Could not read the data. Reload; if it stays, check /admin/pipeline.",
  "The map could not load. Reload.", "No customers yet.", "Not updated. Showing data from ", "Loading",
  "Known, not new (", "Demo: nothing is saved",
];
const RENDER_WORDS = ["Show as list", "Signed in as "];
const DATA_WORDS = ["Resend accepted it; there is no bounce or open tracking.", "webhook flags only; registration not verified",
  "roster: feed and radar mixed, trials included", "recent sends 15:20-18:46 UTC", "usually 13:00-16:00 UTC",
  " Monday's email will not send while this is the latest run.", "Could not read: ", ". Reload; if it stays, check /admin/pipeline.",
  " paid, maybe not served: check Stripe.", " down in the last ", ". See the map.", "Nothing is wrong that this page can see."];
const PAGE_ORDER_TITLES = ["Customers", "Renewals and failed payments", "Monday delivery", "Data refresh", "Sales and signups",
  "Outreach", "What this page cannot see", "Setup"];

test("(6) every fixed sentence and legend text is in the shipped code byte for byte", () => {
  const view = read("admin/mission-view.js"), render = read("admin/mission-render.js"), data = read("functions/api/_mission_data.js");
  const html = read("admin/mission.html");
  for (const s of PAGE_WORDS) assert.ok(view.includes(JSON.stringify(s).slice(1, -1)) || view.includes(s), "mission-view.js: " + s);
  for (const s of RENDER_WORDS) assert.ok(render.includes(s) || view.includes(s), "page: " + s);
  for (const s of DATA_WORDS) assert.ok(data.includes(s), "_mission_data.js: " + s);
  assert.ok(html.includes("Setup needed"));
  for (const t of PAGE_ORDER_TITLES) assert.ok(view.includes('title: "' + t + '"'), t);
});

test("(6) composed sentences come out exactly as the prompt writes them", async () => {
  const q = await get(await H.quietWorld(NOW));
  const t = (id) => tileOf(q, id);
  assert.equal(q.body.headline.text, "Nothing is wrong that this page can see.");
  assert.equal(t("failed").sub, "webhook flags only; registration not verified");
  assert.equal(t("paying").sub, "roster: feed and radar mixed, trials included");
  assert.equal(q.body.detail.monday.caveat, "Resend accepted it; there is no bounce or open tracking.");
  const blocked = q.body.needs_you.find((l) => l.id === "sources_blocked").text;
  assert.ok(blocked.endsWith("Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself."));
  const pend = await get(await H.healthyWorld(MON("16:00:00"), { mondayLog: false }));
  assert.equal(tileOf(pend, "monday").sub, "not sent yet; recent sends 15:20-18:46 UTC");
  const w = await H.healthyWorld(WED("13:30:00"), { ranAt: TUE_1420 });
  assert.equal(tileOf(await get(w), "refresh").sub, "not landed yet, usually 13:00-16:00 UTC");
});

test("(6) no state word disagrees with its state; counts in sentences equal the tile they describe", async () => {
  const worlds = [await H.quietWorld(NOW), await H.healthyWorld(NOW)];
  const bad = await H.healthyWorld(MON("20:30:00"), { mondayLog: false, roster: 4 });
  bad.r2.set("feed-send-log.json", [H.logEntry(MON("15:40:00"), [{ to: bad.roster[0].email, ok: true }, { to: bad.roster[1].email, ok: false }])]);
  bad.roster[2].payment_failing = true;
  bad.r2.set("subscribers.json", bad.roster, { uploaded: NOW - DAY });
  worlds.push(bad);
  const WORDS = { green: "OK", amber: "WATCH", red: "ACT" };
  const GREYW = { "not-connected": "NOT CONNECTED", unavailable: "UNAVAILABLE", unverified: "UNVERIFIED", pending: "NOT YET" };
  for (const w of worlds) {
    const res = await get(w);
    for (const t of res.body.tiles) {
      const v = V.tileView(t);
      assert.equal(v.word, t.state === "grey" ? GREYW[t.grey] : WORDS[t.state], t.id);
      assert.ok(v.name.endsWith(", " + v.word));
      if (t.value !== null && t.id !== "revenue") assert.ok(v.value.endsWith(t.value.toLocaleString("en-US")), t.id + " " + v.value);
    }
    const sec = V.sectionsView(res.body, null, "pending");
    const mon = sec.find((s) => s.id === "monday");
    const mt = tileOf(res, "monday");
    assert.ok(mon.paras[0].includes(": " + V.tileView(mt).word + "."), mon.paras[0]);
    if (mt.value !== null) assert.ok(mon.paras[1].startsWith("Delivered to " + mt.value + " of "), mon.paras[1]);
    const fl = res.body.needs_you.find((l) => l.id === "failed_payments");
    if (fl) assert.ok(fl.text.startsWith(tileOf(res, "failed").value + " failed payment"));
    const ml = res.body.needs_you.find((l) => l.id === "monday");
    if (ml && /failed for/.test(ml.text)) assert.ok(ml.text.includes(res.body.detail.monday.failed.length + " subscriber"));
    const cust = sec.find((s) => s.id === "customers");
    if (res.body.detail.customers.count) assert.ok(cust.paras[0].startsWith(res.body.detail.customers.count + " active customer"));
  }
});

test("oracle self-check: a tampered body is caught (the oracle is not vacuous)", async () => {
  const w = await H.quietWorld(NOW);
  const res = await get(w);
  const E = H.oracleMain({ r2: w.r2, env: H.env(w.r2), now: NOW, handler: null, towns: H.setTowns(KEYS, GEO.aliases),
    normalisePolicy: m.presend.normalisePolicy });
  assert.deepEqual(H.checkMain(E, res.body), []);
  for (const [label, mutate] of [
    ["tile value", (b) => { b.tiles[0].value += 1; }],
    ["tile state", (b) => { b.tiles[3].state = "green"; delete b.tiles[3].grey; }],
    ["line severity", (b) => { b.needs_you[0].severity = "amber"; }],
    ["named town", (b) => { const l = b.needs_you.find((x) => x.id === "sources_vanished"); l.text = l.text.replace(/: [A-Z][a-z]+/, ": Nowhere"); }],
    ["detail count", (b) => { b.detail.customers.count = 19; }],
  ]) {
    const b = structuredClone(res.body);
    mutate(b);
    assert.ok(H.checkMain(E, b).length > 0, label);
  }
  const map = await get(w, { query: "?view=map" });
  const EM = H.oracleMap({ r2: w.r2, now: NOW, towns: H.setTowns(KEYS, GEO.aliases) });
  assert.deepEqual(H.checkMap(EM, map), []);
  const b = structuredClone(map.body);
  const k = Object.keys(b.towns)[0];
  b.towns[k].k = b.towns[k].k === "dead" ? "weekly" : "dead";
  assert.ok(H.checkMap(EM, { status: 200, body: b }).length > 0);
});
