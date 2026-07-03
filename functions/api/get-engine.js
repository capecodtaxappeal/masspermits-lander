// MassPermits — engine fetch (Pages Function).
//
// The weekly-refresh workflow downloads the scraper engine from here at runtime.
// The engine code deliberately does NOT live in this (public) repo — it sits in
// the private R2 bucket (engine.tar.gz, uploaded via wrangler), so the scraping
// internals stay non-public while the automation stays fully hosted.
//
// Auth: GitHub Actions OIDC pinned to this repo's main branch (_github-oidc.js).
// Read-only: serves exactly one fixed object; nothing here can write.

import { verifyGitHubOIDC } from "./_github-oidc.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized", reason: auth.reason }),
      { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const file = await env.BUNDLES.get("engine.tar.gz");
  if (!file) return new Response("engine.tar.gz not in R2", { status: 404 });
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="engine.tar.gz"',
      "Cache-Control": "no-store",
    },
  });
}
