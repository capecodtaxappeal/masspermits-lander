// P2-2, P2-3, P2-4, P2-5, P2-7, P2-11, P2-12: the page files, their view
// model and renderer (in the fake DOM), the _headers block, page weight,
// colour contrast, and branch hygiene.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, get } = await H.setup();
const V = m.view;
const R = m.render;
const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const git = (...a) => execFileSync("git", a, { cwd: H.REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const GEO = JSON.parse(read("admin/mission-towns.json"));
const PAGE = ["admin/mission.html", "admin/mission-app.js", "admin/mission-render.js", "admin/mission-view.js",
  "admin/mission-app.css"];
const ALL_PAGE = [...PAGE, "admin/mission-towns.json"];

function renderIn(data, opts = {}) {
  const doc = H.fakeDom();
  const root = doc.createElement("div");
  root.setAttribute("id", "mission-root");
  doc.body.appendChild(root);
  const setup = doc.createElement("section");
  setup.hidden = true;
  doc.body.appendChild(setup);
  R.render(root, data, { setup, now: H.T("2026-09-30T18:00:00Z"), ...opts });
  return { doc, root, setup };
}

async function pair(w, o = {}) {
  const a = await get(w, o);
  const b = await get(w, { ...o, query: "?view=map" });
  return { main: { status: a.status, body: a.body }, map: { status: b.status, body: b.body }, towns: GEO };
}

// ── P2-2 ──────────────────────────────────────────────────────────────────
test("P2-2 geometry is a byte copy (SHA-256) with 351 towns; the editor's towns are its keys", () => {
  const buf = fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"));
  assert.equal(createHash("sha256").update(buf).digest("hex"),
    "e8df13d21be725a5fb3403815da92970d3ab737770cbbcc423ee1cf4fdb9f303");
  assert.equal(buf.length, 61330);
  assert.equal(Object.keys(GEO.towns).length, 351);
  assert.deepEqual([...m.data.TOWN_KEYS], Object.keys(GEO.towns));
  const src = read("functions/admin/api/mission-outreach.js");
  assert.match(src, /const TOWNS = new Set\(TOWN_KEYS\);/);
  assert.match(src, /import \{ TOWN_KEYS \} from "\.\.\/\.\.\/api\/_mission_data\.js";/);
});

// ── P2-3 ──────────────────────────────────────────────────────────────────
test("P2-3 page grep: no DOM sinks, no storage, no inline script or style, robots meta, attribution", () => {
  const sinks = [/innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /eval\(/, /new Function/,
    /setAttribute\(\s*["']style/, /setAttribute\(\s*["']on/];
  const storage = [/localStorage/, /sessionStorage/, /indexedDB/, /caches\./, /serviceWorker/, /document\.cookie/];
  for (const f of ALL_PAGE) {
    const src = read(f);
    for (const re of [...sinks, ...storage]) assert.ok(!re.test(src), f + " " + re);
  }
  const html = read("admin/mission.html");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][2].trim(), "", "no inline script body");
  assert.match(scripts[0][1], /^ type="module" src="\/admin\/mission-app\.js"$/);
  assert.ok(!/\sstyle\s*=/i.test(html), "style=");
  assert.ok(!/<style\b/i.test(html), "<style>");
  assert.ok(!/<script[^>]+src="https?:/i.test(html));
  assert.ok(!/\/api\/hit\b|beacon/i.test(html), "hit beacon");
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.ok(html.includes('<meta name="viewport"'));
  assert.equal((html.match(/<link rel="stylesheet" href="\/admin\/mission-app\.css">/g) || []).length, 1);
  assert.equal((html.match(/<link\b/g) || []).length, 1);
  assert.ok(!/@font-face|@import|url\(/.test(read("admin/mission-app.css")), "no font file, no import, no url()");
  assert.ok(read("admin/mission-view.js").includes('"Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024"'));
  for (const f of ["admin/mission-render.js", "admin/mission-view.js"]) {
    for (const re of [/fetch\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/]) {
      assert.ok(!re.test(read(f)), f + " " + re);
    }
    assert.ok(!/\b(setTimeout|setInterval|requestAnimationFrame)\b/.test(read(f)), f + " timer");
  }
  const fetchers = PAGE.filter((f) => /fetch\(/.test(read(f)));
  assert.deepEqual(fetchers, ["admin/mission-app.js"]);
  assert.ok(!/document|window/.test(read("admin/mission-view.js").replace(/\/\/.*$/gm, "")), "view is pure");
});

// ── P2-4: the view model ──────────────────────────────────────────────────
test("P2-4 every tile state maps to a word and a class; colour is never alone", () => {
  const cases = [
    [{ state: "green" }, "OK", "s-green"], [{ state: "amber" }, "WATCH", "s-amber"], [{ state: "red" }, "ACT", "s-red"],
    [{ state: "grey", grey: "not-connected" }, "NOT CONNECTED", "s-grey"],
    [{ state: "grey", grey: "unavailable" }, "UNAVAILABLE", "s-grey"],
    [{ state: "grey", grey: "unverified" }, "UNVERIFIED", "s-grey"],
    [{ state: "grey", grey: "pending" }, "NOT YET", "s-grey"],
    [{ state: "grey", grey: "zzz" }, "UNAVAILABLE", "s-grey"], [{ state: "purple" }, "UNAVAILABLE", "s-grey"], [{}, "UNAVAILABLE", "s-grey"],
  ];
  for (const [t, word, cls] of cases) {
    const v = V.tileView({ id: "paying", value: 3, ...t });
    assert.equal(v.word, word, JSON.stringify(t));
    assert.equal(v.cls, cls, JSON.stringify(t));
    assert.ok(v.aria.includes(word));
  }
});

test("P2-4 grey tiles never render 0 or $0; unverified shows its count beside UNVERIFIED; pending is NOT YET", () => {
  for (const id of V.TILE_ORDER) {
    for (const grey of ["not-connected", "unavailable", "pending"]) {
      for (const value of [0, null, 5]) {
        const v = V.tileView({ id, state: "grey", grey, value });
        assert.ok(!/^\$?0(\.00)?$/.test(v.value) && v.value === "—", id + " " + grey + " " + v.value);
      }
    }
  }
  const u = V.tileView({ id: "failed", state: "grey", grey: "unverified", value: 0 });
  assert.equal(u.value, "0");
  assert.equal(u.word, "UNVERIFIED");
  assert.equal(V.tileView({ id: "monday", state: "grey", grey: "pending", value: null }).word, "NOT YET");
  assert.equal(V.tileView({ id: "revenue", state: "green", value: 12700 }).value, "$127.00");
  assert.equal(V.tileView({ id: "revenue", state: "green", value: 1234567 }).value, "$12,345.67");
  // a missing tile becomes UNAVAILABLE in its fixed place
  const tiles = V.tilesView([{ id: "paying", state: "green", value: 1 }]);
  assert.deepEqual(tiles.map((t) => t.id), V.TILE_ORDER);
  assert.equal(tiles[1].word, "UNAVAILABLE");
});

test("P2-4 legend counts match the map payload; an unknown code is Not covered, never a live colour", async () => {
  const now = H.T("2026-09-30T18:00:00Z");
  const w = await H.quietWorld(now);
  const d = await pair(w);
  const mm = V.mapModel(d.map, GEO);
  assert.equal(mm.kind, "ok");
  for (const l of mm.legend) assert.equal(l.count, d.map.body.counts[l.code], l.code);
  assert.equal(mm.total, 351);
  assert.deepEqual(mm.legend.map((l) => l.text), ["Stale or dead source", "Live, weekly", "Live, monthly or slower",
    "Outreach answered", "Outreach sent", "Locked behind OpenGov", "Not covered"]);
  const bogus = { ...d.map.body, towns: { ...d.map.body.towns, Adams: { k: "live" }, Alford: { k: "__proto__" } } };
  const mb = V.mapModel({ status: 200, body: bogus }, GEO);
  assert.equal(mb.towns.find((t) => t.key === "Adams").code, "none");
  assert.equal(mb.towns.find((t) => t.key === "Alford").code, "none");
  assert.equal(V.townFacts("Adams", { k: "live" })[1][1], "Not covered");
  const { root } = renderIn({ main: d.main, map: { status: 200, body: bogus }, towns: GEO });
  const adams = root.findAll((n) => n.getAttribute("data-town") === "Adams")[0];
  assert.equal(adams.getAttribute("class"), "town m-none");
  // the list view groups by the same codes and counts
  const groups = V.listGroups(mm);
  for (const g of groups) assert.equal(g.count, d.map.body.counts[g.code]);
});

test("P2-4 every ek code and fail_kind has its fixed sentence; unknown ek -> the other sentence", () => {
  const want = {
    owner_name_gate: "The engine's privacy guard stopped this town's rows (a parser fix is needed; nothing was published)",
    access_controlled: "Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself.",
    no_rows: "Returned no rows", timeout: "The town's site timed out", http_error: "The town's site returned an error",
    parse: "The town's page changed shape (parser)", other: "Failed (the reason is not shown on this page)",
  };
  for (const [k, s] of Object.entries(want)) assert.equal(V.ekSentence(k), s);
  assert.equal(V.ekSentence("zzz"), want.other);
  assert.equal(V.ekSentence(undefined), want.other);
  assert.equal(V.ekSentence("__proto__"), want.other);
  assert.ok(V.ekSentence("access_controlled").includes("do not retry"));
  assert.equal(V.ekSentence("access_controlled"), m.data.BLOCKED_SENTENCE);
  assert.equal(V.failSentence("crash"), "crashed");
  assert.equal(V.failSentence("gate"), "stopped by its quality gate");
  assert.equal(V.failSentence("unknown"), "failed");
  assert.equal(V.failSentence("zzz"), "failed");
});

const HOSTILE = "<img src=x onerror=alert(1)>";

test("P2-4 hostile strings pass through as plain text values", () => {
  const p = V.personView({ name: HOSTILE, email_masked: "<b>x</b>", status: "<script>" });
  assert.equal(p.name, HOSTILE);
  const { root } = renderIn({
    main: { status: 200, body: { ok: true, now: "2026-09-30T18:00:00.000Z", signed_in_as: "owner@example.com",
      headline: { state: "red", text: HOSTILE }, tiles: [{ id: "paying", state: "red", value: 1, sub: HOSTILE, label: HOSTILE }],
      needs_you: [{ id: "x", severity: "red", text: HOSTILE, where: HOSTILE }],
      detail: { customers: { count: 1, rows: [{ name: HOSTILE, email_masked: HOSTILE }] } } } },
    map: { status: 503, body: { error: "unavailable" } }, towns: GEO,
  });
  assert.equal(root.byRole("headline")[0].textContent, HOSTILE);
  assert.equal(root.byRole("need-text")[0].textContent, HOSTILE);
  // nothing named img or script was ever created
  assert.equal(root.findAll((n) => ["IMG", "SCRIPT", "B"].includes(n.tagName)).length, 0);
});

test("P2-4 known lines render only in the Known, not new group, never red or amber, never the headline", async () => {
  const now = H.T("2026-09-30T18:00:00Z");
  const w = await H.quietWorld(now);
  const d = await pair(w);
  const nv = V.needsView(d.main.body.needs_you);
  assert.equal(nv.urgent.length, 0);
  assert.equal(nv.known.length, 9);
  assert.equal(nv.knownTitle, "Known, not new (9)");
  for (const k of nv.known) assert.equal(k.cls, "s-known");
  const { root } = renderIn(d);
  // P1-15 Q1: the page's headline
  assert.equal(root.byRole("headline")[0].textContent, "Nothing is wrong that this page can see.");
  assert.equal(root.byRole("need").length, 0);
  const rows = root.byRole("known");
  assert.equal(rows.length, 9);
  for (const r of rows) {
    assert.ok(!/s-red|s-amber/.test(r.getAttribute("class")));
    let n = r;
    while (n && n.tagName !== "DETAILS") n = n.parentNode;
    assert.ok(n, "inside a <details>");
    assert.equal(n.findAll((x) => x.tagName === "SUMMARY")[0].textContent, "Known, not new (9)");
  }
  // tiles: paying OK, failed UNVERIFIED with its 0, revenue NOT CONNECTED
  const words = root.byRole("tile-word").map((n) => n.textContent);
  assert.deepEqual(words, ["OK", "NOT CONNECTED", "NOT CONNECTED", "UNVERIFIED", "OK", "OK", "OK", "OK"]);
  const vals = root.byRole("tile-value").map((n) => n.textContent);
  assert.equal(vals[1], "—");
  assert.equal(vals[3], "0");
  assert.equal(root.byRole("signed-in")[0].textContent, "Signed in as owner@example.com");
  assert.equal(root.findAll((n) => n.hasAttribute("data-town")).length, 351);
  assert.equal(root.byRole("attribution")[0].textContent, "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024");
  // a mixed list: red first, then amber, known only in the group
  const mix = V.needsView([{ id: "k", severity: "known", text: "k" }, { id: "a", severity: "amber", text: "a" },
    { id: "r", severity: "red", text: "r" }]);
  assert.deepEqual(mix.urgent.map((l) => l.id), ["r", "a"]);
  assert.deepEqual(mix.known.map((l) => l.id), ["k"]);
});

test("P2-4 D18 payload (coverage null, count null): no throw, refresh red, not reported instead of 0", async () => {
  const now = H.T("2026-09-28T15:00:00Z");
  const ranAt = H.T("2026-09-28T14:10:00Z");
  const w = await H.healthyWorld(now, { ranAt: ranAt - H.DAY });
  w.status = H.crashedStatus(ranAt);
  w.statusUploaded = ranAt;
  w.save({ runs_unscored: 1, last_unscored_at: new Date(ranAt).toISOString(), last_unscored_why: "refresh crashed" });
  const d = await pair(w);
  assert.equal(d.main.body.detail.refresh.coverage, null);
  assert.equal(d.main.body.detail.refresh.count, null);
  const mm = V.mainModel(d.main);
  assert.equal(mm.tiles.find((t) => t.id === "refresh").word, "ACT");
  assert.equal(mm.tiles.find((t) => t.id === "refresh").cls, "s-red");
  const sec = V.detailsView(mm, V.mapModel(d.map, GEO)).find((s) => s.id === "refresh");
  const kv = Object.fromEntries(sec.blocks[0].rows);
  assert.equal(kv.Coverage, "not reported");
  assert.equal(kv.Rows, "not reported");
  assert.equal(kv.Result, "crashed");
  const { root } = renderIn(d);
  const det = root.findAll((n) => n.getAttribute("class") === "det det-refresh")[0];
  const pairs = det.findAll((n) => n.getAttribute("class") === "kv-r").map((r) => r.childNodes.map((c) => c.textContent));
  assert.deepEqual(pairs.find((p) => p[0] === "Coverage"), ["Coverage", "not reported"]);
  assert.deepEqual(pairs.find((p) => p[0] === "Rows"), ["Rows", "not reported"]);
});

test("P2-4 error responses: setup block, not-owner and could-not-read sentences; map failure alone", async () => {
  const s = renderIn({ main: { status: 403, body: { error: "unauthorized", reason: "not-configured" } },
    map: { status: 403, body: { error: "unauthorized", reason: "not-configured" } }, towns: GEO });
  assert.equal(s.setup.hidden, false);
  assert.equal(s.root.findAll((n) => n.hasAttribute("data-tile")).length, 0);
  const d = renderIn({ main: { status: 403, body: { error: "unauthorized", reason: "not-owner" } } });
  assert.equal(d.root.byRole("message")[0].textContent, "Not signed in as the owner. Reload to sign in again.");
  for (const main of [{ status: 503, body: { error: "unavailable" } }, { status: 400, body: null }, { status: 0, body: null }]) {
    const e = renderIn({ main });
    assert.equal(e.root.byRole("message")[0].textContent, "Could not read the data. Reload; if it stays, check /admin/pipeline.");
    assert.equal(e.setup.hidden, true);
  }
  const now = H.T("2026-09-30T18:00:00Z");
  const w = await H.healthyWorld(now);
  const dd = await pair(w);
  const x = renderIn({ ...dd, map: { status: 503, body: { error: "unavailable" } } });
  assert.equal(x.root.findAll((n) => n.hasAttribute("data-tile")).length, 8);
  assert.equal(x.root.byRole("map-message")[0].textContent, "The map could not load. Reload.");
  assert.equal(x.root.byRole("list-toggle").length, 0);
  const g = renderIn({ ...dd, towns: null });
  assert.equal(g.root.byRole("map-message")[0].textContent, "The map could not load. Reload.");
  const loading = renderIn({ main: dd.main });
  assert.equal(loading.root.byRole("map-message")[0].textContent, "Loading the map");
});

test("P2-4 town sheet: a tap opens it, Escape and Close close it, focus returns; the map adds no tab stop", async () => {
  const now = H.T("2026-09-30T18:00:00Z");
  const w = await H.quietWorld(now);
  const d = await pair(w);
  const { doc, root } = renderIn(d);
  const svg = root.byRole("map")[0];
  assert.equal(svg.getAttribute("tabindex"), null);
  assert.ok(svg.getAttribute("aria-label").startsWith("Map of 351 towns: "));
  const path0 = svg.findAll((n) => n.getAttribute("data-town") === w.names.blocked)[0];
  path0.click();
  const sheet = root.byRole("sheet")[0];
  assert.equal(sheet.hidden, false);
  assert.ok(sheet.textContent.includes("do not retry"));
  assert.equal(sheet.findAll((n) => n.tagName === "BUTTON").length, 1, "no edit buttons when outreach_edit is false");
  sheet.dispatch("keydown", { key: "Escape" });
  assert.equal(sheet.hidden, true);
  // list view: aria-pressed, each town a button that opens the same sheet, focus returns to it
  const toggle = root.byRole("list-toggle")[0];
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  const btn = root.findAll((n) => n.getAttribute("class") === "tl-b" && n.textContent === "Abington")[0];
  btn.focus();
  btn.click();
  assert.equal(sheet.hidden, false);
  assert.equal(doc.activeElement.textContent, "Close");
  doc.activeElement.click();
  assert.equal(sheet.hidden, true);
  assert.equal(doc.activeElement, btn);
});

test("P2-4 editor buttons appear only when outreach_edit is true and call onEdit(town, state)", async () => {
  const now = H.T("2026-09-30T18:00:00Z");
  const w = await H.healthyWorld(now);
  const d = await pair(w, { env: { MISSION_OUTREACH_EDIT: "1" } });
  assert.equal(d.main.body.outreach_edit, true);
  const calls = [];
  const { root } = renderIn(d, { onEdit: (t, s) => { calls.push([t, s]); return "Saved."; } });
  root.findAll((n) => n.getAttribute("data-town") === "Adams")[0].click();
  const sheet = root.byRole("sheet")[0];
  const labels = sheet.findAll((n) => n.tagName === "BUTTON").map((b) => b.textContent);
  assert.deepEqual(labels, ["Close", "planned", "sent", "answered", "declined", "clear"]);
  sheet.findAll((n) => n.tagName === "BUTTON" && n.textContent === "clear")[0].click();
  sheet.findAll((n) => n.tagName === "BUTTON" && n.textContent === "sent")[0].click();
  assert.deepEqual(calls, [["Adams", null], ["Adams", "sent"]]);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(sheet.textContent.includes("Saved."));
});

test("P2-4 section order: header, headline, tiles, map, needs you, details (in PAGE order), footer", async () => {
  const now = H.T("2026-09-30T18:00:00Z");
  const w = await H.quietWorld(now);
  const { root } = renderIn(await pair(w));
  const top = root.childNodes.map((n) => n.tagName);
  assert.deepEqual(top, ["HEADER", "MAIN", "FOOTER", "DIV"]);
  const main = root.childNodes[1].children.map((n) => n.getAttribute("class"));
  assert.deepEqual(main, ["headline s-green", "tiles", "sec sec-map", "sec sec-needs", "sec sec-details"]);
  const titles = root.findAll((n) => n.getAttribute("class") === "det-h").map((n) => n.textContent);
  assert.deepEqual(titles, ["Customers", "Renewals and failed payments", "Monday delivery", "Data refresh",
    "Sales and signups", "Outreach", "What this page cannot see", "Setup"]);
  const links = root.childNodes[2].findAll((n) => n.tagName === "A").map((a) => a.getAttribute("href"));
  assert.deepEqual(links, ["/admin/pipeline", "/admin/now"]);
  assert.equal(root.findAll((n) => n.tagName === "H1").length, 1);
});

test("P2-4 dates display in America/New_York; money has two decimals and separators", () => {
  assert.equal(V.fmtTime("2026-09-30T14:20:00.000Z"), "Sep 30, 10:20 AM");
  assert.equal(V.fmtStamp("2026-12-01T14:20:00.000Z"), "12/1 9:20 AM");
  assert.equal(V.fmtDay("2026-09-28"), "Sep 28, 2026");
  assert.equal(V.fmtDay("2026-10-01T02:00:00.000Z"), "Sep 30, 2026");
  assert.equal(V.fmtMoney(1234567, "usd"), "$12,345.67");
  assert.equal(V.fmtMoney(null, "usd"), "—");
});

// ── P2-5 ──────────────────────────────────────────────────────────────────
test("P2-5 _headers gains exactly the one block, outside the widget block", () => {
  const BLOCK = ["/admin/mission",
    "  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "  X-Frame-Options: DENY", "  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet",
    "  Referrer-Policy: no-referrer", "  Cache-Control: private, no-store"];
  let base = null;
  for (const ref of ["origin/claude/mission-control", "origin/main"]) {
    try { base = git("show", ref + ":_headers"); break; } catch (_) { /* next */ }
  }
  assert.ok(base !== null, "no base _headers");
  const now = read("_headers");
  const a = base.split("\n"), b = now.split("\n");
  // every base line is kept, in order; the only new lines are one blank and the block
  let i = 0;
  const added = [];
  for (const line of b) {
    if (i < a.length && line === a[i]) i++;
    else added.push(line);
  }
  assert.equal(i, a.length, "a base line changed");
  assert.deepEqual(added.filter((l) => l !== ""), BLOCK);
  assert.ok(added.filter((l) => l === "").length <= 1);
  const at = b.indexOf("/admin/mission");
  const open = b.findIndex((l) => l.startsWith("# >>> widget tier"));
  const close = b.findIndex((l) => l.startsWith("# <<< widget tier"));
  assert.ok(open >= 0 && close > open && (at < open || at > close), "outside the widget block");
  assert.deepEqual(b.slice(at, at + BLOCK.length), BLOCK);
});

// ── P2-7 ──────────────────────────────────────────────────────────────────
export const weight = {};
test("P2-7 page weight <= 45 KB", () => {
  let total = 0;
  for (const f of PAGE) { weight[f] = fs.statSync(path.join(H.REPO, f)).size; total += weight[f]; }
  weight.total = total;
  assert.ok(total <= 45 * 1024, "page bytes " + total);
});

// ── P2-11: colour tokens and contrast ─────────────────────────────────────
function block(css, selector) {
  const at = css.indexOf(selector + " {");
  assert.ok(at >= 0, "no block " + selector);
  const body = css.slice(at + selector.length + 2, css.indexOf("}", at));
  const out = {};
  for (const mm of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[mm[1]] = mm[2].toLowerCase();
  return out;
}
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const ratios = [];
export function themes() {
  const css = read("admin/mission-app.css");
  const light = block(css, ":root");
  const dark = block(css, ':root[data-theme="dark"]');
  const media = block(css, ':root:not([data-theme="light"])');
  return { light, dark, media };
}

test("P2-11 light and dark tokens: text >= 4.5:1, state marks >= 3:1 on their surfaces", () => {
  const { light, dark, media } = themes();
  assert.deepEqual(media, dark, "prefers-color-scheme dark equals data-theme dark");
  for (const [name, t] of [["light", light], ["dark", dark]]) {
    for (const surf of ["bg", "surface"]) {
      // text: body, muted, links; the state words are text in their colour
      for (const fg of ["text", "muted", "focus", "ok", "watch", "act", "grey", "known"]) {
        const r = contrast(t[fg], t[surf]);
        ratios.push({ theme: name, fg, on: surf, ratio: Math.round(r * 100) / 100, need: 4.5 });
        assert.ok(r >= 4.5, `${name} ${fg} on ${surf}: ${r.toFixed(2)}`);
      }
      // state marks: the coloured edges
      for (const fg of ["ok", "watch", "act", "grey"]) {
        assert.ok(contrast(t[fg], t[surf]) >= 3, `${name} mark ${fg} on ${surf}`);
      }
    }
  }
});

// ── P2-12 ─────────────────────────────────────────────────────────────────
test("P2-12 branch hygiene: only P2 files, test/mission/ and the demo differ from claude/mission-control", () => {
  let base;
  try { base = git("merge-base", "origin/claude/mission-control", "HEAD").trim(); } catch (_) { base = null; }
  assert.ok(base, "origin/claude/mission-control is not fetched");
  const changed = [...new Set([...git("diff", "--name-only", base).split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean))];
  const ok = new Set([...ALL_PAGE, "functions/admin/api/mission-outreach.js", "_headers", "docs/mission/demo.html"]);
  for (const p of changed) assert.ok(ok.has(p) || /^test\/mission\/[A-Za-z0-9_-]+\.(test\.)?mjs$/.test(p), p);
  for (const p of ["functions/api/_owner_gate.js", "functions/api/_mission_r2.js", "functions/api/_mission_stripe.js",
    "functions/api/_mission_data.js", "functions/admin/api/mission.js"]) assert.ok(!changed.includes(p), "P1 file " + p);
});
