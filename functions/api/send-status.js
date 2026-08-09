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
  const last = Array.isArray(log) && log.length ? log[0] : null;

  const attemptAge = hours(attempt && attempt.at);
  const logAge = hours(last && last.at);
  const failed = last ? (last.sent || []).filter((s) => !s.ok) : [];

  const dueAt = lastDueAt(now);
  const dueIso = new Date(dueAt).toISOString();
  const graceOver = now >= dueAt + GRACE_HOURS * 3600_000;
  const sentSinceDue = !!(last && Date.parse(last.at) >= dueAt);
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
    detail = `delivered to ${(last.sent || []).length} subscriber(s) ${logAge.toFixed(1)}h ago, ` +
             `after the ${dueIso} send time`;
  } else if (sentSinceDue && failed.length) {
    verdict = "partial";
    detail = `${failed.length} of ${(last.sent || []).length} deliveries FAILED`;
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
             `(last recorded: ${last ? last.at : "never"}) and no send was even attempted`;
    retry_safe = true;
  }

  return json({
    verdict, detail, retry_safe, due_at: dueIso,
    last_attempt_at: (attempt && attempt.at) || null,
    last_log_at: (last && last.at) || null,
    last_subscribers: last ? (last.sent || []).length : 0,
    last_failed: failed.map((f) => ({ to: f.to, error: f.error || "" })),
    last_coverage: (last && last.coverage) || null,
  });
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
