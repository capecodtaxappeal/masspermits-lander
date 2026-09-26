// P1-15: the production-shaped quiet day, and the single changes that must (and must not) move it.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { get } = await H.setup();
const { T, DAY } = H;
const CLEAR = "Nothing is wrong that this page can see.";
const Q1 = T("2026-09-30T18:00:00Z");     // a Wednesday
const Q2 = T("2026-09-30T10:00:00Z");
const Q3 = T("2026-09-28T16:00:00Z");     // a Monday
const KNOWN_Q1 = ["coverage_disclosed", "sources_blocked", "sources_vanished", "sources_down_long", "sources_failing",
  "registry_age", "stripe_not_connected", "outreach_absent", "engagement"];

export const results = [];
function record(id, expected, got) {
  results.push({ id, expected, got, ok: expected === got });
  assert.equal(got, expected, id);
}

function assertQuiet(res, w, label) {
  H.assertClean(assert, res, w.r2, label);
  record(label + " headline", CLEAR, res.body.headline.text);
  assert.equal(res.body.headline.state, "clear", label);
  assert.deepEqual(res.body.needs_you.filter((l) => l.severity !== "known"), [], label + " red/amber lines");
  for (const t of res.body.tiles) assert.ok(!["red", "amber"].includes(t.state), label + " tile " + t.id);
  for (const t of res.body.tiles) assert.ok(!(t.state === "grey" && t.grey === "unavailable"), label + " " + t.id);
}

test("Q1 Wednesday 18:00Z -> exactly the clear sentence, the known ids exactly, failed tile unverified", async () => {
  const w = await H.quietWorld(Q1);
  const res = await get(w);
  assertQuiet(res, w, "Q1");
  assert.deepEqual(H.lineIds(res.body, "known").sort(), KNOWN_Q1.slice().sort());
  const byId = Object.fromEntries(res.body.needs_you.map((l) => [l.id, l]));
  assert.match(byId.sources_vanished.text, /^4 sources /);
  for (const t of w.names.vanished) assert.ok(byId.sources_vanished.text.includes(t), t);
  assert.ok(byId.sources_blocked.text.includes("do not retry"));
  assert.ok(byId.sources_blocked.text.includes(w.names.blocked));
  assert.ok(byId.sources_down_long.text.includes(w.names.oldDead + " (down since "));
  assert.ok(byId.sources_failing.text.includes(w.names.failing));
  const f = H.tileOf(res.body, "failed");
  assert.deepEqual([f.state, f.grey, f.value], ["grey", "unverified", 0]);
  assert.equal(H.tileOf(res.body, "refresh").state, "green");
  assert.equal(H.tileOf(res.body, "monday").state, "green");
  assert.equal(res.body.privacy_redactions, 0);
  // the map on the quiet day
  const map = await get(w, { query: "?view=map" });
  H.assertClean(assert, map, w.r2, "Q1 map");
  assert.equal(map.body.towns[w.names.blocked].ek, "access_controlled");
  assert.equal(Object.values(map.body.counts).reduce((a, b) => a + b, 0), 351);
});

test("Q2 the same world at 10:00Z -> refresh grey pending, headline unchanged", async () => {
  const w = await H.quietWorld(Q2);
  assert.equal(new Date(w.ranAt).toISOString(), "2026-09-29T14:20:00.000Z");
  const res = await get(w);
  const r = H.tileOf(res.body, "refresh");
  record("Q2 refresh", "grey pending", r.state + " " + r.grey);
  assertQuiet(res, w, "Q2");
});

test("Q3 a Monday at 16:00Z, last send the Monday before -> monday grey pending, headline unchanged", async () => {
  const prevMonday = T("2026-09-21T15:40:00Z");
  const w = await H.quietWorld(Q3, { sendAt: prevMonday });
  assert.equal(new Date(w.ranAt).toISOString(), "2026-09-28T14:20:00.000Z");
  const res = await get(w);
  const mo = H.tileOf(res.body, "monday");
  record("Q3 monday", "grey pending", mo.state + " " + mo.grey);
  assertQuiet(res, w, "Q3");
});

