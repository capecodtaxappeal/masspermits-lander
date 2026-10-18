// Road to 20: milestones, scheduled cancels ("leaving"), weekly new, ended and
// net, and where each paid checkout came from. Invented fixtures only.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
const D = g.data;
const R = g.render;
// Sunday 2026-09-27 14:00 in Boston.
const NOW = H.T("2026-09-27T18:00:00Z");
const S = (ms) => Math.floor(ms / 1000);

async function route(data, now = NOW) {
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer(data);
  const res = await call({ env: envOf(new H.GrowthR2(), H.stripeEnv()), now });
  assert.equal(res.status, 200);
  return res;
}

function mount() {
  const doc = H.fakeDocumentFrom('<h1 id="title">Road to 20</h1><div id="app"></div>');
  return { doc, root: doc.getElementById("app"), h1: doc.getElementById("title") };
}

const active = (n) => Array.from({ length: n }, (_, i) => H.sub(NOW - (20 + i) * H.DAY, "active"));

// A subscription set to cancel at the end of its period, as Stripe sends it:
// still active, cancel_at_period_end true, the period end on its item.
function leavingSub(startMs, periodEndMs, o = {}) {
  const s = H.sub(startMs, o.status || "active");
  s.cancel_at_period_end = true;
  s.items.data[0].current_period_end = S(periodEndMs);
  if (o.ended) s.ended_at = S(o.ended);
  return s;
}

// ── milestones ──────────────────────────────────────────────────────────────
test("milestones: 4 gives 6 to go to 10, 13 gives 7 to go to 20 (by Dec 31, 2026), 37 gives 63 to go to 100", () => {
  assert.deepEqual([...D.MILESTONES], [10, 20, 100]);
  assert.deepEqual(D.nextMilestone(4), { target: 10, to_go: 6, deadline: null, reached: false });
  assert.deepEqual(D.nextMilestone(13), { target: 20, to_go: 7, deadline: "2026-12-31", reached: false });
  assert.deepEqual(D.nextMilestone(37), { target: 100, to_go: 63, deadline: null, reached: false });
  assert.equal(R.toGoText(D.nextMilestone(4)), "6 to go to 10");
  assert.equal(R.toGoText(D.nextMilestone(13)), "7 to go to 20 by Dec 31, 2026");
  assert.equal(R.toGoText(D.nextMilestone(37)), "63 to go to 100");
  // the edges: a milestone reached moves on to the next one
  assert.equal(D.nextMilestone(0).to_go, 10);
  assert.equal(D.nextMilestone(10).target, 20);
  assert.equal(D.nextMilestone(20).target, 100);
  assert.deepEqual(D.nextMilestone(100), { target: 100, to_go: 0, deadline: null, reached: true });
  assert.equal(D.nextMilestone(null), null);
  assert.equal(D.roadOf(19), 20);
  assert.equal(D.roadOf(20), 100);
  assert.equal(D.roadOf(null), 20);
});

test("through the route and the page: headline, to go line, and the title reads Road to 20 under 20, then Road to 100", async () => {
  for (const [n, head, togo, title] of [
    [4, "4 of 10", "6 to go to 10", "Road to 20"],
    [13, "13 of 20", "7 to go to 20 by Dec 31, 2026", "Road to 20"],
    [37, "37 of 100", "63 to go to 100", "Road to 100"],
  ]) {
    const res = await route({ sessions: [], subscriptions: active(n) });
    assert.equal(res.body.paying_now, n);
    assert.equal(res.body.goal, D.nextMilestone(n).target);
    const { doc, root, h1 } = mount();
    assert.equal(R.render(root, { status: 200, json: res.body }), "ok");
    assert.equal(root.byPart("headline")[0].textContent, head);
    assert.equal(root.byPart("to-go")[0].textContent, togo);
    assert.equal(h1.textContent, title);
    assert.equal(doc.title, title);
  }
});

// ── retention ───────────────────────────────────────────────────────────────
test("cancel_at_period_end: paying and leaving until the period ends, then ended", async () => {
  const periodEnd = NOW + 3 * H.DAY;
  const keep = H.sub(NOW - 40 * H.DAY, "active");
  const before = await route({ sessions: [], subscriptions: [keep, leavingSub(NOW - 30 * H.DAY, periodEnd)] });
  assert.equal(before.body.paying_now, 2);
  const r = before.body.retention;
  assert.equal(r.state, "ok");
  assert.equal(r.paying_now, 2);
  assert.equal(r.leaving, 1);
  assert.equal(r.paying_after, 1);
  assert.deepEqual(r.ends, [{ date: "2026-09-30", n: 1 }]);
  const cur = before.body.weeks[12];
  assert.equal(cur.subscribers, 2);
  assert.equal(cur.ended, 0);

  // Five days on, the period is over. Stripe may still list it as active for
  // a moment, or already as canceled with ended_at: both read as ended.
  const later = NOW + 5 * H.DAY;
  for (const s of [leavingSub(NOW - 30 * H.DAY, periodEnd),
    leavingSub(NOW - 30 * H.DAY, periodEnd, { status: "canceled", ended: periodEnd })]) {
    const after = await route({ sessions: [], subscriptions: [keep, s] }, later);
    assert.equal(after.body.paying_now, 1);
    assert.equal(after.body.retention.leaving, 0);
    assert.equal(after.body.retention.paying_after, 1);
    const w = after.body.weeks[12];
    assert.equal(w.ended, 1);
    assert.equal(w.new_paid, 0);
    assert.equal(w.net, -1);
    // last week it was still paying at week end
    assert.equal(after.body.weeks[11].subscribers, 2);
  }
});

