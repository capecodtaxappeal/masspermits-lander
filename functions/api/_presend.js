// MassPermits — the pre-send gate. Shared logic, no side effects.
//
// THE ONE-SENTENCE REASON THIS FILE EXISTS
// ----------------------------------------
// Every existing gate reads a status file that is written by the same job whose
// failure it is meant to detect. `weekly-send.js:39` reads refresh-status.json
// and mails whatever zip happens to be in R2; nothing anywhere has ever looked
// at the zip. R2 stamps `uploaded` on the object itself and no failing job can
// forge it. That single field is what this module gates on.
//
// WHAT IT IS NOT
// --------------
// It sends nothing, writes nothing, and mutates no argument. `gather()` does
// the R2 reads; `evaluate()` is pure and is what the tests drive. Keeping those
// apart is what makes the four historical incidents replayable offline.
//
// THE FOUR VERDICTS, AND WHICH ONE IS ALLOWED TO BE SILENT
// -------------------------------------------------------
//   GO                  fresh, verified, new rows, not already delivered.
//   GO_WITH_DISCLOSURE  send it, and say what is short. A smaller or older true
//                       file is deliverable. This is the 2026-08-03 lesson.
//   HOLD                the data is not here YET. The refresh is late, not
//                       dead. Exit 0, say nothing, let a later trigger decide.
//                       *** THE ONLY SILENT VERDICT, AND IT SELF-EXPIRES. ***
//   NO_GO               something is wrong that sending cannot fix. NEVER
//                       silent: the owner is always told, and when the
//                       subscriber would otherwise receive nothing at all,
//                       `customer_gets_nothing` is set so the caller can say so.
//
// WHY HOLD IS BOUNDED BY A CLOCK AND NOT BY A RETRY
// -------------------------------------------------
// Measured over nine Mondays (2026-07-06 .. 2026-08-31): zero scheduled sends
// started within 30 minutes of 12:00 UTC, median lateness 149 min, worst 406.
// On four of those nine the refresh started at or AFTER the nominal send time;
// on 2026-08-31 it started 16:38 and the send ran 18:46 — correct ordering by
// luck. So at 12:00 on a Monday, "the bundle predates this window" is far more
// often "GitHub is late" than "the pipeline is broken", and alarming on it
// would train the operator to ignore the alarm.
//
// But a hold that nobody revisits is the 2026-08-03 failure with a nicer name.
// So HOLD is legal only while `now < hold_until_hour` (default 20:00 UTC
// Monday). After that hour the same inputs can no longer produce HOLD: they
// produce GO_WITH_DISCLOSURE with the data's real date stated, or NO_GO with
// the customer told. Silence has an expiry time and the expiry is in the gate,
// not in an operator's memory.

const HOUR = 3600_000;

// Every threshold, in one place, with the reason it has that value.
export const POLICY_DEFAULTS = {
  send_dow: 1,                    // Monday (UTC), matches send-status.js SEND_DOW
  send_hour: 12,                  // 12:00 UTC nominal, matches weekly-feed.yml cron
  hold_until_hour: 20,            // after this UTC hour on send day, holding is over.
                                  // 20:00 is past the worst observed send start
                                  // (18:46 on 2026-08-31) with room to spare.
  max_bundle_age_h: 48,           // never mail a bundle older than this AS this
                                  // week's leads, at any hour, for any reason.
  max_status_age_h: 36,           // refresh-status.json older than this means the
                                  // refresh is not running. weekly-send.js:43's
                                  // 8-day window is 8x the delivery cadence and
                                  // cannot detect that; it stays as the backstop.
  divergence_h: 6,                // status newer than the object by more than this,
                                  // with ok:true, means the bundle PUT did not land
                                  // while the `if: always()` status PUT did.
  size_tolerance: 0.6,            // +/- vs the trailing median weekly byte size.
  verify_sha256: true,            // hash the object and compare to the manifest.
  enforce: false,                 // STAGE GATE. false = compute and report only;
                                  // the sender ignores the verdict. Flip to true
                                  // in R2 only after a week of agreeing verdicts.
  notice: false,                  // "nothing new this week" customer mail. OFF.
                                  // Turning this on makes Mondays send mail that
                                  // no Monday has ever sent. A human turns it on.
};

const POLICY_SHAPE = {
  send_dow: [0, 6], send_hour: [0, 23], hold_until_hour: [0, 23],
  max_bundle_age_h: [1, 336], max_status_age_h: [1, 336], divergence_h: [1, 72],
  size_tolerance: [0.05, 0.95],
};

