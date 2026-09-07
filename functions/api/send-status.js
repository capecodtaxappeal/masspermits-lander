// MassPermits — delivery watchdog status (Pages Function, OIDC-gated).
//
// Exists because of the 2026-08-03 incident: both paying subscribers got
// nothing, and NOTHING in the system could tell. feed-send-log.json is only
// written after a successful run, so a missed send left no record at all — the
// failure signature was an absence, which is exactly what monitoring cannot see
// unless something goes looking.
//
// This endpoint goes looking. It answers one question: did the scheduled weekly
// delivery actually happen, and did every subscriber get it?
//
// It reads two objects, and the pair is what makes a SAFE retry possible:
//   last-send-attempt.json — written BEFORE the first email
//   feed-send-log.json     — written AFTER, with per-recipient results
// no attempt   -> the sender never ran  -> retrying cannot double-send
// attempt only -> it ran, outcome unknown -> alert, but NEVER auto-retry
//
// Read-only. Sends nothing. The caller (send-watchdog.yml) decides what to do.

import { verifyGitHubOIDC } from "./_github-oidc.js";
// G1. This endpoint used to judge the week from `log[0]` alone. A skip written
// AFTER a real delivery in the same window therefore flipped the verdict to
// `stale_bundle` for a week that delivered fine — and that chain is reachable
// with nothing actually broken: the watchdog fires before a deferred send (both
// crons are deferred independently; the send has been observed +6h46), declares
// `missed`, retries and delivers; then the real cron run lands, hits the etag
// guard, and logs a skip on top of the delivery. A monitor that cries wolf on a
// good week is worse than no monitor, because the next real alarm is the one
// that gets ignored. bestSince() takes the BEST outcome since the due time.
import { bestSince } from "./_presend.js";

// The delivery cadence is WEEKLY (weekly-feed.yml: "0 12 * * 1"). So the
// question is never "did we send in the last N hours" — five days after a
// perfectly good send that is true and fine. The question is "has a delivery
// happened since the most recent scheduled send time".
const SEND_DOW = 1;            // Monday (UTC)
const SEND_HOUR = 12;          // 12:00 UTC
const GRACE_HOURS = 1.5;       // runner slip; GitHub deferred a 09:00 job to 12:26 on 2026-08-03

