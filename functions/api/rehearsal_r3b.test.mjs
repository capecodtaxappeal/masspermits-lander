// R3b, the Function side: C15's runner half (I-03, I-07, the feed-log
// emails), C22 (I-23's DNS half) and renewals (I-13's past_due half), through
// the whole rehearsal.js the way the caller drives it; plus an end-to-end run
// where the facts come from the runner scripts themselves (c15.mjs, c22.mjs
// and facts.mjs over fixture logs), and the write-set, mail-lock and leak
// checks for everything R3b adds (acceptance 5, 6, 7).
//
//   node functions/api/rehearsal_r3b.test.mjs
//
// Every network call goes to the throwing fetch stub (Resend and Stripe are
// fixture routes). No DNS query is made: c22.mjs gets an injected resolver.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub } from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";
import * as G from "../../test/rehearsal/r3a_fixtures.mjs";
import * as R from "./_rehearsal.js";
import * as Fa from "../../scripts/rehearsal/facts.mjs";
import * as C15 from "../../scripts/rehearsal/c15.mjs";
import * as C22 from "../../scripts/rehearsal/c22.mjs";

const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
let acct = G.healthyStripe();
const sw = G.stripeWorld(() => acct);
const stub = makeFetchStub({ [RESEND]: rs.handler, ...sw.routes });
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const { check, done } = makeRunner("rehearsal_r3b.test.mjs");
const L = await K.loadRehearsal();
const { DAY } = K;
const at = K.at;
const LEAK = /@|[0-9a-f]{32}|cus_|\b\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Ave|Avenue|Lane|Ln|Way|Drive|Dr)\b/;
const table = [];
const row = (id, chk, result, ynp, note = "") => table.push([id, chk, result, ynp, note]);
const responses = [];
const worlds = [];
const unix = (s) => Math.floor(at(s) / 1000);

const PAGE = "<html><body><p>Weekly permit leads.</p><a href=\"/leads\">Your leads</a></body></html>";
const ASSETS = { async fetch() { return new Response(PAGE, { status: 200 }); } };
const SAT = { now: at("2026-10-03T20:30:00Z"), mode: "sat", date: "2026-10-03", refreshAt: at("2026-10-03T14:00:00Z") };
const SUN = { now: at("2026-10-04T20:30:00Z"), mode: "sun", date: "2026-10-04", refreshAt: at("2026-10-04T14:00:00Z") };

let runSeq = 9000;
async function fx(o) {
  clock.set(o.now);
  const subs = o.subs ?? K.roster(3);
  acct = o.stripe ?? G.healthyStripe(subs.map((_, k) => k + 1));
  const w = K.world({ now: o.now, subs, refreshAt: o.refreshAt,
    log: [K.sendEntry(at("2026-09-28T14:00:00Z"), subs.filter((s) => s.active !== false).map((s) => s.email))],
    extra: o.extra });
  worlds.push(w);
  const before = rs.sent.length;
  const env = K.baseEnv(w.bucket, { ASSETS, REHEARSAL_R20_DONE: "2026-09-20", ...(o.key === false ? {} : G.STRIPE_ENV), ...o.env });
  const x = await K.runMode(L.mod, env, { mode: o.mode, date: o.date, run: String(++runSeq), body: o.facts ?? K.facts(o.over || {}) });
  responses.push(...x.responses);
  const rec = w.json("rehearsal/log.json").records.find((r) => r.part === "core");
  return { w, x, rec, v: x.core.json.verdict, codes: x.core.json.codes, mails: rs.sent.slice(before),
    worst: (id) => rec && rec.checks && rec.checks[id],
    has: (code) => !!(rec && rec.findings.some((f) => f.split(" ")[1] === code)) };
}
function judge(id, chk, fault, twin, code, note = "") {
  const hit = fault.has(code) && fault.worst(chk) !== "PASS";
  const quiet = twin.worst(chk) === "PASS";
  check(`${id}: ${chk} ${code} on the fault`, hit, fault.rec.findings.join("; "));
  check(`${id}: ${chk} twin PASS`, quiet, twin.rec.findings.join("; "));
  const found = fault.rec.findings.find((f) => f.split(" ")[1] === code) || fault.worst(chk);
  row(id, chk, `${found}; twin ${twin.worst(chk)}`, hit && quiet ? "Y" : "N", note);
}

