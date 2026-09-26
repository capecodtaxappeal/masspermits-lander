// P2-10: the offline demo (docs/mission/demo.html on this design branch).
//
// The payloads come from the REAL route (functions/admin/api/mission.js, both
// views) run through the harness on synthetic worlds at a fixed now. Only
// `MISSION_DEMO_WRITE=1 node --test test/mission/demo.test.mjs` writes the
// file; without it the test builds a fresh demo and requires the committed
// file to equal it byte for byte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as H from "./_harness.mjs";
import * as D from "./_demo.mjs";

// ── the five scenarios, answered by the REAL route ─────────────────────────
const HOSTILE_NAME = "<img src=x onerror=alert(1)>\u202e";
const QUIET_NOW = H.T("2026-09-30T18:00:00Z");   // a Wednesday (P1-15 Q1)
const BAD_NOW = H.T("2026-09-28T20:30:00Z");     // a Monday, after the hold hour
const PRICES = H.PRICE_A + "," + H.PRICE_B;
const connected = () => ({ STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: PRICES });
const pick = (r) => ({ status: r.status, body: r.body });

async function both(ctx, w, o = {}) {
  const main = await ctx.get(w, o);
  const map = await ctx.get(w, { ...o, ...(o.mapOpts || {}), query: "?view=map" });
  return { main: pick(main), map: pick(map) };
}

async function buildScenarios(ctx) {
  const { stub } = ctx;
  const out = [];

  // 1 Quiet day: the P1-15 Q1 world.
  stub.stripe = null;
  const q = await H.quietWorld(QUIET_NOW);
  out.push({ name: "Quiet day", now: new Date(QUIET_NOW).toISOString(), ...(await both(ctx, q)) });

  // 2 Bad day.
  const now = BAD_NOW;
  const nowS = Math.floor(now / 1000);
  const b = await H.healthyWorld(now, { roster: 8, sources: 40 });
  b.roster[0].name = HOSTILE_NAME;
  b.r2.set("subscribers.json", b.roster, { uploaded: now - 3 * H.DAY });
  const sent = b.roster.slice(0, 7).map((r, i) => ({ to: r.email, ok: i !== 1, ...(i === 1 ? { error: "rejected" } : {}) }));
  b.r2.set("feed-send-log.json", [H.logEntry(b.sendAt, sent)], { uploaded: b.sendAt });
  const fresh = b.towns[5] + ", MA";
  b.shSources[fresh] = H.shRecord("dead", b.ranAt, { lastGood: now - 2 * H.DAY, lastError: "HTTP 500 from the town's site" });
  b.status = H.crashedStatus(b.ranAt);
  b.save({ runs_unscored: 1, last_unscored_at: new Date(b.ranAt).toISOString(), last_unscored_why: "refresh crashed" });
  const data = H.stripeData(b.roster, now, { openInvoices: [{
    id: "in_TESTopen00001", customer: b.roster[2].customer, status: "open", amount_due: 4900, currency: "usd",
    created: nowS - 2 * 86400, attempt_count: 1, billing_reason: "subscription_cycle",
    lines: { data: [{ price: { id: H.PRICE_A } }] } }] });
  data.subscriptions[3] = H.subscription(4, b.roster[3].customer, { now, cancel: true, periodEnd: nowS + 5 * 86400 });
  stub.stripe = H.stripeFake(data);
  out.push({ name: "Bad day", now: new Date(now).toISOString(), ...(await both(ctx, b, { env: connected() })) });

  // 3 All good: Stripe ok, the editor on, outreach for the three fixture towns.
  const outreach = { version: 1, updated_at: new Date(QUIET_NOW - H.DAY).toISOString(), towns: {
    Adams: { outreach: "sent", since: "2026-09-21" },
    Alford: { outreach: "answered", since: "2026-09-14" },
    Ashfield: { outreach: "planned" },
  }, history: [] };
  const g = await H.healthyWorld(QUIET_NOW, { roster: 12, sources: 45, outreach });
  stub.stripe = H.stripeFake(H.stripeData(g.roster, QUIET_NOW));
  out.push({ name: "All good", now: new Date(QUIET_NOW).toISOString(),
    ...(await both(ctx, g, { env: { ...connected(), MISSION_OUTREACH_EDIT: "1" } })) });

  // 4 Cannot read: two gets throw (P1-11); the map view answers 503.
  stub.stripe = null;
  const c = await H.healthyWorld(QUIET_NOW, { roster: 6, sources: 30 });
  c.r2.fail.add("get:subscribers.json");
  c.r2.fail.add("get:delivery-log.json");
  const cMain = await ctx.get(c);
  c.r2.fail.add("head:source-health.json");
  const cMap = await ctx.get(c, { query: "?view=map" });
  out.push({ name: "Cannot read", now: new Date(QUIET_NOW).toISOString(), main: pick(cMain), map: pick(cMap) });

  // 5 Not set up: no Access configuration at all.
  const n = await H.healthyWorld(QUIET_NOW, { roster: 3, sources: 10 });
  const bare = { CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", ADMIN_ALLOWED_EMAILS: "" };
  out.push({ name: "Not set up", now: new Date(QUIET_NOW).toISOString(), ...(await both(ctx, n, { env: bare })) });
  stub.stripe = null;
  return out;
}

const VARIANT = "A";
const OUT = path.join(H.REPO, "docs", "mission", "demo.html");
const read = (rel) => fs.readFileSync(path.join(H.REPO, rel), "utf8");

const ctx = await H.setup();
const { view: V } = ctx.m;
const scenarios = await buildScenarios(ctx);
const geometryText = read("admin/mission-towns.json");
const built = D.buildDemo({
  variant: VARIANT,
  css: read("admin/mission-app.css"),
  viewSrc: read("admin/mission-view.js"),
  renderSrc: read("admin/mission-render.js"),
  missionHtml: read("admin/mission.html"),
  geometryText,
  scenarios,
});
if (process.env.MISSION_DEMO_WRITE === "1") {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, built);
}
const file = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";

