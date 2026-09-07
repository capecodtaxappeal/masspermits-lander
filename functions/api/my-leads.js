// MassPermits — subscriber self-serve download (Pages Function).
//
// Why this exists: the weekly leads go out as a ZIP attachment, and a ZIP from
// a young sending domain is the single biggest spam-filter trigger we control.
// A paying subscriber (Silvestre, 2026-07-20) reported "no emails" when in fact
// all five were delivered — they were sitting in a spam folder, attachment and
// all. This endpoint is the always-works fallback: the same weekly email now
// carries a "Download this week's leads" button linking here, so even a
// filtered/stripped attachment never leaves a customer without their product.
//
// Auth: an opaque per-subscriber token (minted in /api/weekly-send, stored in
// subscribers.json). The token is unguessable and carries no PII; the email is
// never in the URL. An inactive/unknown token gets a 403.
//
// 2026-09-06 — THE ONE THING THIS ENDPOINT NOW WRITES
// ---------------------------------------------------
// This was the only place in the whole system where a paying customer's action
// is already tied to their identity, and it recorded nothing: there was no
// instrumented evidence that any customer had ever opened the product. It now
// writes ONE empty R2 object per fetch under dl/, exactly the way hit.js
// already does for page views, and /api/engagement rolls those up weekly.
//
// FIVE RULES ON THAT WRITE, IN PRIORITY ORDER:
//  1. It happens in waitUntil, AFTER the response is on its way. The customer
//     never waits for it, and R2 being slow or down cannot delay a download.
//  2. Everything is inside try/catch. A failed write silently loses an event.
//     That is accepted: losing an event beats losing a customer's file.
//  3. NO NEW READ. Whether a fetch looks machine-generated is decided later, by
//     the rollup, not here. The hot path keeps exactly the reads it had.
//  4. Status codes, headers, body and the 403 message are UNCHANGED. A
//     customer cannot tell this shipped.
//  5. What is stored is the minimum: no email, no name, no IP, no full token,
//     no path, no referrer, no user-agent string — only the letter m or d. The
//     timestamp lives in the key, so it is not stored twice.
//
// dl/ is in NO allowlist: not upload-bundle's ALLOWED_KEYS, not get-object's
// READABLE. Same rule that protects subscribers.json (KB/02 L-9). It also uses
// its own prefix and its own OIDC-gated reader rather than the existing
// page-view beacon, because /api/traffic and /api/live serve that store
// unauthenticated and echo customMetadata verbatim — instrumenting a tokenized
// path through it would publish a token prefix for every live subscriber
// (KB/07 assertion A4). ENGAGEMENT.md E4 tests that by grepping this file for
// the beacon's route, so do not name it here.
//
// Deliberately NOT imported from a shared module. Every import this file gains
// is a file whose syntax error 500s a paying customer's download. The rollup
// reads these objects; it does not have to write them.

// Same regex as hit.js:33. A scanner that fetches links in incoming mail is not
// a customer opening their product, and one active customer's employer runs
// Microsoft 365 link protection, so this is a real population. Failing this
// test suppresses the LOG ONLY — never the file.
const BOTS = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|headless|preview|monitor|curl|wget|python|node-fetch|okhttp|lighthouse/i;

// Per-isolate cap on the ONE branch an outsider can drive without a real token:
// a well-formed 32-hex token matching nobody. That is unbounded and billable,
// so it is bounded here. Downloads and inactive clicks both require a token we
// minted, so they need no cap.
let unmatchedWrites = 0;
const UNMATCHED_CAP = 200;

