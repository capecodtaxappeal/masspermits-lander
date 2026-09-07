// MassPermits — inbound-silence watchdog status (Pages Function, OIDC-gated).
//
// The human-reply half of send-status.js. That one answers "did the MACHINE
// deliver". This one answers "is the thing that watches for an unanswered
// PERSON still alive, still armed, and is anything piling up".
//
// Nothing watched the human side until now. The one cancellation in company
// history happened inside that gap: on 2026-08-03 the pipeline genuinely sent
// nothing, a $99/mo subscriber asked where his file was, and the reply came 34
// days later. He cancelled inside that silence, days after volunteering a
// testimonial (KB/06 §3, KB/02 2026-08-03).
//
// Read-only. Sends nothing. Retries nothing. The caller
// (.github/workflows/inbox-watchdog.yml) decides what to do.
//
// WHY THERE IS NO AUTO-REMEDIATION HERE, AT ALL
// send-watchdog.yml can retry a missed send because last-send-attempt.json
// makes a retry provably safe. There is no equivalent on this side: the only
// action that resolves an unanswered customer is a human writing a reply, and
// the 2026-08-09 incident is what happens when a watchdog is given an action it
// should not have — an 8-hour window on a weekly cadence declared `missed`,
// fired an unscheduled retry, and double-sent to both paying subscribers. A
// watchdog that manufactures the incident it exists to catch. This endpoint
// reports and stops.
//
// VERDICTS (mirrors send-status.js's asymmetry: quiet on healthy)
//   ok         everything ran, roster armed, nobody waiting        -> SILENT
//   waiting    people waiting but under the escalation age. The Apps
//              Script already mailed the digest; do not double-alert -> SILENT
//   backlog    someone has been waiting past the escalation age     -> ALERT
//   unarmed    the watchdog ran but the never-spam rule was NOT armed
//              (roster fetch failed), so a paying customer could have
//              been filtered by a suppression rule                  -> ALERT
//   stale      no live run inside the expected window: the watchdog
//              itself is dead, and its silence is indistinguishable
//              from a quiet inbox. THIS IS THE WHOLE POINT.          -> ALERT
//   never      no heartbeat has ever been recorded — not installed   -> ALERT

import { verifyGitHubOIDC } from "./_github-oidc.js";

const STATE_KEY = "inbox-watchdog-state.json";

// inbox_watchdog.gs runs on a daily Apps Script time trigger at 12:00-13:00
// America/New_York. Google schedules those inside a one-hour band, so two
// consecutive runs can legitimately sit ~23h or ~25h apart. STALE_HOURS has to
// clear that band and a little clock drift without needing a whole second
// missed day to trip — one skipped run is worth knowing about.
const STALE_HOURS = 30;

// Matches WAITING_HOURS / ESCALATE_HOURS in inbox_watchdog.gs. The 24h number
// is KB/06 P3's stated target ("no thread ages past 24 hours"); 72h is where
// the digest subject changes to SILENCE 72H so a phone rule can escalate.
const ESCALATE_HOURS = 72;

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await verifyGitHubOIDC(request);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  let state = null;
  try {
    const o = await env.BUNDLES.get(STATE_KEY);
    state = o ? JSON.parse(await o.text()) : null;
  } catch { state = null; }

  const now = Date.now();
  const hours = (iso) => (iso ? (now - Date.parse(iso)) / 3600_000 : Infinity);

  // Liveness is judged on the last LIVE run only. A dry run must not be able to
  // satisfy it, or testing the script masks a dead trigger for a day.
  const lastLive = state && state.last_live_run_at;
  const ageH = hours(lastLive);
  const last = (state && state.last) || null;

  let verdict, detail, alert = true;

  if (!state || !lastLive) {
    verdict = "never";
    detail = "no inbox watchdog run has ever been recorded. The Apps Script " +
             "(inbox_watchdog.gs) is not installed, or its trigger was never created, " +
             "so nothing is watching for an unanswered customer.";
  } else if (ageH > STALE_HOURS) {
    // The dead-man's switch. An empty queue and a dead watchdog produce exactly
    // the same silence; only this staleness check tells them apart.
    verdict = "stale";
    detail = `the inbox watchdog has not run for ${ageH.toFixed(1)}h (limit ${STALE_HOURS}h). ` +
             "It reports nothing when the queue is empty, so a dead trigger looks " +
             "identical to a quiet inbox — this is the only signal that tells them apart. " +
             "Check the Apps Script trigger and its authorisation.";
  } else if (last && last.roster_armed === false) {
    // A silently disarmed never-spam rule is worse than no rule, because it
    // looks like a rule. Every one of the 4 buyers opened with "I paid and I
    // cannot find it", and buyer 1's first message was eaten by this mailbox's
    // spam filter.
    verdict = "unarmed";
    detail = "the watchdog ran, but the never-spam rule was NOT armed: it could not " +
             "fetch the subscriber roster from /api/inbox-roster, so a message from a " +
             "paying customer was not guaranteed protection from the suppression rules. " +
             (last.safe_mode
               ? "It fell back to SAFE MODE (suppression relaxed for anything sent to a " +
                 "published box), so the failure was toward noise rather than silence. "
               : "It did NOT fall back to safe mode, which means messages may have been " +
                 "suppressed. Treat this as a possible missed customer. ") +
             "Check INBOX_ROSTER_PEPPER and INBOX_WATCHDOG_TOKEN in Cloudflare Pages.";
  } else if (last && last.waiting > 0 && last.oldest_hours >= ESCALATE_HOURS) {
    verdict = "backlog";
    detail = `${last.waiting} message(s) awaiting a human reply, oldest ` +
             `${(last.oldest_hours / 24).toFixed(1)} days — past the ${ESCALATE_HOURS}h ` +
             "escalation threshold. The digest went to the alert mailbox; this is the " +
             "second channel because the first one evidently did not land.";
  } else if (last && last.waiting > 0) {
    // Under escalation age the Apps Script digest has already reported it. A
    // second email for the same fact is how an alert channel gets trained into
    // background noise, which is the failure mode that made 6 of 6 owner alerts
    // go unread in the week to 2026-09-06.
    verdict = "waiting";
    detail = `${last.waiting} message(s) waiting, oldest ${last.oldest_hours.toFixed(1)}h — ` +
             "under the escalation threshold and already covered by the watchdog's own digest";
    alert = false;
  } else {
    verdict = "ok";
    detail = `watchdog ran ${ageH.toFixed(1)}h ago, roster armed ` +
             `(${last ? last.roster_active + last.roster_cancelled : 0} digests), nothing waiting`;
    alert = false;
  }

  return json({
    verdict,
    detail,
    alert,                       // the workflow keys on this, not on the string
    stale_after_hours: STALE_HOURS,
    last_live_run_at: lastLive || null,
    hours_since_run: isFinite(ageH) ? Number(ageH.toFixed(1)) : null,
    // Counts only. inbox-heartbeat.js structurally cannot store anything else.
    waiting: last ? last.waiting : null,
    oldest_hours: last ? last.oldest_hours : null,
    customers_waiting: last ? last.customers_waiting : null,
    humans_waiting: last ? last.humans_waiting : null,
    cold_replies_waiting: last ? last.cold_replies_waiting : null,
    roster_armed: last ? !!last.roster_armed : null,
    roster_digests: last ? last.roster_active + last.roster_cancelled : null,
    safe_mode: last ? !!last.safe_mode : null,
    scanned: last ? last.scanned : null,
    errors: last ? last.errors : null,
    runs_recorded: state && Array.isArray(state.history) ? state.history.length : 0,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
