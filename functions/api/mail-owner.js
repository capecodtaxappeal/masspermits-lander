// MassPermits — OIDC-gated "mail the owner" relay.
//
// Lets GitHub Actions crons deliver internal artifacts (the weekly PR pitch
// digest, alerts) to the owner's inbox via Resend WITHOUT a Resend key ever
// living in GitHub. Hard-locked: recipient is ALWAYS the owner — the caller
// chooses subject + HTML body only, never the destination. Same OIDC gate as
// upload-bundle (this public repo's main branch, keyless).

import { verifyGitHubOIDC } from "./_github-oidc.js";

const MAX_BYTES = 512 * 1024; // digest HTML is ~20KB; anything huge is a bug

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  const subject = (new URL(request.url).searchParams.get("subject") || "MassPermits automation").slice(0, 160);
  const html = await request.text();
  if (!html || html.length > MAX_BYTES) return json({ error: "bad body size" }, 400);

  const owner = env.OWNER_EMAIL || "patrick@masspermits.com";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [owner], subject, html }),
  });
  if (!resp.ok) return json({ ok: false, error: "resend " + resp.status }, 502);
  return json({ ok: true, to: owner, subject });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
