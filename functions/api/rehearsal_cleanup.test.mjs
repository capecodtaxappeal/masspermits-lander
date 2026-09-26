// Cleanup: missing runner facts count as blind (ITEM 1), and the link
// handlers get only BUNDLES (ITEM 2), through the whole rehearsal.js the way
// the caller drives it.
//
//   node functions/api/rehearsal_cleanup.test.mjs
//
// Every network call goes to the throwing fetch stub (Resend and Stripe are
// fixture routes). Everything is synthetic: @example.com addresses, cus_TEST
// ids, repeated-digit tokens, made-up "sentinel" env values.

import { makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub } from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";
import * as G from "../../test/rehearsal/r3a_fixtures.mjs";
import * as R from "./_rehearsal.js";

const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
let acct = G.healthyStripe();
const sw = G.stripeWorld(() => acct);
const stub = makeFetchStub({ [RESEND]: rs.handler, ...sw.routes });
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const { check, done } = makeRunner("rehearsal_cleanup.test.mjs");
const L = await K.loadRehearsal();
const at = K.at;

const PAGE = "<html><body><p>Weekly permit leads.</p><a href=\"/leads\">Your leads</a></body></html>";
const ASSETS = { async fetch() { return new Response(PAGE, { status: 200 }); } };
const SUN = { now: at("2026-10-04T20:30:00Z"), mode: "sun", date: "2026-10-04", refreshAt: at("2026-10-04T14:00:00Z") };

let runSeq = 7000;
// A sun run on a healthy R2 with the keyed baseline's Stripe fixtures, so
// nothing but the runner facts in `body` can blind it.
async function sun(body) {
  clock.set(SUN.now);
  const subs = K.roster(3);
  acct = G.healthyStripe(subs.map((_, k) => k + 1));
  const w = K.world({ now: SUN.now, subs, refreshAt: SUN.refreshAt,
    log: [K.sendEntry(at("2026-09-28T14:00:00Z"), subs.map((s) => s.email))] });
  const before = rs.sent.length;
  const env = K.baseEnv(w.bucket, { ASSETS, REHEARSAL_R20_DONE: "2026-09-20", ...G.STRIPE_ENV });
  const x = await K.runMode(L.mod, env, { mode: SUN.mode, date: SUN.date, run: String(++runSeq), body });
  const rec = w.json("rehearsal/log.json").records.find((r) => r.part === "core");
  return { v: x.core.json.verdict, mails: rs.sent.slice(before), rec,
    has: (code) => !!(rec && rec.findings.some((f) => f.split(" ")[1] === code)) };
}
const blindGo = (v) => typeof v === "string" && v.startsWith("GO, blind on") && v !== "GO";
const ownerMail = (r) => r.mails.length === 1 && r.mails[0].to.join() === K.OWNER &&
  r.mails[0].subject.startsWith("GO, blind on");

