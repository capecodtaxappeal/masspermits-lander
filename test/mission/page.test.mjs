// P2-2, P2-3, P2-4, P2-7, P2-11: the page files, the view model, weight and contrast.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, get } = await H.setup();
const V = m.view;
const read = (rel) => fs.readFileSync(path.join(H.REPO, rel), "utf8");
const PAGE = ["admin/mission.html", "admin/mission-app.js", "admin/mission-render.js", "admin/mission-view.js",
  "admin/mission-app.css"];
const NOW = H.T("2026-09-30T18:00:00Z");

// ── P2-2 ────────────────────────────────────────────────────────────────────
test("P2-2 geometry is a byte copy (SHA-256) with 351 towns; the editor's town constant equals its keys", () => {
  const buf = fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"));
  assert.equal(createHash("sha256").update(buf).digest("hex"),
    "e8df13d21be725a5fb3403815da92970d3ab737770cbbcc423ee1cf4fdb9f303");
  assert.equal(buf.length, 61330);
  const geo = JSON.parse(buf.toString("utf8"));
  const keys = Object.keys(geo.towns);
  assert.equal(keys.length, 351);
  assert.deepEqual([...m.data.TOWN_KEYS].sort(), keys.slice().sort());
  const src = read("functions/admin/api/mission-outreach.js");
  assert.ok(/import \{ TOWN_KEYS \} from "\.\.\/\.\.\/api\/_mission_data\.js";/.test(src));
  assert.ok(/const TOWNS = new Set\(TOWN_KEYS\);/.test(src));
});

// ── P2-3 ────────────────────────────────────────────────────────────────────
test("P2-3 page grep: no markup sink, no storage API; mission-app.js is the only file that requests", () => {
  const files = fs.readdirSync(path.join(H.REPO, "admin")).filter((f) => f.startsWith("mission")).map((f) => "admin/" + f);
  assert.ok(files.length >= 6);
  const sinks = ["innerHTML", "insertAdjacentHTML", "outerHTML", "document.write", "eval(", "new Function",
    'setAttribute("style', "setAttribute('style", 'setAttribute("on', "setAttribute('on"];
  const storage = ["localStorage", "sessionStorage", "indexedDB", "caches.", "serviceWorker", "document.cookie"];
  for (const f of files) {
    const src = read(f);
    for (const b of [...sinks, ...storage]) assert.ok(!src.includes(b), f + ": " + b);
  }
  for (const f of ["admin/mission-render.js", "admin/mission-view.js"]) {
    const src = read(f);
    for (const b of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "import(", "setTimeout",
      "setInterval"]) assert.ok(!src.includes(b), f + ": " + b);
  }
  assert.ok(/\bfetch\(/.test(read("admin/mission-app.js")));
  assert.ok(!/^\s*import\b/m.test(read("admin/mission-view.js")), "the view model imports nothing");
});

test("P2-3 mission.html: no inline script, no style=, robots meta, one module script, one stylesheet", () => {
  const html = read("admin/mission.html");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][2].trim(), "", "no inline script body");
  assert.match(scripts[0][1], /type="module"/);
  assert.match(scripts[0][1], /src="\/admin\/mission-app\.js"/);
  assert.ok(!/<script[^>]+src="https?:/i.test(html));
  assert.ok(!/\sstyle\s*=/i.test(html));
  assert.ok(!/<style\b/i.test(html));
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert.equal((html.match(/<link\b/gi) || []).length, 1);
  assert.ok(html.includes('<link rel="stylesheet" href="/admin/mission-app.css">'));
  assert.ok(!/\/api\/hit|beacon/i.test(html));
  assert.ok(html.includes("Setup needed"));
  const css = read("admin/mission-app.css");
  assert.ok(!/@font-face|@import|url\(/i.test(css), "system fonts only, nothing loaded");
  assert.ok(read("admin/mission-view.js").includes('"Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024"'));
});

