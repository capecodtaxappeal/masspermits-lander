// MassPermits — subscriber self-serve download (Pages Function).
//
// Why this exists: the weekly leads go out as a ZIP attachment, and a ZIP from
// a young sending domain is the single biggest spam-filter trigger we control.
// A paying subscriber (Silvestre, 2026-07-20) reported "no emails" when in fact
// all five were delivered — they were sitting in a spam folder, attachment and
// all. This endpoint is the always-works fallback: the same weekly email now
// carries a "Download this week's leads" button linking here, so even a
// filtered/stripped attachment never leaves a customer without their product.
//
// Auth: an opaque per-subscriber token (minted in /api/weekly-send, stored in
// subscribers.json). The token is unguessable and carries no PII; the email is
// never in the URL. An inactive/unknown token gets a 403. Read-only: serves one
// fixed R2 object, writes nothing.

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = new URL(request.url).searchParams.get("t") || "";
  // tokens are a 32-char hex UUID (dashes stripped) — reject anything else early
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return new Response("Missing or malformed download token.", { status: 400 });
  }

  let subs = [];
  try {
    const so = await env.BUNDLES.get("subscribers.json");
    if (so) subs = JSON.parse(await so.text());
  } catch (_) {
    return new Response("Temporarily unavailable — please try the emailed attachment.", { status: 503 });
  }

  const sub = (subs || []).find((s) => s && s.token === token && s.active !== false);
  if (!sub) {
    // Either a revoked/cancelled subscriber or a bad link. Don't distinguish.
    return new Response(
      "This download link is no longer active. If you're a current subscriber, reply to your latest email and we'll sort it out.",
      { status: 403, headers: { "Content-Type": "text/plain" } });
  }

  const file = await env.BUNDLES.get("latest-weekly.zip");
  if (!file) return new Response("This week's file isn't ready yet — check back shortly.", { status: 404 });

  const d = new Date().toISOString().slice(0, 10);
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="MassPermits-weekly-${d}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
