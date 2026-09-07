// MassPermits — inbox watchdog heartbeat receiver (Pages Function).
//
// WHY THIS EXISTS
// inbox_watchdog.gs sends nothing when nobody is waiting. That is correct — a
// watchdog that reports success gets filtered and then ignored, which is the
// same reasoning send-status.js uses for `ok` and `not_due`. But it means
// SILENCE IS THE SUCCESS STATE, and a deleted trigger, a lapsed OAuth grant, an
// Apps Script quota trip or a renamed script all produce exactly that same
// silence. The watchdog could die on a Tuesday and look identical to a quiet
// inbox until the next customer churned.
//
// That is precisely the 2026-08-03 failure signature, restated: the failure is
// an ABSENCE, and nothing can see an absence unless something goes looking.
// send-status.js's own header says so. This endpoint is the artifact that makes
// this absence visible — the same trick as last-send-attempt.json, which is
// written BEFORE the first email so that "never ran" and "ran and lost the log"
// stop looking alike.
//
// So the Apps Script posts here on EVERY run, including — especially — the
// empty ones. /api/inbox-status then reads the freshness of this object, and
// inbox-watchdog.yml alerts when it goes stale.
//
// PRIVACY: COUNTS ONLY, ENFORCED HERE RATHER THAN TRUSTED
// The caller is a script in a Google account, editable by hand, that has just
// finished reading a mailbox full of customer mail. It would be very easy for
// someone to add a subject line or a sender to the payload "just for debugging"
// and quietly start writing customer data into R2. So this endpoint does not
// accept the caller's object. It builds a NEW object from a fixed allowlist of
// numeric, boolean and enum fields and discards everything else. There is no
// free-text field. Anything not on the list cannot get in, whatever the caller
// sends. Same discipline as nurture.js: "counts only, never addresses".
//
// Auth: the same bearer token as /api/inbox-roster. Not OIDC — the caller is
// Apps Script, which cannot mint a GitHub OIDC JWT.
//
// Writes exactly one R2 object: inbox-watchdog-state.json. Touches nothing on
// the paying-customer path: no Stripe, no Resend, no subscribers.json, no
// bundles. Sends no mail.

const STATE_KEY = "inbox-watchdog-state.json";
const HISTORY = 21;               // ~3 weeks of daily runs
const MAX_BYTES = 8 * 1024;       // the payload is ~300 bytes; anything larger is a bug

export async function onRequestPost(context) {
  const { request, env } = context;

  const expected = env.INBOX_WATCHDOG_TOKEN || "";
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  const presented = m ? m[1].trim() : "";
  if (!(expected.length >= 24 && presented && timingSafeEqual(presented, expected))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json({ error: "payload too large" }, 413);
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "expected an object" }, 400);
  }

  // ── The allowlist. Nothing outside this survives. ──────────────────────────
  // Every field is a number, a boolean, or a bounded enum. There is no field
  // that can carry an email address, a name, a subject line or a thread id.
  const run = {
    ran_at: new Date().toISOString(),        // server clock, not the caller's
    version: str(body.version, 16),          // e.g. "gs-2" — enum-ish, 16 chars
    mode: body.mode === "dry" ? "dry" : "live",

    scanned: num(body.scanned),              // threads examined
    waiting: num(body.waiting),              // threads owed a human reply
    oldest_hours: num(body.oldest_hours, 2),
    customers_waiting: num(body.customers_waiting),
    humans_waiting: num(body.humans_waiting),
    cold_replies_waiting: num(body.cold_replies_waiting),
    alerted: !!body.alerted,                 // did it actually mail the digest
    errors: num(body.errors),

    // The never-spam rule's own health. `roster_armed:false` means R1 was NOT
    // protecting anyone on this run, which /api/inbox-status treats as an
    // alerting condition in its own right — a silently disarmed never-spam rule
    // is worse than no rule, because it looks like a rule.
    roster_armed: !!body.roster_armed,
    roster_active: num(body.roster_active),      // digest counts, not addresses
    roster_cancelled: num(body.roster_cancelled),
    safe_mode: !!body.safe_mode,                 // suppression rules relaxed
  };

  let state;
  try {
    const o = await env.BUNDLES.get(STATE_KEY);
    state = o ? JSON.parse(await o.text()) : null;
  } catch { state = null; }
  if (!state || typeof state !== "object" || !Array.isArray(state.history)) {
    state = { history: [] };
  }

  // A dry run must not be able to satisfy the liveness check — otherwise
  // someone testing the script would mask a dead trigger for a day.
  //
  // For the same reason a dry run may not touch `state.last`. That object is
  // what /api/inbox-status reads to decide `waiting`, `backlog` and `unarmed`,
  // and the install instructions tell the operator to run dryRun() by hand — on
  // a laptop that will not have the pepper, so its payload carries
  // roster_armed:false and waiting:0. Letting that land in `last` would do both
  // halves of the wrong thing at once: manufacture an `unarmed` alert for a
  // fault that does not exist, and, worse, overwrite a real backlog with a zero
  // — a test run silently cancelling the alarm about an unanswered customer.
  // That is this project's own failure mode wearing a different hat, so the
  // separation is structural rather than a convention the caller must keep.
  if (run.mode === "live") {
    state.last_live_run_at = run.ran_at;
    state.history.unshift(run);
    state.history = state.history.slice(0, HISTORY);
    state.last = run;
  } else {
    state.last_dry_run_at = run.ran_at;
    state.last_dry = run;
  }
  state.last_run_at = run.ran_at;

  try {
    await env.BUNDLES.put(STATE_KEY, JSON.stringify(state),
      { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    // Unlike the delivery loggers, this write is NOT swallowed. This object is
    // the only evidence the watchdog is alive; a silent failure here would
    // manufacture the exact stale-heartbeat alarm it exists to prevent, and the
    // caller needs to know so it can report the error on its next run.
    return json({ ok: false, error: "state write failed" }, 500);
  }

  return json({ ok: true, recorded: run.mode, waiting: run.waiting,
                roster_armed: run.roster_armed });
}

function num(v, dp = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n) || n < 0) return 0;
  return dp ? Math.round(n * 10 ** dp) / 10 ** dp : Math.round(n);
}

// Bounded, and stripped to a conservative character class so no free text —
// and therefore no fragment of a subject line or an address — can ride in.
function str(v, max) {
  return String(v == null ? "" : v).replace(/[^A-Za-z0-9._-]/g, "").slice(0, max);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
