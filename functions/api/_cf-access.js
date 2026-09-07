// MassPermits — Cloudflare Access JWT verifier (shared by the /api/pipeline* surfaces).
//
// The third auth mechanism in this codebase, and it exists because the other
// two structurally cannot serve a browser:
//   * _github-oidc.js authenticates a WORKFLOW. A human with a browser cannot
//     mint a GitHub Actions OIDC token.
//   * my-leads.js's 32-hex token authenticates a paying CUSTOMER against the
//     R2 customer list, which this surface must never read.
// Cloudflare Access answers the remaining question — "is this the operator?" —
// for a single user who is the account holder, with no new credential to mint,
// rotate, lose or store. That is why there is no admin-token store here.
//
// WHY VERIFY IN CODE WHEN ACCESS ALREADY GATES AT THE EDGE
// -------------------------------------------------------
// Because an edge-only gate fails OPEN and does it silently. If the Access
// application is deleted, renamed, or its path expression drifts off
// /api/pipeline*, the origin keeps serving and nothing anywhere says so. A
// presence check on Cf-Access-Jwt-Assertion catches that same misconfiguration
// but is forgeable by anything that can reach the origin. So: full RS256
// signature verification against the team's JWKS, with aud/iss/exp pinned —
// structurally the same verifier as _github-oidc.js, which is the point.
//
// CONFIG (Cloudflare Pages project environment variables; there is no
// wrangler.toml in this repo, so these are set in the dashboard):
//   CF_ACCESS_TEAM_DOMAIN   e.g. "masspermits.cloudflareaccess.com"
//   CF_ACCESS_AUD           the Access application's AUD tag
// The AUD tag is a public identifier, not a secret — nothing sensitive enters
// this public repo either way, because neither value is in it.
//
// FAILS CLOSED. Missing env, missing header, bad signature, wrong audience,
// expired: all unauthorized. The caller renders an explicit 403 naming
// CF_ACCESS_AUD as the likely cause rather than a bare 500, so a rotated AUD
// breaks the diagnostic page loudly and diagnosably instead of mysteriously.

let cache = { keys: null, at: 0, iss: "" }; // JWKS cache per isolate (1h)

export async function verifyCfAccess(request, env) {
  try {
    const team = String((env && env.CF_ACCESS_TEAM_DOMAIN) || "").trim()
      .replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const aud = String((env && env.CF_ACCESS_AUD) || "").trim();
    if (!team || !aud) {
      return { ok: false, reason: "not-configured",
               detail: "CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must both be set " +
                       "on the Pages project before this surface will serve." };
    }
    const ISSUER = "https://" + team;

    // Access sends the assertion as a header on every proxied request, and also
    // sets the CF_Authorization cookie. Header first; cookie is the fallback
    // for a direct navigation that skipped the header for any reason.
    let token = request.headers.get("cf-access-jwt-assertion") || "";
    if (!token) {
      const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
      if (m) token = m[1];
    }
    if (!token) return { ok: false, reason: "no-assertion" };

    const parts = token.trim().split(".");
    if (parts.length !== 3) return { ok: false, reason: "not-jwt" };
    const [h64, p64, s64] = parts;

    let header, payload;
    try {
      header = JSON.parse(b64urlToString(h64));
      payload = JSON.parse(b64urlToString(p64));
    } catch {
      return { ok: false, reason: "bad-encoding" };
    }
    if (header.alg !== "RS256") return { ok: false, reason: "alg" };

    const now = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== ISSUER) return { ok: false, reason: "iss" };
    if (!auds.includes(aud)) return { ok: false, reason: "aud" };
    if (!(typeof payload.exp === "number" && payload.exp > now)) return { ok: false, reason: "expired" };

    const key = await getKey(header.kid, ISSUER);
    if (!key) return { ok: false, reason: "kid" };
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(s64),
      new TextEncoder().encode(h64 + "." + p64));
    if (!valid) return { ok: false, reason: "sig" };

    // The email claim is rendered in the page header. If that line is missing
    // on screen, the gate is not working — that is its job on the page.
    return { ok: true, email: String(payload.email || payload.common_name || ""), payload };
  } catch (e) {
    return { ok: false, reason: "verify-error:" + String((e && e.message) || e).slice(0, 80) };
  }
}

async function getKey(kid, issuer) {
  if (!cache.keys || cache.iss !== issuer || Date.now() - cache.at > 3600_000) {
    const resp = await fetch(issuer + "/cdn-cgi/access/certs",
      { headers: { "User-Agent": "masspermits-access" } });
    if (!resp.ok) throw new Error("access certs " + resp.status);
    cache = { keys: (await resp.json()).keys || [], at: Date.now(), iss: issuer };
  }
  const jwk = cache.keys.find((k) => k.kid === kid);
  if (!jwk) {
    cache.at = 0; // unknown kid -> refetch next call (key rotation)
    return null;
  }
  return crypto.subtle.importKey("jwk", jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

// The 403 body a gated surface returns. Modeled on newsletter.js's page(h, sub)
// helper — self-contained, inline-styled, same hexes as the rest of the site —
// because a bare 500 on the one page that tells the operator whether his
// pipeline ran is the wrong failure.
export function accessDenied(auth) {
  const reason = String((auth && auth.reason) || "unknown");
  const likely = reason === "not-configured"
    ? String(auth.detail || "")
    : reason === "aud"
      ? "The token is valid but its audience does not match CF_ACCESS_AUD. " +
        "The Access application was probably recreated — copy the new AUD tag " +
        "into the Pages project environment."
      : reason === "no-assertion"
        ? "No Cf-Access-Jwt-Assertion reached the origin. Either the Access " +
          "application no longer covers this path, or you reached this origin " +
          "on a hostname Access does not sit in front of."
        : "Sign in through Cloudflare Access and retry.";
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>MassPermits</title>
<body style="margin:0;background:#0e1622;color:#e8eef5;font-family:-apple-system,Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:520px;padding:40px 24px;text-align:center">
<div style="font-size:20px;font-weight:800;margin-bottom:18px">Mass<span style="color:#2dd4bf">Permits</span></div>
<h1 style="font-size:26px;margin:0 0 10px">Not authorised</h1>
<p style="color:#8aa0b6;line-height:1.6">${esc(likely)}</p>
<p style="color:#8aa0b6;line-height:1.6;font-size:12px">reason: <code>${esc(reason)}</code></p></div></body>`,
    { status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
                 "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet" } });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}
