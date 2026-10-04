// rehearsal.js, the Function: the auth gate against the REAL verifier
// (acceptance 17), parameters and body, the fail-closed log, the mail lock and
// daily cap (6), outbound structure and the run-time lock (18), the leak test
// (7, Function side), the write set (5) and the handler spy (15).
//
//   node functions/api/rehearsal_function.test.mjs
//
// Every network call goes to the throwing fetch stub. The Resend URL below is
// a fixture route: a call to it is recorded, never sent.

import { join } from "node:path";
import {
  API_DIR, makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub, makeOidcKit, fakeR2, readText,
} from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";

const RESEND = "https://api.resend.com/emails";
const kit = makeOidcKit();
const rs = resendFixture(RESEND);
let resendStatus = 200;
let onResend = null;
const stub = makeFetchStub({
  [RESEND]: (u, init, rec) => {
    if (onResend) onResend(init);
    if (resendStatus !== 200) { rs.sent.push({ failed: true, ...JSON.parse(init.body) }); return new Response("{}", { status: resendStatus }); }
    return rs.handler(u, init, rec);
  },
  [kit.JWKS_URL]: kit.jwksHandler,
});
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const { check, done } = makeRunner("rehearsal_function.test.mjs");
const { HOUR, DAY } = K;

const responses = [];   // every rehearsal.js response body, for the leak test
const worlds = [];      // every fake R2, for the write-set test
const keep = (r2) => { worlds.push(r2); return r2; };
const stripeCalls = () => stub.calls.filter((c) => c.url.includes("api.stripe.com")).length;

// ════════════════════════════════════════════════════════════════════════════
// 17. AUTH GATE with the REAL functions/api/_github-oidc.js
// ════════════════════════════════════════════════════════════════════════════
{
  const real = await import("./rehearsal.js");
  const today = new Date().toISOString().slice(0, 10);
  const good = `mode=sat&part=core&page=0&date=${today}&trigger=sched&run=42`;
  const bad = "mode=weekly&part=everything&page=99&date=1999-01-01&trigger=x;y&run=abc";
  const cases = [
    ["no Authorization header", null],
    ["aud other", kit.sign({ aud: "other" })],
    ["ref refs/heads/claude/x", kit.sign({ ref: "refs/heads/claude/x" })],
    ["exp in the past", kit.sign({ exp: Math.floor(Date.now() / 1000) - 60 })],
  ];
  for (const [label, token] of cases) {
    for (const [pl, qs] of [["valid params", good], ["invalid params", bad]]) {
      const r2 = keep(K.world({ now: Date.now() }));
      const before = { resend: rs.sent.length, stripe: stripeCalls(), calls: stub.calls.length };
      const headers = token ? { authorization: "Bearer " + token } : {};
      const r = await real.onRequestPost({ request: new Request("https://masspermits.com/api/rehearsal?" + qs,
        { method: "POST", headers, body: JSON.stringify(K.facts()) }), env: K.baseEnv(r2.bucket) });
      const text = await r.text();
      responses.push({ text, status: r.status });
      const newCalls = stub.calls.slice(before.calls).map((c) => c.url);
      check(`17 ${label}, ${pl}: 401 exactly {"ok":false,"error":"unauthorized"}`,
        r.status === 401 && text === '{"ok":false,"error":"unauthorized"}', r.status + " " + text);
      check(`17 ${label}, ${pl}: 0 R2 ops, 0 Stripe, 0 Resend, only the JWKS URL`,
        r2.ops.length === 0 && stripeCalls() === before.stripe && rs.sent.length === before.resend &&
        newCalls.every((u) => u === kit.JWKS_URL), JSON.stringify({ ops: r2.ops.length, newCalls }));
    }
  }
  // positive control
  const r2 = keep(K.world({ now: Date.now(), log: [] }));
  const r = await real.onRequestPost({ request: new Request("https://masspermits.com/api/rehearsal?" +
    good.replace("mode=sat", "mode=dry"), { method: "POST", headers: { authorization: "Bearer " + kit.sign() },
    body: JSON.stringify(K.facts()) }), env: K.baseEnv(r2.bucket) });
  const text = await r.text();
  responses.push({ text, status: r.status });
  check("17 positive control: a valid token with valid params returns 200", r.status === 200, r.status + " " + text);
}

