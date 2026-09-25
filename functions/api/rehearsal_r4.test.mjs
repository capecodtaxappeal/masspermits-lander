// R4, the fresh-context adversarial review: a regression test for each attack
// that broke, plus the probes that did not break but had no test of their own.
//
//   node functions/api/rehearsal_r4.test.mjs
//
// Every network call goes to the throwing fetch stub. The Resend URL below is
// a fixture route: a call to it is recorded, never sent.

import * as R from "./_rehearsal.js";
import { makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub, fakeR2 } from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";

const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
const stub = makeFetchStub({ [RESEND]: rs.handler, "https://api.stripe.com/*": () => ({ data: [], has_more: false }) });
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const { check, done } = makeRunner("rehearsal_r4.test.mjs");
const { HOUR } = K;
const L = await K.loadRehearsal();
const leak = /@|[0-9a-f]{32}|cus_/;

async function run(w, body, mode, date, env = {}, run = "1001") {
  const before = rs.sent.length;
  const r = await K.runMode(L.mod, K.baseEnv(w.bucket, env), { mode, date, body, run });
  return { r, mails: rs.sent.slice(before) };
}
const lastCore = (w) => w.json("rehearsal/log.json").records.find((x) => x.part === "core");

// ── Attack 4: mon-post with an unreadable send log read as plain GO ─────────
// Found: checkMonPost returned BLIND mon_post.send_log_unreadable, but a BLIND
// on mon_post counted toward neither NO-GO nor "blind on N", so the verdict
// was "GO" and nothing was mailed. Fixed: mon_post is in BLIND_COUNTS, and
// mon-post mails on a blind verdict.
{
  const monNow = K.at("2026-09-28T21:00:00Z");
  clock.set(monNow);
  const f = K.facts({ "send.state": "completed", "send.runs": 1, "send.started_min": 800 });
  const w = K.world({ now: monNow, extra: { "feed-send-log.json": "{truncated" } });
  const { r, mails } = await run(w, f, "mon-post", "2026-09-28");
  check("R4-4 mon-post, feed-send-log.json corrupt: verdict is not plain GO",
    r.core.json.verdict === "GO, blind on 1", r.core.text);
  check("R4-4 ... and the owner is mailed once (a blind mon-post is a problem)",
    mails.length === 1 && mails[0].to.length === 1 && mails[0].to[0] === K.OWNER && mails[0].subject.startsWith("GO, blind"));

  const bad = K.facts({ "send.state": "completed", "send.runs": 1, "send.started_min": 800, "refresh.shipped_min": "x" });
  const w2 = K.world({ now: monNow, log: [K.sendEntry(K.at("2026-09-28T14:00:00Z"), K.roster(3).map((s) => s.email))] });
  const x = await run(w2, bad, "mon-post", "2026-09-28");
  check("R4-4 mon-post with the ordering facts dropped (schema): blind, not GO",
    x.r.core.json.verdict === "GO, blind on 1", x.r.core.text);

  const w3 = K.world({ now: monNow, log: [K.sendEntry(K.at("2026-09-28T14:00:00Z"), K.roster(3).map((s) => s.email))] });
  const y = await run(w3, f, "mon-post", "2026-09-28");
  check("R4-4 twin: readable log, every buyer delivered once: not blind, no NO-GO",
    y.r.core.json.verdict === "GO" && y.r.core.json.codes.length === 0, y.r.core.text);

  check("R4-4 unit: a BLIND mon_post counts toward blind on N",
    R.verdictOf([R.res("mon_post", "BLIND", "mon_post.send_log_unreadable")]) === "GO, blind on 1");
  check("R4-4 unit: mon-post mails on a blind verdict, not on a clean GO",
    R.shouldMail({ mode: "mon-post", verdict: "GO, blind on 1", results: [], prev: [] }) === true &&
    R.shouldMail({ mode: "mon-post", verdict: "GO", results: [], prev: [] }) === false);
}

// ── Attack 4: stale links pages from an earlier attempt of the same run ─────
// Found: a GitHub re-run keeps GITHUB_RUN_ID, so rehearsal/links-<run>.json
// kept the earlier attempt's pages. A re-run that stopped after page 0 left
// the old pages 1..7 in place, and C6 judged the chain complete from stale
// rows. Fixed: page 0 always starts a fresh store, and C6 requires more:true on
// every page but the last.
{
  const now = K.at("2026-10-03T21:00:00Z");
  clock.set(now);
  const log = [K.sendEntry(K.at("2026-09-28T14:00:00Z"), K.roster(30).map((s) => s.email))];
  const w = K.world({ now, subs: K.roster(30), log });
  await run(w, K.facts(), "dry", "2026-10-03", {}, "777");
  check("R4-4 first attempt: 30 buyers, 8 links pages, C6 PASS",
    Object.keys(w.json("rehearsal/links-777.json").pages).length === 8 && lastCore(w).checks.C6 === "PASS");

  // Second attempt of the same run: page 0 only (the caller stopped), then core.
  const env = K.baseEnv(w.bucket);
  const post = (part, page) => L.mod.onRequestPost({ env, request: new Request(
    `https://masspermits.com/api/rehearsal?mode=dry&part=${part}&page=${page}&date=2026-10-03&trigger=dispatch&run=777`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(K.facts()) }) });
  await post("links", 0);
  check("R4-4 re-run: page 0 replaced the whole store",
    JSON.stringify(Object.keys(w.json("rehearsal/links-777.json").pages)) === '["0"]');
  const c = await (await post("core", 0)).json();
  const rec = w.json("rehearsal/log.json").records.find((x) => x.part === "core" && x.trigger === "dispatch");
  check("R4-4 re-run stopped after page 0: C6 is BLIND C6.incomplete, never PASS",
    rec.checks.C6 === "BLIND" && rec.findings.includes("BLIND C6.incomplete") && c.verdict.startsWith("GO, blind"), JSON.stringify(c));

  const ok = { rows: [], more: false };
  const roster = { ok: true, rows: [] };
  const one = (pages) => R.checkC6({ roster, store: { pages } })[0];
  check("R4-4 unit: two pages both more:false is incomplete",
    one({ 0: ok, 1: ok }).code === "C6.incomplete");
  check("R4-4 unit: a gap is incomplete", one({ 0: { rows: [], more: true }, 2: ok }).code === "C6.incomplete");
  check("R4-4 unit: a chain ending in more:true is incomplete", one({ 0: { rows: [], more: true } }).code === "C6.incomplete");
  check("R4-4 unit twin: 0 more:true then 1 more:false is complete",
    one({ 0: { rows: [], more: true }, 1: ok }).result === "PASS");
}

