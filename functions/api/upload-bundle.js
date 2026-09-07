// MassPermits — bundle upload receiver (Pages Function).
//
// The hosted weekly refresh (.github/workflows/weekly-refresh.yml) scrapes fresh
// permits on a GitHub runner and PUTs the built bundles here; we write them into
// the same R2 bucket the Stripe webhook + /api/weekly-send serve customers from.
//
// Auth: GitHub Actions OIDC (see _github-oidc.js) — cryptographic proof the call
// comes from THIS repo's main branch. No static secrets (the repo is public).
// A strict key allowlist means even a valid caller can only replace the four
// known objects (never subscribers.json).

import { verifyGitHubOIDC } from "./_github-oidc.js";

const ALLOWED_KEYS = {
  "latest-monthly.zip": "application/zip",
  "latest-weekly.zip": "application/zip",
  "latest-sample.zip": "application/zip",
  "refresh-status.json": "application/json",
  "run-log.txt": "text/plain", // workflow stdout — observable diagnostics without repo-admin log access
  "cold-state.json": "application/json", // cold-outreach sender checkpoints (queue/suppression stay wrangler-only)
  "cold-log.txt": "text/plain", // cold sender stdout — observable diagnostics without repo-admin log access
  // Per-source scraper health history (rows/first-seen/last-good/failure
  // streak per town), written by the weekly-refresh job via source_health.py.
  // Operational telemetry only: town names, row counts and fetcher error
  // strings. No customer, subscriber, contractor or address data is in it,
  // and none may ever be added — if this object ever needs a person's name
  // in it, that is the signal to stop, not to widen it.
  "source-health.json": "application/json",
  // KB/07 Stage B1 — the hosted portal's page body. The SAME dashboard HTML
  // that already ships inside latest-weekly.zip, written to disk by
  // build_bundle.py next to the ZIP and shipped by an adjacent `up` call in
  // weekly-refresh.yml's "Ship bundles to R2" step. functions/leads.js streams
  // it to an authenticated subscriber; nobody else can read it, because it is
  // deliberately NOT in get-object.js's READABLE set and never will be.
  //
  // Widening this map is normally the wrong move, so state why this one is not:
  // a valid OIDC caller is this repo's main branch, which ALREADY controls the
  // byte-identical dashboard inside the ZIP that the same customer opens on
  // their own machine. This grants CI no trust it did not already hold, adds no
  // read path, and touches none of the four permanent exclusions below.
  //
  // ADJACENCY IS LOAD-BEARING (KB/07 §2.4): the portal proves the page and the
  // download came from one run by comparing their R2 `uploaded` times and going
  // amber past a 15-minute gap. That check only works while this object is
  // shipped by an `up` line immediately next to the WEEKLY zip's.
  "latest-weekly.html": "text/html",
};
// STILL EXCLUDED, deliberately and permanently: subscribers.json,
// cold-queue.json, suppression.json, the engine tarball. A valid OIDC
// caller must not be able to replace the subscriber list.
const MAX_BYTES = 25 * 1024 * 1024; // bundles are <1MB today; hard ceiling anyway

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "PUT" && request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  const key = new URL(request.url).searchParams.get("key") || "";
  if (!(key in ALLOWED_KEYS)) return json({ error: "key not allowed" }, 400);

  try {
    const body = await request.arrayBuffer();
    if (!body || body.byteLength === 0) return json({ error: "empty body" }, 400);
    if (body.byteLength > MAX_BYTES) return json({ error: "too large" }, 413);
    await env.BUNDLES.put(key, body, { httpMetadata: { contentType: ALLOWED_KEYS[key] } });
    return json({ ok: true, key, bytes: body.byteLength });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e).slice(0, 200) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
