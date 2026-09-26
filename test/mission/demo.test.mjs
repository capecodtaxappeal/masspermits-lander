// P2-10 / P3-2: the offline demo. Since P3 nothing is committed: every run
// builds it into the OS temp directory and checks that build. Payloads come
// from the REAL route (functions/admin/api/mission.js, both views) run
// through the harness on synthetic worlds at fixed clocks.
// A copy for the owner's final look, written only by:
//   MISSION_DEMO_OUT=/path/outside/the/repo/demo.html node --test test/mission/demo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as H from "./_harness.mjs";
import { buildDemo, sha256, DEMO_NOTE, DEMO_TITLE, SCENARIO_NAMES } from "./_demo.mjs";

const VARIANT = "C";
const COMMITTED = path.join(H.REPO, "docs/mission/demo.html");
const DEMO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mission-demo-")), "demo.html");
const { m, stub, get } = await H.setup();
const { T, DAY } = H;
const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const PRICES = H.PRICE_A + "," + H.PRICE_B;
const STRIPE_ENV = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: PRICES };
const HOSTILE_NAME = "<img src=x onerror=alert(1)>‮";

const pick = (res) => ({ status: res.status, json: res.body });
async function both(w, o = {}) {
  const main = await get(w, { env: o.env });
  if (o.beforeMap) o.beforeMap(w);
  const map = await get(w, { env: o.env, query: "?view=map" });
  return { main: pick(main), map: pick(map) };
}

async function quietDay() {
  const now = T("2026-09-30T18:00:00Z"); // Wednesday: P1-15 Q1
  stub.stripe = null;
  return { now, ...(await both(await H.quietWorld(now))) };
}

async function badDay() {
  const now = T("2026-09-28T20:30:00Z"); // a Monday, after the 20:00Z hold
  const w = await H.healthyWorld(now, { roster: 6, mondayLog: false });
  w.roster[0].name = HOSTILE_NAME;
  w.r2.set("subscribers.json", w.roster, { uploaded: now - 3 * DAY });
  // Monday: one ok:false, one expected recipient missing, the rest delivered
  const sendAt = T("2026-09-28T15:40:00Z");
  const sent = w.roster.slice(0, 5).map((r) => ({ to: r.email, ok: true }));
  sent[4] = { to: sent[4].to, ok: false, error: "550 mailbox unavailable" };
  w.r2.set("feed-send-log.json", [H.logEntry(sendAt, sent)], { uploaded: sendAt });
  w.r2.set("last-send-attempt.json", { at: new Date(sendAt - 60_000).toISOString(), subscribers: 6, degraded: false },
    { uploaded: sendAt });
  // one source newly dead
  const [newlyDead] = await H.sourceTowns(1, 40);
  w.shSources[newlyDead + ", MA"] = H.shRecord("dead", w.ranAt, { lastGood: now - DAY, lastError: "HTTP 500 from the portal" });
  // the refresh crashed today: the exact FAILURE SHAPE, source-health unscored
  const ranAt = T("2026-09-28T14:10:00Z");
  w.status = H.crashedStatus(ranAt);
  w.statusUploaded = ranAt;
  w.save({ runs_unscored: 1, last_unscored_at: new Date(ranAt).toISOString(), last_unscored_why: "refresh crashed" });
  // Stripe connected: one open invoice retried once, one renewal set to cancel
  const nowS = Math.floor(now / 1000);
  const data = H.stripeData(w.roster, now, { openInvoices: [
    { id: "in_TESTopen0001", customer: w.roster[1].customer, status: "open", amount_due: 4900, amount_paid: 0,
      currency: "usd", created: nowS - DAY / 1000, attempt_count: 1, billing_reason: "subscription_cycle",
      lines: { data: [{ pricing: { price_details: { price: H.PRICE_A } } }] } },
  ] });
  data.subscriptions[2].cancel_at_period_end = true;
  data.subscriptions[2].items.data[0].current_period_end = nowS + 5 * 86400;
  stub.stripe = H.stripeFake(data);
  const out = { now, ...(await both(w, { env: STRIPE_ENV })) };
  stub.stripe = null;
  return out;
}

async function allGood() {
  const now = T("2026-09-30T18:00:00Z");
  const w = await H.healthyWorld(now, { roster: 8, outreach: { version: 1, updated_at: "2026-09-29T12:00:00Z", towns: {
    Adams: { outreach: "sent", since: "2026-09-21" },
    Alford: { outreach: "answered", since: "2026-09-24" },
    Ashfield: { outreach: "planned" },
  } } });
  stub.stripe = H.stripeFake(H.stripeData(w.roster, now));
  const out = { now, ...(await both(w, { env: { ...STRIPE_ENV, MISSION_OUTREACH_EDIT: "1" } })) };
  stub.stripe = null;
  return out;
}

