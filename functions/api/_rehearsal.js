// MassPermits monday rehearsal: the pure half. No R2, no network, no clock of
// its own (every function takes `now` or `date`), no request object.
//
// Every check returns one or more RESULTS:
//   {id, code, result, counts, buyer_numbers, detail_private}
// result is PASS | WARN | WAIT | NO-GO | BLIND. `code` is the fixed contract
// string ("C1.no_refresh"). detail_private holds digest lines that name
// buyers by NUMBER only (buyer N = row N of subscribers.json, 1-based), never
// an address, name, token or customer id. counts and detail_private stay
// inside the Function and the owner digest; the HTTP response carries codes
// only (rehearsal.js).
//
// v1 is REPORT-ONLY. Nothing here decides a send, retries a send or changes
// production. A result is a line in an email to the owner.

import { evaluate, windowStart, lastEtagEntry } from "./_presend.js";
import { classifySub, subCustomerId, subCustomerEmail, ENTITLED_STATUSES, siteEndpoints } from "./_reconcile.js";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;

export const RESULTS = ["PASS", "WARN", "WAIT", "NO-GO", "BLIND"];
const SEVERITY = { "NO-GO": 4, BLIND: 3, WAIT: 2, WARN: 1, PASS: 0 };

// The checks whose BLIND result makes the verdict "GO, blind on N". mon_post
// is mon-post's whole judgement (R4: a mon-post that could not read the send
// log, or the Actions facts, must not read as a plain GO).
export const BLIND_COUNTS = new Set(["C1", "C2", "C3", "C6", "C7", "mon_post"]);

// ── results ─────────────────────────────────────────────────────────────────
export function res(id, result, code, extra = {}) {
  return {
    id, code, result,
    counts: extra.counts || {},
    buyer_numbers: (extra.buyers || []).slice().sort((a, b) => a - b),
    detail_private: extra.lines || [],
  };
}
const pass = (id, code = id + ".ok", extra) => res(id, "PASS", code, extra);

// ── known-open (acks) ───────────────────────────────────────────────────────
// rehearsal-ack.json is {"<code>": "YYYY-MM-DD"}, the date the ack runs until.
// An ack counts only for a code on this list, only while the run date is on
// or before its date, and only if its date is at most 28 days after the run
// date (so nothing can be acked for longer than four weeks at a time).
export const ACKABLE = [
  "C5.purchase_copy", "C5.style_*", "C9.guard1_late", "C10.source_stale:*",
  "C13.contracts_not_run", "C15.feed_log_emails", "C17.inbox_never", "C17.inbox_stale",
  "C19.no_open", "C21.unattested",
];
export const ACK_MAX_DAYS = 28;
export function isAckable(code) {
  return ACKABLE.some((a) => (a.endsWith("*") ? code.startsWith(a.slice(0, -1)) &&
    code.length > a.length - 1 : code === a));
}
export function ackValid(ack, code, date) {
  if (!ack || typeof ack !== "object" || !isAckable(code)) return false;
  const until = Object.prototype.hasOwnProperty.call(ack, code) ? ack[code] : null;
  if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return false;
  const u = Date.parse(until + "T00:00:00Z");
  const d = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(u) || !Number.isFinite(d)) return false;
  return u >= d && u - d <= ACK_MAX_DAYS * DAY;
}
export function applyAcks(results, ack, date) {
  return results.map((r) => (r.result !== "PASS" && ackValid(ack, r.code, date)
    ? { ...r, acked: true } : r));
}

// ── verdict ─────────────────────────────────────────────────────────────────
export function verdictOf(results, runWait) {
  if (runWait) return "WAIT";
  if (results.some((r) => r.result === "NO-GO" && !r.acked)) return "NO-GO";
  const blind = new Set(results.filter((r) => r.result === "BLIND" && !r.acked &&
    BLIND_COUNTS.has(r.id)).map((r) => r.id));
  if (blind.size) return `GO, blind on ${blind.size}`;
  return "GO";
}
export function verdictRank(v) {
  if (!v || v === "WAIT") return -1;
  if (v === "GO") return 0;
  if (v.startsWith("GO, blind")) return 1;
  if (v === "NO-GO") return 2;
  return -1;
}
export function nogoCodes(results) {
  return [...new Set(results.filter((r) => r.result === "NO-GO" && !r.acked).map((r) => r.code))].sort();
}

// ── digest ──────────────────────────────────────────────────────────────────
export const ROSTER_UNREADABLE_TEXT =
  "The subscriber list could not be read; nothing that depends on it was checked.";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// composeDigest(results, ctx) -> {subject, html}. The first line is the