// ════════════════════════════════════════════════════════════════════════════
// Healthy keyed baselines: C15 (both halves), C22 and renewals PASS
// ════════════════════════════════════════════════════════════════════════════
const satOk = await fx({ ...SAT });
for (const id of ["C15", "C22", "renewals"]) {
  check(`healthy keyed sat: ${id} PASS`, satOk.worst(id) === "PASS", satOk.worst(id) + " " + satOk.rec.findings.join("; "));
}
check("healthy keyed sat: verdict GO, 0 mails (R3b adds no alarm to a healthy world)",
  satOk.v === "GO" && satOk.mails.length === 0, satOk.v + " " + satOk.rec.findings.join("; "));
const sunOk = await fx({ ...SUN });
check("healthy keyed sun: GO, exactly one mail, to the owner", sunOk.v === "GO" && sunOk.mails.length === 1 &&
  sunOk.mails[0].to.join() === K.OWNER);
check("healthy sun digest: no \"Not built yet\" line (C22 is built)", !/Not built yet/.test(sunOk.mails[0].html));
check("R.NOT_BUILT is empty", Array.isArray(R.NOT_BUILT) && R.NOT_BUILT.length === 0);

// ════════════════════════════════════════════════════════════════════════════
// Drills
// ════════════════════════════════════════════════════════════════════════════
{ // I-03 token string in a workflow -> C15
  const f = await fx({ ...SAT, over: { "c15.workflow_tokens": 1 } });
  judge("I-03", "C15", f, satOk, "C15.token_in_workflow", "runner scan of .github/workflows");
  check("I-03: NO-GO, and the code is in the response", f.v === "NO-GO" && f.codes.includes("C15.token_in_workflow"));
  check("I-03: a token in a workflow is not ackable", !R.isAckable("C15.token_in_workflow"));
  const acked = await fx({ ...SAT, over: { "c15.workflow_tokens": 1 },
    extra: { "rehearsal-ack.json": { "C15.token_in_workflow": "2026-10-10" } } });
  check("I-03: an ack for it is ignored (still NO-GO)", acked.v === "NO-GO" && acked.codes.includes("C15.token_in_workflow"));
}
{ // I-07 no route-home link -> C15
  const f = await fx({ ...SAT, over: { "c15.route_home": false } });
  judge("I-07", "C15", f, satOk, "C15.no_route_home", "WARN; verdict stays GO");
  check("I-07: WARN, verdict GO", f.worst("C15") === "WARN" && f.v === "GO");
}
{ // C15.feed_log_emails -> NO-GO, ackable
  const f = await fx({ ...SAT, over: { "c15.feed_log_emails": 7 } });
  judge("C15 feed log", "C15", f, satOk, "C15.feed_log_emails", "ackable");
  check("C15 feed log: NO-GO, mailed on sat", f.v === "NO-GO" && f.codes.includes("C15.feed_log_emails") && f.mails.length === 1);
  check("C15 feed log: the digest gives the count, never an address", /7 email-shaped string/.test(f.mails[0].html) &&
    !/testperson/.test(f.mails[0].html));
  const acked = await fx({ ...SAT, over: { "c15.feed_log_emails": 7 },
    extra: { "rehearsal-ack.json": { "C15.feed_log_emails": "2026-10-20" } } });
  check("C15 feed log acked: Known open, not in the codes, verdict GO", acked.v === "GO" &&
    !acked.codes.includes("C15.feed_log_emails") && acked.rec.findings.includes("NO-GO C15.feed_log_emails acked"));
  const unread = await fx({ ...SAT, over: { "c15.feed_log_emails": -1 } });
  check("C15 feed log unreadable (-1): BLIND C15.feed_log_unread, verdict unchanged",
    unread.has("C15.feed_log_unread") && unread.worst("C15") === "BLIND" && unread.v === "GO");
  const rl = await fx({ ...SAT, over: { api: "rate_limited", "c15.feed_log_emails": 3 } });
  check("C15 feed log with api rate_limited: BLIND C15.feed_log_actions_api, never judged",
    rl.has("C15.feed_log_actions_api") && !rl.has("C15.feed_log_emails"));
}
{ // the rest of the runner scan
  const sec = await fx({ ...SAT, over: { "c15.secrets": 2 } });
  judge("C15 secrets", "C15", sec, satOk, "C15.secret_in_repo");
  const priv = await fx({ ...SAT, over: { "c15.private_files": 1 } });
  judge("C15 private file", "C15", priv, satOk, "C15.private_file_in_repo");
  const ign = await fx({ ...SAT, over: { "c15.ignore_missing": 1 } });
  judge("C15 ignore rules", "C15", ign, satOk, "C15.ignore_rules", "WARN");
  const gone = await fx({ ...SAT, over: { "c15.secrets": undefined } });
  check("C15: a scan fact absent -> BLIND C15.schema, never PASS", gone.has("C15.schema") && gone.worst("C15") === "BLIND");
  const wrong = await fx({ ...SAT, over: { "c15.route_home": "yes" } });
  check("C15: a scan fact of the wrong type is dropped -> BLIND C15.schema", wrong.has("C15.schema"));
  const failed = await fx({ ...SAT, over: { "c15.secrets": -1, "c15.workflow_tokens": -1, "c15.private_files": -1,
    "c15.ignore_missing": -1, "c15.route_home": false } });
  check("C15: the scan's blind facts (-1) -> BLIND C15.scan_failed, not a route-home WARN",
    failed.has("C15.scan_failed") && !failed.has("C15.no_route_home"));
}
{ // I-23 DMARC changed -> C22 WARN (the C5 half is in rehearsal_drills.test.mjs)
  const f = await fx({ ...SAT, over: { "c22.dmarc": "changed" } });
  judge("I-23", "C22", f, satOk, "C22.dmarc_changed", "WARN; C5 half: rehearsal_drills");
  check("I-23: WARN only, verdict GO, no sat mail", f.worst("C22") === "WARN" && f.v === "GO" && f.mails.length === 0);
  const miss = await fx({ ...SAT, over: { "c22.dkim": "missing" } });
  check("C22: a DKIM record missing -> WARN C22.dkim_missing", miss.has("C22.dkim_missing") && miss.worst("C22") === "WARN");
  const unset = await fx({ ...SAT, over: { "c22.dmarc": "unset", "c22.spf": "unset", "c22.dkim": "unset", "c22.mx": "unset" } });
  check("C22: the delivered placeholder baseline -> one BLIND C22.baseline_unset, verdict unchanged",
    unset.rec.findings.filter((x) => x.includes("C22")).join() === "BLIND C22.baseline_unset" && unset.v === "GO");
  const err = await fx({ ...SAT, over: { "c22.mx": "error" } });
  check("C22: a failed lookup -> BLIND C22.mx_error", err.has("C22.mx_error"));
  const none = await fx({ ...SAT, over: { c22: undefined } });
  check("C22: no c22 facts at all -> one BLIND C22.schema line", none.rec.findings.filter((x) => x.includes("C22")).join() === "BLIND C22.schema");
}
{ // I-13's renewals half: past_due in Stripe, no payment_failing on the row
  const subs = K.roster(3);
  const stripe = G.healthyStripe([1, 2, 3], { subs: [G.stripeSub(1), G.stripeSub(2, { status: "past_due" }), G.stripeSub(3)] });
  const f = await fx({ ...SAT, subs, stripe });
  judge("I-13 renewals", "renewals", f, satOk, "renewals.past_due_unflagged", "C8 half: rehearsal_r3a_drills");
  const flagged = K.roster(3, (s, i) => (i === 2 ? { ...s, payment_failing: "2026-10-01" } : s));
  const t = await fx({ ...SAT, subs: flagged, stripe });
  check("I-13 renewals twin: the row carries payment_failing -> PASS, listed with its date",
    t.worst("renewals") === "PASS" && R.checkRenewals({ roster: { ok: true, rows: flagged }, stripe: { keyed: true, readable: true, subs: stripe.subs },
      priceIds: [G.MP_PRICE], now: SAT.now }).some((r) => r.detail_private.join() === "buyer 2: past_due, payment_failing since 10-01"));
  check("I-13 renewals: the WARN names buyer 2 by number only", f.rec.findings.includes("WARN renewals.past_due_unflagged") &&
    R.checkRenewals({ roster: { ok: true, rows: subs }, stripe: { keyed: true, readable: true, subs: stripe.subs }, priceIds: [G.MP_PRICE],
      now: SAT.now }).find((r) => r.code === "renewals.past_due_unflagged").buyer_numbers.join() === "2");
}
{ // renewals listing: items.data[].current_period_end, never the Subscription's
  const subs = K.roster(4);
  const stripe = G.healthyStripe([1, 2, 3, 4], { subs: [
    G.stripeSub(1, { periodEnd: unix("2026-10-08T14:00:00Z") }),                                   // renews in 8 days
    { ...G.stripeSub(2, { periodEnd: unix("2026-10-06T09:00:00Z") }), cancel_at_period_end: true }, // ends
    G.stripeSub(3, { periodEnd: unix("2026-10-20T00:00:00Z") }),                                   // outside 8 days
    { ...G.stripeSub(4, { periodEnd: null }), current_period_end: unix("2026-10-05T00:00:00Z") },   // top-level only
  ] });
  const s = await fx({ ...SUN, subs, stripe });
  const html = s.mails[0] ? s.mails[0].html : "";
  check("renewals: buyer 1 listed \"renews 10-08\" (item period end within 8 days)", html.includes("buyer 1: renews 10-08"), html);
  check("renewals: buyer 2 listed \"ends 10-06 (cancel at period end)\"", html.includes("buyer 2: ends 10-06 (cancel at period end)"));
  check("renewals: buyer 3 (period end in 16 days) not listed", !/buyer 3: (renews|ends)/.test(html));
  check("renewals: buyer 4 has current_period_end ONLY on the Subscription object -> BLIND period_unreadable, never listed as renewing",
    s.has("renewals.period_unreadable") && !/buyer 4: (renews|ends)/.test(html) && html.includes("no items.data[].current_period_end: buyer 4"));
  check("renewals: an Extended BLIND leaves the verdict at GO; the sun heartbeat still mails once", s.v === "GO" && s.mails.length === 1);
  const nk = await fx({ ...SAT, key: false });
  check("renewals without the key: BLIND renewals.no_key, verdict unchanged by it",
    nk.has("renewals.no_key") && nk.v === "GO, blind on 1", nk.v);
  const unl = R.checkRenewals({ roster: { ok: true, rows: K.roster(1) }, stripe: { keyed: true, readable: true, subs: [G.stripeSub(1)] },
    priceIds: [], now: SAT.now });
  check("renewals with no price allowlist: BLIND renewals.allowlist_unset", unl[0].code === "renewals.allowlist_unset");
  const ro = R.checkRenewals({ roster: { ok: false }, stripe: { keyed: true, readable: true, subs: [] }, priceIds: [G.MP_PRICE], now: SAT.now });
  check("renewals with the roster unreadable: roster_unreadable", ro[0].code === "roster_unreadable");
  const canceled = R.checkRenewals({ roster: { ok: true, rows: K.roster(1) }, now: SAT.now, priceIds: [G.MP_PRICE],
    stripe: { keyed: true, readable: true, subs: [G.stripeSub(1, { status: "canceled", periodEnd: unix("2026-10-05T00:00:00Z") })] } });
  check("renewals: a canceled subscription is not in S and is not listed", canceled.length === 1 && canceled[0].code === "renewals.ok");
}

