// P3-4 speed, P3-6 accessibility and P3-7 empty and error states, on the fake
// DOM. mission-app.js runs from the temp copy with a fetch stub of its own
// that records call order and answers only when the test says so.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as H from "./_harness.mjs";

const { m, get } = await H.setup();
const V = m.view;
const { T } = H;
const NOW = T("2026-09-30T18:00:00Z");
const GEO_TEXT = fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"), "utf8");
const GEO = JSON.parse(GEO_TEXT);
const HTML = fs.readFileSync(path.join(H.REPO, "admin/mission.html"), "utf8");
const BODY = HTML.slice(HTML.indexOf("<body>") + 6, HTML.indexOf("</body>"));
const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// Real route payloads: the healthy world (Stripe unset) and the P1-15 quiet day.
const HW = await H.healthyWorld(NOW);
const MAIN = await get(HW);
const MAPV = await get(HW, { query: "?view=map" });
const QW = await H.quietWorld(NOW);
const QMAIN = await get(QW);
const QMAP = await get(QW, { query: "?view=map" });
assert.equal(MAIN.status, 200);
assert.equal(MAPV.status, 200);

const shown = (root, pred) => root.all((n) => pred(n) && n.isShown());
const tiles = (root) => shown(root, (n) => n.getAttribute("data-tile") !== null);
const words = (root) => root.byPart("word").filter((n) => n.isShown()).map((n) => n.textContent);
const values = (root) => shown(root, (n) => n.className === "value").map((n) => n.textContent);
const lede = (root) => root.byPart("headline-text")[0].textContent;
const cls = (re) => (n) => re.test(n.className);

function renderInto(main, map, towns = { status: 200, json: GEO }, o = {}) {
  const doc = H.fakeDocumentFrom(BODY);
  globalThis.document = doc;
  const root = doc.getElementById("mission");
  const draw = (mm, mp, tw, extra = {}) => m.render.render(root, {
    main: mm && { status: mm.status, json: mm.body }, map: mp && { status: mp.status, json: mp.body }, towns: tw,
  }, { now: NOW, onRefresh() {}, onEdit() {}, inert: true, ...o, ...extra });
  draw(main, map, towns);
  return { doc, root, draw };
}

// ── mission-app.js with a recording fetch and a recording setTimeout ────────
let runs = 0;
async function bootApp() {
  const doc = H.fakeDocumentFrom(BODY);
  doc.visibilityState = "visible";
  globalThis.document = doc;
  const calls = [];
  const timers = [];
  const realFetch = globalThis.fetch, realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const fakeFetch = (url, init = {}) => new Promise((resolve, reject) => {
    const c = { url, init, done: false,
      answer(status, body) { c.done = true; resolve({ status, json: async () => { if (body === undefined) throw new SyntaxError("not JSON"); return clone(body); } }); },
      fail() { c.done = true; reject(new TypeError("network")); } };
    if (init.signal) init.signal.addEventListener("abort", () => { c.done = true; reject(new Error("aborted")); });
    calls.push(c);
  });
  const fakeSet = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const withFakes = async (f) => {
    globalThis.fetch = fakeFetch; globalThis.setTimeout = fakeSet; globalThis.clearTimeout = () => {};
    try { return await f(); } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
  };
  const url = pathToFileURL(path.join(H.tempCopy(), "admin/mission-app.js")).href + "?run=" + ++runs;
  await withFakes(() => import(url));
  const root = doc.getElementById("mission");
  const pending = (u) => calls.filter((c) => c.url === u && !c.done)[0];
  const refresh = () => withFakes(() => shown(root, cls(/\brefresh\b/))[0].click());
  return { doc, root, calls, timers, pending, refresh, withFakes };
}
const U = { main: "/admin/api/mission", map: "/admin/api/mission?view=map", towns: "/admin/mission-towns.json" };
async function goodLoad(a) {
  a.pending(U.main).answer(200, MAIN.body);
  a.pending(U.map).answer(200, MAPV.body);
  a.pending(U.towns).answer(200, GEO);
  await flush();
}

