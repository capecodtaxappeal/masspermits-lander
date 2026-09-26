// P2-10: the offline demo, docs/mission/demo.html.
// Payloads come from the REAL route (functions/admin/api/mission.js, both
// views) run through the harness on synthetic worlds at fixed clocks; the
// page code is this branch's own. Written only with MISSION_DEMO_WRITE=1;
// otherwise a fresh build must equal the committed file byte for byte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as H from "./_harness.mjs";
import { buildDemo, sha256, DEMO_BAR_TEXT, demoTitle } from "./_demo.mjs";

const VARIANT = "B";
const DEMO = path.join(H.REPO, "docs/mission/demo.html");
const { m, stub, get } = await H.setup();
const V = m.view;
const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const HOSTILE = "<img src=x onerror=alert(1)>\u202e";
const STRIPE_ENV = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A + "," + H.PRICE_B };

const pair = async (w, o = {}) => {
  const a = await get(w, o);
  const b = await get(w, { ...o, query: "?view=map", ...(o.map || {}) });
  return { main: { status: a.status, body: a.body }, map: { status: b.status, body: b.body } };
};

async function quietDay() {
  const now = H.T("2026-09-30T18:00:00Z");
  stub.stripe = null;
  const w = await H.quietWorld(now);
  return { label: "Quiet day", now: new Date(now).toISOString(), ...(await pair(w)) };
}

async function badDay() {
  const now = H.T("2026-09-28T20:30:00Z"); // a Monday
  const w = await H.healthyWorld(now, { roster: 6, ranAt: H.T("2026-09-27T14:20:00Z"), mondayLog: false });
  w.roster[0].name = HOSTILE;
  w.r2.set("subscribers.json", w.roster, { uploaded: now - 3 * H.DAY });
  const sendAt = H.T("2026-09-28T15:40:00Z");
  const sent = w.roster.slice(0, 5).map((r, i) => (i === 4 ? { to: r.email, ok: false, error: "rejected" } : { to: r.email, ok: true }));
  w.r2.set("feed-send-log.json", [H.logEntry(sendAt, sent)], { uploaded: sendAt });
  w.r2.set("last-send-attempt.json", { at: new Date(sendAt - 60_000).toISOString(), subscribers: 6, degraded: false },
    { uploaded: sendAt });
  // one source newly dead
  const dead = w.towns[5] + ", MA";
  w.shSources[dead] = H.shRecord("dead", w.ranAt, { lastGood: now - 2 * H.DAY, lastError: "HTTP 500 from the town site" });
  // the "refresh crashed" FAILURE SHAPE, exactly
  const crashAt = H.T("2026-09-28T14:10:00Z");
  w.status = H.crashedStatus(crashAt);
  w.statusUploaded = crashAt;
  w.save({ runs_unscored: 1, last_unscored_at: new Date(crashAt).toISOString(), last_unscored_why: "refresh crashed" });
  const nowS = Math.floor(now / 1000);
  const data = H.stripeData(w.roster, now, { openInvoices: [{
    id: "in_TESTopen0001", customer: w.roster[2].customer, status: "open", amount_due: 4900, currency: "usd",
    created: nowS - 2 * 86400, attempt_count: 1, billing_reason: "subscription_cycle",
    lines: { data: [{ price: { id: H.PRICE_A } }] },
  }] });
  data.subscriptions[1].cancel_at_period_end = true;
  data.subscriptions[1].items.data[0].current_period_end = nowS + 5 * 86400;
  stub.stripe = H.stripeFake(data);
  const out = { label: "Bad day", now: new Date(now).toISOString(), ...(await pair(w, { env: STRIPE_ENV })) };
  stub.stripe = null;
  return out;
}

async function allGood() {
  const now = H.T("2026-09-30T18:00:00Z");
  const outreach = { version: 1, updated_at: "2026-09-29T12:00:00Z", towns: {
    Adams: { outreach: "sent", since: "2026-09-21" },
    Alford: { outreach: "answered", since: "2026-09-14" },
    Ashfield: { outreach: "planned" },
  }, history: [] };
  const w = await H.healthyWorld(now, { roster: 8, outreach });
  stub.stripe = H.stripeFake(H.stripeData(w.roster, now));
  const out = { label: "All good", now: new Date(now).toISOString(),
    ...(await pair(w, { env: { ...STRIPE_ENV, MISSION_OUTREACH_EDIT: "1" } })) };
  stub.stripe = null;
  return out;
}

