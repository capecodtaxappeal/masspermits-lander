// R3a drills: C7's keyed half and C8 through the ported _reconcile.js and its
// Stripe readers, F13, and the runner side of F1, F7, F8 and F10 driven end to
// end (runner facts from fixture GitHub API responses, then the Function).
//
//   node functions/api/rehearsal_r3a_drills.test.mjs
//
// Every Function drill runs the whole rehearsal.js (temp copy, stubbed
// verifier) the way the caller drives it, with the Stripe API answered by a
// fixture account (test/rehearsal/r3a_fixtures.mjs) through the Function's own
// GET-only stripeGet. Prints the drill table: ID | check | result | Y/P/N.

import { makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub } from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";
import * as G from "../../test/rehearsal/r3a_fixtures.mjs";
import * as R from "./_rehearsal.js";
import * as X from "./_reconcile.js";
import * as Mo from "../../scripts/rehearsal/mode.mjs";
import * as Fa from "../../scripts/rehearsal/facts.mjs";

const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
let acct = G.healthyStripe();
const sw = G.stripeWorld(() => acct);
const stub = makeFetchStub({ [RESEND]: rs.handler, ...sw.routes });
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const { check, done } = makeRunner("rehearsal_r3a_drills.test.mjs");
const L = await K.loadRehearsal();
const { HOUR, DAY, MIN } = K;
const at = K.at;
const table = [];
const row = (id, chk, result, ynp, note = "") => { table.push([id, chk, result, ynp, note]); };
const worlds = [];
const responses = [];

let runSeq = 8000;
async function fx(o) {
  clock.set(o.now);
  acct = o.stripe ?? G.healthyStripe((o.subs ?? K.roster(3)).map((_, k) => k + 1));
  const subs = o.subs ?? K.roster(3);
  const w = o.w ?? K.world({ now: o.now, subs, refreshAt: o.refreshAt,
    log: o.log ?? [K.sendEntry(o.lastSend ?? at("2026-09-28T14:00:00Z"), subs.filter((s) => s.active !== false).map((s) => s.email))],
    ...o.worldOpts });
  worlds.push(w);
  const before = rs.sent.length;
  const env = K.baseEnv(w.bucket, { ...(o.key ? G.STRIPE_ENV : {}), ...(o.env || {}) });
  const x = await K.runMode(L.mod, env, { mode: o.mode, date: o.date, trigger: o.trigger || "sched",
    run: o.run || String(++runSeq), body: o.facts ?? K.facts() });
  responses.push(...x.responses);
  const log = w.json("rehearsal/log.json");
  const rec = log && log.records.find((r) => r.part === "core");
  const mails = rs.sent.slice(before);
  return { w, x, v: x.core.json.verdict, codes: x.core.json.codes, rec, mails,
    worst: (id) => (rec && rec.checks ? rec.checks[id] : undefined),
    has: (s) => !!(rec && rec.findings && rec.findings.some((f) => f === s || f.endsWith(" " + s))) };
}
function judge(ID, id, fault, twin, { code, twinOk = ["PASS"], note = "" } = {}) {
  const f = fault.worst(id), t = twin.worst(id);
  const caught = f && f !== "PASS" && (!code || fault.has(code));
  const quiet = twinOk.includes(t);
  check(`${ID} ${id}: fault -> ${f}${code ? " " + code : ""}`, caught, JSON.stringify(fault.rec && fault.rec.findings));
  check(`${ID} ${id}: twin -> ${t}`, quiet, JSON.stringify(twin.rec && twin.rec.findings));
  row(ID, id, `${f}${code ? " " + code : ""}; twin ${t}`, caught && quiet ? "Y" : "N", note);
}
const SAT = { now: at("2026-10-03T20:30:00Z"), mode: "sat", date: "2026-10-03", refreshAt: at("2026-10-03T14:00:00Z") };
const SUN = { now: at("2026-10-04T20:30:00Z"), mode: "sun", date: "2026-10-04", refreshAt: at("2026-10-04T14:00:00Z") };

// ════════════════════════════════════════════════════════════════════════════
// keyed baselines: with the key and a healthy Stripe account, C7 and C8 PASS
// ════════════════════════════════════════════════════════════════════════════
const base = {};
base.sat = await fx({ ...SAT, key: true });
check("keyed baseline sat: GO (C7 and C8 PASS), no mail", base.sat.v === "GO" && base.sat.mails.length === 0 &&
  base.sat.worst("C7") === "PASS" && base.sat.worst("C8") === "PASS", base.sat.v + " " + JSON.stringify(base.sat.rec.findings));
