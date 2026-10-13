// MassPermits: hosted prospect sample, masspermits.com/s/<code> (Pages Function).
//
// WHY THIS EXISTS
// ---------------
// Cold outreach used to ATTACH each prospect's personalized free sample as an
// .html file. To a careful reader, an HTML attachment from a sender they have
// never heard of is exactly what phishing looks like, and on 2026-10-12 a
// prospect said so and declined to open it. The advice that reader has been
// given for years is "do not open the attachment, go to the company's own
// website". So the same file now sits in R2 and this route serves it from
// masspermits.com at a private, unguessable URL. Patrick approved the switch
// on 2026-10-12.
//
// NO NAMES IN THIS REPO. This repository is public. Which code belongs to
// which prospect is known only to the private engine that mints the codes and
// to the R2 object itself. Nothing in this file, its test, or a comment may
// carry a prospect or company name, a prospect's email address, or any
// code-to-company mapping. The only address below is our own public contact.
//
// WHAT IT EXPOSES, AND WHY THAT IS SAFE
// -------------------------------------
// The masked free sample and nothing else: the identical bytes the prospect
// was emailed (or would have been), streamed unchanged from
// prospect-samples/<code>.html. Masking happens upstream in the engine (no
// house numbers, no permit-holder names). This file never sees a row and does
// not rewrite the page. It reads exactly one key per request, built from a
// code that has already matched CODE_RE, so no request can steer the read
// anywhere else in the bucket.
//
// Neither prefix this file touches is in upload-bundle.js ALLOWED_KEYS or in
// get-object.js READABLE, and neither may be added. Samples go up by a
// hand-run `wrangler r2 object put ... --remote`; nothing in this deployment
// can write, list or read them except this route, one code at a time.
//
// AUTH MODEL: THE CODE IS THE CREDENTIAL
// --------------------------------------
//  * Exactly 20 characters of lowercase RFC 4648 base32 (a-z, 2-7): 100 bits.
//    The engine mints them and must use a CSPRNG. At 100 bits there is nothing
//    to enumerate, so there is no rate limit here and no need for one.
//  * 30 days from the R2 object's own `uploaded` timestamp, then 410. A
//    forwarded link dies on its own. Re-uploading the same key restarts the
//    clock, which is how a prospect who answers late gets a fresh copy at the
//    URL they already have. A missing or unreadable timestamp fails CLOSED.
//  * A malformed code and a well-formed code with no object get the SAME 404,
//    byte for byte, so this route is never an oracle for which codes exist.
//  * Not apex-pinned. _middleware.js pins /leads to the apex because every
//    /leads link is a customer credential minted by our own mailers; here the
//    code alone is the secret and it is the same secret on any hostname, so a
//    pin would add nothing (and _middleware.js runs on the Stripe webhook path,
//    so it is not edited for this).
//
// HEADERS, SET IN CODE ON EVERY RESPONSE (_headers does not reach Functions)
//  * X-Robots-Tag noindex: a URL that leaks into a crawler is still not indexed.
//  * Referrer-Policy no-referrer. Load-bearing, not hygiene: the sample's map
//    links open google.com, and a Referer would hand Google the full URL with
//    the code in it.
//  * Cache-Control private, no-store: no shared cache may keep a copy past
//    the expiry or serve one prospect's page to another.
//  * nosniff, X-Frame-Options DENY and CSP frame-ancestors 'none': the page
//    cannot be framed by anyone else's site.
//  * A strict CSP (SAMPLE_CSP below), the same shape as the /widget/v1/embed
//    policy in _headers but with connect-src 'none'. The sample is an
//    interactive page whose table and filters are one inline <script> and
//    one inline <style>, so 'unsafe-inline' is allowed for those two and
//    nothing else loads: no external script, stylesheet, font, image (data:
//    only), frame, form target or base URL, and NO network request from
//    script at all. That last part is load-bearing. This route is
//    same-origin with /leads, and the portal cookie (mp_sess, HttpOnly,
//    SameSite=Lax, Path=/leads) WOULD be sent with a fetch("/leads") made
//    from this page, so any script on /s/<code> could otherwise read a
//    visitor's paid file. connect-src 'none' also blocks a page-view
//    beacon (fetch or sendBeacon) mechanically, not just by the rule below.
//    Checked on 2026-10-13 against all 101 wf6 samples: none has an <img>,
//    url(), src=, <link>, font, fetch, sendBeacon, eval or inline on* handler;
//    the only external URL is the google.com map link, which is a plain
//    <a target=_blank> navigation and is not governed by this policy.
//    The 404/410/405/503 pages use one inline <style> and fit it too.
//
// DO NOT ADD THE SITE PAGE-VIEW BEACON TO THE SAMPLE (the CSP above would
// block it anyway). traffic.js and live.js are unauthenticated and echo the
// beacon's path verbatim into public JSON, so instrumenting this page that way
// would publish every live code. The view counter below is the
// instrumentation, and it is private.
//
// THE ONE THING THIS FILE WRITES: prospect-sample-views/<code>.json
// -----------------------------------------------------------------
//   {"first_open": iso|null, "last_open": iso|null, "opens": int,
//    "scanner_hits": int, "first_hit": iso, "last_hit": iso}
// It answers the one question an attachment never could: did they look?
// Rules, in priority order:
//  1. Only a 200 serve counts. A 404, 410, 405 or 503 writes nothing, so a
//     stranger trying codes cannot make the bucket grow.
//  2. It runs in waitUntil, after the response object exists, inside
//     try/catch. A slow or failed write loses a count; it can never delay,
//     change or fail the page.
//  3. Read-modify-write on one object per code. Two hits in the same instant
//     can lose one count. At a few dozen links that is accepted, and it keeps
//     the reading side to a single get().
//  4. It stores NO IP, NO user-agent string, NO referrer, NO email: four
//     timestamps and two integers. Only the six known fields are ever written
//     back, so anything else found in an existing object is dropped. The
//     user-agent and Accept-Language headers are read to classify the hit and
//     are not kept.
//  5. Scanner or open. Corporate mail filters (Safe Links, Proofpoint,
//     Mimecast, Barracuda) fetch every link in an inbound message before a
//     person sees it, so "the link was fetched" means nothing by itself. A
//     hit is a scanner hit if it is a HEAD, or carries no Accept-Language
//     header (every real browser sends one), or its user-agent matches
//     SCANNER_RE. Otherwise it is an open. A scanner that fully imitates a
//     browser still counts as an open; first_hit beside first_open shows how
//     soon after delivery that happened, which is the tell.

