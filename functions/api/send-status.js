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

const DUE_WITHIN_HOURS = 8;   // a Monday send at 12:00 must be visible by 20:00

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

  let verdict, detail, retry_safe = false;
  if (logAge <= DUE_WITHIN_HOURS && !failed.length) {
    verdict = "ok";
    detail = `delivered to ${(last.sent || []).length} subscriber(s) ${logAge.toFixed(1)}h ago`;
  } else if (logAge <= DUE_WITHIN_HOURS && failed.length) {
    verdict = "partial";
    detail = `${failed.length} of ${(last.sent || []).length} deliveries FAILED`;
  } else if (attemptAge <= DUE_WITHIN_HOURS) {
    // It started but never finished writing results — a crash mid-send, or the
    // log write failed. Some subscribers may already hold the file, so a retry
    // could double-send. A human decides this one.
    verdict = "unknown";
    detail = `send was attempted ${attemptAge.toFixed(1)}h ago but no results were recorded — ` +
             "it may have partially delivered; NOT retrying automatically";
  } else {
    verdict = "missed";
    detail = `no delivery in the last ${DUE_WITHIN_HOURS}h ` +
             `(last recorded: ${last ? last.at : "never"}) and no send was even attempted`;
    retry_safe = true;
  }

  return json({
    verdict, detail, retry_safe,
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