const JSON_BLOCK = /<script type="application\/json" id="([a-z-]+)">([\s\S]*?)<\/script>/g;
const jsonBlocks = [...file.matchAll(JSON_BLOCK)].map((m) => ({ id: m[1], text: m[2] }));
const outsideJson = file.replace(JSON_BLOCK, "");
const blockOf = (id) => jsonBlocks.find((b) => b.id === id);

function parsed() {
  const doc = H.fakeDocument();
  H.parseInto(doc, file);
  return doc;
}
const scriptsOf = (doc) => H.find(doc, (n) => n.localName === "script");
const execScripts = (doc) => scriptsOf(doc).filter((s) => !s.hasAttribute("type"));

// Run the demo's inline script in a fresh context with the fake document.
function boot() {
  const doc = parsed();
  const sandbox = { document: doc, console: { log() {}, error() {}, warn() {} } };
  vm.createContext(sandbox);
  for (const s of execScripts(doc)) vm.runInContext(s.textContent, sandbox);
  return doc;
}

test("P2-10 the scenarios are the real route's answers", () => {
  assert.deepEqual(scenarios.map((s) => s.name), D.SCENARIO_NAMES);
  assert.equal(scenarios[0].main.body.headline.text, "Nothing is wrong that this page can see.");
  const bad = scenarios[1].main.body;
  assert.equal(bad.headline.state, "red");
  assert.equal(H.tileOf(bad, "refresh").state, "red");
  assert.equal(H.tileOf(bad, "monday").state, "red");
  assert.equal(H.tileOf(bad, "failed").state, "red");
  assert.equal(H.tileOf(bad, "renewals").state, "amber");
  assert.equal(bad.detail.refresh.fail_kind, "crash");
  assert.equal(bad.detail.refresh.coverage, null);
  assert.ok(H.lineIds(bad, "amber").includes("sources_down"));
  assert.equal(scenarios[2].main.body.outreach_edit, true);
  assert.equal(scenarios[2].main.body.headline.state, "clear");
  assert.equal(scenarios[3].map.status, 503);
  assert.ok(H.lineIds(scenarios[3].main.body, "amber").includes("unreadable"));
  assert.equal(scenarios[4].main.status, 403);
  assert.equal(scenarios[4].main.body.reason, "not-configured");
  assert.equal(scenarios[4].map.status, 403);
  for (const s of scenarios) {
    for (const r of [s.main, s.map]) if (r.status === 200) assert.equal(r.body.privacy_redactions, 0, s.name);
  }
});

test("P2-10 (a) the committed demo equals a fresh build byte for byte", () => {
  assert.ok(file, "docs/mission/demo.html is missing: run MISSION_DEMO_WRITE=1 node --test test/mission/demo.test.mjs");
  assert.equal(file, built);
});