async function cannotRead() {
  const now = H.T("2026-09-30T18:00:00Z");
  stub.stripe = null;
  const w = await H.healthyWorld(now, { roster: 5 });
  w.r2.fail.add("get:subscribers.json");
  w.r2.fail.add("get:delivery-log.json");
  const a = await get(w);
  w.r2.fail.add("get:refresh-status.json"); // the map view's unguarded read: 503
  const b = await get(w, { query: "?view=map" });
  return { label: "Cannot read", now: new Date(now).toISOString(),
    main: { status: a.status, body: a.body }, map: { status: b.status, body: b.body } };
}

async function notSetUp() {
  const now = H.T("2026-09-30T18:00:00Z");
  stub.stripe = null;
  const w = await H.healthyWorld(now, { roster: 2 });
  const off = { CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "", ADMIN_ALLOWED_EMAILS: "" };
  return { label: "Not set up", now: new Date(now).toISOString(), ...(await pair(w, { env: off })) };
}

const scenarios = [await quietDay(), await badDay(), await allGood(), await cannotRead(), await notSetUp()];

async function buildFresh() {
  return buildDemo({
    variant: VARIANT,
    css: read("admin/mission-app.css"),
    view: read("admin/mission-view.js"),
    render: read("admin/mission-render.js"),
    shellHtml: read("admin/mission.html"),
    towns: read("admin/mission-towns.json"),
    scenarios,
  });
}

const fresh = await buildFresh();
if (process.env.MISSION_DEMO_WRITE === "1") {
  fs.mkdirSync(path.dirname(DEMO), { recursive: true });
  fs.writeFileSync(DEMO, fresh);
}
const file = fs.existsSync(DEMO) ? fs.readFileSync(DEMO, "utf8") : "";

// Splits the file into markup, JSON blocks and executable script bodies.
const jsonBlocks = [...file.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)]
  .map((x) => ({ id: x[1], text: x[2] }));
