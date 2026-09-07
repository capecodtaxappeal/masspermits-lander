// MassPermits — internal pipeline board payload (Pages Function, Access-gated).
//
// Answers one question for /admin/pipeline: did the daily ingest run, and what
// is each of the 39 attempted sources doing? Read-only. Writes nothing, sends
// nothing, and touches no permit row.
//
// THREE LAYERS, AND LAYER 0 DOMINATES LAYER 1 ABSOLUTELY
// ------------------------------------------------------
//   Layer 0  is the board trustworthy?   -> when the answer is no, NO town
//                                           renders green. Not dimmed green.
//                                           Grey, with the last-known state as
//                                           text.
//   Layer 1  what is this town's state?  -> source_health.py's six states,
//                                           RENDERED, never recomputed. Plus
//                                           the one colour rule `state` cannot
//                                           express (see T4).
//   Layer 2  badges                      -> never change a colour.
//
// A pipeline dashboard that cannot distinguish FRESH green from FROZEN green
// reproduces both false-green incidents this system has already survived, on
// the one surface built to catch them. That is what Layer 0 is for.
//
// READ PATH — NO ALLOWLIST WIDENING ANYWHERE
// ------------------------------------------
// A Pages Function reads R2 through the BUNDLES binding directly.
// get-object.js's READABLE set governs that ONE HTTP endpoint, not the binding
// — newsletter-send.js:23 already does env.BUNDLES.get("refresh-status.json")
// with no allowlist involvement. So READABLE stays at four keys and
// upload-bundle.js's ALLOWED_KEYS is untouched.
//
// THE CUSTOMER LIST IS NEVER TOUCHED HERE. The R2 object holding customer
// emails, names and download tokens is not read, not headed, not listed and
// not named anywhere in this file or in pipeline-probe.js -- including in
// these comments, because the merge check for that invariant is a grep for
// its filename across both files expecting zero hits. It is named in
// get-object.js's READABLE set and in upload-bundle.js's permanent exclusion
// list, and neither of those files is touched by this change.

import { verifyCfAccess, accessDenied } from "./_cf-access.js";

// ── Freshness: DUE-BASED, never age-based ───────────────────────────────────
// weekly-refresh.yml runs "0 9 * * 1" (Monday anchor) + "0 9 * * 0,2-6" (the
// other six days) = daily at 09:00 UTC. So the question is never "how old is
// this?" — it is "did the run that was DUE actually land?"
//
// Under an age rule (>36h) a dropped 09:00 run is not flagged until 21:00 the
// FOLLOWING day: the board shows confident fresh green through the entire day
// of the outage. Under the due rule it flags at 13:00 the same day, four hours
// after the miss. Same-day detection of a missed daily run is the whole point
// of this surface.
const REFRESH_HOUR_UTC = 9;
const GRACE_H = 4; // measured slip on record: a 09:00 job GitHub deferred to
                   // 12:26 on 2026-08-03 (3h26m). send-status.js carries
                   // GRACE_HOURS = 1.5 for the same phenomenon on a different
                   // cadence.
//
// DO NOT unify this with weekly-send.js:43's 8 * 86400_000. That number answers
// a WEEKLY DELIVERY question. Borrowing it for a DAILY INGEST cadence would
// show green through six dead runs. Two staleness numbers for two genuinely
// different cadences is correct; two for one cadence is the bug generator.

// Mirrored from source_health.py. Used ONLY by the confidence panel, which
// computes when each alert rule becomes armed — never to recompute a state.
// emit_probe_map.py emits the same block into probe-map.json and this file
// diffs the two, so a constant changed in Python and not here announces itself
// instead of quietly making the confidence panel lie.
const HEALTH = {
  FAIL_ALERT_RUNS: 3,
  FAIL_ALERT_HOURS: 48,
  VANISH_ALERT_RUNS: 5,
  VOLUME_COLLAPSE_RATIO: 0.25,
  VOLUME_COLLAPSE_RUNS: 3,
  VOLUME_MIN_SAMPLES: 5,
  PE_MAX_ROWS: 2400,
};

