// MassPermits — public pipeline & portal health.  KB/07 Stage F, F2 (§6.4).
//
// WHY THIS IS PUBLIC, AND WHY THAT IS SAFE
// ----------------------------------------
// The operator needs to answer "is anything wrong?" from a phone. Today he
// cannot: refresh-status.json has NO browser-readable path anywhere in this
// system — get-object.js does not allowlist it, send-status.js is OIDC-gated so
// only a GitHub Actions runner can mint a token for it, and ops.html fetches
// none of it. The documented fallback is a `wrangler r2 object get` from a
// laptop, and OPERATIONS.md §7 measured that CLI serving >20 minutes of stale
// bytes on a hot key. So the health of the paid product is, in practice,
// unobservable to its owner.
//
// This endpoint is the fix, and it is public for the same reason
// /api/cold-status is: every number in it is an aggregate. It returns COUNTS
// AND TIMESTAMPS ONLY.
//
// It reads exactly three things:
//   refresh-status.json   pipeline result + coverage counts + source_health counts
//                         (+ the R2 upload time of that same get, for the lag flag)
//   head(latest-weekly.html)  portal page publish time  (head, never get)
//   head(latest-weekly.zip)   download publish time     (head, never get)
//
// It does NOT read, and must never read:
//   subscribers.json   — customer email, name, Stripe id AND the download token
//   feed-send-log.json / delivery-log.json — recipient addresses
//   portal-access/     — per-subscriber read telemetry; that belongs behind the
//                        OIDC gate in /api/send-status, not on a public URL
//   any bundle body    — the bundles are the paid product
// It emits no town names either: refresh-status.source_health.dead and .failing
// are ARRAYS OF TOWNS, and which towns we have lost is competitive information,
// so only their lengths cross this boundary.
//
// THE THREE-STATE RULE (the reason this file is shaped the way it is)
// -------------------------------------------------------------------
// A green run is not proof. On 2026-08-03 hosted_refresh.py aborted, the ship
// step was skipped (it carries no `if: always()`), and R2 still held the
// previous week's objects — a state that looks identical to success from any
// single "last updated" timestamp. So "worked", "ran but produced nothing" and
// "never ran" are three separate values everywhere below, never collapsed.
//
// THE LAG FLAG (added 2026-09-25)
// -------------------------------
// On 2026-09-23 the daily run shipped fresh bundles at 14:35Z, but its
// refresh-status.json PUT did not land: the upload curl ends in `|| true`, so
// the step still reported success, and R2 kept the 09-22 status. The only
// staleness rule here was 8 days, so this tile called the refresh fine while
// every check that reads refresh-status.json was describing the day before. At
// 03:14Z on 09-24 the status was 36.9 h old and nothing was flagged.
// Three cheap timestamp checks now close that gap (codes in lag.reasons):
//   status_not_landed  latest-weekly.zip was uploaded more than 30 min AFTER
//                      refresh-status.json, and has been in R2 for 30 min. The
//                      status step starts seconds after the zip PUT (5.8 s on
//                      09-23), so this is the 09-23 miss, seen 30 min after it.
//                      A zip replaced by hand trips it too, until the next run.
//   refresh_late       refresh-status.json is older than 36 h AND so is the
//                      zip (or there is no zip): no run has landed at all.
//   status_late        the status is older than 36 h but the zip is not, and
//                      the zip is not newer by 30 min (an edge of the above).
//   bundle_not_landed  the status says ok but was uploaded more than 6 h after
//                      the zip: the bundle PUT did not land.
// 36 h and 6 h are _presend.js POLICY_DEFAULTS max_status_age_h and
// divergence_h, so this tile and the pre-send gate agree. 36 h clears the
// longest normal gap between two landed runs (26.2 h over 16 scheduled runs,
// 09-09 to 09-24) by 9.8 h. It is age based, not due based, on purpose: runs
// start 3.6 to 6.6 h after the 09:00 cron, so a due rule cries wolf daily.

