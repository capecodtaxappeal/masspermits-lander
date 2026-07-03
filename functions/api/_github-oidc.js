// MassPermits — GitHub Actions OIDC verifier (shared by upload-bundle + weekly-send).
//
// The repo is PUBLIC, so static trigger tokens in code are not acceptable auth.
// Instead, workflows request a GitHub OIDC JWT (permissions: id-token: write) and
// send it as a Bearer token; we verify the RS256 signature against GitHub's
// published JWKS and pin the claims to THIS repo's main branch. Keyless: no
// secret exists on either side, and nothing in the repo is sensitive.

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = ISSUER + "/.well-known/jwks";
const AUDIENCE = "masspermits-cron";
const REPOSITORY = "capecodtaxappeal/masspermits-lander";
const REF = "refs/heads/main";

let cache = { keys: null, at: 0 }; // JWKS cache per isolate (1h)

export async function verifyGitHubOIDC(request) {
  try {
    const m = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (!m) return { ok: false, reason: "no-bearer" };
    const parts = m[1].trim().split(".");
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

    // claims: issuer, audience, repo, branch, expiry
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== ISSUER) return { ok: false, reason: "iss" };
    if (!aud.includes(AUDIENCE)) return { ok: false, reason: "aud" };
    if (payload.repository !== REPOSITORY) return { ok: false, reason: "repo" };
    if (payload.ref !== REF) return { ok: false, reason: "ref" };
    if (!(typeof payload.exp === "number" && payload.exp > now)) return { ok: false, reason: "expired" };

    const key = await getKey(header.kid);
    if (!key) return { ok: false, reason: "kid" };
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(s64),
      new TextEncoder().encode(h64 + "." + p64));
    return valid ? { ok: true, payload } : { ok: false, reason: "sig" };
  } catch (e) {
    return { ok: false, reason: "verify-error:" + String(e && e.message || e).slice(0, 80) };
  }
}

async function getKey(kid) {
  if (!cache.keys || Date.now() - cache.at > 3600_000) {
    const resp = await fetch(JWKS_URL, { headers: { "User-Agent": "masspermits-oidc" } });
    if (!resp.ok) throw new Error("jwks fetch " + resp.status);
    cache = { keys: (await resp.json()).keys || [], at: Date.now() };
  }
  const jwk = cache.keys.find((k) => k.kid === kid);
  if (!jwk) {
    cache.at = 0; // unknown kid -> refetch next call (key rotation)
    return null;
  }
  return crypto.subtle.importKey("jwk", jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
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
