// MassPermits — OIDC-gated R2 reads for the cold-outreach workflow.
//
// Serves ONLY the cold-outreach state objects (strict allowlist — never the
// bundles, engine, prospects, or subscribers). The queue/copy live in private
// R2, not in this public repo. Auth: GitHub Actions OIDC pinned to repo@main.

import { verifyGitHubOIDC } from "./_github-oidc.js";

// source-health.json is read back by weekly-refresh at the start of each run:
// the failure-streak rule is stateful, so without a read the history cannot
// exist. Same class as the cold-* entries — the CI job's own checkpoint
// state, no customer or subscriber data. subscribers.json stays out of this
// set forever; so do the bundles, the engine and the prospect list.
const READABLE = new Set(["cold-queue.json", "cold-state.json", "suppression.json",
                          "source-health.json"]);

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