// ── P3-4 speed ──────────────────────────────────────────────────────────────
test("P3-4 all three requests start before any resolves, each with a 15 s timeout and no other timer", async () => {
  const a = await bootApp();
  assert.deepEqual(a.calls.map((c) => c.url), [U.main, U.map, U.towns]);
  assert.ok(a.calls.every((c) => !c.done), "nothing has resolved yet");
  assert.deepEqual(a.timers.map((t) => t.ms), [15000, 15000, 15000]);
  for (const c of a.calls.slice(0, 2)) {
    assert.equal(c.init.headers["X-MassPermits-Mission"], "1");
    assert.equal(c.init.credentials, "same-origin");
  }
  // shipped source: one setTimeout (the per-request timeout), no polling
  const app = read("admin/mission-app.js");
  assert.equal((app.match(/setTimeout\(/g) || []).length, 1);
  assert.match(app, /const TIMEOUT_MS = 15000;/);
  for (const f of ["admin/mission-app.js", "admin/mission-render.js", "admin/mission-view.js"]) {
    assert.doesNotMatch(read(f), /setInterval|requestAnimationFrame/, f);
  }
  await goodLoad(a);
});

test("P3-4 tiles render from the default view alone; the map area shows a placeholder, never zeros", async () => {
  const a = await bootApp();
  a.pending(U.main).answer(200, MAIN.body);
  await flush();
  assert.equal(tiles(a.root).length, 8);
  assert.deepEqual(words(a.root), V.tilesView(MAIN.body.tiles).map((t) => t.word));
  assert.equal(lede(a.root), V.headlineView(MAIN.body.headline).text);
  const wait = a.root.byPart("map-wait")[0];
  assert.ok(wait && wait.isShown());
  assert.equal(wait.textContent, "Loading the map.");
  assert.equal(a.root.all((n) => n.localName === "path").length, 0);
  assert.equal(a.root.all(cls(/\blegend\b/)).length, 0, "no legend counts while the map is pending");
  assert.equal(a.root.all(cls(/\btoggle\b/)).length, 0);
  // then the map and the geometry land
  a.pending(U.map).answer(200, MAPV.body);
  await flush();
  assert.equal(a.root.byPart("map-wait")[0].textContent, "Loading the map.", "still waiting for the geometry");
  a.pending(U.towns).answer(200, GEO);
  await flush();
  assert.equal(a.root.all((n) => n.getAttribute("data-town") !== null).length, 351);
});

test("P3-4 the SVG is assembled off-document and attached in one step", async () => {
  const appended = [];
  const orig = H.FakeNode.prototype.appendChild;
  const connected = (n) => { for (let x = n; x; x = x.parentNode) if (x === globalThis.document.documentElement) return true; return false; };
  H.FakeNode.prototype.appendChild = function (c) {
    if (c.localName === "path" || c.localName === "svg") appended.push({ tag: c.localName, live: connected(this) });
    return orig.call(this, c);
  };
  try {
    renderInto(MAIN, MAPV);
  } finally {
    H.FakeNode.prototype.appendChild = orig;
  }
  assert.ok(appended.filter((x) => x.tag === "path").length >= 351);
  assert.deepEqual(appended.filter((x) => x.live), [], "no path or svg appended into the live document");
  const doc = globalThis.document;
  assert.equal(doc.getElementById("mission").all((n) => n.getAttribute("data-town") !== null).length, 351);
});

// ── P3-7 empty and error states ─────────────────────────────────────────────
test("P3-7 loading: tiles show Loading, never 0 or $0", async () => {
  const a = await bootApp();
  assert.equal(tiles(a.root).length, 8);
  assert.deepEqual(values(a.root), Array(8).fill("Loading"));
  assert.deepEqual(shown(a.root, cls(/^label$/)).map((n) => n.textContent),
    ["Paying customers", "Revenue, 30 days", "Renewals, 14 days", "Failed payments", "Monday email", "Data refresh",
      "Sales, 7 days", "Signups, 7 days"]);
  for (const v of values(a.root)) assert.doesNotMatch(v, /^\$?0/);
  assert.equal(lede(a.root), "Loading");
  await goodLoad(a);
});

test("P3-7 403 not-configured: the Setup needed block and no tile", async () => {
  const a = await bootApp();
  a.pending(U.main).answer(403, { error: "unauthorized", reason: "not-configured" });
  a.pending(U.map).answer(403, { error: "unauthorized", reason: "not-configured" });
  a.pending(U.towns).answer(200, GEO);
  await flush();
  assert.ok(a.doc.getElementById("setup-needed").isShown());
  assert.equal(tiles(a.root).length, 0);
});

test("P3-7 403 for any other reason: the not-signed-in sentence", async () => {
  for (const reason of ["not-owner", "no-assertion-header", "verify-error", undefined]) {
    const a = await bootApp();
    a.pending(U.main).answer(403, reason ? { error: "unauthorized", reason } : undefined);
    await flush();
    assert.equal(lede(a.root), "Not signed in as the owner. Reload to sign in again.", String(reason));
    assert.equal(tiles(a.root).length, 0);
    assert.ok(!a.doc.getElementById("setup-needed").isShown());
  }
});

test("P3-7 400, 503, a body that is not JSON, a network failure and the 15 s timeout: the could-not-read sentence", async () => {
  const CANNOT = "Could not read the data. Reload; if it stays, check /admin/pipeline.";
  const cases = {
    400: (a) => a.pending(U.main).answer(400, { error: "bad_param" }),
    503: (a) => a.pending(U.main).answer(503, { error: "unavailable" }),
    "not JSON": (a) => a.pending(U.main).answer(200, undefined),
    network: (a) => a.pending(U.main).fail(),
    timeout: (a) => a.timers[0].fn(),
  };
  for (const [name, act] of Object.entries(cases)) {
    const a = await bootApp();
    act(a);
    await flush();
    assert.equal(lede(a.root), CANNOT, name);
    assert.equal(tiles(a.root).length, 0, name);
    for (const c of a.calls.filter((c) => !c.done)) c.answer(503, { error: "unavailable" });
    await flush();
    assert.equal(lede(a.root), CANNOT, name + " (after the rest land)");
  }
});

test("P3-7 a refresh that fails after a good load keeps the earlier render, marked not updated", async () => {
  const a = await bootApp();
  await goodLoad(a);
  const before = words(a.root);
  const head = lede(a.root);
  await a.refresh();
  assert.deepEqual(a.calls.slice(3).map((c) => c.url), [U.main, U.map], "the geometry is kept in memory");
  a.pending(U.main).answer(503, { error: "unavailable" });
  a.pending(U.map).answer(503, { error: "unavailable" });
  await flush();
  assert.deepEqual(words(a.root), before);
  assert.equal(lede(a.root), head);
  const note = a.root.byPart("stale")[0];
  assert.ok(note && note.isShown());
  assert.match(note.textContent, /^Not updated\. Showing data from [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M ET\.$/);
  assert.equal(a.root.all((n) => n.getAttribute("data-town") !== null).length, 351, "the earlier map too");
  // a later good refresh clears the note
  await a.refresh();
  a.pending(U.main).answer(200, MAIN.body);
  a.pending(U.map).answer(200, MAPV.body);
  await flush();
  assert.equal(a.root.byPart("stale").length, 0);
});

test("P3-7 the map view or the geometry failing alone: everything else renders; the map says it could not load", async () => {
  for (const which of ["map", "towns"]) {
    const a = await bootApp();
    a.pending(U.main).answer(200, MAIN.body);
    if (which === "map") { a.pending(U.map).answer(503, { error: "unavailable" }); a.pending(U.towns).answer(200, GEO); }
    else { a.pending(U.map).answer(200, MAPV.body); a.pending(U.towns).answer(404, undefined); }
    await flush();
    assert.equal(tiles(a.root).length, 8, which);
    assert.equal(a.root.byPart("map-failed")[0].textContent, "The map could not load. Reload.");
    assert.equal(a.root.all(cls(/\btoggle\b/)).length, 0, "no list toggle");
    assert.equal(a.root.all((n) => n.localName === "path").length, 0);
    assert.equal(shown(a.root, (n) => n.getAttribute("data-section") !== null).length, 8, "details still render");
    assert.ok(a.root.all(cls(/\bneeds\b/)).length === 1, "needs you still renders");
  }
});

test("P3-7 zero customers: No customers yet., not an empty table", () => {
  const main = clone(MAIN);
  main.body.detail.customers = { ...main.body.detail.customers, count: 0, rows: [], more: 0 };
  const { root } = renderInto(main, MAPV);
  const sec = root.all((n) => n.getAttribute("data-section") === "customers")[0];
  assert.ok(sec.all((n) => n.localName === "p").some((p) => p.textContent === "No customers yet."));
  assert.equal(sec.all((n) => n.localName === "ul").length, 0);
});

test("P3-7 no needs-you line: only the clear headline, no empty Known, not new (0) group", () => {
  const main = clone(MAIN);
  main.body.needs_you = [];
  main.body.headline = { state: "clear", text: "Nothing is wrong that this page can see." };
  const { root } = renderInto(main, MAPV);
  assert.equal(lede(root), "Nothing is wrong that this page can see.");
  assert.equal(root.all(cls(/\bneeds\b/)).length, 0);
  assert.ok(!root.textContent.includes("Known, not new"));
  assert.ok(!root.all((n) => n.localName === "h2").some((h) => h.textContent === "Needs you"));
});

test("P3-7 an unknown tile id, state or grey kind: UNAVAILABLE with no figure, never OK", () => {
  const main = clone(MAIN);
  const t = main.body.tiles;
  t[0] = { ...t[0], state: "purple", value: 5 };
  t[1] = { ...t[1], state: "grey", grey: "mystery", value: 7 };
  t[2] = { ...t[2], id: "martian", state: "green", value: 9 };
  t[3] = { ...t[3], state: undefined, value: 3 };
  for (const x of t.slice(0, 4)) {
    const v = V.tileView(x);
    assert.deepEqual([v.word, v.value, v.cls], ["UNAVAILABLE", "—", "s-grey"], JSON.stringify(x));
  }
  const { root } = renderInto(main, MAPV);
  const ws = words(root);
  assert.equal(ws.filter((w) => w === "UNAVAILABLE").length, 4);
  // the unknown id sorts last; every UNAVAILABLE tile shows no figure
  for (const li of tiles(root)) {
    if (li.byPart("word")[0].textContent === "UNAVAILABLE") assert.equal(li.all(cls(/^value$/))[0].textContent, "—");
  }
  assert.equal(tiles(root).at(-1).getAttribute("data-tile"), "martian");
});

// ── P3-6 accessibility ──────────────────────────────────────────────────────
test("P3-6 one h1, then an h2 per section in page order; header, main and footer landmarks", () => {
  const { root } = renderInto(QMAIN, QMAP);
  assert.equal(shown(root, (n) => n.localName === "h1").length, 1);
  const hs = shown(root, (n) => /^h[1-6]$/.test(n.localName) && n.localName !== "h3").map((n) => n.localName + " " + n.textContent);
  assert.deepEqual(hs, ["h1 Mission Control", "h2 At a glance", "h2 The map", "h2 Needs you", "h2 Customers",
    "h2 Renewals and failed payments", "h2 Monday delivery", "h2 Data refresh", "h2 Sales and signups", "h2 Outreach",
    "h2 What this page cannot see", "h2 Setup"]);
  const app = root.all((n) => n.getAttribute("id") === "app")[0];
  assert.deepEqual(app.children.map((n) => n.localName), ["header", "main", "footer"]);
  for (const l of ["header", "main", "footer"]) assert.equal(root.all((n) => n.localName === l).length, 1, l);
  // the Setup needed block, when shown, is the only content and has its own h2
  assert.match(HTML, /<section id="setup-needed" class="setup" hidden>\n<h2>Setup needed<\/h2>/);
});

test("P3-6 tiles are a list, each with an accessible name such as \"Paying customers: 20, OK\"", () => {
  const { root } = renderInto(QMAIN, QMAP);
  const ul = root.all(cls(/^tiles$/))[0];
  assert.equal(ul.localName, "ul");
  const lis = ul.children;
  assert.equal(lis.length, 8);
  assert.ok(lis.every((li) => li.localName === "li"));
  const views = V.tilesView(QMAIN.body.tiles);
  assert.deepEqual(lis.map((li) => li.getAttribute("aria-label")),
    views.map((v) => v.label + ": " + (v.value === "—" ? "no figure" : v.value) + ", " + v.word));
  assert.equal(lis[0].getAttribute("aria-label"), "Paying customers: 20, OK");
  assert.match(lis[1].getAttribute("aria-label"), /^Revenue, 30 days: no figure, NOT CONNECTED$/);
});

test("P3-6 the headline is one polite live region, kept across renders and updated on refresh", () => {
  const { root, draw } = renderInto(QMAIN, QMAP);
  const live = root.all((n) => n.getAttribute("role") === "status");
  assert.equal(live.length, 1);
  assert.equal(live[0].getAttribute("aria-live"), "polite");
  assert.ok(live[0].byPart("headline-text").length === 1);
  const red = clone(QMAIN);
  red.body.headline = { state: "red", text: "The data refresh crashed." };
  draw(red, QMAP, { status: 200, json: GEO });
  const again = root.all((n) => n.getAttribute("role") === "status");
  assert.equal(again.length, 1);
  assert.equal(again[0], live[0], "the same node");
  assert.equal(lede(root), "The data refresh crashed.");
  assert.match(again[0].className, /\bh-red\b/);
  // an error keeps the region and says so there
  draw({ status: 503, body: { error: "unavailable" } }, null, null);
  assert.equal(root.all((n) => n.getAttribute("role") === "status")[0], live[0]);
  assert.equal(lede(root), "Could not read the data. Reload; if it stays, check /admin/pipeline.");
});

test("P3-6 the map: an accessible name with the legend counts, no tab stop, the list view as the keyboard route", () => {
  const { root, doc } = renderInto(QMAIN, QMAP);
  const svg = root.all((n) => n.localName === "svg" && /\btowns\b/.test(n.className))[0];
  assert.equal(svg.getAttribute("role"), "img");
  const label = svg.getAttribute("aria-label");
  assert.equal(label, V.mapLabel(QMAP.body));
  for (const l of V.legendView(QMAP.body)) assert.ok(label.includes(l.text + " " + l.count), l.text);
  assert.equal(svg.all((n) => n.getAttribute("tabindex") !== null).length, 0, "no tab stop inside the map");
  const toggle = root.all(cls(/\btoggle\b/))[0];
  assert.equal(toggle.localName, "button");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.textContent, "Show as list", "the name stays; aria-pressed carries the state");
  const towns = root.all((n) => n.localName === "button" && /\btown\b/.test(n.className));
  assert.equal(towns.length, 351);
  const btn = towns.find((b) => b.textContent === "Becket") || towns[0];
  btn.focus();
  btn.click();
  const sheet = root.all((n) => n.getAttribute("role") === "dialog")[0];
  assert.ok(sheet.isShown());
  assert.equal(sheet.getAttribute("aria-labelledby"), "sheet-title");
  assert.equal(doc.activeElement.textContent, "Close");
  doc.activeElement.click();
  assert.ok(!sheet.isShown());
  assert.equal(doc.activeElement, btn, "focus returns where it was");
  btn.click();
  sheet.dispatch("keydown", { key: "Escape" });
  assert.ok(!sheet.isShown());
  assert.equal(doc.activeElement, btn);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
});

test("P3-6 dead towns carry a hatch as well as a colour, on the map and in the legend", () => {
  const { root } = renderInto(QMAIN, QMAP);
  const dead = Object.keys(QMAP.body.towns).filter((k) => QMAP.body.towns[k].k === "dead");
  assert.ok(dead.length > 0);
  const hatches = root.all((n) => n.localName === "path" && n.getAttribute("class") === "hatch");
  assert.equal(hatches.length, dead.length);
  for (const h of hatches) {
    assert.equal(h.getAttribute("fill"), "url(#mc-hatch)");
    assert.equal(h.getAttribute("data-town"), null, "the overlay is not a second tap target");
  }
  assert.equal(root.all((n) => n.localName === "pattern" && n.getAttribute("id") === "mc-hatch").length, 1);
  const sw = root.all((n) => /\bsw\b/.test(n.className) && /\bm-dead\b/.test(n.className));
  assert.ok(sw.length >= 1 && sw.every((n) => /\bhatched\b/.test(n.className)));
});

test("P3-6 details use <details> and <summary>; focus ring, reduced motion and 44 px targets in the CSS", () => {
  const { root } = renderInto(QMAIN, QMAP);
  const secs = root.all((n) => n.getAttribute("data-section") !== null);
  assert.equal(secs.length, 8);
  for (const s of secs) {
    assert.equal(s.localName, "details");
    assert.equal(s.children[0].localName, "summary");
  }
  const css = read("admin/mission-app.css");
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--accent\); outline-offset: 2px; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /button \{[^}]*min-height: 44px; min-width: 44px;/);
  assert.match(css, /\.fine summary, \.known summary \{[^}]*min-height: 44px;/);
  assert.match(css, /\.sec summary \{[^}]*min-height: 48px;/);
  assert.match(css, /\.grp summary \{[^}]*min-height: 44px;/);
  assert.match(css, /\.rows a, \.foot a \{[^}]*min-height: 44px; min-width: 44px;/);
  // text zoom: no fixed width on any container; the legend's columns shrink to the screen
  assert.match(css, /minmax\(min\(15em, 100%\), 1fr\)/);
  assert.doesNotMatch(css, /(^|[;{\s])width:\s*\d{3,}px/m);
  assert.doesNotMatch(css, /[;{\s]min-width:\s*\d{3,}px/, "a min-width outside a media query");
});
