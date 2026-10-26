// MassPermits — OIDC-gated R2 reads for the cold-outreach workflow.
//
// Serves ONLY the cold-outreach state objects (strict allowlist — never the
// bundles, engine, prospects, or subscribers). The queue/copy live in private
// R2, not in this public repo. Auth: GitHub Actions OIDC pinned to repo@main.
// Since 2026-10-26 it also serves the carry-forward store (carry-store.json.gz,
// see READABLE), and that one key only to weekly-refresh.yml on main.

import { verifyGitHubOIDC } from "./_github-oidc.js";

// source-health.json is read back by weekly-refresh at the start of each run:
// the failure-streak rule is stateful, so without a read the history cannot
// exist. Same class as the cold-* entries — the CI job's own checkpoint
// state, no customer or subscriber data. subscribers.json stays out of this
// set forever; so do the bundles, the engine and the prospect list.
//
// carry-store.json.gz (2026-10-26, engine round 8): PATRICK'S EXPLICIT DECISION,
// the ONE key added for the carry-forward fail-safe ("if data cuts later in the
// week, we continue to deliver the latest data we pulled"). Unlike the keys
// above it holds the same class of data as latest-monthly.zip (the paid rows of
// each town's last good pull), so it is read ONLY by weekly-refresh.yml on main
// (the workflow that writes the paid bundles; the same workflow pin as
// get-drop.js), served as application/gzip, and never printed by that
// workflow. This widens READABLE by exactly this key and nothing else.
const READABLE = new Set(["cold-queue.json", "cold-state.json", "suppression.json",
                          "source-health.json", "carry-store.json.gz"]);
export const CARRY_KEY = "carry-store.json.gz";
export const CARRY_WORKFLOW_REF =
  "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-refresh.yml@refs/heads/main";

// The carry store may be read only by the refresh workflow itself.
export function carryReaderOk(auth) {
  const p = (auth && auth.payload) || {};
  if (p.workflow_ref !== CARRY_WORKFLOW_REF) return false;
  return p.job_workflow_ref === undefined || p.job_workflow_ref === CARRY_WORKFLOW_REF;
}

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
  if (key === CARRY_KEY && !carryReaderOk(auth)) {
    return new Response(JSON.stringify({ error: "unauthorized", reason: "workflow" }),
      { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const obj = await env.BUNDLES.get(key);
  if (!obj) return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
  const type = key === CARRY_KEY ? "application/gzip" : "application/json";
  return new Response(obj.body, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
