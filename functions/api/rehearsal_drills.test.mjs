// Drills: one fault fixture per incident, each with a negative twin, and the
// false-alarm drills F1-F12 (F13 and the R3a halves are drilled in
// rehearsal_r3a_drills.test.mjs). Every Function drill runs the whole
// rehearsal.js (temp copy, stubbed verifier) the way the caller drives it;
// C7's keyed half is also drilled here through the pure
// functions with synthetic Stripe subscriptions.
//
//   node functions/api/rehearsal_drills.test.mjs
//
// Prints a table: ID | check | result | Y/P/N | note. Y = the fault is caught
// (non-PASS) and the twin passes; P = the part built so far is caught, the
// rest is not built yet; N = missed. Checks not yet built are listed as
// "not built", never as a miss.

import { makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub } from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";
import * as R from "./_rehearsal.js";

const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
const stub = makeFetchStub({ [RESEND]: rs.handler });
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const { check, done } = makeRunner("rehearsal_drills.test.mjs");
const L = await K.loadRehearsal();
const { HOUR, DAY, MIN } = K;
const at = K.at;

const table = [];
const row = (id, chk, result, ynp, note = "") => { table.push([id, chk, result, ynp, note]); };
const worlds = [];
const waitMail = [];

// ── one Function run ────────────────────────────────────────────────────────
// o: {now, mode, date, facts, trigger, run, env, world options...}
let runSeq = 2000;
async function fx(o) {
  clock.set(o.now);
  const subs = o.subs ?? K.roster(3);
  const w = o.w ?? K.world({ now: o.now, subs, refreshAt: o.refreshAt,
    log: o.log ?? [K.sendEntry(o.lastSend ?? at("2026-09-28T14:00:00Z"), (Array.isArray(subs) ? subs : []).map((s) => s.email))],
    ...o.worldOpts });
  worlds.push(w);
  const before = rs.sent.length;
  const x = await K.runMode(L.mod, K.baseEnv(w.bucket, o.env || {}), { mode: o.mode, date: o.date,
    trigger: o.trigger || "sched", run: o.run || String(++runSeq), body: o.facts ?? K.facts() });
  const log = w.json("rehearsal/log.json");
  const rec = log && log.records.find((r) => r.part === "core");
  const mails = rs.sent.slice(before);
  if (x.core.json.verdict === "WAIT") waitMail.push(mails.length);
  return { w, x, v: x.core.json.verdict, codes: x.core.json.codes, rec, mails,
    worst: (id) => (rec && rec.checks ? rec.checks[id] : undefined),
    has: (s) => !!(rec && rec.findings && rec.findings.some((f) => f === s || f.endsWith(" " + s))) };
}

// Standard healthy worlds.
const SAT = { now: at("2026-10-03T20:30:00Z"), mode: "sat", date: "2026-10-03", refreshAt: at("2026-10-03T14:00:00Z") };
const SUN = { now: at("2026-10-04T20:30:00Z"), mode: "sun", date: "2026-10-04", refreshAt: at("2026-10-04T14:00:00Z") };
const sundayRecord = (extra = {}) => ({ "rehearsal/2026-10-04.json": { date: "2026-10-04", run: "1", verdict: "GO, blind on 1",
  mail: "sent", rows: 5702, checks: { C0: "PASS", C1: "PASS", C2: "PASS", C3: "PASS", C4: "PASS", C6: "PASS", C9: "PASS", C17: "PASS" }, ...extra } });
const MONPRE = { now: at("2026-10-05T11:30:00Z"), mode: "mon-pre", date: "2026-10-05", refreshAt: at("2026-10-05T09:40:00Z"),
  facts: K.facts({ "refresh.shipped_min": [580, -1, -1, -1] }), worldOpts: { extra: sundayRecord() } };
// mon-post: Tuesday 13:05Z backstop for Monday 10-05, Monday send 14:00Z.
function monPost(o = {}) {
  const subs = o.subs ?? K.roster(3);
  const sendAt = at("2026-10-05T14:00:00Z");
  const monday = K.sendEntry(sendAt, o.recipients ?? subs.filter((s) => s.active !== false).map((s) => s.email), o.entry || {});
  const log = o.log ?? [monday, K.sendEntry(at("2026-09-28T14:00:00Z"), subs.map((s) => s.email))];
  const monPreRec = { date: "2026-10-05", mode: "mon-pre", part: "core", trigger: "sched", run: "500", verdict: "GO, blind on 1",
    code: null, at: "2026-10-05T11:30:00.000Z", bundle_etag: monday.bundle_etag, rowset_sha256: monday.bundle_rowset };
  const records = o.records ?? [monPreRec];
  return { now: o.now ?? at("2026-10-06T13:05:00Z"), mode: "mon-post", date: "2026-10-05", subs, log,
    refreshAt: at("2026-10-06T12:51:00Z"),
    facts: o.facts ?? K.facts({ "refresh.shipped_min": [580, -1, -1, -1], "send.state": "completed", "send.started_min": 840, "send.runs": 1 }),
    worldOpts: { extra: { "rehearsal/log.json": { v: 1, records, mail: [] }, ...(o.extra || {}) } } };
}

