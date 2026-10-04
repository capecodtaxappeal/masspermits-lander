// R2b (Extended tier): C10-C13, C15 in-Function, C19, C20 with the seed part
// and rehearsal-seed.js, C21. Their drills and negative twins, the seed-send
// locks, readAsset()'s path lock (acceptance 18 a'), and the write-set and
// leak checks for everything R2b adds (acceptance 5, 6, 7).
//
//   node functions/api/rehearsal_r2b.test.mjs
//
// Every network call goes to the throwing fetch stub. The Resend URL below is
// a fixture route: a call to it is recorded, never sent. env.ASSETS is a fake
// binding that serves two synthetic pages and records every call.

import * as R from "./_rehearsal.js";
import { makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub, fakeR2 } from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";
import * as Seed from "./rehearsal-seed.js";

const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
let resendDown = false;
const stub = makeFetchStub({
  [RESEND]: (u, init, rec) => (resendDown ? new Response("{}", { status: 500 }) : rs.handler(u, init, rec)),
  "https://api.stripe.com/*": () => ({ data: [], has_more: false }),
});
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const { check, done } = makeRunner("rehearsal_r2b.test.mjs");
const { HOUR, DAY } = K;
const at = K.at;
const L = await K.loadRehearsal();
const LEAK = /@|[0-9a-f]{32}|cus_|\b\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Ave|Avenue|Lane|Ln|Way|Drive|Dr)\b/;
const table = [];
const row = (id, chk, result, ynp, note = "") => table.push([id, chk, result, ynp, note]);
const allResponses = [];
const worlds = [];

// ── fakes ───────────────────────────────────────────────────────────────────
const CLEAN_PAGE = "<html><body><h1>MassPermits</h1><p>Weekly permit leads for contractors. " +
  "Build 640c8bca.</p><a href=\"/leads\">Your leads</a></body></html>";
function assets(pages = {}) {
  const calls = [];
  const serve = { "/index.html": CLEAN_PAGE, "/offer.html": CLEAN_PAGE, ...pages };
  return {
    calls,
    async fetch(req) {
      calls.push(req.url);
      const p = new URL(req.url).pathname;
      const v = serve[p];
      if (v && typeof v === "object") return new Response("", { status: v.status, headers: { location: "/" } });
      return v == null ? new Response("not found", { status: 404 }) : new Response(v, { status: 200 });
    },
  };
}

// ── a healthy world with every Extended field present ───────────────────────
const SAT = { now: at("2026-10-03T20:30:00Z"), date: "2026-10-03", refreshAt: at("2026-10-03T14:00:00Z") };
const SUN = { now: at("2026-10-04T20:30:00Z"), date: "2026-10-04", refreshAt: at("2026-10-04T14:00:00Z") };
const MON_SEND = at("2026-09-28T14:00:00Z");
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
function fullStatus(ranAt, date, over = {}) {
  const d0 = at(date + "T00:00:00Z");
  const st = K.status(ranAt);
  st.coverage = { live_sources: 39, expected_sources: 140, disclose: false, monthly_sources: ["Testville, MA"] };
  st.cadence = { "Testville, MA": "monthly" };
  st.source_newest = { boston: day(d0 - 1 * DAY), cambridge: day(d0 - 3 * DAY), "Testville, MA": day(d0 - 20 * DAY) };
  st.window_loss = { "Testville, MA": 0 };
  st.contracts = { ran: true, paid_blocks: 0, live: 5, attempted: 6, dead_status_rows: 0 };
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete st[k]; else st[k] = v; }
  return st;
}
// One dl/ event per buyer, the day after last Monday's send.
function events(subs, t = MON_SEND + 20 * HOUR, kind = "dl") {
  const o = {};
  subs.forEach((s, i) => {
    const key = `${kind}/${day(t)}/${t + i}-0000000${i}`;
    o[key] = { __r2: { customMetadata: kind === "dl" ? { t: s.token.slice(0, 8), k: "weekly", d: "d" }
      : { tok: s.token.slice(0, 8), ua: "desktop", st: "ok" } }, value: "" };
  });
  return o;
}
const SEED_OK = (sunday) => ({ [`rehearsal/seed-${sunday}.json`]: { run: 3, placement: "inbox", has_attachment: true } });