// RED is exactly source_health.ALERTABLE minus "recovered"
// (source_health.py:327 — ("dead","collapsed","vanished","recovered")).
// Defining red as that set means the board and the alert email are the same
// statement and cannot drift, because there is no second threshold to drift
// from. It also settles `collapsed`: it is RED, because a source silently
// shipping 25% of its own volume is a paid-data-integrity fault the module
// already emails about, and the board must not demote what alerting escalates.
const RED_STATES = new Set(["dead", "collapsed", "vanished"]);

const ERR_MAX = 300; // source_health.ERR_MAX — error strings are already
                     // truncated there; re-applied here so a hand-written
                     // status.json cannot ship an unbounded vendor string.

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await verifyCfAccess(request, env);
  if (!auth.ok) {
    // JSON for the fetch, not the HTML page: the caller is the dashboard's own
    // XHR and it renders the reason itself. accessDenied() is for a navigation.
    return json({ error: "unauthorized", reason: auth.reason,
                  detail: auth.detail || null }, 403);
  }

  const now = Date.now();

  // ── ?view=coverage — the 351-town roadmap, fetched lazily ────────────────
  // Kept off the board payload on purpose. The Coverage tab is a ROADMAP, not
  // a status board: 351 towns with neutral feasibility chips and no colours at
  // all. Loading ~100KB of it on every board refresh would make the one screen
  // that answers "did the pipeline run" slower for a tab nobody opens hourly.
  if (new URL(request.url).searchParams.get("view") === "coverage") {
    let reg = null;
    try {
      const m = await env.BUNDLES.get("probe-map.json");
      reg = m ? (JSON.parse(await m.text()).registry || null) : null;
    } catch { reg = null; }
    if (!reg || reg.available !== true) {
      return json({ ok: false, registry: null,
        reason: (reg && reg.reason) ||
          "probe-map.json is not in R2, so the statewide registry has never " +
          "been published. Run PermitPulse/emit_probe_map.py and upload it " +
          "with wrangler." }, 200);
    }
    return json({ ok: true, registry: reg }, 200);
  }

  // ── Layer 0, B0: the R2 read itself ───────────────────────────────────────
  // 503, never 200-with-empty (my-leads.js:28's shape). A storage blip must not
  // read as a dead pipeline, and an empty green board must not exist.
  let head, statusText, healthText, mapText;
  try {
    head = await env.BUNDLES.head("refresh-status.json");
    const [s, h, m] = await Promise.all([
      env.BUNDLES.get("refresh-status.json"),
      env.BUNDLES.get("source-health.json"),
      env.BUNDLES.get("probe-map.json"),
    ]);
    statusText = s ? await s.text() : null;
    healthText = h ? await h.text() : null;
    mapText = m ? await m.text() : null;
  } catch (e) {
    return json(boardOnly("B0", "red", "UNAVAILABLE",
      "Cannot read the pipeline status",
      "R2 did not answer. This is a storage fault, not a statement about the " +
      "pipeline — no town state is known and none is being guessed. " +
      String((e && e.message) || e).slice(0, 200), now), 503);
  }

  // A present-but-corrupt object is a different fault from an absent one, and
  // conflating them would send the operator to the wrong place. Both are "the
  // board cannot answer", which is what 503 means; the detail says which.
  let status = null, health = null, probeMap = null;
  if (statusText !== null) {
    try { status = JSON.parse(statusText); } catch (e) {
      return json(boardOnly("B0", "red", "UNAVAILABLE",
        "refresh-status.json is not parseable JSON",
        "The object exists in R2 but its body is not JSON — a truncated or " +
        "clobbered upload, not a pipeline outcome. " +
        String((e && e.message) || e).slice(0, 200), now), 503);
    }
  }
  try { health = healthText === null ? null : JSON.parse(healthText); } catch { health = null; }
  try { probeMap = mapText === null ? null : JSON.parse(mapText); } catch { probeMap = null; }

  // ── Layer 0, B1: nothing has ever been written ────────────────────────────
  if (!status) {
    return json(boardOnly("B1", "red", "NO STATUS",
      "The pipeline has never written a status object, or it was deleted",
      "refresh-status.json is absent from R2. Zero town rows are rendered — " +
      "an empty green board is the failure this surface exists to prevent.",
      now), 200);
  }

  const sources = status.sources || {};
  const errors = status.errors || {};
  const cadence = status.cadence || {};
  const coverage = status.coverage || null; // null on gate-abort AND both crash
                                            // paths; every read goes through
                                            // this, because
                                            // status.coverage.live_sources
                                            // throws on precisely the runs you
                                            // most need to see.
  const rollup = status.source_health || null;
  const hsrc = (health && health.sources) || {};

  const uploadedMs = head && head.uploaded ? head.uploaded.getTime() : null;
  const ranMs = status.ran_at ? Date.parse(status.ran_at) : NaN;
  const due = lastDueAt(now);
  const graceOver = now > due + GRACE_H * 3600_000;

  // Clock source is head("refresh-status.json").uploaded — the R2 SERVER clock
  // — never ran_at, which _write_status() stamps at write time and would
  // happily refresh on a successful run over frozen data.
  const stale = graceOver && (uploadedMs === null || uploadedMs < due);

  // ...but cross-check the two anyway. `uploaded` fresh with `ran_at` old means
  // somebody re-uploaded an old status object. That is a banner, not a green
  // light.
  const replayGapH = (uploadedMs !== null && Number.isFinite(ranMs))
    ? (uploadedMs - ranMs) / 3600_000 : null;
  const replayed = replayGapH !== null && replayGapH > 6;

  // ── Layer 0 verdict. First match wins. ───────────────────────────────────
  let board;
  if (stale) {
    board = mk("B2", "red", "RUN MISSED",
      `The run due at ${iso(due)} has not landed`,
      uploadedMs === null
        ? "R2 reports no upload time for refresh-status.json at all."
        : `Last upload ${iso(uploadedMs)} (${fmtAge(now - uploadedMs)} ago), ` +
          `which is before the ${iso(due)} due time. Grace window ${GRACE_H}h ` +
          "has closed.");
  } else if (!Object.keys(sources).length && !Object.keys(errors).length) {
    // This is source_health._run_is_scored() in the view layer, and it is the
    // most important branch in this file. When refresh() crashes, health state
    // is FROZEN at its last good values and totals.by_state still reads
    // {ok: 39}. A board that renders that shows 39 green lights for a pipeline
    // that did not run. The tell costs one read: runs_unscored /
    // last_unscored_at / last_unscored_why are written on exactly this path and
    // nothing else is touched (source_health.py:164-166).
    board = mk("B3", "amber", "FROZEN",
      "One pipeline fault, not 39 town faults",
      "The run produced no per-source results at all, so source_health scored " +
      "nothing and every town's stored state is left over from the last run " +
      "that did complete. Nothing on this board is a statement about a town.");
    board.error = trunc(status.error);
    board.traceback_head = status.traceback ? String(status.traceback).slice(0, 1200) : null;
    board.last_unscored_at = (health && health.last_unscored_at) || null;
    board.last_unscored_why = trunc(health && health.last_unscored_why);
    board.runs_unscored = (health && health.runs_unscored) || 0;
  } else if (coverage === null) {
    board = mk("B4", "amber", "ABORTED",
      "The towns answered; the shipping decision failed",
      "coverage is null, which hosted_refresh.py writes on a quality-gate " +
      "abort and on a bundle-build crash. Town lights below are real — the " +
      "scrape reported per-source numbers. The coverage tiles are not computed.");
    board.error = trunc(status.error);
    board.traceback_head = status.traceback ? String(status.traceback).slice(0, 1200) : null;
  } else if (status.degraded === true) {
    board = mk("B5", "amber", "DEGRADED",
      "A coverage shortfall shipped with disclosure",
      "hosted_refresh.py marked the run degraded and let the bundles ship; " +
      "weekly-send.js discloses the shortfall in the customer email. The site " +
      "rebuild is skipped on a degraded run.");
    board.error = trunc(status.error); // the "; "-joined reason list, verbatim
  } else if (health && health.last_scored_at && Number.isFinite(ranMs)
             && Math.abs(Date.parse(health.last_scored_at) - ranMs) > 15 * 60_000) {
    board = mk("B6", "amber", "HEALTH DRIFT",
      "Health history and run status came from different runs",
      `source-health.json was last scored at ${health.last_scored_at} but this ` +
      `status ran at ${status.ran_at}. The health step may have failed on the ` +
      "most recent run, so the town states below may be one run behind the " +
      "row counts beside them.");
  } else {
    board = mk("B7", "green", "CURRENT", "The run that was due has landed", "");
  }

  board.due_at = iso(due);
  board.uploaded_at = uploadedMs === null ? null : iso(uploadedMs);
  board.ran_at = status.ran_at || null;
  board.refresh_hour_utc = REFRESH_HOUR_UTC;
  board.grace_hours = GRACE_H;
  board.ok = status.ok === true;
  board.degraded = status.degraded === true;
  board.runner = status.runner || null;
  board.replayed = replayed;
  board.replay_gap_hours = replayGapH === null ? null : round1(replayGapH);

  // Layer 0 dominates: on B1/B2/B3 nothing renders green. B1 returned above
  // with zero rows, so here it is B2 and B3.
  board.dots_grey = board.verdict === "B2" || board.verdict === "B3";

  // A missing health object is not one of the eight verdicts because the design
  // assumed it present — but it is real (the health step is continue-on-error
  // and warn-only in the engine verify tier, so a tarball without
  // source_health.py silently skips it). It cannot be allowed to produce green:
  // without the history there is no state to render, only row counts. So it
  // greys the dots and says so loudly, rather than inventing a seventh state.
  board.health_missing = !health || !Object.keys(hsrc).length;
  if (board.health_missing) {
    board.dots_grey = true;
    // and the banner stops reading green over a board of grey dots. The verdict
    // letter is unchanged — the RUN may genuinely have landed — but the board
    // cannot claim to be current about towns it has no state for.
    if (board.level === "green") {
      board.level = "amber";
      board.headline = "The run landed, but there is no per-town health history";
      board.detail = "source-health.json is absent or empty. Row counts below " +
        "are real; every state is unknown.";
    }
  }
  board.health_updated_at = (health && health.updated_at) || null;
  board.runs_seen = (health && health.runs_seen) || 0;
  board.runs_scored = (health && health.runs_scored) || 0;

  // ── Layer 1: the town lights ─────────────────────────────────────────────
  // Roll-up cross-check (T7). The per-town record and the roll-up copied into
  // refresh-status.json are written by the same call, so a disagreement means
  // one of the two objects is from a different run. Render both, pick neither.
  const rollExpect = {};
  if (rollup) {
    for (const st of ["dead", "failing", "collapsed", "vanished"]) {
      for (const s of rollup[st] || []) rollExpect[s] = st;
    }
  }

  const keys = Array.from(new Set([
    ...Object.keys(hsrc), ...Object.keys(sources), ...Object.keys(errors),
  ])).sort();

  const towns = keys.map((key) => {
    const h = hsrc[key] || null;
    const state = h ? String(h.state || "unknown") : "unknown";
    const attempted = key in sources || key in errors;
    const rows = key in sources ? num(sources[key]) : null;
    const err = key in errors ? trunc(errors[key])
                              : (h ? trunc(h.last_error) : null);
    const unatt = h ? num(h.consecutive_unattempted) || 0 : 0;
    const scored = h ? num(h.scored_runs) || 0 : 0;

    // The roll-up disagreement is computed for EVERY town and always reported,
    // even when a higher-priority rule wins the colour. "First match wins"
    // governs the light; it must not govern whether the operator is told the
    // two objects disagree.
    const expect = rollExpect[key] || null;
    const inRollupBad = expect !== null;
    const isBadState = ["dead", "failing", "collapsed", "vanished"].includes(state);
    const inconsistent = h !== null &&
      ((inRollupBad && expect !== state) || (isBadState && expect !== state));

    let light, label, why;
    if (board.dots_grey) {
      // T0. Layer 0 dominates. The state is still shown, as TEXT, so nothing is
      // hidden — but no colour is asserted under a board that does not know.
      light = "grey";
      label = "unknown";
      why = board.health_missing
        ? "no health history published"
        : "board verdict " + board.verdict + " — last known state: " + state;
    } else if (state === "vanished") {
      light = "red"; label = "vanished";
      why = `not attempted for ${HEALTH.VANISH_ALERT_RUNS}+ scored runs — dropped from the code registry`;
    } else if (state === "dead") {
      light = "red"; label = "dead";
      why = `${HEALTH.FAIL_ALERT_RUNS} consecutive failed runs and ${HEALTH.FAIL_ALERT_HOURS}h without rows`;
    } else if (state === "collapsed") {
      light = "red"; label = "collapsed";
      why = `answering with under ${Math.round(HEALTH.VOLUME_COLLAPSE_RATIO * 100)}% of its own normal volume for ${HEALTH.VOLUME_COLLAPSE_RUNS} runs`;
    } else if (unatt >= 1 && unatt <= HEALTH.VANISH_ALERT_RUNS - 1) {
      // T4, and it is a COLOUR rule, not a badge. source_health.update() leaves
      // `state` UNTOUCHED on an unattempted run until the counter hits 5
      // (source_health.py:186-198). A town edited out of PERMITEYES_TOWNS
      // therefore holds state:"ok" and, under a pure state->colour mapping,
      // renders GREEN for four consecutive runs — while nothing else in the
      // system can see the loss either: no fetcher raised, so `errors` is
      // empty, and the coverage gate's denominator shrinks to match, reading
      // the deletion as perfect health. This is the only early warning that
      // exists for that class.
      light = "yellow"; label = `not attempted (${unatt}/${HEALTH.VANISH_ALERT_RUNS})`;
      why = "no fetcher raised and no error was recorded — this town was not " +
            "tried at all. Check it is still in PERMITEYES_TOWNS / CORE_SOURCES.";
    } else if (state === "failing") {
      light = "yellow"; label = "failing";
      why = `${num(h && h.consecutive_failures) || 1} failed run(s), below the dead bar`;
    } else if (state === "new" || scored === 0) {
      light = "grey"; label = "new";
      why = "no scored outcome yet";
    } else if (inconsistent) {
      // T7. Render both, pick neither.
      light = "grey"; label = "inconsistent";
      why = `per-town state "${state}" disagrees with the refresh-status roll-up ("${expect || "not listed"}")`;
    } else if (rows === 0) {
      // T8. Should be unreachable: scraper.py:979-982 moves any 0-count source
      // into `errors` and deletes it from `counts`, so `sources` never contains
      // a zero. If this renders, the zero-row floor was bypassed — that is the
      // 2026-08-01 signature.
      light = "yellow"; label = "zero rows";
      why = "a source is in `sources` with a count of 0. scraper.py's zero-row " +
            "floor should have moved it into `errors`. This is the 2026-08-01 " +
            "silent-death signature; treat it as a scraper bug, not a town outage.";
    } else if (state === "ok" && rows !== null && rows > 0) {
      light = "green"; label = "ok"; why = "";
    } else {
      // Everything the six states plus the rules above do not cover. Never
      // green by default.
      light = "grey"; label = state;
      why = attempted ? "attempted, but no rule matched this combination"
                      : "not in this run's sources or errors";
    }

    // ── Layer 2: badges. None of these may change a colour. ────────────────
    const badges = [];
    if (err) {
      // A 0-row town is byte-identical to an errored town at the state level,
      // deliberately. They separate on the error string LITERAL. This match is
      // coupled to scraper.py's wording; if that string changes the badge
      // degrades to the vaguer category, which is an acceptable failure and not
      // a wrong one.
      badges.push(/^returned 0 rows/.test(err)
        ? { k: "SILENT ZERO", t: "We reached the vendor and parsed nothing — a layout or filter change. Run the probe." }
        : { k: "FETCH ERROR", t: "The fetcher raised. The message below is the vendor/exception text, verbatim." });
    }
    const cad = cadence[key] || (h && h.cadence) || null;
    if (cad) {
      badges.push({ k: String(cad).toUpperCase(), t:
        "Monthly publisher — it pulls a trailing multi-month window, so an " +
        "empty window is a failure, not a quiet week. Cadence never changes a " +
        "light's colour anywhere on this board. Read the trend as a plateau, " +
        "not a sawtooth." });
    }
    if (rows === HEALTH.PE_MAX_ROWS) {
      // Inferred, and labelled inferred. The honest signal is
      // scraper.PE_TRUNCATED, which has zero consumers outside scraper.py and
      // is never serialized. And count == 2400 is the WRONG test anyway:
      // truncation is `hit_cap and out and not saw_out_of_window`, which is why
      // Sandwich reports 1,726 kept at cap 2400 AND at cap 4200 with zero rows
      // hidden. So this says "cannot tell", not "truncated" and not nothing.
      badges.push({ k: "AT CAP?", inferred: true, t:
        `count == PE_MAX_ROWS (${HEALTH.PE_MAX_ROWS}). This is a ceiling, not a ` +
        "truncation measurement — scraper.PE_TRUNCATED is the real signal and " +
        "it is never serialized. Cannot tell whether rows were hidden." });
    }
    if (inconsistent && label !== "inconsistent") {
      badges.push({ k: "ROLL-UP DISAGREES", t:
        `per-town state "${state}" vs refresh-status roll-up "${expect || "not listed"}" ` +
        "— the two objects are from different runs." });
    }

    const recent = (h && Array.isArray(h.recent) ? h.recent : []).map((r) => ({
      at: r && r.at ? String(r.at) : null,
      rows: num(r && r.rows) || 0,
      ok: !!(r && r.ok),
    }));

    return {
      key, light, label, why, state, rows, attempted,
      last_error: err,
      badges,
      recent,                                   // the ONLY per-town time series
      cadence: cad,
      scored_runs: scored,
      consecutive_unattempted: unatt,
      consecutive_failures: h ? num(h.consecutive_failures) || 0 : 0,
      consecutive_ok: h ? num(h.consecutive_ok) || 0 : 0,
      last_good: (h && h.last_good) || null,
      last_good_rows: h ? num(h.last_good_rows) : null,
      first_seen: (h && h.first_seen) || null,
      inconsistent,
      rollup_state: expect,
      alertable: RED_STATES.has(state),
    };
  });

  const counts = { green: 0, yellow: 0, red: 0, grey: 0 };
  for (const t of towns) counts[t.light] = (counts[t.light] || 0) + 1;
  const byLabel = {};
  for (const t of towns) byLabel[t.label] = (byLabel[t.label] || 0) + 1;

  // ── "Fetched, not shipped" — a BOARD figure, never distributed per town ───
  // sources[town] is counted at fetch time; _is_lead() and the address filter
  // run afterwards on the pooled list (scraper.py:984). There is no per-town
  // attribution for the gap and inventing one would be fiction. A town could
  // fetch 1,000 rows, ship 0 sellable leads, and read green — so the column
  // header on this board is "rows fetched", never "leads".
  const sumFetched = Object.values(sources).reduce((a, b) => a + (num(b) || 0), 0);
  const shipped = num(status.count);

  const payload = {
    ok: true,
    now: iso(now),
    signed_in_as: auth.email || null,
    board,
    counts,
    by_label: byLabel,
    towns,
    coverage: coverage ? {
      // The HEALTH denominator is attempted_sources. expected_sources (140) and
      // lost_sources are MARKETING-DISCLOSURE fields measured against what was
      // sold before the 2026-08-01 OpenGov lockout: they are permanent on a
      // perfect run and must never colour anything.
      live_sources: num(coverage.live_sources),
      attempted_sources: num(coverage.attempted_sources),
      rows: num(coverage.rows),
      monthly_sources: coverage.monthly_sources || [],
      disclosure: {
        expected_sources: num(coverage.expected_sources),
        lost_sources: num(coverage.lost_sources),
        disclose: coverage.disclose === true,
      },
    } : null,
    fetched_vs_shipped: {
      sum_fetched: sumFetched,
      shipped_leads: shipped,
      gap: (shipped === null || shipped === undefined) ? null : sumFetched - shipped,
    },
    confidence: confidence(now, health, hsrc),
    drift: drift(probeMap, sources, errors),
    probe: probeStatus(probeMap, board),
    constants_drift: constantsDrift(probeMap),
  };

  return json(payload, 200);
}

