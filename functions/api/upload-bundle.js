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
};
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