const CODE_RE = /^[a-z2-7]{20}$/;
const SAMPLE_PREFIX = "prospect-samples/";
const VIEWS_PREFIX = "prospect-sample-views/";
const TTL_MS = 30 * 86400_000;
const SCANNER_RE = /bot|crawl|spider|preview|scan|barracuda|proofpoint|mimecast|cudasvc|linkprotect|safelinks|python|curl|wget|headless|go-http|java|okhttp|facebookexternalhit|slackbot|google-?inspection/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// See HEADERS in the comment above. connect-src 'none' is the line that keeps
// a script on this page from reading /leads with the visitor's cookie.
const SAMPLE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MAIL = "<a href=\"mailto:patrick@masspermits.com\">patrick@masspermits.com</a>";
const MSG_NOT_FOUND = "This link isn't valid. For a sample, email " + MAIL + ".";
const MSG_EXPIRED = "This sample link has expired. Email " + MAIL + " for a fresh one.";
const MSG_UNAVAILABLE = "This sample is temporarily unavailable. Please try again in a few minutes, or email " + MAIL + ".";
const MSG_METHOD = "Method not allowed.";

export async function onRequestGet(context) {
  return serve(context, false);
}

// HEAD, explicitly, for the same reason as leads.js: without it the framework
// answers HEAD itself with none of the headers above. Same status, same
// headers, no body. A HEAD that reaches a valid sample counts as a scanner hit.
export async function onRequestHead(context) {
  return serve(context, true);
}

// Every other method. Pages sorts method-specific handlers ahead of this one,
// but GET and HEAD are dispatched here too, so the route behaves the same
// whichever handler the router picks (the get-drop.js pattern).
export async function onRequest(context) {
  const method = context.request.method;
  if (method === "GET") return onRequestGet(context);
  if (method === "HEAD") return onRequestHead(context);
  return page(405, MSG_METHOD, false, { Allow: "GET, HEAD" });
}

