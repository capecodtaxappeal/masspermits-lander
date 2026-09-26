// The ported _reconcile.js, its five Stripe readers, and RECONCILE_MAP.
//
//   node functions/api/reconcile.test.mjs
//
// Scenarios 25-28 are the change list's fixes, built from scratch with
// synthetic fixtures: 25 has_more must be a boolean; 26 churn coverage by
// exact endpoint path; 27 duplicate Stripe customers on one email; 28 the
// invariant stripe_entitled_total === considered + classified_other. Then the
// C8 readers (prices, promotion codes, Payment Links), fetchImpl REQUIRED,
// the private ref {row, sub}, acceptance 18(e) for the readers and 19 (every
// finding type is mapped, both columns; nothing reads reconcile()'s verdict).
// The global fetch is a stub that throws on anything it does not know.

import { join } from "node:path";
import { makeRunner, makeFetchStub, API_DIR, readText } from "../../test/rehearsal/harness.mjs";
import * as F from "../../test/rehearsal/r3a_fixtures.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";
import * as X from "./_reconcile.js";
import * as R from "./_rehearsal.js";

const { check, done } = makeRunner("reconcile.test.mjs");
let acct = F.healthyStripe();
const sw = F.stripeWorld(() => acct);
const stub = makeFetchStub({ ...sw.routes });
globalThis.fetch = stub.fetch;
const KEY = "rk_test_rehearsal";
const fi = (url, init) => stub.fetch(url, init);
const opts = { key: KEY, fetchImpl: fi };
const products = { masspermits_prices: [F.MP_PRICE], other_prices: [F.SIB_PRICE], masspermits: [F.MP_PRODUCT], other: [F.SIB_PRODUCT] };
const now = Date.parse("2026-10-17T20:30:00Z");
const types = (out) => Object.values(out.conditions).flatMap((c) => c.findings).concat(out.notices);
const find = (out, t) => types(out).filter((f) => f.type === t);
async function rec(o = {}) {
  const roster = o.roster ?? K.roster(3);
  const sr = o.sr ?? await X.listStripeSubscriptions(opts);
  const wh = o.wh ?? await X.listStripeWebhookEndpoints(opts);
  return X.reconcile({ roster, rosterReadable: true, sendLog: o.log ?? [], sendLogReadable: true,
    stripeResult: sr, webhookResult: wh, products: o.products ?? products, siteHost: "masspermits.com", now });
}

