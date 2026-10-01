// MassPermits: engine read route for hand-delivered inputs (GET /api/get-drop).
//
// The daily refresh job reads manual-raw/index.json here, then each file the
// index names. It is a sibling of get-engine.js, not a widening of
// get-object.js: READABLE there and ALLOWED_KEYS in upload-bundle.js are
// unchanged, and nothing outside manual-raw/ can match KEY_RX.
//
// Auth: GitHub Actions OIDC through _github-oidc.js (iss, aud, repository,
// ref refs/heads/main, exp, RS256 signature), then one claim narrower than
// get-engine: the token must come from weekly-refresh.yml on main itself.
// Read-only: GET only, no write path, no list call. 25 MB cap.
//
// Keep it this narrow. Do not add prefixes, do not loosen KEY_RX, and do not
// describe in comments here what the files contain: this repo is public.

import { verifyGitHubOIDC } from "./_github-oidc.js";
import { KEY_RX, contentTypeOf, getManual } from "./_manual_store.js";

export const WORKFLOW_REF =
  "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-refresh.yml@refs/heads/main";
export const MAX_BYTES = 25 * 1024 * 1024;

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "X-Content-Type-Options": "nosniff",
};
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: HEADERS });

// Exactly one parameter, named key, whose decoded value is plain ASCII and
// matches KEY_RX. The raw query is checked too: only unreserved characters,
// "/" and "%2F" may appear, so no encoded dot or backslash survives.
export function keyFrom(url) {
  const u = new URL(url);
  const names = [...u.searchParams.keys()];
  if (names.length !== 1 || names[0] !== "key") return null;
  const raw = u.search.slice(1);
  if (!/^key=(?:[A-Za-z0-9._\-/]|%2[Ff])+$/.test(raw)) return null;
  const key = u.searchParams.get("key");
  return typeof key === "string" && /^[\x21-\x7e]+$/.test(key) && KEY_RX.test(key) ? key : null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: String(auth.reason).split(":")[0] }, 401);
  const p = auth.payload || {};
  if (p.workflow_ref !== WORKFLOW_REF) return json({ error: "unauthorized", reason: "workflow" }, 401);
  if (p.job_workflow_ref !== undefined && p.job_workflow_ref !== WORKFLOW_REF) {
    return json({ error: "unauthorized", reason: "workflow" }, 401);
  }

  const key = keyFrom(request.url);
  if (!key) return json({ error: "key not allowed" }, 400);

  let obj;
  try {
    obj = await getManual(env.BUNDLES, key);
  } catch (_) {
    return json({ error: "unavailable" }, 503);
  }
  if (!obj) return json({ error: "not found" }, 404);
  if (!(typeof obj.size === "number" && obj.size <= MAX_BYTES)) {
    try { obj.body && obj.body.cancel && await obj.body.cancel(); } catch (_) { /* ignore */ }
    return json({ error: "too large" }, 413);
  }
  return new Response(obj.body, {
    headers: { ...HEADERS, "Content-Type": contentTypeOf(key), "Content-Disposition": "attachment" },
  });
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return json({ error: "method not allowed" }, 405);
}