test("a cancel_at date also counts as leaving, with that date; a canceled or never paid subscription is not leaving", async () => {
  const dated = H.sub(NOW - 30 * H.DAY, "active", { cancelAt: H.T("2026-11-15T17:00:00Z") });
  const trial = leavingSub(NOW - 2 * H.DAY, NOW + 5 * H.DAY, { status: "trialing" });
  const gone = leavingSub(NOW - 60 * H.DAY, NOW - 20 * H.DAY, { status: "canceled", ended: NOW - 20 * H.DAY });
  const never = leavingSub(NOW - 3 * H.DAY, NOW + 5 * H.DAY, { status: "incomplete_expired" });
  const res = await route({ sessions: [], subscriptions: [dated, trial, gone, never, H.sub(NOW - 50 * H.DAY, "past_due")] });
  const r = res.body.retention;
  assert.equal(r.paying_now, 3);
  assert.equal(r.leaving, 2);
  assert.equal(r.paying_after, 1);
  assert.deepEqual(r.ends, [{ date: "2026-10-02", n: 1 }, { date: "2026-11-15", n: 1 }]);
  const { root } = mount();
  R.render(root, { status: 200, json: res.body });
  const box = root.byPart("retention")[0].textContent;
  assert.ok(box.includes("Paying now") && box.includes("Leaving") && box.includes("Paying after scheduled cancels"), box);
  assert.ok(box.includes("Oct 2, 2026") && box.includes("Nov 15, 2026"), box);
});

test("per week: new, ended and net agree with the change in paying at week end", async () => {
  const grid = D.weekGrid(NOW);
  const wk = (i) => grid.weeks[i];
  const subs = [
    H.sub(wk(0).start - 30 * H.DAY, "active"),
    H.sub(wk(2).start + H.DAY, "canceled", { ended: wk(6).start + H.DAY }),
    H.sub(wk(9).start + H.HOUR, "past_due"),
    H.sub(wk(9).start + 2 * H.HOUR, "canceled", { ended: wk(9).start + 3 * H.DAY }),  // in and out the same week
    H.sub(NOW - 2 * H.DAY, "trialing"),
    leavingSub(wk(4).start + H.HOUR, NOW + 20 * H.DAY),
    H.sub(wk(3).start, "incomplete_expired"),
    H.sub(wk(1).start, "active", { price: H.OTHER }),
  ];
  const res = await route({ sessions: [], subscriptions: subs });
  const w = res.body.weeks;
  assert.deepEqual(w.map((x) => x.new_paid), [0, 0, 1, 0, 1, 0, 0, 0, 0, 2, 0, 0, 1]);
  assert.deepEqual(w.map((x) => x.ended), [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0]);
  for (let i = 1; i < w.length; i++) {
    assert.equal(w[i].net, w[i].new_paid - w[i].ended);
    assert.equal(w[i].subscribers - w[i - 1].subscribers, w[i].net, "week " + i);
  }
  assert.equal(res.body.retention.leaving, 1);
});

test("Stripe unavailable: retention and source tables say so, never 0", async () => {
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer({ sessions: [], subscriptions: [] }, { fail: () => true });
  const res = await call({ env: envOf(new H.GrowthR2(), H.stripeEnv()), now: NOW });
  assert.equal(res.body.retention.state, "unavailable");
  assert.equal(res.body.sources_paid.state, "unavailable");
  for (const w of res.body.weeks) {
    for (const k of ["new_paid", "ended", "net", "paid_by_source"]) assert.equal(w[k], "unavailable", k);
  }
  const { root } = mount();
  R.render(root, { status: 200, json: res.body });
  const rows = root.byPart("sources")[0].all((n) => n.localName === "tr").slice(1);
  for (const r of rows) for (const c of r.children.slice(1)) assert.equal(c.textContent, "unavailable");
});