const scripts = [...file.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
const styles = [...file.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((x) => x[1]);
const outsideJson = file.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, "");
const markup = outsideJson.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");

test("P2-10 scenarios come from the real route", () => {
  assert.equal(scenarios[0].main.status, 200);
  assert.equal(scenarios[0].main.body.headline.text, "Nothing is wrong that this page can see.");
  assert.equal(scenarios[1].main.status, 200);
  assert.equal(scenarios[1].main.body.headline.state, "red");
  assert.equal(H.tileOf(scenarios[1].main.body, "refresh").state, "red");
  assert.equal(scenarios[1].main.body.detail.refresh.fail_kind, "crash");
  assert.equal(scenarios[1].main.body.detail.monday.failed.length, 1);
  // the failed address is also not delivered, so it is in missing too (MONDAY)
  assert.equal(scenarios[1].main.body.detail.monday.missing.length, 2);
  assert.equal(H.tileOf(scenarios[1].main.body, "failed").state, "red");
  assert.equal(H.tileOf(scenarios[1].main.body, "renewals").state, "amber");
  assert.ok(scenarios[1].main.body.needs_you.some((l) => l.id === "sources_down"));
  assert.equal(scenarios[2].main.body.headline.state, "clear");
  assert.equal(scenarios[2].main.body.outreach_edit, true);
  assert.equal(scenarios[2].map.body.towns.Adams.k, "sent");
  assert.equal(scenarios[2].map.body.towns.Alford.k, "answered");
  assert.equal(scenarios[2].map.body.towns.Ashfield.planned, 1);
  assert.equal(scenarios[3].main.status, 200);
  assert.ok(scenarios[3].main.body.needs_you.some((l) => l.id === "unreadable"));
  assert.equal(scenarios[3].map.status, 503);
  assert.equal(scenarios[4].main.status, 403);
  assert.equal(scenarios[4].main.body.reason, "not-configured");
  assert.equal(scenarios[4].map.status, 403);
  for (const s of scenarios.slice(0, 4)) assert.equal(s.main.body.privacy_redactions, 0);
});

test("P2-10 (a) the committed demo equals a fresh build byte for byte", () => {
  assert.ok(file, "docs/mission/demo.html is missing: run MISSION_DEMO_WRITE=1 node --test test/mission/demo.test.mjs");
  assert.equal(file, fresh);
});

test("P2-10 (b) one self-contained file", () => {
  assert.ok(!/\ssrc\s*=/i.test(markup), "src attribute");
  assert.ok(!/<(link|iframe|object|embed)\b/i.test(outsideJson), "external element");
  for (const h of markup.matchAll(/\shref\s*=\s*"([^"]*)"/gi)) assert.equal(h[1], "#");
  for (const s of scripts) assert.ok(!/\bhref\s*=\s*"(?!#")/.test(s));
  for (const u of styles.join("\n").matchAll(/url\(\s*["']?([^"')]*)/g)) assert.ok(u[1].startsWith("data:"), u[1]);
  assert.ok(!/https?:/i.test(outsideJson), "a scheme outside the JSON");
  for (const b of jsonBlocks) {
    for (const u of b.text.matchAll(/https?:[^"\\]*/g)) {
      assert.ok(u[0].startsWith("https://dashboard.stripe.com/") ||
        u[0] === "https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/tl_2024_25_cousub.zip", u[0]);
    }
  }
  const geo = jsonBlocks.find((b) => b.id === "demo-towns");
  assert.deepEqual(JSON.parse(geo.text), JSON.parse(read("admin/mission-towns.json")));
  assert.equal(jsonBlocks.length, 2);
  assert.equal(scripts.length, 1);
  assert.equal(styles.length, 1);
});

test("P2-10 (c) CSP meta is the first child of <head>, hashes match", () => {
  const mm = /<head>\n(<meta [^>]*>)/.exec(file);
  assert.ok(mm, "head");
  const cm = /^<meta http-equiv="Content-Security-Policy" content="([^"]+)">$/.exec(mm[1]);
  assert.ok(cm, "first child is the CSP meta");
  const want = "default-src 'none'; script-src " + sha256(scripts[0]) + "; style-src " + sha256(styles[0]) +
    "; img-src data:; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'";
  assert.equal(cm[1], want);
});

test("P2-10 (d) no network, storage or markup sinks anywhere in the file", () => {
  const bad = [/fetch\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /import\(/, /importScripts/,
    /new Worker/, /localStorage/, /sessionStorage/, /indexedDB/, /caches\./, /serviceWorker/, /document\.cookie/,
    /innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /eval\(/, /new Function/,
    /setAttribute\(\s*["']style/, /setAttribute\(\s*["']on/];
  for (const re of bad) assert.ok(!re.test(file), String(re));
  for (const s of scripts) assert.ok(!/<\/script|<!--/i.test(s));
});

const INVENTED = new Set();
{
  const first = ["Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Harper", "Jordan", "Kendall", "Logan",
    "Morgan", "Parker", "Quinn", "Reese", "Riley", "Rowan", "Sawyer", "Skyler", "Taylor", "Wren", "Ellis", "Jules"];
  const last = ["Testwood", "Fakerly", "Samplesen", "Mockford", "Placeholt"];
  for (let i = 0; i < 40; i++) INVENTED.add(first[i % first.length] + " " + last[i % last.length]);
  for (const x of ["(not on the roster)", "(no name)", "<img src=x onerror=alert(1)>"]) INVENTED.add(x);
}

test("P2-10 (e) privacy: invented data only", () => {
  const emails = (file.match(/[^\s<>@"'(]+@[^\s<>@"')]+\.[A-Za-z]{2,}/g) || []);
  assert.deepEqual([...new Set(emails)], ["owner@example.com"]);
  const rest = file.split("owner@example.com").join("");
  for (const re of [/[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}/, /\b[0-9a-f]{32}\b/, /\b(sk|rk)_(live|test)_[A-Za-z0-9]+/,
    /\bwhsec_[A-Za-z0-9]+/, /\bre_[A-Za-z0-9]{8,}/, /prospects\//, /newsletter\//]) {
    const hit = rest.match(re);
    if (re.source.startsWith("[^\\s<>@")) {
      // CSS at-rules such as @media are not addresses
      assert.ok(!hit || !/@(example|[a-z-]+\.[a-z]{2,})/i.test(hit[0]), String(re) + " " + (hit && hit[0]));
    } else assert.ok(!hit, String(re) + " " + (hit && hit[0]));
  }
  for (const b of jsonBlocks) assert.ok(!/<[A-Za-z]/.test(b.text), "markup inside JSON " + b.id);
  assert.ok(!file.includes(HOSTILE) && !file.includes("<img src=x"), "hostile name unescaped");
  assert.ok(file.includes("\\u003cimg src=x onerror=alert(1)\\u003e"), "hostile name escaped");
  const scen = JSON.parse(jsonBlocks.find((b) => b.id === "demo-scenarios").text);
  const names = [], ids = [], towns = new Set();
  const walk = (v, k) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) walk(x, kk);
    else if (typeof v === "string") {
      if (k === "name") names.push(v);
      for (const id of v.match(/\b(cus|sub|in)_[A-Za-z0-9]+/g) || []) ids.push(id);
    }
  };
  walk(scen);
  for (const n of names) assert.ok(INVENTED.has(n), "name " + n);
  for (const id of ids) assert.match(id, /^(cus|sub|in)_TEST/);
  for (const s of scen) {
    if (s.map.body && s.map.body.towns) for (const [t, f] of Object.entries(s.map.body.towns)) if (f.o || f.planned) towns.add(t);
  }
  for (const t of towns) assert.ok(["Adams", "Alford", "Ashfield"].includes(t), t);
});

// Runs the demo's inline script in a fake DOM laid out like the file.
function bootDemo() {
  const doc = H.fakeDom();
  const add = (parent, tag, id, text) => {
    const e = doc.createElement(tag);
    if (id) e.setAttribute("id", id);
    if (text !== undefined) e.textContent = text;
    parent.appendChild(e);
    return e;
  };
  const bar = add(doc.body, "div", "demo-bar");
  add(bar, "p", null, DEMO_BAR_TEXT);
  add(bar, "div", "demo-scen");
  add(bar, "div", "demo-theme");
  add(doc.body, "div", "mission-root");
  const setup = add(doc.body, "section", "setup-needed", "Setup needed");
  setup.hidden = true;
  for (const b of jsonBlocks) add(doc.body, "script", b.id, b.text);
  vm.runInNewContext(scripts[0], { document: doc, console });
  return doc;
}

test("P2-10 (f) the demo boot renders every scenario in a fake DOM", () => {
  const doc = bootDemo();
  const root = doc.getElementById("mission-root");
  const buttons = doc.getElementById("demo-scen").children;
  assert.equal(buttons.length, 5);
  for (let i = 0; i < 5; i++) {
    buttons[i].click();
    const s = scenarios[i];
    const setup = doc.getElementById("setup-needed");
    if (i === 4) {
      assert.equal(setup.hidden, false, "setup block shown");
      assert.equal(root.findAll((n) => n.hasAttribute("data-tile")).length, 0, "no tile");
      continue;
    }
    assert.equal(setup.hidden, true);
    const mm = V.mainModel(s.main);
    assert.equal(root.byRole("headline")[0].textContent, mm.headline.text, "headline " + i);
    assert.deepEqual(root.byRole("tile-word").map((n) => n.textContent), mm.tiles.map((t) => t.word), "words " + i);
    const lines = [...mm.needs.urgent, ...mm.needs.known];
    const shown = [...root.byRole("need-text"), ...root.byRole("known-text")];
    assert.equal(shown.length, lines.length, "needs lines " + i);
    if (lines.length) assert.equal(shown[0].textContent, lines[0].text, "first line " + i);
    else assert.equal(root.byRole("known").length, 0, "no empty known group");
    assert.equal(root.byRole("signed-in")[0].textContent, "Signed in as owner@example.com");
    const paths = root.findAll((n) => n.hasAttribute("data-town"));
    if (i === 3) {
      assert.equal(paths.length, 0, "scenario 4 has no map colours");
      assert.equal(root.byRole("map-message")[0].textContent, V.MSG.mapFailed);
    } else {
      assert.equal(paths.length, 351);
      assert.equal(root.byRole("attribution")[0].textContent, "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024");
    }
  }
  // an edit in the demo saves nothing and says so
  buttons[2].click();
  const list = root.findAll((n) => n.getAttribute("class") === "tl-b" && n.textContent === "Adams")[0];
  list.click();
  const sheet = root.byRole("sheet")[0];
  assert.equal(sheet.hidden, false);
  const sent = sheet.findAll((n) => n.tagName === "BUTTON" && n.textContent === "sent")[0];
  sent.click();
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    assert.ok(sheet.textContent.includes("Demo: nothing is saved"));
    const themes = doc.getElementById("demo-theme").children;
    themes[1].click();
    assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
    themes[0].click();
    assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
    themes[2].click();
    assert.equal(doc.documentElement.getAttribute("data-theme"), null);
  });
});

test("P2-10 (g) demo bar text, robots meta and title are exact", () => {
  assert.ok(file.includes("<p class=\"demo-t\">" + DEMO_BAR_TEXT + "</p>"));
  assert.ok(file.includes("<meta name=\"robots\" content=\"noindex,nofollow\">"));
  assert.ok(file.includes("<title>" + demoTitle(VARIANT) + "</title>"));
  assert.equal(demoTitle(VARIANT), "Mission Control demo, design B");
  assert.ok(file.indexOf("id=\"demo-bar\"") < file.indexOf("id=\"mission-root\""), "bar outside the root");
});

test("P2-10 (h) size <= 400 KB", () => {
  assert.ok(Buffer.byteLength(file) <= 400 * 1024, String(Buffer.byteLength(file)));
});