// ── P2-4 ────────────────────────────────────────────────────────────────────
test("P2-4 every tile state maps to a word and a class; grey never renders 0 or $0", () => {
  const cases = [
    [{ id: "paying", state: "green", value: 3 }, "OK", "st-ok", "3"],
    [{ id: "paying", state: "amber", value: 3 }, "WATCH", "st-watch", "3"],
    [{ id: "failed", state: "red", value: 1 }, "ACT", "st-act", "1"],
    [{ id: "revenue", state: "grey", grey: "not-connected", value: null }, "NOT CONNECTED", "st-grey", V.NO_VALUE],
    [{ id: "revenue", state: "grey", grey: "unavailable", value: 0 }, "UNAVAILABLE", "st-grey", V.NO_VALUE],
    [{ id: "refresh", state: "grey", grey: "pending", value: 0 }, "NOT YET", "st-grey", V.NO_VALUE],
    [{ id: "failed", state: "grey", grey: "unverified", value: 0 }, "UNVERIFIED", "st-grey", "0"],
    [{ id: "paying", state: "purple", value: 9 }, "UNAVAILABLE", "st-grey", V.NO_VALUE],
    [{ id: "paying", state: "grey", grey: "mystery", value: 9 }, "UNAVAILABLE", "st-grey", V.NO_VALUE],
    [{ id: "revenue", state: "green", value: 123456 }, "OK", "st-ok", "$1,234.56"],
  ];
  for (const [t, word, cls, value] of cases) {
    const tm = V.tileModel(t);
    assert.equal(tm.word, word, JSON.stringify(t));
    assert.equal(tm.cls, cls, JSON.stringify(t));
    assert.equal(tm.value, value, JSON.stringify(t));
    if (t.state === "grey" && t.grey !== "unverified") assert.ok(!/^\$?0$/.test(tm.value));
    if (t.grey === "unverified") assert.notEqual(tm.word, "OK");
  }
  assert.equal(V.tileModel({ id: "signups", state: "green", value: 300, sub: "at least; prospects" }).value, "at least 300");
  // missing tiles come out as UNAVAILABLE in the fixed order
  const ts = V.tilesModel([{ id: "sales", state: "green", value: 2, label: "Sales, 7 days" }]);
  assert.deepEqual(ts.map((t) => t.id), V.TILE_ORDER);
  assert.equal(ts.filter((t) => t.word === "UNAVAILABLE").length, 7);
});

test("P2-4 ek codes and fail kinds map to their fixed sentences", () => {
  const want = {
    owner_name_gate: "The engine's privacy guard stopped this town's rows (a parser fix is needed; nothing was published)",
    access_controlled: "Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself.",
    no_rows: "Returned no rows",
    timeout: "The town's site timed out",
    http_error: "The town's site returned an error",
    parse: "The town's page changed shape (parser)",
    other: "Failed (the reason is not shown on this page)",
  };
  for (const [k, v] of Object.entries(want)) assert.equal(V.ekSentence(k), v);
  assert.equal(V.ekSentence("brand_new_code"), want.other);
  assert.equal(V.ekSentence(undefined), want.other);
  assert.ok(V.ekSentence("access_controlled").includes("do not retry"));
  assert.equal(V.failKindWord("crash"), "crashed");
  assert.equal(V.failKindWord("gate"), "stopped by its quality gate");
  assert.equal(V.failKindWord("unknown"), "failed");
  assert.equal(V.failKindWord("zzz"), "failed");
  assert.equal(m.data.BLOCKED_SENTENCE, want.access_controlled, "the page and the route agree");
});

test("P2-4 hostile strings stay plain text values", async () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const nm = V.needsModel([{ id: "sources_down", severity: "amber", text: hostile, where: hostile }]);
  assert.equal(nm.urgent[0].text, hostile);
  const tm = V.tileModel({ id: "paying", label: hostile, state: "green", value: 1, sub: hostile });
  assert.equal(tm.label, hostile);
  // and render puts it into a text node, never markup (the fake DOM's sinks throw)
  const doc = H.fakeDocument();
  const root = doc.body.appendChild(doc.createElement("div"));
  const main = { status: 200, body: { ok: true, signed_in_as: "owner@example.com", headline: { state: "amber", text: hostile },
    tiles: [{ id: "paying", label: hostile, state: "green", value: 1, sub: hostile }],
    needs_you: [{ id: "sources_down", severity: "amber", text: hostile, where: hostile }], detail: {} } };
  m.render.render(root, { main }, { now: NOW });
  assert.equal(H.byAttr(root, "data-part", "headline")[0].textContent, hostile);
  assert.equal(H.find(root, (n) => n.localName === "img").length, 0);
});