// ════════════════════════════════════════════════════════════════════════════
// ITEM 1: missing runner facts count as blind
// ════════════════════════════════════════════════════════════════════════════
{ // (d) twin first: healthy facts give exactly GO
  const r = await sun(K.facts());
  check("1(d) healthy facts, keyed sun: verdict exactly GO", r.v === "GO", r.v + " " + r.rec.findings.join("; "));
}
{ // (a) body {"v":1}
  const r = await sun({ v: 1 });
  check("1(a) body {v:1}: verdict starts \"GO, blind on\", never exactly GO", blindGo(r.v), r.v);
  check("1(a) body {v:1}: exactly 1 Resend call, to the owner, subject \"GO, blind on\"", ownerMail(r),
    JSON.stringify(r.mails.map((m) => [m.to, m.subject])));
}
{ // (b) healthy facts, api rate_limited
  const r = await sun(K.facts({ api: "rate_limited" }));
  check("1(b) api rate_limited: verdict starts \"GO, blind on\", never exactly GO", blindGo(r.v), r.v);
  check("1(b) api rate_limited: exactly 1 Resend call, to the owner, subject \"GO, blind on\"", ownerMail(r),
    JSON.stringify(r.mails.map((m) => [m.to, m.subject])));
}
// (c) healthy facts minus one group at a time
for (const [label, over, code] of [
  ["c0.*", { c0: undefined }, "schema"],
  ["c14.*", { c14: undefined }, "schema"],
  ["c17.inbox_mirror", { "c17.inbox_mirror": undefined }, "C17.inbox_mirror"],
  ["purchase.* (C5)", { purchase: undefined }, "schema"],
  ["c8.min_cents (C8)", { "c8.min_cents": undefined }, "schema"],
]) {
  const r = await sun(K.facts(over));
  check(`1(c) healthy facts minus ${label}: never plain GO ("GO, blind on N")`, blindGo(r.v) && r.has(code),
    r.v + " " + r.rec.findings.join("; "));
  check(`1(c) minus ${label}: one mail, to the owner, subject "GO, blind on"`, ownerMail(r));
}
{ // a dropped fact (wrong type) counts the same as an absent one
  const r = await sun(K.facts({ "c17.inbox_mirror": "yes" }));
  check("1(c) c17.inbox_mirror dropped by validateRunnerFacts: \"GO, blind on N\"", blindGo(r.v) && r.has("C17.inbox_mirror"), r.v);
}
{ // present values keep today's rule
  const drift = await sun(K.facts({ "c17.inbox_mirror": "drift" }));
  check("1 twin: a present c17.inbox_mirror \"drift\" keeps today's result (BLIND C17.inbox_mirror, verdict GO)",
    drift.v === "GO" && drift.has("C17.inbox_mirror"), drift.v);
  const err = await sun(K.facts({ "c17.inbox_mirror": "error" }));
  check("1 twin: a present c17.inbox_mirror \"error\" keeps today's result (verdict GO)", err.v === "GO" && err.has("C17.inbox_mirror"), err.v);
  const neg = await sun(K.facts({ "c8.min_cents": -1 }));
  check("1 twin: a present c8.min_cents -1 keeps today's rule (C8.min_cents_unknown, verdict GO)",
    neg.v === "GO" && neg.has("C8.min_cents_unknown"), neg.v);
}
{ // (e) unit: verdictOf
  const marked = R.blindFromFacts(R.res("C9", "BLIND", "C9.actions_api"));
  check("1(e) verdictOf: a C9 BLIND marked facts-caused is \"GO, blind on 1\"",
    R.verdictOf([marked], false) === "GO, blind on 1", R.verdictOf([marked], false));
  check("1(e) verdictOf: an unmarked C9 BLIND is still \"GO\"",
    R.verdictOf([R.res("C9", "BLIND", "C9.no_history")], false) === "GO");
  const two = [R.blindFromFacts(R.res("C0", "BLIND", "schema")), R.blindFromFacts(R.res("C0", "BLIND", "C0.actions_api")),
    R.res("C1", "BLIND", "C1.actions_api")];
  check("1(e) verdictOf: N is the number of distinct check ids", R.verdictOf(two, false) === "GO, blind on 2");
  check("1(e) verdictOf: an acked marked BLIND does not count",
    R.verdictOf([{ ...marked, acked: true }], false) === "GO");
  check("1(e) verdictOf: WAIT and NO-GO are unchanged", R.verdictOf([marked], true) === "WAIT" &&
    R.verdictOf([marked, R.res("C1", "NO-GO", "C1.no_refresh")], false) === "NO-GO");
  const c17 = R.checkC17({ facts: {}, dropped: [], inboxState: null, now: SUN.now });
  check("1(e) checkC17 with no facts: both BLIND lines are marked",
    c17.filter((r) => r.result === "BLIND").every((r) => r.facts_blind === true));
  const c17d = R.checkC17({ facts: { c17: { inbox_mirror: "drift" } }, dropped: [], inboxState: null, now: SUN.now });
  check("1(e) checkC17 with a present drift: the C17.inbox_mirror line is not marked",
    c17d.some((r) => r.code === "C17.inbox_mirror" && r.facts_blind !== true));
}