// ════════════════════════════════════════════════════════════════════════════
// baseline: the healthy worlds are quiet
// ════════════════════════════════════════════════════════════════════════════
const base = {};
base.sat = await fx(SAT);
check("baseline sat: GO, blind on 1 (C7 has no Stripe key), no mail", base.sat.v === "GO, blind on 1" && base.sat.mails.length === 0, base.sat.v);
base.sun = await fx(SUN);
check("baseline sun: GO, blind on 1, exactly one mail, to the owner, subject starting GO",
  base.sun.v === "GO, blind on 1" && base.sun.mails.length === 1 && base.sun.mails[0].to[0] === K.OWNER &&
  base.sun.mails[0].subject.startsWith("GO"), base.sun.v);
base.monpre = await fx(MONPRE);
check("baseline mon-pre: GO, no mail (same as Sunday)", base.monpre.v === "GO" && base.monpre.mails.length === 0, base.monpre.v + " " + base.monpre.codes);
base.monpost = await fx(monPost());
check("baseline mon-post: GO, no mail", base.monpost.v === "GO" && base.monpost.mails.length === 0, base.monpost.v + " " + JSON.stringify(base.monpost.rec.findings));
for (const [k, b] of Object.entries(base)) check(`baseline ${k}: no NO-GO finding`, !b.rec.findings.some((f) => f.startsWith("NO-GO")), JSON.stringify(b.rec.findings));

// A drill: fault must make `id` non-PASS (optionally with `code`); twin must not.
function judge(ID, id, fault, twin, { code, twinOk = ["PASS"], note = "" } = {}) {
  const f = fault.worst(id);
  const t = twin.worst(id);
  const caught = f && f !== "PASS" && (!code || fault.has(code));
  const quiet = twinOk.includes(t);
  check(`${ID} ${id}: fault -> ${f}${code ? " " + code : ""}`, caught, JSON.stringify(fault.rec && fault.rec.findings));
  check(`${ID} ${id}: twin -> ${t}`, quiet, JSON.stringify(twin.rec && twin.rec.findings));
  row(ID, id, `${f}${code ? " " + code : ""}; twin ${t}`, caught && quiet ? "Y" : "N", note);
  return caught && quiet;
}
// C5 always carries the shipped copy's style WARNs (em dash, emoji, no text
// part, no /leads link), so its healthy twin is WARN, never NO-GO.
const C5_TWIN = ["PASS", "WARN"];

