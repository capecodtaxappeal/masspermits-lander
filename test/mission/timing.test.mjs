// P1-12: timing drills D1 .. D20.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { get } = await H.setup();
const { T, DAY, HOUR } = H;

// 2026-09-28 is a Monday, 2026-09-30 a Wednesday.
const WED = (hm) => T("2026-09-30T" + hm + ":00Z");
const MON = (hm) => T("2026-09-28T" + hm + ":00Z");
const YESTERDAY_1420 = T("2026-09-29T14:20:00Z");

export const results = [];
function record(id, expected, got) {
  results.push({ id, expected, got, ok: expected === got });
  assert.equal(got, expected, id);
}

async function refreshWorld(now, ranAt, zipAt) {
  const w = await H.healthyWorld(now, { ranAt });
  if (zipAt !== undefined) w.r2.set("latest-weekly.zip", "PK-new-" + zipAt, { uploaded: zipAt });
  return w;
}

const refreshTile = (res) => H.tileOf(res.body, "refresh");
const mondayTile = (res) => H.tileOf(res.body, "monday");
const stateOf = (t) => t.state === "grey" ? "grey " + t.grey : t.state;

test("D1 refresh not landed at 13:30Z -> grey pending, no needs-you line", async () => {
  const w = await refreshWorld(WED("13:30"), YESTERDAY_1420);
  const res = await get(w);
  record("D1", "grey pending", stateOf(refreshTile(res)));
  assert.ok(!H.lineIds(res.body).includes("refresh"));
  H.assertClean(assert, res, w.r2, "D1");
});

test("D2 not landed at 17:05Z -> red", async () => {
  const w = await refreshWorld(WED("17:05"), YESTERDAY_1420);
  const res = await get(w);
  record("D2", "red", stateOf(refreshTile(res)));
  assert.match(res.body.needs_you[0].text, /not landed by 17:00 UTC/);
  H.assertClean(assert, res, w.r2, "D2");
});

test("D3 zip uploaded today, status yesterday -> amber", async () => {
  const w = await refreshWorld(WED("15:00"), YESTERDAY_1420, WED("14:30"));
  const res = await get(w);
  record("D3", "amber", stateOf(refreshTile(res)));
  assert.equal(res.body.needs_you.find((l) => l.id === "refresh").severity, "amber");
  H.assertClean(assert, res, w.r2, "D3");
});

async function mondayWorld(now, o = {}) {
  const w = await H.healthyWorld(now, { mondayLog: false, ...o });
  const prev = H.mondayDue(now - 7 * DAY) + 3 * HOUR;
  if (o.log !== undefined) w.r2.set("feed-send-log.json", o.log, { uploaded: now - HOUR });
  else w.r2.set("feed-send-log.json", [H.logEntry(prev, w.roster.map((r) => ({ to: r.email, ok: true })))], { uploaded: prev });
  w.r2.set("last-send-attempt.json", { at: new Date(o.attemptAt ?? prev).toISOString(), subscribers: w.roster.length, degraded: false });
  return w;
}
const okAll = (w) => w.roster.map((r) => ({ to: r.email, ok: true }));

test("D4 Monday 16:00Z nothing sent -> grey pending, no needs-you line", async () => {
  const w = await mondayWorld(MON("16:00"));
  const res = await get(w);
  record("D4", "grey pending", stateOf(mondayTile(res)));
  assert.ok(!H.lineIds(res.body).includes("monday"));
  assert.equal(mondayTile(res).value, null);
  H.assertClean(assert, res, w.r2, "D4");
});

test("D5 Monday 20:30Z nothing -> red", async () => {
  const w = await mondayWorld(MON("20:30"));
  const res = await get(w);
  record("D5", "red", stateOf(mondayTile(res)));
  H.assertClean(assert, res, w.r2, "D5");
});