// A malformed policy object must never be able to OPEN the gate. Unknown keys
// are dropped; out-of-range numbers fall back to the default; the two booleans
// must be literally true to take effect.
export function normalisePolicy(raw) {
  const p = { ...POLICY_DEFAULTS };
  if (!raw || typeof raw !== "object") return p;
  for (const [k, range] of Object.entries(POLICY_SHAPE)) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= range[0] && v <= range[1]) p[k] = v;
  }
  for (const k of ["enforce", "notice", "verify_sha256"]) {
    if (raw[k] === true) p[k] = true;
    if (raw[k] === false) p[k] = false;
  }
  return p;
}

// 00:00 UTC of the most recent send day at or before `now`. The send WINDOW is
// the whole day, not the hour: a bundle uploaded at 09:14 and a send at 18:46
// belong to the same Monday, and any rule anchored to 12:00 would call the 09:14
// upload "before this send" and hold forever.
export function windowStart(now, p = POLICY_DEFAULTS) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - p.send_dow + 7) % 7));
  return d.getTime();
}

export function dueAt(now, p = POLICY_DEFAULTS) {
  const t = windowStart(now, p) + p.send_hour * HOUR;
  return t <= now ? t : t - 7 * 24 * HOUR;
}

export function holdDeadline(now, p = POLICY_DEFAULTS) {
  return windowStart(now, p) + p.hold_until_hour * HOUR;
}

// G2, as a function rather than as a comment. weekly-send.js:87 reads
// `priorLog[0]`, and a SKIP entry carries `sent: []` — so one skip disarms the
// duplicate guard and the very next trigger re-sends bytes the subscriber
// already holds. The etag memory is the newest entry that HAS an etag.
export function lastEtagEntry(log) {
  if (!Array.isArray(log)) return null;
  for (const e of log) if (e && e.bundle_etag) return e;
  return null;
}

// G1, likewise. send-status.js:50 judges from `log[0]` alone, so a skip written
// after a real delivery in the same window flips the verdict to `stale_bundle`
// for a week that delivered fine. The truth is the BEST outcome since the due
// time, not the newest entry.
export function bestSince(log, since) {
  if (!Array.isArray(log)) return null;
  let delivered = null, skipped = null, attempted = null;
  for (const e of log) {
    if (!e || !e.at || Date.parse(e.at) < since) continue;
    const ok = (e.sent || []).some((s) => s && s.ok);
    if (ok && !delivered) delivered = e;
    else if (e.skipped && !skipped) skipped = e;
    else if (!attempted) attempted = e;
  }
  return delivered || skipped || attempted || null;
}