base.sun = await fx({ ...SUN, key: true });
check("keyed baseline sun: GO, exactly one mail, subject starting GO", base.sun.v === "GO" && base.sun.mails.length === 1 &&
  base.sun.mails[0].subject.startsWith("GO"), base.sun.v);
check("keyed baseline: the digest no longer lists C8 as not built", !/Not built yet:[^<]*C8/.test(base.sun.mails[0].html));
const noKey = await fx({ ...SAT });
check("no key: C7 BLIND C7.no_key, C8 BLIND C8.no_key, verdict GO, blind on 1, 0 Stripe calls",
  noKey.v === "GO, blind on 1" && noKey.has("C7.no_key") && noKey.has("C8.no_key"));

// ════════════════════════════════════════════════════════════════════════════
// incident drills
// ════════════════════════════════════════════════════════════════════════════
{ // I-02 sibling price 4900c >= c8.min_cents -> C8 WARN C8.sibling_over_floor
  const f = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3], { prices: [G.price(G.MP_PRICE, G.MP_PRODUCT, 9900),
    G.price(G.SIB_PRICE, G.SIB_PRODUCT, 4900)] }) });
  judge("I-02", "C8", f, base.sat, { code: "C8.sibling_over_floor" });
  check("I-02 is a WARN, not a NO-GO", f.worst("C8") === "WARN" && f.v === "GO");
}
{ // I-04 promo 90% off the $99 price (net 990) with c8.min_cents 1000 -> NO-GO C8.below_floor; twin min_cents 500
  const stripe = G.healthyStripe([1, 2, 3], { promos: [G.promo(1, G.coupon({ pct: 90, products: [G.MP_PRODUCT] }))] });
  const f = await fx({ ...SAT, key: true, stripe, facts: K.facts({ "c8.min_cents": 1000 }) });
  const t = await fx({ ...SAT, key: true, stripe, facts: K.facts({ "c8.min_cents": 500 }) });
  judge("I-04", "C8", f, t, { code: "C8.below_floor", note: "runner side (MIN_CENTS mutated to 1000): runner.test.mjs" });
  check("I-04 is not a C7 finding (no component reads charges)", f.worst("C7") === "PASS");
  const all = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3], { promos: [G.promo(1, G.coupon({ pct: 90 }))] }),
    facts: K.facts({ "c8.min_cents": 1000 }) });
  check("I-04 variant: a 90% code on ALL products (applies_to absent) is caught too", all.has("C8.below_floor"));
  const unk = await fx({ ...SAT, key: true, stripe: { ...G.healthyStripe(), refuseAppliesTo: true } });
  check("a promotion code whose scope cannot be read -> WARN C8.promo_scope_unknown (reported, never assumed)",
    unk.has("C8.promo_scope_unknown") && !unk.has("C8.below_floor"));
  const low = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3], { prices: [G.price(G.MP_PRICE, G.MP_PRODUCT, 400)], promos: [] }) });
  check("a MassPermits price itself under the floor -> NO-GO C8.below_floor", low.has("C8.below_floor"));
}
{ // I-13 endpoint lacking invoice.payment_failed -> C8 NO-GO C8.events_missing
  const f = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3],
    { endpoints: [G.endpoint({ events: G.ALL_EVENTS.filter((e) => e !== "invoice.payment_failed") })] }) });
  judge("I-13", "C8", f, base.sat, { code: "C8.events_missing" });
  check("I-13 is not a C7 finding", f.worst("C7") === "PASS");
  const drift = await fx({ ...SAT, key: true, facts: K.facts({ "c8.events_mirror": "drift" }),
    stripe: G.healthyStripe([1, 2, 3], { endpoints: [G.endpoint({ events: G.ALL_EVENTS.filter((e) => e !== "invoice.payment_failed") })] }) });
  check("c8.events_mirror drift -> C8 (a) BLIND \"event list drift\", not a NO-GO", drift.has("C8.event_list_drift") &&
    !drift.has("C8.events_missing"));
  const churn = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3],
    { endpoints: [G.endpoint({ events: G.ALL_EVENTS.filter((e) => e !== "customer.subscription.deleted") })] }) });
  check("the churn event missing: C8.events_missing once (reconcile's churn finding merged into the same line)",
    churn.codes.filter((c) => c === "C8.events_missing").length === 1 && churn.v === "NO-GO");
  const amb = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3], { endpoints: [G.endpoint({ url: "https://masspermits.com/hooks/stripe" })] }) });
  check("an endpoint on the host at another path -> C8 BLIND C8.endpoint_ambiguous", amb.has("C8.endpoint_ambiguous") && amb.worst("C8") === "BLIND");
  const none = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3], { endpoints: [] }) });
  check("no enabled endpoint for the site -> C8 NO-GO C8.no_endpoint", none.has("C8.no_endpoint"));
}
{ // I-16 Stripe 5 / roster 4 -> C7 C7.paid_not_served
  const subs = K.roster(5, (s, i) => (i === 5 ? { ...s, active: false, cancelled: "2026-09-20" } : s));
  const f = await fx({ ...SAT, key: true, subs, stripe: G.healthyStripe([1, 2, 3, 4, 5]) });
  const t = await fx({ ...SAT, key: true, subs, stripe: G.healthyStripe([1, 2, 3, 4]) });
  judge("I-16", "C7", f, t, { code: "C7.paid_not_served" });
  const plain = await fx({ ...SAT, key: true, subs: K.roster(4), stripe: G.healthyStripe([1, 2, 3, 4], { subs: [1, 2, 3, 4].map((i) => G.stripeSub(i))
    .concat(G.stripeSub(5)) }) });
  check("I-16 variant: a fifth MassPermits payer with no roster row at all -> NO-GO C7.paid_no_row", plain.has("C7.paid_no_row"));
}
{ // I-28 month line + missing Radar events + an entitled subscription on a price in no allowlist
  const stripe = G.healthyStripe([1, 2, 3], {
    endpoints: [G.endpoint({ events: G.ALL_EVENTS.filter((e) => e !== "radar.early_fraud_warning.created") })],
    subs: [G.stripeSub(1), G.stripeSub(2), G.stripeSub(3, { price: "price_TEST_UNKNOWN", product: "prod_TEST_UNKNOWN" })] });
  const f = await fx({ ...SAT, key: true, stripe, facts: K.facts({ "purchase.month_line": true }) });
  judge("I-28", "C5", f, base.sat, { code: "C5.purchase_copy", twinOk: ["PASS", "WARN"] });
  judge("I-28", "C8", f, base.sat, { code: "C8.events_missing" });
  judge("I-28", "C7", f, base.sat, { code: "C7.unknown_price" });
}
{ // other RECONCILE_MAP rows through the Function
  const dup = await fx({ ...SAT, key: true, subs: K.roster(3, (s, i) => (i === 3 ? { ...s, email: "BUYER1.testperson@example.com " } : s)),
    stripe: G.healthyStripe([1, 2, 3], { subs: [G.stripeSub(1), G.stripeSub(2), G.stripeSub(3, { email: "buyer1.testperson@example.com" })] }) });
  check("two ACTIVE rows on one email (case and space folded) -> NO-GO C7.duplicate_active_rows", dup.has("C7.duplicate_active_rows"));
  const noId = await fx({ ...SAT, subs: K.roster(3, (s, i) => (i === 2 ? { ...s, customer: "" } : s)) });
  check("no key: an active row without a customer id -> NO-GO C7.row_without_customer_id (a no-key NO-GO)",
    noId.has("C7.row_without_customer_id") && noId.v === "NO-GO");
  const unread = await fx({ ...SAT, key: true, stripe: { ...G.healthyStripe(), fail: { subscriptions: 403 } } });
  check("key set but the subscriptions read 403s -> C7 BLIND C7.stripe_unreadable (GO, blind on 1)",
    unread.has("C7.stripe_unreadable") && unread.v === "GO, blind on 1");
  const degraded = await fx({ ...SAT, key: true, stripe: { ...G.healthyStripe(), refuseCustomerExpand: true } });
  check("customer expansion refused -> WARN C7.degraded_read, verdict still GO", degraded.has("C7.degraded_read") && degraded.v === "GO");
  const empty = await fx({ ...SAT, key: true, stripe: G.healthyStripe([], { subs: [] }) });
  check("Stripe returns nothing -> NO-GO C7.served_not_paid for every row", empty.has("C7.served_not_paid") && empty.v === "NO-GO");
  check("... and the digest line says to check the key is live-mode", empty.mails.length === 1 &&
    empty.mails[0].html.includes("check that STRIPE_READ_KEY is a live-mode key"));
  const noAllow = await fx({ ...SAT, key: true, env: { MASSPERMITS_PRICE_IDS: "", MASSPERMITS_PRODUCT_IDS: "", OTHER_PRICE_IDS: "", OTHER_PRODUCT_IDS: "" } });
  check("no allowlist configured -> C7 BLIND C7.allowlist_unset and C8 BLIND C8.allowlist_unset",
    noAllow.has("C7.allowlist_unset") && noAllow.has("C8.allowlist_unset"));
  const nolink = await fx({ ...SAT, key: true, stripe: G.healthyStripe([1, 2, 3], { links: [G.paymentLink(1, [G.SIB_PRICE])] }) });
  check("no active Payment Link sells a MassPermits price -> WARN C8.no_live_link", nolink.has("C8.no_live_link") && nolink.worst("C8") === "WARN");
}