test("M1 a further source newly dead -> amber sources_down naming it; still one line with two", async () => {
  const w = await H.quietWorld(Q1);
  const [a, b] = await H.sourceTowns(2, 80);
  const kill = (t) => {
    w.status.errors[t + ", MA"] = "HTTP 500 Internal Server Error";
    w.status.sources[t + ", MA"] = 0;
    w.shSources[t + ", MA"] = H.shRecord("dead", w.ranAt, { lastGood: Q1 - 3 * DAY, lastError: "HTTP 500 Internal Server Error" });
  };
  kill(a);
  w.save();
  let res = await get(w);
  record("M1 headline", "amber", res.body.headline.state);
  const line = res.body.needs_you.find((l) => l.severity === "amber");
  assert.equal(line.id, "sources_down");
  assert.equal(res.body.headline.text, line.text);
  assert.ok(line.text.includes(a + " (dead since "));
  assert.match(line.text, /^1 source down in the last 7 days: .*See the map\.$/);
  kill(b);
  w.save();
  res = await get(w);
  const downs = res.body.needs_you.filter((l) => l.id === "sources_down");
  assert.equal(downs.length, 1);
  assert.match(downs[0].text, /^2 sources down/);
  H.assertClean(assert, res, w.r2, "M1");
});

test("M2 the refresh crashed (exact failure shape) -> both views 200, red refresh, map unchanged", async () => {
  const w = await H.quietWorld(Q1);
  const before = (await get(w, { query: "?view=map" })).body;
  w.status = H.crashedStatus(w.ranAt);
  w.save({ runs_unscored: 1, last_unscored_at: new Date(w.ranAt).toISOString(), last_unscored_why: "refresh crashed" });
  const res = await get(w);
  H.assertClean(assert, res, w.r2, "M2");
  record("M2 headline", "red", res.body.headline.state);
  assert.equal(res.body.needs_you[0].id, "refresh");
  assert.deepEqual(res.body.needs_you.filter((l) => l.severity === "amber"), []);
  const known = H.lineIds(res.body, "known");
  assert.deepEqual(known.sort(), KNOWN_Q1.filter((k) => k !== "coverage_disclosed").sort());
  assert.equal(res.body.detail.refresh.coverage, null);
  assert.equal(res.body.detail.refresh.count, null);
  const map = await get(w, { query: "?view=map" });
  H.assertClean(assert, map, w.r2, "M2 map");
  for (const [town, f] of Object.entries(before.towns)) {
    if (f.state) assert.equal(map.body.towns[town] && map.body.towns[town].k, f.k, town);
  }
  assert.equal(map.body.towns[w.names.blocked].ek, "access_controlled", "ek now from last_error");
  assert.equal(Object.values(map.body.counts).reduce((a, b) => a + b, 0), 351);
});

test("M3 a collapse: consecutive_low 4 -> amber sources_down; 30 -> sources_down_long and back to clear", async () => {
  const w = await H.quietWorld(Q1);
  const [c] = await H.sourceTowns(1, 90);
  w.shSources[c + ", MA"] = H.shRecord("collapsed", w.ranAt, { consecutiveLow: 4 });
  w.save();
  let res = await get(w);
  record("M3 low 4", "sources_down", res.body.needs_you.find((l) => l.severity === "amber").id);
  assert.ok(res.body.headline.text.includes(c + " (collapsed, 4 runs)"));
  w.shSources[c + ", MA"] = H.shRecord("collapsed", w.ranAt, { consecutiveLow: 30 });
  w.save();
  res = await get(w);
  record("M3 low 30", CLEAR, res.body.headline.text);
  assert.ok(res.body.needs_you.find((l) => l.id === "sources_down_long").text.includes(c));
});

test("M4 the old dead source re-alerted an hour ago -> still clear (alerted_at is never recency)", async () => {
  const w = await H.quietWorld(Q1);
  const k = w.names.oldDead + ", MA";
  w.shSources[k] = { ...w.shSources[k], alerted_at: new Date(Q1 - H.HOUR).toISOString(), alert_kind: "dead" };
  w.save();
  const res = await get(w);
  record("M4 headline", CLEAR, res.body.headline.text);
  assertQuiet(res, w, "M4");
});

test("M5 the 403 source's last_good one day ago -> still clear (blocked is known whatever its age)", async () => {
  const w = await H.quietWorld(Q1);
  const k = w.names.blocked + ", MA";
  w.shSources[k] = { ...w.shSources[k], last_good: new Date(Q1 - DAY).toISOString() };
  w.save();
  const res = await get(w);
  record("M5 headline", CLEAR, res.body.headline.text);
  assertQuiet(res, w, "M5");
});

test("quiet-day table", () => {
  assert.deepEqual(results.filter((r) => !r.ok), []);
  if (process.env.MISSION_TABLE) {
    for (const r of results) console.log(["|", r.id, "|", r.expected, "|", r.got, "|", r.ok ? "Y" : "N", "|"].join(" "));
  }
});
