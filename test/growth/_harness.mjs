// Test harness for the Road to 100 page. Test-only; nothing here ships.
//
// Builds on test/mission/_harness.mjs (JWT minter, fetch stub that throws on
// any unexpected URL, fake DOM, request helper) and adds:
//   * load(): copies the shipped growth files and everything they import, byte
//     for byte, into a temp dir with {"type":"module"} and imports from there;
//   * GrowthR2: the mission FakeR2 plus customMetadata on put and startAfter on
//     list, as R2 does;
//   * synthetic Stripe fixtures (cs_live_a1TEST..., the real id shape with a second
//     underscore; sub_TEST..., cus_TEST..., @example.com).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as MH from "../mission/_harness.mjs";

export * from "../mission/_harness.mjs";

const FILES = [
  "functions/api/_cf-access.js",
  "functions/api/_owner_gate.js",
  "functions/api/_mission_r2.js",
  "functions/api/_mission_stripe.js",
  "functions/api/_growth_data.js",
  "functions/api/_growth_stripe.js",
  "functions/admin/api/growth.js",
  "functions/api/hit.js",
  "functions/api/traffic.js",
  "functions/api/live.js",
  "admin/growth-render.js",
];

let dir = null;
export function growthCopy() {
  if (dir) return dir;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "growth-test-"));
  for (const rel of FILES) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(MH.REPO, rel), dst);
  }
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  return dir;
}

let mods = null;
export async function loadGrowth() {
  if (mods) return mods;
  const d = growthCopy();
  const imp = (rel) => import(pathToFileURL(path.join(d, rel)).href);
  mods = {
    route: await imp("functions/admin/api/growth.js"),
    data: await imp("functions/api/_growth_data.js"),
    stripe: await imp("functions/api/_growth_stripe.js"),
    hit: await imp("functions/api/hit.js"),
    traffic: await imp("functions/api/traffic.js"),
    live: await imp("functions/api/live.js"),
    render: await imp("admin/growth-render.js"),
  };
  return mods;
}

export class GrowthR2 extends MH.FakeR2 {
  async put(key, value, opts = {}) {
    this.ops.push({ op: "put", key, opts });
    this._check("put", key);
    this.set(key, String(value), { customMetadata: (opts && opts.customMetadata) || {} });
    return this._meta(key, this.objects.get(key));
  }
  async list(opts = {}) {
    if (opts.startAfter && !opts.cursor) {
      const prefix = opts.prefix || "";
      const all = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const skip = all.filter((k) => k <= opts.startAfter).length;
      return super.list({ ...opts, cursor: String(skip) });
    }
    return super.list(opts);
  }
  // A page view as hit.js writes it: hits/<UTC day>/<ms>-<8 hex>
  hit(ms, meta = {}) {
    const key = "hits/" + new Date(ms).toISOString().slice(0, 10) + "/" + ms + "-" + MH.md5(String(ms) + Math.random()).slice(0, 8);
    this.set(key, "", { customMetadata: { s: "direct", p: "/", ...meta } });
    return key;
  }
  click(ms, link = "dRmdR80Ms8WzctM9ZJ4gg01", meta = {}) {
    const key = "clicks/" + new Date(ms).toISOString().slice(0, 10) + "/" + ms + "-" + MH.md5(String(ms) + Math.random()).slice(0, 8);
    this.set(key, "", { customMetadata: { e: "buy_click", p: "/", s: "direct", l: link, ...meta } });
    return key;
  }
}

export const FEED = "price_TESTfeedmonthly";
export const PACK = "price_TESTleadpack";
export const OTHER = "price_TESTotherproduct";
export const stripeEnv = (over = {}) => ({
  STRIPE_READ_KEY: MH.liveKey(),
  MASSPERMITS_PRICE_IDS: FEED + "," + PACK,
  MASSPERMITS_FEED_PRICE_IDS: FEED,
  ...over,
});

let seq = 0;
export function session(createdMs, status, price = FEED, extra = {}) {
  seq++;
  return {
    id: "cs_live_a1TEST" + String(seq).padStart(8, "0"), object: "checkout.session",
    created: Math.floor(createdMs / 1000), status,
    payment_status: status === "complete" ? "paid" : "unpaid",
    customer: "cus_TEST" + String(seq).padStart(6, "0"),
    customer_details: { email: "buyer" + seq + "@example.com", name: "Avery Testwood" },
    amount_total: 9900, currency: "usd", mode: "subscription",
    line_items: { object: "list", data: [{ price: { id: price } }] },
    ...extra,
  };
}

export function sub(startMs, status, o = {}) {
  seq++;
  return {
    id: "sub_TEST" + String(seq).padStart(8, "0"), object: "subscription",
    customer: "cus_TEST" + String(seq).padStart(6, "0"),
    status, start_date: Math.floor(startMs / 1000), created: Math.floor(startMs / 1000),
    ended_at: o.ended ? Math.floor(o.ended / 1000) : null,
    canceled_at: o.canceled ? Math.floor(o.canceled / 1000) : null,
    cancel_at: o.cancelAt ? Math.floor(o.cancelAt / 1000) : null,
    items: { object: "list", data: [{ id: "si_TEST" + seq, price: { id: o.price || FEED, unit_amount: 9900 } }] },
  };
}

// A fake Stripe for the two lists the page reads: newest first, pages, has_more.
export function stripeServer(data, o = {}) {
  const pageSize = o.pageSize || 100;
  return (u, method) => {
    if (method !== "GET") return { status: 405, body: {} };
    let list;
    if (u.pathname === "/v1/checkout/sessions") {
      const gte = Number(u.searchParams.get("created[gte]") || 0);
      list = (data.sessions || []).filter((s) => s.created >= gte);
    } else if (u.pathname === "/v1/subscriptions") {
      list = data.subscriptions || [];
    } else return null;
    if (o.fail && o.fail(u.pathname)) return { status: 500, body: { error: { message: "boom" } } };
    list = list.slice().sort((a, b) => b.created - a.created);
    const after = u.searchParams.get("starting_after");
    const start = after ? list.findIndex((x) => x.id === after) + 1 : 0;
    const page = list.slice(start, start + pageSize);
    return { status: 200, body: { object: "list", data: page, has_more: start + pageSize < list.length } };
  };
}

// One signed-in owner, ready to call the route.
export async function growthSetup() {
  const g = await loadGrowth();
  const stub = MH.installFetch();
  const signer = MH.makeSigner();
  stub.jwks[MH.TEAM] = [signer.jwk];
  const owner = (over) => MH.mint(signer, MH.claims(over));
  const call = async (o) => {
    const h = new Headers();
    const token = o.token === undefined ? owner() : o.token;
    if (token) h.set("Cf-Access-Jwt-Assertion", token);
    if (o.cookie) h.set("Cookie", o.cookie);
    if (o.growth !== false) h.set("X-MassPermits-Growth", "1");
    if (o.site !== null) h.set("Sec-Fetch-Site", o.site || "same-origin");
    for (const [k, v] of Object.entries(o.headers || {})) h.set(k, v);
    const url = "https://" + (o.host || "masspermits.com") + "/admin/api/growth" + (o.query || "");
    const res = await g.route.onRequestGet({ request: new Request(url, { method: o.method || "GET", headers: h }),
      env: o.env, now: o.now });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { body = null; }
    return { status: res.status, headers: res.headers, text, body };
  };
  const envOf = (r2, over = {}) => MH.env(r2, over);
  return { g, stub, signer, owner, call, envOf };
}