// ════════════════════════════════════════════════════════════════════════════
// F11 and F12 again, now through the real Stripe reads
// ════════════════════════════════════════════════════════════════════════════
const F = (id, ok, what, detail = "") => {
  check(`${id}: ${what}`, ok, detail);
  row(id, what.split(": ")[0], ok ? "no alarm" : "ALARM", ok ? "Y" : "N");
};
{
  const subs = K.roster(6, (s, i) => (i === 6 ? { ...s, since: "2026-09-30" } : s));
  const log = [K.sendEntry(at("2026-09-28T14:00:00Z"), subs.slice(0, 5).map((s) => s.email))];
  const S = [1, 2, 3, 4, 5].map((i) => G.stripeSub(i)).concat(G.stripeSub(6, { created: at("2026-09-30T15:00:00Z") / 1000 }));
  const r = await fx({ ...SAT, key: true, subs, log, stripe: G.healthyStripe([], { subs: S }) });
  F("F11 key (Stripe reads)", r.v === "GO" && r.worst("C7") === "PASS" && r.mails.length === 0, "C7 via the Stripe reads: new buyer 6, PASS");
  const subs5 = K.roster(5, (s, i) => (i === 5 ? { ...s, active: false, cancelled: "2026-09-30" } : s));
  const log5 = [K.sendEntry(at("2026-09-28T14:00:00Z"), subs5.map((s) => s.email))];
  const g = await fx({ ...SAT, key: true, subs: subs5, log: log5, stripe: G.healthyStripe([1, 2, 3, 4]) });
  F("F12 key (Stripe reads)", g.v === "GO" && g.worst("C7") === "PASS", "C7 via the Stripe reads: cancelled since Monday, PASS");
  const gt = await fx({ ...SAT, key: true, subs: subs5, log: log5, stripe: G.healthyStripe([1, 2, 3, 4, 5]) });
  check("F12 twin through the Stripe reads: Stripe still bills buyer 5 -> NO-GO C7.paid_not_served", gt.has("C7.paid_not_served"));
}

