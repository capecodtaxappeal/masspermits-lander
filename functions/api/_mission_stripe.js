// MassPermits — GET-only Stripe reader for Mission Control.
//
// Runs only with a restricted LIVE read key (STRIPE_READ_KEY, "rk_live_...")
// and a price list (MASSPERMITS_PRICE_IDS). Anything else makes zero calls:
// a missing key or price list is "not-connected", a key of any other shape
// (a secret key, a test key, stray whitespace) is "refused". A secret key
// could write; this file must never be able to.
//
// The Stripe account also serves another product, so every object is kept
// only when one of its line items carries a MassPermits price id. Never by
// amount. Renewal dates come from items.data[].current_period_end: on this API
// version they are not on the Subscription object.
//
// Only a PROJECTION leaves this file (ids, statuses, amounts, dates, price ids,
// intervals, flags); raw Stripe objects are never cached or returned.

const API_ORIGIN = "https://api.stripe.com";
const STRIPE_VERSION = "2026-08-26.dahlia";
const PAGE_LIMIT = 100;
const MAX_PAGES = 3;                  // per list; still has_more -> "partial"
const CACHE_MS = 5 * 60_000;          // per isolate, projection only
const WINDOW_MS = 30 * 86400_000;     // paid invoices and checkout sessions
const KEY_SHAPE = /^rk_live_[A-Za-z0-9]{10,}$/;
const CURSOR_SHAPE = /^[a-z]+_[A-Za-z0-9]+$/;
const WATCHED_EVENTS = ["invoice.payment_failed", "customer.subscription.deleted"];

let cache = null; // { at, sig, snap }

export function resetMissionCaches() {
  cache = null;
}

// The one outbound call in Mission Control. Anything that is not a GET to
// https://api.stripe.com throws before a request is made.
export async function stripeGet(url, key, method = "GET") {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    throw new Error("outbound_blocked");
  }
  if (u.origin !== API_ORIGIN || method !== "GET") throw new Error("outbound_blocked");
  return fetch(u.href, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + key,
      "Stripe-Version": STRIPE_VERSION,
      Accept: "application/json",
    },
  });
}

async function listAll(path, params, key) {
  const items = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams(params);
    q.set("limit", String(PAGE_LIMIT));
    if (after) q.set("starting_after", after);
    let body;
    try {
      const r = await stripeGet(API_ORIGIN + path + "?" + q.toString(), key);
      if (!r || !r.ok) return { state: "unavailable", items: [] };
      body = await r.json();
    } catch (_) {
      return { state: "unavailable", items: [] };
    }
    if (!body || !Array.isArray(body.data)) return { state: "unavailable", items: [] };
    items.push(...body.data);
    if (!body.has_more) return { state: "ok", items };
    const last = body.data[body.data.length - 1];
    const id = last && typeof last.id === "string" ? last.id : "";
    // An id that is not a plain Stripe id is never echoed into the next URL.
    if (!CURSOR_SHAPE.test(id)) return { state: "partial", items };
    after = id;
  }
  return { state: "partial", items };
}

function idOf(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof v.id === "string") return v.id;
  return null;
}

// Both line shapes: line.price.id (older) and line.pricing.price_details.price.
function linePrice(line) {
  if (!line || typeof line !== "object") return null;
  const a = line.price && typeof line.price === "object" ? line.price.id : line.price;
  if (typeof a === "string") return a;
  const b = line.pricing && line.pricing.price_details && line.pricing.price_details.price;
  if (typeof b === "string") return b;
  if (b && typeof b === "object" && typeof b.id === "string") return b.id;
  return null;
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v) {
  return typeof v === "string" ? v : null;
}

function lines(o, member) {
  const l = o && o[member];
  return l && Array.isArray(l.data) ? l.data : [];
}

function projectSubscription(s, prices) {
  const items = lines(s, "items");
  const mine = items.filter((it) => prices.has(linePrice(it)));
  if (!mine.length) return null;
  const others = items.map(linePrice).filter((p) => p && !prices.has(p));
  const ends = items.map((it) => num(it && it.current_period_end)).filter((n) => n !== null);
  const first = mine[0];
  const price = first.price && typeof first.price === "object" ? first.price : {};
  const recurring = price.recurring || (first.plan && { interval: first.plan.interval,
    interval_count: first.plan.interval_count }) || {};
  // Every MassPermits item counts (a feed and a radar price can share one
  // subscription; Stripe requires one interval per subscription).
  let amount = 0, priced = false;
  for (const it of mine) {
    const p = it.price && typeof it.price === "object" ? it.price : {};
    const u = num(p.unit_amount) !== null ? num(p.unit_amount) : num(it.plan && it.plan.amount);
    if (u === null) continue;
    amount += u * (num(it.quantity) || 1);
    priced = true;
  }
  return {
    id: str(s.id),
    customer: idOf(s.customer),
    status: str(s.status),
    cancel_at_period_end: s.cancel_at_period_end === true,
    trial_end: num(s.trial_end),
    current_period_end: ends.length ? Math.min(...ends) : null,
    price_id: linePrice(first),
    interval: str(recurring.interval),
    interval_count: num(recurring.interval_count) || 1,
    amount: priced ? amount : null,
    currency: str(price.currency) || str(s.currency),
    unknown_prices: others.length,
  };
}