test("P2-4 known lines render only in the Known, not new group, never red or amber, never the headline", async () => {
  const w = await H.quietWorld(NOW);
  const res = await get(w);
  const mm = V.mainModel(res);
  assert.equal(mm.headline.text, "Nothing is wrong that this page can see.");
  assert.equal(mm.headline.cls, "st-ok");
  assert.equal(mm.needs.urgent.length, 0);
  assert.equal(mm.needs.known.length, 9);
  assert.equal(mm.needs.knownTitle, "Known, not new (9)");
  for (const l of mm.needs.known) assert.equal(l.cls, "st-known");
  const doc = H.fakeDocument();
  const root = doc.body.appendChild(doc.createElement("div"));
  m.render.render(root, { main: res }, { now: NOW });
  assert.equal(H.byAttr(root, "data-part", "headline")[0].textContent, "Nothing is wrong that this page can see.");
  const known = H.byAttr(root, "data-known");
  assert.equal(known.length, 9);
  for (const k of known) {
    assert.ok(!H.hasClass(k, "st-act") && !H.hasClass(k, "st-watch"));
    let n = k;
    while (n && n.localName !== "details") n = n.parentNode;
    assert.ok(n, "inside the collapsed group");
    assert.equal(n.hasAttribute("open"), false);
  }
  assert.equal(H.byAttr(root, "data-need").length, 0);
});

test("P2-4 D18 payload: coverage and count null -> no throw, refresh tile red, 'not reported', never 0", async () => {
  const now = H.T("2026-09-28T15:00:00Z"); // a Monday
  const w = await H.healthyWorld(now, { mondayLog: false, ranAt: H.T("2026-09-28T14:10:00Z") });
  w.status = H.crashedStatus(H.T("2026-09-28T14:10:00Z"));
  w.save({ runs_unscored: 1, last_unscored_at: "2026-09-28T14:10:00.000Z", last_unscored_why: "refresh crashed" });
  const res = await get(w);
  assert.equal(res.status, 200);
  assert.equal(res.body.detail.refresh.coverage, null);
  assert.equal(res.body.detail.refresh.count, null);
  const mm = V.mainModel(res);
  const rt = mm.tiles.find((t) => t.id === "refresh");
  assert.equal(rt.word, "ACT");
  assert.equal(rt.cls, "st-act");
  assert.notEqual(rt.value, "0");
  const map = await get(w, { query: "?view=map" });
  const geo = { status: 200, body: JSON.parse(read("admin/mission-towns.json")) };
  const sec = V.detailsModel(res.body, V.mapModel(map, geo)).find((s) => s.id === "refresh");
  const facts = Object.fromEntries(sec.blocks[0].rows);
  assert.equal(facts.Rows, "not reported");
  assert.equal(facts.Coverage, "not reported");
  assert.equal(facts.Result, "crashed");
  const doc = H.fakeDocument();
  const root = doc.body.appendChild(doc.createElement("div"));
  m.render.render(root, { main: res, map, towns: geo }, { now });
  assert.equal(H.byAttr(root, "data-part", "headline")[0].textContent, res.body.headline.text);
});

test("P2-4 map: legend counts match the payload; unknown code -> Not covered; list grouped; sheet facts", async () => {
  const outreach = { version: 1, towns: { Adams: { outreach: "sent", since: "2026-09-21" }, Ashfield: { outreach: "planned" } } };
  const w = await H.quietWorld(NOW);
  w.r2.set("admin/outreach.json", outreach);
  const map = await get(w, { query: "?view=map" });
  const geo = { status: 200, body: JSON.parse(read("admin/mission-towns.json")) };
  const mm = V.mapModel(map, geo);
  assert.equal(mm.kind, "ok");
  for (const l of mm.legend) assert.equal(l.count, map.body.counts[l.code], l.code);
  assert.equal(mm.legend.reduce((a, l) => a + l.count, 0), 351);
  assert.deepEqual(mm.legend.map((l) => l.label), ["Stale or dead source", "Live, weekly", "Live, monthly or slower",
    "Outreach answered", "Outreach sent", "Locked behind OpenGov", "Not covered"]);
  assert.equal(mm.groups.reduce((a, g) => a + g.towns.length, 0), 351);
  assert.equal(mm.fills.Ashfield.planned, true);
  assert.equal(mm.fills.Ashfield.code, "none", "planned only outlines");
  // an unknown code is never a live colour
  const odd = JSON.parse(JSON.stringify(map));
  odd.body.towns.Adams = { k: "glowing" };
  const om = V.mapModel(odd, geo);
  assert.equal(om.fills.Adams.code, "none");
  assert.equal(V.townSheet("Adams", om, geo).rows[0][1], "Not covered");
  // sheet facts come from the payload only
  const blocked = w.names.blocked;
  const sh = V.townSheet(blocked, mm, geo);
  assert.equal(sh.rows[0][1], "Stale or dead source");
  assert.ok(sh.rows.some(([k, v]) => k === "Why it failed" && v.includes("do not retry")));
  const adams = V.townSheet("Adams", mm, geo);
  assert.ok(adams.rows.some(([k, v]) => k === "Outreach" && v === "Sent"));
  // a failed map view or geometry -> the fixed sentence, no colours
  assert.equal(V.mapModel({ status: 503, body: { error: "unavailable" } }, geo).kind, "failed");
  assert.equal(V.mapModel(map, { status: 0, body: null }).kind, "failed");
});

