// MassPermits — first-party page-view beacon (no cookies, no PII, no third party).
//
// Each human page-load writes ONE empty R2 object under hits/<day>/ with the
// source + path + coarse geo in customMetadata. Per-hit objects (not a shared
// counter) so a traffic SPIKE — exactly when we want accuracy — never loses
// counts to a read-modify-write race. /api/traffic and /api/live aggregate from
// list()+customMetadata (no body reads). Source = utm_source/ref param, else
// derived from the referrer host, else "direct".
//
// EVENTS (2026-09-27). A request carrying e=<event> is NOT a page view. Only
// the values in EVENTS are accepted; any other e (an empty one included) is
// answered with the pixel and nothing is written. An accepted event is stored
// under its own prefix, clicks/<day>/, never under hits/, so /api/traffic and
// /api/live (which list hits/ only) count exactly the page views they always
// did. Same no-cookie, no-PII shape: the page path, the utm source, and for a
// buy click the public buy.stripe.com link path (letters and digits only).
// Written by js/buy-click.js; read by the owner's Road to 100 page.

const ipHits = new Map(); // per-isolate soft cap against write-spam
const IP_CAP = 40;
const EVENTS = new Set(["buy_click"]);

function alnum(s, n) {
  return String(s == null ? "" : s).replace(/[^A-Za-z0-9]/g, "").slice(0, n);
}

// Drop control chars (<0x20) and the HTML-breaking set  < > " ' `  so nothing
// dangerous is ever stored. Built from numeric code points (no literal special
// chars in source). /ops also HTML-escapes on render — defense in depth, since
// the p/s params are attacker-controllable on this public beacon. Spaces,
// hyphens and unicode letters (e.g. "New Bedford") are preserved.
function clean(s, n) {
  let out = "";
  for (const ch of String(s == null ? "" : s)) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || c === 0x3c || c === 0x3e || c === 0x22 || c === 0x27 || c === 0x60) continue;
    out += ch;
  }
  return out.slice(0, n);
}

export async function onRequest(context) {
  const { request, env } = context;
  const ua = request.headers.get("user-agent") || "";
  // JS beacon already filters most bots (they don't run JS); this catches the
  // JS-capable previewers/headless ones.
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|headless|preview|monitor|curl|wget|python|node-fetch|okhttp|lighthouse/i.test(ua)) {
    return px();
  }
  const ip = request.headers.get("cf-connecting-ip") || "?";
  const n = (ipHits.get(ip) || 0) + 1;
  ipHits.set(ip, n);
  if (n > IP_CAP) return px();

  try {
    const url = new URL(request.url);
    const day = new Date().toISOString().slice(0, 10);
    const path = clean(url.searchParams.get("p") || "/", 80);
    const ev = url.searchParams.get("e");
    if (ev !== null) {
      if (!EVENTS.has(ev)) return px();
      const meta = {
        e: ev,
        p: path,
        s: clean(url.searchParams.get("s") || "", 40).toLowerCase() || "direct",
        l: alnum(url.searchParams.get("l"), 40),
      };
      const key = `clicks/${day}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await env.BUNDLES.put(key, "", { customMetadata: meta });
      return px();
    }
    const ref = (url.searchParams.get("r") || "").slice(0, 200);
    let src = clean(url.searchParams.get("s") || "", 40).toLowerCase();
    if (!src) {
      try {
        const h = ref ? new URL(ref).hostname.replace(/^www\./, "") : "";
        src = (h && !h.endsWith("masspermits.com")) ? h : "direct";
      } catch { src = "direct"; }
    }
    // Geolocation from Cloudflare's edge — city-level (coarse, approximate) and
    // derived from IP WITHOUT us ever storing the IP itself. Privacy-safe: the
    // lat/long is the city centroid, not the visitor's device.
    const cf = request.cf || {};
    const meta = { s: src, p: path };
    if (cf.country) meta.c = String(cf.country).slice(0, 2);
    if (cf.regionCode || cf.region) meta.st = clean(cf.regionCode || cf.region, 6);
    if (cf.city) meta.ci = clean(cf.city, 40);
    if (cf.latitude) meta.la = String(cf.latitude).slice(0, 12);
    if (cf.longitude) meta.lo = String(cf.longitude).slice(0, 12);
    if (cf.asOrganization) meta.o = clean(cf.asOrganization, 40);
    // Primary browser-language tag (coarse setting, not PII) — captured to test
    // whether inbound traffic skews Portuguese/pt-BR, which would corroborate the
    // Brazilian-tradesman ICP hypothesis far beyond our first 2 customers.
    const al = request.headers.get("accept-language") || "";
    if (al) meta.lang = clean(al.split(",")[0].trim(), 8).toLowerCase();
    const key = `hits/${day}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await env.BUNDLES.put(key, "", { customMetadata: meta });
  } catch (e) {
    /* analytics must never break the page */
  }
  return px();
}

function px() {
  // 1x1 transparent GIF
  const gif = Uint8Array.from(
    atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (c) => c.charCodeAt(0));
  return new Response(gif, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}