async function readJson(env, key) {
  try {
    const o = await env.BUNDLES.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch { return null; }
}

async function headObj(env, key) {
  try {
    const h = await env.BUNDLES.head(key);
    if (!h) return null;
    return {
      key,
      etag: h.etag || h.httpEtag || "",
      size: typeof h.size === "number" ? h.size : null,
      uploaded: h.uploaded ? new Date(h.uploaded).toISOString() : null,
    };
  } catch { return null; }
}

// The only function here that touches R2. Reads four objects and two heads.
//
// NO NEW R2 KEY, AND NO ALLOWLIST WIDENED. The bundle fingerprint travels
// inside refresh-status.json as `status.bundle`, written by PermitPulse's
// bundle_manifest.py --merge-status — the same trick source_health.py already
// uses. A standalone bundle-manifest.json would have needed an entry in
// upload-bundle.js's ALLOWED_KEYS to be written and one in get-object.js's
// READABLE set to be read back, and both of those allowlists stay exactly as
// they are.
//
// It does NOT read the R2 customer list — not by get, not by head, not by list.
// The subscriber COUNT this gate reports comes from feed-send-log.json's own
// `subscribers` field, which is a number the sender already wrote.
export async function gather(env, opts = {}) {
  const [policyRaw, status, log, attempt, weekly, monthly] = await Promise.all([
    readJson(env, "presend-policy.json"),
    readJson(env, "refresh-status.json"),
    readJson(env, "feed-send-log.json"),
    readJson(env, "last-send-attempt.json"),
    headObj(env, "latest-weekly.zip"),
    headObj(env, "latest-monthly.zip"),
  ]);
  const policy = normalisePolicy(policyRaw);
  const fp = (status && status.bundle) || null;

  // Byte-identity check. Proves the object in R2 is the object that was built,
  // which closes both "truncated PUT" and "wrong file" — upload-bundle.js:170
  // rejects only byteLength === 0. One native digest call over ~1MB.
  let sha256 = null;
  if (policy.verify_sha256 && opts.hash !== false && weekly &&
      fp && fp.weekly && fp.weekly.sha256) {
    try {
      const o = await env.BUNDLES.get("latest-weekly.zip");
      if (o) {
        const d = await crypto.subtle.digest("SHA-256", await o.arrayBuffer());
        sha256 = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch { sha256 = null; }
  }
  return { policy, status, log, attempt, weekly, monthly, sha256 };
}

// PURE. Same inputs, same verdict, every time — which is what lets the four real
// incidents in presend_replay.mjs be replayed as data instead of as a story.
export function evaluate(now, inp) {
  const p = inp.policy || POLICY_DEFAULTS;
  const { status, log, weekly, monthly, sha256 } = inp;
  const ws = windowStart(now, p);
  const due = dueAt(now, p);
  const deadline = holdDeadline(now, p);
  // The fingerprint of the bundle THIS run built, folded into refresh-status.json
  // by bundle_manifest.py --merge-status. Absent until that ships.
  const man = (status && status.bundle && status.bundle.weekly) || null;
  // The fingerprint of the bundle a subscriber LAST ACTUALLY RECEIVED, recorded
  // by weekly-send.js next to the bundle_etag it already writes. This, and not
  // "the previous build", is the right baseline: the customer's question is
  // whether this differs from what they already hold.
  const prior = lastEtagEntry(log);

  // reasons[] is DECISIVE: every line in it contributed to the verdict, and
  // reasons[0] is what the phone headline prints. notes[] is context that did
  // not decide anything. Keeping them apart is not tidiness — a headline that
  // leads with "latest-monthly.zip is 34 days old (not blocking this send)"
  // under the word NO_GO is a monitor that misdirects at 6am.
  const reasons = [];
  const notes = [];
  const disclosure = [];   // machine-readable codes the email template renders
  const hard = [];         // anything here forces NO_GO
  const ev = {
    now: new Date(now).toISOString(),
    window_start: new Date(ws).toISOString(),
    due_at: new Date(due).toISOString(),
    hold_deadline: new Date(deadline).toISOString(),
    past_hold_deadline: now >= deadline,
  };

  // ── 1. the object. The check this system has never had. ──────────────────
  if (!weekly) {
    return verdict("NO_GO", ["no latest-weekly.zip in R2 at all"], [], [], ev, {
      code: "no_bundle", customer_gets_nothing: true,
    });
  }
  const up = weekly.uploaded ? Date.parse(weekly.uploaded) : NaN;
  const ageH = Number.isFinite(up) ? (now - up) / HOUR : null;
  ev.object_uploaded = weekly.uploaded;
  ev.object_age_h = ageH === null ? null : round2(ageH);
  ev.object_bytes = weekly.size;
  ev.object_etag_known = !!weekly.etag;   // never echo the etag itself upward
  const inWindow = Number.isFinite(up) && up >= ws;
  ev.bundle_in_window = inWindow;

  // ── 2. the monthly bundle. Nothing has ever checked it, and it is what a
  //       BRAND NEW BUYER is mailed (stripe-webhook.js) and what /api/my-leads
  //       serves for k=monthly. Reported, never gating: a stale monthly must not
  //       stop this week's weekly delivery.
  if (monthly && monthly.uploaded) {
    ev.monthly_uploaded = monthly.uploaded;
    ev.monthly_age_h = round2((now - Date.parse(monthly.uploaded)) / HOUR);
    if (ev.monthly_age_h > 8 * 24) {
      notes.push(`latest-monthly.zip is ${Math.round(ev.monthly_age_h / 24)} days old — ` +
        "that is the bundle every NEW buyer is mailed. Not blocking this send.");
    }
  } else {
    notes.push("no latest-monthly.zip in R2 — new buyers would be delivered nothing. " +
      "Not blocking this send.");
  }

  // ── 3. status vs object. Divergence means the bundle PUT did not land. ────
  const ranAt = status && status.ran_at ? Date.parse(status.ran_at) : NaN;
  ev.status_ran_at = (status && status.ran_at) || null;
  ev.status_ok = status ? status.ok : null;
  ev.status_degraded = status ? status.degraded : null;
  if (!status) {
    hard.push("no refresh-status.json in R2 — the refresh has never reported");
  } else if (!Number.isFinite(ranAt)) {
    hard.push("refresh-status.json has no usable ran_at");
  } else {
    ev.status_age_h = round2((now - ranAt) / HOUR);
    if (ev.status_age_h > p.max_status_age_h) {
      hard.push(`the refresh has not run for ${ev.status_age_h}h (limit ` +
        `${p.max_status_age_h}h) — nothing else in this system watches for that`);
    }
    if (Number.isFinite(up) && status.ok !== false && ranAt - up > p.divergence_h * HOUR) {
      hard.push(`refresh-status says a healthy run finished ${status.ran_at} but the ` +
        `bundle in R2 was uploaded ${weekly.uploaded} — the bundle upload did not land ` +
        "(the status step is `if: always()`, the bundle step is not)");
    }
    if (status.ok === false && !status.degraded) {
      hard.push(`the last refresh FAILED (${trunc(status.error) || "no error recorded"})`);
    }
    const cov = status.coverage || null;
    if (cov) {
      ev.live_sources = cov.live_sources ?? null;
      ev.expected_sources = cov.expected_sources ?? null;
    }
    if ((cov && cov.disclose) || status.degraded) disclosure.push("reduced_coverage");
  }

  // ── 4. content identity: did anything NEW actually get built? ─────────────
  if (!man) {
    notes.push("refresh-status.json carries no `bundle` block — row-level freshness " +
      "is UNVERIFIABLE. The zip's date stamp changes its bytes daily, so neither " +
      "the etag nor the size can tell new data from a re-dated copy. Ship " +
      "bundle_manifest.py --merge-status in the refresh workflow to fix this.");
    ev.rowset_verifiable = false;
  } else {
    ev.rowset_verifiable = true;
    ev.rows = man.rows ?? null;
    ev.distinct_rows = man.distinct_rows ?? null;
    ev.max_issued_date = man.max_issued_date ?? null;
    ev.distinct_sources = man.distinct_sources ?? null;
    ev.fingerprint_built_at = (status.bundle && status.bundle.built_at) || null;

    // upload-bundle.js:170 rejects only byteLength === 0. Nothing anywhere
    // checks that the object opens as an archive or contains the one file the
    // customer paid for.
    if (man.opens_as_zip === false) {
      hard.push("the built weekly bundle does not open as a zip");
    } else if (man.has_all_leads === false) {
      hard.push("the built weekly bundle has no ALL-leads.csv — that is the file " +
        "the customer paid for");
    }
    if (man.rows === 0) hard.push("the built weekly bundle has zero rows");

    if (sha256 && man.sha256 && sha256 !== man.sha256) {
      hard.push("the sha256 of the bytes in R2 does not match the bundle this run " +
        "built — a truncated, partial or wrong-file upload");
    }
    ev.sha256_verified = !!(sha256 && man.sha256 && sha256 === man.sha256);

    // Size sanity against the last bundle a subscriber actually received. A
    // trailing median would need a history object; the last delivered size is
    // already in the send log and answers the same question.
    const ref = prior && typeof prior.bundle_bytes === "number" ? prior.bundle_bytes : null;
    if (ref && weekly.size) {
      const lo = Math.round(ref * (1 - p.size_tolerance));
      const hi = Math.round(ref * (1 + p.size_tolerance));
      ev.size_band = [lo, hi];
      if (weekly.size < lo || weekly.size > hi) {
        hard.push(`the bundle is ${weekly.size} bytes against ${ref} last delivered, ` +
          `outside ${lo}–${hi} (±${Math.round(p.size_tolerance * 100)}%) — truncated ` +
          "or the wrong file");
      }
    }

    // THE F1 CHECK, and the whole reason the fingerprint exists. Compared
    // against what the subscriber LAST RECEIVED, not against the last build:
    // a re-dated rebuild of identical data has a DIFFERENT etag and an
    // IDENTICAL rowset hash, so this is the one signal that catches it.
    // Verified locally: re-stamping the date in MassPermits-Leads.html changes
    // the file sha256 and leaves rowset_sha256 byte-identical.
    if (prior && prior.bundle_rowset && man.rowset_sha256) {
      ev.rowset_matches_last_delivered = prior.bundle_rowset === man.rowset_sha256;
      if (ev.rowset_matches_last_delivered) {
        disclosure.push("no_new_rows");
        reasons.push("ROWSET IDENTICAL to the bundle already delivered " + prior.at +
          ": new bytes, zero new leads. The date stamp moved; the data did not.");
      } else if (prior.bundle_max_issued && man.max_issued_date &&
                 man.max_issued_date <= prior.bundle_max_issued) {
        disclosure.push("no_newer_permits");
        reasons.push(`the newest permit in this bundle is still ${man.max_issued_date}, ` +
          "the same as the one already delivered — some rows moved in and out of the " +
          "14-day window but no source published anything newer");
      }
      if (typeof prior.bundle_rows === "number" && typeof man.rows === "number") {
        ev.rows_delta = man.rows - prior.bundle_rows;
      }
    } else {
      notes.push("the last delivered bundle carries no fingerprint, so this week's " +
        "rows cannot be compared against what the subscriber already holds. This " +
        "self-heals after one send.");
    }
  }

  // ── 5. would this send be a duplicate? ───────────────────────────────────
  // Decided in §6. Ordering matters for the DIAGNOSIS, not the outcome: on
  // 2026-08-03 both "the refresh failed" and "these bytes were already
  // delivered" were true, and the second is a consequence of the first. A
  // headline that leads with the consequence sends the operator to the wrong
  // place, so a broken pipeline outranks a duplicate every time.
  let dupe = null;
  if (prior && weekly.etag && prior.bundle_etag === weekly.etag) {
    const wasDelivered = (prior.sent || []).some((s) => s && s.ok);
    dupe = { at: prior.at, reason: wasDelivered
      ? `these exact bytes were already delivered ${prior.at} — sending again ` +
        "would be the 2026-08-09 duplicate"
      : `these exact bytes were SKIPPED ${prior.at} because they had already been ` +
        "delivered. weekly-send.js:87 reads log[0] and a skip entry has sent:[], " +
        "so its own guard would NOT catch this" };
  }

  // ── 6. verdict ───────────────────────────────────────────────────────────
  if (hard.length) {
    return verdict("NO_GO", hard.concat(dupe ? [dupe.reason] : [], reasons),
      disclosure, notes, ev, {
        code: "broken", customer_gets_nothing: true,
        previously_at: dupe ? dupe.at : null,
      });
  }
  if (dupe) {
    return verdict("NO_GO", [dupe.reason].concat(reasons), disclosure, notes, ev, {
      code: "already_delivered",
      // This is the failure the customer experiences as "where is my email",
      // and today we answer it with silence. There is nothing new to send —
      // but there IS something true to say.
      customer_gets_nothing: true,
      previously_at: dupe.at,
    });
  }

  if (!inWindow) {
    if (now < deadline) {
      // The refresh is late, not dead. Four of the last nine Mondays looked
      // exactly like this at 12:00 and the data landed later the same day.
      return verdict("HOLD", [
        `the bundle in R2 was uploaded ${weekly.uploaded}, before this send window ` +
        `opened ${new Date(ws).toISOString()}. Holding until ` +
        `${new Date(deadline).toISOString()}, then sending with the date stated.`,
      ].concat(reasons), disclosure, notes, ev,
      { code: "waiting_for_refresh", customer_gets_nothing: false });
    }
    if (ageH !== null && ageH > p.max_bundle_age_h) {
      return verdict("NO_GO", [
        `past the hold deadline with a ${Math.round(ageH)}h-old bundle (limit ` +
        `${p.max_bundle_age_h}h). Too old to present as this week's leads.`,
      ].concat(reasons), disclosure, notes, ev,
      { code: "too_old", customer_gets_nothing: true });
    }
    disclosure.push("data_from_earlier_day");
    reasons.unshift(`past the hold deadline with a ${Math.round(ageH)}h-old bundle. ` +
      "SEND IT, and name the date the data is from. A smaller or older true file " +
      "is deliverable; silence is not.");
  }

  if (disclosure.length) {
    return verdict("GO_WITH_DISCLOSURE", reasons, disclosure, notes, ev,
      { code: "disclose", customer_gets_nothing: false });
  }
  return verdict("GO", reasons.length ? reasons
    : ["fresh bundle, uploaded inside this send window, byte-verified, not yet delivered"],
    disclosure, notes, ev, { code: "clean", customer_gets_nothing: false });
}

function verdict(v, reasons, disclosure, notes, evidence, extra) {
  return {
    verdict: v,
    go: v === "GO" || v === "GO_WITH_DISCLOSURE",
    // The single most important boolean in this file. When it is true and the
    // verdict is not HOLD, the subscriber receives nothing this week unless
    // somebody tells them why. That is the 2026-08-03 shape, and answering it
    // with silence is what cost the only cancellation in company history.
    customer_gets_nothing: !!extra.customer_gets_nothing,
    code: extra.code,
    disclosure: [...new Set(disclosure)],
    reasons,
    notes,
    evidence,
    previously_at: extra.previously_at || null,
  };
}

// One line an operator can read on a phone without scrolling.
export function headline(r) {
  const first = (r.reasons && r.reasons[0]) || "";
  switch (r.verdict) {
    case "GO": return "Ready to send.";
    case "GO_WITH_DISCLOSURE":
      return "Ready to send, with a note: " + r.disclosure.join(", ").replace(/_/g, " ") + ".";
    case "HOLD":
      return "Waiting for this morning's data. Nothing is wrong yet.";
    default:
      return "Will not send: " + first;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const trunc = (s) => (s == null ? "" : String(s).slice(0, 160));