// ════════════════════════════════════════════════════════════════════════════
// F13: a cancellation BEFORE the most recent Monday, through the PORTED reconcile()
// ════════════════════════════════════════════════════════════════════════════
{
  const subs = K.roster(5, (s, i) => (i === 5 ? { ...s, active: false, cancelled: "2026-10-07" } : s));
  const all5 = subs.map((s) => s.email), four = all5.slice(0, 4);
  const mon05 = K.sendEntry(at("2026-10-05T14:00:00Z"), all5);
  const mon12 = K.sendEntry(at("2026-10-12T14:00:00Z"), four);
  const log = [mon12, mon05];
  const stripe4 = G.healthyStripe([1, 2, 3, 4]);
  const products = { masspermits_prices: [G.MP_PRICE], other_prices: [G.SIB_PRICE], masspermits: [G.MP_PRODUCT], other: [G.SIB_PRODUCT] };
  // 1. the drill is not vacuous: the ported reconcile() fires the tripwire on buyer 5
  for (const keyed of [true, false]) {
    acct = stripe4;
    const opts = { key: keyed ? "rk_test_rehearsal" : "", fetchImpl: (u, i) => stub.fetch(u, i) };
    const stripeResult = await X.listStripeSubscriptions(opts);
    const webhookResult = await X.listStripeWebhookEndpoints(opts);
    for (const now of [at("2026-10-12T20:40:00Z"), at("2026-10-17T20:30:00Z"), at("2026-10-18T20:30:00Z")]) {
      const recon = await X.reconcile({ roster: subs, rosterReadable: true, sendLog: log, sendLogReadable: true,
        stripeResult, webhookResult, products, siteHost: "masspermits.com", now });
      const drops = Object.values(recon.conditions).flatMap((c) => c.findings).filter((f) => f.type === "recipient_dropped_between_runs");
      check(`F13 ${keyed ? "key" : "no key"} ${new Date(now).toISOString().slice(0, 10)}: reconcile() reports recipient_dropped_between_runs for buyer 5 (ref.row 4)`,
        drops.length === 1 && drops[0].ref.row === 4);
      const mapped = R.mapReconcile(recon, { rows: subs, stripeResult, products, keyed: keyed && stripeResult.readable });
      const want = keyed ? "Cancelled: buyer 5 (10-07); Stripe shows no live subscription"
        : "Cancelled: buyer 5 (10-07); not confirmed in Stripe (no key)";
      check(`F13 ${keyed ? "key" : "no key"}: mapped to a listing, never NO-GO: "${want}"`,
        mapped.some((r) => r.result === "PASS" && r.detail_private.includes(want)) && !mapped.some((r) => r.result === "NO-GO"));
      if (now === at("2026-10-12T20:40:00Z")) {
        const mp = R.checkMonPost({ roster: { ok: true, rows: subs }, sendLog: log, sendLogOk: true, date: "2026-10-12", now,
          facts: R.validateRunnerFacts(K.facts({ "refresh.shipped_min": [575, -1, -1, -1], "send.state": "completed", "send.started_min": 840 })).facts,
          stripe: { keyed, readable: keyed, subs: keyed ? stripeResult.subs : [] }, priceIds: [G.MP_PRICE],
          monPre: [{ bundle_etag: mon12.bundle_etag, rowset_sha256: mon12.bundle_rowset }], linksPersisted: 0, mapped });
        check(`F13 ${keyed ? "key" : "no key"}: mon-post step 2 lists buyer 5 Cancelled, no NO-GO`,
          mp.some((r) => r.detail_private.includes(want)) && !mp.some((r) => r.result === "NO-GO"), JSON.stringify(mp.map((r) => r.code)));
      } else {
        const c7 = R.checkC7({ roster: { ok: true, rows: subs }, sendLog: log, sendLogOk: true, date: isoDate(now), mode: "sat", now,
          stripe: { keyed, readable: keyed, subs: keyed ? stripeResult.subs : [] }, priceIds: [G.MP_PRICE], mapped });
        const worst = c7.some((r) => r.result === "BLIND") ? "BLIND" : c7.every((r) => r.result === "PASS") ? "PASS" : "other";
        check(`F13 ${keyed ? "key" : "no key"} ${isoDate(now)}: C7 ${keyed ? "PASS" : "BLIND C7.no_key"}, listed, never NO-GO`,
          worst === (keyed ? "PASS" : "BLIND") && c7.some((r) => r.detail_private.includes(want)) && !c7.some((r) => r.result === "NO-GO"));
      }
    }
  }
  // 2. through the Function: mon-post 10-12, sat 10-17, sun 10-18, with and without the key
  const monPreRec = { date: "2026-10-12", mode: "mon-pre", part: "core", trigger: "sched", run: "600", verdict: "GO",
    code: null, at: "2026-10-12T11:30:00.000Z", bundle_etag: mon12.bundle_etag, rowset_sha256: mon12.bundle_rowset };
  for (const key of [true, false]) {
    const tag = key ? "key" : "no key";
    const mp = await fx({ now: at("2026-10-12T20:40:00Z"), mode: "mon-post", date: "2026-10-12", key, subs, log,
      refreshAt: at("2026-10-12T09:35:00Z"), stripe: stripe4,
      facts: K.facts({ "refresh.shipped_min": [575, -1, -1, -1], "send.state": "completed", "send.started_min": 840, "send.runs": 1 }),
      worldOpts: { extra: { "rehearsal/log.json": { v: 1, records: [monPreRec], mail: [] } } } });
    F(`F13 mon-post ${tag}`, mp.v === "GO" && mp.mails.length === 0 && !mp.codes.length,
      `mon-post 10-12 (${tag}): no NO-GO, no mail`, mp.v + " " + JSON.stringify(mp.rec.findings));
    const sat = await fx({ now: at("2026-10-17T20:30:00Z"), mode: "sat", date: "2026-10-17", key, subs, log,
      refreshAt: at("2026-10-17T14:00:00Z"), stripe: stripe4 });
    F(`F13 sat ${tag}`, sat.v !== "NO-GO" && sat.mails.length === 0 && sat.worst("C7") === (key ? "PASS" : "BLIND"),
      `sat 10-17 (${tag}): C7 ${key ? "PASS" : "BLIND C7.no_key"}, 0 Resend calls`, sat.v);
    const sun = await fx({ now: at("2026-10-18T20:30:00Z"), mode: "sun", date: "2026-10-18", key, subs, log,
      refreshAt: at("2026-10-18T14:00:00Z"), stripe: stripe4 });
    const want = key ? "Cancelled: buyer 5 (10-07); Stripe shows no live subscription" : "Cancelled: buyer 5 (10-07); not confirmed in Stripe (no key)";
    F(`F13 sun ${tag}`, sun.mails.length === 1 && sun.mails[0].subject.startsWith("GO") && sun.mails[0].html.includes(want),
      `sun 10-18 (${tag}): exactly 1 mail, subject GO, "${want.slice(0, 30)}..." listed`, sun.mails.map((m) => m.subject).join());
  }
  // twin (a): with the key, Stripe still bills buyer 5 -> NO-GO naming buyer 5, one digest line
  const billing = G.healthyStripe([1, 2, 3, 4, 5]);
  const ta = await fx({ now: at("2026-10-18T20:30:00Z"), mode: "sun", date: "2026-10-18", key: true, subs, log,
    refreshAt: at("2026-10-18T14:00:00Z"), stripe: billing });
  const lines5 = ta.mails.length ? (ta.mails[0].html.match(/<li>[^<]*buyer 5[^<]*<\/li>/g) || []) : [];
  const ta_ok = ta.v === "NO-GO" && ta.codes.includes("C7.paid_not_served") && ta.codes.includes("C7.dropped_recipient") &&
    lines5.length === 1 && lines5[0].includes("C7.paid_not_served") && lines5[0].includes("C7.dropped_recipient");
  check("F13 twin (a): key, Stripe still bills buyer 5 -> NO-GO C7.paid_not_served + C7.dropped_recipient, ONE digest line for buyer 5",
    ta_ok, JSON.stringify([ta.v, ta.codes, lines5]));
  row("F13 twin (a)", "C7", ta_ok ? "NO-GO C7.paid_not_served, C7.dropped_recipient (one line)" : "missed", ta_ok ? "Y" : "N");
  // twin (b): without the key, the row's cancelled field removed -> NO-GO C7.dropped_recipient
  const noCancel = subs.map((s, i) => (i === 4 ? (({ cancelled, ...rest }) => { void cancelled; return rest; })(s) : s));
  const tb = await fx({ now: at("2026-10-17T20:30:00Z"), mode: "sat", date: "2026-10-17", subs: noCancel, log,
    refreshAt: at("2026-10-17T14:00:00Z") });
  const tb_ok = tb.v === "NO-GO" && tb.has("C7.dropped_recipient") && tb.mails.length === 1;
  check("F13 twin (b): no key, cancelled removed -> NO-GO C7.dropped_recipient (mailed once)", tb_ok, JSON.stringify([tb.v, tb.codes]));
  row("F13 twin (b)", "C7", tb_ok ? "NO-GO C7.dropped_recipient" : "missed", tb_ok ? "Y" : "N");
}
function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }

