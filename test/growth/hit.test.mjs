// Buy click counting: hit.js accepts one event, stores it apart from page
// views, and /api/traffic and /api/live count exactly what they did before.
// The shared listener (js/buy-click.js) and the pages that load it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import * as H from "./_harness.mjs";

const { g } = await H.growthSetup();
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
let ipSeq = 0;

async function hit(r2, query, o = {}) {
  const h = new Headers({ "user-agent": o.ua || UA, "cf-connecting-ip": "203.0.113." + (++ipSeq % 250),
    "accept-language": "en-US,en;q=0.9" });
  const req = new Request("https://masspermits.com/api/hit" + query, { method: o.method || "POST", headers: h });
  const res = await g.hit.onRequest({ request: req, env: { BUNDLES: r2 } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/gif");
  return res;
}
const puts = (r2) => r2.ops.filter((o) => o.op === "put");

// /api/live is owner-only since the lock-live change: read it as the owner,
// with a locally minted Access token and a stubbed key set. Nothing leaves
// the machine; any other fetch goes to whatever stub was already in place.
const ACCESS_TEAM = "masspermits-test.cloudflareaccess.com";
const ACCESS_AUD = "aud-growth-test";
const ACCESS_KID = "kid-growth-1";
const ACCESS_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ACCESS_JWK = { ...ACCESS_KEY.publicKey.export({ format: "jwk" }), kid: ACCESS_KID, alg: "RS256", use: "sig" };
function ownerToken() {
  const b64u = (x) => Buffer.from(x).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: ACCESS_KID, typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: [ACCESS_AUD], iss: "https://" + ACCESS_TEAM, exp: now + 3600,
    iat: now - 10, nbf: now - 10, email: "owner@example.com", sub: "sub-1", type: "app" }));
  return h + "." + p + "." + createSign("RSA-SHA256").update(h + "." + p).sign(ACCESS_KEY.privateKey).toString("base64url");
}
async function readLiveAsOwner(r2) {
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.origin === "https://" + ACCESS_TEAM && u.pathname === "/cdn-cgi/access/certs")
      return new Response(JSON.stringify({ keys: [ACCESS_JWK] }), { status: 200 });
    return prior(url, init);
  };
  try {
    const request = new Request("https://masspermits.com/api/live", { headers: { "Cf-Access-Jwt-Assertion": ownerToken() } });
    return await g.live.onRequestGet({ request, env: { BUNDLES: r2, CF_ACCESS_TEAM_DOMAIN: ACCESS_TEAM, CF_ACCESS_AUD: ACCESS_AUD } });
  } finally { globalThis.fetch = prior; }
}

test("unknown events are rejected: pixel back, nothing written", async () => {
  const r2 = new H.GrowthR2();
  for (const e of ["", "pageview", "BUY_CLICK", "buy_click ", "buy_click2", "buy-click", "checkout", "%3Cscript%3E", "buy_click&e=x"]) {
    await hit(r2, "?e=" + e + "&p=%2F&l=abc");
  }
  assert.equal(puts(r2).length, 1, "only the literal buy_click in the last case (URLSearchParams takes the first e)");
  assert.ok(puts(r2)[0].key.startsWith("clicks/"));
  const r3 = new H.GrowthR2();
  for (const e of ["", "pageview", "BUY_CLICK", "buy_click2"]) await hit(r3, "?e=" + e);
  assert.equal(puts(r3).length, 0);
});

test("a buy_click is stored under clicks/, with the event and the link path only", async () => {
  const r2 = new H.GrowthR2();
  await hit(r2, "?e=buy_click&p=%2Foffer%2F&s=Google&l=dRmdR80Ms8WzctM9ZJ4gg01%3Fx%3D%3Cb%3E&r=https%3A%2F%2Fexample.com");
  const [p] = puts(r2);
  assert.match(p.key, /^clicks\/\d{4}-\d{2}-\d{2}\/\d+-[0-9a-f]{8}$/);
  const meta = p.opts.customMetadata;
  assert.deepEqual(Object.keys(meta).sort(), ["e", "l"]);
  assert.deepEqual(meta, { e: "buy_click", l: "dRmdR80Ms8WzctM9ZJ4gg01xb" });
});