test("P2-10 (b) one file: no external reference; URLs only where allowed; geometry exact", () => {
  assert.ok(!/\ssrc\s*=/i.test(outsideJson), "a src attribute");
  assert.ok(!/<(link|iframe|object|embed)\b/i.test(outsideJson), "an external element");
  for (const m of outsideJson.matchAll(/\shref\s*=\s*["']([^"']*)/gi)) assert.equal(m[1], "#");
  for (const m of file.matchAll(/url\(\s*["']?([^"')]*)/gi)) assert.ok(m[1].startsWith("data:"), m[1]);
  assert.ok(!/https?:/i.test(outsideJson), "a URL outside the JSON blocks");
  const geo = JSON.parse(geometryText);
  for (const b of jsonBlocks) {
    for (const m of b.text.matchAll(/https?:[^"\s\\]*/g)) {
      assert.ok(m[0].startsWith("https://dashboard.stripe.com/") || m[0] === geo.source.url, m[0]);
    }
  }
  assert.deepEqual(JSON.parse(blockOf("demo-towns").text), geo);
  assert.deepEqual(JSON.parse(blockOf("demo-scenarios").text), JSON.parse(JSON.stringify(scenarios)));
});

test("P2-10 (c) the CSP meta tag is the first child of <head>, with a hash per inline block", () => {
  const doc = parsed();
  const first = doc.head.children[0];
  assert.equal(first.localName, "meta");
  assert.equal(first.getAttribute("http-equiv"), "Content-Security-Policy");
  const scripts = execScripts(doc);
  const styles = H.find(doc, (n) => n.localName === "style");
  assert.equal(scripts.length, 1);
  assert.equal(styles.length, 1);
  const want = D.demoCsp(D.sha256b64(scripts[0].textContent), D.sha256b64(styles[0].textContent));
  assert.equal(first.getAttribute("content"), want);
  assert.equal(want, "default-src 'none'; script-src 'sha256-" + D.sha256b64(scripts[0].textContent) +
    "'; style-src 'sha256-" + D.sha256b64(styles[0].textContent) + "'; img-src data:; connect-src 'none'; " +
    "font-src 'none'; form-action 'none'; base-uri 'none'");
  assert.equal(H.find(doc, (n) => n.hasAttribute("style")).length, 0, "no style attribute");
});

test("P2-10 (d) no request API, no storage API, no markup sink", () => {
  const banned = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "import(", "importScripts",
    "new Worker", "localStorage", "sessionStorage", "indexedDB", "caches.", "serviceWorker", "document.cookie",
    "innerHTML", "insertAdjacentHTML", "outerHTML", "document.write", "eval(", "new Function",
    'setAttribute("style', "setAttribute('style", 'setAttribute("on', "setAttribute('on"];
  for (const b of banned) assert.ok(!file.includes(b), b);
});

test("P2-10 (e) privacy: invented data only, escaped JSON, no identifier shapes", () => {
  const emails = file.match(/[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}/g) || [];
  assert.deepEqual([...new Set(emails)], ["owner@example.com"]);
  const rest = file.split("owner@example.com").join("");
  for (const re of [/\b[0-9a-f]{32}\b/, /\b(sk|rk)_(live|test)_[A-Za-z0-9]+/, /\bwhsec_[A-Za-z0-9]+/,
    /\bre_[A-Za-z0-9]{8,}/, /prospects\//, /newsletter\//]) {
    assert.ok(!re.test(rest), String(re));
  }
  for (const b of jsonBlocks) {
    assert.ok(!/<[A-Za-z]/.test(b.text), b.id + " has markup");
    assert.ok(!/[<>&\u2028\u2029]/.test(b.text), b.id + " has a raw special character");
  }
  assert.ok(!file.includes("<img"), "the hostile name appears raw");
  assert.ok(file.includes("\\u003cimg src=x onerror=alert(1)\\u003e"), "the hostile name, escaped");
  assert.ok(!file.includes("‮"), "a bidi control survived");
  const invented = new Set(["(not on the roster)", "(no name)", HOSTILE_NAME.replace(/‮/g, "")]);
  for (const f of H.FIRST) for (const l of H.LAST) invented.add(f + " " + l);
  const names = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "name") names.push(x); walk(x); }
  };
  walk(scenarios.map((s) => [s.main.body, s.map.body]));
  assert.ok(names.length > 10);
  for (const n of names) if (typeof n === "string") assert.ok(invented.has(n), n);
  for (const m of file.matchAll(/\b(cus|sub|in)_[A-Za-z0-9]+/g)) assert.ok(/^(cus|sub|in)_TEST/.test(m[0]), m[0]);
  for (const s of scenarios) {
    if (s.map.status !== 200) continue;
    const o = Object.entries(s.map.body.towns).filter(([, f]) => f.o || f.os || f.planned).map(([k]) => k);
    for (const t of o) assert.ok(["Adams", "Alford", "Ashfield"].includes(t), t);
  }
});

test("P2-10 (f) the demo boot renders all five scenarios in a fake DOM; the theme switch works", () => {
  const doc = boot();
  const root = doc.getElementById("mc-root");
  const setup = doc.getElementById("mc-setup");
  const bar = H.byAttr(doc, "data-part", "demo-bar")[0];
  assert.ok(bar, "demo bar");
  // outside the page's root element
  for (let n = bar; n; n = n.parentNode) assert.notEqual(n, root);
  const buttons = H.byAttr(bar, "data-scenario");
  assert.equal(buttons.length, 5);
  scenarios.forEach((s, i) => {
    buttons[i].click();
    assert.equal(buttons[i].getAttribute("aria-pressed"), "true");
    if (i === 4) {
      assert.equal(setup.hidden, false, "Setup needed block shown");
      assert.equal(H.byAttr(root, "data-tile").length, 0, "no tile");
      return;
    }
    assert.equal(setup.hidden, true);
    const model = V.mainModel(s.main);
    assert.equal(model.kind, "ok");
    assert.equal(H.byAttr(root, "data-part", "headline")[0].textContent, model.headline.text);
    const words = H.byAttr(root, "data-part", "tile-word").map((n) => n.textContent);
    assert.deepEqual(words, model.tiles.map((t) => t.word));
    assert.equal(words.length, 8);
    const firstLine = model.needs.urgent[0] || model.needs.known[0];
    const firstDom = H.find(root, (n) => n.hasAttribute("data-need") || n.hasAttribute("data-known"))[0];
    if (firstLine) assert.ok(firstDom && firstDom.textContent.includes(firstLine.text), s.name);
    else assert.equal(firstDom, undefined, s.name);
    const paths = H.find(root, (n) => n.localName === "path");
    if (i === 3) {
      assert.equal(paths.length, 0, "scenario 4: no map colours");
      assert.equal(H.byAttr(root, "data-part", "map-message")[0].textContent, V.SENTENCES.mapFailed);
    } else {
      assert.ok(paths.length >= 351);
      assert.equal(H.byAttr(root, "data-part", "signed-in")[0].textContent, "Signed in as owner@example.com");
    }
  });
  // edit buttons exist only where the payload says outreach_edit, and change nothing
  buttons[2].click();
  H.find(root, (n) => n.localName === "button" && n.textContent === "Adams")[0].click();
  const sheet = H.byAttr(root, "data-part", "sheet")[0];
  assert.ok(sheet);
  const choice = H.find(sheet, (n) => n.localName === "button" && n.textContent === "Answered")[0];
  assert.ok(choice, "edit buttons on scenario 3");
  choice.click();
  buttons[0].click();
  H.find(root, (n) => n.localName === "button" && n.hasAttribute("class") && H.hasClass(n, "mc-town"))[0].click();
  const sheet0 = H.byAttr(root, "data-part", "sheet")[0];
  assert.equal(H.find(sheet0, (n) => n.localName === "button" && n.textContent === "Answered").length, 0);
  // links keep their look but go nowhere
  for (const a of H.find(root, (n) => n.localName === "a")) assert.equal(a.getAttribute("href"), "#");
  const a = H.find(root, (n) => n.localName === "a")[0];
  assert.equal(a.click().defaultPrevented, true);
  // theme: Device -> Light -> Dark -> Device
  const theme = H.byAttr(bar, "data-part", "demo-theme")[0];
  assert.equal(doc.documentElement.hasAttribute("data-theme"), false);
  theme.click();
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  theme.click();
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  theme.click();
  assert.equal(doc.documentElement.hasAttribute("data-theme"), false);
});

test("P2-10 (f) the edit button in the demo says nothing is saved", async () => {
  const doc = boot();
  const root = doc.getElementById("mc-root");
  H.byAttr(doc, "data-scenario", "2")[0].click();
  H.find(root, (n) => n.localName === "button" && n.textContent === "Alford")[0].click();
  const sheet = H.byAttr(root, "data-part", "sheet")[0];
  H.find(sheet, (n) => n.localName === "button" && n.textContent === "Sent")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.equal(H.find(sheet, (n) => n.getAttribute("role") === "status")[0].textContent, D.DEMO_EDIT_TEXT);
});

test("P2-10 (g) demo bar text, robots meta and title are exact", () => {
  assert.ok(file.includes(D.DEMO_BAR_TEXT));
  assert.equal(D.DEMO_BAR_TEXT, "Demo with invented data. Nothing on this page is real.");
  const doc = parsed();
  const robots = H.find(doc.head, (n) => n.localName === "meta" && n.getAttribute("name") === "robots");
  assert.equal(robots.length, 1);
  assert.equal(robots[0].getAttribute("content"), "noindex,nofollow");
  const title = H.find(doc.head, (n) => n.localName === "title");
  assert.equal(title[0].textContent, "Mission Control demo, design " + VARIANT);
  const booted = boot();
  assert.ok(H.byAttr(booted, "data-part", "demo-bar")[0].textContent.includes(D.DEMO_BAR_TEXT));
});

test("P2-10 (h) size <= 400 KB", () => {
  assert.ok(Buffer.byteLength(file) <= 400 * 1024, String(Buffer.byteLength(file)));
});