// ════════════════════════════════════════════════════════════════════════════
// incident drills (built checks)
// ════════════════════════════════════════════════════════════════════════════
{ // I-01 no token -> C5, C6
  const subs = K.roster(3, (s, i) => (i === 2 ? { ...s, token: "" } : s));
  const f = await fx({ ...SAT, subs });
  judge("I-01", "C5", f, base.sat, { code: "C5.no_token", twinOk: C5_TWIN });
  judge("I-01", "C6", f, base.sat, { code: "C6.no_token" });
}
{ // I-05 C0 failure; twin head_state failure alone -> WARN
  const f = await fx({ ...SAT, facts: K.facts({ "c0.fn_state": "failure" }) });
  const t = await fx({ ...SAT, facts: K.facts({ "c0.head_state": "failure" }) });
  judge("I-05", "C0", f, base.sat, { code: "C0.fn_build_failed" });
  const ok = t.worst("C0") === "WARN" && t.has("C0.head_build_failed") && t.v !== "NO-GO";
  check("I-05 twin: head_state failure alone is WARN C0.head_build_failed, not NO-GO", ok, JSON.stringify(t.rec.findings));
  check("I-05: C0 NO-GO blinds C3-C8", ["C3", "C4", "C5", "C6", "C7"].every((id) => f.worst(id) === "BLIND"));
  row("I-05 twin", "C0", `${t.worst("C0")} C0.head_build_failed`, ok ? "Y" : "N");
}
{ // I-06 (second half) a subscriber since before the send with no entry -> mon-post
  const subs = K.roster(3);
  const f = await fx(monPost({ subs, recipients: [subs[0].email, subs[2].email] }));
  judge("I-06", "mon_post", f, base.monpost, { code: "mon_post.missed", note: "seed placement half (C20) not built" });
  table[table.length - 1][3] = "P";
}
{ // I-09 live 23 of 70 -> C3 (disclosure), C12 not built
  const st = K.status(SAT.refreshAt, { coverage: { live_sources: 23, expected_sources: 70, disclose: true } });
  const f = await fx({ ...SAT, worldOpts: { status: st } });
  judge("I-09", "C3", f, base.sat, { code: "C3.disclosure", note: "C12 not built" });
  table[table.length - 1][3] = "P";
}
{ // I-10 ok:false + old bundle + no refresh today, as a sat backstop run
  const now = at("2026-10-04T02:00:00Z");
  const old = at("2026-09-25T09:00:00Z");
  const st = K.status(old, { ok: false, degraded: false, error: "hosted_refresh aborted" });
  const f = await fx({ now, mode: "sat", date: "2026-10-03", refreshAt: old, worldOpts: { status: st },
    facts: K.facts({ "refresh.state": "none", "refresh.conclusion": "none", "refresh.ship_step": "absent", "refresh.runs": 0 }) });
  const t = await fx({ now, mode: "sat", date: "2026-10-03", refreshAt: SAT.refreshAt });
  judge("I-10", "C1", f, t, { code: "C1.no_refresh" });
  judge("I-10", "C2", f, t, { code: "C2.margin" });
  judge("I-10", "C3", f, t);
}
{ // I-11 two deliveries in one window -> C9, mon-post
  const subs = K.roster(3);
  const emails = subs.map((s) => s.email);
  const f = await fx({ ...SAT, subs, log: [K.sendEntry(at("2026-09-28T16:00:00Z"), emails), K.sendEntry(at("2026-09-28T14:00:00Z"), emails)] });
  judge("I-11", "C9", f, base.sat, { code: "C9.duplicate" });
  const m = await fx(monPost({ subs, log: [K.sendEntry(at("2026-10-05T16:00:00Z"), emails), K.sendEntry(at("2026-10-05T14:00:00Z"), emails)] }));
  judge("I-11", "mon_post", m, base.monpost, { code: "mon_post.duplicate" });
}
{ // I-12 a skipped entry -> C3 (the gate sees the delivered etag), mon-post; an empty roster -> mon-post
  const subs = K.roster(3);
  const emails = subs.map((s) => s.email);
  const etag = "etag-current-bundle";
  const f = await fx({ ...SAT, subs, worldOpts: { weeklyEtag: etag },
    log: [{ at: "2026-10-03T15:00:00.000Z", subscribers: 3, sent: [], skipped: "identical bundle already delivered", bundle_etag: etag, bundle_bytes: 4096 },
      K.sendEntry(at("2026-09-28T14:00:00Z"), emails, { bundle_etag: etag })] });
  judge("I-12", "C3", f, base.sat, { code: "C3.already_delivered" });
  const skipEntry = { at: "2026-10-05T18:00:00.000Z", subscribers: 3, sent: [], skipped: "identical bundle already delivered", bundle_etag: "x" };
  const m = await fx(monPost({ subs, log: [skipEntry, K.sendEntry(at("2026-10-05T14:00:00Z"), emails)] }));
  judge("I-12", "mon_post", m, base.monpost, { code: "mon_post.skipped" });
  const e = await fx(monPost({ subs: [], recipients: [] }));
  judge("I-12 empty", "mon_post", e, base.monpost, { code: "mon_post.empty_roster" });
}
{ // I-14 latest-monthly.zip missing (every &k=monthly link 404s) + purchase render without a link
  const f = await fx({ ...SAT, worldOpts: { omit: ["latest-monthly.zip"] }, facts: K.facts({ "purchase.link_first": false }) });
  judge("I-14", "C6", f, base.sat, { code: "C6.monthly_failed" });
  judge("I-14", "C5", f, base.sat, { code: "C5.purchase_copy", twinOk: C5_TWIN });
}
{ // I-15 late crons -> C9 report
  const f = await fx({ ...SAT, facts: K.facts({ "c9.mon_send_start": [900, 950, 1000, 980], "c9.refresh_late_min": 300 }) });
  judge("I-15", "C9", f, base.sat, { code: "C9.late_send" });
}
{ // I-18 no GUARD 1 + late send + a Monday commit touching send-watchdog.yml -> C9 (mon-pre)
  const f = await fx({ ...MONPRE, facts: K.facts({ "refresh.shipped_min": [580, -1, -1, -1], "c9.guard1_present": false,
    "c9.mon_send_start": [900, 950, 1000, 980], "c9.monday_sensitive": 1 }) });
  judge("I-18", "C9", f, base.monpre, { code: "C9.guard1_late" });
  check("I-18: the Monday commit is NO-GO C9.monday_commit", f.has("C9.monday_commit"));
  check("I-18: mon-pre worse than Sunday mails the owner once", f.mails.length === 1 && f.mails[0].to[0] === K.OWNER);
}
{ // I-19 status.error "bundle build crashed" -> C1, C3, C4; the warn-mode twin is the known miss
  const st = K.status(SAT.refreshAt, { ok: false, degraded: false, error: "bundle build crashed: KeyError" });
  const f = await fx({ ...SAT, worldOpts: { status: st } });
  judge("I-19", "C1", f, base.sat, { code: "C1.bundle_crashed" });
  judge("I-19", "C3", f, base.sat);
  judge("I-19", "C4", f, base.sat, { code: "C4.bundle_crashed" });
  row("I-19 warn-mode", "C1,C3,C4", "status ok with a crash nobody recorded: every check passes", "known miss",
    "recorded as the known miss: nothing in R2 says the build crashed");
}
{ // I-20 / I-21: the sample scan (the runner counts; the Function judges the counts)
  const f = await fx({ ...SAT, facts: K.facts({ "c14.house_numbers": 2, "c14.owner_cue": 1 }) });
  judge("I-20", "C14", f, base.sat, { code: "C14.house_numbers", note: "runner scan: runner.test.mjs" });
  judge("I-21", "C14", f, base.sat, { code: "C14.owner_cue", note: "runner scan: runner.test.mjs" });
}
{ // I-22 today's shipped copy at 2026-10-04 (reduced coverage disclosed) -> C5 NO-GO
  const st = K.status(SUN.refreshAt, { coverage: { live_sources: 39, expected_sources: 140, disclose: true,
    monthly_sources: ["Chatham, MA"] } });
  const f = await fx({ ...SUN, worldOpts: { status: st } });
  judge("I-22", "C5", f, base.sun, { code: "C5.stale_date", twinOk: C5_TWIN });
  check("I-22: the copy's \"upstream provider\" is NO-GO C5.vendor_words", f.has("C5.vendor_words"));
}
{ // I-23 no text/plain -> C5 WARN (DMARC half is C22, not built)
  const ok = base.sat.has("C5.style_no_text_part") && base.sat.worst("C5") === "WARN";
  check("I-23: the shipped sender has no text/plain part -> WARN C5.style_no_text_part", ok);
  row("I-23", "C5", "WARN C5.style_no_text_part; twin n/a (the shipped sender never sends text/plain)", "P", "C22 not built");
}
{ // I-24 ran_at 24 h older than the zip -> C2
  const st = K.status(SAT.refreshAt - 24 * HOUR);
  const f = await fx({ ...SAT, worldOpts: { status: st } });
  judge("I-24", "C2", f, base.sat, { code: "C2.drift", note: "reported, nothing re-run" });
}
{ // I-28 "you both get a month" -> C5 (C8 Radar events and C7 unknown price: rehearsal_r3a_drills)
  const f = await fx({ ...SAT, facts: K.facts({ "purchase.month_line": true }) });
  judge("I-28", "C5", f, base.sat, { code: "C5.purchase_copy", twinOk: C5_TWIN, note: "C8 and C7.unknown_price halves: rehearsal_r3a_drills" });
}
{ // I-29 no Sunday record; a WAIT-only Sunday; inbox never; inbox backlog
  const none = await fx({ ...MONPRE, worldOpts: {} });
  judge("I-29 no Sunday", "mon_pre", none, base.monpre, { code: "mon_pre.sunday_missing" });
  check("I-29: a missing Sunday record mails the owner", none.mails.length === 1);
  const waitOnly = await fx({ ...MONPRE, worldOpts: { extra: { "rehearsal/log.json": { v: 1, mail: [],
    records: [{ date: "2026-10-04", mode: "sun", part: "core", trigger: "sched", run: "77", verdict: "WAIT", code: "WAIT.refresh_running" }] } } } });
  judge("I-29 WAIT-only Sunday", "mon_pre", waitOnly, base.monpre, { code: "mon_pre.sunday_wait_only" });
  const never = await fx({ ...SAT, worldOpts: { inbox: {} } });
  judge("I-29 inbox never", "C17", never, base.sat, { code: "C17.inbox_never" });
  const backlog = await fx({ ...SAT, worldOpts: { inbox: { last_live_run_at: "2026-10-03T18:00:00Z",
    last: { waiting: 2, oldest_hours: 80, roster_armed: true } } } });
  judge("I-29 inbox backlog", "C17", backlog, base.sat, { code: "C17.inbox_backlog" });
  check("I-29: backlog is NO-GO and never ackable", backlog.v === "NO-GO" && !R.isAckable("C17.inbox_backlog"));
}
{ // I-31 no /leads link -> C5 WARN; zero portal events is C19 (not built)
  const ok = base.sat.has("C5.no_leads_link");
  check("I-31: the shipped copy has no /leads link -> WARN C5.no_leads_link", ok);
  row("I-31", "C5", "WARN C5.no_leads_link; twin n/a (shipped copy)", "P", "C19 not built");
}
// I-02, I-04, I-13, I-16 and F13 are drilled in rehearsal_r3a_drills.test.mjs.
for (const [id, chk] of [["I-03", "C15"], ["I-07", "C15"], ["I-30", "C15"], ["I-06 seed", "C20"], ["I-08", "C16"],
  ["I-17", "C10"], ["I-25", "C11"], ["I-26", "C10,C12"], ["I-27", "C13"]]) row(id, chk, "not built", "not built", "R2b/R3b");

