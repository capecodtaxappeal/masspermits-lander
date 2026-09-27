// MassPermits: Road to 100 data route (GET /admin/api/growth).
//
// The owner's page admin/growth.html reads this. Per week (this week so far
// plus the 12 before it, New York time): visits, Buy clicks, checkouts
// opened, abandoned and paid, paying subscribers at week end, free sign ups.
// COUNTS ONLY: no email, name, Stripe id, card detail, page path or town.
//
// ORDER, AND WHY (the same as Mission Control's route, mission.js)
//   1. verifyOwner (functions/api/_owner_gate.js): apex host, configuration,
//      the Access header, a verified person's token, the allowlist. Cloudflare
//      Access already covers /admin/*; this is the check in code, so a
//      drifted Access application fails closed. Nothing is read before it.
//   2. X-MassPermits-Growth: 1, and Sec-Fetch-Site same-origin when present,
//      so a page on another site cannot make the owner's browser pull this.
//   3. no query parameters at all.
//   4. reads, ONLY through readView(env.BUNDLES) (get, head, list; no write
//      method exists on it), and Stripe through _growth_stripe.js.
// Every response carries secHeaders(): no-store, noindex, no CORS header.
// One try/catch after auth answers 503 {error:"unavailable"}; no exception
// text reaches a response.
//
// R2 BUDGET. Visits are the hits/<day>/ objects functions/api/hit.js writes,
// one per page load, counted the way /api/traffic counts them (list +
// customMetadata, no body reads). Buy clicks are the clicks/<day>/ objects,
// a separate prefix, so the /ops page view counts never include them. Keys
// sort by day, so one listing that starts at the first week walks every day
// in order: about 25 page loads a day today is 3 lists for 13 weeks. Caps:
// HIT_PAGES and CLICK_PAGES lists of 1000; a scan still truncated after its
// cap marks the weeks it did not reach as "at least".

import { verifyOwner, denied, secHeaders } from "../../api/_owner_gate.js";
import { readView } from "../../api/_mission_r2.js";
import { growthStripe } from "../../api/_growth_stripe.js";
import {
  weekGrid, buildGrowth, parseFunnel, FEED_LINKS, OLD_OFFER_CLICK_PATH, DAY_MS,
} from "../../api/_growth_data.js";

const HIT_PAGES = 30;
const CLICK_PAGES = 10;
const FUNNEL_KEY = "funnel-metrics.json";
const FUNNEL_MAX_BYTES = 2 * 1024 * 1024;

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: secHeaders() });
}

function tsOfKey(key) {
  const seg = String(key || "").split("/").pop() || "";
  const t = parseInt(seg.split("-")[0], 10);
  return Number.isFinite(t) ? t : null;
}

// The first object under a prefix, ever (keys sort by day): when the data starts.
async function firstOf(ro, prefix) {
  const r = await ro.list({ prefix, limit: 1 });
  const o = r && Array.isArray(r.objects) ? r.objects[0] : null;
  return o ? tsOfKey(o.key) : null;
}

// Walk prefix from the UTC day before fromMs (a page load late on a Sunday in
// New York is already Monday in UTC) for at most maxPages lists.
async function scan(ro, prefix, fromMs, maxPages, visit) {
  const startAfter = prefix + new Date(fromMs - DAY_MS).toISOString().slice(0, 10);
  let cursor;
  let through = null;
  for (let page = 0; page < maxPages; page++) {
    const opts = { prefix, limit: 1000, include: ["customMetadata"] };
    if (cursor) opts.cursor = cursor; else opts.startAfter = startAfter;
    const r = await ro.list(opts);
    for (const o of (r && r.objects) || []) {
      const ts = tsOfKey(o && o.key);
      if (ts === null) continue;
      through = ts;
      visit(ts, (o && o.customMetadata) || {});
    }
    if (!r || !r.truncated || !r.cursor) return { state: "ok", through: null };
    cursor = r.cursor;
  }
  return { state: "partial", through };
}

async function visitsOf(ro, fromMs) {
  try {
    const first = await firstOf(ro, "hits/");
    const ts = [];
    let old = 0;
    const s = await scan(ro, "hits/", fromMs, HIT_PAGES, (t, m) => {
      if (m.p === OLD_OFFER_CLICK_PATH) { old++; return; }
      ts.push(t);
    });
    return { state: s.state, through: s.through, first, ts, old_clicks: old };
  } catch (_) {
    return { state: "unreadable", first: null, through: null, ts: [], old_clicks: 0 };
  }
}

async function clicksOf(ro, fromMs) {
  try {
    const first = await firstOf(ro, "clicks/");
    const feed = [], other = [];
    const s = await scan(ro, "clicks/", fromMs, CLICK_PAGES, (t, m) => {
      if (m.e !== "buy_click") return;
      (FEED_LINKS.has(m.l) ? feed : other).push(t);
    });
    return { state: s.state, through: s.through, first, feed, other };
  } catch (_) {
    return { state: "unreadable", first: null, through: null, feed: [], other: [] };
  }
}

async function funnelOf(ro) {
  try {
    const o = await ro.get(FUNNEL_KEY);
    if (!o) return { state: "absent", snaps: [] };
    if (typeof o.size === "number" && o.size > FUNNEL_MAX_BYTES) return { state: "unreadable", snaps: [] };
    const snaps = parseFunnel(JSON.parse(await o.text()));
    return snaps ? { state: "ok", snaps } : { state: "unreadable", snaps: [] };
  } catch (_) {
    return { state: "unreadable", snaps: [] };
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  // The clock: the route edge is the only place Date.now() is read for data.
  const now = typeof context.now === "number" ? context.now : Date.now();

  let auth;
  try {
    auth = await verifyOwner(request, env);
  } catch (_) {
    auth = { ok: false, status: 403, reason: "verify-error" };
  }
  if (!auth || auth.ok !== true) return denied(auth, request);

  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("x-masspermits-growth") !== "1") {
    return json({ error: "forbidden", reason: "missing-growth-header" }, 403);
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return json({ error: "forbidden", reason: "cross-site" }, 403);
  }
  try {
    if ([...new URL(request.url).searchParams].length) return json({ error: "bad_param" }, 400);
  } catch (_) {
    return json({ error: "bad_param" }, 400);
  }

  try {
    const ro = readView(env.BUNDLES);
    const grid = weekGrid(now);
    const [visits, clicks, funnel, stripe] = await Promise.all([
      visitsOf(ro, grid.start),
      clicksOf(ro, grid.start),
      funnelOf(ro),
      growthStripe(env, now, grid.start).catch(() => ({ state: "unavailable", reason: "a Stripe list could not be read" })),
    ]);
    return json(buildGrowth({ now, grid, visits, clicks, stripe, funnel }), 200);
  } catch (_) {
    return json({ error: "unavailable" }, 503);
  }
}