// Most recent Monday 12:00 UTC at or before `now`.
function lastDueAt(now) {
  const d = new Date(now);
  d.setUTCHours(SEND_HOUR, 0, 0, 0);
  const back = (d.getUTCDay() - SEND_DOW + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 7);
  return d.getTime();
}

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  const now = Date.now();
  const hours = (iso) => (iso ? (now - Date.parse(iso)) / 3600_000 : Infinity);

  const attempt = await readJson(env, "last-send-attempt.json");
  const log = (await readJson(env, "feed-send-log.json")) || [];
  const newest = Array.isArray(log) && log.length ? log[0] : null;

  const dueAt = lastDueAt(now);
  const dueIso = new Date(dueAt).toISOString();

  // G1: judge the WEEK, not the newest line. `best` is the strongest outcome
  // recorded since the due time — a delivery outranks a skip, a skip outranks a
  // bare attempt — so a skip landing on top of a real delivery no longer erases
  // it. `newest` is kept only for the "last recorded" field in the payload.
  const best = bestSince(log, dueAt);

  const attemptAge = hours(attempt && attempt.at);
  const logAge = hours(best && best.at);
  const failed = best ? (best.sent || []).filter((s) => !s.ok) : [];

  const graceOver = now >= dueAt + GRACE_HOURS * 3600_000;
  // A SKIPPED run is not a delivery. weekly-send skips when the bundle is
  // byte-identical to the one already sent — which also means the data refresh
  // produced nothing new, so the subscriber is owed an explanation, not a retry.
  const sentSinceDue = !!(best && !best.skipped && (best.sent || []).some((s) => s && s.ok));
  const skippedSinceDue = !!(best && best.skipped);
  const triedSinceDue = !!(attempt && Date.parse(attempt.at) >= dueAt);

  let verdict, detail, retry_safe = false;
  if (!graceOver) {
    // Inside the grace window, or no send is due yet. Saying "missed" here is
    // how a watchdog turns into an unscheduled second delivery.
    verdict = "not_due";
    detail = `nothing due yet — last scheduled send ${dueIso}, still inside the ` +
             `${GRACE_HOURS}h grace window`;
  } else if (sentSinceDue && !failed.length) {
    verdict = "ok";
    detail = `delivered to ${(best.sent || []).filter((s) => s && s.ok).length} subscriber(s) ${logAge.toFixed(1)}h ago, ` +
             `after the ${dueIso} send time`;
  } else if (sentSinceDue && failed.length) {
    verdict = "partial";
    detail = `${failed.length} of ${(best.sent || []).length} deliveries FAILED`;
  } else if (skippedSinceDue) {
    // Retrying cannot help — the bundle is unchanged because the upstream
    // refresh produced nothing new. A human has to look at the pipeline.
    verdict = "stale_bundle";
    detail = "the send ran but was skipped: " + best.skipped +
             " — the data refresh produced no new bundle, so subscribers received nothing new";
  } else if (triedSinceDue) {
    // It started but never finished writing results — a crash mid-send, or the
    // log write failed. Some subscribers may already hold the file, so a retry
    // could double-send. A human decides this one.
    verdict = "unknown";
    detail = `send was attempted ${attemptAge.toFixed(1)}h ago but no results were recorded — ` +
             "it may have partially delivered; NOT retrying automatically";
  } else {
    verdict = "missed";
    detail = `no delivery since the ${dueIso} scheduled send ` +
             `(last recorded: ${newest ? newest.at : "never"}) and no send was even attempted`;
    retry_safe = true;
  }

  // ---- THE PORTAL BRANCH (KB/07 §6.3) -----------------------------------
  // "The portal needs a watchdog, or it is unmonitored by construction."
  //
  // The customer half of the staleness constraint lives in functions/leads.js
  // (a request-time banner, and a red state that suppresses the rows). This is
  // the OPERATOR half, and it is deliberately bolted onto the existing watchdog
  // rather than given its own: §6.3 says do not build a second alerting path.
  // send-watchdog.yml already mails the owner and fails the Actions job on any
  // verdict that is not ok/not_due, and it prints this whole JSON body into the
  // alert, so a portal block here is visible in every alert for free.
  const portal = await portalHealth(env, dueAt, now);

  // Escalate ONLY when delivery itself has nothing to say. A delivery failure
  // always outranks a portal failure: the ZIP in the customer's mailbox is the
  // one artifact that survives a Pages outage (§6.2), so never let a portal
  // verdict mask a missed send or take away its retry_safe.
  if ((verdict === "ok" || verdict === "not_due") && portal.alert) {
    verdict = "portal_" + portal.state;
    detail = portal.detail;
    retry_safe = false; // retrying weekly-send cannot republish the portal page
  }

  return json({
    verdict, detail, retry_safe, due_at: dueIso,
    last_attempt_at: (attempt && attempt.at) || null,
    last_log_at: ((best || newest) || {}).at || null,
    last_subscribers: best ? (best.sent || []).length : 0,
    last_failed: failed.map((f) => ({ to: f.to, error: f.error || "" })),
    last_coverage: ((best || newest) || {}).coverage || null,
    portal,
  });
}

// Portal health, on the SAME timestamps and the SAME 8-day constant the
// customer-facing banner uses. Four states, and the distinction between them is
// the whole point — a green run is not proof, so "worked", "ran but produced
// nothing" and "never ran" must not collapse into one word:
//
//   not_shipped  latest-weekly.html has never existed. Stage B/C are not done,
//                or the ship step was skipped by an aborted refresh (that step
//                carries no `if: always()`, which is exactly the 2026-08-03
//                mechanism). NEVER alerts: /leads degrades to /api/my-leads by
//                design in this state, so a customer is not hurt, and alerting
//                here would fail the Monday job every week until B ships —
//                the §5.4 trap of a watchdog that cries wolf on a known state.
//   stale        it exists and is older than the 8-day threshold. ALERTS: every
//                customer opening /leads right now is being shown a red page
//                telling them not to work from it.
//   drift        page and download were published more than 15 min apart, so
//                they did not come from one run. ALERTS.
//   ok           published, inside 8 days, in step with the ZIP.
//
// `opens_since_due` is INFORMATIONAL ONLY and must stay that way in v1 (§6.3):
// at three subscribers a zero-open week is legitimate, so there is no baseline
// to threshold against yet. Log it, do not alert on it.
const PORTAL_STALE_MS = 8 * 86400_000;  // the same number as weekly-send.js:43
const PORTAL_DRIFT_MS = 15 * 60_000;    // the same number as functions/leads.js