function projectInvoice(inv, prices) {
  if (!lines(inv, "lines").some((l) => prices.has(linePrice(l)))) return null;
  const parentSub = inv.parent && inv.parent.subscription_details &&
    inv.parent.subscription_details.subscription;
  return {
    id: str(inv.id),
    customer: idOf(inv.customer),
    status: str(inv.status),
    amount_paid: num(inv.amount_paid),
    amount_due: num(inv.amount_due),
    currency: str(inv.currency),
    created: num(inv.created),
    attempt_count: num(inv.attempt_count),
    billing_reason: str(inv.billing_reason),
    subscription: idOf(inv.subscription) || idOf(parentSub),
  };
}

function projectSession(cs, prices) {
  if (!lines(cs, "line_items").some((l) => prices.has(linePrice(l)))) return null;
  return {
    id: str(cs.id),
    customer: idOf(cs.customer),
    mode: str(cs.mode),
    amount_total: num(cs.amount_total),
    currency: str(cs.currency),
    created: num(cs.created),
    invoice: idOf(cs.invoice),
  };
}

function projectWebhooks(list) {
  const has = {};
  for (const ev of WATCHED_EVENTS) has[ev] = false;
  for (const w of list) {
    if (!w || w.status === "disabled" || !Array.isArray(w.enabled_events)) continue;
    for (const ev of WATCHED_EVENTS) {
      if (w.enabled_events.includes(ev) || w.enabled_events.includes("*")) has[ev] = true;
    }
  }
  return has;
}

function section(res, project) {
  return {
    state: res.state,
    items: res.state === "unavailable" ? [] : res.items.map(project).filter(Boolean),
  };
}

export async function stripeSnapshot(env, now) {
  const key = env ? env.STRIPE_READ_KEY : undefined;
  if (key === undefined || key === null || key === "") {
    return { state: "not-connected", reason: "no read key" };
  }
  if (typeof key !== "string" || !KEY_SHAPE.test(key)) {
    return { state: "refused", reason: "not a restricted live read key" };
  }
  const priceList = String((env && env.MASSPERMITS_PRICE_IDS) || "").split(",")
    .map((s) => s.trim()).filter(Boolean);
  if (!priceList.length) return { state: "not-connected", reason: "price list missing" };

  const sig = priceList.slice().sort().join(",");
  if (cache && cache.sig === sig && now - cache.at >= 0 && now - cache.at < CACHE_MS) {
    return cache.snap;
  }

  const prices = new Set(priceList);
  const since = String(Math.floor((now - WINDOW_MS) / 1000));
  const [subs, paid, open, sessions, hooks] = await Promise.all([
    listAll("/v1/subscriptions", { status: "all" }, key),
    listAll("/v1/invoices", { status: "paid", "created[gte]": since }, key),
    listAll("/v1/invoices", { status: "open" }, key),
    listAll("/v1/checkout/sessions",
      { status: "complete", "created[gte]": since, "expand[]": "data.line_items" }, key),
    listAll("/v1/webhook_endpoints", {}, key),
  ]);

  const snap = {
    state: "ok",
    reason: "",
    price_count: priceList.length,
    subscriptions: section(subs, (s) => projectSubscription(s, prices)),
    invoices_paid: section(paid, (i) => projectInvoice(i, prices)),
    invoices_open: section(open, (i) => projectInvoice(i, prices)),
    sessions: section(sessions, (c) => projectSession(c, prices)),
    webhooks: { state: hooks.state, events: hooks.state === "unavailable" ? null : projectWebhooks(hooks.items) },
  };
  const states = [subs, paid, open, sessions, hooks].map((r) => r.state);
  if (states.includes("unavailable")) {
    snap.state = "unavailable";
    snap.reason = "a Stripe list could not be read";
  } else if (states.includes("partial")) {
    snap.state = "partial";
    snap.reason = "a Stripe list still had more after " + MAX_PAGES + " pages";
  }
  if (snap.state !== "unavailable") cache = { at: now, sig, snap };
  return snap;
}
