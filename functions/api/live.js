// MassPermits — real-time visitor feed for /ops (humans only, geo-tagged).
//
// Reads the first-party beacon hits (functions/api/hit.js) straight from R2 and
// returns: who's on the site RIGHT NOW (active in the last 5 min), the last 15
// min of visitors with city/state/country + coarse lat-long, and a 24h rollup by
// US state (MA-focused). No IPs are stored or returned — only Cloudflare's
// city-level geo. list()+customMetadata only, no per-hit body reads.

const ACTIVE_MS = 5 * 60_000;    // "on the site now"
const RECENT_MS = 15 * 60_000;   // live feed window
const ROLLUP_MS = 24 * 3600_000; // by-state window

export async function onRequestGet(context) {
  const { env } = context;
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

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