// verdict ("GO", "GO, blind on N" or "NO-GO"). No em dashes anywhere. With
// ctx.rosterReadable === false the buyer lines are left out entirely and the
// fixed roster text is shown instead.
export function composeDigest(results, ctx = {}) {
  const verdict = ctx.verdict || verdictOf(results, false);
  const rosterOk = ctx.rosterReadable !== false;
  const sorted = results.slice().sort((a, b) =>
    (SEVERITY[b.result] - SEVERITY[a.result]) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const line = (r) => {
    const detail = rosterOk && r.detail_private.length ? ": " + r.detail_private.join("; ") : "";
    return `${r.id} ${r.code}${detail}`;
  };
  const sec = (title, rows) => (rows.length
    ? `<h3>${esc(title)}</h3><ul>` + rows.map((r) => `<li>${esc(line(r))}</li>`).join("") + "</ul>" : "");
  // A folded result's line was merged into its buyer's one line (foldByBuyer).
  const acked = sorted.filter((r) => r.acked && !r.folded);
  const live = sorted.filter((r) => !r.acked && !r.folded);
  const listed = rosterOk ? live.filter((r) => r.result === "PASS" && r.detail_private.length) : [];
  const passed = [...new Set(sorted.filter((r) => !r.acked && r.result === "PASS").map((r) => r.id))];
  let html = `<div style="font-family:Arial,sans-serif"><p><b>${esc(verdict)}</b></p>` +
    `<p>MassPermits dress rehearsal, mode ${esc(ctx.mode || "?")}, date ${esc(ctx.date || "?")}. ` +
    "Report only: nothing was sent to any customer and nothing in production was changed.</p>";
  if (!rosterOk) html += `<p><b>${esc(ROSTER_UNREADABLE_TEXT)}</b></p>`;
  html += sec("NO-GO", live.filter((r) => r.result === "NO-GO")) +
    sec("Blind", live.filter((r) => r.result === "BLIND")) +
    sec("Warnings", live.filter((r) => r.result === "WARN")) +
    sec("Not yet confirmed", live.filter((r) => r.result === "WAIT")) +
    sec("Known open", acked) +
    sec("Listed", listed) +
    (passed.length ? `<p>Passed: ${esc(passed.join(", "))}</p>` : "") +
    (ctx.notBuilt && ctx.notBuilt.length ? `<p>Not built yet: ${esc(ctx.notBuilt.join(", "))}</p>` : "") +
    "</div>";
  const subject = `${verdict} | MassPermits rehearsal ${ctx.mode || ""} ${ctx.date || ""}`.trim();
  return { subject: subject.replace(/—/g, "-"), html: html.replace(/—/g, "-") };
}

// ── runner facts ────────────────────────────────────────────────────────────
// The runner-to-Function contract. Values are only enums, booleans, integers
// in [-1, 100000], fixed-length integer arrays or one 7-hex short SHA.
const E = (...values) => ({ t: "enum", values });
const INT = { t: "int" };
const BOOL = { t: "bool" };
const ARR4 = { t: "arr", len: 4 };
const RUNS = E("none", "queued", "in_progress", "completed");
export const RUNNER_SCHEMA = Object.freeze({
  v: { t: "const", value: 1 },
  api: E("ok", "rate_limited", "forbidden", "error"),
  "refresh.state": RUNS,
  "refresh.conclusion": E("success", "failure", "cancelled", "timed_out", "skipped", "none"),
  "refresh.ship_step": E("success", "failure", "skipped", "cancelled", "absent"),
  "refresh.failed_at": E("none", "before_ship", "ship", "after_ship"),
  "refresh.runs": INT, "refresh.started_min": INT, "refresh.completed_min": INT,
  "refresh.shipped_min": ARR4,
  "send.state": RUNS, "send.runs": INT, "send.started_min": INT,
  "c0.fn_state": E("success", "failure", "missing", "error"),
  "c0.fn_age_min": INT, "c0.fn_sha7": { t: "sha7" },
  "c0.head_state": E("success", "failure", "missing", "error"),
  "c9.guard1_present": BOOL,
  "c9.mon_refresh_start": ARR4, "c9.mon_send_start": ARR4, "c9.mon_watchdog_start": ARR4,
  "c9.refresh_late_min": INT, "c9.push_workflows": INT, "c9.push_commits": INT,
  "c9.push_runs": INT, "c9.monday_sensitive": INT,
  "c17.refresh_ok_age_h": INT, "c17.watchdog_mon": BOOL, "c17.watchdog_tue": BOOL,
  "c17.rehearsal_prev_h": INT, "c17.inbox_mirror": E("ok", "drift", "error"),
  "c14.fetched": BOOL, "c14.house_numbers": INT, "c14.contractor_echo": INT,
  "c14.owner_cue": INT, "c14.email_like": INT, "c14.hex32": INT,
  mirror: E("ok", "drift", "error"),
  "purchase.render": E("ok", "error"), "purchase.link_first": BOOL, "purchase.month_line": BOOL,
  "c8.min_cents": INT, "c8.events_mirror": E("ok", "drift", "error"),
});
export const FACTS_MAX_BYTES = 4096;
// Facts that come from the GitHub Actions API; with api !== "ok" the checks
// that need them are BLIND.
const ACTIONS_PREFIXES = ["refresh.", "send.", "c0.", "c9.mon_", "c9.push_", "c9.monday_",
  "c9.refresh_late_min", "c17.refresh_ok_age_h", "c17.watchdog_", "c17.rehearsal_prev_h"];
const isActionsFact = (k) => ACTIONS_PREFIXES.some((p) => k.startsWith(p));

const isInt = (v) => Number.isInteger(v) && v >= -1 && v <= 100000;
function validFact(spec, v) {
  switch (spec.t) {
    case "const": return v === spec.value;
    case "enum": return typeof v === "string" && spec.values.includes(v);
    case "int": return isInt(v);
    case "bool": return typeof v === "boolean";
    case "arr": return Array.isArray(v) && v.length === spec.len && v.every(isInt);
    case "sha7": return typeof v === "string" && /^[0-9a-f]{7}$/.test(v);
    default: return false;
  }
}
const own = (o, k) => o !== null && typeof o === "object" && !Array.isArray(o) &&
  Object.prototype.hasOwnProperty.call(o, k);

// validateRunnerFacts(obj) -> {facts, dropped[]}. Unknown keys are dropped
// silently; a known key with a wrong type or value is dropped AND listed, and
// every check that needs it is BLIND "schema".
export function validateRunnerFacts(obj) {
  const facts = {};
  const dropped = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return { facts, dropped: ["v"] };
  for (const [key, spec] of Object.entries(RUNNER_SCHEMA)) {
    const path = key.split(".");
    let v = obj, present = true;
    for (const p of path) { if (own(v, p)) v = v[p]; else { present = false; break; } }
    if (!present) continue;
    if (!validFact(spec, v)) { dropped.push(key); continue; }
    let o = facts;
    for (const p of path.slice(0, -1)) { if (!own(o, p)) o[p] = {}; o = o[p]; }
    o[path[path.length - 1]] = Array.isArray(v) ? v.slice() : v;
  }
  return { facts, dropped };
}
export function fact(facts, key) {
  let v = facts;
  for (const p of key.split(".")) { if (own(v, p)) v = v[p]; else return undefined; }
  return v;
}
// null when every key is usable; otherwise the BLIND code for the check.
function factsBlind(ctx, keys) {
  const { facts, dropped = [] } = ctx;
  if (keys.some((k) => dropped.includes(k))) return "schema";
  if (keys.some((k) => fact(facts, k) === undefined)) return "schema";
  if (keys.some(isActionsFact) && fact(facts, "api") !== "ok") return "actions_api";
  return null;
}

// ── inbox verdict: a mirror of inbox-status.js lines 66-125 ─────────────────
// Same constants, same order of tests. c17.inbox_mirror (the runner's drift
// test) proves it still matches the shipped file.
export const STALE_HOURS = 30;
export const ESCALATE_HOURS = 72;
export function inboxVerdict(state, now) {
  const hours = (iso) => (iso ? (now - Date.parse(iso)) / 3600_000 : Infinity);
  const lastLive = state && state.last_live_run_at;
  const ageH = hours(lastLive);
  const last = (state && state.last) || null;
  if (!state || !lastLive) return "never";
  if (ageH > STALE_HOURS) return "stale";
  if (last && last.roster_armed === false) return "unarmed";
  if (last && last.waiting > 0 && last.oldest_hours >= ESCALATE_HOURS) return "backlog";
  if (last && last.waiting > 0) return "waiting";
  return "ok";
}

// ── dates ───────────────────────────────────────────────────────────────────
export const dateMs = (date) => Date.parse(date + "T00:00:00Z");
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const mmdd = (ms) => isoDay(ms).slice(5);
const MONDAY = { send_dow: 1 };
export const mondayOf = (ms) => windowStart(ms, MONDAY);
const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();
const okTo = (e) => (Array.isArray(e && e.sent) ? e.sent : []).filter((s) => s && s.ok && s.to);

// ── run-level WAIT ──────────────────────────────────────────────────────────
// Returns the WAIT code, or null. A WAIT is "what is being judged has not
// happened yet and a later trigger will judge it". dry never waits at run
// level (C1 carries it as a check-level WAIT instead).
export function runLevelWait(mode, ctx) {
  if (factsBlind(ctx, ["refresh.state", "send.state"])) return null;
  const rs = fact(ctx.facts, "refresh.state");
  const ss = fact(ctx.facts, "send.state");
  if ((mode === "sat" || mode === "sun") && (rs === "queued" || rs === "in_progress")) {
    return "WAIT.refresh_running";
  }
  if (mode === "mon-pre" && ["none", "queued", "in_progress"].includes(rs) &&
      (ss === "none" || ss === "queued")) return "WAIT.refresh_not_done";
  if (mode === "mon-post" && (ss === "queued" || ss === "in_progress")) return "WAIT.send_running";
  return null;
}

// ── de-duplication ──────────────────────────────────────────────────────────
// Looks only at CORE records from OTHER runs that reached a verdict (WAIT
// never counts). "dispatch" always runs; a workflow_run trigger skips a re-run
// of the same event; the "sched" backstop skips once (date, mode) is judged.
export function shouldSkip(records, p) {
  if (p.trigger === "dispatch") return false;
  const judged = (records || []).filter((r) => r && r.part === "core" && r.run !== p.run &&
    r.verdict && r.verdict !== "WAIT" && r.date === p.date && r.mode === p.mode);
  if (p.trigger === "sched") return judged.length > 0;
  return judged.some((r) => r.trigger === p.trigger);
}

// ── C0: the deploy of F, the newest main commit touching functions/ ────────
export function checkC0(ctx) {
  const b = factsBlind(ctx, ["c0.fn_state", "c0.fn_age_min"]);
  if (b) return [res("C0", "BLIND", b === "schema" ? "schema" : "C0.actions_api")];
  const out = [];
  const st = fact(ctx.facts, "c0.fn_state");
  const age = fact(ctx.facts, "c0.fn_age_min");
  if (st === "success") out.push(pass("C0"));
  else if (st === "failure") out.push(res("C0", "NO-GO", "C0.fn_build_failed"));
  else if (st === "missing") out.push(age >= 0 && age < 15 ? res("C0", "WAIT", "C0.deploy_pending")
    : res("C0", "NO-GO", "C0.fn_no_deploy"));
  else out.push(res("C0", "BLIND", "C0.error"));
  if (fact(ctx.facts, "c0.head_state") === "failure") out.push(res("C0", "WARN", "C0.head_build_failed"));
  return out;
}

// ── C1: the refresh ran, shipped, and says so ──────────────────────────────
export function checkC1(ctx) {
  const { status } = ctx;
  const out = [];
  const b = factsBlind(ctx, ["refresh.state", "refresh.conclusion", "refresh.ship_step"]);
  if (b) out.push(res("C1", "BLIND", b === "schema" ? "schema" : "C1.actions_api"));
  else {
    const rs = fact(ctx.facts, "refresh.state");
    if (rs === "queued" || rs === "in_progress") {
      // Only reachable in dry (sat/sun/mon-pre stop at the run-level WAIT).
      out.push(res("C1", "WAIT", "C1.refresh_running"));
    } else if (rs === "none") {
      out.push(res("C1", "NO-GO", "C1.no_refresh"));
    } else {
      if (fact(ctx.facts, "refresh.conclusion") !== "success") out.push(res("C1", "NO-GO", "C1.refresh_failed"));
      if (fact(ctx.facts, "refresh.ship_step") !== "success") out.push(res("C1", "NO-GO", "C1.ship_failed"));
    }
  }
  if (!status) out.push(res("C1", "NO-GO", "status_unreadable"));
  else {
    const rows = (typeof status.count === "number" && status.count > 0) ||
      (status.bundle && status.bundle.weekly && status.bundle.weekly.rows > 0);
    if (!(status.ok === true || (status.degraded && rows))) out.push(res("C1", "NO-GO", "C1.status_not_ok"));
    if (String(status.error || "").includes("bundle build crashed")) {
      out.push(res("C1", "NO-GO", "C1.bundle_crashed"));
    }
  }
  return out.length ? out : [pass("C1")];
}

// ── C2: status and objects agree, with margin before the 8-day clocks ──────
export function checkC2(ctx) {
  const { status, heads, now } = ctx;
  if (!status) return [res("C2", "NO-GO", "status_unreadable")];
  const ran = Date.parse(status.ran_at || "");
  if (!Number.isFinite(ran)) return [res("C2", "BLIND", "C2.no_ran_at")];
  const out = [];
  const up = (h) => (h && h.uploaded ? Date.parse(h.uploaded) : NaN);
  const wz = up(heads.weeklyZip), wh = up(heads.weeklyHtml), mz = up(heads.monthlyZip);
  if (!Number.isFinite(wz)) out.push(res("C2", "NO-GO", "C2.weekly_zip_missing"));
  if (!Number.isFinite(wh)) out.push(res("C2", "WARN", "C2.weekly_html_missing"));
  if (!Number.isFinite(mz)) out.push(res("C2", "NO-GO", "C2.monthly_zip_missing"));
  const drift = [["weekly zip", wz], ["weekly html", wh], ["monthly zip", mz]]
    .filter(([, t]) => Number.isFinite(t) && Math.abs(ran - t) > 15 * MIN);
  if (drift.length) {
    out.push(res("C2", "NO-GO", "C2.drift", { lines: drift.map(([n, t]) =>
      `${n} uploaded ${Math.round(Math.abs(ran - t) / MIN)} min ${t < ran ? "before" : "after"} ran_at`) }));
  }
  const margin = [["ran_at", ran], ["weekly zip", wz], ["weekly html", wh]]
    .filter(([, t]) => Number.isFinite(t) && now - t > 5 * DAY);
  if (margin.length) {
    out.push(res("C2", "NO-GO", "C2.margin", { lines: margin.map(([n, t]) =>
      `${n} is ${((now - t) / DAY).toFixed(1)} days old (less than 3 days before the 8-day clock)`) }));
  }
  if (Number.isFinite(mz) && now - mz > 48 * HOUR) {
    out.push(res("C2", "NO-GO", "C2.monthly_old",
      { lines: [`monthly zip is ${Math.round((now - mz) / HOUR)} h old`] }));
  }
  return out.length ? out : [pass("C2")];
}

// ── C3: the pre-send gate, run on the RESOLVED date's weekday ──────────────
// ctx.inp is gather(env, {hash:false}). mon-pre keeps the real policy.
export function checkC3(ctx) {
  const { now, date, mode, inp } = ctx;
  if (!inp || !inp.status) return [res("C3", "NO-GO", "status_unreadable")];
  if (!inp.status.bundle) return [res("C3", "BLIND", "C3.no_manifest")];
  const d0 = dateMs(date);
  if (now < d0) return [res("C3", "BLIND", "C3.clock")];
  if (mode === "mon-pre") {
    const ss = fact(ctx.facts, "send.state");
    if (ss === "in_progress" || ss === "completed") {
      return [pass("C3", "C3.already_sent", { lines: ["gate forecast not re-run: the send had started"] })];
    }
  }
  const policy = mode === "mon-pre" ? inp.policy : {
    ...inp.policy,
    send_dow: new Date(d0).getUTCDay(),
    send_hour: now < d0 + DAY ? new Date(now).getUTCHours() : 23,
  };
  const r = evaluate(now, { ...inp, policy });
  if ((r.verdict === "GO" || r.verdict === "GO_WITH_DISCLOSURE") && !r.customer_gets_nothing) {
    // A pass. With a disclosure the owner is told what the customer will read.
    return r.verdict === "GO" ? [pass("C3", "C3.ok")]
      : [res("C3", "WARN", "C3.disclosure", { lines: [`the send would disclose: ${r.disclosure.join(", ")}`] })];
  }
  const code = r.verdict === "HOLD" ? "C3.hold" : "C3." + (r.code || "no_go");
  return [res("C3", "NO-GO", code, { lines: [`gate ${r.verdict} ${r.code}`] })];
}

// ── C4: the build-time manifest ─────────────────────────────────────────────
export function checkC4(ctx) {
  const { status, sendLog } = ctx;
  if (!status) return [res("C4", "NO-GO", "status_unreadable")];
  const out = [];
  if (String(status.error || "").includes("bundle build crashed")) out.push(res("C4", "NO-GO", "C4.bundle_crashed"));
  const b = status.bundle;
  if (!b) return out.length ? out : [res("C4", "BLIND", "C4.no_manifest")];
  const prior = lastEtagEntry(Array.isArray(sendLog) ? sendLog : []);
  const ref = prior && typeof prior.bundle_rows === "number" ? prior.bundle_rows : null;
  for (const kind of ["weekly", "monthly"]) {
    const m = b[kind];
    if (!m) { out.push(res("C4", "BLIND", `C4.no_${kind}_manifest`)); continue; }
    if (typeof m.opens_as_zip !== "boolean" || typeof m.has_all_leads !== "boolean" ||
        typeof m.rows !== "number") { out.push(res("C4", "BLIND", `C4.${kind}_fields_absent`)); continue; }
    if (!m.opens_as_zip) out.push(res("C4", "NO-GO", `C4.${kind}_not_zip`));
    if (!m.has_all_leads) out.push(res("C4", "NO-GO", `C4.${kind}_no_all_leads`));
    if (!(m.rows > 0)) out.push(res("C4", "NO-GO", `C4.${kind}_no_rows`));
    if (kind === "weekly" && ref && m.rows > 0 && Math.abs(m.rows - ref) > 0.6 * ref) {
      out.push(res("C4", "NO-GO", "C4.weekly_rows_band", { lines: [`${m.rows} rows against ${ref} last delivered`] }));
    }
  }
  return out.length ? out : [pass("C4")];
}

// ── C5: the weekly email every active row would get, rendered, not sent ────
// Words that name where the data comes from. "upstream" and "provider" are
// the ones the shipped copy uses; the rest are permit-portal vendors.
export const VENDOR_WORDS = ["upstream", "provider", "viewpoint", "opengov", "accela",
  "citizenserve", "permiteyes", "municity", "tyler technologies"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december"];
// Every calendar date written in the copy, as ms. A day-month date with no
// year takes the run date's year, or the year before if that would be after it.
export function datesInText(text, date) {
  const s = String(text).replace(/<[^>]*>/g, " ");
  const d0 = dateMs(date);
  const y0 = new Date(d0).getUTCFullYear();
  const out = [];
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const mon = MONTHS.join("|");
  const dm = new RegExp(`\\b(\\d{1,2})\\s+(${mon})\\b|\\b(${mon})\\s+(\\d{1,2})\\b`, "gi");
  for (const m of s.matchAll(dm)) {
    const day = +(m[1] || m[4]);
    const mi = MONTHS.indexOf((m[2] || m[3]).toLowerCase());
    let t = Date.UTC(y0, mi, day);
    if (t > d0) t = Date.UTC(y0 - 1, mi, day);
    out.push(t);
  }
  return out;
}
const EMOJI = /\p{Extended_Pictographic}/u;
export function checkC5(ctx) {
  const { roster, facts, date, coverage, weeklySize, render } = ctx;
  const out = [];
  // purchase email (runner facts)
  const pb = factsBlind(ctx, ["purchase.render", "purchase.link_first", "purchase.month_line", "mirror"]);
  if (pb) out.push(res("C5", "BLIND", pb));
  else if (fact(facts, "mirror") !== "ok") out.push(res("C5", "BLIND", "C5.mirror_drift", { lines: ["mirror drift"] }));
  else if (fact(facts, "purchase.render") !== "ok") out.push(res("C5", "BLIND", "C5.purchase_render"));
  else if (fact(facts, "purchase.link_first") !== true || fact(facts, "purchase.month_line") === true) {
    out.push(res("C5", "NO-GO", "C5.purchase_copy"));
  }
  if (!roster.ok) { out.push(res("C5", "NO-GO", "roster_unreadable")); return out; }
  const by = new Map();
  const add = (result, code, buyer, line) => {
    const k = result + "|" + code;
    if (!by.has(k)) by.set(k, { result, code, buyers: new Set(), lines: new Set() });
    const g = by.get(k);
    if (buyer) g.buyers.add(buyer);
    if (line) g.lines.add(line);
  };
  const d0 = dateMs(date);
  roster.rows.forEach((row, i) => {
    if (!row || !row.email || row.active === false) return;
    const buyer = i + 1;
    const token = typeof row.token === "string" ? row.token : "";
    const m = render({ name: row.name || "", token, coverage, date });
    const html = m.html;
    if (!/^[0-9a-f]{32}$/.test(token)) add("NO-GO", "C5.no_token", buyer, `buyer ${buyer}: no 32-hex token`);
    const first = (html.match(/<a\s[^>]*href="([^"]*)"/i) || [])[1] || "";
    if (!first.startsWith("https://masspermits.com/api/my-leads?t=") ||
        !first.endsWith("t=" + token) || !token) {
      add("NO-GO", "C5.link_not_first", buyer, `buyer ${buyer}: download link missing or not first`);
    }
    const text = (m.subject + " " + html).toLowerCase();
    const vend = VENDOR_WORDS.filter((w) => text.includes(w));
    if (vend.length) add("NO-GO", "C5.vendor_words", buyer, "copy says " + vend.map((w) => `"${w}"`).join(", "));
    const old = datesInText(m.subject + " " + html, date).filter((t) => d0 - t > 21 * DAY);
    if (old.length) add("NO-GO", "C5.stale_date", buyer, "copy names " + old.map(isoDay).join(", "));
    if (!/href="https:\/\/masspermits\.com\/leads[?"]/.test(html)) add("WARN", "C5.no_leads_link", buyer);
    if (/—/.test(m.subject + html)) add("WARN", "C5.style_em_dash", buyer);
    if (EMOJI.test(m.subject + html)) add("WARN", "C5.style_emoji", buyer);
    // weekly-send.js sends html only: there is no text/plain part.
    add("WARN", "C5.style_no_text_part", buyer);
  });
  if (typeof weeklySize !== "number") out.push(res("C5", "BLIND", "C5.attachment_unknown"));
  else if (weeklySize >= 2 * 1024 * 1024) out.push(res("C5", "NO-GO", "C5.attachment_size",
    { lines: [`weekly zip is ${weeklySize} bytes`] }));
  for (const g of by.values()) {
    out.push(res("C5", g.result, g.code, { buyers: [...g.buyers],
      lines: g.lines.size ? [...g.lines] : [`buyers ${[...g.buyers].join(", ")}`] }));
  }
  return out.some((r) => r.result !== "PASS") ? out : [pass("C5")];
}

// ── C6: links, judged from what the links part stored for this run ─────────
// store = {pages: {"0": {rows: [...], more}, ...}, paused, too_many}
// row outcome = {row, no_token} | {row, weekly, monthly, leads}
//   weekly/monthly = {status, zip, dl, persisted, error}
//   leads = {status, access, st, persisted, to_download, skipped, error}
export function checkC6(ctx) {
  const { roster, store } = ctx;
  if (!roster.ok) return [res("C6", "NO-GO", "roster_unreadable")];
  if (!store || !store.pages) return [res("C6", "BLIND", "C6.not_run")];
  if (store.too_many) return [res("C6", "BLIND", "C6.too_many")];
  const keys = Object.keys(store.pages).map(Number).sort((a, b) => a - b);
  // Contiguous from 0, every page but the last says more:true, the last says
  // more:false (R4: a page left over from an earlier attempt of the same run
  // can never complete a chain).
  if (!keys.length || keys.some((k, i) => k !== i) ||
      keys.some((k, i) => store.pages[k].more !== (i < keys.length - 1))) {
    return [res("C6", "BLIND", "C6.incomplete")];
  }
  const groups = new Map();
  const add = (result, code, buyer) => {
    const k = result + "|" + code;
    if (!groups.has(k)) groups.set(k, { result, code, buyers: new Set() });
    groups.get(k).buyers.add(buyer);
  };
  const dlOk = (o) => o && !o.error && o.status === 200 && o.zip === true;
  for (const k of keys) {
    for (const o of store.pages[k].rows || []) {
      const buyer = o.row + 1;
      if (o.no_token) { add("NO-GO", "C6.no_token", buyer); continue; }
      if (!dlOk(o.weekly)) add("NO-GO", "C6.download_failed", buyer);
      if (!dlOk(o.monthly)) add("NO-GO", "C6.monthly_failed", buyer);
      if ((o.weekly && o.weekly.dl) || (o.monthly && o.monthly.dl)) add("NO-GO", "C6.dl_logged", buyer);
      const persisted = [o.weekly, o.monthly, o.leads].reduce((n, x) => n + ((x && x.persisted) || 0), 0);
      if (persisted) add("NO-GO", "C6.persisted", buyer);
      const l = o.leads;
      if (!l || l.skipped) continue;
      if (l.error) add("NO-GO", "C6.portal_failed", buyer);
      else if (l.status === 302 && l.to_download) add("WARN", "C6.portal_html_missing", buyer);
      else if (l.status !== 200 || l.access !== 1) add("NO-GO", "C6.portal_failed", buyer);
      else if (l.st === "red") add("NO-GO", "C6.portal_red", buyer);
      else if (l.st !== "ok") add("NO-GO", "C6.portal_failed", buyer);
    }
  }
  const out = [];
  if (store.paused) out.push(res("C6", "WARN", "C6.portal_paused"));
  for (const g of groups.values()) {
    const b = [...g.buyers];
    out.push(res("C6", g.result, g.code, { buyers: b, lines: [`buyers ${b.join(", ")}`] }));
  }
  return out.length ? out : [pass("C6")];
}

// ── Stripe (raw subscription objects) ──────────────────────────────────────
export const ENTITLED = new Set(["active", "trialing", "past_due"]);
const subCust = (s) => (s && typeof s.customer === "string" ? s.customer
  : s && s.customer && typeof s.customer.id === "string" ? s.customer.id : "");
const subEmail = (s) => (s && s.customer && typeof s.customer === "object" ? lc(s.customer.email) : "");
const subPriceIds = (s) => ((s && s.items && Array.isArray(s.items.data)) ? s.items.data : [])
  .map((it) => it && it.price && it.price.id).filter(Boolean);
// S: entitled subscriptions on a MassPermits price id.
export function entitledSubs(stripe, priceIds) {
  if (!stripe || !stripe.readable) return [];
  const ids = new Set(priceIds || []);
  return (stripe.subs || []).filter((s) => s && ENTITLED.has(s.status) &&
    subPriceIds(s).some((p) => ids.has(p)));
}
const subsForRow = (S, row) => S.filter((s) => (row.customer && subCust(s) === row.customer) ||
  (subEmail(s) && subEmail(s) === lc(row.email)));

// ── the Monday window the M set is judged in ────────────────────────────────
// mon-post: that Monday. Otherwise the newest Monday window at or before
// `date` that holds an ok delivery, at most 14 days back.
export function mondayWindow(sendLog, date, mode, now) {
  const log = Array.isArray(sendLog) ? sendLog : [];
  const d0 = dateMs(date);
  const candidates = mode === "mon-post" ? [mondayOf(d0)]
    : [0, 1, 2].map((k) => mondayOf(d0) - k * 7 * DAY).filter((m) => m >= d0 - 14 * DAY);
  for (const m of candidates) {
    const end = Math.min(m + 7 * DAY, now == null ? Infinity : now + 1);
    const entries = log.filter((e) => {
      const t = Date.parse((e && e.at) || "");
      return Number.isFinite(t) && t >= m && t < end;
    });
    const ok = entries.filter((e) => okTo(e).length);
    if (!ok.length) { if (mode === "mon-post") return { monday: m, entries, T: null }; continue; }
    const T = Math.min(...ok.map((e) => Date.parse(e.at)));
    return { monday: m, entries, T, D: isoDay(T) };
  }
  return null;
}

// ── C7: who should have got Monday's email, against who did ────────────────
// ctx: {roster, sendLog, sendLogOk, date, mode, now, stripe, priceIds,
//       mapped, funnel}
// stripe: null, or {keyed, readable, reason, subs}. "With the key" means the
// key is set AND the subscriptions read came back readable. mapped: the C7
// results of mapReconcile() (RECONCILE_MAP); C7's NO-GO comes only from those
// and from the M rule, never from reconcile()'s own verdict.
export function checkC7(ctx) {
  const { roster, sendLog, sendLogOk, date, mode, now, stripe, funnel } = ctx;
  if (!roster.ok) return [res("C7", "NO-GO", "roster_unreadable")];
  const out = [];
  const finish = () => {
    const all = dedupeResults([...out, ...(ctx.mapped || []).filter((r) => r.id === "C7")]);
    if (!all.some((r) => r.result !== "PASS")) all.push(pass("C7"));
    return foldByBuyer(all);
  };
  const keyed = !!(stripe && stripe.keyed && stripe.readable);
  if (!keyed) {
    out.push(res("C7", "BLIND", stripe && stripe.keyed ? "C7.stripe_unreadable" : "C7.no_key"));
  }
  if (!sendLogOk) { out.push(res("C7", "BLIND", "C7.send_log_unreadable")); return finish(); }
  const w = mondayWindow(sendLog, date, mode, now);
  if (!w || w.T == null) { out.push(res("C7", "BLIND", "C7.no_recent_send")); return finish(); }
  const sets = judgeSets({ rows: roster.rows, entries: w.entries, T: w.T, monday: w.monday,
    keyed, S: keyed ? entitledSubs(stripe, ctx.priceIds) : [] });
  for (const n of sets.newRows) {
    out.push(pass("C7", "C7.new_since_monday", { buyers: [n.buyer],
      lines: [`New since Monday: buyer ${n.buyer}, first weekly Mon ${mmdd(w.monday + 7 * DAY)}`] }));
  }
  for (const g of sets.cancelled) {
    out.push(pass("C7", "C7.cancelled_since_monday", { buyers: [g.buyer],
      lines: [`Cancelled since Monday: buyer ${g.buyer}`] }));
  }
  for (const s of sets.sameDay) {
    out.push(res("C7", "WARN", "C7.new_same_day", { buyers: [s.buyer],
      lines: [`buyer ${s.buyer}: since ${mmdd(dateMs(s.since))}, the send day; cannot tell before or after`] }));
  }
  if (keyed) {
    for (const x of sets.missed) {
      out.push(res("C7", "NO-GO", "C7.missed_recipient", { buyers: [x.buyer],
        lines: [`buyer ${x.buyer}: in R since ${x.since ? mmdd(dateMs(x.since)) : "?"}, not in M`] }));
    }
    for (const x of sets.extra) {
      out.push(x.buyer
        ? res("C7", "NO-GO", x.inS ? "C7.paid_not_served" : "C7.unexpected_recipient", { buyers: [x.buyer],
          lines: [x.inS ? `buyer ${x.buyer}: in S, not in R` : `buyer ${x.buyer}: in M, not in R`] })
        : res("C7", "NO-GO", "C7.unexpected_recipient", { lines: ["a recipient in M has no roster row"] }));
    }
  } else if (Array.isArray(funnel) && funnel.length >= 2) {
    // No key: a week-over-week drop in paying with paying_total unchanged.
    const a = funnel[0], b = funnel.find((h) => h && Date.parse(a.at) - Date.parse(h.at) >= 6 * DAY);
    if (a && b && typeof a.paying === "number" && a.paying < b.paying && a.paying_total === b.paying_total) {
      out.push(res("C7", "WARN", "C7.confirm_cancellation", { lines: ["confirm it was a real cancellation"] }));
    }
  }
  return finish();
}

// Identical (result, code, buyers) results collapse to the first one.
function dedupeResults(list) {
  const seen = new Set();
  return list.filter((r) => {
    const k = `${r.id}|${r.result}|${r.code}|${r.buyer_numbers.join(",")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
// One digest line per buyer, most severe code first: when one buyer carries
// several non-PASS results, the most severe keeps a merged line and the rest
// are marked folded (their codes still count; composeDigest skips their line).
export function foldByBuyer(list) {
  const per = new Map();
  for (const r of list) {
    if (r.result === "PASS" || r.buyer_numbers.length !== 1) continue;
    const b = r.buyer_numbers[0];
    if (!per.has(b)) per.set(b, []);
    per.get(b).push(r);
  }
  const replaced = new Map();
  for (const [b, rs] of per) {
    if (rs.length < 2) continue;
    const sorted = rs.slice().sort((x, y) => (SEVERITY[y.result] - SEVERITY[x.result]) || x.code.localeCompare(y.code));
    const strip = (l) => l.replace(new RegExp(`^buyer ${b}: `), "");
    const details = [...new Set(sorted.flatMap((r) => r.detail_private.map(strip)))];
    const head = { ...sorted[0], detail_private: [`buyer ${b}: ${sorted.map((r) => r.code).join(", ")}` +
      (details.length ? "; " + details.join("; ") : "")] };
    replaced.set(sorted[0], head);
    for (const r of sorted.slice(1)) replaced.set(r, { ...r, folded: true, detail_private: [] });
  }
  return list.map((r) => replaced.get(r) || r);
}

// The set arithmetic shared by C7 and mon-post. entries: the send-log entries
// of the window; T: first ok delivery (ms); D = T's UTC date.
export function judgeSets({ rows, entries, T, keyed, S }) {
  const D = isoDay(T);
  const M = new Map(); // lc(to) -> ok deliveries in the window
  for (const e of entries) for (const s of okTo(e)) M.set(lc(s.to), (M.get(lc(s.to)) || 0) + 1);
  const rowsByEmail = new Map();
  rows.forEach((r, i) => { if (r && r.email) {
    const k = lc(r.email);
    if (!rowsByEmail.has(k)) rowsByEmail.set(k, []);
    rowsByEmail.get(k).push({ row: r, buyer: i + 1 });
  } });
  const newRows = [], sameDay = [], missed = [], cancelled = [], extra = [], counts = [];
  rows.forEach((r, i) => {
    if (!r || !r.email || r.active === false) return;
    const buyer = i + 1;
    const n = M.get(lc(r.email)) || 0;
    counts.push({ buyer, n, since: r.since || null });
    if (n > 0) return;
    const subs = keyed ? subsForRow(S, r) : [];
    const created = subs.map((s) => s.created).filter((c) => typeof c === "number");
    const since = typeof r.since === "string" ? r.since : "";
    if (since > D || (keyed && created.length && Math.max(...created) * 1000 > T)) newRows.push({ buyer });
    else if (since === D && !(keyed && created.length)) sameDay.push({ buyer, since });
    else missed.push({ buyer, since });
  });
  for (const to of M.keys()) {
    const hits = rowsByEmail.get(to) || [];
    if (hits.some((h) => h.row.active !== false)) continue;
    const h = hits[0];
    if (!h) { extra.push({ buyer: null }); continue; }
    const inS = keyed && subsForRow(S, h.row).length > 0;
    if (typeof h.row.cancelled === "string" && h.row.cancelled >= D && !inS) cancelled.push({ buyer: h.buyer });
    else extra.push({ buyer: h.buyer, inS });
  }
  return { D, M, newRows, sameDay, missed, cancelled, extra, counts };
}

// ── C9: duplicates, and the forecast of a late unguarded send ──────────────
export function checkC9(ctx) {
  const { sendLog, sendLogOk, date, mode, now, facts } = ctx;
  const out = [];
  if (!sendLogOk) out.push(res("C9", "BLIND", "C9.send_log_unreadable"));
  else {
    const w = mondayWindow(sendLog, date, mode, now);
    if (w && w.T != null) {
      const per = new Map();
      for (const e of w.entries) for (const s of okTo(e)) per.set(lc(s.to), (per.get(lc(s.to)) || 0) + 1);
      const dup = [...per.values()].filter((n) => n > 1).length;
      if (dup) out.push(res("C9", "NO-GO", "C9.duplicate", { counts: { recipients: dup },
        lines: [`${dup} recipient(s) got more than one delivery in the Monday ${mmdd(w.monday)} window`] }));
    }
  }
  const b = factsBlind(ctx, ["c9.guard1_present", "c9.mon_send_start", "c9.push_commits", "c9.push_runs",
    "c9.monday_sensitive", "c9.refresh_late_min"]);
  if (b) { out.push(res("C9", "BLIND", b === "schema" ? "schema" : "C9.actions_api")); return out; }
  const starts = fact(facts, "c9.mon_send_start").filter((x) => x >= 0).sort((a, b2) => a - b2);
  const due = 12 * 60;
  const predicted = starts.length ? starts[Math.floor((starts.length - 1) / 2)] : null;
  if (predicted === null) out.push(res("C9", "BLIND", "C9.no_history"));
  else if (predicted > due + 90) {
    out.push(fact(facts, "c9.guard1_present")
      ? res("C9", "WARN", "C9.late_send", { lines: [`predicted send ${hhmm(predicted)}Z`] })
      : res("C9", "NO-GO", "C9.guard1_late", { lines: [`no GUARD 1, predicted send ${hhmm(predicted)}Z`] }));
  }
  if (fact(facts, "c9.refresh_late_min") > 120) {
    out.push(res("C9", "WARN", "C9.refresh_late", { lines: [`refresh started ${fact(facts, "c9.refresh_late_min")} min late`] }));
  }
  if (mode === "mon-pre" && fact(facts, "c9.monday_sensitive") > 0) {
    out.push(res("C9", "NO-GO", "C9.monday_commit", { lines: ["a Monday commit touched a send workflow"] }));
  }
  const info = `push commits ${fact(facts, "c9.push_commits")}, runs ${fact(facts, "c9.push_runs")}`;
  if (!out.some((r) => r.result !== "PASS")) out.push(pass("C9", "C9.ok", { lines: [info] }));
  return out;
}
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

// ── C14: the public sample, counts from the runner ─────────────────────────
export function checkC14(ctx) {
  const keys = ["c14.fetched", "c14.house_numbers", "c14.contractor_echo", "c14.owner_cue",
    "c14.email_like", "c14.hex32"];
  const b = factsBlind(ctx, keys);
  if (b) return [res("C14", "BLIND", b)];
  if (fact(ctx.facts, "c14.fetched") !== true) return [res("C14", "BLIND", "C14.not_fetched")];
  const out = keys.slice(1).filter((k) => fact(ctx.facts, k) !== 0)
    .map((k) => res("C14", "NO-GO", "C14." + k.slice(4)));
  return out.length ? out : [pass("C14")];
}

// ── C17: the watchdogs are alive ────────────────────────────────────────────
export function checkC17(ctx) {
  const { facts, inboxState, now } = ctx;
  const out = [];
  const b = factsBlind(ctx, ["c17.refresh_ok_age_h", "c17.watchdog_mon", "c17.watchdog_tue", "c17.rehearsal_prev_h"]);
  if (b) out.push(res("C17", "BLIND", b === "schema" ? "schema" : "C17.actions_api"));
  else {
    const age = fact(facts, "c17.refresh_ok_age_h");
    if (age < 0 || age >= 30) out.push(res("C17", "WARN", "C17.refresh_old"));
    if (!fact(facts, "c17.watchdog_mon") || !fact(facts, "c17.watchdog_tue")) {
      out.push(res("C17", "WARN", "C17.watchdog_missing"));
    }
    if (fact(facts, "c17.rehearsal_prev_h") < 0) out.push(res("C17", "WARN", "C17.rehearsal_prev_missing"));
  }
  if (fact(facts, "c17.inbox_mirror") !== "ok") {
    out.push(res("C17", "BLIND", "C17.inbox_mirror", { lines: ["inbox mirror drift"] }));
  } else {
    const v = inboxVerdict(inboxState, now);
    if (v === "backlog") out.push(res("C17", "NO-GO", "C17.inbox_backlog"));
    else if (v === "never" || v === "stale" || v === "unarmed") out.push(res("C17", "WARN", "C17.inbox_" + v));
  }
  return out.length ? out : [pass("C17")];
}

// ── C18: the rehearsal's own mail, from earlier runs ───────────────────────
export function checkC18(mailRecords, sinceMs, run) {
  const bad = (mailRecords || []).filter((m) => m && m.run !== run && Date.parse(m.at || "") > sinceMs &&
    ["capped", "failed", "refused"].includes(m.result));
  const codes = [...new Set(bad.map((m) => "C18.mail_" + m.result))].sort();
  return codes.length ? codes.map((c) => res("C18", "WARN", c)) : [pass("C18")];
}

// ── mon-pre: delta against Sunday, and the send-before-refresh order ───────
// sunday: the rehearsal/<sunday>.json record, or null. sunLog: this Sunday's
// core records from log.json.
export function checkMonPre(ctx) {
  const { facts, sunday, sunCore, status } = ctx;
  const out = [];
  if (!sunday) {
    const onlyWait = (sunCore || []).length > 0 && sunCore.every((r) => r.verdict === "WAIT");
    out.push(res("mon_pre", "WARN", onlyWait ? "mon_pre.sunday_wait_only" : "mon_pre.sunday_missing"));
  } else {
    if (sunday.mail === "failed" || sunday.mail === "capped") out.push(res("mon_pre", "WARN", "mon_pre.sunday_mail_" + sunday.mail));
    const rows = status && status.bundle && status.bundle.weekly && status.bundle.weekly.rows;
    if (typeof rows === "number" && typeof sunday.rows === "number" && rows < sunday.rows * 0.9) {
      out.push(res("mon_pre", "NO-GO", "mon_pre.rows_down", { lines: [`${rows} rows against ${sunday.rows} on Sunday`] }));
    }
  }
  const b = factsBlind(ctx, ["send.state", "send.started_min", "refresh.shipped_min", "refresh.runs"]);
  if (b) { out.push(res("mon_pre", "BLIND", b === "schema" ? "schema" : "mon_pre.actions_api")); return out; }
  const ss = fact(facts, "send.state");
  let ordering = false;
  if (ss === "in_progress" || ss === "completed") {
    const at = fact(facts, "send.started_min");
    const shipped = fact(facts, "refresh.shipped_min").some((m) => m >= 0 && m <= at);
    if (!shipped) {
      ordering = true;
      out.push(res("mon_pre", "NO-GO", "mon_pre.send_before_refresh",
        { lines: [`send started ${hhmm(Math.max(at, 0))}Z before any Monday bundle shipped`] }));
    }
  }
  if (fact(facts, "refresh.runs") >= 2) {
    out.push(pass("mon_pre", "mon_pre.refresh_runs", { lines: [`${fact(facts, "refresh.runs")} refresh runs today`] }));
  }
  if (!out.some((r) => r.result !== "PASS")) out.push(pass("mon_pre"));
  return Object.assign(out, { ordering });
}

// Did this mon-pre verdict get worse than Sunday's (or is Sunday itself the
// finding)? Decides whether mon-pre mails.
export function worseThanSunday(verdict, results, sunday) {
  if (!sunday) return true;
  if (sunday.mail === "failed" || sunday.mail === "capped") return true;
  if (verdictRank(verdict) > verdictRank(sunday.verdict)) return true;
  const sunPass = new Set(Object.entries(sunday.checks || {}).filter(([, v]) => v === "PASS").map(([k]) => k));
  return results.some((r) => r.result === "NO-GO" && !r.acked && sunPass.has(r.id));
}

// ── mon-post: every active row got exactly one delivery ────────────────────
// ctx: {roster, sendLog, sendLogOk, date, now, facts, stripe, priceIds, monPre
// (non-WAIT mon-pre core records for that Monday), linksPersisted}
export function checkMonPost(ctx) {
  const { roster, sendLog, sendLogOk, date, now, facts, stripe } = ctx;
  const id = "mon_post";
  const out = [];
  if (!roster.ok) return [res(id, "NO-GO", "roster_unreadable")];
  const active = roster.rows.filter((r) => r && r.email && r.active !== false);
  if (!active.length) out.push(res(id, "NO-GO", "mon_post.empty_roster"));
  if (!sendLogOk) { out.push(res(id, "BLIND", "mon_post.send_log_unreadable")); return out; }
  const monday = dateMs(date);
  const entries = (Array.isArray(sendLog) ? sendLog : []).filter((e) => {
    const t = Date.parse((e && e.at) || "");
    return Number.isFinite(t) && t >= monday && t <= now;
  });
  if (entries.some((e) => e.skipped)) out.push(res(id, "NO-GO", "mon_post.skipped"));
  const okEntries = entries.filter((e) => okTo(e).length);
  if (!okEntries.length) {
    if (active.length) out.push(res(id, "NO-GO", "mon_post.no_delivery"));
    return out;
  }
  const T = Math.min(...okEntries.map((e) => Date.parse(e.at)));
  const keyed = !!(stripe && stripe.keyed && stripe.readable);
  const sets = judgeSets({ rows: roster.rows, entries, T, keyed,
    S: keyed ? entitledSubs(stripe, ctx.priceIds) : [] });
  for (const c of sets.counts) {
    if (c.n > 1) out.push(res(id, "NO-GO", "mon_post.duplicate", { buyers: [c.buyer],
      lines: [`buyer ${c.buyer}: ${c.n} deliveries`] }));
  }
  for (const x of sets.missed) out.push(res(id, "NO-GO", "mon_post.missed", { buyers: [x.buyer],
    lines: [`buyer ${x.buyer}: active since ${x.since ? mmdd(dateMs(x.since)) : "?"}, no delivery`] }));
  for (const x of sets.sameDay) out.push(res(id, "WARN", "mon_post.new_same_day", { buyers: [x.buyer],
    lines: [`buyer ${x.buyer}: joined on the send day; cannot tell before or after`] }));
  for (const n of sets.newRows) out.push(pass(id, "mon_post.new_since_send", { buyers: [n.buyer],
    lines: [`New since the send: buyer ${n.buyer}`] }));
  for (const g of sets.cancelled) out.push(pass(id, "mon_post.cancelled", { buyers: [g.buyer],
    lines: [`Cancelled since Monday: buyer ${g.buyer}`] }));
  for (const x of sets.extra) out.push(res(id, "NO-GO", x.inS ? "mon_post.paid_not_served" : "mon_post.unexpected_recipient",
    { buyers: x.buyer ? [x.buyer] : [], lines: [x.buyer ? `buyer ${x.buyer}: delivered, not active` : "a recipient has no roster row"] }));
  // ordering: a Monday refresh shipped before the first ok delivery
  const b = factsBlind(ctx, ["refresh.shipped_min"]);
  if (b) out.push(res(id, "BLIND", b === "schema" ? "schema" : "mon_post.actions_api"));
  else {
    const tMin = Math.floor((T - monday) / MIN);
    if (!fact(facts, "refresh.shipped_min").some((m) => m >= 0 && m <= tMin)) {
      out.push(res(id, "NO-GO", "mon_post.send_before_refresh", { lines: [`first delivery ${hhmm(tMin)}Z, no Monday bundle shipped before it`] }));
    }
  }
  // the sent etag against mon-pre's record
  const sentEntry = okEntries.find((e) => Date.parse(e.at) === T);
  const recs = ctx.monPre || [];
  if (!recs.length) out.push(res(id, "WARN", "mon_post.no_mon_pre", { lines: ["mon-pre never reached a verdict that Monday"] }));
  else {
    const same = recs.some((r) => r.bundle_etag && r.bundle_etag === sentEntry.bundle_etag &&
      (!r.rowset_sha256 || !sentEntry.bundle_rowset || r.rowset_sha256 === sentEntry.bundle_rowset));
    if (!same) out.push(res(id, "WARN", "mon_post.etag_unjudged", {
      lines: [fact(facts, "refresh.runs") >= 2 ? "sent bundle is not the one mon-pre judged; likely cause: refresh.runs >= 2"
        : "sent bundle is not the one mon-pre judged"] }));
  }
  if (ctx.linksPersisted > 0) out.push(res(id, "NO-GO", "mon_post.beacon_persisted"));
  // Step 2 through RECONCILE_MAP: on the Monday after a cancellation the
  // tripwire fires and the buyer is listed "Cancelled", never NO-GO. Only the
  // C7 results that list or alarm are carried (a BLIND no-key is C7's, not
  // mon-post's), re-labelled mon_post with their C7 codes.
  for (const r of ctx.mapped || []) {
    if (r.id === "C7" && r.result !== "BLIND") out.push({ ...r, id });
  }
  if (!out.some((r) => r.result !== "PASS")) out.push(pass(id));
  return foldByBuyer(dedupeResults(out));
}

// ── when does a run mail the owner (C18) ────────────────────────────────────
// prev: earlier non-WAIT core records for the same (date, mode), newest first.
export function shouldMail({ mode, verdict, results, prev, sunday }) {
  if (verdict === "WAIT" || mode === "dry") return false;
  const last = (prev || [])[0];
  if (mode === "sun") return !last || last.verdict !== verdict;
  if (mode === "sat") {
    if (verdict === "NO-GO") return !last || last.verdict !== "NO-GO";
    return !!last && verdictRank(verdict) > verdictRank(last.verdict);
  }
  if (mode === "mon-pre") return worseThanSunday(verdict, results, sunday);
  if (mode === "mon-post") {
    return verdict === "NO-GO" || verdict.startsWith("GO, blind") || results.some((r) =>
      r.code === "mon_post.no_mon_pre" || r.code === "mon_post.etag_unjudged");
  }
  return false;
}

// ── Stripe events stripe-webhook.js acts on ────────────────────────────────
// The 9 types stripe-webhook.js compares event.type with (:41, :59, :105-107,
// :141, :158, :243). The runner's c8.events_mirror proves this list still
// equals the literals in the shipped file.
export const HANDLED_EVENTS = Object.freeze([
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "radar.early_fraud_warning.created",
  "charge.dispute.created",
  "review.opened",
  "review.closed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "checkout.session.completed",
]);

// ── RECONCILE_MAP: reconcile() finding type -> result ──────────────────────
// Two columns: `key` (STRIPE_READ_KEY set AND the subscriptions read came back
// readable) and `nokey` (no key, or Stripe unreadable). A column is one of:
//   {id, result, code, line}   one result; line names the buyer as {b}
//   {none: true}               no result (a notice the rehearsal does not act on)
//   {not_produced: true}       reconcile() cannot produce it in this column; if it
//                              ever does, it is BLIND C7.unmapped, never PASS
//   {special: "cancellation"}  recipient_dropped_between_runs (see mapReconcile)
//   {bySeverity: {...}}        chosen by the finding's severity
//   {bySubject: {...}}         chosen by the finding's subject (read_failed)
//   {byReason: {...}}          chosen by the finding's reason ("*" = any other)
//   {attach: code, line}       a digest line under that code's lines
// Only type, severity, subject, reason and ref are read from a finding; its
// subject, detail and ref never leave the Function.
const M = (id, result, code, line = "") => Object.freeze({ id, result, code, line });
const NONE = Object.freeze({ none: true });
const NOT_PRODUCED = Object.freeze({ not_produced: true });
const DUP_ROWS = Object.freeze({ bySeverity: Object.freeze({
  red: M("C7", "NO-GO", "C7.duplicate_active_rows", "buyer {b}: more than one ACTIVE roster row on one email"),
  amber: M("C7", "WARN", "C7.duplicate_rows_latent", "buyer {b}: inactive duplicate rows on the same email"),
}) });
const READ_FAILED = Object.freeze({ bySubject: Object.freeze({
  roster: NONE, // not reached: readRoster failed first and reconcile() was not called
  send_log: M("C7", "BLIND", "C7.send_log_unreadable"),
  stripe_subscriptions: Object.freeze({ byReason: Object.freeze({
    "no-key": M("C7", "BLIND", "C7.no_key"),
    "*": M("C7", "BLIND", "C7.stripe_unreadable"),
  }) }),
  stripe_webhook_endpoints: M("C8", "BLIND", "C8.endpoints_unreadable"),
}) });
export const RECONCILE_MAP = Object.freeze({
  recipient_dropped_between_runs: { key: { special: "cancellation" }, nokey: { special: "cancellation" } },
  payer_inactive_on_roster: { key: M("C7", "NO-GO", "C7.paid_not_served", "buyer {b}: in S, not in R"), nokey: NOT_PRODUCED },
  payer_missing_from_roster: { key: M("C7", "NO-GO", "C7.paid_no_row", "a MassPermits payer in S has no roster row"), nokey: NOT_PRODUCED },
  unclassified_payer_missing_from_roster: { key: M("C7", "NO-GO", "C7.unknown_payer_no_row",
    "a payer on a price in no allowlist has no roster row"), nokey: NOT_PRODUCED },
  roster_active_no_live_subscription: { key: M("C7", "NO-GO", "C7.served_not_paid", "buyer {b}: in R, not in S"), nokey: NOT_PRODUCED },
  // C8 (a) facts: they come from the webhook-endpoint read, which does not
  // depend on the subscriptions read, so both columns carry them.
  no_enabled_webhook_endpoint_for_site: { key: M("C8", "NO-GO", "C8.no_endpoint"), nokey: M("C8", "NO-GO", "C8.no_endpoint") },
  churn_event_not_subscribed: { key: M("C8", "NO-GO", "C8.events_missing"), nokey: M("C8", "NO-GO", "C8.events_missing") },
  webhook_endpoint_path_ambiguous: { key: M("C8", "BLIND", "C8.endpoint_ambiguous"), nokey: M("C8", "BLIND", "C8.endpoint_ambiguous") },
  customer_id_conflict: { key: M("C7", "NO-GO", "C7.customer_id_conflict", "buyer {b}: paying under a different Stripe customer id"),
    nokey: NOT_PRODUCED },
  duplicate_roster_rows_same_email: { key: DUP_ROWS, nokey: DUP_ROWS },
  one_customer_id_on_several_emails: { key: M("C7", "WARN", "C7.shared_customer_id", "buyer {b}: one customer id on several emails"),
    nokey: M("C7", "WARN", "C7.shared_customer_id", "buyer {b}: one customer id on several emails") },
  active_row_without_customer_id: { key: M("C7", "NO-GO", "C7.row_without_customer_id", "buyer {b}: active row without a Stripe customer id"),
    nokey: M("C7", "NO-GO", "C7.row_without_customer_id", "buyer {b}: active row without a Stripe customer id") },
  duplicate_stripe_customers_same_email: { key: M("C7", "WARN", "C7.duplicate_stripe_customers",
    "buyer {b}: several Stripe customers entitled on one email"), nokey: NOT_PRODUCED },
  entitled_subscription_unknown_price: { key: M("C7", "NO-GO", "C7.unknown_price",
    "an entitled subscription is on a price in no allowlist"), nokey: NOT_PRODUCED },
  product_allowlist_unconfigured: { key: M("C7", "BLIND", "C7.allowlist_unset"), nokey: NOT_PRODUCED },
  read_failed: { key: READ_FAILED, nokey: READ_FAILED },
  degraded_read: { key: M("C7", "WARN", "C7.degraded_read"), nokey: NOT_PRODUCED },
  invariant_broken: { key: M("C7", "BLIND", "C7.invariant"), nokey: M("C7", "BLIND", "C7.invariant") },
  // notices
  dropped_but_still_active: { key: NONE, nokey: NONE }, // the M rule judges that row
  stripe_returned_nothing: { key: Object.freeze({ attach: "C7.served_not_paid", line: "check that STRIPE_READ_KEY is a live-mode key" }),
    nokey: NOT_PRODUCED },
  unverifiable_no_id: { key: M("C7", "WARN", "C7.row_unverifiable", "buyer {b}: no customer id and no customer emails to match"),
    nokey: NOT_PRODUCED },
  below_floor_unrostered: { key: NONE, nokey: NOT_PRODUCED },
  matched_by_email_only: { key: NONE, nokey: NOT_PRODUCED },
  trialing_and_served: { key: NONE, nokey: NOT_PRODUCED },
  pause_collection: { key: NONE, nokey: NOT_PRODUCED },
  cancel_at_period_end: { key: NONE, nokey: NOT_PRODUCED },
});
Object.values(RECONCILE_MAP).forEach(Object.freeze);

const ownKey = (o, k) => o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
// Resolve one column entry against one finding to a leaf.
function resolveColumn(col, f) {
  let c = col;
  for (let depth = 0; depth < 4 && c; depth++) {
    if (c.bySeverity) c = ownKey(c.bySeverity, f.severity) ? c.bySeverity[f.severity] : null;
    else if (c.bySubject) c = ownKey(c.bySubject, f.subject) ? c.bySubject[f.subject] : null;
    else if (c.byReason) c = ownKey(c.byReason, f.reason) ? c.byReason[f.reason] : c.byReason["*"];
    else return c;
  }
  return c || null;
}

// mapReconcile(recon, ctx) -> results (ids C7 and C8). The ONLY reader of
// reconcile()'s output in the rehearsal: it walks recon.conditions[*].findings
// and recon.notices and reads recon.local_tripwire.prev_at, nothing else.
// ctx: {rows (the roster array passed to reconcile), stripeResult, products, keyed}
export function mapReconcile(recon, ctx) {
  const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
  const keyed = ctx.keyed === true;
  const found = [];
  const conds = recon && recon.conditions && typeof recon.conditions === "object" ? recon.conditions : {};
  for (const k of Object.keys(conds)) {
    const list = conds[k] && Array.isArray(conds[k].findings) ? conds[k].findings : [];
    for (const f of list) found.push(f);
  }
  for (const n of recon && Array.isArray(recon.notices) ? recon.notices : []) found.push(n);
  const prevAt = recon && recon.local_tripwire ? Date.parse(recon.local_tripwire.prev_at || "") : NaN;
  const out = [];
  const attach = [];
  for (const f of found) {
    if (!f || typeof f !== "object") continue;
    const ref = f.ref && typeof f.ref === "object" ? f.ref : {};
    const rowIdx = Number.isInteger(ref.row) && ref.row >= 0 && ref.row < rows.length ? ref.row : null;
    const buyer = rowIdx === null ? null : rowIdx + 1;
    const entry = typeof f.type === "string" && ownKey(RECONCILE_MAP, f.type) ? RECONCILE_MAP[f.type] : null;
    if (!entry) { out.push(res("C7", "BLIND", "C7.unmapped", { lines: ["a reconcile finding type the rehearsal does not know"] })); continue; }
    const leaf = resolveColumn(keyed ? entry.key : entry.nokey, f);
    if (!leaf || leaf.not_produced) {
      out.push(res("C7", "BLIND", "C7.unmapped", { lines: ["a reconcile finding the rehearsal did not expect in this column"] }));
      continue;
    }
    if (leaf.none) continue;
    if (leaf.attach) { attach.push(leaf); continue; }
    if (leaf.special === "cancellation") {
      out.push(cancellation(rows, rowIdx, prevAt, keyed, ctx));
      continue;
    }
    const line = leaf.line ? (buyer ? leaf.line.replace("{b}", String(buyer)) : leaf.line.replace(/^buyer \{b\}: /, "a row: ")) : "";
    out.push(res(leaf.id, leaf.result, leaf.code, { buyers: buyer ? [buyer] : [], lines: line ? [line] : [] }));
  }
  for (const a of attach) {
    const host = out.find((r) => r.code === a.attach);
    if (host) host.detail_private.push(a.line);
  }
  return out;
}

// recipient_dropped_between_runs: a recipient of the second-newest send is
// missing from the newest one and their row is not active. It fires for every
// legitimate cancellation for the week after the next Monday, so it is
// "Cancelled" (listed, never counted) when the row was switched off with a
// `cancelled` date on or after that earlier send and, with the key, Stripe
// shows no live MassPermits-or-unclassified subscription for them.
function cancellation(rows, rowIdx, prevAt, keyed, ctx) {
  const row = rowIdx === null ? null : rows[rowIdx];
  const buyer = rowIdx === null ? null : rowIdx + 1;
  const prevDay = Number.isFinite(prevAt) ? isoDay(prevAt) : null;
  const cancelled = row && typeof row.cancelled === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.cancelled)
    ? row.cancelled.slice(0, 10) : null;
  const three = !!(row && row.active === false && cancelled && prevDay && cancelled >= prevDay);
  const nogo = () => res("C7", "NO-GO", "C7.dropped_recipient", { buyers: buyer ? [buyer] : [],
    lines: [buyer ? `buyer ${buyer}: in the earlier send, not in the newest, and not a confirmed cancellation`
      : "a recipient of the earlier send has no roster row"] });
  if (!three) return nogo();
  const when = cancelled.slice(5);
  if (!keyed) {
    return pass("C7", "C7.cancelled_unconfirmed", { buyers: [buyer],
      lines: [`Cancelled: buyer ${buyer} (${when}); not confirmed in Stripe (no key)`] });
  }
  const sr = ctx.stripeResult || {};
  const live = (Array.isArray(sr.subs) ? sr.subs : []).some((s) => s && ENTITLED_STATUSES.has(String(s.status)) &&
    classifySub(s, ctx.products).kind !== "other" &&
    ((row.customer && subCustomerId(s) === String(row.customer)) ||
     (subCustomerEmail(s) && lc(subCustomerEmail(s)) === lc(row.email))));
  if (live) return nogo();
  return pass("C7", "C7.cancelled", { buyers: [buyer],
    lines: [`Cancelled: buyer ${buyer} (${when}); Stripe shows no live subscription`] });
}

// ── C8: Stripe configuration the webhook depends on ───────────────────────
// ctx: {keyed (STRIPE_READ_KEY set), webhookResult, prices, promos, links,
//       siteHost, priceIds, productIds (MassPermits allowlists), facts,
//       dropped, mapped (C8 results of mapReconcile)}
export function checkC8(ctx) {
  if (!ctx.keyed) return [res("C8", "BLIND", "C8.no_key")];
  const out = [];
  // (a) the endpoint at the webhook path subscribes to every handled event
  const eb = factsBlind(ctx, ["c8.events_mirror"]);
  if (eb) out.push(res("C8", "BLIND", eb));
  else if (fact(ctx.facts, "c8.events_mirror") !== "ok") {
    out.push(res("C8", "BLIND", "C8.event_list_drift", { lines: ["event list drift"] }));
  } else if (!ctx.webhookResult || !ctx.webhookResult.readable) {
    out.push(res("C8", "BLIND", "C8.endpoints_unreadable"));
  } else {
    const site = siteEndpoints(ctx.webhookResult, ctx.siteHost);
    if (!site.exact.length && site.other.length) out.push(res("C8", "BLIND", "C8.endpoint_ambiguous"));
    else if (!site.exact.length) out.push(res("C8", "NO-GO", "C8.no_endpoint", { lines: ["no enabled webhook endpoint for the site"] }));
    else if (!site.events.has("*")) {
      const missing = HANDLED_EVENTS.filter((e) => !site.events.has(e));
      if (missing.length) {
        out.push(res("C8", "NO-GO", "C8.events_missing", { lines: ["the endpoint does not subscribe to " + missing.join(", ")] }));
      }
    }
  }
  const own = new Set(out.map((r) => r.code));
  for (const r of ctx.mapped || []) if (r.id === "C8" && !own.has(r.code)) { out.push(r); own.add(r.code); }

  // (b)-(d) need the price list, the floor and the allowlist
  const pr = ctx.prices;
  const massIds = new Set(ctx.priceIds || []);
  const massProducts = new Set(ctx.productIds || []);
  const minB = factsBlind(ctx, ["c8.min_cents"]);
  const min = minB ? -1 : fact(ctx.facts, "c8.min_cents");
  if (!pr || !pr.readable) out.push(res("C8", "BLIND", "C8.prices_unreadable"));
  else if (!massIds.size && !massProducts.size) out.push(res("C8", "BLIND", "C8.allowlist_unset"));
  else {
    const items = pr.items.filter((p) => p && p.active !== false);
    const isMass = (p) => massIds.has(p.id) || massProducts.has(p.product);
    const mass = items.filter(isMass);
    if (min < 0) out.push(res("C8", "BLIND", minB === "schema" ? "schema" : "C8.min_cents_unknown"));
    else {
      // (b) every MassPermits price, and its net after each promotion code
      // that applies to it, is at or above the webhook's floor
      const below = [];
      for (const p of mass) {
        if (typeof p.unit_amount === "number" && p.unit_amount > 0 && p.unit_amount < min) {
          below.push(`a MassPermits price of ${p.unit_amount}c is under the ${min}c floor`);
        }
      }
      const po = ctx.promos;
      if (!po || !po.readable) out.push(res("C8", "BLIND", "C8.promos_unreadable"));
      else {
        let unknown = 0;
        for (const c of po.items.filter((x) => x && x.active !== false)) {
          if (!c.discount || !c.scope) { unknown++; continue; }
          for (const p of mass) {
            if (!(typeof p.unit_amount === "number" && p.unit_amount > 0)) continue;
            if (!c.scope.all && !(c.scope.products || []).includes(p.product)) continue;
            let net = null;
            if (typeof c.discount.percent_off === "number") net = Math.round(p.unit_amount * (100 - c.discount.percent_off) / 100);
            else if (typeof c.discount.amount_off === "number" && (!c.discount.currency || c.discount.currency === p.currency)) {
              net = p.unit_amount - c.discount.amount_off;
            }
            if (net !== null && net < min) below.push(`a ${p.unit_amount}c MassPermits price nets ${Math.max(net, 0)}c with an active promotion code (floor ${min}c)`);
          }
        }
        if (unknown) out.push(res("C8", "WARN", "C8.promo_scope_unknown",
          { lines: [`${unknown} active promotion code(s) whose discount or scope could not be read`] }));
      }
      if (below.length) out.push(res("C8", "NO-GO", "C8.below_floor", { lines: [...new Set(below)] }));
      // (c) a sibling price the webhook's floor would treat as MassPermits
      const sib = items.filter((p) => !isMass(p) && typeof p.unit_amount === "number" && p.unit_amount >= min);
      if (sib.length) out.push(res("C8", "WARN", "C8.sibling_over_floor",
        { lines: [`${sib.length} active non-MassPermits price(s) at or above the ${min}c floor`] }));
    }
    // (d) a live Payment Link sells a MassPermits price
    const ln = ctx.links;
    if (!ln || !ln.readable) out.push(res("C8", "BLIND", "C8.links_unreadable"));
    else {
      const massPriceIds = new Set(mass.map((p) => p.id).concat([...massIds]));
      const live = ln.items.some((l) => l && l.active !== false && Array.isArray(l.prices) && l.prices.some((x) => massPriceIds.has(x)));
      if (!live) out.push(res("C8", "WARN", "C8.no_live_link"));
    }
  }
  return out.length ? out : [pass("C8")];
}

// Checks built so far (the digest lists the rest as "not built").
export const NOT_BUILT = ["C10", "C11", "C12", "C13", "C15", "C16", "C19", "C20", "C21", "C22"];
