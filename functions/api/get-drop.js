// MassPermits: OIDC-gated read of private engine INPUT files (Pages Function).
//
// Serves ONLY keys under the "manual/" prefix, matched by one strict pattern,
// and ONLY to the weekly-refresh workflow on this repo's main branch. It is a
// sibling of get-engine.js, not a widening of get-object.js: READABLE there is
// unchanged, and subscribers.json, the bundles, the engine and every other key
// stay unreachable here because none of them can match KEY_RX.
// Read-only: there is no write path, and nothing in Actions can write manual/.
//
// Keep it this narrow. Do not add prefixes, do not loosen KEY_RX, and do not
// describe in comments here what the files contain: this repo is public.

import { verifyGitHubOIDC } from "./_github-oidc.js";

export const WORKFLOW_REF =
  "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-refresh.yml@refs/heads/main";
// manual/manifest.json | manual/<slug>/<YYYY-MM>.json | manual/<slug>/<YYYY-MM>.r<2-9>.json
// The engine (fetch_manual._KEY_RX) and the workflow step use this same pattern.
export const KEY_RX =
  /^manual\/(?:manifest|[a-z]{2,40}\/20\d\d-(?:0[1-9]|1[0-2])(?:\.r[2-9])?)\.json$/;
export const MAX_BYTES = 5 * 1024 * 1024;

const json = (o, status) => new Response(JSON.stringify(o),
  { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);
  // Narrower than get-engine: repo@main is not enough, it must be this workflow.
  if (auth.payload.workflow_ref !== WORKFLOW_REF) {
    return json({ error: "unauthorized", reason: "workflow" }, 401);
  }

  const params = new URL(request.url).searchParams;
  const keys = params.getAll("key");
  const key = keys.length === 1 ? keys[0] : "";
  if (!KEY_RX.test(key)) return json({ error: "key not allowed" }, 400);

  const obj = await env.BUNDLES.get(key);
  if (!obj) return json({ error: "not found" }, 404);
  if (!(obj.size <= MAX_BYTES)) {
    try { obj.body && obj.body.cancel && obj.body.cancel(); } catch { /* ignore */ }
    return json({ error: "too large" }, 413);
  }
  return new Response(obj.body, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Any other method is refused outright (Pages would 405 anyway; explicit is clearer).
export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return json({ error: "method not allowed" }, 405);
}
