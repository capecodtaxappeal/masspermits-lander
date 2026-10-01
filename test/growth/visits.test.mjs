// Road to 100: visits from hits/ (counted the way /api/traffic counts),
// Buy clicks from clicks/, where each data set starts, the R2 budget, free
// sign ups from the funnel snapshots, and the conversion rates.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
const NOW = H.T("2026-09-27T18:00:00Z");

async function get(r2, env = H.stripeEnv(), data = { sessions: [], subscriptions: [] }) {
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer(data);
  r2.ops.length = 0;
  const res = await call({ env: envOf(r2, env), now: NOW });
  assert.equal(res.status, 200);
  return res;
}

test("visits per day match /api/traffic's count for the same days", async () => {
  const r2 = new H.GrowthR2();
  r2.hit(H.T("2026-07-05T15:00:00Z"));
  // this week: 4 on Tuesday, 2 on Thursday, and the six days traffic.js also sees
  for (let i = 0; i < 4; i++) r2.hit(H.T("2026-09-22T15:00:00Z") + i);
  for (let i = 0; i < 2; i++) r2.hit(H.T("2026-09-24T15:00:00Z") + i);
  const res = await get(r2);
  assert.equal(res.body.weeks[12].visits, 6);
  // the same objects through traffic.js (which reads the real clock): list the same prefixes
  let total = 0;
  for (const day of ["2026-09-22", "2026-09-24"]) total += (await r2.list({ prefix: "hits/" + day + "/" })).objects.length;
  assert.equal(total, 6);
});

test("visits start at the first beacon day; earlier weeks say so instead of zero", async () => {
  const r2 = new H.GrowthR2();
  r2.hit(H.T("2026-07-05T15:00:00Z")); // Sunday of the first week: the beacon's first day
  r2.hit(H.T("2026-08-12T15:00:00Z"));
  const res = await get(r2);
  const w = res.body.weeks;
  assert.equal(res.body.sources.visits.data_starts, "2026-07-05");
  assert.equal(w[0].visits, 1);
  assert.ok(w[0].at_least.includes("visits"), "data starts partway through the first week");
  assert.equal(w[1].visits, 0, "a real zero after the start is a zero");
  const late = new H.GrowthR2();
  late.hit(H.T("2026-08-12T15:00:00Z"));
  const res2 = await get(late);
  assert.equal(res2.body.weeks[0].visits, "no data yet");
  assert.equal(res2.body.sources.visits.data_starts, "2026-08-12");
  const none = await get(new H.GrowthR2());
  for (const x of none.body.weeks) assert.equal(x.visits, "no data yet");
});

test("old /offer/click page views are left out of visits and reported as a count", async () => {
  const r2 = new H.GrowthR2();
  r2.hit(H.T("2026-09-22T15:00:00Z"));
  r2.hit(H.T("2026-09-22T15:00:01Z"), { p: "/offer" });
  r2.hit(H.T("2026-09-22T15:00:02Z"), { p: "/offer/click" });
  const res = await get(r2);
  assert.equal(res.body.weeks[12].visits, 2);
  assert.equal(res.body.sources.visits.old_offer_clicks_left_out, 1);
});

test("Buy clicks: Weekly Feed link apart from other buy links; weeks before the first click are not tracked yet", async () => {
  const r2 = new H.GrowthR2();
  r2.click(H.T("2026-09-15T15:00:00Z"));
  r2.click(H.T("2026-09-22T15:00:00Z"));
  r2.click(H.T("2026-09-22T16:00:00Z"));
  r2.click(H.T("2026-09-23T16:00:00Z"), "5kQ7sK7aQ1u7dxQ0p94gg00");   // Lead Pack
  r2.click(H.T("2026-09-23T17:00:00Z"), "", { e: "something_else" });  // never written by hit.js; ignored
  const res = await get(r2);
  const w = res.body.weeks;
  assert.equal(w[12].buy_clicks, 2);
  assert.equal(w[12].other_buy_clicks, 1);
  assert.equal(w[11].buy_clicks, 1);
  assert.equal(w[10].buy_clicks, "not tracked yet");
  assert.equal(res.body.sources.clicks.data_starts, "2026-09-15");
});