// ── fetchImpl is REQUIRED; no key means no call ─────────────────────────────
{
  const before = stub.calls.length;
  const readers = { listStripeSubscriptions: X.listStripeSubscriptions, listStripeWebhookEndpoints: X.listStripeWebhookEndpoints,
    listStripePrices: X.listStripePrices, listStripePromotionCodes: X.listStripePromotionCodes,
    listStripePaymentLinks: X.listStripePaymentLinks };
  for (const [n, fn] of Object.entries(readers)) {
    const r = await fn({ key: KEY });
    check(`18(e) ${n} without fetchImpl -> unreadable "no-fetch"`, r.readable === false && r.reason === "no-fetch", r.reason);
    const k = await fn({ fetchImpl: fi });
    check(`${n} without a key -> unreadable "no-key"`, k.readable === false && k.reason === "no-key", k.reason);
  }
  check("18(e) the readers without fetchImpl (or key) made 0 fetch calls, even with a global fetch installed",
    stub.calls.length === before, stub.calls.length - before);
  const src = readText(join(API_DIR, "_reconcile.js"));
  check("_reconcile.js never falls back to the global fetch", !/typeof fetch|globalThis\.fetch|[=:?(,]\s*fetch(?![A-Za-z0-9_$])/.test(src));
  check("_reconcile.js has 0 free fetch( calls", (src.match(/(?<![A-Za-z0-9_$.])fetch\s*\(/g) || []).length === 0);
}

// ── the readers: healthy, paging, pinned version, GET only ─────────────────
{
  acct = F.healthyStripe([1, 2, 3, 4, 5], { pageSize: 2 });
  const before = stub.calls.length;
  const s = await X.listStripeSubscriptions(opts);
  check("subscriptions paged on starting_after: 5 subs over 3 pages", s.readable && s.subs.length === 5 && s.pages === 3, s.pages);
  const calls = stub.calls.slice(before);
  check("every reader call is a GET with the pinned Stripe-Version and the key",
    calls.every((c) => c.method === "GET" && c.headers["stripe-version"] === X.STRIPE_API_VERSION &&
      c.headers.authorization === "Bearer " + KEY));
  check("the second page asks starting_after the last id of the first", calls[1].url.includes("starting_after=sub_TEST2"));
  const capped = await X.listStripeSubscriptions({ ...opts, maxPages: 2 });
  check("more pages than MAX_PAGES -> unreadable page-cap (never a partial set)", !capped.readable && capped.reason === "page-cap");
  acct = F.healthyStripe();
  const p = await X.listStripePrices(opts);
  check("listStripePrices: GET /v1/prices?active=true&limit=100 -> items with product and unit_amount",
    p.readable && p.items.length === 2 && p.items[0].product === F.MP_PRODUCT && p.items[0].unit_amount === 9900 &&
    stub.calls.at(-1).url.startsWith("https://api.stripe.com/v1/prices?") && stub.calls.at(-1).url.includes("active=true") &&
    stub.calls.at(-1).url.includes("limit=100"));
  const w = await X.listStripeWebhookEndpoints(opts);
  check("listStripeWebhookEndpoints keeps host and path only", w.readable && w.endpoints[0].url_host === "masspermits.com" &&
    w.endpoints[0].url_path === X.WEBHOOK_PATH && !("url" in w.endpoints[0]));
}

// ── 25: has_more must be a boolean ──────────────────────────────────────────
for (const name of ["subscriptions", "webhook_endpoints", "prices", "promotion_codes", "payment_links"]) {
  for (const bad of ["false", undefined, 0, null]) {
    acct = F.healthyStripe([1, 2, 3], { hasMore: { [name]: bad } });
    const fn = { subscriptions: X.listStripeSubscriptions, webhook_endpoints: X.listStripeWebhookEndpoints, prices: X.listStripePrices,
      promotion_codes: X.listStripePromotionCodes, payment_links: X.listStripePaymentLinks }[name];
    const r = await fn(opts);
    check(`25 ${name}: has_more ${JSON.stringify(bad)} -> unreadable bad-shape`, r.readable === false && r.reason === "bad-shape", r.reason);
  }
}
acct = F.healthyStripe();

// ── 26: churn coverage by exact endpoint path ──────────────────────────────
{
  const wh = (eps) => ({ readable: true, endpoints: eps.map((e) => ({ url_host: new URL(e.url).host, url_path: new URL(e.url).pathname,
    status: e.status, enabled_events: e.enabled_events })) });
  const t = async (eps) => types(await rec({ wh: wh(eps) })).map((f) => f.type)
    .filter((x) => /webhook|churn/.test(x));
  check("26 exact path with the churn event -> no endpoint finding", (await t([F.endpoint()])).length === 0);
  check("26 exact path without customer.subscription.deleted -> churn_event_not_subscribed",
    (await t([F.endpoint({ events: F.ALL_EVENTS.filter((e) => e !== "customer.subscription.deleted") })])).join() === "churn_event_not_subscribed");
  check("26 exact path with \"*\" -> covered", (await t([F.endpoint({ events: ["*"] })])).length === 0);
  check("26 only a different path on the host -> webhook_endpoint_path_ambiguous (not covered, not missing)",
    (await t([F.endpoint({ url: "https://masspermits.com/api/old-webhook" })])).join() === "webhook_endpoint_path_ambiguous");
  check("26 the exact path disabled, another path enabled -> ambiguous",
    (await t([F.endpoint({ status: "disabled" }), F.endpoint({ n: 2, url: "https://masspermits.com/hooks/stripe" })])).join() ===
      "webhook_endpoint_path_ambiguous");
  check("26 only another host -> no_enabled_webhook_endpoint_for_site",
    (await t([F.endpoint({ url: "https://sibling.example.com/api/stripe-webhook" })])).join() === "no_enabled_webhook_endpoint_for_site");
  check("26 a query string on the exact path still counts as the exact path",
    (await t([F.endpoint({ url: "https://masspermits.com/api/stripe-webhook?x=1" })])).length === 0);
}

// ── 27: duplicate Stripe customers on one email ────────────────────────────
{
  acct = F.healthyStripe([1, 2, 3], { subs: [F.stripeSub(1), F.stripeSub(2), F.stripeSub(3),
    F.stripeSub(4, { customer: "cus_TEST2b", email: "buyer2.testperson@example.com" })] });
  const out = await rec();
  const d = find(out, "duplicate_stripe_customers_same_email");
  check("27 two customers entitled under buyer 2's email -> duplicate_stripe_customers_same_email", d.length === 1);
  check("27 its ref names roster row 1 (buyer 2) and a subscription", d[0] && d[0].ref.row === 1 && Number.isInteger(d[0].ref.sub));
  acct = F.healthyStripe();
  check("27 twin: one customer per email -> no finding", find(await rec(), "duplicate_stripe_customers_same_email").length === 0);
}

// ── 28: the invariant ───────────────────────────────────────────────────────
{
  acct = F.healthyStripe([1, 2, 3], { subs: [F.stripeSub(1), F.stripeSub(2), F.stripeSub(3),
    F.stripeSub(9, { price: F.SIB_PRICE, product: F.SIB_PRODUCT, cents: 300 })] });
  const out = await rec();
  const mp = out.conditions.missing_payers.basis, up = out.conditions.unknown_products.basis;
  check("28 stripe_entitled_total === considered + classified_other (4 === 3 + 1)",
    mp.stripe_entitled_total === mp.stripe_entitled_considered + up.classified_other && mp.stripe_entitled_total === 4,
    JSON.stringify([mp.stripe_entitled_total, mp.stripe_entitled_considered, up.classified_other]));
  check("28 the invariant holds, so no invariant_broken finding", find(out, "invariant_broken").length === 0);
  acct = F.healthyStripe();
}

// ── the private ref, and de-duplication by ref ─────────────────────────────
{
  const roster = K.roster(4, (s, i) => (i >= 3 ? { ...s, active: false, cancelled: "2026-10-07" } : s));
  const log = [K.sendEntry(Date.parse("2026-10-12T14:00:00Z"), roster.slice(0, 2).map((s) => s.email)),
    K.sendEntry(Date.parse("2026-10-05T14:00:00Z"), roster.map((s) => s.email))];
  const out = await rec({ roster, log, sr: { readable: false, subs: [], reason: "no-key" } });
  const drops = find(out, "recipient_dropped_between_runs");
  check("two dropped buyers on ONE mail domain are two findings (the dedupe key includes ref)", drops.length === 2, drops.length);
  check("tripwire ref.row is each dropped buyer's roster index (2 and 3)", drops.map((f) => f.ref.row).sort().join() === "2,3");
  const dropBut = find(out, "dropped_but_still_active");
  check("any dropped_but_still_active notice carries a roster row index",
    dropBut.length === 0 || dropBut.every((f) => Number.isInteger(f.ref.row)));
  const every = types(out);
  check("every finding and notice carries ref {row, sub}", every.length > 0 && every.every((f) => f.ref && "row" in f.ref && "sub" in f.ref));
  acct = F.healthyStripe([1, 2, 3, 5]);
  const r5 = K.roster(5, (s, i) => (i === 5 ? { ...s, active: false, cancelled: "2026-09-01" } : i === 4 ? { ...s, active: false } : s));
  const out2 = await rec({ roster: r5 });
  const pin = find(out2, "payer_inactive_on_roster");
  check("payer_inactive_on_roster: ref.row = buyer 5's row (4), ref.sub = its subscription (3)",
    pin.length === 1 && pin[0].ref.row === 4 && pin[0].ref.sub === 3, JSON.stringify(pin.map((f) => f.ref)));
  acct = F.healthyStripe();
}

// ── the C8 readers ──────────────────────────────────────────────────────────
{
  acct = F.healthyStripe([1], { promos: [F.promo(1, F.coupon({ pct: 90, products: [F.MP_PRODUCT] })), F.promo(2, F.coupon({ amt: 1000 })),
    F.promo(3, "coupon_TEST_unexpanded")] });
  const p = await X.listStripePromotionCodes(opts);
  const last = stub.calls.at(-1).url;
  check("promotion codes: one GET asking the applies_to expansion on the pinned shape",
    p.readable && p.scope_expanded === true && decodeURIComponent(last).includes("expand[]=data.promotion.coupon.applies_to"));
  check("a scoped percent coupon: discount and product scope read", p.items[0].discount.percent_off === 90 &&
    p.items[0].scope.all === false && p.items[0].scope.products[0] === F.MP_PRODUCT);
  check("applies_to absent on an expanded coupon -> all products", p.items[1].scope.all === true && p.items[1].discount.amount_off === 1000);
  check("a coupon left as an id -> discount and scope unknown (null), never assumed", p.items[2].discount === null && p.items[2].scope === null);
  acct = { ...acct, refuseAppliesTo: true };
  const q = await X.listStripePromotionCodes(opts);
  check("the applies_to expansion refused -> second read, every scope unknown", q.readable && q.scope_expanded === false &&
    q.items.every((x) => x.scope === null) && q.items[0].discount.percent_off === 90);
  acct = F.healthyStripe([1], { links: Array.from({ length: 12 }, (_, k) => F.paymentLink(k + 1, [F.MP_PRICE])), refuseLinkExpand: true });
  const before = stub.calls.length;
  const l = await X.listStripePaymentLinks(opts);
  const li = stub.calls.slice(before).filter((c) => /\/line_items$|\/line_items\?/.test(c.url));
  check("Payment Links: expansion refused -> at most 10 GET /v1/payment_links/{id}/line_items", l.readable && li.length === 10, li.length);
  check("links beyond the 10 reads have prices null (unknown)", l.items.filter((x) => x.prices === null).length === 2 &&
    l.items[0].prices[0] === F.MP_PRICE);
  acct = F.healthyStripe();
  const l2 = await X.listStripePaymentLinks(opts);
  check("Payment Links with line_items expanded: one list read, prices read", l2.readable && l2.items[0].prices[0] === F.MP_PRICE);
  acct = F.healthyStripe([1], { fail: { prices: 403 } });
  const bad = await X.listStripePrices(opts);
  check("a 403 on prices -> unreadable forbidden-scope, never throws", !bad.readable && bad.reason === "forbidden-scope");
  acct = F.healthyStripe();
}

// ── 18(e): through the Function's own stripeGet ────────────────────────────
{
  const L = await K.loadRehearsal();
  const log = { data: { v: 1, records: [], mail: [] }, run: "1", async save() {} };
  const out = L.mod.outbound({ ...F.STRIPE_ENV }, { ok: true, rows: K.roster(2) }, log);
  const before = stub.calls.length;
  const o = { key: KEY, fetchImpl: out.stripeGet };
  await X.listStripeSubscriptions(o); await X.listStripeWebhookEndpoints(o); await X.listStripePrices(o);
  await X.listStripePromotionCodes(o); await X.listStripePaymentLinks(o);
  acct = { ...F.healthyStripe(), refuseLinkExpand: true };
  await X.listStripePaymentLinks(o);
  acct = F.healthyStripe();
  const calls = stub.calls.slice(before);
  const allowed = /^https:\/\/api\.stripe\.com\/v1\/(subscriptions|webhook_endpoints|prices|promotion_codes|payment_links)(\/[A-Za-z0-9_]+\/line_items)?\?/;
  check("18(e) every reader request through stripeGet is a GET to api.stripe.com/v1/{subscriptions,webhook_endpoints,prices,promotion_codes,payment_links...}",
    calls.length >= 7 && calls.every((c) => c.method === "GET" && allowed.test(c.url)), calls.map((c) => c.method + " " + c.url.split("?")[0]).join(" | "));
}

// ── 19: every finding type is mapped, both columns ─────────────────────────
{
  const src = readText(join(API_DIR, "_reconcile.js")).split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const lits = [...new Set([...src.matchAll(/\btype:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
  const nonLiteral = [...src.matchAll(/\btype:\s*([^"\s][^,\n]*)/g)].map((m) => m[1]);
  check("19 every `type:` in _reconcile.js is a string literal", nonLiteral.length === 0, nonLiteral.join(" | "));
  const keys = Object.keys(R.RECONCILE_MAP).sort();
  const missing = lits.filter((t) => !keys.includes(t));
  check(`19 every type literal (${lits.length}) is a key of RECONCILE_MAP`, missing.length === 0, missing.join(","));
  check("19 RECONCILE_MAP has no key reconcile() cannot produce", keys.every((k) => lits.includes(k)), keys.filter((k) => !lits.includes(k)).join(","));
  const leafOk = (c, depth = 0) => {
    if (!c || typeof c !== "object" || depth > 4) return false;
    if (c.none || c.not_produced || c.special === "cancellation") return true;
    if (c.attach) return typeof c.line === "string";
    if (c.bySeverity) return Object.values(c.bySeverity).every((x) => leafOk(x, depth + 1));
    if (c.bySubject) return Object.values(c.bySubject).every((x) => leafOk(x, depth + 1));
    if (c.byReason) return "*" in c.byReason && Object.values(c.byReason).every((x) => leafOk(x, depth + 1));
    return ["C7", "C8"].includes(c.id) && R.RESULTS.includes(c.result) && typeof c.code === "string" && /^C[78]\./.test(c.code);
  };
  const bad = keys.filter((k) => !(leafOk(R.RECONCILE_MAP[k].key) && leafOk(R.RECONCILE_MAP[k].nokey)));
  check("19 every key maps to a result for BOTH columns (with the key; without it or Stripe unreadable)", bad.length === 0, bad.join(","));
  check("19 read_failed covers all four reads", ["roster", "send_log", "stripe_subscriptions", "stripe_webhook_endpoints"]
    .every((s) => s in R.RECONCILE_MAP.read_failed.key.bySubject));
  // nothing reads reconcile()'s verdict, condition_verdicts, alarms or counts
  const added = ["functions/api/rehearsal.js", "functions/api/_rehearsal.js", "functions/api/_rehearsal_mail.js",
    "functions/api/_ro_bucket.js"].map((p) => [p, readText(join(API_DIR, "..", "..", p))]);
  for (const [p, s] of added) {
    check(`19 ${p}: 0 matches for recon.(verdict|condition_verdicts|alarms|counts)`,
      !/\brecon\.(verdict|condition_verdicts|alarms|counts)\b/.test(s) && !/\brecon\s*\[/.test(s));
    check(`19 ${p}: no destructuring of those names from recon`,
      !/\{[^{}]*\b(verdict|condition_verdicts|alarms|counts)\b[^{}]*\}\s*=\s*(await\s+)?(recon|reconcile)\b/.test(s));
  }
  const code = (x) => x.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const reh = code(added[0][1]);
  const binds = [...reh.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+reconcile\s*\(/g)].map((m) => m[1]);
  check("19 rehearsal.js binds reconcile()'s return value only to `recon`", binds.length === 1 && binds[0] === "recon", binds.join(","));
  check("19 in rehearsal.js `recon` is used only as that binding and passed to mapReconcile",
    (reh.match(/\brecon\b/g) || []).length === 2 && /mapReconcile\(recon,/.test(reh));
  check("19 reconcile() is called in no other added file (code, comments stripped)",
    added.slice(1).every(([, s]) => !/\breconcile\s*\(/.test(code(s))));
}

// ── 19: behaviour of the map ────────────────────────────────────────────────
{
  const rows = K.roster(3);
  const f = (type, extra = {}) => ({ type, severity: "red", subject: "x", ref: { row: 1, sub: 0 }, ...extra });
  const one = (finding, keyed, notices = []) => R.mapReconcile({ conditions: { a: { findings: finding ? [finding] : [] } }, notices,
    local_tripwire: { prev_at: "2026-10-05T14:00:00Z" } }, { rows, stripeResult: { readable: keyed, subs: [] }, products, keyed });
  const a = one(f("payer_inactive_on_roster"), true);
  check("map: payer_inactive_on_roster with the key -> NO-GO C7.paid_not_served on buyer 2",
    a.length === 1 && a[0].result === "NO-GO" && a[0].code === "C7.paid_not_served" && a[0].buyer_numbers[0] === 2);
  const b = one(f("payer_inactive_on_roster"), false);
  check("map: the same type in the no-key column (not produced) -> BLIND C7.unmapped, never PASS or NO-GO",
    b.length === 1 && b[0].result === "BLIND" && b[0].code === "C7.unmapped");
  const u = one(f("a_type_nobody_knows"), true);
  check("map: an injected unknown type -> BLIND C7.unmapped", u[0].result === "BLIND" && u[0].code === "C7.unmapped");
  const c7 = R.checkC7({ roster: { ok: true, rows }, sendLog: [], sendLogOk: true, date: "2026-10-17", mode: "sat", now,
    stripe: { keyed: true, readable: true, subs: [] }, priceIds: [F.MP_PRICE], mapped: u });
  check("19 C7 with an unmapped type is BLIND C7.unmapped: never PASS, never NO-GO",
    c7.some((r) => r.code === "C7.unmapped" && r.result === "BLIND") && !c7.some((r) => r.result === "NO-GO") &&
    !c7.every((r) => r.result === "PASS"));
  const sev = (s) => one(f("duplicate_roster_rows_same_email", { severity: s }), false)[0];
  check("map: duplicate rows red -> NO-GO C7.duplicate_active_rows; amber -> WARN C7.duplicate_rows_latent",
    sev("red").code === "C7.duplicate_active_rows" && sev("red").result === "NO-GO" &&
    sev("amber").code === "C7.duplicate_rows_latent" && sev("amber").result === "WARN");
  const rf = (subject, reason) => one(f("read_failed", { subject, reason, severity: "blocking" }), false);
  check("map: read_failed stripe_subscriptions no-key -> BLIND C7.no_key", rf("stripe_subscriptions", "no-key")[0].code === "C7.no_key");
  check("map: read_failed stripe_subscriptions forbidden-scope -> BLIND C7.stripe_unreadable",
    rf("stripe_subscriptions", "forbidden-scope")[0].code === "C7.stripe_unreadable");
  check("map: read_failed send_log -> BLIND C7.send_log_unreadable", rf("send_log", "unreadable")[0].code === "C7.send_log_unreadable");
  check("map: read_failed webhook endpoints -> C8 BLIND C8.endpoints_unreadable",
    rf("stripe_webhook_endpoints", "no-key")[0].id === "C8" && rf("stripe_webhook_endpoints", "x")[0].code === "C8.endpoints_unreadable");
  check("map: read_failed roster -> no result (not reached)", rf("roster", "x").length === 0);
  const n = one(f("roster_active_no_live_subscription"), true, [{ type: "stripe_returned_nothing", ref: { row: null, sub: null } }]);
  check("map: stripe_returned_nothing -> a line under the C7.served_not_paid lines",
    n.length === 1 && n[0].code === "C7.served_not_paid" && n[0].detail_private.includes("check that STRIPE_READ_KEY is a live-mode key"));
  const quiet = ["dropped_but_still_active", "below_floor_unrostered", "matched_by_email_only", "trialing_and_served",
    "pause_collection", "cancel_at_period_end"].map((t) => one(null, true, [{ type: t, ref: { row: 0, sub: 0 } }]).length);
  check("map: the listed notices produce no C7 result (with the key)", quiet.every((x) => x === 0));
  const leak = JSON.stringify(R.mapReconcile({ conditions: { a: { findings: [f("customer_id_conflict",
    { subject: "…@example.com", detail: "Error: secret at buyer2.testperson@example.com" })] } } },
  { rows, stripeResult: { readable: true, subs: [] }, products, keyed: true }));
  check("map: subject and detail never reach a result", !leak.includes("@") && !leak.includes("Error"));
}

check("fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
done();