test("D6 Monday 17:53Z all delivered -> green", async () => {
  const w0 = await mondayWorld(MON("17:53"));
  const w = await mondayWorld(MON("17:53"), { log: [H.logEntry(MON("17:50"), okAll(w0))] });
  const res = await get(w);
  record("D6", "green", stateOf(mondayTile(res)));
  H.assertClean(assert, res, w.r2, "D6");
});

async function deliveredWorld(now, mutate) {
  const w = await H.healthyWorld(now);
  mutate(w);
  return w;
}

test("D7 row since Wednesday -> not missing", async () => {
  const w = await deliveredWorld(WED("18:00"), (w) => {
    w.roster.push({ ...H.rosterRows(1, WED("18:00"))[0], email: "late.joiner@example.com",
      customer: "cus_TESTlate01", since: "2026-09-30" });
    w.r2.set("subscribers.json", w.roster);
  });
  const res = await get(w);
  record("D7", "green", stateOf(mondayTile(res)));
  assert.equal(res.body.detail.monday.missing.length, 0);
  assert.equal(res.body.detail.monday.new_since_monday, 1);
  H.assertClean(assert, res, w.r2, "D7");
});

test("D8 row since Monday, not delivered -> listed, not red", async () => {
  const w = await deliveredWorld(WED("18:00"), (w) => {
    w.roster.push({ ...H.rosterRows(1, WED("18:00"))[0], email: "monday.joiner@example.com",
      customer: "cus_TESTmon001", since: "2026-09-28" });
    w.r2.set("subscribers.json", w.roster);
  });
  const res = await get(w);
  record("D8", "green", stateOf(mondayTile(res)));
  assert.equal(res.body.detail.monday.joined_on_send_day.length, 1);
  assert.equal(res.body.detail.monday.joined_on_send_day[0].email_masked, "m… · example.com");
  H.assertClean(assert, res, w.r2, "D8");
});

test("D9 skipped-only -> red", async () => {
  const w = await mondayWorld(T("2026-09-29T10:00:00Z"),
    { log: [H.logEntry(MON("15:30"), [], { skipped: "already delivered" })] });
  const res = await get(w);
  record("D9", "red", stateOf(mondayTile(res)));
  assert.match(res.body.needs_you.find((l) => l.id === "monday").text, /mailed nobody/);
  H.assertClean(assert, res, w.r2, "D9");
});

test("D10 one ok:false with no later ok -> red", async () => {
  const w0 = await mondayWorld(WED("18:00"));
  const sent = okAll(w0);
  sent[1] = { to: sent[1].to, ok: false, error: "422 rejected" };
  const w = await mondayWorld(WED("18:00"), { log: [H.logEntry(MON("15:30"), sent)] });
  const res = await get(w);
  record("D10", "red", stateOf(mondayTile(res)));
  assert.equal(res.body.detail.monday.failed.length, 1);
  H.assertClean(assert, res, w.r2, "D10");
  // a later ok for the same address clears it
  const w2 = await mondayWorld(WED("18:00"), { log: [
    H.logEntry(MON("17:00"), [{ to: sent[1].to.toUpperCase() + " ", ok: true }]), H.logEntry(MON("15:30"), sent)] });
  assert.equal(mondayTile(await get(w2)).state, "green");
});

test("D11 same address ok twice since due -> amber", async () => {
  const w0 = await mondayWorld(WED("18:00"));
  const w = await mondayWorld(WED("18:00"), { log: [
    H.logEntry(MON("18:00"), [okAll(w0)[0]]), H.logEntry(MON("15:30"), okAll(w0))] });
  const res = await get(w);
  record("D11", "amber", stateOf(mondayTile(res)));
  assert.equal(res.body.detail.monday.duplicates, 1);
  H.assertClean(assert, res, w.r2, "D11");
});

test("D12 Tuesday shows Monday's green", async () => {
  const w = await H.healthyWorld(T("2026-09-29T18:00:00Z"));
  const res = await get(w);
  record("D12", "green", stateOf(mondayTile(res)));
  assert.equal(res.body.detail.monday.monday_date, "2026-09-28");
  H.assertClean(assert, res, w.r2, "D12");
});