test("R2 budget: one walk per prefix from the first week, every page capped; a cut-short walk says \"at least\"", async () => {
  const r2 = new H.GrowthR2();
  r2.hit(H.T("2026-01-01T12:00:00Z")); // long before the window: never listed by the walk
  for (let d = 0; d < 91; d++) for (let k = 0; k < 25; k++) r2.hit(NOW - d * H.DAY - k * 60000);
  const res = await get(r2);
  const lists = r2.ops.filter((o) => o.op === "list");
  assert.ok(lists.length <= 8, "lists " + lists.length);
  assert.equal(r2.ops.filter((o) => o.op === "get").length, 1, "only funnel-metrics.json is read");
  assert.ok(!r2.ops.some((o) => o.op === "get" && o.key !== "funnel-metrics.json"));
  const sum = res.body.weeks.reduce((a, w) => a + (typeof w.visits === "number" ? w.visits : 0), 0);
  assert.ok(sum >= 25 * 90 && sum <= 25 * 91, "sum " + sum);
  // the cap: with one object per list page, the walk stops after its cap
  r2.listLimit = 1;
  const cut = await get(r2);
  const hitLists = r2.ops.filter((o) => o.op === "list" && o.key === "hits/").length;
  assert.ok(hitLists <= 31, "hits lists " + hitLists);
  assert.equal(cut.body.sources.visits.state, "partial");
  assert.ok(cut.body.weeks[12].at_least.includes("visits"));
  assert.ok(r2.ops.length <= 45, "total ops " + r2.ops.length);
});

test("free sign ups: the change between week-end snapshots; no snapshot, no number", async () => {
  const r2 = new H.GrowthR2();
  const snap = (at, total, confirmed, samples) => ({ at: new Date(at).toISOString(),
    newsletter: { total, confirmed, pending: 0, by_town: { Plymouth: 3 } }, prospects: { total: samples, by_trade: { Roofing: 2 } },
    paying: 5 });
  const grid = g.data.weekGrid(NOW);
  r2.set("funnel-metrics.json", [
    snap(NOW - H.HOUR, 20, 15, 9),                        // this week so far
    snap(grid.weeks[11].end - H.HOUR, 18, 14, 8),         // end of last week
    snap(grid.weeks[11].start + H.HOUR, 17, 13, 8),       // earlier in last week: not the week end
    snap(grid.weeks[10].end - 2 * H.HOUR, 15, 12, 7),     // end of the week before
  ]);
  const res = await get(r2);
  const w = res.body.weeks;
  assert.equal(w[12].free_signups, (20 + 9) - (18 + 8));
  assert.equal(w[11].free_signups, (18 + 8) - (15 + 7));
  assert.equal(w[10].free_signups, "no data yet", "no snapshot in the week before it");
  assert.equal(w[12].free_readers, 15);
  const absent = await get(new H.GrowthR2());
  assert.equal(absent.body.sources.free.state, "absent");
  for (const x of absent.body.weeks) assert.equal(x.free_signups, "no data yet");
  const bad = new H.GrowthR2();
  bad.set("funnel-metrics.json", "{not json");
  const unreadable = await get(bad);
  assert.equal(unreadable.body.sources.free.state, "unreadable");
  for (const x of unreadable.body.weeks) assert.equal(x.free_signups, "unavailable");
});

test("conversion rates: x of y always, a percentage only from 20, and only over weeks where both sides are known", async () => {
  const r2 = new H.GrowthR2();
  r2.hit(H.T("2026-07-05T12:00:00Z"));
  for (let i = 0; i < 40; i++) r2.hit(H.T("2026-09-22T12:00:00Z") + i);
  for (let i = 0; i < 30; i++) r2.hit(H.T("2026-09-15T12:00:00Z") + i);
  r2.click(H.T("2026-09-22T13:00:00Z"));
  r2.click(H.T("2026-09-22T13:00:01Z"));
  const res = await get(r2, H.stripeEnv(), {
    sessions: [H.session(H.T("2026-09-22T13:01:00Z"), "complete"), H.session(H.T("2026-09-22T13:02:00Z"), "expired"),
      H.session(H.T("2026-09-16T13:02:00Z"), "expired")],
    subscriptions: [],
  });
  const f = res.body.funnel;
  assert.deepEqual(f.this_week.rates.visit_to_click, { n: 2, d: 40, pct: 5, weeks: 1 });
  assert.deepEqual(f.this_week.rates.checkout_to_paid, { n: 1, d: 2, pct: null, weeks: 1 });
  assert.deepEqual(f.this_week.rates.checkout_abandoned, { n: 1, d: 2, pct: null, weeks: 1 });
  // over all weeks, clicks are known only this week: the 30 visits of last week are not divided against
  assert.deepEqual(f.all_weeks.rates.visit_to_click, { n: 2, d: 40, pct: 5, weeks: 1 });
  assert.equal(f.all_weeks.totals.visits, 71);
  assert.equal(f.all_weeks.rates.checkout_to_paid.d, 3);
  assert.equal(f.last_4_weeks.weeks, 4);
});
