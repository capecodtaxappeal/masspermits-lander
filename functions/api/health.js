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

export async function onRequestGet(context) {
  const { env } = context;
  const now = Date.now();

  const STALE_MS = 8 * 86400_000; // the same 8 days as weekly-send.js:43 and leads.js
  const DRIFT_MS = 15 * 60_000;   // the same 15 minutes as leads.js

  const [status, hHtml, hZip] = await Promise.all([
    readJson(env, "refresh-status.json"),
    headSafe(env, "latest-weekly.html"),
    headSafe(env, "latest-weekly.zip"),
  ]);

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

  // ---- one word for the phone ---------------------------------------------
  const bad = [];
  const warn = [];
  if (refresh.state === "never_ran") bad.push("no refresh status object in R2");
  if (refresh.state === "failed") bad.push("the last refresh FAILED" + (refresh.error ? ": " + refresh.error : ""));
  if (refresh.age_hours !== null && refresh.age_hours * 3600_000 > STALE_MS) {
    bad.push(`the last refresh ran ${Math.floor(refresh.age_hours / 24)} days ago`);
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
    refresh, coverage, sources, portal,
  });
}

function len(a) { return Array.isArray(a) ? a.length : null; }
function numOrNull(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

async function readJson(env, key) {
  try {
    const o = await env.BUNDLES.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch { return null; }
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