test("P2-4 render: list view, sheet open and close, edit buttons only with outreach_edit", async () => {
  const w = await H.quietWorld(NOW);
  const main = await get(w);
  const map = await get(w, { query: "?view=map" });
  const geo = { status: 200, body: JSON.parse(read("admin/mission-towns.json")) };
  const doc = H.fakeDocument();
  H.parseInto(doc, read("admin/mission.html").split("<body>")[1]);
  const root = doc.getElementById("mc-root");
  const edits = [];
  const draw = (body) => m.render.render(root, { main: { status: 200, body }, map, towns: geo },
    { now: NOW, onEdit: (t, v) => { edits.push([t, v]); return "Saved."; }, setup: doc.getElementById("mc-setup") });
  draw(main.body);
  assert.equal(H.find(root, (n) => n.localName === "path" && n.hasAttribute("data-town")).length, 351);
  const svg = H.find(root, (n) => n.localName === "svg")[0];
  assert.equal(svg.getAttribute("role"), "img");
  assert.ok(svg.getAttribute("aria-label").startsWith("Map of 351 Massachusetts towns"));
  assert.equal(svg.hasAttribute("tabindex"), false, "the map adds no tab stop per town");
  const toggle = H.find(root, (n) => n.localName === "button" && n.textContent === "Show as list")[0];
  const list = H.byAttr(root, "data-part", "town-list")[0];
  assert.equal(list.hidden, true);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(list.hidden, false);
  const btn = H.find(list, (n) => n.localName === "button" && n.textContent === "Adams")[0];
  btn.click();
  let sheet = H.byAttr(root, "data-part", "sheet")[0];
  assert.equal(sheet.getAttribute("role"), "dialog");
  assert.equal(doc.activeElement.textContent, "Close");
  assert.equal(H.find(sheet, (n) => n.localName === "button" && n.textContent === "Sent").length, 0, "editor off");
  sheet.dispatch("keydown", { key: "Escape" });
  assert.equal(H.byAttr(root, "data-part", "sheet").length, 0);
  assert.equal(doc.activeElement, btn, "focus returns");
  // tapping a path opens the same sheet
  const path = H.find(root, (n) => n.localName === "path" && n.getAttribute("data-town") === "Boston")[0];
  path.dispatch("click");
  sheet = H.byAttr(root, "data-part", "sheet")[0];
  assert.equal(H.find(sheet, (n) => n.localName === "h3")[0].textContent, "Boston");
  // with outreach_edit: buttons, and onEdit gets {town, outreach}
  draw({ ...main.body, outreach_edit: true });
  H.find(root, (n) => n.localName === "path" && n.getAttribute("data-town") === "Adams")[0].dispatch("click");
  sheet = H.byAttr(root, "data-part", "sheet")[0];
  H.find(sheet, (n) => n.localName === "button" && n.textContent === "Sent")[0].click();
  H.find(sheet, (n) => n.localName === "button" && n.textContent === "Clear")[0].click();
  assert.deepEqual(edits, [["Adams", "sent"], ["Adams", null]]);
  // header, attribution, footer links
  assert.equal(H.byAttr(root, "data-part", "signed-in")[0].textContent, "Signed in as owner@example.com");
  assert.ok(root.textContent.includes("Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024"));
  assert.deepEqual(H.find(root, (n) => n.localName === "a" && n.parentNode.localName === "p").map((a) => a.getAttribute("href"))
    .filter((h) => h.startsWith("/admin/")), ["/admin/pipeline", "/admin/now"]);
});