export async function onRequestGet(context) {
  const { request, env } = context;
  // Guarded: if the runtime ever hands us a context without waitUntil, the
  // download must still work. Telemetry is never a reason to 500 a customer.
  const wait = typeof context.waitUntil === "function"
    ? (p) => context.waitUntil(p)
    : (p) => { try { p.catch(() => {}); } catch (_) { /* ignore */ } };
  const token = new URL(request.url).searchParams.get("t") || "";
  // tokens are a 32-char hex UUID (dashes stripped) — reject anything else early
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return new Response("Missing or malformed download token.", { status: 400 });
  }

  let subs = [];
  try {
    const so = await env.BUNDLES.get("subscribers.json");
    if (so) subs = JSON.parse(await so.text());
  } catch (_) {
    return new Response("Temporarily unavailable — please try the emailed attachment.", { status: 503 });
  }

  const sub = (subs || []).find((s) => s && s.token === token && s.active !== false);
  if (!sub) {
    // The RESPONSE still does not distinguish a cancelled subscriber from a bad
    // link — that is deliberate and unchanged. The LOG does, because `subs` is
    // already in memory so it costs no read, and the two mean opposite things:
    // a cancelled customer still clicking their old link is a win-back signal,
    // and a link that matches nobody is either a deactivated subscriber still
    // being emailed, or a forwarded link.
    const known = (subs || []).find((s) => s && s.token === token);
    wait(logEvent(env, request, known
      ? { r: "inactive", t: token.slice(0, 8) }
      : { r: "no_match" }));
    return new Response(
      "This download link is no longer active. If you're a current subscriber, reply to your latest email and we'll sort it out.",
      { status: 403, headers: { "Content-Type": "text/plain" } });
  }

  // Which bundle. Defaults to weekly so every link already in the wild keeps
  // working; the purchase email asks for monthly, which is what that buyer paid
  // for. Anything else falls back to weekly rather than reaching R2 with it.
  const want = new URL(request.url).searchParams.get("k") === "monthly"
    ? "monthly" : "weekly";
  const file = await env.BUNDLES.get(`latest-${want}.zip`);
  if (!file) {
    // A real subscriber clicked and their product was not there. Nothing else
    // in the system can see this: no send failed, no log recorded it, and the
    // customer just saw a 404 where the thing they pay for should have been.
    wait(logEvent(env, request, { r: "no_file", t: token.slice(0, 8), k: want }));
    return new Response("This week's file isn't ready yet — check back shortly.", { status: 404 });
  }

  const d = new Date().toISOString().slice(0, 10);
  const resp = new Response(file.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="MassPermits-${want}-${d}.zip"`,
      "Cache-Control": "no-store",
    },
  });
  // AFTER the response object exists, so nothing below can affect what the
  // customer receives.
  wait(logEvent(env, request, { t: token.slice(0, 8), k: want }));
  return resp;
}

// One empty R2 object per event. Per-event objects, never a shared counter, so
// a burst cannot lose counts to a read-modify-write race — the same pattern
// hit.js:69-70 uses, aggregated the same way by list() + customMetadata with
// zero body reads.
//
//   key:  dl/<YYYY-MM-DD>/<epoch-ms>-<8 hex>
//   meta: { t: first 8 hex of the token, k: "weekly"|"monthly", d: "m"|"d" }
//         or { r: "no_match" }            — a 403 with nothing to attribute to
//         or { r: "inactive", t }         — a 403 on a token we did mint
//         or { r: "no_file", t, k }       — the bundle was missing
//
// Eight hex is 32 bits of a 128-bit secret, so the token stays unguessable, and
// this log is served by no endpoint. It needs no new field in subscribers.json,
// which keeps the Stripe webhook the only writer of the customer list.
async function logEvent(env, request, meta) {
  try {
    const ua = request.headers.get("user-agent") || "";
    if (BOTS.test(ua)) return;
    if (meta.r === "no_match") {
      if (unmatchedWrites >= UNMATCHED_CAP) return;
      unmatchedWrites++;
    }
    const now = Date.now();
    const key = "dl/" + new Date(now).toISOString().slice(0, 10) + "/" +
                now + "-" + crypto.randomUUID().slice(0, 8);
    const m = {};
    if (meta.t) m.t = meta.t;
    if (meta.k) m.k = meta.k;
    if (meta.r) m.r = meta.r;
    if (!meta.r) m.d = /mobile|android|iphone|ipad/i.test(ua) ? "m" : "d";
    await env.BUNDLES.put(key, "", { customMetadata: m });
  } catch (_) {
    // Telemetry must never affect a customer's download. A lost event is the
    // designed failure mode.
  }
}