async function cannotRead() {
  const now = T("2026-09-30T18:00:00Z");
  const w = await H.healthyWorld(now);
  w.r2.fail.add("get:subscribers.json");
  w.r2.fail.add("get:delivery-log.json");
  // the map view answers 503: its source-health read throws
  return { now, ...(await both(w, { beforeMap: (x) => x.r2.fail.add("get:source-health.json") })) };
}

async function notSetUp() {
  const now = T("2026-09-30T18:00:00Z");
  const w = await H.healthyWorld(now);
  return { now, ...(await both(w, { env: { CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", ADMIN_ALLOWED_EMAILS: "" } })) };
}

const built = [];
for (const [i, f] of [quietDay, badDay, allGood, cannotRead, notSetUp].entries()) {
  const s = await f();
  built.push({ name: SCENARIO_NAMES[i], now: new Date(s.now).toISOString(), main: s.main, map: s.map });
}
const files = {
  html: read("admin/mission.html"), css: read("admin/mission-app.css"), view: read("admin/mission-view.js"),
  render: read("admin/mission-render.js"), towns: read("admin/mission-towns.json"),
};
const fresh = buildDemo({ variant: VARIANT, files, scenarios: built });
fs.writeFileSync(DEMO, fresh);
const file = fs.readFileSync(DEMO, "utf8");
const outside_repo = (p) => { const r = path.relative(H.REPO, path.resolve(p)); return r.startsWith("..") || path.isAbsolute(r); };
if (process.env.MISSION_DEMO_OUT) {
  if (!outside_repo(process.env.MISSION_DEMO_OUT)) throw new Error("MISSION_DEMO_OUT must be outside the repo");
  fs.writeFileSync(process.env.MISSION_DEMO_OUT, fresh);
}

// ── pieces of the temp-directory build ──────────────────────────────────────
const JSON_RE = /<script type="application\/json" id="([a-z-]+)">([\s\S]*?)<\/script>/g;
const jsonBlocks = [...file.matchAll(JSON_RE)].map((x) => ({ id: x[1], text: x[2] }));
const outside = file.replace(JSON_RE, "");
const inlineScripts = [...outside.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
const styles = [...outside.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((x) => x[1]);
const scenarios = () => JSON.parse(jsonBlocks.find((b) => b.id === "demo-scenarios").text);

test("P3-2 no committed demo: the build lives in the OS temp directory; MISSION_DEMO_OUT only outside the repo", () => {
  assert.ok(!fs.existsSync(COMMITTED), "docs/mission/demo.html must not exist from P3 on");
  assert.ok(!fs.existsSync(path.join(H.REPO, "docs/mission")), "nothing under docs/mission");
  assert.ok(outside_repo(DEMO) && DEMO.startsWith(os.tmpdir()), DEMO);
  assert.ok(file === fresh);
  assert.equal(outside_repo(path.join(H.REPO, "x.html")), false);
  assert.equal(outside_repo(path.join(os.tmpdir(), "x.html")), true);
});

test("P2-10 the five scenarios are what the prompt describes", () => {
  const s = scenarios();
  assert.deepEqual(s.map((x) => x.name), SCENARIO_NAMES);
  assert.equal(s[0].main.json.headline.text, "Nothing is wrong that this page can see.");
  const bad = s[1].main.json;
  assert.equal(bad.headline.state, "red");
  const tile = (b, id) => b.tiles.find((t) => t.id === id);
  assert.equal(tile(bad, "refresh").state, "red");
  assert.equal(bad.detail.refresh.fail_kind, "crash");
  assert.equal(bad.detail.refresh.coverage, null);
  assert.equal(tile(bad, "monday").state, "red");
  assert.equal(bad.detail.monday.failed.length, 1);
  // P1's rule: missing = expected and not delivered, so the failed address is
  // missing too; one more expected recipient was never attempted.
  const failedT8 = bad.detail.monday.failed.map((r) => r.t8);
  assert.equal(bad.detail.monday.missing.filter((r) => !failedT8.includes(r.t8)).length, 1);
  assert.equal(tile(bad, "failed").state, "red");
  assert.equal(tile(bad, "renewals").state, "amber");
  assert.ok(bad.needs_you.some((l) => l.id === "sources_down"));
  assert.ok(bad.detail.customers.rows.some((r) => r.name === "<img src=x onerror=alert(1)>"));
  assert.equal(s[1].map.status, 200);
  assert.equal(s[2].main.json.headline.state, "clear");
  assert.equal(s[2].main.json.outreach_edit, true);
  assert.deepEqual(Object.keys(s[2].map.json.towns).filter((k) => s[2].map.json.towns[k].o).sort(), ["Adams", "Alford", "Ashfield"]);
  assert.equal(tile(s[3].main.json, "paying").grey, "unavailable");
  assert.equal(s[3].map.status, 503);
  for (const v of ["main", "map"]) assert.deepEqual([s[4][v].status, s[4][v].json.reason], [403, "not-configured"]);
});

test("P2-10 (b) one file: no src, link, iframe, object or embed; no network URL outside the data", () => {
  assert.ok(!/<[a-z]+[^>]*\ssrc\s*=/i.test(outside), "src attribute");
  assert.ok(!/<(link|iframe|object|embed)\b/i.test(outside), "external element");
  for (const h of outside.matchAll(/\shref\s*=\s*"([^"]*)"/gi)) assert.equal(h[1], "#");
  for (const u of styles.join("\n").matchAll(/url\(\s*['"]?([^'")]*)/gi)) assert.ok(u[1].startsWith("data:"), "css url " + u[1]);
  // outside the CSS, url( appears only as the map hatch's same-document fragment reference
  for (const u of outside.matchAll(/url\(\s*['"]?([^'")]*)/gi)) assert.ok(u[1].startsWith("data:") || u[1] === "#mc-hatch", "url " + u[1]);
  assert.ok(!/https?:/i.test(outside), "http(s): outside the embedded JSON");
  const geo = JSON.parse(read("admin/mission-towns.json"));
  for (const b of jsonBlocks) {
    for (const u of b.text.matchAll(/https?:[^"\s]*/g)) {
      assert.ok(u[0].startsWith("https://dashboard.stripe.com/") || u[0] === geo.source.url, "URL in data: " + u[0]);
    }
  }
  assert.deepEqual(JSON.parse(jsonBlocks.find((b) => b.id === "demo-towns").text), geo);
});

test("P2-10 (c) the CSP meta is the first child of <head>, with the exact directives and hashes", () => {
  const head = file.slice(file.indexOf("<head>") + 6);
  const m1 = head.match(/^\s*<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m1, "CSP meta is not the first child of head");
  const d = Object.fromEntries(m1[1].split(";").map((x) => x.trim().split(/\s+/)).map((x) => [x[0], x.slice(1)]));
  assert.deepEqual(Object.keys(d), ["default-src", "script-src", "style-src", "img-src", "connect-src", "font-src",
    "form-action", "base-uri"]);
  assert.deepEqual(d["default-src"], ["'none'"]);
  assert.deepEqual(d["script-src"], inlineScripts.map((s) => "'" + sha256(s) + "'"));
  assert.deepEqual(d["style-src"], styles.map((s) => "'" + sha256(s) + "'"));
  assert.deepEqual(d["img-src"], ["data:"]);
  for (const k of ["connect-src", "font-src", "form-action", "base-uri"]) assert.deepEqual(d[k], ["'none'"]);
  assert.equal(inlineScripts.length, 1);
  assert.equal(styles.length, 1);
});

test("P2-10 (d) no request API, no storage API, no HTML sink", () => {
  for (const re of [/fetch\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /import\(/, /importScripts/,
    /new Worker/, /localStorage/, /sessionStorage/, /indexedDB/, /caches\./, /serviceWorker/, /document\.cookie/,
    /innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /eval\(/, /new Function/,
    /setAttribute\(\s*["']style/, /setAttribute\(\s*["']on/]) {
    assert.ok(!re.test(file), "demo contains " + re);
  }
});

test("P2-10 (e) privacy: invented data only", () => {
  const emails = file.match(/[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}/g) || [];
  assert.deepEqual([...new Set(emails)], ["owner@example.com"]);
  for (const re of [/\b[0-9a-f]{32}\b/, /\b(sk|rk)_(live|test)_[A-Za-z0-9]+/, /\bwhsec_[A-Za-z0-9]+/,
    /\bre_[A-Za-z0-9]{8,}/, /prospects\//, /newsletter\//]) assert.ok(!re.test(file), "walk regex " + re);
  for (const b of jsonBlocks) assert.ok(!/<[A-Za-z]/.test(b.text), "markup in " + b.id);
  assert.ok(!file.includes("<img"), "hostile name appears raw");
  assert.ok(file.includes("\\u003cimg src=x onerror=alert(1)\\u003e"), "hostile name appears escaped");
  const names = new Set();
  const collect = (v, k) => {
    if (Array.isArray(v)) v.forEach((x) => collect(x));
    else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) collect(x, kk);
    else if (k === "name" && typeof v === "string") names.add(v);
  };
  const s = scenarios();
  collect(s.map((x) => [x.main, x.map]));
  const invented = new Set(["<img src=x onerror=alert(1)>", "(not on the roster)", "(no name)"]);
  for (const f of H.NAME_PARTS.first) for (const l of H.NAME_PARTS.last) invented.add(f + " " + l);
  for (const n of names) assert.ok(invented.has(n), "name not from the invented list: " + n);
  for (const id of file.match(/\b(cus|sub|in)_[A-Za-z0-9]+/g) || []) assert.match(id, /^(cus|sub|in)_TEST/);
  for (const x of s) {
    const towns = x.map.json && x.map.json.towns ? x.map.json.towns : {};
    for (const [k, f] of Object.entries(towns)) if (f.o || f.os || f.planned) assert.ok(["Adams", "Alford", "Ashfield"].includes(k), k);
  }
});

// Boots the demo's own script in a VM against the fake DOM built from its body.
function bootDemo() {
  const body = file.slice(file.indexOf("<body>") + 6, file.lastIndexOf("<script>"));
  const doc = H.fakeDocumentFrom(body);
  vm.runInNewContext(inlineScripts[0], { document: doc });
  return doc;
}

test("P2-10 (f) the demo boot renders all five scenarios on the fake DOM, as mission-view.js says", () => {
  const doc = bootDemo();
  const V = m.view;
  const s = scenarios();
  const root = doc.getElementById("mission");
  for (let i = 0; i < 5; i++) {
    const btn = doc.body.all((n) => n.getAttribute("data-scenario") === String(i))[0];
    btn.click();
    const main = s[i].main.json;
    const setup = doc.getElementById("setup-needed");
    if (i === 4) {
      assert.ok(setup.isShown(), "Setup needed block shown");
      assert.equal(root.all((n) => n.getAttribute("data-tile") !== null).length, 0, "no tile");
      continue;
    }
    assert.ok(!setup.isShown(), "setup hidden in scenario " + (i + 1));
    assert.equal(root.byPart("headline-text")[0].textContent, V.headlineView(main.headline).text);
    assert.deepEqual(root.byPart("word").map((n) => n.textContent), V.tilesView(main.tiles).map((t) => t.word));
    const urgent = V.needsView(main.needs_you).urgent;
    const first = root.byPart("need-text")[0];
    if (urgent.length) assert.equal(first.textContent.trim(), urgent[0].text);
    else assert.equal(first, undefined);
    // one <path data-town> per town (the dead-town hatch overlays carry no data-town)
    const paths = root.all((n) => n.localName === "path" && n.getAttribute("data-town") !== null);
    if (i === 3) {
      assert.equal(paths.length, 0, "scenario 4 has no map colours");
      assert.ok(root.byPart("map-failed")[0].isShown());
    } else {
      assert.equal(paths.length, 351);
    }
  }
  // edit buttons change nothing and say so (scenario 3 has the editor on)
  doc.body.all((n) => n.getAttribute("data-scenario") === "2")[0].click();
  const adams = root.all((n) => n.getAttribute("data-town") === "Adams")[0];
  adams.click();
  const choice = root.all((n) => n.getAttribute("class") === "choice")[0];
  choice.click();
  assert.equal(root.byPart("sheet-status")[0].textContent, "Demo: nothing is saved");
  // every link goes nowhere
  for (const a of root.all((n) => n.localName === "a")) {
    assert.equal(a.getAttribute("href"), "#");
    assert.equal(a.click().defaultPrevented, true);
  }
  // the theme switch sets and removes data-theme on <html>
  const theme = (t) => doc.body.all((n) => n.getAttribute("data-theme-set") === t)[0].click();
  theme("dark");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  theme("light");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  theme("device");
  assert.equal(doc.documentElement.getAttribute("data-theme"), null);
});

test("P2-10 (g) the demo bar text, robots meta and title are exact; the bar sits outside the page root", () => {
  assert.ok(file.includes("<p>" + DEMO_NOTE + "</p>"));
  assert.equal(DEMO_NOTE, "Demo with invented data. Nothing on this page is real.");
  assert.ok(file.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.ok(file.includes("<title>" + DEMO_TITLE(VARIANT) + "</title>"));
  assert.equal(DEMO_TITLE(VARIANT), "Mission Control demo, design C");
  assert.ok(file.indexOf('id="demo-bar"') < file.indexOf('id="mission"'));
  const doc = bootDemo();
  let inside = false;
  for (let n = doc.getElementById("demo-bar"); n; n = n.parentNode) if (n.getAttribute && n.getAttribute("id") === "mission") inside = true;
  assert.equal(inside, false);
});

test("P2-10 (h) size <= 400 KB", () => {
  assert.ok(Buffer.byteLength(file) <= 400 * 1024, "demo is " + Buffer.byteLength(file) + " bytes");
});
