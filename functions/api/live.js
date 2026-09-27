// MassPermits — real-time visitor feed for /ops (OWNER ONLY, geo-tagged).
//
// Reads the first-party beacon hits (functions/api/hit.js) straight from R2 and
// returns: who's on the site RIGHT NOW (active in the last 5 min), the last 15
// min of visitors with city/state/country + coarse lat-long + network (AS
// organisation), and a 24h rollup by US state (MA-focused). No IPs are stored
// or returned, but city + map point + network + timestamp + page, refreshed
// every 12s, is enough to pick out one real visitor (a customer's office, a
// town hall). So it is owner-only.
//
// GATE (2026-09-27, approved by Patrick): Cloudflare Access verification in
// code, via _cf-access.js — the same verifier /api/pipeline and
// /api/pipeline-now use. It accepts the Cf-Access-Jwt-Assertion header (sent
// when the Access application covers this path) and falls back to the
// CF_Authorization cookie (sent by the owner's browser once signed in to
// Access on masspermits.com). Anything else gets a 403 with NO data, and the
// check runs BEFORE any R2 read, so a refused request costs zero list() calls.
// Fails closed if CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are unset.
//
// No public page depends on this route: its only consumer is /ops (the
// operator dashboard, ops.html), which renders an "owner only" note on 403.
// list()+customMetadata only, no per-hit body reads.

import { verifyCfAccess, accessDenied } from "./_cf-access.js";

const ACTIVE_MS = 5 * 60_000;    // "on the site now"
const RECENT_MS = 15 * 60_000;   // live feed window
const ROLLUP_MS = 24 * 3600_000; // by-state window

export async function onRequestGet(context) {
  const { request, env } = context;

  // Owner gate first. Nothing below this line runs for a refused request.
  const auth = await verifyCfAccess(request, env);
  if (!auth || auth.ok !== true) return refused(request, auth);

  const now = Date.now();

  // Cover the midnight boundary: today's + yesterday's day-prefixes span 24h.
  const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
  const days = [...new Set([dayStr(now - ROLLUP_MS), dayStr(now)])];

  const recent = [];
  const states = {};
  let active = 0, todayTotal = 0;
  const today = dayStr(now);

  for (const day of days) {
    let cursor;
    do {
      const list = await env.BUNDLES.list({
        prefix: `hits/${day}/`, limit: 1000, cursor, include: ["customMetadata"],
      });
      for (const o of list.objects) {
        const seg = o.key.split("/").pop() || "";
        const ts = parseInt(seg.split("-")[0], 10);
        if (!Number.isFinite(ts)) continue;
        const age = now - ts;
        if (day === today) todayTotal++;
        const m = o.customMetadata || {};
        // 24h state rollup (US only, so MA + neighbors read cleanly)
        if (age <= ROLLUP_MS && (m.c || "US") === "US") {
          const st = m.st || "??";
          states[st] = (states[st] || 0) + 1;
        }
        if (age <= ACTIVE_MS) active++;
        if (age <= RECENT_MS) {
          recent.push({
            ts, ago: Math.round(age / 1000),
            s: m.s || "direct", p: m.p || "/",
            c: m.c || "", st: m.st || "", ci: m.ci || "",
            la: m.la ? Number(m.la) : null, lo: m.lo ? Number(m.lo) : null,
            o: m.o || "",
          });
        }
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }

  recent.sort((a, b) => b.ts - a.ts);
  return json({
    now: new Date(now).toISOString(),
    active, window_min: 15,
    recent: recent.slice(0, 60),
    states, today_total: todayTotal,
  });
}

// Every response of this route, 200 and 403 alike. No Access-Control-Allow-*
// header of any kind, so no other origin can read it with the owner's cookie.
const SEC = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

// The refusal carries a reason code and nothing else: no counts, no geo, no
// timestamp. A browser navigation gets _cf-access.js's HTML page; the /ops
// fetch gets JSON it can render.
async function refused(request, auth) {
  const reason = String((auth && auth.reason) || "verify-error");
  const code = reason.startsWith("verify-error") ? "verify-error" : reason;
  let navigation = false;
  try {
    const accept = request.headers.get("accept") || "";
    navigation = request.headers.get("sec-fetch-mode") === "navigate" || accept.includes("text/html");
  } catch (_) { navigation = false; }
  if (navigation) {
    const body = await accessDenied({ reason: code, detail: auth && auth.detail }).text();
    return new Response(body, { status: 403,
      headers: { ...SEC, "Content-Type": "text/html; charset=utf-8" } });
  }
  return new Response(JSON.stringify({ error: "unauthorized", reason: code }), {
    status: 403, headers: { ...SEC, "Content-Type": "application/json" },
  });
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { ...SEC, "Content-Type": "application/json" },
  });
}