async function portalHealth(env, dueAt, now) {
  try {
    const [hHtml, hZip] = await Promise.all([
      headSafe(env, "latest-weekly.html"),
      headSafe(env, "latest-weekly.zip"),
    ]);
    const opens = await countOpens(env, dueAt, now);

    if (!hHtml) {
      return {
        state: "not_shipped", alert: false,
        detail: "latest-weekly.html is not in R2 — the portal is serving the " +
                "/api/my-leads download fallback. Expected until KB/07 Stage B/C ship.",
        published_at: null, age_hours: null, drift_minutes: null, ...opens,
      };
    }

    const tHtml = new Date(hHtml.uploaded).getTime();
    const tZip = hZip && hZip.uploaded ? new Date(hZip.uploaded).getTime() : NaN;
    const ageH = (now - tHtml) / 3600_000;
    const drift = Number.isFinite(tZip) ? Math.round(Math.abs(tHtml - tZip) / 60_000) : null;
    const base = {
      published_at: new Date(tHtml).toISOString(),
      age_hours: Number(ageH.toFixed(1)),
      drift_minutes: drift,
      ...opens,
    };

    if (now - tHtml > PORTAL_STALE_MS) {
      return {
        state: "stale", alert: true,
        detail: `the portal page has not been republished in ${Math.floor(ageH / 24)} days ` +
                `(published ${base.published_at}) — /leads is showing every subscriber the ` +
                "red 'do not work from this page' state and hiding their rows",
        ...base,
      };
    }
    if (drift !== null && drift > PORTAL_DRIFT_MS / 60_000) {
      return {
        state: "drift", alert: true,
        detail: `the portal page and latest-weekly.zip were published ${drift} minutes apart, ` +
                "so they did not come from one run — /leads is warning customers that the " +
                "download is authoritative",
        ...base,
      };
    }
    return {
      state: "ok", alert: false,
      detail: `portal page published ${ageH.toFixed(1)}h ago, in step with the download`,
      ...base,
    };
  } catch (e) {
    // The portal check must never be the reason the DELIVERY watchdog cannot
    // report. Unknown is not an alert: an alert on a broken check is noise.
    return {
      state: "unknown", alert: false,
      detail: "portal check failed: " + String((e && e.message) || e).slice(0, 200),
      published_at: null, age_hours: null, drift_minutes: null,
      opens_since_due: null, distinct_readers_since_due: null,
    };
  }
}

// Counts objects written by functions/leads.js's access log since the last due
// time. customMetadata only, zero body reads — the funnel.js/traffic.js rule,
// so this stays inside the subrequest budget however long the log gets. Bounded
// to ten day-prefixes because the window is never more than a week plus grace.
// Returns COUNTS ONLY: this response can end up in a public Actions log, so no
// token prefix, no country and no email ever leaves here.
async function countOpens(env, dueAt, now) {
  try {
    const start = new Date(dueAt);
    start.setUTCHours(0, 0, 0, 0);
    let count = 0;
    const toks = new Set();
    for (let t = start.getTime(), i = 0; t <= now && i < 10; t += 86400_000, i++) {
      const prefix = "portal-access/" + new Date(t).toISOString().slice(0, 10) + "/";
      const l = await env.BUNDLES.list({ prefix, limit: 1000, include: ["customMetadata"] });
      for (const o of l.objects || []) {
        // Keys are portal-access/<day>/<epoch-ms>-<rand>; the first whole day in
        // the window starts before dueAt, so drop the objects that predate it.
        const ts = Number(String(o.key).split("/").pop().split("-")[0]);
        if (Number.isFinite(ts) && ts < dueAt) continue;
        count++;
        const tk = o.customMetadata && o.customMetadata.tok;
        if (tk) toks.add(tk);
      }
    }
    return { opens_since_due: count, distinct_readers_since_due: toks.size };
  } catch {
    // null, not 0. "We could not count" and "nobody opened it" are different
    // facts and this file exists because they were once conflated.
    return { opens_since_due: null, distinct_readers_since_due: null };
  }
}

async function headSafe(env, key) {
  try { return await env.BUNDLES.head(key); } catch { return null; }
}

async function readJson(env, key) {
  try {
    const o = await env.BUNDLES.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch {
    return null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