// Everything below uses the temp copy with a stubbed verifier.
const L = await K.loadRehearsal();
check("temp copy is byte-identical to the shipped files (only _github-oidc.js stubbed)", L.byteIdentical());
const now = K.at("2026-10-03T20:30:00Z");   // a Saturday
clock.set(now);
const date = "2026-10-03";
const lastMon = K.at("2026-09-28T14:00:00Z");

async function post(env, qs, body = K.facts()) {
  const r = await L.mod.onRequestPost({ request: new Request("https://masspermits.com/api/rehearsal?" + qs,
    { method: "POST", headers: { authorization: "Bearer test" }, body: typeof body === "string" ? body : JSON.stringify(body) }), env });
  const text = await r.text();
  responses.push({ text, status: r.status });
  return { status: r.status, text, json: JSON.parse(text) };
}
async function run(r2, env, o) {
  const x = await K.runMode(L.mod, env, o);
  for (const y of x.responses) responses.push({ text: y.text, status: y.status });
  return x;
}
const healthy = (o = {}) => {
  const subs = o.subs ?? K.roster(3);
  return keep(K.world({ now, refreshAt: K.at("2026-10-03T14:00:00Z"), subs,
    log: [K.sendEntry(lastMon, (Array.isArray(subs) ? subs : []).map((s) => s.email))], ...o }));
};
const q = (o = {}) => new URLSearchParams({ mode: "sat", part: "core", page: "0", date, trigger: "sched", run: "7", ...o }).toString();