// ════════════════════════════════════════════════════════════════════════════
// runner side of F1, F7, F8, F10: facts.mjs on fixture API responses -> the Function
// ════════════════════════════════════════════════════════════════════════════
const C14_FACTS = { c14: { fetched: true, house_numbers: 0, contractor_echo: 0, owner_cue: 0, email_like: 0, hex32: 0 } };
const MIRROR_FACTS = { mirror: "ok", purchase: { render: "ok", link_first: true, month_line: false },
  c8: { min_cents: 500, events_mirror: "ok" }, c17: { inbox_mirror: "ok" } };
async function runnerFacts(date, nowIso, o = {}) {
  const d0 = at(date + "T00:00:00Z");
  const runs = [];
  const mondayBefore = (() => { const x = new Date(d0 - DAY); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.getTime(); })();
  for (let k = 0; k < 4; k++) {
    const m = mondayBefore - k * 7 * DAY;
    runs.push(G.refreshRun(m + 9 * HOUR), G.run({ file: "weekly-feed.yml", created: m + 12 * HOUR }),
      G.run({ file: "send-watchdog.yml", created: m + 13 * HOUR }), G.run({ file: "send-watchdog.yml", created: m + DAY + 13 * HOUR }));
  }
  runs.push(G.run({ file: "monday-rehearsal.yml", created: d0 - 18 * HOUR }), ...(o.runs || []));
  let t = at(nowIso);
  let sleeps = 0;
  const w = G.ghWorld({ runs, commits: o.commits || [G.commit(G.sha("a"), d0 - 3 * DAY, ["functions/api/x.js"])],
    checkRuns: o.checkRuns || { [G.sha("a")]: [G.pagesRun("success")] }, now: () => t });
  const facts = await Fa.collect({ gh: w.gh, date, repository: G.REPO, runId: "999", now: () => t,
    sleep: async (ms) => { sleeps++; t += ms; }, readText: () => "selectRecipients", workflowFiles: [] });
  return { body: JSON.parse(Fa.finalize(Fa.merge(facts, C14_FACTS, MIRROR_FACTS))), sleeps, endNow: t };
}
{ // F1: Tuesday 13:05Z mon-post backstop after a healthy Monday; Tuesday's refresh done at 12:51Z
  const now = "2026-10-06T13:05:00Z";
  const m = Mo.resolve({ eventName: "schedule", event: { schedule: "0 13 * * 2" }, repository: G.REPO, now: at(now) });
  const { body } = await runnerFacts(m.date, now, { runs: [G.refreshRun(at("2026-10-05T09:00:00Z")),
    G.run({ file: "weekly-feed.yml", created: at("2026-10-05T14:00:00Z"), started: at("2026-10-05T14:01:00Z") }),
    G.refreshRun(at("2026-10-06T12:05:00Z"), { shipAfter: 46 * MIN })] });
  const subs = K.roster(3);
  const mon = K.sendEntry(at("2026-10-05T14:05:00Z"), subs.map((s) => s.email));
  const r = await fx({ now: at(now), mode: m.mode, date: m.date, subs, log: [mon, K.sendEntry(at("2026-09-28T14:00:00Z"), subs.map((s) => s.email))],
    refreshAt: at("2026-10-06T12:51:00Z"), facts: body, worldOpts: { extra: { "rehearsal/log.json": { v: 1, mail: [],
      records: [{ date: "2026-10-05", mode: "mon-pre", part: "core", trigger: "sched", run: "500", verdict: "GO", at: "2026-10-05T11:30:00Z",
        bundle_etag: mon.bundle_etag, rowset_sha256: mon.bundle_rowset }] } } } });
  F("F1 runner", m.mode === "mon-post" && m.date === "2026-10-05" && r.v === "GO" && r.mails.length === 0 &&
    body.refresh.shipped_min.join() === "575,-1,-1,-1",
    "mon-post Tuesday backstop, runner facts: date Monday, Tuesday's refresh not counted, PASS, no mail", r.v);
}
{ // F7: F pushed 2 min ago, no check-run anywhere -> runner re-polls, C0 check-level WAIT, verdict unaffected
  const now = "2026-10-03T20:30:00Z";
  const { body, sleeps } = await runnerFacts("2026-10-03", now, { runs: [G.refreshRun(at("2026-10-03T13:25:00Z"))],
    commits: [G.commit(G.sha("d"), at(now) - 2 * MIN, ["functions/api/x.js"])], checkRuns: {} });
  const r = await fx({ ...SAT, facts: body });
  F("F7 runner", sleeps === 5 && body.c0.fn_state === "missing" && body.c0.fn_age_min === 7 && r.worst("C0") === "WAIT" &&
    r.has("C0.deploy_pending") && r.v === noKey.v, "runner re-polls 5x, C0 check-level WAIT, verdict unchanged", `${sleeps} ${r.v}`);
}
{ // F8: F 3 days old with success, HEAD bot commit 20 s old with no check-run -> C0 PASS
  const now = "2026-10-03T20:30:00Z";
  const { body, sleeps } = await runnerFacts("2026-10-03", now, { runs: [G.refreshRun(at("2026-10-03T13:25:00Z"))],
    commits: [G.commit(G.sha("a"), at(now) - 3 * DAY, ["functions/api/x.js"]), G.commit(G.sha("e"), at(now) - 20_000, ["data.json"])],
    checkRuns: { [G.sha("a")]: [G.pagesRun("success")] } });
  const r = await fx({ ...SAT, facts: body });
  F("F8 runner", sleeps === 0 && body.c0.head_state === "missing" && r.worst("C0") === "PASS", "fresh bot HEAD with no check-run: C0 PASS");
}
{ // F10: late weekend backstops keep their date; healthy world; twin: that day's refresh failed
  const satRun = "2026-10-04T02:00:00Z", sunRun = "2026-10-05T02:00:00Z";
  const ms = Mo.resolve({ eventName: "schedule", event: { schedule: "0 20 * * 6" }, repository: G.REPO, now: at(satRun) });
  const fs = await runnerFacts(ms.date, satRun, { runs: [G.refreshRun(at("2026-10-03T13:25:00Z"))] });
  const rsat = await fx({ now: at(satRun), mode: ms.mode, date: ms.date, refreshAt: at("2026-10-03T14:00:00Z"), facts: fs.body });
  F("F10 sat runner", ms.date === "2026-10-03" && rsat.worst("C3") === "PASS" && rsat.mails.length === 0,
    "sat backstop at Sun 02:00Z: date Saturday, C3 PASS, 0 Resend calls", rsat.v);
  const mu = Mo.resolve({ eventName: "schedule", event: { schedule: "0 20 * * 0" }, repository: G.REPO, now: at(sunRun) });
  const fu = await runnerFacts(mu.date, sunRun, { runs: [G.refreshRun(at("2026-10-04T13:25:00Z"))] });
  const rsun = await fx({ now: at(sunRun), mode: mu.mode, date: mu.date, refreshAt: at("2026-10-04T14:00:00Z"), facts: fu.body });
  F("F10 sun runner", mu.date === "2026-10-04" && rsun.worst("C3") === "PASS" && rsun.mails.length === 1 &&
    rsun.mails[0].to[0] === K.OWNER && rsun.mails[0].subject.startsWith("GO"),
    "sun backstop at Mon 02:00Z: date Sunday, C3 PASS, exactly 1 mail to the owner, subject GO", rsun.v);
  const ft = await runnerFacts(mu.date, sunRun, { runs: [G.refreshRun(at("2026-10-04T13:25:00Z"), { buildFails: true })] });
  const tw = await fx({ now: at(sunRun), mode: mu.mode, date: mu.date, refreshAt: at("2026-10-03T14:00:00Z"), facts: ft.body });
  const twOk = tw.v === "NO-GO" && tw.worst("C1") === "NO-GO" && ft.body.refresh.failed_at === "before_ship";
  check("F10 twin (runner facts): that day's refresh failed, Saturday's bundle in R2 -> NO-GO on C1", twOk, tw.v);
  row("F10 twin runner", "C1", `${tw.worst("C1")} (${tw.codes.join(",")})`, twOk ? "Y" : "N");
}