export async function onRequestGet(context) {
  const { env } = context;
  const now = Date.now();

  const STALE_MS = 8 * 86400_000; // the same 8 days as weekly-send.js:43 and leads.js
  const DRIFT_MS = 15 * 60_000;   // the same 15 minutes as leads.js
  const LAG_MS = 36 * 3600_000;   // the same 36 h as _presend.js max_status_age_h
  const LANDED_MS = 30 * 60_000;  // a run's status PUT follows its zip PUT by seconds
  const DIVERGE_MS = 6 * 3600_000; // the same 6 h as _presend.js divergence_h

  const [statusObj, hHtml, hZip] = await Promise.all([
    readJsonMeta(env, "refresh-status.json"),
    headSafe(env, "latest-weekly.html"),
    headSafe(env, "latest-weekly.zip"),
  ]);
  const status = statusObj.json;

  // ---- the refresh pipeline ------------------------------------------------
  const tRan = status && status.ran_at ? Date.parse(status.ran_at) : NaN;
  const refresh = {
    // never_ran: no readable status object at all. failed: it ran and said so.
    // ran: it ran and claimed success — which is a claim about the RUN, not
    // about whether any row in the corpus is new (none of hosted_refresh.py's
    // gates asserts that), hence age_hours below rather than a bare "ok".
    state: !status ? "never_ran" : (status.ok === false ? "failed" : "ran"),
    ran_at: status && status.ran_at ? String(status.ran_at) : null,
    age_hours: Number.isFinite(tRan) ? Number(((now - tRan) / 3600_000).toFixed(1)) : null,
    degraded: !!(status && status.degraded),
    rows: status && typeof status.count === "number" ? status.count : null,
    error: status && status.error ? String(status.error).slice(0, 200) : null,
    runner: status && status.runner ? String(status.runner).slice(0, 40) : null,
  };

  const cov = (status && status.coverage) || null;
  const coverage = {
    live_sources: numOrNull(cov && cov.live_sources),
    expected_sources: numOrNull(cov && cov.expected_sources),
    lost_sources: numOrNull(cov && cov.lost_sources),
    // The flag that fires the amber reduced-coverage box in the weekly email
    // and, since KB/07 Stage D, on the portal page. Surfacing it here is how
    // the operator sees what the customer is being told.
    disclose: !!(cov && cov.disclose),
    monthly_sources: Array.isArray(cov && cov.monthly_sources) ? cov.monthly_sources.length : null,
  };

  const sh = (status && status.source_health) || null;
  const sources = {
    tracked: numOrNull(sh && sh.tracked),
    // Counts only — never the town names. See the header.
    dead: len(sh && sh.dead),
    failing: len(sh && sh.failing),
    collapsed: len(sh && sh.collapsed),
    vanished: len(sh && sh.vanished),
  };

  // ---- the portal ----------------------------------------------------------
  // Same four states as /api/send-status's portal branch, on the same
  // timestamps, so the public tile and the private watchdog cannot disagree.
  const tHtml = hHtml && hHtml.uploaded ? new Date(hHtml.uploaded).getTime() : NaN;
  const tZip = hZip && hZip.uploaded ? new Date(hZip.uploaded).getTime() : NaN;
  const drift = Number.isFinite(tHtml) && Number.isFinite(tZip)
    ? Math.round(Math.abs(tHtml - tZip) / 60_000) : null;
  let portalState;
  if (!Number.isFinite(tHtml)) {
    // Not an error. /leads redirects to the /api/my-leads download in this
    // state, by design, so a customer is served — just not by the portal.
    portalState = "not_published";
  } else if (now - tHtml > STALE_MS) {
    portalState = "stale";
  } else if (drift !== null && drift > DRIFT_MS / 60_000) {
    portalState = "drift";
  } else {
    portalState = "ok";
  }
  const portal = {
    state: portalState,
    published_at: Number.isFinite(tHtml) ? new Date(tHtml).toISOString() : null,
    age_hours: Number.isFinite(tHtml) ? Number(((now - tHtml) / 3600_000).toFixed(1)) : null,
    download_published_at: Number.isFinite(tZip) ? new Date(tZip).toISOString() : null,
    drift_minutes: drift,
  };

  // ---- the lag flag (see THE LAG FLAG above) -------------------------------
  // Both upload times are the R2 server clock, so they compare with each other;
  // ran_at is the runner clock and is only used for the age, exactly as
  // refresh.age_hours already does, so the tile and the flag cannot disagree.
  const tStatusUp = Number.isFinite(statusObj.uploaded) ? statusObj.uploaded : tRan;
  const zipAhead = Number.isFinite(tZip) && Number.isFinite(tStatusUp) ? tZip - tStatusUp : NaN;
  const zipAge = Number.isFinite(tZip) ? now - tZip : NaN;
  const lagReasons = [];
  if (status && Number.isFinite(tRan)) {
    const statusLate = now - tRan > LAG_MS;
    const zipLate = !Number.isFinite(tZip) || zipAge > LAG_MS;
    const notLanded = zipAhead > LANDED_MS && zipAge > LANDED_MS;
    if (statusLate && zipLate) lagReasons.push("refresh_late");
    if (notLanded) lagReasons.push("status_not_landed");
    if (statusLate && !zipLate && !notLanded) lagReasons.push("status_late");
    if (status.ok !== false && -zipAhead > DIVERGE_MS) lagReasons.push("bundle_not_landed");
  }
  const h1 = (ms) => Number((ms / 3600_000).toFixed(1));
  const lag = {
    flag: lagReasons.length > 0,
    reasons: lagReasons,
    limit_hours: LAG_MS / 3600_000,
    status_age_hours: refresh.age_hours,
    status_uploaded_at: Number.isFinite(statusObj.uploaded) ? new Date(statusObj.uploaded).toISOString() : null,
    download_age_hours: Number.isFinite(zipAge) ? h1(zipAge) : null,
    download_ahead_minutes: Number.isFinite(zipAhead) ? Math.round(zipAhead / 60_000) : null,
  };

  // ---- one word for the phone ---------------------------------------------
  const bad = [];
  const warn = [];
  if (refresh.state === "never_ran") bad.push("no refresh status object in R2");
  if (refresh.state === "failed") bad.push("the last refresh FAILED" + (refresh.error ? ": " + refresh.error : ""));
  if (refresh.age_hours !== null && refresh.age_hours * 3600_000 > STALE_MS) {
    bad.push(`the last refresh ran ${Math.floor(refresh.age_hours / 24)} days ago`);
  } else if (lagReasons.includes("refresh_late")) {
    bad.push(`no refresh has landed for ${refresh.age_hours} h (limit ${lag.limit_hours} h): ` +
             "refresh-status.json and " + (Number.isFinite(tZip)
               ? `latest-weekly.zip (${lag.download_age_hours} h) are both older than that`
               : "a missing latest-weekly.zip say the daily run is not landing"));
  }
  if (lagReasons.includes("status_not_landed")) {
    warn.push(`the last status upload did not land: latest-weekly.zip was uploaded ` +
              `${h1(zipAhead)} h after refresh-status.json, which is now ${refresh.age_hours} h old. ` +
              "Anything that reads refresh-status.json is describing an older run " +
              "(or the zip was replaced by hand)");
  }
  if (lagReasons.includes("status_late")) {
    warn.push(`refresh-status.json is ${refresh.age_hours} h old (limit ${lag.limit_hours} h) ` +
              `while latest-weekly.zip is ${lag.download_age_hours} h old`);
  }
  if (lagReasons.includes("bundle_not_landed")) {
    warn.push(`the last refresh reported success, but latest-weekly.zip was uploaded ` +
              `${h1(-zipAhead)} h before its status: the bundle upload did not land`);
  }
  if (Number.isFinite(tZip) && now - tZip > STALE_MS) {
    bad.push(`latest-weekly.zip is ${Math.floor((now - tZip) / 86400_000)} days old — ` +
             "the download customers are emailed is stale");
  }
  if (portalState === "stale") bad.push("the portal page is stale and is hiding customers' rows");
  if (portalState === "drift") warn.push(`portal page and download published ${drift} min apart`);
  if (portalState === "not_published") warn.push("portal page not published — /leads falls back to the download");
  if (refresh.degraded) warn.push("the refresh reported itself degraded");
  if (coverage.disclose) {
    warn.push(`reduced coverage disclosed to customers: ${coverage.live_sources} of ` +
              `${coverage.expected_sources} sources live`);
  }
  if (sources.dead) warn.push(`${sources.dead} source(s) dead`);
  if (sources.failing) warn.push(`${sources.failing} source(s) failing`);

  return json({
    status: bad.length ? "bad" : (warn.length ? "warn" : "ok"),
    checked_at: new Date(now).toISOString(),
    problems: bad,
    warnings: warn,
    refresh, coverage, sources, portal, lag,
  });
}

function len(a) { return Array.isArray(a) ? a.length : null; }
function numOrNull(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

// Same read as before (an unreadable or unparseable object is null), plus the
// R2 upload time that the get() already returns. No extra R2 call.
async function readJsonMeta(env, key) {
  try {
    const o = await env.BUNDLES.get(key);
    if (!o) return { json: null, uploaded: NaN };
    const up = o.uploaded ? new Date(o.uploaded).getTime() : NaN;
    try { return { json: JSON.parse(await o.text()), uploaded: up }; }
    catch { return { json: null, uploaded: up }; }
  } catch { return { json: null, uploaded: NaN }; }
}

async function headSafe(env, key) {
  try { return await env.BUNDLES.head(key); } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Live status: a cached answer to "is anything wrong?" is a wrong answer.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      // Deliberately NO Access-Control-Allow-Origin. ops.html is same-origin,
      // so it does not need one, and KB/07 A11 asks that the Pages static
      // default not be extended to any operational route.
    },
  });
}