// ── The confidence panel: "a green run is not proof", computed ──────────────
// A board rendering "0 dead - 0 collapsed - 0 vanished" implies those checks
// ran and passed. Early in a history they CANNOT run. So an unarmed rule renders
// as "not armed - needs N, have M", never as 0, and the panel retires itself
// once every rule is armed so it does not become furniture.
function confidence(now, health, hsrc) {
  if (!health) {
    return { available: false,
             reason: "source-health.json is absent — there is no history to " +
                     "measure confidence against." };
  }
  const runsScored = num(health.runs_scored) || 0;
  const towns = Object.values(hsrc);

  // Earliest moment ANY tracked source could satisfy `dead`: it needs
  // FAIL_ALERT_HOURS since its own last_good, and the source with the OLDEST
  // last_good gets there first.
  let minLastGood = null;
  for (const h of towns) {
    const t = h && h.last_good ? Date.parse(h.last_good)
            : h && h.first_seen ? Date.parse(h.first_seen) : NaN;
    if (Number.isFinite(t)) minLastGood = minLastGood === null ? t : Math.min(minLastGood, t);
  }
  const deadEarliest = minLastGood === null ? null : minLastGood + HEALTH.FAIL_ALERT_HOURS * 3600_000;
  const deadArmed = runsScored >= HEALTH.FAIL_ALERT_RUNS
                    && deadEarliest !== null && now >= deadEarliest;

  // `collapsed` needs VOLUME_MIN_SAMPLES prior OK samples, and the baseline
  // EXCLUDES the run being judged — source_health.py takes recent.slice(1).
  let collapseArmedFor = 0;
  for (const h of towns) {
    const rec = Array.isArray(h && h.recent) ? h.recent : [];
    const priorOk = rec.slice(1).filter((r) => r && r.ok).length;
    if (priorOk >= HEALTH.VOLUME_MIN_SAMPLES) collapseArmedFor++;
  }

  const rules = [
    { rule: "failing", requires: "1 failed run",
      have: `${runsScored} scored run(s)`, armed: runsScored >= 1 },
    { rule: "dead",
      requires: `${HEALTH.FAIL_ALERT_RUNS} consecutive failures AND ${HEALTH.FAIL_ALERT_HOURS}h since last_good`,
      have: `${runsScored} scored run(s); oldest last_good ${minLastGood === null ? "unknown" : iso(minLastGood)}`,
      armed: deadArmed,
      not_before: deadEarliest === null ? null : iso(deadEarliest) },
    { rule: "collapsed",
      requires: `${HEALTH.VOLUME_MIN_SAMPLES} prior OK samples, then ${HEALTH.VOLUME_COLLAPSE_RUNS} low runs`,
      have: `armed for ${collapseArmedFor} of ${towns.length} towns`,
      armed: towns.length > 0 && collapseArmedFor === towns.length },
    { rule: "vanished", requires: `${HEALTH.VANISH_ALERT_RUNS} scored runs`,
      have: `${runsScored} scored run(s)`, armed: runsScored >= HEALTH.VANISH_ALERT_RUNS },
  ];

  return {
    available: true,
    runs_seen: num(health.runs_seen) || 0,
    runs_scored: runsScored,
    runs_unscored: num(health.runs_unscored) || 0,
    tracked: towns.length,
    rules,
    all_armed: rules.every((r) => r.armed),
  };
}

