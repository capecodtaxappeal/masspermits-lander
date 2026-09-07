// MassPermits — pre-send verification endpoint (Pages Function, OIDC-gated).
//
// Answers one question, before anybody mails anybody: is the bundle in R2
// actually this morning's bundle, and would sending it deliver something the
// subscriber does not already have?
//
// READ-ONLY. It sends no email, writes no R2 object, and mutates nothing. It is
// safe to call at any hour, from any workflow, as many times as you like — and
// that is deliberate: the first deployment stage wires it into send-watchdog.yml
// where it only REPORTS, so its verdict can be compared against what actually
// happened for a week before anything is gated on it.
//
// WHY IT READS THROUGH THE BINDING AND NOT THE CLI
// -----------------------------------------------
// `wrangler r2 object get` has served >20 minutes of stale bytes on a hot key
// (KB/01 §9a, measured 2026-08-11 across 20 reads while the Workers binding was
// fresh throughout). A human checking the bundle with the CLI can be shown the
// PREVIOUS object and conclude the upload worked when it did not. The binding
// is uncached. The whole value of this endpoint is that it reads the thing
// itself, so it must read it through the path that cannot lie.
//
// WHY IT IS OIDC-GATED AND NOT PUBLIC
// -----------------------------------
// Same gate as /api/weekly-send and /api/send-status, so no new auth mechanism
// enters the codebase and no new credential exists to leak. The operator's
// browser-readable view of the same facts is /admin/now, which goes through
// Cloudflare Access instead — a human cannot mint a GitHub Actions OIDC token.
//
// PRIVACY: this file never reads the R2 customer list, and the payload carries
// counts and states only. `subscriber_count` comes from feed-send-log.json's own
// `subscribers` field — a number the sender already wrote. No address, name or
// token is read, derived or emitted on any path.

import { verifyGitHubOIDC } from "./_github-oidc.js";
import { gather, evaluate, headline, bestSince, dueAt } from "./_presend.js";

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  const url = new URL(request.url);
  const now = Date.now();

  // ?at=<iso> replays the gate against a past instant using TODAY's objects.
  // It is for answering "what would this have said at 12:00?" from the watchdog
  // at 13:30, and it changes nothing but the clock.
  const at = url.searchParams.get("at");
  const clock = at && Number.isFinite(Date.parse(at)) ? Date.parse(at) : now;

  // ?hash=0 skips the ~1MB digest. The workflow uses the default (hash on);
  // the phone page passes hash=0 because it polls and does not need byte proof.
  const hash = url.searchParams.get("hash") !== "0";

  let inputs;
  try {
    inputs = await gather(env, { hash });
  } catch (e) {
    // A gate that 500s is a gate that blocks. Say so explicitly rather than
    // letting the caller interpret an exception.
    return json({
      verdict: "NO_GO", go: false, code: "gate_error", customer_gets_nothing: true,
      reasons: ["the pre-send check itself failed: " + String((e && e.message) || e).slice(0, 200)],
    }, 500);
  }

  const r = evaluate(clock, inputs);
  const due = dueAt(clock, inputs.policy);
  const best = bestSince(inputs.log, due);

  return json({
    ...r,
    headline: headline(r),
    // ENFORCE is the stage gate. While it is false the sender must ignore this
    // verdict entirely; the endpoint still computes it so the two can be
    // compared. Flipping it is a wrangler write to presend-policy.json, not a
    // deploy — which means the rollback is also a wrangler write.
    enforcing: inputs.policy.enforce === true,
    notice_enabled: inputs.policy.notice === true,
    this_window: best ? {
      at: best.at,
      delivered: (best.sent || []).filter((s) => s && s.ok).length,
      failed: (best.sent || []).filter((s) => s && !s.ok).length,
      subscriber_count: typeof best.subscribers === "number" ? best.subscribers : null,
      skipped: best.skipped ? true : false,
    } : null,
    checked_at: new Date(now).toISOString(),
    evaluated_at: new Date(clock).toISOString(),
  }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
