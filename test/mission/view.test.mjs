// P2-4: mission-view.js (pure) and mission-render.js on the fake DOM.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, get } = await H.setup();
const V = m.view;
const { T, DAY } = H;
const GEO = JSON.parse(fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"), "utf8"));
const HTML = fs.readFileSync(path.join(H.REPO, "admin/mission.html"), "utf8");
const HOSTILE = "<img src=x onerror=alert(1)>";

function renderInto(main, map, o = {}) {
  const doc = H.fakeDocumentFrom(HTML.slice(HTML.indexOf("<body>") + 6, HTML.indexOf("</body>")));
  // stays set: the page's handlers read document when they run
  globalThis.document = doc;
  {
    m.render.render(doc.getElementById("mission"), {
      main: main && { status: main.status, json: main.body },
      map: map && { status: map.status, json: map.body },
      towns: { status: 200, json: GEO },
    }, { now: o.now ?? T("2026-09-30T18:00:00Z"), onRefresh() {}, onEdit: o.onEdit || (() => {}), inert: true });
  }
  return doc;
}

test("P2-4 every tile state maps to a word and a class; unknown is UNAVAILABLE, never OK", () => {
  const cases = [
    [["green"], "OK", "s-green"], [["amber"], "WATCH", "s-amber"], [["red"], "ACT", "s-red"],
    [["grey", "not-connected"], "NOT CONNECTED", "s-grey"], [["grey", "unavailable"], "UNAVAILABLE", "s-grey"],
    [["grey", "unverified"], "UNVERIFIED", "s-grey"], [["grey", "pending"], "NOT YET", "s-grey"],
    [["grey", "bogus"], "UNAVAILABLE", "s-grey"], [["purple"], "UNAVAILABLE", "s-grey"], [[undefined], "UNAVAILABLE", "s-grey"],
  ];
  for (const [[s, g], word, cls] of cases) assert.deepEqual(V.stateOf(s, g), { word, cls }, s + " " + g);
  const t = V.tileView({ id: "mystery", label: "Mystery", state: "green", value: 3 });
  assert.equal(t.word, "UNAVAILABLE");
});

test("P2-4 grey tiles never render 0 or $0; grey unverified shows its count beside UNVERIFIED; pending is NOT YET", () => {
  for (const g of ["not-connected", "unavailable", "pending"]) {
    for (const id of ["revenue", "paying", "failed", "refresh"]) {
      for (const value of [0, null, 5]) {
        const t = V.tileView({ id, label: id, state: "grey", grey: g, value, sub: "" });
        assert.ok(!/^\$?0(\.00)?$/.test(t.value) && t.value !== "$0.00", id + " " + g + " rendered " + t.value);
        assert.equal(t.value, "—");
        assert.notEqual(t.word, "OK");
      }
    }
  }
  const u = V.tileView({ id: "failed", label: "Failed payments", state: "grey", grey: "unverified", value: 0, sub: "" });
  assert.deepEqual([u.value, u.word], ["0", "UNVERIFIED"]);
  assert.equal(V.tileView({ id: "monday", state: "grey", grey: "pending", value: null }).word, "NOT YET");
  assert.equal(V.tileView({ id: "revenue", state: "green", value: 123456 }).value, "$1,234.56");
});

test("P2-4 every ek code and fail_kind maps to its fixed sentence", () => {
  const want = {
    owner_name_gate: "The engine's privacy guard stopped this town's rows (a parser fix is needed; nothing was published)",
    access_controlled: "Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself.",
    no_rows: "Returned no rows",
    timeout: "The town's site timed out",
    http_error: "The town's site returned an error",
    parse: "The town's page changed shape (parser)",
    other: "Failed (the reason is not shown on this page)",
  };
  for (const [k, s] of Object.entries(want)) assert.equal(V.ekSentence(k), s);
  for (const k of ["bogus", "", undefined, null, "__proto__", "constructor", "toString"]) {
    assert.equal(V.ekSentence(k), want.other);
    assert.equal(V.stateOf("grey", k).word, "UNAVAILABLE");
    assert.equal(V.stateOf(k).word, "UNAVAILABLE");
    assert.equal(V.failSentence(k), "failed");
  }
  assert.match(V.ekSentence("access_controlled"), /do not retry/);
  assert.equal(V.ekSentence("access_controlled"), m.data.BLOCKED_SENTENCE);
  assert.equal(V.failSentence("crash"), "crashed");
  assert.equal(V.failSentence("gate"), "stopped by its quality gate");
  assert.equal(V.failSentence("unknown"), "failed");
  assert.equal(V.failSentence(undefined), "failed");
});

test("P2-4 legend counts match the map payload; an unknown code is Not covered, never a live colour", async () => {
  const w = await H.quietWorld(T("2026-09-30T18:00:00Z"));
  const map = (await get(w, { query: "?view=map" })).body;
  const legend = V.legendView(map);
  assert.deepEqual(legend.map((l) => l.text), ["Stale or dead source", "Live, weekly", "Live, monthly or slower",
    "Outreach answered", "Outreach sent", "Locked behind OpenGov", "Not covered"]);
  for (const l of legend) assert.equal(l.count, map.counts[l.code]);
  assert.equal(legend.reduce((a, l) => a + l.count, 0), 351);
  for (const [c, text] of V.LEGEND) assert.equal(m.data.MAP_LEGEND[c], text);
  const groups = V.listGroups(map, Object.keys(GEO.towns));
  for (const g of groups) assert.equal(g.towns.length, map.counts[g.code], g.code);
  const odd = { ...map, towns: { ...map.towns, Abington: { k: "bogus", rows: 40 } } };
  assert.equal(V.codeOf(odd.towns.Abington), "none");
  assert.equal(V.townSheet("Abington", odd.towns.Abington).lines[0], "Not covered.");
  assert.ok(V.listGroups(odd, Object.keys(GEO.towns)).find((g) => g.code === "none").towns.includes("Abington"));
  const doc = renderInto(null, null);
  assert.ok(doc);
});

test("P2-4 hostile strings pass through as plain text values", async () => {
  const t = V.tileView({ id: "paying", label: HOSTILE, state: "green", value: 1, sub: HOSTILE });
  assert.equal(t.label, HOSTILE);
  assert.equal(t.sub, HOSTILE);
  assert.ok(V.rowLine({ name: HOSTILE, email_masked: "h… · example.com" }).text.startsWith(HOSTILE));
  const w = await H.healthyWorld(T("2026-09-30T18:00:00Z"));
  w.roster[0].name = HOSTILE;
  w.r2.set("subscribers.json", w.roster, { uploaded: w.now - DAY });
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  const doc = renderInto(main, map);
  const root = doc.getElementById("mission");
  assert.equal(root.all((n) => n.localName === "img").length, 0);
  const texts = [];
  root.walk((n) => { if (n.tagName === "#text") texts.push(n._text); });
  assert.ok(texts.some((s) => s.includes(HOSTILE)), "the name is shown as text");
  for (const n of root.all(() => true)) for (const k of n.attrs.keys()) assert.ok(!/^on/i.test(k), "event attribute " + k);
});

test("P2-4 Q1: the headline reads the clear sentence; known lines only in the Known, not new group", async () => {
  const w = await H.quietWorld(T("2026-09-30T18:00:00Z"));
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  const nv = V.needsView(main.body.needs_you);
  assert.equal(nv.urgent.length, 0);
  assert.equal(nv.known.length, 9);
  assert.equal(nv.knownTitle, "Known, not new (9)");
  const doc = renderInto(main, map);
  const root = doc.getElementById("mission");
  assert.equal(root.byPart("headline-text")[0].textContent, "Nothing is wrong that this page can see.");
  const known = root.all((n) => /\bn-known\b/.test(n.className));
  assert.equal(known.length, 9);
  for (const li of known) {
    let group = null;
    for (let n = li; n; n = n.parentNode) if (n.localName === "details" && /\bknown\b/.test(n.className)) group = n;
    assert.ok(group, "known line outside the group");
    assert.ok(!/n-(red|amber)|s-(red|amber)/.test(li.className));
  }
  assert.equal(root.byPart("need").length, 0, "no numbered line on a quiet day");
  const summary = root.all((n) => n.localName === "details" && /\bknown\b/.test(n.className))[0];
  assert.equal(summary.textContent.startsWith("Known, not new (9)"), true);
  // a known line never becomes the headline, whatever the list holds
  const onlyKnown = V.headlineView({ state: "clear", text: "Nothing is wrong that this page can see." });
  assert.deepEqual([onlyKnown.cls, onlyKnown.word], ["h-clear", "OK"]);
});

test("P2-4 D18: coverage and count null -> no throw, refresh tile red, both shown as not reported", async () => {
  const now = T("2026-09-28T15:00:00Z");
  const w = await H.healthyWorld(now, { mondayLog: false, ranAt: T("2026-09-27T14:20:00Z") });
  const ranAt = T("2026-09-28T14:10:00Z");
  w.status = H.crashedStatus(ranAt);
  w.statusUploaded = ranAt;
  w.save({ runs_unscored: 1, last_unscored_at: new Date(ranAt).toISOString(), last_unscored_why: "refresh crashed" });
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  assert.equal(main.body.detail.refresh.coverage, null);
  assert.equal(main.body.detail.refresh.count, null);
  const tiles = V.tilesView(main.body.tiles);
  const refresh = tiles.find((t) => t.id === "refresh");
  assert.deepEqual([refresh.word, refresh.cls, refresh.value], ["ACT", "s-red", "not reported"]);
  const sec = V.sectionsView(main.body, map.body).find((s) => s.id === "refresh");
  assert.ok(sec.paras.includes("Coverage: not reported."));
  assert.ok(sec.paras.includes("Permits in the run: not reported."));
  assert.ok(sec.paras.some((p) => p.includes("The refresh crashed.")));
  assert.ok(!sec.paras.some((p) => /\b0 of\b/.test(p)));
  const doc = renderInto(main, map, { now });
  const root = doc.getElementById("mission");
  assert.equal(root.all((n) => n.getAttribute("data-tile") === "refresh")[0].className, "tile s-red");
});

test("P2-4 the sheet opens from the map and the list, takes focus, closes on Escape and gives focus back", async () => {
  const w = await H.healthyWorld(T("2026-09-30T18:00:00Z"));
  const doc = renderInto(await get(w), await get(w, { query: "?view=map" }));
  const root = doc.getElementById("mission");
  const sheet = root.all((n) => n.getAttribute("role") === "dialog")[0];
  assert.ok(!sheet.isShown());
  const toggle = root.all((n) => /\btoggle\b/.test(n.className))[0];
  toggle.focus();
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  const btn = root.all((n) => n.localName === "button" && n.textContent === "Adams")[0];
  btn.focus();
  btn.click();
  assert.ok(sheet.isShown());
  assert.equal(doc.getElementById("sheet-title").textContent, "Adams");
  assert.equal(doc.activeElement.textContent, "Close");
  sheet.dispatch("keydown", { key: "Escape" });
  assert.ok(!sheet.isShown());
  assert.equal(doc.activeElement, btn);
  // no edit buttons unless the default view says outreach_edit: true
  assert.equal(root.all((n) => /\bchoice\b/.test(n.className)).length, 0);
});