// ── Attack 1 and 18: the recipient lock with a non-string roster email ──────
// Found: the lock compared only rows whose email was a string, so a row with
// email ["owner@example.com"] did not refuse the owner send. Fixed: every
// value of the field (array entries included) is compared, normalised.
{
  const handle = (bucket) => ({ data: { v: 1, records: [], mail: [] }, run: "9",
    async save() { const r = await bucket.put("rehearsal/log.json", JSON.stringify(this.data)); if (!r) throw new Error("x"); } });
  const env = { REHEARSAL_MAIL: "1", REHEARSAL_TO: K.OWNER, FROM_EMAIL: "rehearsal@example.com", RESEND_API_KEY: "re_test_key",
    REHEARSAL_SEEDS: "seed@example.com" };
  const send = async (rows, to) => {
    const before = rs.sent.length;
    const r = await L.mod.outbound(env, { ok: true, rows, code: null }, handle(fakeR2({}).bucket)).sendInternal(to, "s", "h");
    return { r, calls: rs.sent.length - before };
  };
  for (const [label, email] of [
    ["an array holding the owner", [" OWNER@example.com "]],
    ["an array holding the seed", ["x@example.com", "Seed@Example.com"]],
    ["a String object", new String("owner@example.com")],
  ]) {
    const to = label.includes("seed") ? "seed@example.com" : K.OWNER;
    const x = await send([{ email, active: false }], to);
    check(`R4-18 roster email as ${label}: refused, 0 Resend calls`, x.r.result === "refused" && x.calls === 0);
  }
  const ok = await send([{ email: null }, { email: 42 }, { name: "no email" }], K.OWNER);
  check("R4-18 twin: rows with no usable email do not block the owner", ok.r.result === "sent" && ok.calls === 1);
}

// ── Attack 14: stripeGet origin forms that did not break ────────────────────
{
  const out = L.mod.outbound({}, { ok: true, rows: [] }, { data: { mail: [] }, run: "1", save: async () => {} });
  const tries = [
    ["https://api.stripe.com:8443/v1/x", false], ["https://api.stripe.com./v1/x", false],
    ["http://api.stripe.com/v1/x", false], ["https://evil.example/https://api.stripe.com/", false],
    ["https://api.stripe.com:443/v1/prices", true], ["https://API.STRIPE.COM/v1/prices", true],
  ];
  for (const [u, allowed] of tries) {
    const before = stub.calls.length;
    let threw = false;
    try { await out.stripeGet(u, { method: "GET" }); } catch (e) { threw = e.message === "outbound_blocked"; }
    const reached = stub.calls.slice(before).map((c) => new URL(c.url).origin);
    check(`R4-14 stripeGet ${u}: ${allowed ? "GET to the Stripe origin" : "outbound_blocked, 0 calls"}`,
      allowed ? !threw && reached.length === 1 && reached[0] === "https://api.stripe.com" : threw && reached.length === 0);
  }
}

// ── Attack 5 and 21 across this file's runs ─────────────────────────────────
{
  const now = K.at("2026-10-03T21:00:00Z");
  clock.set(now);
  const texts = [];
  for (const n of [3, 30]) {
    const w = K.world({ now, subs: K.roster(n, (s, i) => (i === 2 ? { ...s, token: "short" } : s)),
      extra: { "feed-send-log.json": "{bad" } });
    const { r } = await run(w, K.facts(), "sat", "2026-10-03", {}, String(5000 + n));
    for (const x of r.responses) check(`R4-5 sat, ${n} buyers, ${x.part} page ${x.page}: no leak, five keys`,
      !leak.test(x.text) && Object.keys(x.json).join() === "ok,verdict,more,codes,error", x.text);
    texts.push(JSON.stringify({ ok: r.core.json.ok, verdict: r.core.json.verdict, codes: r.core.json.codes, error: r.core.json.error }));
  }
  check("R4-21 the caller's printed core line is identical for 3 and 30 buyers", texts[0] === texts[1], texts.join(" | "));
}
check("R4-10 the fetch stub saw no unexpected URL", stub.unexpected.length === 0);
clock.real();
done();