test("D13 attempt after due with no log entry -> red", async () => {
  const w = await mondayWorld(MON("17:00"), { attemptAt: MON("16:00") });
  const res = await get(w);
  record("D13", "red", stateOf(mondayTile(res)));
  assert.match(res.body.needs_you.find((l) => l.id === "monday").text, /never recorded a result/);
  H.assertClean(assert, res, w.r2, "D13");
});

test("D14 roster unreadable with a delivery -> amber", async () => {
  const w = await H.healthyWorld(WED("18:00"));
  w.r2.fail.add("get:subscribers.json");
  const res = await get(w);
  record("D14", "amber", stateOf(mondayTile(res)));
  H.assertClean(assert, res, w.r2, "D14");
});

test("D15 02:00Z after yesterday's healthy 14:20Z run -> green (due is yesterday 09:00Z)", async () => {
  const w = await refreshWorld(T("2026-10-01T02:00:00Z"), WED("14:20"));
  const res = await get(w);
  record("D15", "green", stateOf(refreshTile(res)));
  H.assertClean(assert, res, w.r2, "D15");
});

test("D16 02:00Z, last run two days ago 14:20Z (35 h 40 min) -> red from the due anchor", async () => {
  const w = await refreshWorld(T("2026-10-01T02:00:00Z"), YESTERDAY_1420);
  const res = await get(w);
  record("D16", "red", stateOf(refreshTile(res)));
  assert.match(res.body.needs_you[0].text, /not landed by 17:00 UTC/);
  H.assertClean(assert, res, w.r2, "D16");
});

test("D17 00:30Z, same data -> red, not grey (no reset at midnight)", async () => {
  const w = await refreshWorld(T("2026-10-01T00:30:00Z"), YESTERDAY_1420);
  const res = await get(w);
  record("D17", "red", stateOf(refreshTile(res)));
  H.assertClean(assert, res, w.r2, "D17");
});

// D18/D19: failure shapes, source-health from the day before plus the unscored-run fields.
async function failureWorld(now, ranAt, shape) {
  const w = await H.healthyWorld(now, { ranAt: ranAt - DAY, mondayLog: false });
  // keep last week's send only: nothing since this Monday's due
  const prev = H.mondayDue(now - 7 * DAY) + 3 * HOUR;
  w.r2.set("feed-send-log.json", [H.logEntry(prev, okAll(w))], { uploaded: prev });
  w.r2.set("last-send-attempt.json", { at: new Date(prev).toISOString(), subscribers: w.roster.length, degraded: false });
  const [okTown, monthlyTown, deadTown] = [w.towns[5], w.towns[0], w.towns[6]];
  w.shSources[deadTown + ", MA"] = H.shRecord("dead", ranAt - DAY, { lastGood: ranAt - 5 * DAY, lastError: "Read timed out" });
  if (shape === "crash") {
    w.status = H.crashedStatus(ranAt);
  } else if (shape === "abort") {
    Object.assign(w.status, { ok: false, degraded: false, error: "ABORT: only 12 permits scraped",
      ran_at: new Date(ranAt).toISOString(), coverage: null, contracts: null });
    w.status.errors[deadTown + ", MA"] = "Read timed out";
  } else if (shape === "bundle") {
    Object.assign(w.status, { ok: false, degraded: false, error: "bundle build crashed",
      ran_at: new Date(ranAt).toISOString(), coverage: null });
  }
  w.statusUploaded = ranAt;
  w.save(shape === "crash" ? { runs_unscored: 1, last_unscored_at: new Date(ranAt).toISOString(),
    last_unscored_why: "refresh crashed", last_scored_at: new Date(ranAt - DAY).toISOString() } : {});
  // the bundles still ship from the previous good run (crash: nothing new uploaded)
  w.r2.set("latest-weekly.zip", "PK-old", { uploaded: ranAt - DAY + 60_000 });
  return { w, okTown, monthlyTown, deadTown };
}