test("P2-4 page order and the error states", async () => {
  const w = await H.quietWorld(NOW);
  const main = await get(w);
  const doc = H.fakeDocument();
  H.parseInto(doc, read("admin/mission.html").split("<body>")[1]);
  const root = doc.getElementById("mc-root");
  const setup = doc.getElementById("mc-setup");
  m.render.render(root, { main }, { now: NOW, setup });
  const top = root.children.map((n) => n.localName);
  assert.deepEqual(top, ["header", "main", "footer"]);
  const order = H.find(root, (n) => n.localName === "h2").map((n) => n.textContent);
  assert.deepEqual(order, ["Towns", "Needs you", "Details"]);
  assert.equal(H.byAttr(root, "data-part", "map-message")[0].textContent, "Loading the map…");
  assert.deepEqual(H.byAttr(root, "data-section").map((n) => n.getAttribute("data-section")),
    ["customers", "renewals", "monday", "refresh", "sales", "outreach", "cannot", "setup"]);
  assert.deepEqual(H.find(root, (n) => n.localName === "summary").map((n) => n.textContent).slice(1),
    ["Customers", "Renewals and failed payments", "Monday delivery", "Data refresh", "Sales and signups", "Outreach",
      "What this page cannot see", "Setup"]);
  const msg = (resp) => {
    m.render.render(root, { main: resp }, { now: NOW, setup });
    const p = H.byAttr(root, "data-part", "message")[0];
    return p ? p.textContent : null;
  };
  assert.equal(msg({ status: 403, body: { error: "unauthorized", reason: "not-configured" } }), null);
  assert.equal(setup.hidden, false);
  assert.equal(H.byAttr(root, "data-tile").length, 0);
  assert.equal(msg({ status: 403, body: { error: "unauthorized", reason: "not-owner" } }),
    "Not signed in as the owner. Reload to sign in again.");
  assert.equal(setup.hidden, true);
  for (const r of [{ status: 503, body: { error: "unavailable" } }, { status: 400, body: { error: "bad_param" } },
    { status: 200, body: null }, { status: 0, body: null }]) {
    assert.equal(msg(r), "Could not read the data. Reload; if it stays, check /admin/pipeline.");
  }
  assert.equal(msg(undefined), "Loading");
});

// ── P2-7 ────────────────────────────────────────────────────────────────────
export const weight = {};
test("P2-7 page weight <= 45 KB", () => {
  let total = 0;
  for (const f of PAGE) {
    weight[f] = fs.statSync(path.join(H.REPO, f)).size;
    total += weight[f];
  }
  weight.total = total;
  if (process.env.MISSION_TABLE) console.log("WEIGHT " + JSON.stringify(weight));
  assert.ok(total <= 45 * 1024, "page files " + total);
});

// ── P2-11 contrast ──────────────────────────────────────────────────────────
function tokens(block) {
  const out = {};
  for (const mm of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) out[mm[1]] = mm[2].toLowerCase();
  return out;
}
function blockAfter(css, head) {
  const at = css.indexOf(head);
  assert.ok(at >= 0, head);
  const open = css.indexOf("{", at + head.length - 1);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const contrast = {};
test("P2-11 contrast: text >= 4.5:1 and state marks >= 3:1 on their surfaces, light and dark", () => {
  const css = read("admin/mission-app.css");
  const light = tokens(blockAfter(css, ":root {"));
  const darkAttr = tokens(blockAfter(css, ':root[data-theme="dark"] {'));
  const darkMedia = tokens(blockAfter(css, ':root:not([data-theme="light"]) {'));
  assert.deepEqual(darkMedia, darkAttr, "the two dark blocks agree");
  for (const [name, t] of [["light", light], ["dark", darkAttr]]) {
    contrast[name] = {};
    for (const surf of ["bg", "surface", "surface-2"]) {
      for (const fg of ["text", "muted", "accent"]) {
        const r = ratio(t[fg], t[surf]);
        contrast[name][fg + "/" + surf] = Math.round(r * 100) / 100;
        assert.ok(r >= 4.5, name + " " + fg + " on " + surf + " " + r.toFixed(2));
      }
    }
    for (const mk of ["ok", "watch", "act", "grey"]) {
      const r = ratio(t[mk], t.surface);
      contrast[name][mk + "/surface"] = Math.round(r * 100) / 100;
      assert.ok(r >= 3, name + " mark " + mk + " " + r.toFixed(2));
    }
    // focus ring (the accent) against the page and the cards
    assert.ok(ratio(t.accent, t.bg) >= 3 && ratio(t.accent, t.surface) >= 3);
  }
  if (process.env.MISSION_TABLE) console.log("CONTRAST " + JSON.stringify(contrast));
});