// ════════════════════════════════════════════════════════════════════════════
// false-alarm drills
// ════════════════════════════════════════════════════════════════════════════
const F = (id, ok, what, note = "") => { check(`${id}: ${what}`, ok); row(id, what.split(":")[0], ok ? "no alarm" : "ALARM", ok ? "Y" : "N", note); };
{ // F1 Tuesday 13:05Z mon-post backstop after a healthy Monday, Tuesday's refresh done 12:51Z
  const b = base.monpost;
  F("F1", b.v === "GO" && b.mails.length === 0 && b.rec.date === "2026-10-05",
    "mon-post: date Monday, PASS, no mail", "runner side: rehearsal_r3a_drills");
}
{ // F2 Tuesday backstop when Monday's mon-post already has a non-WAIT record
  const mp = monPost({ records: [{ date: "2026-10-05", mode: "mon-post", part: "core", trigger: "sched", run: "600", verdict: "GO", at: "2026-10-05T21:00:00Z" }] });
  const r = await fx(mp);
  F("F2", r.v === "SKIPPED" && r.mails.length === 0 && !r.rec.checks, "mon-post backstop: skipped");
}
{ // F3 mon-pre 10:00Z, no refresh, no send -> WAIT; a later workflow_run is not blocked
  const w = K.world({ now: at("2026-10-05T10:00:00Z"), subs: K.roster(3), refreshAt: at("2026-10-04T14:00:00Z"),
    log: [K.sendEntry(at("2026-09-28T14:00:00Z"), K.roster(3).map((s) => s.email))], extra: sundayRecord() });
  const a = await fx({ ...MONPRE, now: at("2026-10-05T10:00:00Z"), w,
    facts: K.facts({ "refresh.state": "none", "refresh.conclusion": "none", "refresh.shipped_min": [-1, -1, -1, -1] }) });
  // the refresh completes at 09:40... late: it ships at 11:10 and its workflow_run fires
  w.bucket.put("refresh-status.json", JSON.stringify(K.status(at("2026-10-05T11:12:00Z"))));
  for (const k of ["latest-weekly.zip", "latest-weekly.html", "latest-monthly.zip"]) {
    const o = w.store.get(k); o.uploaded = new Date(at("2026-10-05T11:10:00Z"));
  }
  const b = await fx({ ...MONPRE, now: at("2026-10-05T11:20:00Z"), w, trigger: "88001",
    facts: K.facts({ "refresh.shipped_min": [670, -1, -1, -1] }) });
  F("F3", a.v === "WAIT" && a.mails.length === 0 && b.v !== "WAIT" && b.v !== "SKIPPED",
    `mon-pre at 10:00Z: WAIT, 0 Resend calls, later workflow_run judged (${b.v})`);
}
{ // F4 mon-pre late, refresh in_progress, send not started -> WAIT
  const r = await fx({ ...MONPRE, now: at("2026-10-05T16:00:00Z"), facts: K.facts({ "refresh.state": "in_progress", "refresh.shipped_min": [-1, -1, -1, -1] }) });
  F("F4", r.v === "WAIT" && r.mails.length === 0, "mon-pre late with the refresh running: WAIT");
}
{ // F5 sat backstop with the refresh in_progress, then its workflow_run on a NO-GO world
  const w = K.world({ now: SAT.now, subs: K.roster(3), refreshAt: SAT.refreshAt,
    log: [K.sendEntry(at("2026-09-28T14:00:00Z"), K.roster(3).map((s) => s.email))] });
  const a = await fx({ ...SAT, w, facts: K.facts({ "refresh.state": "in_progress" }) });
  const bad = K.facts({ "refresh.conclusion": "failure", "refresh.ship_step": "skipped", "refresh.failed_at": "before_ship" });
  const b = await fx({ ...SAT, now: SAT.now + HOUR, w, trigger: "77001", facts: bad });
  const c = await fx({ ...SAT, now: SAT.now + 2 * HOUR, w, facts: bad }); // a later sched backstop
  F("F5", a.v === "WAIT" && b.v === "NO-GO" && a.mails.length + b.mails.length + c.mails.length === 1 && c.v === "SKIPPED",
    "sat backstop WAIT, then the workflow_run NO-GO: mails exactly once");
}
{ // F6 corrupt subscribers.json
  for (const [label, body] of [["truncated JSON", '[{"email":"hidden.person@example.com","na'], ["an object", '{"a":"hidden.person@example.com"}']]) {
    const w = K.world({ now: SUN.now, subs: null, refreshAt: SUN.refreshAt, extra: { "subscribers.json": body } });
    const r = await fx({ ...SUN, w, env: { REHEARSAL_SEEDS: "seed@example.com" } });
    const texts = r.x.responses.map((y) => y.text).join("");
    F(`F6 ${label}`, r.codes.includes("roster_unreadable") && ["C5", "C6", "C7"].every((id) => r.worst(id) === "NO-GO") &&
      r.mails.length === 1 && r.mails[0].to[0] === K.OWNER && r.mails[0].html.includes(R.ROSTER_UNREADABLE_TEXT) &&
      !texts.includes("@") && !r.mails[0].html.includes("hidden.person") && r.x.responses.every((y) => y.json.error === null),
      "corrupt roster: fixed codes, roster checks NO-GO, 0 seed sends, fixed owner text, no @ in any response");
  }
}
{ // F7 F pushed 2 min ago, no check-run anywhere -> C0 check-level WAIT, verdict unaffected
  const r = await fx({ ...SAT, facts: K.facts({ "c0.fn_state": "missing", "c0.fn_age_min": 2, "c0.head_state": "missing" }) });
  F("F7", r.worst("C0") === "WAIT" && r.has("C0.deploy_pending") && r.v === base.sat.v,
    "C0 deploy pending: check-level WAIT, verdict unchanged", "runner side: rehearsal_r3a_drills");
}
{ // F8 F 3 days old with success, HEAD bot commit 20 s old with no check-run -> C0 PASS
  const r = await fx({ ...SAT, facts: K.facts({ "c0.fn_state": "success", "c0.fn_age_min": 4320, "c0.head_state": "missing" }) });
  F("F8", r.worst("C0") === "PASS", "C0 with a fresh bot HEAD: PASS", "runner side: rehearsal_r3a_drills");
}
{ // F9 mon-post while weekly-feed is in_progress -> WAIT; the Tuesday backstop is not blocked
  const mp = monPost({ now: at("2026-10-05T14:05:00Z"),
    facts: K.facts({ "refresh.shipped_min": [580, -1, -1, -1], "send.state": "in_progress", "send.started_min": 840 }) });
  const w = K.world({ now: mp.now, subs: mp.subs, refreshAt: at("2026-10-05T09:40:00Z"), log: mp.log, ...mp.worldOpts });
  const a = await fx({ ...mp, w });
  const b = await fx({ ...monPost(), w });
  F("F9", a.v === "WAIT" && a.mails.length === 0 && b.v === "GO", "mon-post during the send: WAIT; Tuesday backstop judged");
}
{ // F10 late weekend backstops in a healthy world
  const sat = await fx({ now: at("2026-10-04T02:00:00Z"), mode: "sat", date: "2026-10-03", refreshAt: at("2026-10-03T14:00:00Z") });
  const sun = await fx({ now: at("2026-10-05T02:00:00Z"), mode: "sun", date: "2026-10-04", refreshAt: at("2026-10-04T14:00:00Z") });
  F("F10 sat", sat.rec.date === "2026-10-03" && sat.worst("C3") === "PASS" && sat.mails.length === 0,
    "late sat backstop: date kept, C3 PASS, 0 Resend calls");
  F("F10 sun", sun.rec.date === "2026-10-04" && sun.worst("C3") === "PASS" && sun.mails.length === 1 &&
    sun.mails[0].to[0] === K.OWNER && sun.mails[0].subject.startsWith("GO"),
    "late sun backstop: C3 PASS, exactly 1 mail to the owner, subject GO");
  // twin: the same late sun run with that day's refresh failed and Saturday's bundle in R2
  const twin = await fx({ now: at("2026-10-05T02:00:00Z"), mode: "sun", date: "2026-10-04", refreshAt: at("2026-10-03T14:00:00Z"),
    facts: K.facts({ "refresh.conclusion": "failure", "refresh.ship_step": "skipped", "refresh.failed_at": "before_ship" }) });
  check("F10 twin: that day's refresh failed -> NO-GO on C1", twin.v === "NO-GO" && twin.worst("C1") === "NO-GO", twin.v);
  row("F10 twin", "C1", `${twin.worst("C1")} (${twin.codes.join(",")})`, twin.worst("C1") === "NO-GO" ? "Y" : "N");
}
{ // F11 a new buyer since Monday
  const subs = K.roster(6, (s, i) => (i === 6 ? { ...s, since: "2026-09-30" } : s));
  const five = subs.slice(0, 5).map((s) => s.email);
  const log = [K.sendEntry(at("2026-09-28T14:00:00Z"), five)];
  // no key, through the Function
  const r = await fx({ ...SAT, subs, log });
  F("F11 no key", r.v !== "NO-GO" && r.mails.length === 0 && r.worst("C7") === "BLIND",
    "new buyer, no key: C7 BLIND no_key, no alarm mail");
  // with the key (pure C7; the same checks through the Stripe reads are in rehearsal_r3a_drills)
  const stripe = (subsArr) => ({ keyed: true, readable: true, subs: subsArr });
  const sub = (i, created, status = "active") => ({ id: "sub_TEST" + i, status, customer: "cus_TEST" + i, created,
    items: { data: [{ price: { id: "price_TEST_MP" } }] } });
  const S6 = [1, 2, 3, 4, 5].map((i) => sub(i, at("2026-08-01T00:00:00Z") / 1000)).concat(sub(6, at("2026-09-30T15:00:00Z") / 1000));
  const c7 = (rows, s) => R.checkC7({ roster: { ok: true, rows }, sendLog: log, sendLogOk: true, date: "2026-10-03", mode: "sat",
    now: SAT.now, stripe: s, priceIds: ["price_TEST_MP"] });
  const k = c7(subs, stripe(S6));
  const listed = k.some((x) => x.detail_private.some((l) => l === "New since Monday: buyer 6, first weekly Mon 10-05"));
  F("F11 key", !k.some((x) => x.result === "NO-GO") && listed, "new buyer, key: C7 PASS, \"New since Monday: buyer 6\" listed");
  const twinRows = subs.map((s, i) => (i === 5 ? { ...s, since: "2026-09-01" } : s));
  const tw = c7(twinRows, stripe(S6.slice(0, 5).concat(sub(6, at("2026-09-01T00:00:00Z") / 1000))));
  const twinOk = tw.some((x) => x.result === "NO-GO" && x.code === "C7.missed_recipient" && x.buyer_numbers.includes(6));
  check("F11 twin: row 6 since before the send and absent from M -> NO-GO", twinOk);
  row("F11 twin", "C7", twinOk ? "NO-GO C7.missed_recipient buyer 6" : "missed", twinOk ? "Y" : "N");
  // mon-post: a buyer who pays Monday 19:00Z after an 18:00Z send (since = that Monday)
  const mSubs = K.roster(4, (s, i) => (i === 4 ? { ...s, since: "2026-10-05" } : s));
  const mLog = [K.sendEntry(at("2026-10-05T18:00:00Z"), mSubs.slice(0, 3).map((s) => s.email))];
  const mp = monPost({ subs: mSubs, log: mLog, now: at("2026-10-05T20:30:00Z"),
    facts: K.facts({ "refresh.shipped_min": [580, -1, -1, -1], "send.state": "completed", "send.started_min": 1080 }),
    records: [{ date: "2026-10-05", mode: "mon-pre", part: "core", trigger: "sched", run: "500", verdict: "GO", at: "2026-10-05T11:30:00Z",
      bundle_etag: mLog[0].bundle_etag, rowset_sha256: mLog[0].bundle_rowset }] });
  const noKey = await fx(mp);
  F("F11 mon-post no key", noKey.v !== "NO-GO" && noKey.has("mon_post.new_same_day") && noKey.mails.length === 0,
    "same-day buyer after the send, no key: WARN mon_post.new_same_day, never NO-GO");
  const withKey = R.checkMonPost({ roster: { ok: true, rows: mSubs }, sendLog: mLog, sendLogOk: true, date: "2026-10-05",
    now: at("2026-10-05T20:30:00Z"), facts: R.validateRunnerFacts(mp.facts).facts,
    stripe: stripe([1, 2, 3].map((i) => sub(i, 1)).concat(sub(4, at("2026-10-05T19:00:00Z") / 1000))), priceIds: ["price_TEST_MP"],
    monPre: [{ bundle_etag: mLog[0].bundle_etag, rowset_sha256: mLog[0].bundle_rowset }], linksPersisted: 0 });
  F("F11 mon-post key", withKey.every((x) => x.result === "PASS") && withKey.some((x) => x.code === "mon_post.new_since_send"),
    "same-day buyer after the send, key: PASS");
}
{ // F12 cancellation since Monday
  const subs = K.roster(5, (s, i) => (i === 5 ? { ...s, active: false, cancelled: "2026-09-30" } : s));
  const log = [K.sendEntry(at("2026-09-28T14:00:00Z"), subs.map((s) => s.email))];
  const sub = (i) => ({ id: "sub_TEST" + i, status: "active", customer: "cus_TEST" + i, created: 1,
    items: { data: [{ price: { id: "price_TEST_MP" } }] } });
  const c7 = (S) => R.checkC7({ roster: { ok: true, rows: subs }, sendLog: log, sendLogOk: true, date: "2026-10-03", mode: "sat",
    now: SAT.now, stripe: { keyed: true, readable: true, subs: S }, priceIds: ["price_TEST_MP"] });
  const k = c7([1, 2, 3, 4].map(sub));
  F("F12", !k.some((x) => x.result === "NO-GO") && k.some((x) => x.detail_private.includes("Cancelled since Monday: buyer 5")),
    "cancelled since Monday, absent from S: C7 PASS, listed");
  const tw = c7([1, 2, 3, 4, 5].map(sub));
  const twinOk = tw.some((x) => x.result === "NO-GO" && x.detail_private.includes("buyer 5: in S, not in R"));
  check("F12 twin: Stripe still bills buyer 5 -> NO-GO \"in S, not in R\"", twinOk);
  row("F12 twin", "C7", twinOk ? "NO-GO C7.paid_not_served \"buyer 5: in S, not in R\"" : "missed", twinOk ? "Y" : "N");
  const r = await fx({ ...SAT, subs, log });
  F("F12 no key", r.v !== "NO-GO" && r.mails.length === 0, "cancelled since Monday through the Function (no key): no alarm");
}