// ── Roster drift: computed, never asserted ──────────────────────────────────
// A hand-written "39 towns" claim rots. A computed diff cannot.
//   A = probe-map.json roster            what the engine says it tries
//   B = this run's sources ∪ errors      what the run actually attempted
//   C = registry already_live:true + ", MA"   what the registry records as live
function drift(probeMap, sources, errors) {
  if (!probeMap) {
    return { available: false,
             reason: "probe-map.json is absent from R2, so the engine's own " +
                     "roster (set A) and the statewide registry (set C) cannot " +
                     "be diffed against this run. Publish it with " +
                     "emit_probe_map.py + wrangler." };
  }
  const A = new Set(probeMap.expected_roster || probeMap.roster || []);
  const B = new Set([...Object.keys(sources), ...Object.keys(errors)]);
  const reg = probeMap.registry || {};
  const C = new Set((reg.already_live_names || []).map((n) => n + ", MA"));

  const diff = (x, y) => [...x].filter((v) => !y.has(v)).sort();
  return {
    available: true,
    map_generated_at: probeMap.generated_at || null,
    roster_fingerprint: probeMap.roster_fingerprint || null,
    a_count: A.size, b_count: B.size, c_count: C.size,
    in_a_not_b: diff(A, B),   // the `vanished` precursor
    in_b_not_a: diff(B, A),   // the probe map is stale
    in_ab_not_c: diff(new Set([...A, ...B]), C), // wired without being recorded
    in_c_not_ab: diff(C, new Set([...A, ...B])),
    // Surface the registry's own disagreements rather than silently preferring
    // the field that happens to be right. A dashboard that quietly routes
    // around a rotting field is a dashboard that stops telling you it is
    // rotting. Join on the per-town already_live boolean, never on
    // _meta.already_live_towns and never on feasibility.
    registry_warnings: reg.warnings || [],
    registry_available: reg.available === true,
    registry_total: num(reg.total),
  };
}