async function serve(context, head) {
  const { env } = context;
  const raw = context.params ? context.params.code : "";
  const code = typeof raw === "string" ? raw : "";
  // Exact match, no lowercasing: the code IS the key, and a variant spelling
  // is a different (nonexistent) key, answered with the same 404.
  if (!CODE_RE.test(code)) return page(404, MSG_NOT_FOUND, head);

  let obj;
  try {
    obj = await env.BUNDLES.get(SAMPLE_PREFIX + code + ".html");
  } catch (_) {
    // A storage blip is not "this link is dead". 503, never a stack trace.
    return page(503, MSG_UNAVAILABLE, head);
  }
  if (!obj) return page(404, MSG_NOT_FOUND, head);

  const now = Date.now();
  const uploaded = new Date(obj.uploaded).getTime();
  // NaN (no timestamp) fails the comparison, so it is treated as expired.
  if (!(now - uploaded <= TTL_MS)) {
    release(obj);
    return page(410, MSG_EXPIRED, head);
  }

  if (head) release(obj);
  const res = new Response(head ? null : obj.body, { status: 200, headers: headers() });
  // After the response exists: nothing in count() can change what is served.
  count(context, code, head, now);
  return res;
}

// ---------------------------------------------------------------------------
// THE VIEW COUNTER (see rule list in the header)
// ---------------------------------------------------------------------------
function count(context, code, head, now) {
  try {
    const { request, env } = context;
    const ua = request.headers.get("user-agent") || "";
    const scanner = head || !request.headers.get("accept-language") || SCANNER_RE.test(ua);
    const p = bump(env.BUNDLES, VIEWS_PREFIX + code + ".json", scanner, new Date(now).toISOString());
    if (typeof context.waitUntil === "function") context.waitUntil(p);
    else p.catch(() => {});
  } catch (_) {
    // Bookkeeping never breaks the page.
  }
}

async function bump(bucket, key, scanner, at) {
  try {
    let prev = null;
    const o = await bucket.get(key);
    if (o) {
      // Unparseable means start again: a corrupt counter that can never be
      // rewritten would stop counting for good. A read that FAILS is
      // different: a get() that throws, or a body stream that breaks partway
      // (text() rejects), falls to the outer catch and writes nothing, so an
      // R2 blip never resets real counts to zero. Only JSON.parse is inside
      // the inner catch.
      const txt = await o.text();
      try { prev = JSON.parse(txt); } catch (_) { prev = null; }
    }
    const v = clean(prev, at);
    if (scanner) {
      v.scanner_hits += 1;
    } else {
      v.opens += 1;
      if (!v.first_open) v.first_open = at;
      v.last_open = at;
    }
    await bucket.put(key, JSON.stringify(v), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (_) {
    // A lost count is the designed failure mode.
  }
}

// Rebuilds the record from the six known fields only, type-checked. Anything
// else in a stored object (an older shape, a hand edit) is dropped here.
function clean(p, at) {
  const ok = p !== null && typeof p === "object" && !Array.isArray(p);
  const iso = (x) => (typeof x === "string" && ISO_RE.test(x) ? x : null);
  const int = (x) => (Number.isSafeInteger(x) && x >= 0 ? x : 0);
  return {
    first_open: ok ? iso(p.first_open) : null,
    last_open: ok ? iso(p.last_open) : null,
    opens: ok ? int(p.opens) : 0,
    scanner_hits: ok ? int(p.scanner_hits) : 0,
    first_hit: (ok && iso(p.first_hit)) || at,
    last_hit: at,
  };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function headers(extra) {
  const h = {
    "Content-Type": "text/html; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": SAMPLE_CSP,
  };
  if (extra) for (const k of Object.keys(extra)) h[k] = extra[k];
  return h;
}

function release(obj) {
  try {
    if (obj && obj.body && typeof obj.body.cancel === "function") obj.body.cancel().catch(() => {});
  } catch (_) {
    // nothing to release
  }
}

// Short, plain, and identical in shape for every refusal. No rows, no names,
// no code echoed back, no detail about why beyond the one sentence.
function page(status, message, head, extra) {
  const html = head ? null :
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<meta name=\"robots\" content=\"noindex,nofollow,noarchive,nosnippet\">" +
    "<title>MassPermits</title>" +
    "<style>body{margin:0;background:#0e1622;color:#c7d3e0;" +
    "font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
    "main{max-width:520px;margin:0 auto;padding:48px 22px}" +
    "b{color:#e8eef5}a{color:#2dd4bf}</style>" +
    "</head><body><main><p><b>MassPermits</b></p><p>" + message + "</p></main></body></html>";
  return new Response(html, { status, headers: headers(extra) });
}
