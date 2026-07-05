// MassPermits — first-party page-view beacon (no cookies, no PII, no third party).
//
// Each human page-load writes ONE empty R2 object under hits/<day>/ with the
// source + path in customMetadata. Per-hit objects (not a shared counter) so a
// traffic SPIKE — exactly when we want accuracy — never loses counts to a
// read-modify-write race. /api/traffic aggregates from list()+customMetadata
// (no body reads). Source = utm_source/ref param, else derived from the
// referrer host, else "direct".

const ipHits = new Map(); // per-isolate soft cap against write-spam
const IP_CAP = 40;

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
    const path = (url.searchParams.get("p") || "/").slice(0, 80);
    const ref = (url.searchParams.get("r") || "").slice(0, 200);
    let src = (url.searchParams.get("s") || "").slice(0, 40).toLowerCase();
    if (!src) {
      try {
        const h = ref ? new URL(ref).hostname.replace(/^www\./, "") : "";
        src = (h && !h.endsWith("masspermits.com")) ? h : "direct";
      } catch { src = "direct"; }
    }
    const key = `hits/${day}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await env.BUNDLES.put(key, "", { customMetadata: { s: src, p: path } });
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
