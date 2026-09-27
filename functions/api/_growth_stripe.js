// MassPermits: GET-only Stripe reader for the Road to 100 page.
//
// Same rules as Mission Control's reader (_mission_stripe.js), and the same
// outbound door: every request goes through its stripeGet(), which refuses
// anything that is not a GET to https://api.stripe.com. This file adds no
// fetch of its own.
//
//   * Only the restricted LIVE read key STRIPE_READ_KEY ("rk_live_..."). A
//     missing key is "not-connected"; any other shape is "refused" and makes
//     zero calls.
//   * Only MassPermits prices (MASSPERMITS_PRICE_IDS). The Stripe account also
//     serves another product, so an object counts only when one of its line
//     items carries an allowed price id. Never by amount.
//   * The Weekly Feed only, when MASSPERMITS_FEED_PRICE_IDS is set (each id
//     must also be on MASSPERMITS_PRICE_IDS). Unset, every MassPermits price
//     counts and the page says so ("scope": "all").
//
// Two lists: checkout sessions opened since the first week on the page (any
// status), and subscriptions (all statuses). Only a PROJECTION leaves:
//   session:      { created, status }
//   subscription: { start, ended, status }
// No id, customer, email, name, amount or card detail is kept or cached.
// The projection is cached per isolate for 10 minutes.

import { stripeGet } from "./_mission_stripe.js";

const API_ORIGIN = "https://api.stripe.com";
const PAGE_LIMIT = 100;
const MAX_PAGES = { sessions: 10, subscriptions: 5 };  // still has_more after this: "partial"
const CACHE_MS = 10 * 60000;
const KEY_SHAPE = /^rk_live_[A-Za-z0-9]{10,}$/;
const CURSOR_SHAPE = /^[a-z]+_[A-Za-z0-9]+$/;

let cache = null; // { at, sig, snap }

export function resetGrowthCaches() {
  cache = null;
}

export const GROWTH_STRIPE_LIMITS = Object.freeze({ PAGE_LIMIT, MAX_PAGES, CACHE_MS });

function ids(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// { state: "ok", key, prices: Set, scope: "feed"|"all", sig } or a refusal.
export function growthConfig(env) {
  const key = env ? env.STRIPE_READ_KEY : undefined;
  if (key === undefined || key === null || key === "") {
    return { state: "not-connected", reason: "no read key" };
  }
  if (typeof key !== "string" || !KEY_SHAPE.test(key)) {
    return { state: "refused", reason: "not a restricted live read key" };
  }
  const all = ids(env && env.MASSPERMITS_PRICE_IDS);
  if (!all.length) return { state: "not-connected", reason: "price list missing" };
  const feedRaw = ids(env && env.MASSPERMITS_FEED_PRICE_IDS);
  let prices = all;
  let scope = "all";
  if (feedRaw.length) {
    prices = feedRaw.filter((p) => all.includes(p));
    if (!prices.length) {
      return { state: "not-connected", reason: "the Weekly Feed price is not on the MassPermits price list" };
    }
    scope = "feed";
  }
  return { state: "ok", key, prices: new Set(prices), scope, sig: scope + ":" + prices.slice().sort().join(",") };
}

// { state: "ok"|"partial"|"unavailable", items, oldest }  oldest: the smallest
// `created` seen on any page (every product), so a cut-short list can say from
// when it is complete.
async function listAll(path, params, key, maxPages) {
  const items = [];
  let after = null;
  let oldest = null;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams(params);
    q.set("limit", String(PAGE_LIMIT));
    if (after) q.set("starting_after", after);
    let body;
    try {
      const r = await stripeGet(API_ORIGIN + path + "?" + q.toString(), key);
      if (!r || !r.ok) return { state: "unavailable", items: [], oldest: null };
      body = await r.json();
    } catch (_) {
      return { state: "unavailable", items: [], oldest: null };
    }
    if (!body || !Array.isArray(body.data)) return { state: "unavailable", items: [], oldest: null };
    for (const o of body.data) {
      items.push(o);
      const c = o && typeof o.created === "number" ? o.created : null;
      if (c !== null && (oldest === null || c < oldest)) oldest = c;
    }
    if (!body.has_more) return { state: "ok", items, oldest };
    const last = body.data[body.data.length - 1];
    const id = last && typeof last.id === "string" ? last.id : "";
    // An id that is not a plain Stripe id is never echoed into the next URL.
    if (!CURSOR_SHAPE.test(id)) return { state: "partial", items, oldest };
    after = id;
  }
  return { state: "partial", items, oldest };
}

// Both line shapes: line.price.id (older) and line.pricing.price_details.price.
// The same rule as linePrice() in _mission_stripe.js.
function linePrice(line) {
  if (!line || typeof line !== "object") return null;
  const a = line.price && typeof line.price === "object" ? line.price.id : line.price;
  if (typeof a === "string") return a;
  const b = line.pricing && line.pricing.price_details && line.pricing.price_details.price;
  if (typeof b === "string") return b;
  if (b && typeof b === "object" && typeof b.id === "string") return b.id;
  return null;
}

function carries(o, member, prices) {
  const l = o && o[member];
  const data = l && Array.isArray(l.data) ? l.data : [];
  return data.some((line) => prices.has(linePrice(line)));
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" ? v : null);

function projectSession(cs, prices) {
  if (!carries(cs, "line_items", prices)) return null;
  const created = num(cs.created);
  if (created === null) return null;
  return { created, status: str(cs.status) };
}

function projectSubscription(s, prices) {
  if (!carries(s, "items", prices)) return null;
  const start = num(s.start_date) !== null ? num(s.start_date) : num(s.created);
  if (start === null) return null;
  return { start, ended: num(s.ended_at), status: str(s.status) };
}

export async function growthStripe(env, now, sinceMs) {
  const cfg = growthConfig(env);
  if (cfg.state !== "ok") return { state: cfg.state, reason: cfg.reason, scope: null };

  const since = Math.floor(sinceMs / 1000);
  const sig = cfg.sig + "|" + since;
  if (cache && cache.sig === sig && now - cache.at >= 0 && now - cache.at < CACHE_MS) return cache.snap;

  const [sess, subs] = await Promise.all([
    listAll("/v1/checkout/sessions", { "created[gte]": String(since), "expand[]": "data.line_items" },
      cfg.key, MAX_PAGES.sessions),
    listAll("/v1/subscriptions", { status: "all" }, cfg.key, MAX_PAGES.subscriptions),
  ]);

  const section = (res, project) => ({
    state: res.state,
    items: res.state === "unavailable" ? [] : res.items.map((o) => project(o, cfg.prices)).filter(Boolean),
  });
  const sessions = section(sess, projectSession);
  // Stripe lists newest first: a cut-short list is complete back to the
  // oldest session it did return (in ms, for the week grid).
  sessions.complete_from = sess.state === "partial" && sess.oldest !== null ? sess.oldest * 1000 : null;
  const subscriptions = section(subs, projectSubscription);

  const states = [sess.state, subs.state];
  const snap = {
    state: states.includes("unavailable") ? "unavailable" : states.includes("partial") ? "partial" : "ok",
    reason: states.includes("unavailable") ? "a Stripe list could not be read"
      : states.includes("partial") ? "a Stripe list still had more after its page limit" : "",
    scope: cfg.scope,
    sessions,
    subscriptions,
  };
  if (snap.state !== "unavailable") cache = { at: now, sig, snap };
  return snap;
}
