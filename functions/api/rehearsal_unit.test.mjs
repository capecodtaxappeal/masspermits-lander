// Unit tests for the pure half of the monday rehearsal (_rehearsal.js):
// the runner-facts schema, the inbox mirror (against the SHIPPED
// inbox-status.js), known-open acks, the verdict lattice with WAIT, the
// digest, de-duplication, the run-level WAIT, C3 on the resolved date's
// weekday, and the mail rule.
//
//   node functions/api/rehearsal_unit.test.mjs

import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as R from "./_rehearsal.js";
import { evaluate, normalisePolicy } from "./_presend.js";
import { API_DIR, makeRunner, makeFetchStub } from "../../test/rehearsal/harness.mjs";
import { facts as healthyFacts, status as healthyStatus, installClock } from "../../test/rehearsal/rehearsal_kit.mjs";

const stub = makeFetchStub({});
globalThis.fetch = stub.fetch;
const clock = installClock();
const { check, done } = makeRunner("rehearsal_unit.test.mjs");
const HOUR = 3600_000, DAY = 24 * HOUR, MIN = 60_000;
const at = (s) => Date.parse(s);

// ── RUNNER_SCHEMA / validateRunnerFacts ─────────────────────────────────────
{
  const f = healthyFacts();
  const { facts, dropped } = R.validateRunnerFacts(f);
  check("healthy facts: nothing dropped", dropped.length === 0, dropped.join(","));
  check("healthy facts: every schema key survives",
    Object.keys(R.RUNNER_SCHEMA).every((k) => R.fact(facts, k) !== undefined));
  check("healthy facts fit in 4 KB", JSON.stringify(f).length <= R.FACTS_MAX_BYTES, JSON.stringify(f).length);
  const bad = R.validateRunnerFacts(healthyFacts({ "refresh.state": "exploded", "c0.fn_age_min": 100001,
    "refresh.shipped_min": [1, 2, 3], "c0.fn_sha7": "ABCDEF1", "c9.guard1_present": "yes", api: "OK",
    "c14.hex32": 1.5, "c17.inbox_mirror": null }));
  check("bad enum, int out of range, short array, upper-case sha, string bool, float, null: all dropped",
    ["refresh.state", "c0.fn_age_min", "refresh.shipped_min", "c0.fn_sha7", "c9.guard1_present", "api",
      "c14.hex32", "c17.inbox_mirror"].every((k) => bad.dropped.includes(k) && R.fact(bad.facts, k) === undefined),
    bad.dropped.join(","));
  const unk = R.validateRunnerFacts({ ...healthyFacts(), extra: "x", refresh: { ...healthyFacts().refresh, who: "a" },
    __proto__: { polluted: 1 } });
  check("unknown keys dropped silently (top level and nested)", unk.facts.extra === undefined &&
    unk.facts.refresh.who === undefined && unk.dropped.length === 0);
  check("a non-object body validates to nothing", R.validateRunnerFacts([1]).dropped.includes("v") &&
    R.validateRunnerFacts(null).dropped.includes("v"));
  // dropped key -> the checks needing it are BLIND "schema"
  const c0 = R.checkC0({ ...R.validateRunnerFacts(healthyFacts({ "c0.fn_state": "weird" })) });
  check("C0 with a dropped fn_state is BLIND schema", c0[0].result === "BLIND" && c0[0].code === "schema");
  const c1 = R.checkC1({ ...R.validateRunnerFacts(healthyFacts({ "refresh.conclusion": 7 })), status: healthyStatus(Date.now()) });
  check("C1 with a dropped conclusion is BLIND schema", c1.some((r) => r.result === "BLIND" && r.code === "schema"));
  const api = R.validateRunnerFacts(healthyFacts({ api: "rate_limited" }));
  check("api rate_limited: C0 BLIND (Actions facts)", R.checkC0(api)[0].result === "BLIND");
  check("api rate_limited: C14 still judged (not an Actions fact)", R.checkC14(api)[0].result === "PASS");
}

