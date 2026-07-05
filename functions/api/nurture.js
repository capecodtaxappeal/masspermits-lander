// MassPermits — nurture processor (Pages Function, hit daily by GitHub cron).
//
// Walks per-prospect R2 objects (prospects/<email>, written by request-sample)
// and sends the opted-in follow-ups:
//   stage 1 -> after 3 days: "3 ways contractors use this"                -> stage 2
//   stage 2 -> after 7 days total (and >=2d since last): pricing close    -> done
// Requested mail only — cold outreach is never sent by this system.
//
// Idempotency & safety (review findings):
//   - each prospect's object is UPDATED IMMEDIATELY after its send (per-send
//     checkpoint) — a crash or retry can never re-send a whole batch
//   - sends capped per run (daily cron drains any backlog) to stay well inside
//     the Workers subrequest budget
//   - response contains COUNTS ONLY, never email addresses (Actions logs on a
//     public repo are world-readable)

import { verifyGitHubOIDC } from "./_github-oidc.js";

const DAY = 86400_000;
const MAX_SENDS_PER_RUN = 20;

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  // customMetadata carries stage/ts/trade, so the due-check needs ZERO body
  // reads — only due prospects cost subrequests (1 send + 1 checkpoint put).
  const listing = await env.BUNDLES.list({
    prefix: "prospects/", limit: 1000, include: ["customMetadata"],
  });
  const now = Date.now();
  let sent2 = 0, sent3 = 0, errors = 0;

  for (const obj of listing.objects) {
    if (sent2 + sent3 >= MAX_SENDS_PER_RUN) break;
    try {
      const m = obj.customMetadata || {};
      const stage = m.stage || "";
      if (stage !== "1" && stage !== "2") continue;
      const email = decodeURIComponent(obj.key.slice("prospects/".length));
      const p = { email, trade: m.trade || "", ts: m.ts || "", last: m.last || m.ts || "" };
      const age = now - Date.parse(p.ts || 0);
      const sinceLast = now - Date.parse(p.last || 0);
      const nowIso = new Date(now).toISOString();

      if (stage === "1" && age >= 3 * DAY) {
        await send(env, email, "3 ways contractors turn permits into jobs", email2(p));
        await env.BUNDLES.put(obj.key, JSON.stringify({ ...p, stage: 2, last: nowIso }), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { stage: "2", ts: p.ts, trade: p.trade, last: nowIso },
        }); // checkpoint immediately after the send — retries can never re-send
        sent2++;
      } else if (stage === "2" && age >= 7 * DAY && sinceLast >= 2 * DAY) {
        await send(env, email, "Want fresh MA permit leads every Monday?", email3(p));
        await env.BUNDLES.put(obj.key, JSON.stringify({ ...p, stage: "done", last: nowIso }), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { stage: "done", ts: p.ts, trade: p.trade, last: nowIso },
        });
        sent3++;
      }
    } catch (e) {
      errors++; // counts only — no addresses in the (public) workflow log
    }
  }
  return json({ ok: true, prospects: listing.objects.length,
                sent_followup1: sent2, sent_followup2: sent3, errors });
}

function email2(p) {
  const t = p.trade && p.trade !== "all" && p.trade !== "Other" ? p.trade : "your trade";
  return wrap(`
    <h2 style="color:#0e7c6b">3 ways contractors turn permit data into jobs</h2>
    <p><b>1. Subs — a warm pipeline.</b> When a GC pulls a permit for a big job,
    reach out before they lock in their usual crew. Filter to ${t}, sort by newest,
    call the freshest first.</p>
    <p><b>2. GCs — market intel.</b> The <b>"By contractor"</b> view shows every
    competitor's active job count and value. Know your market before you bid.</p>
    <p><b>3. Everyone — catch builds early.</b> Demolition &amp; site permits flag
    projects that will need trades in weeks, not months.</p>
    <p>Your free sample shows the volume; the full packs unlock the names and
    addresses: <a href="https://masspermits.com">masspermits.com</a></p>`);
}

function email3(p) {
  return wrap(`
    <h2 style="color:#0e7c6b">Fresh leads every Monday, automatically</h2>
    <p>Every Monday morning we pull the newest building permits across Massachusetts
    — Boston, Cape Cod, the South Shore — and our subscribers get the full,
    unmasked batch in their inbox before the week starts.</p>
    <p style="margin:16px 0">
      <a href="https://masspermits.com" style="background:#14b8a6;color:#04201c;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none">
      Get the full data</a></p>
    <p><b>$49</b> one-time lead pack &nbsp;·&nbsp; <b>$99/mo</b> weekly feed (cancel anytime)</p>
    <p style="color:#667">On the fence? Reply with what you'd need it to do — a real
    person answers, and honest feedback genuinely shapes this thing.</p>`);
}

function wrap(inner) {
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0e1622">
    ${inner}
    <p style="color:#9aa;font-size:12px;margin-top:26px">— MassPermits · masspermits.com · public municipal permit records<br>
    You're getting this because you requested our free sample. Reply "stop" to opt out.</p></div>`;
}

async function send(env, to, subject, html) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