// ════════════════════════════════════════════════════════════════════════════
// parameters and body
// ════════════════════════════════════════════════════════════════════════════
{
  const badParams = [
    ["mode weekly", q({ mode: "weekly" })], ["part all", q({ part: "all" })], ["page 25", q({ page: "25" })],
    ["page -1", q({ page: "-1" })], ["page 01", q({ page: "01" })], ["page 1.5", q({ page: "1.5" })],
    ["date 4 days back", q({ date: "2026-09-29" })], ["date 2 days ahead", q({ date: "2026-10-05" })],
    ["date 2026-02-30", q({ date: "2026-02-30" })], ["date not a date", q({ date: "2026-1-3" })],
    ["trigger with a ;", q({ trigger: "sched;x" })], ["trigger 21 digits", q({ trigger: "1".repeat(21) })],
    ["run abc", q({ run: "abc" })], ["run empty", q({ run: "" })],
    ["an extra parameter", q() + "&force=1"], ["a duplicated parameter", q() + "&mode=sat"],
    ["a missing parameter", q().replace(/&run=7/, "")],
  ];
  for (const [label, qs] of badParams) {
    const r2 = healthy();
    const r = await post(K.baseEnv(r2.bucket), qs);
    check(`bad_param: ${label} -> 400 with 0 R2 ops`, r.status === 400 && r.json.error === "bad_param" && r2.ops.length === 0,
      r.status + " " + r.text);
  }
  const r2 = healthy();
  for (const d of ["2026-09-30", "2026-10-04"]) {
    const r = await post(K.baseEnv(r2.bucket), q({ date: d, mode: "dry" }));
    check(`date ${d} is inside [-3, +1] days: accepted`, r.status === 200, r.text);
  }
  const big = JSON.stringify({ ...K.facts(), pad: "x".repeat(4100) });
  for (const [label, body] of [["a body over 4 KB", big], ["not JSON", "{"], ["v 2", JSON.stringify({ ...K.facts(), v: 2 })],
    ["an array", "[1]"], ["empty", ""]]) {
    const w = healthy();
    const r = await post(K.baseEnv(w.bucket), q(), body);
    check(`schema: ${label} -> 400 schema, 0 R2 ops`, r.status === 400 && r.json.error === "schema" && w.ops.length === 0, r.text);
  }
  // a bad fact is dropped, the run goes on, and its checks are BLIND schema
  const w = healthy();
  const r = await post(K.baseEnv(w.bucket), q({ mode: "dry" }), K.facts({ "c0.fn_state": "exploded" }));
  const log = w.json("rehearsal/log.json");
  check("a bad fact is dropped and the run completes", r.status === 200 && r.json.ok === true && !!log);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. fail-closed log, the mail lock, the daily cap
// ════════════════════════════════════════════════════════════════════════════
// A NO-GO world for sat (no refresh today), so sat WOULD mail.
const nogoFacts = K.facts({ "refresh.state": "none", "refresh.conclusion": "none" });
for (const [label, body] of [["invalid JSON", "{\"v\":1,"], ["valid JSON, wrong shape", JSON.stringify({ v: 1, records: {} })],
  ["valid JSON, an array", "[]"], ["records holding a non-object", JSON.stringify({ v: 1, records: [1], mail: [] })]]) {
  const w = healthy({ extra: { "rehearsal/log.json": body } });
  const before = rs.sent.length;
  const r = await post(K.baseEnv(w.bucket), q(), nogoFacts);
  check(`log.json ${label}: error log_unreadable, 0 Resend calls, object unchanged`,
    r.json.error === "log_unreadable" && rs.sent.length === before && w.text("rehearsal/log.json") === body &&
    w.writes().length === 0, r.text);
}
{
  const w = healthy();
  const before = rs.sent.length;
  const r = await post(K.baseEnv(w.bucket), q(), nogoFacts);
  check("a MISSING log.json is a fresh start: NO-GO mails once", r.json.verdict === "NO-GO" && rs.sent.length === before + 1, r.text);
  const put = keep(healthy({ r2opts: { failPut: (k) => k === "rehearsal/log.json" } }));
  const b2 = rs.sent.length;
  const r2 = await post(K.baseEnv(put.bucket), q(), nogoFacts);
  check("an attempt-record put that throws: 0 Resend calls, C18.mail_capped in codes",
    rs.sent.length === b2 && r2.json.codes.includes("C18.mail_capped"), r2.text);
}

// sendInternal, directly.
const handle = (bucket, mail = []) => ({ data: { v: 1, records: [], mail }, run: "9",
  async save() { const r = await bucket.put("rehearsal/log.json", JSON.stringify(this.data)); if (!r) throw new Error("x"); } });
const rosterOf = (rows) => ({ ok: true, rows, code: null });
async function send(env, rosterObj, to, mail) {
  const w = fakeR2({});
  const h = handle(w.bucket, mail);
  const before = rs.sent.length;
  const r = await L.mod.outbound(env, rosterObj, h).sendInternal(to, "s", "<p>h</p>");
  return { r, calls: rs.sent.length - before, h, w };
}
const lockEnv = { REHEARSAL_MAIL: "1", REHEARSAL_TO: " Owner@Example.com ", REHEARSAL_SEEDS: " seed@example.com ,, other.seed@example.com",
  FROM_EMAIL: "rehearsal@example.com", RESEND_API_KEY: "re_test_key" };
{
  let x = await send(lockEnv, rosterOf([{ email: "Seed@Example.com", active: true }]), "seed@example.com");
  check("6 roster holds Seed@Example.com, seed is \" seed@example.com \": refused, 0 calls", x.r.result === "refused" && x.calls === 0);
  x = await send(lockEnv, rosterOf([{ email: " OWNER@example.com", active: false }]), "owner@example.com");
  check("6 an INACTIVE roster row with the owner's address refuses the owner send", x.r.result === "refused" && x.calls === 0);
  for (const [label, env] of [["unset", {}], ["empty", { REHEARSAL_TO: "", OWNER_EMAIL: "" }], ["whitespace", { REHEARSAL_TO: "  ", OWNER_EMAIL: " \t" }]]) {
    for (const to of [undefined, ""]) {
      x = await send({ REHEARSAL_MAIL: "1", ...env }, rosterOf([]), to);
      check(`6 owner env ${label}, to ${JSON.stringify(to)}: refused, 0 calls`, x.r.result === "refused" && x.calls === 0 &&
        x.h.data.mail[0].result === "refused");
    }
  }
  x = await send({ ...lockEnv, REHEARSAL_TO: "a@b@example.com" }, rosterOf([]), "a@b@example.com");
  check("6 \"a@b@example.com\" is refused", x.r.result === "refused" && x.calls === 0);
  x = await send(lockEnv, rosterOf([{ email: "buyer1.testperson@example.com" }]), "owner@example.com");
  check("6 REHEARSAL_TO \" Owner@Example.com \" accepts \"owner@example.com\" (symmetric)", x.r.result === "sent" && x.calls === 1 &&
    JSON.stringify(rs.sent[rs.sent.length - 1].to) === '["owner@example.com"]');
  const last = rs.sent[rs.sent.length - 1];
  check("6 one recipient, no cc or bcc", Array.isArray(last.to) && last.to.length === 1 && !("cc" in last) && !("bcc" in last));
  x = await send(lockEnv, rosterOf([]), "stranger@example.com");
  check("6 an address on no env list: refused", x.r.result === "refused" && x.calls === 0);
  x = await send(lockEnv, rosterOf([{ email: "buyer1.testperson@example.com" }]), "Buyer1.TestPerson@example.com ");
  check("6 a roster email (any case, whitespace) not on any list: refused", x.r.result === "refused" && x.calls === 0);
  x = await send({ ...lockEnv, REHEARSAL_TO: "buyer1.testperson@example.com" }, rosterOf([{ email: "BUYER1.testperson@example.com", active: false }]), "buyer1.testperson@example.com");
  check("6 an owner env value that is a roster email is still refused", x.r.result === "refused" && x.calls === 0);
  x = await send({ ...lockEnv, REHEARSAL_MAIL: undefined }, rosterOf([]), "owner@example.com");
  check("6 REHEARSAL_MAIL unset: mail off, 0 calls", x.r.result === "off" && x.calls === 0);
  x = await send({ ...lockEnv, REHEARSAL_MAIL: "true" }, rosterOf([]), "owner@example.com");
  check("6 REHEARSAL_MAIL \"true\" (not \"1\"): mail off, 0 calls", x.r.result === "off" && x.calls === 0);
  x = await send(lockEnv, { ok: false, rows: [], code: "parse_error" }, "seed@example.com");
  check("6 unreadable roster: every seed refused", x.r.result === "refused" && x.calls === 0);
  x = await send(lockEnv, rosterOf([]), "other.seed@example.com");
  check("6 a counted seed with a readable roster is accepted", x.r.result === "sent" && x.calls === 1);
  // the cap
  const day = new Date(now).toISOString().slice(0, 10);
  const three = (kind, result = "sent") => [1, 2, 3].map((i) => ({ day, kind, run: String(i), result }));
  x = await send(lockEnv, rosterOf([]), "owner@example.com", three("owner"));
  check("6 cap: 3 owner attempts today, a 4th makes 0 calls and records capped", x.r.result === "capped" && x.calls === 0 &&
    x.h.data.mail[0].result === "capped");
  x = await send(lockEnv, rosterOf([]), "seed@example.com", three("seed"));
  check("6 cap: 3 seed attempts today, a 4th seed makes 0 calls", x.r.result === "capped" && x.calls === 0);
  x = await send(lockEnv, rosterOf([]), "seed@example.com", three("owner"));
  check("6 cap is per kind: 3 owner attempts do not cap a seed", x.r.result === "sent" && x.calls === 1);
  x = await send(lockEnv, rosterOf([]), "owner@example.com", three("owner", "failed"));
  check("6 failed attempts count toward the cap", x.r.result === "capped" && x.calls === 0);
  x = await send(lockEnv, rosterOf([]), "owner@example.com", three("owner", "capped").concat(three("owner", "off"), three("owner", "refused")));
  check("6 capped/off/refused records are not attempts", x.r.result === "sent" && x.calls === 1);
  x = await send(lockEnv, rosterOf([]), "owner@example.com", three("owner").map((m) => ({ ...m, day: "2026-10-02" })));
  check("6 yesterday's attempts do not count today", x.r.result === "sent");
  // the attempt record is written BEFORE the call
  let seenPending = null;
  const w = fakeR2({});
  onResend = () => { const l = JSON.parse(w.text("rehearsal/log.json") || "{}"); seenPending = (l.mail || []).some((m) => m.result === "pending"); };
  await L.mod.outbound(lockEnv, rosterOf([]), handle(w.bucket)).sendInternal("owner@example.com", "s", "h");
  onResend = null;
  check("6 the attempt record is in R2 when Resend is called", seenPending === true);
  // a failed attempt is recorded, not retried
  resendStatus = 500;
  const b = rs.sent.length;
  x = await send(lockEnv, rosterOf([]), "owner@example.com");
  resendStatus = 200;
  check("6 a Resend failure is recorded failed and not retried (1 call)", x.r.result === "failed" && rs.sent.length - b === 1 &&
    x.h.data.mail[0].result === "failed");
  // the write fails -> no call
  const wf = fakeR2({}, { failPut: () => true });
  const b3 = rs.sent.length;
  const r = await L.mod.outbound(lockEnv, rosterOf([]), handle(wf.bucket)).sendInternal("owner@example.com", "s", "h");
  check("6 attempt-record write throws: 0 calls, reported capped", r.result === "capped" && r.writeFailed === true && rs.sent.length === b3);
  // no mail record holds an address
  check("6 mail records hold no address", !JSON.stringify(x.h.data.mail).includes("@"));
}

// ════════════════════════════════════════════════════════════════════════════
// 18. outbound structure and the run-time lock
// ════════════════════════════════════════════════════════════════════════════
{
  const src = readText(join(API_DIR, "rehearsal.js"));
  const start = src.indexOf("export function outbound(");
  const end = src.indexOf("return { stripeGet, sendInternal };", start);
  const body = src.slice(start, end);
  const FREE = /(?<![A-Za-z0-9_$.])fetch\s*\(/g;
  check("18a rehearsal.js has exactly 2 free fetch( calls", (src.match(FREE) || []).length === 2);
  check("18a both are inside outbound()", start > 0 && end > start && (body.match(FREE) || []).length === 2);
  const sIdx = body.indexOf("async function stripeGet"), iIdx = body.indexOf("async function sendInternal");
  check("18a one in stripeGet, one in sendInternal",
    (body.slice(sIdx, body.indexOf("function lock")).match(FREE) || []).length === 1 &&
    (body.slice(iIdx).match(FREE) || []).length === 1);
  check("18c api.resend.com appears once in rehearsal.js, inside sendInternal",
    (src.match(/api\.resend\.com/g) || []).length === 1 && body.slice(iIdx).includes("api.resend.com"));
  const out = L.mod.outbound({}, { ok: true, rows: [] }, handle(fakeR2({}).bucket));
  check("18 outbound() returns exactly {stripeGet, sendInternal}", Object.keys(out).sort().join() === "sendInternal,stripeGet");
  const before = stub.calls.length;
  for (const [label, url, init] of [["https://masspermits.com/api/x", "https://masspermits.com/api/x"],
    ["https://api.github.com/x", "https://api.github.com/x"], ["api.stripe.com.evil.example", "https://api.stripe.com.evil.example/x"],
    ["a POST to https://api.stripe.com/v1/x", "https://api.stripe.com/v1/x", { method: "POST" }],
    ["http:// Stripe", "http://api.stripe.com/v1/x"], ["a user-info host trick", "https://api.stripe.com@example.com/x"],
    ["not a URL", "::"], ["lower-case get", "https://api.stripe.com/v1/x", { method: "get" }]]) {
    let err = null;
    try { await out.stripeGet(url, init); } catch (e) { err = e.message; }
    check(`18e stripeGet ${label}: throws outbound_blocked`, err === "outbound_blocked", err);
  }
  check("18e none of those reached the fetch stub", stub.calls.length === before);
  let reached = null;
  const s2 = makeFetchStub({ "https://api.stripe.com/v1/subscriptions?limit=1": (u, init) => { reached = init.method; return {}; } });
  const saved = globalThis.fetch;
  globalThis.fetch = s2.fetch;
  await out.stripeGet("https://api.stripe.com/v1/subscriptions?limit=1", { headers: { "Stripe-Version": "x" } });
  globalThis.fetch = saved;
  check("18e stripeGet to the Stripe API origin is a GET", reached === "GET");
}

// ════════════════════════════════════════════════════════════════════════════
// runs: spy (15), write set (5), leak (7)
// ════════════════════════════════════════════════════════════════════════════
{
  const w = healthy();
  const b = rs.sent.length;
  const x = await run(w, K.baseEnv(w.bucket), { mode: "sat", date, body: K.facts() });
  check("healthy sat: GO, blind on 1 (C7 no key), 0 Resend calls", x.core.json.verdict === "GO, blind on 1" && rs.sent.length === b, x.core.text);
  const spy = L.spyLog();
  check("15 the handlers were called in-process (3 rows x 3 calls)", spy.length === 9, spy.length);
  check("15 no Request handed to a handler carries an authorization header", spy.every((s) => !s.authorization));
  check("15 my-leads Requests carry only user-agent and x-mp-synthetic",
    spy.filter((s) => s.handler === "my-leads").every((s) => s.headers.join() === "user-agent,x-mp-synthetic"));
  check("15 leads Requests carry only cookie, user-agent and x-mp-synthetic",
    spy.filter((s) => s.handler === "leads").every((s) => s.headers.join() === "cookie,user-agent,x-mp-synthetic"));
  check("15 leads is called at /leads, never /leads?t=", spy.filter((s) => s.handler === "leads").every((s) => s.url === "https://masspermits.com/leads"));
  check("5 every handler got a roBucket with exactly five methods", spy.every((s) => s.roBucket && s.ownMethods.join() === "delete,get,head,list,put"));
  check("5 it is the NO-OPTIONS view: a put to rehearsal/ from the handler's bucket did not persist",
    spy.every((s) => w.text(s.probe) === null));
  const store = w.json("rehearsal/links-1001.json");
  const rows = Object.values(store.pages).flatMap((p) => p.rows);
  check("5 per /leads call exactly one captured portal-access/ write, zero dl/", rows.length === 3 &&
    rows.every((r) => r.leads.access === 1 && r.leads.st === "ok" && r.weekly.dl === 0 && r.monthly.dl === 0 &&
      r.weekly.persisted + r.monthly.persisted + r.leads.persisted === 0), JSON.stringify(rows[0]));
  check("links store holds no address or token", !/@|[0-9a-f]{32}/.test(JSON.stringify(store)));
  const log = w.text("rehearsal/log.json");
  check("log.json holds no address, token or customer id", !/@|[0-9a-f]{32}|cus_/.test(log));
}

// 3 and 30 subscribers: the caller's printed projection is identical.
{
  const projection = (x) => x.responses.map((y) => (y.part === "core"
    ? JSON.stringify({ ok: y.json.ok, verdict: y.json.verdict, codes: y.json.codes, error: y.json.error })
    : (y.json.ok !== true ? JSON.stringify({ ok: y.json.ok, error: y.json.error }) : null))).filter(Boolean);
  const a = healthy({ subs: K.roster(3) });
  const b = healthy({ subs: K.roster(30, (s, i) => ({ ...s, email: `buyer${i}.testperson@example.com`,
    token: (i.toString(16).padStart(2, "0")).repeat(16) })) });
  const xa = await run(a, K.baseEnv(a.bucket), { mode: "sat", date, run: "3003", body: K.facts() });
  const xb = await run(b, K.baseEnv(b.bucket), { mode: "sat", date, run: "3030", body: K.facts() });
  check("7 3 vs 30 subscribers: core responses identical", xa.core.text === xb.core.text, xa.core.text + " | " + xb.core.text);
  check("7 3 vs 30 subscribers: the caller's printed lines are identical", JSON.stringify(projection(xa)) === JSON.stringify(projection(xb)));
  check("7 30 subscribers took 8 links pages (more:true until done)", xb.responses.filter((y) => y.part === "links").length === 8);
}

// Roster unreadable (F6's Function half, also in the drills file)
{
  for (const [label, body] of [["truncated JSON with an address", '[{"email":"hidden.person@example.com","tok'], ["an object", '{"email":"hidden.person@example.com"}']]) {
    const w = healthy({ subs: [] });
    w.bucket.put("subscribers.json", body);
    const b = rs.sent.length;
    const x = await run(w, K.baseEnv(w.bucket, { REHEARSAL_SEEDS: "seed@example.com" }), { mode: "sun", date: "2026-10-04",
      body: K.facts() });
    const mail = rs.sent.slice(b);
    check(`F6 ${label}: roster checks NO-GO roster_unreadable`, x.core.json.verdict === "NO-GO" && x.core.json.codes.includes("roster_unreadable"), x.core.text);
    check(`F6 ${label}: 0 seed sends, the owner digest carries the fixed text and no address`,
      mail.every((m) => m.to[0] === K.OWNER) && mail.length === 1 && mail[0].html.includes("The subscriber list could not be read") &&
      !mail[0].html.includes("hidden.person"), mail.length);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 7. leak test and 5. write set, across everything above
// ════════════════════════════════════════════════════════════════════════════
const STREET = /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Way|Drive|Dr|Court|Ct)\b/;
let leaks = 0, shape = 0;
for (const r of responses) {
  if (/@|[0-9a-f]{32}|cus_/.test(r.text) || STREET.test(r.text)) leaks++;
  const j = JSON.parse(r.text);
  const keys = Object.keys(j).sort().join();
  if (r.status === 401 ? r.text !== '{"ok":false,"error":"unauthorized"}' : keys !== "codes,error,more,ok,verdict") shape++;
  if (/"(counts|subscribers|rows|buyer|count)"/.test(r.text)) leaks++;
}
check(`7 ${responses.length} responses: no @, 32-hex, cus_, street or count`, leaks === 0, leaks);
check("7 every response has exactly ok, verdict, more, codes, error (the 401 is exactly {ok, error})", shape === 0, shape);
const stray = worlds.flatMap((w) => w.writes().map((o) => o.key)).filter((k) => !k.startsWith("rehearsal/") && k !== "subscribers.json");
check("5 across every run, persisted R2 writes are only under rehearsal/", stray.length === 0, stray.join(","));
check("5 no spy probe persisted anywhere", worlds.every((w) => w.writes().every((o) => !o.key.startsWith("rehearsal/spy-probe"))));
check("10 the fetch stub saw 0 non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
check("10 outbound hosts are a subset of {Resend, Stripe, the JWKS host}",
  stub.calls.every((c) => ["api.resend.com", "api.stripe.com", "token.actions.githubusercontent.com"].includes(new URL(c.url).host)));
const roster3 = K.roster(30).map((s) => s.email.toLowerCase());
check("6 0 Resend calls to any roster email", rs.sent.every((m) => (m.to || []).every((t) => !roster3.includes(t.toLowerCase()))));
done();