test("a page view is unchanged: hits/ with the same fields as before", async () => {
  const r2 = new H.GrowthR2();
  await hit(r2, "?p=%2Fpermits%2Fplymouth&s=&r=https%3A%2F%2Fwww.google.com%2F");
  const [p] = puts(r2);
  assert.match(p.key, /^hits\/\d{4}-\d{2}-\d{2}\//);
  assert.equal(p.opts.customMetadata.p, "/permits/plymouth");
  assert.equal(p.opts.customMetadata.s, "google.com");
  assert.equal(p.opts.customMetadata.e, undefined);
});

test("bots are still dropped for both kinds", async () => {
  const r2 = new H.GrowthR2();
  await hit(r2, "?e=buy_click&p=%2F&l=abc", { ua: "Googlebot/2.1" });
  await hit(r2, "?p=%2F", { ua: "HeadlessChrome" });
  assert.equal(puts(r2).length, 0);
});

test("page view counts in /api/traffic, /api/live and the growth page are not changed by buy clicks", async () => {
  const r2 = new H.GrowthR2();
  for (let i = 0; i < 3; i++) await hit(r2, "?p=%2F");
  const read = async () => {
    const t = await (await g.traffic.onRequestGet({ env: { BUNDLES: r2 } })).json();
    const l = await (await readLiveAsOwner(r2)).json();
    return { traffic: t.days[t.days.length - 1].total, live: l.today_total, active: l.active };
  };
  const before = await read();
  assert.deepEqual(before, { traffic: 3, live: 3, active: 3 });
  for (let i = 0; i < 5; i++) await hit(r2, "?e=buy_click&p=%2F&l=dRmdR80Ms8WzctM9ZJ4gg01");
  assert.deepEqual(await read(), before);
  assert.equal([...r2.objects.keys()].filter((k) => k.startsWith("clicks/")).length, 5);
});

// ── the shared listener ─────────────────────────────────────────────────────
const SRC = fs.readFileSync(path.join(H.REPO, "js", "buy-click.js"), "utf8");

function page(href, opts = {}) {
  const sent = [];
  const listeners = {};
  const document = { addEventListener: (t, f, cap) => { (listeners[t] = listeners[t] || []).push({ f, cap }); } };
  const window = {};
  const ctx = {
    window, document, URL,
    location: new URL(opts.at || "https://masspermits.com/?utm_source=newsletter"),
    navigator: { sendBeacon: (u) => { sent.push(u); return true; } },
    Image: function () { this.src = ""; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  vm.runInContext(SRC, ctx); // loaded twice: still one listener
  const a = { nodeType: 1, tagName: "A", href, parentNode: null };
  const span = { nodeType: 1, tagName: "SPAN", parentNode: a };
  const fire = (type, target, button = 0) => { for (const l of listeners[type] || []) l.f({ type, target, button }); };
  return { sent, listeners, a, span, fire };
}

test("js/buy-click.js: one delegated listener, capture phase, buy.stripe.com links only", () => {
  const p = page("https://buy.stripe.com/dRmdR80Ms8WzctM9ZJ4gg01?prefilled_promo_code=FOUNDER2026");
  assert.equal(p.listeners.click.length, 1);
  assert.equal(p.listeners.click[0].cap, true);
  p.fire("click", p.span); // a click on the text inside the link
  assert.equal(p.sent.length, 1);
  const u = new URL(p.sent[0], "https://masspermits.com");
  assert.equal(u.pathname, "/api/hit");
  assert.equal(u.searchParams.get("e"), "buy_click");
  assert.equal(u.searchParams.get("l"), "dRmdR80Ms8WzctM9ZJ4gg01");
  assert.deepEqual([...u.searchParams.keys()].sort(), ["e", "l"], "no page, no source, no referrer, no promo code");
  p.fire("auxclick", p.a, 1); // middle click opens checkout in a new tab
  p.fire("auxclick", p.a, 2); // right click does not
  assert.equal(p.sent.length, 2);
  for (const href of ["https://masspermits.com/#digest", "https://stripe.com/", "https://buy.stripe.com.evil.example/x", "mailto:hello@example.com"]) {
    const q = page(href);
    q.fire("click", q.a);
    assert.equal(q.sent.length, 0, href);
  }
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/cookie|localStorage|sessionStorage|document\.referrer|preventDefault|stopPropagation/.test(code));
});

// ── which pages carry buy links, and that each loads the listener ───────────
const git = (...a) => execFileSync("git", a, { cwd: H.REPO, encoding: "utf8" });

test("every HTML page with a buy.stripe.com link loads /js/buy-click.js exactly once", () => {
  const files = git("grep", "-l", "-F", "--untracked", "buy.stripe.com", "--", "*.html").split("\n").filter(Boolean).sort();
  assert.deepEqual(files, ["agents.html", "index.html", "offer.html", "offer/index.html"],
    "a new page with a buy link: add the script tag, or it is not counted");
  for (const f of files) {
    const html = fs.readFileSync(path.join(H.REPO, f), "utf8");
    assert.equal(html.split('<script src="/js/buy-click.js" defer></script>').length, 2, f);
  }
  const offer = fs.readFileSync(path.join(H.REPO, "offer", "index.html"), "utf8");
  assert.ok(offer.includes("/offer/click"), "the /offer CTA page view beacon stays until the owner decides, so /ops counts do not change");
});
