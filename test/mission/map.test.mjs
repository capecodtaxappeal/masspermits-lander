// P1-13: map drills, and the shipped 351-town constant against the public geometry file.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, get } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");
const GEOMETRY_SHA256 = "e8df13d21be725a5fb3403815da92970d3ab737770cbbcc423ee1cf4fdb9f303";

function geometry() {
  const local = path.join(H.REPO, "admin", "mission-towns.json");
  if (fs.existsSync(local)) return fs.readFileSync(local);
  try {
    return execFileSync("git", ["show", "origin/claude/seed-mission-control:docs/mission/mission-towns.json"],
      { cwd: H.REPO, maxBuffer: 1 << 24, stdio: ["ignore", "pipe", "ignore"] });
  } catch (_) {
    return null;
  }
}

test("the shipped town keys and aliases equal the public geometry file", (t) => {
  const buf = geometry();
  if (!buf) return t.skip("geometry file not available in this checkout");
  assert.equal(createHash("sha256").update(buf).digest("hex"), GEOMETRY_SHA256);
  const g = JSON.parse(buf.toString("utf8"));
  assert.deepEqual([...m.data.TOWN_KEYS], Object.keys(g.towns));
  assert.equal(m.data.TOWN_KEYS.length, 351);
  for (const [alias, key] of Object.entries(g.aliases)) assert.equal(m.data.joinTown(alias + ", MA"), key, alias);
});

const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);

async function drillWorld(o = {}) {
  const w = await H.healthyWorld(NOW, { sources: 8 });
  const [dead, weekly, monthlyT, paused, opengov, liveNoProd, errOnly] = await H.sourceTowns(7, 20);
  // the healthy towns already cover weekly/monthly; add one per remaining code
  w.status.errors[dead + ", MA"] = "HTTP 500 Internal Server Error";
  w.status.sources[dead + ", MA"] = 0;
  w.shSources[dead + ", MA"] = H.shRecord("dead", w.ranAt, { lastGood: NOW - 2 * H.DAY, lastError: "HTTP 500" });
  w.status.sources[weekly + ", MA"] = 12;                     // no record, rows > 0 -> weekly
  w.status.sources[monthlyT + ", MA"] = 3;
  w.status.cadence[monthlyT + ", MA"] = "monthly";            // no record, cadence -> monthly
  w.status.errors[errOnly + ", MA"] = "Read timed out";       // in errors, record ok -> dead
  w.shSources[errOnly + ", MA"] = H.shRecord("ok", w.ranAt);
  w.status.sources["Foxboro, MA"] = 20;                       // alias -> Foxborough
  w.status.sources["Nowhere, MA"] = 5;                        // unmatched
  w.save();
  const reg = w.r2.json("probe-map.json");
  reg.registry.towns.push(
    { name: paused, method: "html", feasibility: "built_not_wired", already_live: false },
    { name: opengov, method: "opengov", feasibility: "blocked", already_live: false },
    { name: liveNoProd, method: "html", feasibility: "live", already_live: true },
    { name: "Ashfield", method: "opengov", feasibility: "blocked", already_live: false },
    { name: "Adams", method: "opengov", feasibility: "blocked", already_live: false },
  );
  w.r2.set("probe-map.json", reg, { uploaded: NOW - 5 * H.DAY });
  if (o.outreach !== undefined) w.r2.set("admin/outreach.json", o.outreach, { uploaded: NOW - H.DAY });
  return { w, dead, weekly, monthlyT, paused, opengov, liveNoProd, errOnly };
}

const outreachDoc = (towns) => ({ version: 1, updated_at: "2026-09-26T00:00:00Z", towns });

test("P1-13 one fixture town per code, alias, unmatched, already_live, counts sum to 351", async () => {
  const d = await drillWorld({ outreach: outreachDoc({
    Adams: { outreach: "answered", since: "2026-09-20" },
    Alford: { outreach: "sent", since: "2026-09-21" },
    Ashfield: { outreach: "planned", locked: true },
    Atlantis: { outreach: "sent" },
  }) });
  const res = await get(d.w, { query: "?view=map" });
  H.assertClean(assert, res, d.w.r2, "map");
  const T = res.body.towns;
  assert.equal(T[d.dead].k, "dead");
  assert.equal(T[d.dead].ek, "http_error");
  assert.equal(T[d.errOnly].k, "dead", "a key in errors is dead even when its record says ok");
  assert.equal(T[d.weekly].k, "weekly");
  assert.equal(T[d.monthlyT].k, "monthly");
  assert.equal(T[d.paused].k, "dead");
  assert.equal(T[d.paused].lk, "paused");
  assert.equal(T[d.opengov].k, "locked");
  assert.equal(T[d.opengov].lk, "opengov");
  assert.equal(T[d.liveNoProd], undefined, "already_live true with no production is not live (omitted as none)");
  assert.equal(T.Adams.k, "answered");
  assert.equal(T.Alford.k, "sent");
  assert.equal(T.Ashfield.k, "locked", "planned never colours; locked:true does");
  assert.equal(T.Ashfield.planned, 1);
  assert.equal(T.Foxborough.k, "weekly");
  assert.deepEqual(res.body.unmatched, ["Nowhere"]);
  assert.deepEqual(res.body.outreach_ignored, ["Atlantis"]);
  assert.equal(sum(res.body.counts), 351);
  for (const c of ["dead", "weekly", "monthly", "answered", "sent", "locked", "none"]) assert.ok(res.body.counts[c] > 0, c);
  assert.deepEqual(res.body.opengov, { registry: 3, owner_list: 1 });
  assert.ok(res.body.as_of.outreach && res.body.as_of.registry && res.body.as_of.refresh && res.body.as_of.source_health);
  assert.ok(!res.text.includes("private endpoint"), "probe-map sources never read into the payload");
});