// ════════════════════════════════════════════════════════════════════════════
// End to end: runner scripts -> facts -> the Function
// ════════════════════════════════════════════════════════════════════════════
{
  const root = mkdtempSync(join(tmpdir(), "r3b-e2e-"));
  const put = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
  put(".gitignore", C15.REQUIRED_IGNORES.join("\n") + "\n");
  put("index.html", "<html><body><a class=\"cta\">Start the Monday feed</a></body></html>");       // I-07
  put(".github/workflows/x.yml", `name: x\njobs:\n  a:\n    steps:\n      - run: echo ${"e".repeat(32)}\n`); // I-03
  const scan = C15.scan(root);
  const zone = { "TXT _dmarc.masspermits.com": [["v=DMARC1; p=none"]] };
  const resolver = { resolveTxt: async (n) => { if (zone["TXT " + n]) return zone["TXT " + n]; throw Object.assign(new Error("x"), { code: "ENODATA" }); },
    resolveMx: async () => { throw Object.assign(new Error("x"), { code: "ENODATA" }); } };
  const baseline = { domain: "masspermits.com", records: {
    dmarc: { name: "_dmarc.masspermits.com", type: "TXT", prefix: "v=DMARC1", values: ["v=DMARC1; p=quarantine"] },
    spf: { name: "masspermits.com", type: "TXT", prefix: "v=spf1", values: ["PLACEHOLDER"] },
    dkim: { name: "PLACEHOLDER._domainkey.masspermits.com", type: "TXT", prefix: "", values: ["PLACEHOLDER"] },
    mx: { name: "masspermits.com", type: "MX", values: ["PLACEHOLDER"] } } };
  const dns = await C22.compare({ baseline, resolver });
  // facts.mjs over fixture GitHub runs and a send log that lists two recipients
  const w = G.ghWorld({ runs: [G.run({ file: "weekly-feed.yml", id: 601, created: "2026-09-28T12:00:00Z" })], now: () => SAT.now });
  const gh = async (p) => (/^actions\/runs\/601\/jobs/.test(p) ? { status: 200, ok: true, json: { jobs: [{ id: 6010 }] } } : w.gh(p));
  const log = async () => ({ ok: true, text: "{\"sent\":[{\"to\":\"buyer1.testperson@example.com\"},{\"to\":\"buyer2.testperson@example.com\"}]}" });
  const collected = await Fa.collect({ gh, log, date: SAT.date, mode: "sat", repository: G.REPO, runId: "9",
    now: () => SAT.now, sleep: async () => {}, readText: () => null, workflowFiles: [] });
  const base = K.facts();
  delete base.c15; delete base.c22;
  // Only the R3b facts come from the scripts; the rest stay healthy.
  const line = Fa.finalize(Fa.merge({ ...base, c15: collected.c15 }, scan, dns));
  check("e2e: the runner's facts line carries no address although the log held two", !LEAK.test(line), line);
  const f = await fx({ ...SAT, facts: JSON.parse(line) });
  check("e2e: the Function reads NO-GO with C15.token_in_workflow and C15.feed_log_emails",
    f.v === "NO-GO" && f.codes.includes("C15.token_in_workflow") && f.codes.includes("C15.feed_log_emails"), JSON.stringify(f.codes));
  check("e2e: plus WARN C15.no_route_home, WARN C22.dmarc_changed and BLIND C22.baseline_unset for the three placeholders",
    f.has("C15.no_route_home") && f.has("C22.dmarc_changed") && f.has("C22.baseline_unset"));
  row("e2e", "C15, C22", `NO-GO ${f.codes.join(", ")}; WARN no_route_home, dmarc_changed`, f.v === "NO-GO" ? "Y" : "N",
    "facts from c15.mjs, c22.mjs and facts.mjs");
}