const SEED_TOKEN = "s".repeat(40);
async function seedPost(w, body, o = {}) {
  const headers = { "content-type": "application/json" };
  if (o.auth !== null) headers.authorization = o.auth ?? `Bearer ${SEED_TOKEN}`;
  const url = o.url ?? "https://masspermits.com/api/rehearsal-seed";
  const r = await Seed.onRequestPost({ request: new Request(url, { method: "POST", headers,
    body: typeof body === "string" ? body : JSON.stringify(body) }),
    env: { BUNDLES: w.bucket, REHEARSAL_SEED_TOKEN: o.secret === undefined ? SEED_TOKEN : o.secret } });
  const text = await r.text();
  allResponses.push({ part: "seed-route", text });
  return { status: r.status, text };
}
let runSeq = 5000;
async function fx(o) {
  clock.set(o.now);
  const subs = o.subs ?? K.roster(3);
  const w = o.w ?? K.world({
    now: o.now, subs, refreshAt: o.refreshAt,
    status: o.status ?? fullStatus(o.refreshAt, o.date, o.statusOver),
    log: o.log ?? [K.sendEntry(MON_SEND, (Array.isArray(subs) ? subs : []).map((s) => s.email),
      { coverage: { live_sources: o.mondayLive ?? 40 } })],
    extra: { ...(o.noEvents || !Array.isArray(subs) ? {} : events(subs)), ...(o.noReport ? {} : SEED_OK("2026-09-27")), ...o.extra },
  });
  worlds.push(w);
  const A = o.assets ?? assets(o.pages);
  const env = K.baseEnv(w.bucket, { ASSETS: A, REHEARSAL_R20_DONE: "2026-09-20", ...o.env });
  const before = rs.sent.length;
  const x = await K.runMode(L.mod, env, { mode: o.mode, date: o.date, trigger: o.trigger || "sched",
    run: o.run || String(++runSeq), body: o.facts ?? K.facts() });
  allResponses.push(...x.responses);
  const recs = w.json("rehearsal/log.json").records;
  const rec = recs.find((r) => r.part === "core");
  return { w, x, A, rec, recs, v: x.core.json.verdict, codes: x.core.json.codes, mails: rs.sent.slice(before),
    worst: (id) => rec && rec.checks && rec.checks[id],
    has: (code) => !!(rec && rec.findings.some((f) => f.split(" ")[1] === code)) };
}

// ════════════════════════════════════════════════════════════════════════════
// Healthy baselines: every Extended check PASSes
// ════════════════════════════════════════════════════════════════════════════
const satOk = await fx({ ...SAT, mode: "sat" });
for (const id of ["C10", "C11", "C12", "C13", "C15", "C19", "C20", "C21"]) {
  check(`healthy sat: ${id} PASS`, satOk.worst(id) === "PASS", satOk.worst(id) + " " + satOk.rec.findings.join("; "));
}
check("healthy sat: verdict unchanged by R2b (C7 no-key is the only blind), 0 mails",
  satOk.v === "GO, blind on 1" && satOk.mails.length === 0, satOk.v);
check("healthy sat: the two pages were read through ASSETS, once each, at the two literal paths",
  satOk.A.calls.join() === "https://masspermits.com/index.html,https://masspermits.com/offer.html", satOk.A.calls.join());
check("healthy sat: the core record keeps live_sources for C12's fallback", satOk.rec.live_sources === 39);

// ════════════════════════════════════════════════════════════════════════════
// Drills: fault fixture -> named check non-PASS; negative twin -> PASS
// ════════════════════════════════════════════════════════════════════════════
function judge(id, chk, fault, twin, code, note = "") {
  const hit = fault.has(code) && fault.worst(chk) !== "PASS";
  const quiet = twin.worst(chk) === "PASS";
  check(`${id}: ${chk} ${code} on the fault`, hit, fault.rec.findings.join("; "));
  check(`${id}: ${chk} twin PASS`, quiet, twin.rec.findings.join("; "));
  const res = fault.rec.findings.find((f) => f.split(" ")[1] === code) || fault.worst(chk);
  row(id, chk, `${res}; twin ${twin.worst(chk)}`, hit && quiet ? "Y" : "N", note);
}