// ════════════════════════════════════════════════════════════════════════════
// across every drill: mail lock, write set, leaks
// ════════════════════════════════════════════════════════════════════════════
{
  const w = K.world({ now: SAT.now, subs: K.roster(3), refreshAt: SAT.refreshAt });
  const r = await fx({ ...SAT, w, env: { REHEARSAL_MAIL: undefined }, facts: K.facts({ "refresh.state": "none", "refresh.conclusion": "none" }) });
  const mailRec = w.json("rehearsal/log.json").mail;
  check("6 REHEARSAL_MAIL unset: a NO-GO run makes 0 Resend calls and records mail off",
    r.v === "NO-GO" && r.mails.length === 0 && mailRec[0].result === "off");
}
const rosterEmails = new Set(K.roster(30).map((s) => s.email.toLowerCase()));
check("6 0 Resend calls to any roster email across every drill", rs.sent.every((m) => m.to.every((t) => !rosterEmails.has(t.toLowerCase()))));
check("6 every Resend call went to the owner", rs.sent.every((m) => m.to.length === 1 && m.to[0] === K.OWNER));
check("6 0 Resend calls in any run-level WAIT", waitMail.every((n) => n === 0) && waitMail.length >= 4);
const stray = worlds.flatMap((w) => w.writes().map((o) => o.key)).filter((k) => !k.startsWith("rehearsal/") &&
  !["refresh-status.json"].includes(k));
check("5 across every drill, persisted writes are only under rehearsal/", stray.length === 0, stray.join(","));
check("5 no drill persisted a dl/ or portal-access/ object", worlds.every((w) => w.writes().every((o) => !/^(dl|portal-access)\//.test(o.key))));
check("10 0 non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));

console.log("\nDRILL TABLE");
console.log("ID               | check      | result | Y/P/N | note");
for (const [id, c, r, y, n] of table) console.log(`${id.padEnd(16)} | ${c.padEnd(10)} | ${r} | ${y}${n ? " | " + n : ""}`);
done();
