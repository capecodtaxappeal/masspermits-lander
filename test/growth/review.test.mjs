// Road to 100, review fixes. Each test here failed on the first version of
// the page and passes on the fix. One test per finding, named after it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
const NOW = H.T("2026-09-27T18:00:00Z");          // Sunday 14:00 in Boston
const MON = H.T("2026-09-21T15:00:00Z");          // Monday of this week
const TUE = H.T("2026-09-22T15:00:00Z");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const git = (...a) => execFileSync("git", a, { cwd: H.REPO, encoding: "utf8" });
const puts = (r2) => r2.ops.filter((o) => o.op === "put");
const thisWeek = (res) => res.body.weeks[res.body.weeks.length - 1];

let ipSeq = 0;
async function beacon(r2, query, o = {}) {
  const h = new Headers({ "user-agent": UA, "cf-connecting-ip": o.ip || "198.51.100." + (++ipSeq % 250) });
  for (const [k, v] of Object.entries(o.headers || {})) h.set(k, v);
  const req = new Request("https://masspermits.com/api/hit" + query, { method: o.method || "POST", headers: h });
  const res = await g.hit.onRequest({ request: req, env: { BUNDLES: r2 } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/gif");
}

async function route(data, o = {}) {
  g.stripe.resetGrowthCaches();
  const r2 = o.r2 || new H.GrowthR2();
  stub.stripe = o.stripe || H.stripeServer(data, o);
  stub.reset();
  const res = await call({ env: envOf(r2, H.stripeEnv()), now: o.now ?? NOW });
  assert.equal(res.status, 200);
  return res;
}

function mount() {
  const doc = H.fakeDocumentFrom('<div id="app"></div>');
  return doc.getElementById("app");
}
// The funnel cards: [title, { label: value text }]
function cards(root) {
  return root.all((n) => n.getAttribute("class") === "card").map((c) => {
    const rows = {};
    for (const li of c.all((n) => n.localName === "li")) {
      const [label, val] = li.children;
      const n = val.childNodes[0];
      rows[label.textContent] = n && n.tagName === "#text" ? n._text : val.textContent;
    }
    return [c.children[0].textContent, rows];
  });
}

// ── hit.js ──────────────────────────────────────────────────────────────────
test("privacy: a buy_click stores no caller text, only the event and the link path", async () => {
  const r2 = new H.GrowthR2();
  await beacon(r2, "?e=buy_click&p=%2F%3Femail%3Djane%40doe.com%26name%3DJane%20Doe&s=jane%40doe.com&l=dRmdR80Ms8WzctM9ZJ4gg01");
  const [p] = puts(r2);
  assert.ok(p && p.key.startsWith("clicks/"));
  assert.deepEqual(p.opts.customMetadata, { e: "buy_click", l: "dRmdR80Ms8WzctM9ZJ4gg01" });
  assert.ok(!JSON.stringify(p.opts).includes("@"));
  // the listener no longer sends them either
  const src = fs.readFileSync(path.join(H.REPO, "js", "buy-click.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/[?&]p=|[?&]s=|utm_source|location\.pathname/.test(src), "buy-click.js sends only e and l");
});

test("forged clicks: a buy_click from another site is not stored; a same origin one is", async () => {
  const r2 = new H.GrowthR2();
  await beacon(r2, "?e=buy_click&l=dRmdR80Ms8WzctM9ZJ4gg01", { headers: { "sec-fetch-site": "cross-site" } });
  await beacon(r2, "?e=buy_click&l=dRmdR80Ms8WzctM9ZJ4gg01", { headers: { "sec-fetch-site": "same-site" } });
  await beacon(r2, "?e=buy_click&l=dRmdR80Ms8WzctM9ZJ4gg01", { headers: { origin: "https://evil.example" } });
  await beacon(r2, "?e=buy_click&l=dRmdR80Ms8WzctM9ZJ4gg01", { headers: { origin: "null" } });
  assert.equal(puts(r2).length, 0);
  await beacon(r2, "?e=buy_click&l=dRmdR80Ms8WzctM9ZJ4gg01",
    { headers: { "sec-fetch-site": "same-origin", origin: "https://masspermits.com" } });
  assert.equal(puts(r2).length, 1);
  // page views keep their old rule: no origin check
  await beacon(r2, "?p=%2F", { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(puts(r2).length, 2);
});

test("buy clicks have their own per IP cap and never use up the page view cap", async () => {
  const r2 = new H.GrowthR2();
  const ip = "192.0.2.77";
  for (let i = 0; i < 39; i++) await beacon(r2, "?p=%2F", { ip });
  for (let i = 0; i < 5; i++) await beacon(r2, "?e=buy_click&l=dRmdR80Ms8WzctM9ZJ4gg01", { ip });
  await beacon(r2, "?p=%2Fpricing", { ip });
  const hits = puts(r2).filter((p) => p.key.startsWith("hits/"));
  assert.equal(hits.length, 40, "the 40th page view is still stored after 5 Buy clicks");
  // and the click cap is its own, smaller one
  const ip2 = "192.0.2.78";
  for (let i = 0; i < 40; i++) await beacon(r2, "?e=buy_click&l=dRmdR80Ms8WzctM9ZJ4gg01", { ip: ip2 });
  const clicks2 = puts(r2).filter((p) => p.key.startsWith("clicks/")).length - 5;
  assert.ok(clicks2 > 0 && clicks2 <= 10, "at most 10 clicks per IP per isolate, got " + clicks2);
  await beacon(r2, "?p=%2F", { ip: ip2 });
  assert.equal(puts(r2).filter((p) => p.key.startsWith("hits/")).length, 41);
});

test("/ops page view counts are unchanged: the /offer CTA beacon is kept exactly as on main", () => {
  let base = null;
  for (const ref of ["origin/main", "main"]) {
    try { base = git("merge-base", ref, "HEAD").trim(); break; } catch (_) { /* next */ }
  }
  assert.ok(base);
  const diff = git("diff", "--unified=0", base, "--", "offer/index.html");
  const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.deepEqual(removed, [], "no line of the old /offer page is removed");
  const html = fs.readFileSync(path.join(H.REPO, "offer", "index.html"), "utf8");
  assert.ok(html.includes("'/offer/click'"), "CTA clicks still log the /offer/click page view /ops has always counted");
});

// ── the owner notes ─────────────────────────────────────────────────────────
test("owner notes are not served from the site: no docs/growth, and no added file names the other product", () => {
  assert.ok(!fs.existsSync(path.join(H.REPO, "docs", "growth")), "the repo root is the Pages build output");
  let base = null;
  for (const ref of ["origin/main", "main"]) {
    try { base = git("merge-base", ref, "HEAD").trim(); break; } catch (_) { /* next */ }
  }
  const added = git("diff", "--name-only", "--diff-filter=AM", base).split("\n").filter(Boolean)
    .filter((p) => fs.existsSync(path.join(H.REPO, p)));
  const other = new RegExp("IR" + "\\s*" + "Watch", "i");
  for (const f of added) {
    if (f === "functions/api/stripe-webhook.js") continue; // already on main, not touched here
    assert.ok(!other.test(fs.readFileSync(path.join(H.REPO, f), "utf8")), f + " names the other product");
  }
  // A /docs/* rule is only a leftover when the folder is gone. The manual
  // inputs pages keep their own docs/ folder and noindex it on purpose.
  const docsRule = /^\/docs\/\*/m.test(fs.readFileSync(path.join(H.REPO, "_headers"), "utf8"));
  assert.ok(!docsRule || fs.existsSync(path.join(H.REPO, "docs")), "no header rule left for a removed folder");
});

// ── Stripe listing ──────────────────────────────────────────────────────────
test("real Checkout Session ids (cs_live_a1...) page past 100: all 150 are counted", async () => {
  const sessions = [];
  const first = g.data.weekGrid(NOW).start;
  for (let i = 0; i < 150; i++) {
    sessions.push(H.session(first + H.DAY + i * 12 * H.HOUR, "expired", H.FEED,
      { id: "cs_live_a1" + String(i).padStart(6, "0") + "Xy" }));
  }
  const res = await route({ sessions, subscriptions: [] });
  const calls = stub.stripeCalls().filter((c) => c.url.includes("/v1/checkout/sessions"));
  assert.equal(calls.length, 2);
  assert.equal(res.body.sources.stripe.state, "ok");
  const total = res.body.weeks.reduce((a, w) => a + w.checkouts, 0);
  assert.equal(total, 150);
  for (const w of res.body.weeks) assert.ok(!w.at_least.includes("checkouts"));
  // a cursor that is not a Stripe id shape is still never echoed
  const bad = [H.session(NOW - H.DAY, "expired", H.FEED, { id: "cs_live_a1&x=1" }), H.session(NOW - 2 * H.DAY, "expired")];
  const r2 = await route({ sessions: bad, subscriptions: [] }, { pageSize: 1 });
  assert.equal(r2.body.sources.stripe.state, "partial");
  assert.ok(!stub.stripeCalls().some((c) => c.url.includes("x%3D1") || c.url.includes("&x=1")));
});

test("a buyer who abandoned one checkout and paid on a second is not counted as abandoned", async () => {
  const buyer = { customer: "cus_TESTsame01", customer_details: { email: "Same.Buyer@Example.com", name: "Avery Testwood" } };
  const emailOnly = { customer: null, customer_details: { email: "second@example.com" } };
  const res = await route({
    sessions: [
      H.session(MON, "expired", H.FEED, buyer),
      H.session(TUE, "complete", H.FEED, { ...buyer, customer_details: { email: "same.buyer@example.com" } }),
      H.session(MON, "expired", H.FEED, emailOnly),                                         // matched by email
      H.session(TUE + H.HOUR, "complete", H.FEED, { customer: "cus_TESTother2", customer_details: { email: "second@example.com" } }),
      H.session(TUE, "expired", H.FEED, { customer: null, customer_details: { email: "gone@example.com" } }), // a real abandon
    ],
    subscriptions: [],
  });
  const w = thisWeek(res);
  assert.equal(w.checkouts, 5);
  assert.equal(w.paid, 2);
  assert.equal(w.abandoned, 1);
  assert.ok(!res.text.includes("example.com") && !res.text.includes("cus_TEST"));
  const snap = await g.stripe.growthStripe(H.stripeEnv(), NOW + 11 * 60000, g.data.weekGrid(NOW).start);
  for (const s of snap.sessions.items) assert.deepEqual(Object.keys(s).sort(), ["created", "status"]);
});

test("a completed checkout with no charge (100% coupon, trial) or an unpaid delayed method is not Paid", async () => {
  const res = await route({
    sessions: [
      H.session(MON, "complete", H.FEED, { payment_status: "paid" }),
      H.session(MON, "complete", H.FEED, { payment_status: "no_payment_required" }),
      H.session(MON, "complete", H.FEED, { payment_status: "unpaid" }),
    ],
    subscriptions: [],
  });
  const w = thisWeek(res);
  assert.equal(w.checkouts, 3);
  assert.equal(w.paid, 1);
  assert.equal(w.abandoned, 0);
});

// ── rules ───────────────────────────────────────────────────────────────────
test("the 24 hour rule is \"over 24 hours\": open exactly 24h is still in progress", () => {
  const c = g.data.classifySession;
  assert.equal(c({ status: "open", created: (NOW - 24 * H.HOUR) / 1000 }, NOW), "in_progress");
  assert.equal(c({ status: "open", created: (NOW - 24 * H.HOUR - 1000) / 1000 }, NOW), "abandoned");
});

test("a subscription that starts exactly at a week end belongs to the next week, not the one before", async () => {
  const grid = g.data.weekGrid(NOW);
  const res = await route({ sessions: [], subscriptions: [H.sub(grid.weeks[11].end, "active")] });
  assert.equal(res.body.weeks[11].subscribers, 0);
  assert.equal(res.body.weeks[12].subscribers, 1);
});

// ── the page ────────────────────────────────────────────────────────────────
test("funnel cards say \"unavailable\" when a source failed, not \"no data\"", async () => {
  const r2 = new H.GrowthR2();
  r2.hit(NOW - H.DAY);
  r2.fail.add("list:hits/");
  r2.fail.add("list:clicks/");
  const res = await route({}, { r2, stripe: () => { throw new Error("socket hang up"); } });
  const root = mount();
  assert.equal(g.render.render(root, { status: 200, json: res.body }), "ok");
  const got = cards(root);
  assert.equal(got.length, 2);
  for (const [title, rows] of got) {
    for (const label of ["Visits", "Clicked Buy", "Opened checkout", "Paid", "Abandoned"]) {
      assert.equal(rows[label], "unavailable", title + ": " + label);
    }
  }
  // a counter that had not started yet still says so
  const res2 = await route({ sessions: [], subscriptions: [] });
  const root2 = mount();
  g.render.render(root2, { status: 200, json: res2.body });
  assert.equal(cards(root2)[1][1]["Clicked Buy"], "not yet");
});

test("funnel totals keep the \"at least\" mark and say how many weeks each one covers", async () => {
  const grid = g.data.weekGrid(NOW);
  const wk = grid.weeks;
  const r2 = new H.GrowthR2();
  // visits start midweek in week 9 (30), none in week 10, 30 in week 11
  for (let i = 0; i < 30; i++) r2.hit(wk[9].start + 3 * H.DAY + i * 1000);
  for (let i = 0; i < 30; i++) r2.hit(wk[11].start + 2 * H.DAY + i * 1000);
  r2.click(wk[11].start + 2 * H.DAY + 5000);           // clicks start midweek in week 11
  const res = await route({ sessions: [], subscriptions: [] }, { r2 });
  const f = res.body.funnel.last_4_weeks;
  assert.equal(f.totals.visits, 60);
  assert.equal(f.covered.visits, 3);
  assert.ok(f.at_least.includes("visits"));
  assert.equal(f.totals.buy_clicks, 1);
  assert.equal(f.covered.buy_clicks, 1);
  assert.ok(f.at_least.includes("buy_clicks"));
  const root = mount();
  g.render.render(root, { status: 200, json: res.body });
  const last4 = cards(root)[1][1];
  assert.equal(last4.Visits, "≥ 60 (3 of 4 weeks)");
  assert.equal(last4["Clicked Buy"], "≥ 1 (1 of 4 weeks)");
});

test("the headline keeps the \"at least\" mark when the subscriptions list was cut short", async () => {
  const subs = [];
  for (let i = 0; i < 6; i++) subs.push(H.sub(NOW - (40 + i) * H.DAY, "active"));
  const res = await route({ sessions: [], subscriptions: subs }, { pageSize: 1 });
  assert.equal(res.body.paying_at_least, true);
  const root = mount();
  g.render.render(root, { status: 200, json: res.body });
  assert.equal(root.byPart("headline")[0].textContent, "≥ 5 of 100");
  const ok = await route({ sessions: [], subscriptions: subs.slice(0, 2) });
  assert.equal(ok.body.paying_at_least, false);
});
