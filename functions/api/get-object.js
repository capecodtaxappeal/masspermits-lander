// MassPermits — OIDC-gated R2 reads for the cold-outreach workflow.
//
// Serves ONLY the cold-outreach state objects (strict allowlist — never the
// bundles, engine, prospects, or subscribers). The queue/copy live in private
// R2, not in this public repo. Auth: GitHub Actions OIDC pinned to repo@main.

import { verifyGitHubOIDC } from "./_github-oidc.js";

const READABLE = new Set(["cold-queue.json", "cold-state.json", "suppression.json"]);

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized", reason: auth.reason }),
      { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!READABLE.has(key)) {
    return new Response(JSON.stringify({ error: "key not allowed" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const obj = await env.BUNDLES.get(key);
  if (!obj) return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
  return new Response(obj.body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
