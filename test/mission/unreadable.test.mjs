// P1-11: an R2 read that throws, or an object that is missing, is grey — never green, never 0.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { get } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");

function noGreenFrom(body, ids) {
  for (const id of ids) {
    const t = H.tileOf(body, id);
    assert.notEqual(t.state, "green", id);
  }
}

test("P1-11 get throws for subscribers.json and delivery-log.json -> grey unavailable, amber unreadable line", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("get:subscribers.json");
  w.r2.fail.add("get:delivery-log.json");
  const res = await get(w);
  assert.equal(res.status, 200);
  for (const id of ["paying", "failed", "sales"]) {
    const t = H.tileOf(res.body, id);
    assert.deepEqual([t.state, t.grey, t.value], ["grey", "unavailable", null], id);
  }
  // Monday depends on the roster too: a delivery exists but everyone cannot be confirmed.
  assert.equal(H.tileOf(res.body, "monday").state, "amber");
  noGreenFrom(res.body, ["paying", "failed", "sales", "monday"]);
  assert.notEqual(res.body.headline.text, "Nothing is wrong that this page can see.");
  assert.notEqual(res.body.headline.state, "clear");
  const line = res.body.needs_you.find((l) => l.id === "unreadable");
  assert.equal(line.severity, "amber");
  assert.match(line.text, /^Could not read: .*Paying customers.*Failed payments.*Sales, 7 days.*\. Reload; if it stays, check \/admin\/pipeline\.$/);
  H.assertClean(assert, res, w.r2, "p1-11");
});

test("P1-11 missing objects -> grey, not zero", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.remove("subscribers.json").remove("delivery-log.json");
  const res = await get(w);
  for (const id of ["paying", "failed", "sales"]) {
    const t = H.tileOf(res.body, id);
    assert.equal(t.state, "grey", id);
    assert.equal(t.value, null, id);
  }
  assert.ok(H.lineIds(res.body, "amber").includes("unreadable"));
});

test("P1-11 refresh-status head throws -> refresh grey unavailable (not red, not green)", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("head:refresh-status.json");
  const res = await get(w);
  const t = H.tileOf(res.body, "refresh");
  assert.deepEqual([t.state, t.grey, t.value], ["grey", "unavailable", null]);
  assert.match(res.body.needs_you.find((l) => l.id === "unreadable").text, /Data refresh/);
});

test("P1-11 refresh-status get throws while its head answers -> grey unavailable", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("get:refresh-status.json");
  const t = H.tileOf((await get(w)).body, "refresh");
  assert.deepEqual([t.state, t.grey], ["grey", "unavailable"]);
});

test("P1-11 a signup list that throws -> signups grey unavailable", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("list:newsletter/");
  const t = H.tileOf((await get(w)).body, "signups");
  assert.deepEqual([t.state, t.grey, t.value], ["grey", "unavailable", null]);
});

test("P1-11 source-health unreadable -> named in the unreadable line; the map view answers 503", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("get:source-health.json");
  const res = await get(w);
  assert.match(res.body.needs_you.find((l) => l.id === "unreadable").text, /Source health/);
  const map = await get(w, { query: "?view=map" });
  assert.equal(map.status, 503);
  assert.deepEqual(map.body, { error: "unavailable" });
});

test("P1-11 every get and list throws -> nothing green, headline not clear, still no exception text", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("get:*");
  w.r2.fail.add("list:*");
  const res = await get(w);
  assert.equal(res.status, 200);
  for (const t of res.body.tiles) assert.notEqual(t.state, "green", t.id);
  assert.notEqual(res.body.headline.state, "clear");
  assert.ok(!/failed for test/.test(res.text));
});

test("P1-11 the binding itself missing -> 503 unavailable after auth, no exception text", async () => {
  const w = await H.healthyWorld(NOW);
  const res = await get(w, { env: { BUNDLES: undefined } });
  assert.ok(res.status === 200 || res.status === 503);
  if (res.status === 200) for (const t of res.body.tiles) assert.notEqual(t.state, "green", t.id);
  const map = await get(w, { query: "?view=map", env: { BUNDLES: undefined } });
  assert.equal(map.status, 503);
  assert.ok(!/TypeError|undefined/.test(map.text));
});

test("P1-11 outreach head throws -> outreach unreadable amber line", async () => {
  const w = await H.healthyWorld(NOW);
  w.r2.fail.add("head:admin/outreach.json");
  const res = await get(w);
  assert.equal(res.body.detail.setup.outreach, "unreadable");
  assert.ok(H.lineIds(res.body, "amber").includes("outreach_unreadable"));
});