async function assertFailureWorld(id, f, expectKind, monday) {
  const { w, okTown, monthlyTown, deadTown } = f;
  const res = await get(w);
  H.assertClean(assert, res, w.r2, id);
  record(id + " refresh", "red", stateOf(refreshTile(res)));
  record(id + " fail_kind", expectKind, res.body.detail.refresh.fail_kind);
  assert.equal(res.body.headline.state, "red");
  assert.equal(res.body.needs_you[0].id, "refresh");
  assert.equal(res.body.headline.text, res.body.needs_you[0].text);
  assert.equal(res.body.headline.text.includes("Monday's email will not send"), monday, id + " Monday clause");
  assert.ok(!H.lineIds(res.body).includes("coverage_disclosed"), id);
  assert.equal(res.body.detail.refresh.coverage, null, id);
  if (expectKind === "crash" && f.w.status.error === "refresh crashed") assert.equal(res.body.detail.refresh.count, null);
  for (const cold of [true, false]) {
    const map = await get(w, { query: "?view=map", cold });
    H.assertClean(assert, map, w.r2, id + " map");
    const c = map.body.counts;
    assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 351, id);
    assert.deepEqual(map.body.unmatched, [], id);
    assert.equal(map.body.towns[okTown].k, "weekly", id + " ok town");
    assert.equal(map.body.towns[monthlyTown].k, "monthly", id + " monthly town");
    assert.equal(map.body.towns[deadTown].k, "dead", id + " dead town");
  }
  return res;
}

test("D18 Monday 15:00Z, that day's run crashed, nothing sent -> red with the Monday clause", async () => {
  await assertFailureWorld("D18", await failureWorld(MON("15:00"), MON("14:10"), "crash"), "crash", true);
});

test("D18 the same crash on a Wednesday -> red without the Monday clause", async () => {
  await assertFailureWorld("D18-wed", await failureWorld(WED("15:00"), WED("14:10"), "crash"), "crash", false);
});

test("D18 the ABORT shape -> fail_kind gate; the bundle-build-crashed shape -> crash", async () => {
  await assertFailureWorld("D18-abort", await failureWorld(MON("15:00"), MON("14:10"), "abort"), "gate", true);
  await assertFailureWorld("D18-bundle", await failureWorld(MON("15:00"), MON("14:10"), "bundle"), "crash", true);
});

test("D18 a healthy status with ok/degraded/error flipped is not the crash shape (members stay populated)", async () => {
  const { w } = await failureWorld(WED("15:00"), WED("14:10"), "abort");
  const s = w.r2.json("refresh-status.json");
  assert.notEqual(s.sources, null);
  const crash = H.crashedStatus(WED("14:10"));
  for (const k of ["coverage", "count", "sources", "errors", "cadence", "newest", "contracts"]) assert.equal(crash[k], null);
});

test("D19 10:00Z, yesterday's run crashed -> red, not grey pending", async () => {
  const f = await failureWorld(T("2026-09-29T10:00:00Z"), MON("14:10"), "crash");
  await assertFailureWorld("D19", f, "crash", false);
});

test("D20 15:00Z, today's run ok:false degraded:true with coverage -> amber", async () => {
  const w = await H.healthyWorld(WED("15:00"), { ranAt: WED("14:10") });
  Object.assign(w.status, { ok: false, degraded: true });
  w.status.coverage.disclose = true;
  w.save();
  const res = await get(w);
  record("D20", "amber", stateOf(refreshTile(res)));
  assert.equal(res.body.detail.refresh.fail_kind, null);
  assert.ok(res.body.detail.refresh.coverage);
  H.assertClean(assert, res, w.r2, "D20");
});

test("timing table", () => {
  const bad = results.filter((r) => !r.ok);
  assert.deepEqual(bad, []);
  if (process.env.MISSION_TABLE) {
    for (const r of results) console.log(["|", r.id, "|", r.expected, "|", r.got, "|", r.ok ? "Y" : "N", "|"].join(" "));
  }
});