// ════════════════════════════════════════════════════════════════════════════
// 5, 6, 7 across every R3b run
// ════════════════════════════════════════════════════════════════════════════
{
  const persisted = worlds.flatMap((w) => w.ops.filter((o) => o.op === "put" || o.op === "delete").map((o) => o.key));
  check("5 every persisted write in the R3b runs is under rehearsal/", persisted.every((k) => k.startsWith("rehearsal/")),
    persisted.filter((k) => !k.startsWith("rehearsal/")).join());
  const to = rs.sent.flatMap((m) => m.to);
  check("6 every Resend call in the R3b runs went to the owner, one recipient each",
    rs.sent.length > 0 && rs.sent.every((m) => m.to.length === 1 && m.to[0] === K.OWNER && !m.cc && !m.bcc), to.join());
  const roster = new Set(K.roster(4).map((s) => s.email));
  check("6 0 Resend calls to a roster address", !to.some((t) => roster.has(t)));
  check("6 no digest names a roster address or token", rs.sent.every((m) => ![...roster].some((e) => m.html.includes(e)) &&
    !/[0-9a-f]{32}/.test(m.html)));
  check("7 every response: exactly {ok, verdict, more, codes, error}, no address, 32-hex, cus_ or street",
    responses.every((r) => Object.keys(r.json).join() === "ok,verdict,more,codes,error" && !LEAK.test(r.text)),
    (responses.find((r) => LEAK.test(r.text)) || {}).text);
  // Digits allowed: check ids in codes (C15.x) and the spec's "GO, blind on N".
  const digits = (r) => JSON.stringify({ ...r.json, verdict: String(r.json.verdict).replace(/^GO, blind on \d+$/, "GO, blind"),
    codes: r.json.codes.map((c) => c.replace(/^C\d+\./, "")) });
  check("7 no response carries a count (no digit outside check ids and \"blind on N\")",
    responses.every((r) => !/\d/.test(digits(r))), (responses.find((r) => /\d/.test(digits(r))) || {}).text);
  check("10 the Function's outbound hosts were only Stripe (GET) and Resend",
    stub.calls.every((c) => ["api.stripe.com", "api.resend.com"].includes(new URL(c.url).host)) &&
    stub.to("api.stripe.com").every((c) => c.method === "GET") && stub.unexpected.length === 0);
}

console.log("\nID               | check      | result | Y/P/N | note");
for (const [id, chk, result, ynp, note] of table) {
  console.log(`${id.padEnd(16)} | ${chk.padEnd(10)} | ${result} | ${ynp}${note ? " | " + note : ""}`);
}
done();
