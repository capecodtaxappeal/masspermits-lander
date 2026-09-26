// MassPermits — owner gate for Mission Control (/admin/mission and its data route).
//
// WRAPS _cf-access.js WITHOUT EDITING IT. That verifier answers "is this a
// valid Access token for this application?". This file answers the narrower
// question the Mission Control payload needs: "is this the owner, in a
// browser, on the canonical host, right now?". Order matters and the first
// failure wins; nothing else (no R2 object, no Stripe call) is read until
// every step has passed.
//
//   0. apex only. www, masspermits-lander.pages.dev, <hash>.pages.dev and the
//      heartbeat twin all 404 (the heartbeat twin is main republished daily).
//   1. CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD and ADMIN_ALLOWED_EMAILS all set.
//      No default and no fallback to any other variable.
//   2. the Cf-Access-Jwt-Assertion HEADER. _cf-access.js falls back to the
//      CF_Authorization cookie; this gate refuses before it gets the chance.
//   3. full RS256 verification (iss, aud, exp, kid, signature) by _cf-access.js.
//   4. a person's token: type "app", an email, a subject, no common_name
//      (service tokens carry common_name and pass step 3), not issued in the
//      future.
//   5. the email is on ADMIN_ALLOWED_EMAILS.
//
// A throw anywhere before step 5 passes ends in 403 "verify-error": never a
// 500, never a 200, never the exception text.

import { verifyCfAccess, accessDenied } from "./_cf-access.js";

const CANONICAL_HOST = "masspermits.com";
// Clock skew allowed on nbf and iat. Access issues tokens from the same edge
// that proxies the request, so a minute is generous.
const FUTURE_SKEW_S = 60;

// The fixed set of reasons a response may carry. Anything else is reported
// as "verify-error", so no exception text can reach a response body.
const REASONS = new Set([
  "not-found", "not-configured", "no-assertion-header", "no-assertion", "not-jwt",
  "bad-encoding", "alg", "iss", "aud", "expired", "kid", "sig", "verify-error",
  "token-type", "not-a-person", "not-yet-valid", "not-owner",
]);

const NOT_CONFIGURED_DETAIL =
  "CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD and ADMIN_ALLOWED_EMAILS must all be set " +
  "as Production variables on the Pages project before this page will serve.";

function fail(status, reason) {
  return { ok: false, status, reason };
}

function trimmed(v) {
  return typeof v === "string" ? v.trim() : "";
}

export async function verifyOwner(request, env) {
  try {
    // 0. host pin
    const host = new URL(request.url).hostname.toLowerCase();
    if (host !== CANONICAL_HOST) return fail(404, "not-found");

    // 1. configuration, all three or nothing
    const team = trimmed(env && env.CF_ACCESS_TEAM_DOMAIN);
    const aud = trimmed(env && env.CF_ACCESS_AUD);
    const allow = trimmed(env && env.ADMIN_ALLOWED_EMAILS).split(",")
      .map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!team || !aud || !allow.length) return fail(403, "not-configured");

    // 2. header only
    const assertion = request.headers.get("cf-access-jwt-assertion");
    if (!assertion || !assertion.trim()) return fail(403, "no-assertion-header");

    // 3. signature, issuer, audience, expiry
    const v = await verifyCfAccess(request, env);
    if (!v || v.ok !== true) {
      const r = String((v && v.reason) || "verify-error");
      return fail(403, r.startsWith("verify-error") ? "verify-error"
        : REASONS.has(r) ? r : "verify-error");
    }

    // 4. a person, now
    const p = v.payload || {};
    if (p.type !== "app") return fail(403, "token-type");
    if (typeof p.email !== "string" || !p.email.trim() ||
        typeof p.sub !== "string" || !p.sub.trim() ||
        p.common_name !== undefined) {
      return fail(403, "not-a-person");
    }
    // The same wall clock _cf-access.js checks exp against.
    const nowS = Math.floor(Date.now() / 1000);
    for (const claim of ["nbf", "iat"]) {
      if (p[claim] !== undefined &&
          (typeof p[claim] !== "number" || p[claim] > nowS + FUTURE_SKEW_S)) {
        return fail(403, "not-yet-valid");
      }
    }

    // 5. the allowlist
    const email = p.email.trim().toLowerCase();
    if (!allow.includes(email)) return fail(403, "not-owner");
    return { ok: true, email };
  } catch (_) {
    return fail(403, "verify-error");
  }
}

// Headers on EVERY response of the Mission Control routes, 403 and 404 included.
// Deliberately no Access-Control-Allow-* header of any kind.
export function secHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

// The refusal. A browser navigation gets _cf-access.js's HTML page (re-wrapped
// so it carries secHeaders); the page's own request gets JSON with a reason
// from the fixed set above.
export async function denied(auth, request) {
  const status = auth && auth.status === 404 ? 404 : 403;
  if (status === 404) {
    return new Response("Not found", { status: 404, headers: secHeaders("text/plain; charset=utf-8") });
  }
  const raw = String((auth && auth.reason) || "verify-error");
  const reason = REASONS.has(raw) ? raw : "verify-error";
  let navigation = false;
  try {
    const accept = request.headers.get("accept") || "";
    navigation = request.headers.get("sec-fetch-mode") === "navigate" || accept.includes("text/html");
  } catch (_) {
    navigation = false;
  }
  if (navigation) {
    const page = accessDenied(reason === "not-configured"
      ? { reason, detail: NOT_CONFIGURED_DETAIL } : { reason });
    const body = await page.text();
    return new Response(body, { status: 403, headers: secHeaders("text/html; charset=utf-8") });
  }
  return new Response(JSON.stringify({ error: "unauthorized", reason }),
    { status: 403, headers: secHeaders() });
}