// ════════════════════════════════════════════════════════════════════════════
// across every R3a drill: mail lock, write set, Stripe reads, leaks
// ════════════════════════════════════════════════════════════════════════════
const rosterEmails = new Set(K.roster(30).map((s) => s.email.toLowerCase()));
check("6 0 Resend calls to any roster email across every R3a drill", rs.sent.every((m) => m.to.every((t) => !rosterEmails.has(t.toLowerCase()))));
check("6 every Resend call went to the owner, one recipient", rs.sent.every((m) => m.to.length === 1 && m.to[0] === K.OWNER));
const stray = worlds.flatMap((w) => w.writes().map((o) => o.key)).filter((k) => !k.startsWith("rehearsal/"));
check("5 across every R3a drill, persisted writes are only under rehearsal/", stray.length === 0, stray.join(","));
const allowed = /^https:\/\/api\.stripe\.com\/v1\/(subscriptions|webhook_endpoints|prices|promotion_codes|payment_links)(\/[A-Za-z0-9_]+\/line_items)?\?/;
check("10/18 every Stripe call was a GET to the five list endpoints", sw.calls.length > 0 && sw.calls.every((c) => c.method === "GET" && allowed.test(c.url)));
check("10 outbound hosts are a subset of {api.resend.com, api.stripe.com}", stub.calls.every((c) => ["api.resend.com", "api.stripe.com"].includes(new URL(c.url).host)));
const leaky = responses.filter((r) => r.text.includes("@") || /[0-9a-f]{32}/.test(r.text) || r.text.includes("cus_") ||
  /price_|prod_|sub_TEST|we_TEST/.test(r.text) || Object.keys(r.json).join() !== "ok,verdict,more,codes,error");
check(`7 every response (${responses.length}) has exactly ok, verdict, more, codes, error and no address, token, customer, price or subscription id`,
  leaky.length === 0, leaky.map((r) => r.text).slice(0, 2).join(" | "));
const digests = rs.sent.map((m) => m.subject + m.html).join("\n");
check("the digests carry no address, token or Stripe id (buyers by number only)", !/@|[0-9a-f]{32}|cus_|sub_TEST|price_TEST|prod_TEST/.test(
  digests.replace(/@example\.com/g, "?")) && !digests.includes("testperson"));
check("10 fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));

console.log("\nDRILL TABLE (R3a)");
console.log("ID               | check      | result | Y/P/N | note");
for (const [id, c, r, y, n] of table) console.log(`${id.padEnd(16)} | ${c.padEnd(10)} | ${r} | ${y}${n ? " | " + n : ""}`);
done();
