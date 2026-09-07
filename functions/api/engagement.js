// MassPermits — subscriber lifecycle rollup (Pages Function, OIDC-gated).
//
// Modelled directly on funnel.js: same OIDC gate, same cursor loop, same
// "counts only in the response body" rule. Reads the download event log that
// /api/my-leads writes, joins it to subscribers.json and feed-send-log.json,
// writes engagement.json, and returns counts.
//
// SENDS NOTHING BY DEFAULT. The owner digest is composed inside this Function
// and handed straight to Resend. It deliberately does NOT go through the
// OIDC-gated owner-mail relay, because that endpoint takes its HTML body from
// its caller, and the caller here would be a workflow in a public repo whose
// logs are world-readable — the digest is the one artifact that names people.
// ENGAGEMENT.md E6 tests that by grepping this file for the relay's route, so
// do not name it here. The digest is mailed ONLY when BOTH are true:
//   - the caller passed ?digest=1
//   - the rollup found something a human has to act on
// A watchdog that emails on success gets filtered; send-watchdog.yml already
// learned that. Leave ?digest=1 off until the metric has run clean for two
// cycles — that is what the `warming` state is for.
//
// SAFE TO CALL AS OFTEN AS YOU LIKE. It changes no subscriber state, touches no
// bundle, and cannot alter what any customer receives.

import { verifyGitHubOIDC } from "./_github-oidc.js";
import { runRollup } from "./_lifecycle.js";

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  let result;
  try {
    result = await runRollup(env.BUNDLES, { now: Date.now() });
  } catch (e) {
    // This endpoint is called from send-watchdog.yml, whose actual job is to
    // catch delivery failures. It is wired with `|| true` there so a broken
    // rollup cannot mask a `missed` verdict, and this 500 exists so the
    // failure is still visible rather than being reported as an empty success.
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500);
  }

  const url = new URL(request.url);
  const wantDigest = url.searchParams.get("digest") === "1";
  let digest_sent = false;
  if (wantDigest && result.alert && env.RESEND_API_KEY) {
    try {
      const owner = env.OWNER_EMAIL || "patrick@masspermits.com";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`,
                   "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.FROM_EMAIL, to: [owner],
                               subject: result.digest.subject, html: result.digest.html }),
      });
      digest_sent = resp.ok;
    } catch { /* a failed digest must never fail the rollup */ }
  }

  // COUNTS ONLY. A PUBLIC repo's Actions log prints this verbatim.
  return json({ ...result.response, alert: result.alert,
                digest_requested: wantDigest, digest_sent });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
