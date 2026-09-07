// MassPermits — lifecycle email sender (Pages Function, OIDC-gated).
//
// DRY RUN BY DEFAULT. Without `?send=1` this endpoint reads everything, decides
// exactly who would receive which of the four lifecycle emails, renders each
// one in full, throws the rendered copy away, and returns counts. It makes no
// Resend call and writes nothing. Calling it is as safe as calling
// /api/send-status.
//
// The four messages, and the evidence behind each, are documented at the top of
// _lifecycle_mail.js. The short version: all four of four paying customers ever
// made first contact with a version of "I paid and I cannot find it" (KB/06
// H2), and the only cancellation in company history happened inside a 34-day
// silence that followed a send which genuinely never went out.
//
// THIS FILE IS A THIN ADAPTER. Every decision and every sentence lives in
// _lifecycle_mail.js's runLifecycle(), which takes `send` and `checkpoint` as
// injected functions. The local dry run calls that SAME function with a `send`
// that throws if it is ever reached, so "a dry run sends nothing" is a proven
// property of this code path and not a claim about a second copy of it.
//
// WHAT THIS ENDPOINT DOES NOT DO, ON PURPOSE
// ------------------------------------------
//  * It never touches the paying-customer path: it does not read or write any
//    bundle, never writes subscribers.json, never touches the etag duplicate
//    guard or last-send-attempt.json, and cannot change what the Monday send
//    delivers to anybody.
//  * It never returns rendered copy, an email address, a name, a token or a
//    token prefix. Its caller is a GitHub Actions workflow in a PUBLIC repo
//    that pipes responses through `jq` into a world-readable log — nurture.js
//    :14-15 names the same hazard. There is deliberately NO ?preview=
//    parameter: every one of these emails carries a subscriber's private
//    download link, so previewing over HTTP would publish it. Preview locally
//    with lifecycle_mail.dryrun.mjs.
//
// AUTH: GitHub OIDC, the same gate as /api/nurture and /api/engagement.

import { verifyGitHubOIDC } from "./_github-oidc.js";
import { readLifecycle, rowForToken } from "./_lifecycle.js";
import { KEY_SENT, REPLY_TO, runLifecycle } from "./_lifecycle_mail.js";

// Small on purpose. At three active subscribers this never binds; at three
// hundred it keeps one run well inside the Workers subrequest budget and lets
// the next scheduled run drain the rest. A backlog that drains slowly is fine.
// A run that dies half way through a batch is not.
const MAX_SENDS_PER_RUN = 10;

// Static aggregate fact files, published by the weekly refresh alongside
// site/data.json. Counts only: no address, name, contractor or permit id in
// either, which is why they are safe as public site assets and why this
// Function reads them without any new R2 allowlist entry. KB/02 L-9's rule
// against widening ALLOWED_KEYS / READABLE is not touched.
const TRADEFIT_PATH = "/tradefit.json";
const FACTS_PATH = "/lifecycle_facts.json";

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  const url = new URL(request.url);
  const live = url.searchParams.get("send") === "1";
  const backfill = url.searchParams.get("backfill") === "1";
  const only = url.searchParams.get("only") || "";   // one kind, for a careful first live run
  const now = Date.now();

  let input;
  try {
    input = {
      subs: (await readJson(env.BUNDLES, "subscribers.json")) || [],
      sendLog: (await readJson(env.BUNDLES, "feed-send-log.json")) || [],
      health: await readJson(env.BUNDLES, "source-health.json"),
      lifecycle: await readLifecycle(env.BUNDLES),
      sent: (await readJson(env.BUNDLES, KEY_SENT)) || {},
      tradefit: await readAsset(context, TRADEFIT_PATH),
      facts: await readAsset(context, FACTS_PATH),
      now, live, backfill, only,
      maxSends: MAX_SENDS_PER_RUN,
      rowForToken,
    };
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500);
  }

  // The ledger is held in memory across the loop and written after each send,
  // so a mid-run crash loses at most the message just sent, never the batch.
  const ledger = input.sent;
  const deps = {
    send: (to, mail) => sendOne(env, to, mail),
    checkpoint: async (t8, kind) => {
      ledger[t8] = { ...(ledger[t8] || {}), [kind]: new Date(now).toISOString() };
      await env.BUNDLES.put(KEY_SENT, JSON.stringify(ledger),
        { httpMetadata: { contentType: "application/json" } });
    },
  };

  let out;
  try {
    out = await runLifecycle(input, deps);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500);
  }

  // COUNTS ONLY. `out.previews` holds the rendered emails and every one of them
  // carries a private download link, so it is dropped here and never serialised.
  return json({ ok: true, backfill, only: only || null, ...out.counts });
}

// One Resend call. reply_to is set, which nothing else in this repo does: every
// other template says "just reply to this email", and every one of those
// replies therefore lands on FROM_EMAIL. hello@ is the address published on
// 3,099 site pages and in the schema.org Organization block, and three of the
// four buyers wrote there unprompted. Both boxes reach the same mailbox.
async function sendOne(env, to, mail) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`,
               "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      reply_to: REPLY_TO,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

async function readJson(bucket, key) {
  try {
    const o = await bucket.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch { return null; }
}

// Same pattern as functions/api/v1/_lib.js:82-87: env.ASSETS is the in-process
// static-asset fetcher and the plain fetch is the fallback for a harness with
// no bindings. A missing file returns null, and every consumer treats null as
// "send the variant that quotes no numbers, or send nothing at all".
async function readAsset(context, path) {
  try {
    const u = new URL(path, new URL(context.request.url).origin).toString();
    const env = context.env || {};
    const res = env.ASSETS && typeof env.ASSETS.fetch === "function"
      ? await env.ASSETS.fetch(new Request(u, { method: "GET" }))
      : await fetch(u, { cf: { cacheTtl: 900 } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