// ── inboxVerdict, and its drift test against the SHIPPED inbox-status.js ───
{
  const now = at("2026-10-05T12:00:00Z");
  const iso = (h) => new Date(now - h * HOUR).toISOString();
  const cases = [
    ["no state", null, "never"],
    ["no live run", { last: {} }, "never"],
    ["stale 31h", { last_live_run_at: iso(31), last: { waiting: 0, roster_armed: true } }, "stale"],
    ["exactly 30h (boundary)", { last_live_run_at: iso(30), last: { waiting: 0, roster_armed: true } }, "ok"],
    ["30h plus a minute", { last_live_run_at: new Date(now - 30 * HOUR - MIN).toISOString(), last: { waiting: 0 } }, "stale"],
    ["unarmed", { last_live_run_at: iso(2), last: { waiting: 0, roster_armed: false } }, "unarmed"],
    ["backlog at 72h (boundary)", { last_live_run_at: iso(2), last: { waiting: 1, oldest_hours: 72, roster_armed: true } }, "backlog"],
    ["waiting at 71.9h", { last_live_run_at: iso(2), last: { waiting: 1, oldest_hours: 71.9, roster_armed: true } }, "waiting"],
    ["ok", { last_live_run_at: iso(2), last: { waiting: 0, oldest_hours: 0, roster_armed: true, roster_active: 1, roster_cancelled: 0 } }, "ok"],
  ];
  for (const [n, s, want] of cases) check(`inboxVerdict ${n} -> ${want}`, R.inboxVerdict(s, now) === want, R.inboxVerdict(s, now));
  // The shipped file, byte for byte, next to a stub verifier that says ok.
  const dir = mkdtempSync(join(tmpdir(), "mp-inbox-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  copyFileSync(join(API_DIR, "inbox-status.js"), join(dir, "inbox-status.js"));
  writeFileSync(join(dir, "_github-oidc.js"), "export async function verifyGitHubOIDC() { return { ok: true }; }\n");
  const shipped = await import(pathToFileURL(join(dir, "inbox-status.js")).href);
  clock.set(now);
  let agree = 0;
  for (const [n, s, want] of cases) {
    const env = { BUNDLES: { async get() { return s === null ? null : { async text() { return JSON.stringify(s); } }; } } };
    const r = await shipped.onRequest({ request: new Request("https://masspermits.com/x"), env });
    const v = (await r.json()).verdict;
    if (check(`shipped inbox-status.js agrees on "${n}"`, v === R.inboxVerdict(s, now) && v === want, v)) agree++;
  }
  clock.real();
  check("inbox mirror: no drift across every fixture", agree === cases.length);
}

// ── acks (known-open) ───────────────────────────────────────────────────────
{
  const date = "2026-10-04";
  check("C5.purchase_copy is ackable", R.isAckable("C5.purchase_copy"));
  check("C5.style_* matches C5.style_emoji", R.isAckable("C5.style_emoji"));
  check("C10.source_stale:<town> matches", R.isAckable("C10.source_stale:Boston"));
  for (const c of ["C1.no_refresh", "C3.hold", "C6.portal_red", "C7.dropped_recipient", "C9.duplicate",
    "C17.inbox_backlog", "C2.drift", "C4.weekly_no_rows"]) check(`${c} is never ackable`, !R.isAckable(c));
  check("ack valid on its last day", R.ackValid({ "C5.purchase_copy": "2026-10-04" }, "C5.purchase_copy", date));
  check("ack expired the day before", !R.ackValid({ "C5.purchase_copy": "2026-10-03" }, "C5.purchase_copy", date));
  check("ack 28 days out is valid", R.ackValid({ "C5.purchase_copy": "2026-11-01" }, "C5.purchase_copy", date));
  check("ack 29 days out is ignored", !R.ackValid({ "C5.purchase_copy": "2026-11-02" }, "C5.purchase_copy", date));
  check("an ack on a never-ackable code is ignored", !R.ackValid({ "C9.duplicate": "2026-10-05" }, "C9.duplicate", date));
  const rs = R.applyAcks([R.res("C5", "NO-GO", "C5.purchase_copy"), R.res("C9", "NO-GO", "C9.duplicate")],
    { "C5.purchase_copy": "2026-10-10", "C9.duplicate": "2026-10-10" }, date);
  check("acked NO-GO does not count; un-ackable still NO-GO", R.verdictOf(rs) === "NO-GO" &&
    R.nogoCodes(rs).join() === "C9.duplicate");
  const only = R.applyAcks([R.res("C5", "NO-GO", "C5.purchase_copy")], { "C5.purchase_copy": "2026-10-10" }, date);
  check("only an acked NO-GO -> GO", R.verdictOf(only) === "GO");
  const d = R.composeDigest(only, { mode: "sun", date });
  check("acked finding listed under Known open", d.html.includes("Known open") && d.html.includes("C5.purchase_copy"));
}

// ── verdict lattice ─────────────────────────────────────────────────────────
{
  const P = (id) => R.res(id, "PASS", id + ".ok");
  check("run-level WAIT wins over everything", R.verdictOf([R.res("C1", "NO-GO", "x")], "WAIT.x") === "WAIT");
  check("any NO-GO -> NO-GO", R.verdictOf([P("C1"), R.res("C2", "NO-GO", "C2.drift")]) === "NO-GO");
  check("BLIND on C1 and C7 -> GO, blind on 2",
    R.verdictOf([R.res("C1", "BLIND", "a"), R.res("C7", "BLIND", "b"), R.res("C7", "BLIND", "c")]) === "GO, blind on 2");
  check("BLIND on C4 or C9 does not count toward blind", R.verdictOf([R.res("C4", "BLIND", "a"), R.res("C9", "BLIND", "b")]) === "GO");
  check("check-level WAIT and WARN never block", R.verdictOf([R.res("C0", "WAIT", "C0.deploy_pending"), R.res("C5", "WARN", "x")]) === "GO");
  check("rank: WAIT < GO < blind < NO-GO", R.verdictRank("WAIT") < R.verdictRank("GO") &&
    R.verdictRank("GO") < R.verdictRank("GO, blind on 1") && R.verdictRank("GO, blind on 1") < R.verdictRank("NO-GO"));
}

// ── digest ──────────────────────────────────────────────────────────────────
{
  const rs = [R.res("C1", "NO-GO", "C1.no_refresh"), R.res("C0", "WAIT", "C0.deploy_pending"),
    R.res("C7", "PASS", "C7.new_since_monday", { buyers: [6], lines: ["New since Monday: buyer 6, first weekly Mon 10-12"] }),
    R.res("C5", "WARN", "C5.style_em_dash", { lines: ["copy has — in it"] })];
  const d = R.composeDigest(rs, { mode: "sat", date: "2026-10-03" });
  const firstLine = d.html.replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean)[0];
  check("digest first line is the verdict", firstLine === "NO-GO", firstLine);
  check("digest subject starts with the verdict", d.subject.startsWith("NO-GO"));
  check("digest has no em dash", !/—/.test(d.subject + d.html));
  check("check-level WAIT listed as Not yet confirmed", d.html.includes("Not yet confirmed") && d.html.includes("C0.deploy_pending"));
  check("new buyer listed", d.html.includes("New since Monday: buyer 6"));
  const u = R.composeDigest(rs, { mode: "sat", date: "2026-10-03", rosterReadable: false });
  check("roster unreadable: fixed text, no buyer lines", u.html.includes(R.ROSTER_UNREADABLE_TEXT) && !/buyer/.test(u.html));
  check("digest carries no @", !u.html.includes("@") && !d.html.includes("@"));
}

// ── de-duplication ──────────────────────────────────────────────────────────
{
  const rec = (o) => ({ date: "2026-10-03", mode: "sat", part: "core", trigger: "sched", run: "10", verdict: "GO", ...o });
  const p = (o) => ({ date: "2026-10-03", mode: "sat", trigger: "sched", run: "11", ...o });
  check("dispatch always runs", !R.shouldSkip([rec()], p({ trigger: "dispatch" })));
  check("sched backstop skips once (date, mode) has a non-WAIT core record", R.shouldSkip([rec({ trigger: "555" })], p()));
  check("sched backstop does NOT skip on a WAIT record", !R.shouldSkip([rec({ verdict: "WAIT" })], p()));
  check("sched does not skip on another mode's record", !R.shouldSkip([rec({ mode: "sun" })], p()));
  check("workflow_run skips a re-run of the same event", R.shouldSkip([rec({ trigger: "555" })], p({ trigger: "555" })));
  check("workflow_run does not skip because of the sched record", !R.shouldSkip([rec()], p({ trigger: "555" })));
  check("a record from the SAME run never dedups", !R.shouldSkip([rec({ run: "11" })], p()));
  check("links records never dedup", !R.shouldSkip([rec({ part: "links" })], p()));
}

// ── run-level WAIT ──────────────────────────────────────────────────────────
{
  const W = (mode, over) => R.runLevelWait(mode, R.validateRunnerFacts(healthyFacts(over)));
  check("sat, refresh in_progress -> WAIT", W("sat", { "refresh.state": "in_progress" }) !== null);
  check("sun, refresh queued -> WAIT", W("sun", { "refresh.state": "queued" }) !== null);
  check("sat, refresh none -> not WAIT (C1 NO-GO)", W("sat", { "refresh.state": "none", "refresh.conclusion": "none" }) === null);
  check("mon-pre, no refresh, no send -> WAIT (F3)", W("mon-pre", { "refresh.state": "none", "send.state": "none" }) !== null);
  check("mon-pre, refresh in_progress, send queued -> WAIT (F4)", W("mon-pre", { "refresh.state": "in_progress", "send.state": "queued" }) !== null);
  check("mon-pre, send started while refresh running -> NOT WAIT", W("mon-pre", { "refresh.state": "in_progress", "send.state": "in_progress" }) === null);
  check("mon-post, send in_progress -> WAIT (F9)", W("mon-post", { "send.state": "in_progress" }) !== null);
  check("mon-post, send completed -> not WAIT", W("mon-post", { "send.state": "completed" }) === null);
  check("no usable facts -> never WAIT", R.runLevelWait("sat", R.validateRunnerFacts({ v: 1 })) === null);
}

// ── C3 judged on the RESOLVED date's weekday (F10's pure core) ─────────────
{
  // The sat backstop ran late, at Sunday 02:00Z; date stays Saturday.
  const now = at("2026-10-04T02:00:00Z");
  const ran = at("2026-10-03T14:00:00Z");
  const inp = { policy: normalisePolicy(null), status: healthyStatus(ran),
    log: [{ at: "2026-09-28T14:00:00Z", sent: [{ to: "a@example.com", ok: true }], bundle_etag: "old", bundle_rows: 5600, bundle_bytes: 4096 }],
    weekly: { etag: "new", size: 4096, uploaded: new Date(ran).toISOString() },
    monthly: { etag: "m", size: 8192, uploaded: new Date(ran).toISOString() }, sha256: null };
  const r = R.checkC3({ now, date: "2026-10-03", mode: "sat", inp, facts: {} });
  check("late sat backstop, date Saturday: C3 PASS", r[0].result === "PASS", r[0].code);
  const clockDow = evaluate(now, { ...inp, policy: { ...inp.policy, send_dow: new Date(now).getUTCDay(), send_hour: 20 } });
  check("with the clock's weekday the same world would HOLD (the bug this avoids)", clockDow.verdict === "HOLD", clockDow.verdict);
  check("C3 BLIND C3.clock before 00:00Z of date", R.checkC3({ now: at("2026-10-02T23:00:00Z"), date: "2026-10-03", mode: "sat", inp })[0].code === "C3.clock");
  check("C3 BLIND without status.bundle", R.checkC3({ now, date: "2026-10-03", mode: "sat",
    inp: { ...inp, status: { ...inp.status, bundle: undefined } } })[0].code === "C3.no_manifest");
  const sent = R.checkC3({ now: at("2026-10-05T15:00:00Z"), date: "2026-10-05", mode: "mon-pre", inp,
    facts: R.validateRunnerFacts(healthyFacts({ "send.state": "completed" })).facts });
  check("mon-pre after the send started: PASS C3.already_sent", sent[0].code === "C3.already_sent");
}

// ── the mail rule (C18) ─────────────────────────────────────────────────────
{
  const M = (o) => R.shouldMail({ results: [], prev: [], sunday: null, ...o });
  check("WAIT never mails", !M({ mode: "sun", verdict: "WAIT" }));
  check("dry never mails", !M({ mode: "dry", verdict: "NO-GO" }));
  check("sun mails its first non-WAIT verdict", M({ mode: "sun", verdict: "GO" }));
  check("sun does not mail the same verdict twice", !M({ mode: "sun", verdict: "GO", prev: [{ verdict: "GO" }] }));
  check("sun mails again when the verdict changes", M({ mode: "sun", verdict: "NO-GO", prev: [{ verdict: "GO" }] }));
  check("sat GO does not mail", !M({ mode: "sat", verdict: "GO" }));
  check("sat NO-GO mails", M({ mode: "sat", verdict: "NO-GO" }));
  check("sat worsened verdict mails", M({ mode: "sat", verdict: "GO, blind on 1", prev: [{ verdict: "GO" }] }));
  const sunday = { verdict: "GO, blind on 1", mail: "sent", checks: { C1: "PASS", C3: "PASS" } };
  check("mon-pre same as Sunday: no mail", !M({ mode: "mon-pre", verdict: "GO, blind on 1", sunday }));
  check("mon-pre worse than Sunday: mail", M({ mode: "mon-pre", verdict: "NO-GO", sunday,
    results: [R.res("C3", "NO-GO", "C3.hold")] }));
  check("mon-pre, Sunday record missing: mail", M({ mode: "mon-pre", verdict: "GO" }));
  check("mon-pre, Sunday mail failed: mail", M({ mode: "mon-pre", verdict: "GO", sunday: { ...sunday, mail: "failed" } }));
  check("mon-pre, Sunday mail off is not a finding", !M({ mode: "mon-pre", verdict: "GO, blind on 1", sunday: { ...sunday, mail: "off" } }));
  check("mon-post GO: no mail", !M({ mode: "mon-post", verdict: "GO" }));
  check("mon-post NO-GO: mail", M({ mode: "mon-post", verdict: "NO-GO" }));
}

// ── C5 date scan ────────────────────────────────────────────────────────────
{
  const ds = R.datesInText("On 1 August x, back as of 11 August, and 2026-09-30.", "2026-10-04").map(R.isoDay);
  check("dates found: 1 August, 11 August, ISO", ["2026-08-01", "2026-08-11", "2026-09-30"].every((d) => ds.includes(d)), ds.join(","));
  const jan = R.datesInText("December 30", "2026-01-05").map(R.isoDay);
  check("a day-month after the run date falls back a year", jan[0] === "2025-12-30", jan.join(","));
}

check("fetch stub: 0 calls", stub.calls.length === 0);
done();