{ // I-17 Boston newest 6 days -> C10
  const st = fullStatus(SAT.refreshAt, SAT.date);
  st.source_newest.boston = "2026-09-27";
  const f = await fx({ ...SAT, mode: "sat", status: st });
  judge("I-17", "C10", f, satOk, "C10.source_stale:boston");
  check("I-17: the stale code is ackable, and a valid ack lists it as Known open (no NO-GO)",
    R.isAckable("C10.source_stale:boston"));
  const acked = await fx({ ...SAT, mode: "sat", status: st,
    extra: { "rehearsal-ack.json": { "C10.source_stale:boston": "2026-10-10" } } });
  check("I-17 acked: C10.source_stale:boston is Known open, not in the response codes",
    !acked.codes.includes("C10.source_stale:boston") && acked.rec.findings.includes("NO-GO C10.source_stale:boston acked"));
  check("I-17: Boston 4 days old is still fresh (the limit is <= 4)", R.checkC10({ status: {
    source_newest: { boston: "2026-09-29" } }, date: "2026-10-03" })[0].result === "PASS");
}
{ // I-25 window_loss field -> C11 (reader only)
  const st = fullStatus(SAT.refreshAt, SAT.date, { window_loss: { "Testville, MA": 12 } });
  const f = await fx({ ...SAT, mode: "sat", status: st });
  judge("I-25", "C11", f, satOk, "C11.window_loss", "reader only");
  const absent = await fx({ ...SAT, mode: "sat", status: fullStatus(SAT.refreshAt, SAT.date, { window_loss: undefined }) });
  check("I-25: window_loss absent is BLIND, never PASS", absent.worst("C11") === "BLIND" && absent.has("C11.no_window_loss"));
  check("I-25: an Extended BLIND does not change the verdict", absent.v === satOk.v);
}
{ // I-26 dead and stale sources -> C10, C12
  const st = fullStatus(SAT.refreshAt, SAT.date);
  st.source_newest.cambridge = "2026-09-01";
  st.coverage.live_sources = 34;
  st.errors = { cambridge: "returned 0 rows" };
  st.source_health = { dead: ["Lowell"], failing: [], vanished: [], collapsed: [] };
  const f = await fx({ ...SAT, mode: "sat", status: st });
  judge("I-26", "C10", f, satOk, "C10.source_stale:cambridge");
  judge("I-26", "C12", f, satOk, "C12.sources_down");
  const r = R.checkC12({ status: st, sendLogOk: true, sendLog: [K.sendEntry(MON_SEND, ["x@example.com"],
    { coverage: { live_sources: 40 } })], date: SAT.date, mode: "sat", now: SAT.now });
  check("I-26: C12 lists the lost towns (errors and source_health), never an address",
    r[0].detail_private.join(" ").includes("lost: cambridge, lowell") && !/@/.test(r[0].detail_private.join(" ")),
    r[0].detail_private.join(" | "));
}
{ // I-09 live 23 vs 70 -> C12 (C3's half is in rehearsal_drills.test.mjs)
  const st = fullStatus(SAT.refreshAt, SAT.date);
  st.coverage.live_sources = 23;
  const f = await fx({ ...SAT, mode: "sat", status: st, mondayLive: 70 });
  judge("I-09", "C12", f, satOk, "C12.sources_down", "C3 half: rehearsal_drills");
  check("I-09: the digest line names 23 against 70 from last Monday",
    R.checkC12({ status: st, sendLogOk: true, sendLog: [K.sendEntry(MON_SEND, ["x@example.com"], { coverage: { live_sources: 70 } })],
      date: SAT.date, mode: "sat", now: SAT.now })[0].detail_private[0] === "live 23 against 70 (Monday 09-28)");
  // Fallback: Monday's log entry has no coverage (not disclosed): the previous rehearsal record's live_sources.
  const prev = { date: "2026-09-27", mode: "sun", part: "core", trigger: "sched", run: "4000", verdict: "GO",
    at: "2026-09-27T21:00:00Z", live_sources: 70 };
  const fb = await fx({ ...SAT, mode: "sat", status: st, log: [K.sendEntry(MON_SEND, K.roster(3).map((s) => s.email))],
    extra: { "rehearsal/log.json": { v: 1, records: [prev], mail: [] } } });
  check("I-09 fallback: no Monday coverage, previous rehearsal said 70 -> C12 NO-GO", fb.has("C12.sources_down"));
  const nb = await fx({ ...SAT, mode: "sat", log: [K.sendEntry(MON_SEND, K.roster(3).map((s) => s.email))] });
  check("C12 with no baseline at all is BLIND C12.no_baseline", nb.has("C12.no_baseline") && nb.worst("C12") === "BLIND");
}
{ // I-27 contracts.ran false, live > attempted -> C13
  const st = fullStatus(SAT.refreshAt, SAT.date, { contracts: { ran: false, paid_blocks: 0, live: 9, attempted: 6, dead_status_rows: 0 } });
  const f = await fx({ ...SAT, mode: "sat", status: st });
  judge("I-27", "C13", f, satOk, "C13.contracts_not_run");
  check("I-27: live > attempted is also reported", f.has("C13.live_over_attempted"));
  const u = R.checkC13({ status: { contracts: { ran: true, paid_blocks: 2, live: 1, attempted: 1, dead_status_rows: 3 } } });
  check("C13 unit: paid blocks and dead-status rows are NO-GO",
    u.map((r) => r.code).sort().join() === "C13.dead_status_rows,C13.paid_blocks");
  check("C13 unit: contracts absent is BLIND", R.checkC13({ status: {} })[0].code === "C13.no_contracts");
}
{ // I-30 roster email inside index.html -> C15 (and a token prefix inside offer.html)
  const subs = K.roster(3);
  const f = await fx({ ...SAT, mode: "sat", subs,
    pages: { "/index.html": CLEAN_PAGE.replace("</body>", `<!-- ${subs[1].email.toUpperCase()} --></body>`) } });
  judge("I-30", "C15", f, satOk, "C15.email_in_page");
  const t = await fx({ ...SAT, mode: "sat", subs,
    pages: { "/offer.html": CLEAN_PAGE.replace("</body>", `<a href="/x?t=${subs[2].token.slice(0, 8)}">x</a></body>`) } });
  check("I-30: a token prefix in offer.html is NO-GO C15.token_in_page", t.has("C15.token_in_page"));
  const enc = await fx({ ...SAT, mode: "sat", subs,
    pages: { "/index.html": CLEAN_PAGE.replace("</body>", subs[0].email.replace("@", "&#64;") + "</body>") } });
  check("I-30: an HTML-encoded @ is still found", enc.has("C15.email_in_page"));
  check("I-30: the response codes carry the code, never the address",
    f.codes.includes("C15.email_in_page") && !/@/.test(f.x.core.text));
  const lines = R.checkC15({ roster: { ok: true, rows: subs }, pages: { "/index.html": { ok: true, text: subs[1].email },
    "/offer.html": { ok: true, text: "" } } })[0].detail_private.join(" ");
  check("I-30: the digest names the buyer by number only", lines === "buyer 2: address in index.html", lines);
  const inactive = K.roster(3, (s, i) => (i === 3 ? { ...s, active: false } : s));
  const g = await fx({ ...SAT, mode: "sat", subs: inactive,
    pages: { "/index.html": CLEAN_PAGE + inactive[2].email } });
  check("C15: an INACTIVE buyer's address in a page is still NO-GO", g.has("C15.email_in_page"));
  const noAssets = await fx({ ...SAT, mode: "sat", assets: {} });
  check("C15: no ASSETS binding is BLIND for each page, never PASS",
    noAssets.worst("C15") === "BLIND" && noAssets.has("C15.page_unreadable"));
  const redirect = await fx({ ...SAT, mode: "sat", pages: { "/index.html": { status: 308 } } });
  check("C15: a redirect is BLIND C15.page_redirect (never followed)",
    redirect.has("C15.page_redirect") && redirect.A.calls.length === 2);
}
row("I-03", "C15", "see rehearsal_r3b", "Y", "runner half (workflow secret scan) built in R3b");
row("I-07", "C15", "see rehearsal_r3b", "Y", "runner half (route-home link) built in R3b");
{ // I-31 zero portal events -> C19 (the C5 half is in rehearsal_drills.test.mjs)
  const f = await fx({ ...SAT, mode: "sat", noEvents: true });
  judge("I-31", "C19", f, satOk, "C19.no_open", "C5 half: rehearsal_drills");
  check("I-31: C19.no_open is a WARN and ackable", f.worst("C19") === "WARN" && R.isAckable("C19.no_open"));
  const portal = await fx({ ...SAT, mode: "sat", noEvents: true, extra: events(K.roster(3), MON_SEND + 30 * HOUR, "portal-access") });
  check("I-31 twin: portal-access events alone pass C19", portal.worst("C19") === "PASS");
  const late = await fx({ ...SAT, mode: "sat", noEvents: true, extra: events(K.roster(3), MON_SEND + 80 * HOUR) });
  check("C19: an event 80 h after the send is outside the window -> WARN", late.has("C19.no_open"));
  const other = K.roster(3).map((s) => ({ ...s, token: "f".repeat(32) }));
  const wrong = await fx({ ...SAT, mode: "sat", noEvents: true, extra: events(other) });
  check("C19: another token's events do not count", wrong.has("C19.no_open"));
  const opsBefore = wrong.w.ops.filter((o) => o.op === "get" && /^(dl|portal-access)\//.test(o.key)).length;
  check("C19: no dl/ or portal-access/ object body is ever read (list metadata only)", opsBefore === 0);
  const lists = satOk.w.ops.filter((o) => o.op === "list").map((o) => o.key);
  check("C19: it lists only dl/<day>/ and portal-access/<day>/ prefixes",
    lists.length > 0 && lists.every((k) => /^(dl|portal-access)\/\d{4}-\d{2}-\d{2}\/$/.test(k)), lists.join(","));
  // A buyer who joined on Friday: the purchase window (to Monday 00:00Z + 72 h) is still open.
  const plan = R.c19Plan({ roster: { ok: true, rows: [K.subscriber(1, { since: "2026-10-02" })] }, sendLogOk: true,
    sendLog: [K.sendEntry(MON_SEND, ["x@example.com"])], date: SAT.date, mode: "sat", now: SAT.now });
  const r = R.checkC19({ roster: { ok: true }, plan, events: [], now: SAT.now });
  check("C19: a buyer who joined after the send, window still open, is not judged yet",
    r.every((x) => x.result === "PASS") && r.some((x) => x.code === "C19.pending"));
  check("C19: a failed list is BLIND C19.list_failed",
    R.checkC19({ roster: { ok: true }, plan, events: null, now: SAT.now })[0].code === "C19.list_failed");
}
{ // C21
  const f = await fx({ ...SAT, mode: "sat", env: { REHEARSAL_R20_DONE: undefined } });
  judge("C21", "C21", f, satOk, "C21.unattested");
  const z = await fx({ ...SAT, mode: "sat", env: { REHEARSAL_R20_DONE: " " } });
  check("C21: a whitespace attestation does not count", z.has("C21.unattested"));
  check("C21.unattested is WARN and ackable", f.worst("C21") === "WARN" && R.isAckable("C21.unattested"));
}

// ════════════════════════════════════════════════════════════════════════════
// C20: the seed send (sun, part=seed) and rehearsal-seed.js
// ════════════════════════════════════════════════════════════════════════════
const SEEDS = { REHEARSAL_SEEDS: " Seed.One@Example.com ,seed.two@example.com" };
const seedMails = (m) => m.filter((x) => x.subject && x.subject.includes("(preview"));
{
  const r = await fx({ ...SUN, mode: "sun", env: SEEDS });
  const s = seedMails(r.mails);
  check("C20 sun: exactly one seed email per seed, each to that seed alone",
    s.length === 2 && s.map((m) => m.to.join()).sort().join() === "seed.one@example.com,seed.two@example.com");
  check("C20 sun: subject is the weekly subject + \" (preview 1004)\"",
    s.every((m) => m.subject === "Your weekly MassPermits leads (preview 1004)"), s.map((m) => m.subject).join());
  check("C20 sun: the real latest-weekly.zip is attached, named as weekly-send.js names it",
    s.every((m) => m.attachments && m.attachments.length === 1 && m.attachments[0].filename === "MassPermits-weekly-2026-10-04.zip" &&
      Buffer.from(m.attachments[0].content, "base64").equals(Buffer.from(K.world({ now: SUN.now }).store.get("latest-weekly.zip").bytes))));
  check("C20 sun: the synthetic subscriber \"Rehearsal\" with the disabled token, never a roster token",
    s.every((m) => m.html.includes("Hi Rehearsal,") && m.html.includes("t=REHEARSAL-LINK-DISABLED") &&
      !K.roster(3).some((b) => m.html.includes(b.token))));
  check("C20 sun: C20 PASS C20.sent; the owner digest is the only other mail",
    r.worst("C20") === "PASS" && r.rec.findings.every((f) => !f.includes("C20")) &&
    r.mails.filter((m) => !m.subject.includes("(preview")).every((m) => m.to.join() === K.OWNER));
  check("C20 sun: the seed record says C20.sent", r.recs.find((x) => x.part === "seed").code === "C20.sent");
  check("C20 sun: the digest still starts GO", r.mails.some((m) => m.to.join() === K.OWNER && m.subject.startsWith("GO")));
  row("C20 sent", "C20", "PASS C20.sent, 1 mail per seed with the zip", "Y");

  // Once per date: a later sun run (the backstop, a dispatch) sends no seed again.
  const again = await fx({ ...SUN, mode: "sun", env: SEEDS, w: r.w, trigger: "dispatch" });
  check("C20 once per date: a second sun run makes 0 seed calls, records C20.already_sent",
    seedMails(again.mails).length === 0 && again.recs.find((x) => x.part === "seed").code === "C20.already_sent");
  const third = await fx({ ...SUN, mode: "sun", env: SEEDS, w: r.w, trigger: "dispatch" });
  check("C20 once per date: a third run still sends nothing (already_sent keeps blocking)", seedMails(third.mails).length === 0);
}
{ // I-06 seed "spam" -> C20, through rehearsal-seed.js
  clock.set(at("2026-09-28T09:00:00Z")); // Monday: the Sunday at or before is 09-27
  const w = K.world({ now: SAT.now, subs: K.roster(3), status: fullStatus(SAT.refreshAt, SAT.date),
    log: [K.sendEntry(MON_SEND, K.roster(3).map((s) => s.email), { coverage: { live_sources: 40 } })], extra: events(K.roster(3)) });
  const post = await seedPost(w, { run: 3, placement: "spam", has_attachment: true });
  check("I-06: rehearsal-seed.js stores the report at rehearsal/seed-2026-09-27.json", post.status === 200 &&
    JSON.stringify(w.json("rehearsal/seed-2026-09-27.json")) === '{"run":3,"placement":"spam","has_attachment":true}');
  const f = await fx({ ...SAT, mode: "sat", w });
  judge("I-06 seed", "C20", f, satOk, "C20.seed_spam", "mon-post half: rehearsal_drills");
  const miss = R.checkC20({ mode: "sat", report: { date: "2026-09-27", placement: "missing", has_attachment: false } });
  check("I-06: a missing seed is WARN C20.seed_missing", miss[0].code === "C20.seed_missing" && miss[0].result === "WARN");
  const noZip = R.checkC20({ mode: "sat", report: { date: "2026-09-27", placement: "inbox", has_attachment: false } });
  check("C20: inbox without the zip is WARN C20.seed_no_attachment", noZip[0].code === "C20.seed_no_attachment");
  const none = await fx({ ...SAT, mode: "sat", noReport: true });
  check("C20: no report is BLIND C20.no_report, verdict unchanged", none.has("C20.no_report") && none.v === satOk.v);
}
{ // failed send: WARN, never retried
  resendDown = true;
  const r = await fx({ ...SUN, mode: "sun", env: SEEDS });
  resendDown = false;
  check("C20 failed: WARN C20.seed_send_failed and C18.mail_failed in the seed part's codes",
    r.has("C20.seed_send_failed") && r.worst("C20") === "WARN" &&
    r.x.responses.find((x) => x.part === "seed").json.codes.includes("C18.mail_failed"));
  const before = stub.to("api.resend.com").length;
  const again = await fx({ ...SUN, mode: "sun", env: SEEDS, w: r.w, trigger: "dispatch" });
  check("C20 failed: a later sun run does not retry the seed send (0 seed calls)",
    stub.to("api.resend.com").slice(before).every((c) => !String(c.body).includes("(preview")) &&
    again.recs.find((x) => x.part === "seed").code === "C20.already_sent");
  row("C20 failed", "C20", "WARN C20.seed_send_failed, not retried", "Y");
}
{ // acceptance 6: a seed equal to a roster email refuses the seed send, NO-GO
  const subs = K.roster(3, (s, i) => (i === 2 ? { ...s, email: "Seed.One@Example.com", active: false } : s));
  const r = await fx({ ...SUN, mode: "sun", subs, env: SEEDS });
  check("6 a seed equal to an (inactive) roster email: 0 seed sends, C20 NO-GO C20.seed_is_roster",
    seedMails(r.mails).length === 0 && r.has("C20.seed_is_roster") && r.codes.includes("C20.seed_is_roster") && r.v === "NO-GO");
  row("seed = roster", "C20", "NO-GO C20.seed_is_roster, 0 seed sends", "Y");
  const bad = await fx({ ...SUN, mode: "sun", subs: "{truncated \"a@example.com\"", env: SEEDS });
  check("6 unreadable roster: 0 seed sends, C20 NO-GO roster_unreadable, no @ in any response",
    seedMails(bad.mails).length === 0 && bad.rec.findings.includes("NO-GO roster_unreadable") &&
    bad.x.responses.every((x) => !x.text.includes("@")));
  const off = await fx({ ...SUN, mode: "sun", env: { ...SEEDS, REHEARSAL_MAIL: undefined } });
  const offRec = off.w.json("rehearsal/log.json").mail.filter((m) => m.kind === "seed");
  check("6 REHEARSAL_MAIL unset: 0 seed calls, each seed recorded mail off, C20 PASS (never a finding)",
    off.mails.length === 0 && offRec.length === 2 && offRec.every((m) => m.result === "off") && off.worst("C20") === "PASS");
  const today = new Date(SUN.now).toISOString().slice(0, 10);
  const three = Array.from({ length: 3 }, (_, i) => ({ day: today, kind: "seed", run: "1", result: "sent", at: new Date(SUN.now - i * HOUR).toISOString() }));
  const capped = await fx({ ...SUN, mode: "sun", env: SEEDS, extra: { "rehearsal/log.json": { v: 1, records: [], mail: three } } });
  check("6 cap: 3 seed attempts already today -> 0 seed calls, C20 WARN C20.seed_capped, C18.mail_capped in the seed codes",
    seedMails(capped.mails).length === 0 && capped.has("C20.seed_capped") &&
    capped.x.responses.find((x) => x.part === "seed").json.codes.includes("C18.mail_capped"));
  const none = await fx({ ...SUN, mode: "sun" });
  check("C20 with no seeds configured: BLIND C20.no_seeds, 0 seed calls, verdict unchanged",
    none.has("C20.no_seeds") && seedMails(none.mails).length === 0 && none.v === "GO, blind on 1");
  const dry = await fx({ ...SAT, mode: "dry", env: SEEDS });
  check("dry: C20 renders (C20.render_ok) and sends nothing, even with seeds set",
    dry.mails.length === 0 && dry.rec.checks.C20 === "PASS" && !dry.recs.some((x) => x.part === "seed"));
  const sentBefore = rs.sent.length;
  const seedInSat = await L.mod.onRequestPost({ request: new Request(
    "https://masspermits.com/api/rehearsal?mode=sat&part=seed&page=0&date=2026-10-03&trigger=dispatch&run=77",
    { method: "POST", body: JSON.stringify(K.facts()) }), env: K.baseEnv(K.world({ now: SAT.now }).bucket, SEEDS) });
  check("C20: part=seed outside sun sends nothing", seedInSat.status === 200 && rs.sent.length === sentBefore);
}

// ════════════════════════════════════════════════════════════════════════════
// rehearsal-seed.js
// ════════════════════════════════════════════════════════════════════════════
{
  clock.set(at("2026-10-07T15:00:00Z")); // a Wednesday
  const good = { run: 5, placement: "inbox", has_attachment: true };
  let w = fakeR2({});
  let r = await seedPost(w, good, { secret: "" });
  check("seed route: REHEARSAL_SEED_TOKEN unset -> 404, 0 R2 ops", r.status === 404 && w.ops.length === 0);
  w = fakeR2({});
  for (const [label, auth] of [["no header", null], ["wrong token", "Bearer " + "t".repeat(40)],
    ["a prefix of the token", "Bearer " + SEED_TOKEN.slice(0, 39)], ["the token plus one", `Bearer ${SEED_TOKEN}x`],
    ["not Bearer", `Basic ${SEED_TOKEN}`]]) {
    r = await seedPost(w, good, { auth });
    check(`seed route: ${label} -> 401 {ok:false}, 0 R2 ops`, r.status === 401 && r.text === '{"ok":false}' && w.ops.length === 0);
  }
  r = await seedPost(w, good);
  check("seed route: a good report -> 200 {ok:true}", r.status === 200 && r.text === '{"ok":true}');
  check("seed route: date = the most recent Sunday at or before the Function's clock (Wed 10-07 -> 10-04)",
    w.writes().map((o) => o.key).join() === "rehearsal/seed-2026-10-04.json");
  check("seed route: stores exactly {run, placement, has_attachment}",
    JSON.stringify(w.json("rehearsal/seed-2026-10-04.json")) === '{"run":5,"placement":"inbox","has_attachment":true}');
  // A body and a query that try to name another date or key.
  w = fakeR2({});
  r = await seedPost(w, { ...good, date: "2026-01-04", key: "subscribers.json", "rehearsal/seed-2026-01-04.json": 1 },
    { url: "https://masspermits.com/api/rehearsal-seed?date=2026-01-04&key=subscribers.json" });
  check("5 seed route: a body/query naming another date or key still writes ONLY rehearsal/seed-2026-10-04.json, unknown keys dropped",
    r.status === 200 && w.writes().map((o) => o.key).join() === "rehearsal/seed-2026-10-04.json" &&
    Object.keys(w.json("rehearsal/seed-2026-10-04.json")).join() === "run,placement,has_attachment");
  for (const [label, body] of [["run as a string", { ...good, run: "5" }], ["run 49", { ...good, run: 49 }], ["run -1", { ...good, run: -1 }],
    ["run 1.5", { ...good, run: 1.5 }], ["placement \"junk\"", { ...good, placement: "junk" }],
    ["has_attachment \"yes\"", { ...good, has_attachment: "yes" }], ["a field missing", { run: 1, placement: "inbox" }],
    ["an array", [good]], ["not JSON", "{run:"], ["over 256 bytes", { ...good, pad: "x".repeat(260) }]]) {
    w = fakeR2({});
    r = await seedPost(w, body);
    check(`seed route: ${label} -> 400 {ok:false}, nothing written`, r.status === 400 && r.text === '{"ok":false}' &&
      w.writes().length === 0);
  }
  check("seed route: on a Sunday the date is that Sunday",
    (clock.set(at("2026-10-04T23:59:00Z")), Seed.sundayOf(Date.now())) === "2026-10-04" &&
    (clock.set(at("2026-10-05T00:00:00Z")), Seed.sundayOf(Date.now())) === "2026-10-04" &&
    (clock.set(at("2026-10-11T00:00:00Z")), Seed.sundayOf(Date.now())) === "2026-10-11");
  const fail = fakeR2({}, { failPut: () => true });
  clock.set(at("2026-10-07T15:00:00Z"));
  r = await seedPost(fail, good);
  check("seed route: a failed put is 500 {ok:false}", r.status === 500 && r.text === '{"ok":false}');
}

// ════════════════════════════════════════════════════════════════════════════
// readAsset (acceptance 18 a')
// ════════════════════════════════════════════════════════════════════════════
{
  for (const p of ["/api/x", "index.html", "/index.html?x", "//evil.example/", "/offer", "/", "/index.html ", undefined,
    new String("/index.html"), "/INDEX.HTML", "https://evil.example/index.html"]) {
    const A = assets();
    let threw = false;
    try { await L.mod.readAsset({ ASSETS: A }, p); } catch { threw = true; }
    check(`18a' readAsset(${JSON.stringify(String(p))}) throws with 0 ASSETS calls`, threw && A.calls.length === 0);
  }
  const A = assets();
  const r = await L.mod.readAsset({ ASSETS: A }, "/index.html");
  const o = await L.mod.readAsset({ ASSETS: A }, "/offer.html");
  check("18a' readAsset(\"/index.html\") and (\"/offer.html\") reach ASSETS once each, same-origin, no other host",
    r.status === 200 && o.status === 200 &&
    A.calls.join() === "https://masspermits.com/index.html,https://masspermits.com/offer.html");
}

// ════════════════════════════════════════════════════════════════════════════
// across every R2b run: write set, mail lock, leaks, no network
// ════════════════════════════════════════════════════════════════════════════
const stray = worlds.flatMap((w) => w.writes().map((o) => o.key)).filter((k) => !k.startsWith("rehearsal/"));
check("5 across every R2b run, persisted writes are only under rehearsal/", stray.length === 0, stray.join(","));
check("5 no R2b run persisted a dl/ or portal-access/ object",
  worlds.every((w) => w.writes().every((o) => !/^(dl|portal-access)\//.test(o.key))));
const rosterEmails = new Set(K.roster(30).map((s) => s.email.toLowerCase()));
check("6 0 Resend calls to any roster email across every R2b run",
  rs.sent.every((m) => m.to.every((t) => !rosterEmails.has(t.toLowerCase()))));
check("6 every Resend call went to the owner or a counted seed, one recipient each",
  rs.sent.every((m) => m.to.length === 1 && ["owner@example.com", "seed.one@example.com", "seed.two@example.com"].includes(m.to[0])));
const leaky = allResponses.filter((x) => LEAK.test(x.text));
check("7 no R2b response (rehearsal.js or rehearsal-seed.js) carries @, 32-hex, cus_ or a street", leaky.length === 0,
  leaky.map((x) => x.text).join(" | "));
const shapes = allResponses.filter((x) => x.part !== "seed-route" && x.status !== 401)
  .filter((x) => Object.keys(JSON.parse(x.text)).sort().join() !== "codes,error,more,ok,verdict");
check("7 every rehearsal.js response has exactly ok, verdict, more, codes, error", shapes.length === 0);
check("7 every rehearsal-seed.js response is exactly {ok}",
  allResponses.filter((x) => x.part === "seed-route").every((x) => /^\{"ok":(true|false)\}$/.test(x.text)));
check("10 0 non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
check("10 R2b's outbound hosts are a subset of {api.resend.com, api.stripe.com}",
  stub.calls.every((c) => ["api.resend.com", "api.stripe.com"].includes(new URL(c.url).host)));
check("the kit loaded the shipped files byte for byte", L.byteIdentical());

console.log("\nDRILL TABLE (R2b)");
console.log("ID               | check      | result | Y/P/N | note");
for (const [id, c, r, y, n] of table) console.log(`${id.padEnd(16)} | ${c.padEnd(10)} | ${r} | ${y}${n ? " | " + n : ""}`);
done();