// ── where paid checkouts came from ──────────────────────────────────────────
test("each client_reference_id format lands in its bucket; anything else is unknown", () => {
  const cases = [
    ["ref-abcd", "referral"],
    ["ref-k7q2m9x4", "referral"],
    ["Roofing__plymouth", "picker"],
    ["all__all", "picker"],
    ["HVAC-Plumbing__cape_cod", "picker"],
    ["ps-sample01", "prospect_sample"],
    ["ps-roofing-plymouth-2026", "prospect_sample"],
    [null, "unknown"],
    [undefined, "unknown"],
    ["", "unknown"],
    ["hello", "unknown"],
    ["ref-AB12", "unknown"],          // referral codes are lowercase
    ["ref-abc", "unknown"],           // too short
    ["ps-", "unknown"],
    ["Roofing__", "unknown"],
    ["__plymouth", "unknown"],
    ["<b>x</b>__y", "unknown"],
    [42, "unknown"],
  ];
  for (const [ref, want] of cases) assert.equal(D.sourceOf(ref), want, JSON.stringify(ref));
  assert.deepEqual([...D.SOURCES], ["referral", "picker", "prospect_sample", "unknown"]);
});

test("paid checkouts by source per week, with a 13 week total; abandoned checkouts are not counted", async () => {
  const grid = D.weekGrid(NOW);
  const ref = (v) => ({ client_reference_id: v });
  const sessions = [
    H.session(NOW - H.DAY, "complete", H.FEED, ref("ref-k7q2m9x4")),
    H.session(NOW - H.DAY, "complete", H.FEED, ref("Roofing__plymouth")),
    H.session(NOW - 2 * H.DAY, "complete", H.FEED, ref("all__all")),
    H.session(NOW - 2 * H.DAY, "complete", H.FEED, ref("ps-sample01")),
    H.session(NOW - 2 * H.DAY, "complete", H.FEED, ref(null)),
    H.session(NOW - 3 * H.DAY, "expired", H.FEED, ref("ref-zzzz9999")),
    H.session(grid.weeks[5].start + H.DAY, "complete", H.FEED, ref("Solar__boston")),
    H.session(NOW - H.DAY, "complete", H.OTHER, ref("ref-k7q2m9x4")),
  ];
  const res = await route({ sessions, subscriptions: [] });
  assert.deepEqual(res.body.weeks[12].paid_by_source, { referral: 1, picker: 2, prospect_sample: 1, unknown: 1 });
  assert.deepEqual(res.body.weeks[5].paid_by_source, { referral: 0, picker: 1, prospect_sample: 0, unknown: 0 });
  assert.deepEqual(res.body.weeks[4].paid_by_source, { referral: 0, picker: 0, prospect_sample: 0, unknown: 0 });
  assert.deepEqual(res.body.sources_paid, { state: "ok", at_least: false,
    totals: { referral: 1, picker: 3, prospect_sample: 1, unknown: 1 } });
  assert.ok(!res.text.includes("k7q2m9x4") && !res.text.includes("Roofing") && !res.text.includes("plymouth"));
  const { root } = mount();
  R.render(root, { status: 200, json: res.body });
  const rows = root.byPart("sources")[0].all((n) => n.localName === "tr");
  assert.deepEqual(rows[0].children.map((c) => c.textContent), ["Week of", "Referral", "Homepage picker", "Prospect sample", "Unknown"]);
  assert.equal(rows.length, 1 + 13 + 1);
  assert.deepEqual(rows[1].children.map((c) => c.textContent), ["This week", "1", "2", "1", "1"]);
  assert.deepEqual(rows[14].children.map((c) => c.textContent), ["All 13 weeks", "1", "3", "1", "1"]);
});

// ── privacy and the footnote ────────────────────────────────────────────────
test("the payload carries no \"@\", no \"cus_\" and no \"sub_\", with every new fixture in play", async () => {
  const res = await route({
    sessions: [H.session(NOW - H.DAY, "complete", H.FEED, { client_reference_id: "ref-k7q2m9x4" }),
      H.session(NOW - H.DAY, "complete", H.FEED, { client_reference_id: "owner@example.com" }),
      H.session(NOW - H.DAY, "complete", H.FEED, { client_reference_id: "cus_TEST000099" })],
    subscriptions: [leavingSub(NOW - 30 * H.DAY, NOW + 3 * H.DAY), H.sub(NOW - 30 * H.DAY, "active", { cancelAt: NOW + 9 * H.DAY }),
      H.sub(NOW - 60 * H.DAY, "canceled", { ended: NOW - 9 * H.DAY })],
  });
  for (const bad of ["@", "cus_", "sub_"]) assert.ok(!res.text.includes(bad), bad);
  assert.equal(res.body.sources_paid.totals.unknown, 2);
});

test("the page carries the price list footnote", async () => {
  const res = await route({ sessions: [], subscriptions: active(2) });
  const { root } = mount();
  R.render(root, { status: 200, json: res.body });
  assert.equal(root.byPart("footnote")[0].textContent, "Counts follow the MassPermits price list set on the server.");
});