// ════════════════════════════════════════════════════════════════════════════
// ITEM 2: the link handlers get only BUNDLES
// ════════════════════════════════════════════════════════════════════════════
const SENTINELS = {
  RESEND_API_KEY: "sentinel-resend-not-real", STRIPE_READ_KEY: "sentinel-stripe-not-real",
  OWNER_EMAIL: "sentinel-owner@example.com", REHEARSAL_TO: "sentinel-to@example.com",
  REHEARSAL_SEEDS: "sentinel-seed@example.com", FROM_EMAIL: "sentinel-from@example.com",
  REHEARSAL_SEED_TOKEN: "sentinel-seed-token-not-real", SENTINEL_SECRET: "sentinel-secret-not-real",
};
// Every string reachable from a value through own properties (enumerable or
// not), functions' own properties included.
function reachable(v, seen = new Set(), out = []) {
  if (typeof v === "string") { out.push(v); return out; }
  if (v === null || (typeof v !== "object" && typeof v !== "function") || seen.has(v)) return out;
  seen.add(v);
  for (const k of Object.getOwnPropertyNames(v)) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (d && "value" in d) reachable(d.value, seen, out);
  }
  return out;
}
async function linksRun(Lx) {
  clock.set(SUN.now);
  const w = K.world({ now: SUN.now, subs: K.roster(3), refreshAt: SUN.refreshAt });
  let assetCalls = 0;
  const assets = { async fetch() { assetCalls++; return new Response(PAGE, { status: 200 }); } };
  const env = K.baseEnv(w.bucket, { ...SENTINELS, ASSETS: assets });
  const log = Lx.spyLog();
  const start = log.length;
  const run = String(++runSeq);
  for (let page = 0; page < 25; page++) {
    const url = `https://masspermits.com/api/rehearsal?mode=sun&part=links&page=${page}&date=${SUN.date}&trigger=sched&run=${run}`;
    const r = await Lx.mod.onRequestPost({ request: new Request(url, { method: "POST",
      headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify(K.facts()) }), env });
    if ((await r.json()).more !== true) break;
  }
  const calls = log.slice(start);
  const sentinelSeen = calls.some((c) => reachable(c.env).some((s) => s.includes("sentinel")));
  const ok = calls.length > 0 &&
    calls.every((c) => c.envKeys.join() === "BUNDLES") &&
    calls.every((c) => c.roBucket && c.probePersisted === false && c.env.BUNDLES !== w.bucket &&
      c.ownMethods.join() === "delete,get,head,list,put") &&
    !sentinelSeen && assetCalls === 0;
  return { ok, calls, sentinelSeen, assetCalls };
}
{
  const r = await linksRun(L);
  check("2 part=links: the handlers were called (my-leads and leads)",
    r.calls.some((c) => c.handler === "my-leads") && r.calls.some((c) => c.handler === "leads"), r.calls.length);
  check("2 every handler call: env keys exactly [\"BUNDLES\"]", r.calls.every((c) => c.envKeys.join() === "BUNDLES"),
    JSON.stringify([...new Set(r.calls.map((c) => c.envKeys.join()))]));
  check("2 every handler call: BUNDLES is the no-options roBucket (probe write dropped), not the raw bucket",
    r.calls.every((c) => c.roBucket && c.probePersisted === false));
  check("2 no sentinel value is reachable from any handler's env", !r.sentinelSeen);
  check("2 0 ASSETS calls during part=links", r.assetCalls === 0, r.assetCalls);
  check("2 all of the above together", r.ok);
}
{ // mutation proof: the old spread in the kit's temp copy of rehearsal.js
  let hit = 0;
  const M = await K.loadRehearsal({ mutate: (f, t) => {
    if (f !== "rehearsal.js") return t;
    const n = t.replace("env: { BUNDLES: ro }", () => { hit++; return "env: { ...env, BUNDLES: ro }"; });
    return n;
  } });
  const r = await linksRun(M);
  check("2 mutation: the old {...env, BUNDLES} spread was put back in the temp copy", hit === 1);
  check("2 mutation: with the old spread the test fails (extra env keys, sentinels reachable)",
    !r.ok && r.calls.length > 0 && r.calls.some((c) => c.envKeys.length > 1) && r.sentinelSeen,
    JSON.stringify(r.calls[0] && r.calls[0].envKeys));
}

check("no Resend call ever went to a sentinel or roster address",
  rs.sent.every((m) => m.to.every((t) => t === K.OWNER)));
check("the kit's shipped copies are byte-identical", L.byteIdentical());
done();