test("P1-13 precedence: dead beats outreach; answered beats sent beats locked; locked:false beats registry opengov", async () => {
  // dead beats outreach
  let d = await drillWorld();
  d.w.status.errors["Adams, MA"] = "HTTP 404";
  d.w.status.sources["Adams, MA"] = 0;
  d.w.save();
  d.w.r2.set("admin/outreach.json", outreachDoc({ Adams: { outreach: "answered" }, Alford: { outreach: "answered", locked: true },
    Ashfield: { outreach: "sent", locked: true } }));
  const first = await get(d.w, { query: "?view=map" });
  H.assertClean(assert, first, d.w.r2, "precedence 1");
  let T = first.body.towns;
  assert.equal(T.Adams.k, "dead");
  assert.equal(T.Adams.o, "answered");
  assert.equal(T.Alford.k, "answered", "answered beats locked");
  assert.equal(T.Ashfield.k, "sent", "sent beats locked");
  // declined counts as answered; locked:false beats registry opengov
  d = await drillWorld({ outreach: outreachDoc({ Adams: { locked: false }, Alford: { outreach: "declined" } }) });
  const res = await get(d.w, { query: "?view=map" });
  H.assertClean(assert, res, d.w.r2, "precedence 2");
  T = res.body.towns;
  assert.equal(T.Adams ? T.Adams.k : "none", "none", "locked:false beats registry opengov");
  assert.equal(T.Ashfield.k, "locked");
  assert.equal(T.Ashfield.lk, "opengov");
  assert.equal(T.Alford.k, "answered");
  assert.equal(sum(res.body.counts), 351);
});

test("P1-13 a 70 KB outreach object is unreadable: no outreach colours, amber line on the default view", async () => {
  const big = outreachDoc({ Adams: { outreach: "sent", note: "x".repeat(70 * 1024) } });
  const d = await drillWorld({ outreach: big });
  const map = await get(d.w, { query: "?view=map" });
  H.assertClean(assert, map, d.w.r2, "70KB map");
  assert.equal(map.body.towns.Adams && map.body.towns.Adams.k, "locked", "registry opengov only; the sent state is ignored");
  assert.equal(map.body.counts.sent, 0);
  assert.equal(sum(map.body.counts), 351);
  const main = await get(d.w);
  H.assertClean(assert, main, d.w.r2, "70KB default");
  assert.equal(main.body.detail.setup.outreach, "unreadable");
  assert.ok(H.lineIds(main.body, "amber").includes("outreach_unreadable"));
});

test("P1-13 unparseable outreach is unreadable too; notes are cut and redacted on read", async () => {
  const d = await drillWorld();
  d.w.r2.set("admin/outreach.json", "{not json");
  const map = await get(d.w, { query: "?view=map" });
  H.assertClean(assert, map, d.w.r2, "unparseable");
  assert.equal(map.body.counts.sent + map.body.counts.answered, 0);
  const parsed = m.data.parseOutreach(JSON.stringify(outreachDoc({ Adams: { outreach: "sent", bogus: 1, locked: "yes",
    note: "call 413-555-0100 or mail clerk.person@example.com " + "y".repeat(100) }, Alford: { outreach: "maybe" } })), 200);
  assert.deepEqual(Object.keys(parsed.towns.Adams).sort(), ["note", "outreach"]);
  assert.ok(parsed.towns.Adams.note.length <= 80 + 20);
  assert.ok(!/@|555-0100/.test(parsed.towns.Adams.note), parsed.towns.Adams.note);
  assert.deepEqual(parsed.towns.Alford, {});
});

test("P1-13 without refresh-status the map is source-health alone; aliases and planned towns hold", async () => {
  const d = await drillWorld({ outreach: outreachDoc({ Ashfield: { outreach: "planned" } }) });
  d.w.r2.remove("refresh-status.json");
  const res = await get(d.w, { query: "?view=map" });
  H.assertClean(assert, res, d.w.r2, "no status");
  assert.equal(res.body.towns[d.weekly], undefined, "rows-only town is gone with the status file");
  assert.equal(res.body.towns[d.w.towns[3]].k, "weekly");
  assert.equal(res.body.towns.Ashfield.k, "locked");
  assert.equal(res.body.towns.Ashfield.planned, 1);
  assert.equal(sum(res.body.counts), 351);
});

test("P1-13 a town has the same ek in the map view and in detail.refresh.sources", async () => {
  const d = await drillWorld();
  const [map, main] = [await get(d.w, { query: "?view=map" }), await get(d.w)];
  H.assertClean(assert, map, d.w.r2, "ek map");
  H.assertClean(assert, main, d.w.r2, "ek default");
  for (const s of main.body.detail.refresh.sources) {
    const key = m.data.joinTown(s.town);
    if (key) assert.equal(map.body.towns[key].ek, s.ek, s.town);
  }
  assert.ok(main.body.detail.refresh.sources.length >= 2);
});