function constantsDrift(probeMap) {
  const emitted = probeMap && probeMap.health_constants;
  if (!emitted) return { checked: false };
  const out = [];
  for (const k of Object.keys(HEALTH)) {
    if (k in emitted && emitted[k] !== HEALTH[k]) {
      out.push(`${k}: this board says ${HEALTH[k]}, source_health.py says ${emitted[k]}`);
    }
  }
  return { checked: true, mismatches: out };
}

function probeStatus(probeMap, board) {
  if (!probeMap) {
    return { available: false,
             reason: "probe-map.json is not in R2. Buttons are disabled until " +
                     "emit_probe_map.py has been run and the object published." };
  }
  if (board.verdict === "B2") {
    return { available: false,
             reason: "The board does not know whether the pipeline ran. Fix " +
                     "the missed run before testing individual towns." };
  }
  const specs = probeMap.sources || {};
  const kinds = {};
  for (const [k, s] of Object.entries(specs)) {
    kinds[k] = { probe: s.probe || "none", kind: s.kind || "none",
                 reason: s.reason || null, note: s.note || null };
  }
  return { available: true, probe_rows: num(probeMap.probe_rows),
           generated_at: probeMap.generated_at || null, sources: kinds };
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Most recent 09:00 UTC at or before `now`.
function lastDueAt(now) {
  const d = new Date(now);
  d.setUTCHours(REFRESH_HOUR_UTC, 0, 0, 0);
  if (d.getTime() > now) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

function mk(verdict, level, label, headline, detail) {
  return { verdict, level, label, headline, detail };
}

function boardOnly(verdict, level, label, headline, detail, now) {
  const b = mk(verdict, level, label, headline, detail);
  b.dots_grey = true;
  b.due_at = iso(lastDueAt(now));
  b.refresh_hour_utc = REFRESH_HOUR_UTC;
  b.grace_hours = GRACE_H;
  return { ok: false, now: iso(now), board: b, towns: [],
           counts: { green: 0, yellow: 0, red: 0, grey: 0 },
           coverage: null, confidence: { available: false, reason: detail },
           drift: { available: false, reason: detail },
           probe: { available: false, reason: "The board could not be read." } };
}

function iso(ms) { return new Date(ms).toISOString(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function round1(n) { return Math.round(n * 10) / 10; }
function trunc(s) {
  if (s === null || s === undefined) return null;
  const t = String(s);
  return t.length > ERR_MAX ? t.slice(0, ERR_MAX) : t;
}
function fmtAge(ms) {
  const h = ms / 3600_000;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}
