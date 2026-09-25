// MassPermits — Stripe↔roster reconciliation, v2. Pure logic + injectable reads.
//
// PROPOSED DESTINATION: functions/api/_reconcile.js  (underscore = not routed by
// Pages, same convention as _presend.js / _github-oidc.js). Routed entry point is
// stripe-reconcile.js.
//
// ─── WHAT CHANGED FROM v1, AND WHY ───────────────────────────────────────────
// v1 shipped a single flat verdict over a flat alarm list. Codex finding 2 asks
// for FIVE NAMED CONDITIONS, EACH WITH ITS OWN VERDICT. v1 could not express
// four of them:
//   • unknown products only surfaced when the payer ALSO had no roster row; an
//     unrecognised product on a matched customer was silently `continue`d.
//   • duplicate identities were never detected: byCustomer collected arrays and
//     never looked at their length; rowsWithEmail did the same.
//   • an id-less roster row was a NOTICE when email matched, so the row that can
//     never be deactivated by customer.subscription.deleted scored clean.
//   • classification keyed on PRODUCT id. Lead Pack and Radar are both 4900c, so
//     amount can never separate them — but two prices of one product cannot be
//     separated by product id either. v2 keys on PRICE id first.
// v2 also adds a GET of /v1/webhook_endpoints, which is the only read that turns
// "does a cancellation reach the roster" from unresolved into observed.
//
// ─── WHAT IT WILL AND WILL NOT DO ────────────────────────────────────────────
// READ-ONLY on both sides. Never writes subscribers.json, never writes R2, never
// mails a customer, never touches money. Every remedy is a human decision.
//
// NO ROSTER MIGRATION REQUIRED. Verified against the deployed row shape written
// at stripe-webhook.js:326-334 — {email, name, customer, since, active, token}.
// This control reads exactly `email`, `customer`, `active`. It reads product,
// price, subscription status and trial state FROM STRIPE. Nothing here needs a
// product/price/trial_end column on the roster, and adding one is a separate
// fulfilment task (see DEFERRED at the bottom of DESIGN.md).
//
// FAILS CLOSED. Every condition is tri-state. A condition whose inputs were not
// completely read is `indeterminate`, never `clean`. The overall verdict is `ok`
// only when all five conditions are clean; `red` whenever any alarm exists —
// including on top of an unreadable Stripe, so a read failure can never launder
// an already-provable roster failure into `blocked`.
//
// EVERY CONDITION CARRIES A BASIS. An empty findings array is meaningless
// without the count of what was actually compared, so each condition reports
// `basis` — the numbers whose absence turns "clean" into "nothing ran".
//
// DOMAIN-MASKED. Output lands in a PUBLIC GitHub Actions log. No email local
// part, no name, no download token, no Stripe id, no price id value ever leaves
// here. Identity appears as a domain suffix plus a salted 8-hex tag.

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// Pin the API version. With no Stripe-Version header a request silently uses the
// ACCOUNT DEFAULT, which a human can change in Workbench with no idea this
// control exists — reproducing the exact "derived state with no read-back"
// defect one layer up.
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

const STRIPE_SUBS_URL = "https://api.stripe.com/v1/subscriptions";
const STRIPE_WH_URL = "https://api.stripe.com/v1/webhook_endpoints";
const PAGE_LIMIT = 100; // max the endpoint allows; DEFAULT IS 10 if omitted
const MAX_PAGES = 20;

// Statuses that mean "entitled to the product right now".
//   trialing — Radar's 7-day trial; the webhook already ships a bundle for it
//              (stripe-webhook.js:248-253 isTrialStart).
//   past_due — deliberately still served. Dunning is still running and the
//              webhook only revokes on customer.subscription.deleted.
// Full enum: incomplete, incomplete_expired, trialing, active, past_due,
// canceled, unpaid, paused.
export const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

// THE FLOOR IS 500, NOT 1000. Used here for ONE narrow purpose: triaging an
// UNCLASSIFIED subscription that has no roster row, to decide alarm vs notice.
// It is NOT the product filter — see classifySub(). PermitPulse/send_weekly.py
// carries the stale 1000; copying it would classify every FIRST90 subscriber
// ($9.90 = 990c) as not-ours, i.e. report a paying customer as not paying.
export const MIN_CENTS = 500;

// The webhook event the roster's churn path depends on. stripe-webhook.js:38-40
// says so in its own comment: "(Requires the Stripe webhook destination to also
// subscribe to customer.subscription.deleted.)"
export const CHURN_EVENT = "customer.subscription.deleted";

// The five conditions Codex finding 2 names. Order is the report order.
export const CONDITIONS = [
  "missing_payers",
  "extra_roster_rows",
  "identity_conflicts",
  "unknown_products",
  "read_integrity",
];

// ─── STRIPE READS (injectable) ───────────────────────────────────────────────
//
// fetchImpl is injectable so the whole control can be replayed against recorded
// fixtures. There is no Stripe key on this machine and there must not be one.
//
// RETURNS, always, never throws:
//   { readable: true,  subs: [...], status: 200, requestId, pages, expanded }
//   { readable: false, subs: [],    status, reason, requestId, pages, expanded }
//
// `readable: true` is granted ONLY for HTTP 200 with a well-formed list body AND
// has_more === false on the final page. A partial result set is structurally
// identical to a complete one, so an implementation that breaks out of the loop
// on an error and then reconciles against what it has reports every unfetched
// payer as gone — a control that invents the exact failure it was built to find.
export async function listStripeSubscriptions(opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const key = opts.key || "";
  const version = opts.apiVersion || STRIPE_API_VERSION;
  const maxPages = opts.maxPages || MAX_PAGES;

  if (!fetchImpl) return unreadable("no-fetch", 0, null, 0, false, "no fetch implementation available");
  if (!key) {
    return unreadable("no-key", 0, null, 0, false,
      "no Stripe read key is configured on this deployment — the control cannot " +
      "see who is paying, so it reports blocked rather than clean");
  }

  // Try WITH expand[]=data.customer: the customer email is what turns "a payer
  // is missing" into "a payer is missing AND here is the id conflict that caused
  // it". On a restricted key lacking Customers:Read the expand 403s; retry once
  // without it rather than going dark.
  let expand = opts.expandCustomer === false ? false : true;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await pull(fetchImpl, key, version, expand, maxPages);
    if (r.readable) return { ...r, expanded: expand };
    if (r.status === 403 && expand) { expand = false; continue; }
    return { ...r, expanded: expand };
  }
  return unreadable("loop", 0, null, 0, expand, "pagination loop fell through");
}

// NEW IN v2 — the webhook-endpoint read.
//
// stripe-webhook.js:41-45 handles customer.subscription.deleted and
// deactivateSubscriber (:377-410) sets active:false. Whether that handler ever
// RUNS depends on whether the Stripe endpoint subscribes to the event, which is
// not a property of the repo, of R2, or of the subscriptions list. It is one
// GET. Without it "does a cancellation reach the roster" stays unresolved and
// every statement about trial or churn cleanup stays conditional.
//
// READS enabled_events, url and status ONLY. Never a secret, never a payload,
// never an event body. The endpoint's `secret` is returned only on create, so
// there is nothing sensitive in a list response beyond the URL — which is
// masspermits.com, already public. The URL is reported HOST-ONLY regardless.
//
// A 403 here is a REPORTABLE READ FAILURE, not an alarm and not a silent skip.
// That is Codex finding 2's "failed or incomplete reads" applied to the one read
// that was previously missing.
export async function listStripeWebhookEndpoints(opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const key = opts.key || "";
  const version = opts.apiVersion || STRIPE_API_VERSION;

  if (!fetchImpl) return { readable: false, endpoints: [], status: 0, reason: "no-fetch", requestId: null, detail: "no fetch implementation available" };
  if (!key) return { readable: false, endpoints: [], status: 0, reason: "no-key", requestId: null, detail: "no Stripe read key configured" };

  const u = new URL(STRIPE_WH_URL);
  u.searchParams.set("limit", String(PAGE_LIMIT));
  let resp;
  try {
    resp = await fetchImpl(u.toString(), {
      method: "GET",
      headers: { Authorization: "Bearer " + key, "Stripe-Version": version, Accept: "application/json" },
    });
  } catch (e) {
    return { readable: false, endpoints: [], status: 0, reason: "network", requestId: null,
      detail: "network/TLS failure: " + String((e && e.message) || e).slice(0, 160) };
  }
  const requestId = hdr(resp, "Request-Id");
  if (!(resp.status >= 200 && resp.status < 300)) {
    return { readable: false, endpoints: [], status: resp.status,
      reason: httpReason(resp.status, hdr(resp, "Stripe-Rate-Limited-Reason")), requestId,
      detail: resp.status === 403
        ? "HTTP 403 — the restricted key lacks Webhook Endpoints:Read. Grant it (read-only) " +
          "or accept that churn-event coverage stays UNREAD and this control stays blocked."
        : httpDetail(resp.status, hdr(resp, "Stripe-Rate-Limited-Reason"), requestId) };
  }
  let body = null;
  try { body = await resp.json(); } catch (_) { body = null; }
  if (!body || body.object !== "list" || !Array.isArray(body.data)) {
    return { readable: false, endpoints: [], status: resp.status, reason: "bad-shape", requestId,
      detail: "HTTP 200 but the body was not a Stripe list object" };
  }
  // has_more on this endpoint is possible but an account with >100 webhook
  // endpoints is not this account. Treat it as incomplete rather than guessing.
  if (body.has_more) {
    return { readable: false, endpoints: [], status: resp.status, reason: "page-cap", requestId,
      detail: "more than " + PAGE_LIMIT + " webhook endpoints exist; the listing is incomplete" };
  }
  const endpoints = body.data.map((e) => ({
    url_host: hostOf(e && e.url),
    status: String((e && e.status) || ""),
    enabled_events: Array.isArray(e && e.enabled_events) ? e.enabled_events.slice(0, 64) : [],
    api_version: (e && e.api_version) || null,
  }));
  return { readable: true, endpoints, status: resp.status, reason: null, requestId, detail: null };
}

async function pull(fetchImpl, key, version, expand, maxPages) {
  const subs = [];
  let startingAfter = null;
  let pages = 0;
  let requestId = null;

  while (pages < maxPages) {
    const u = new URL(STRIPE_SUBS_URL);
    // No `status` param: the endpoint then returns every subscription that has
    // NOT been canceled. A superset of ENTITLED_STATUSES, which is what we want —
    // holding the non-entitled ones lets the report say "this row's subscription
    // is `unpaid`" instead of the much weaker "no subscription".
    u.searchParams.set("limit", String(PAGE_LIMIT));
    if (expand) u.searchParams.append("expand[]", "data.customer");
    if (startingAfter) u.searchParams.set("starting_after", startingAfter);

    let resp;
    try {
      resp = await fetchImpl(u.toString(), {
        method: "GET",
        headers: {
          Authorization: "Bearer " + key,
          "Stripe-Version": version,
          Accept: "application/json",
        },
      });
    } catch (e) {
      return unreadable("network", 0, requestId, pages, expand,
        "network/TLS failure: " + String((e && e.message) || e).slice(0, 160));
    }

    // Log the Request-Id on EVERY call including failures — it is the only handle
    // Stripe support can act on, and its ABSENCE on a 429 is itself the signal
    // that the 429 was an object lock timeout rather than throttling.
    const rid = hdr(resp, "Request-Id");
    if (rid) requestId = rid;

    if (!(resp.status >= 200 && resp.status < 300)) {
      const rl = hdr(resp, "Stripe-Rate-Limited-Reason");
      return unreadable(httpReason(resp.status, rl), resp.status, requestId, pages, expand,
        httpDetail(resp.status, rl, requestId));
    }

    let body = null;
    try { body = await resp.json(); } catch (_) { body = null; }
    if (!body || body.object !== "list" || !Array.isArray(body.data)) {
      return unreadable("bad-shape", resp.status, requestId, pages, expand,
        "HTTP 200 but the body was not a Stripe list object");
    }

    pages++;
    for (const s of body.data) subs.push(s);

    // has_more is the ONLY completeness signal. There is no total_count, and a
    // short page is indistinguishable from a complete one by length.
    if (!body.has_more) {
      return { readable: true, subs, status: resp.status, reason: null, requestId, pages };
    }
    const last = body.data[body.data.length - 1];
    if (!last || !last.id) {
      return unreadable("no-cursor", resp.status, requestId, pages, expand,
        "has_more was true but the page carried no id to page from");
    }
    startingAfter = last.id;
  }

  return unreadable("page-cap", 200, requestId, pages, expand,
    `stopped after ${maxPages} pages with has_more still true — the set is ` +
    "incomplete and must not be compared against the roster");
}

function unreadable(reason, status, requestId, pages, expanded, detail) {
  return { readable: false, subs: [], status, reason, requestId, pages, expanded, detail };
}

function hdr(resp, name) {
  try { return (resp.headers && resp.headers.get && resp.headers.get(name)) || null; }
  catch (_) { return null; }
}

function hostOf(url) {
  try { return new URL(String(url || "")).host || "?"; } catch (_) { return "?"; }
}

// A restricted key MISSING a permission does not announce itself in the body:
// the error `type` enum has four values and a scope failure surfaces as a plain
// invalid_request_error. The distinguishing signal is the HTTP STATUS. So
// classify by status code, never by body text.
function httpReason(status, rlReason) {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden-scope";
  if (status === 429) return rlReason ? "rate-limited" : "lock-timeout";
  if (status === 424) return "external-dependency";
  if (status >= 500) return "stripe-server-error";
  return "http-" + status;
}

function httpDetail(status, rlReason, requestId) {
  const rid = requestId ? ` (Request-Id ${requestId})` : " (no Request-Id returned)";
  if (status === 401) return "HTTP 401 — no valid API key. The key may have been rotated or expired" + rid;
  if (status === 403) return "HTTP 403 — the restricted key lacks a required permission; check its request logs in the Dashboard and grant the resource that 403'd" + rid;
  if (status === 429 && rlReason) return `HTTP 429 rate limited (${rlReason})` + rid;
  if (status === 429) return "HTTP 429 with no Stripe-Rate-Limited-Reason header — this is an object LOCK TIMEOUT, not a rate limit; Stripe did not process the request" + rid;
  if (status === 424) return "HTTP 424 — an external dependency Stripe relies on failed" + rid;
  if (status >= 500) return `HTTP ${status} — something went wrong on Stripe's end` + rid;
  return `HTTP ${status}` + rid;
}

// ─── CLASSIFICATION — PRICE ID FIRST ─────────────────────────────────────────
//
// KEY ON PRICE ID, not amount and not display name.
//
// AMOUNT IS FATAL HERE: Lead Pack (one-time $49) and Farm Town Permit Radar
// ($49/mo) are BOTH 4900 cents. Any amount-based rule conflates a product that
// entitles nothing recurring with a product that entitles a monthly bundle. The
// deployed webhook is amount-based today (stripe-webhook.js:248-249) and that is
// precisely why a $0 Radar trial and a 100%-off Weekly Feed promo are
// indistinguishable to it.
//
// NAME IS FRAGILE: "Farm Town Permit Radar" shares no wording with the others,
// so any substring filter on "MassPermits" silently excludes those subscribers.
// Names are also mutable Dashboard metadata — renaming is a UI action with no
// code change, no deploy, no trace in the repo.
//
// PRODUCT ID is kept as a SECONDARY key, not dropped: it is the coarser grouping
// and catches a NEW price added under a known product, which a price-only
// allowlist would report as unknown on the day the owner changes a price.
//
// items.data[].price.id and .price.product are both returned inline on every
// listed subscription with no expand at all, so this costs nothing.
//
// The allowlists start EMPTY. No price id or product id exists anywhere in the
// lander repo — verified 2026-09-20T05:1xZ: `git grep -nE 'price_1|prod_[A-Za-z0-9]|PRICE_ID|lookup_key' origin/main -- functions/`
// returns zero hits. Empty is handled honestly: everything becomes
// `unclassified`, which never silently drops a subscription and never fabricates
// a roster failure — and which makes the unknown_products condition
// INDETERMINATE rather than clean.
export function classifySub(sub, products) {
  const p = products || {};
  const massPrice = new Set(p.masspermits_prices || []);
  const otherPrice = new Set(p.other_prices || []);
  const massProd = new Set(p.masspermits || []);
  const otherProd = new Set(p.other || []);

  const prices = subPrices(sub);
  const prods = subProducts(sub);

  // Price id wins, both directions, before any product fallback.
  if (massPrice.size && prices.some((x) => massPrice.has(x))) return { kind: "mass", matched_on: "price" };
  if (otherPrice.size && prices.some((x) => otherPrice.has(x))) return { kind: "other", matched_on: "price" };
  if (massProd.size && prods.some((x) => massProd.has(x))) return { kind: "mass", matched_on: "product" };
  if (otherProd.size && prods.some((x) => otherProd.has(x))) return { kind: "other", matched_on: "product" };
  return { kind: "unclassified", matched_on: null };
}

// v1 compatibility shim so nothing that imported classifyProduct silently breaks.
export function classifyProduct(sub, products) { return classifySub(sub, products).kind; }

export function subPrices(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  return items.map((i) => (i && i.price && i.price.id) || "").filter(Boolean);
}

export function subProducts(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  return items
    .map((i) => {
      const pr = i && i.price && i.price.product;
      return typeof pr === "string" ? pr : (pr && pr.id) || "";
    })
    .filter(Boolean);
}

export function subCents(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  return items.reduce((n, i) => n + (((i && i.price && i.price.unit_amount) || 0) * ((i && i.quantity) || 1)), 0);
}

// LANDMINE: current_period_end/_start were REMOVED from the Subscription object
// in API version 2025-03-31.basil. They live on the subscription ITEM now.
// Reading sub.current_period_end on any current version yields `undefined`, and
// a naive comparison against Date.now() then produces a confident wrong verdict.
export function periodEnd(sub) {
  const items = (sub && sub.items && sub.items.data) || [];
  let best = null;
  for (const i of items) {
    const t = i && i.current_period_end;
    if (typeof t === "number" && (best === null || t < best)) best = t;
  }
  return best;
}

// Trial state comes from STRIPE, never from the roster. The roster has no trial
// field and does not need one for this control (see the no-migration note above).
export function trialState(sub) {
  const s = sub || {};
  const end = typeof s.trial_end === "number" ? s.trial_end : null;
  return {
    trialing: String(s.status) === "trialing",
    trial_end: end,
    trial_end_iso: end ? new Date(end * 1000).toISOString() : null,
  };
}

export function subCustomerId(sub) {
  const c = sub && sub.customer;
  if (!c) return "";
  return typeof c === "string" ? c : String(c.id || "");
}

// The customer's email, available ONLY when expand[]=data.customer succeeded.
// null means "we did not ask or were not allowed", which is different from
// "there is no email". The caller must not conflate them.
export function subCustomerEmail(sub) {
  const c = sub && sub.customer;
  if (!c || typeof c === "string") return null;
  if (c.deleted) return null;
  const e = c.email;
  return e ? String(e) : null;
}

// ─── MASKING ─────────────────────────────────────────────────────────────────
// This output is printed into a PUBLIC GitHub Actions log.

export function maskEmail(e) {
  const s = String(e || "").trim().toLowerCase();
  if (!s || s.indexOf("@") < 0) return "…@?";
  return "…@" + s.split("@").pop();
}

// A salted, truncated, one-way tag. Enough to see that two ids DIFFER — which is
// the entire content of an id-conflict alarm — without publishing either one.
export async function idTag(id) {
  if (!id) return null;
  const bytes = new TextEncoder().encode("masspermits-reconcile " + String(id));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const lc = (s) => String(s || "").trim().toLowerCase();

// The SENDER's predicate, deliberately. weekly-send.js:78 filters
// `s.email && s.active !== false`, so a legacy row with no `active` key IS served
// every Monday. send-status.js:111 uses `active === true`, which makes those same
// rows invisible to it. A reconciliation using `active === true` would report a
// legacy row as absent from the roster while it is in fact receiving the product —
// an invented gap. Match the sender's real behaviour.
const isActiveRow = (r) => !!(r && r.email && r.active !== false);

// ─── THE FIVE-CONDITION LATTICE ──────────────────────────────────────────────
//
// Each condition is {verdict, findings[], basis{}}.
//   verdict: "clean" | "alarm" | "indeterminate"
//     clean         — the comparison RAN and found nothing.
//     alarm         — the comparison ran and found something.
//     indeterminate — the comparison could not run, or ran on partial input.
//                     NEVER reported as clean. This is the fail-closed axis.
//
// `basis` exists because Codex finding 5 applies to the control's own output: an
// empty findings array proves nothing on its own. A caller that asserts
// `conditions.missing_payers.verdict === "clean"` must ALSO assert
// `conditions.missing_payers.basis.stripe_entitled_considered >= 1`, or the
// criterion passes on a comparison that never happened.
function cond() { return { verdict: "indeterminate", findings: [], basis: {} }; }

export async function reconcile(input) {
  const now = input && typeof input.now === "number" ? input.now : Date.now();
  const roster = Array.isArray(input && input.roster) ? input.roster : [];
  const rosterReadable = input ? input.rosterReadable !== false : false;
  const sendLog = Array.isArray(input && input.sendLog) ? input.sendLog : [];
  const sendLogReadable = input ? input.sendLogReadable !== false : false;
  const sr = (input && input.stripeResult) || {
    readable: false, subs: [], reason: "not-attempted",
    detail: "the Stripe read was never attempted", status: 0, pages: 0, expanded: false,
  };
  const wh = (input && input.webhookResult) || {
    readable: false, endpoints: [], reason: "not-attempted",
    detail: "the webhook-endpoint read was never attempted", status: 0, requestId: null,
  };
  const products = (input && input.products) || {};
  const siteHost = (input && input.siteHost) || "masspermits.com";

  const C = {
    missing_payers: cond(),
    extra_roster_rows: cond(),
    identity_conflicts: cond(),
    unknown_products: cond(),
    read_integrity: cond(),
  };

  const seen = new Set();
  const push = (name, f) => {
    const k = name + "|" + f.type + "|" + (f.subject || "");
    if (seen.has(k)) return;
    seen.add(k);
    if (C[name].findings.length < 50) C[name].findings.push(f);
  };
  const notices = [];
  const addNotice = (n) => { if (notices.length < 50) notices.push(n); };

  const activeRows = roster.filter(isActiveRow);

  // DECLARED UP HERE, NOT AT FIRST USE. finish() is reachable from every early
  // return below and must never read a variable that has not been initialised.
  // A crash inside the assembler turns a RED into a 500, and a 500 into a
  // workflow that fails for the wrong reason — which is how a real alarm gets
  // attributed to "the monitor is flaky" and ignored.
  //
  // v1 carried this comment and this hoist. v2's first draft dropped it and
  // scenario 11 (roster unreadable) crashed with a TDZ ReferenceError on
  // `entitled` — i.e. the fail-closed path, the one that only runs when
  // something is already wrong, was the one that threw. Restored, and scenario
  // 11 is now the regression test for it.
  let entitled = [];
  let notEntitled = [];
  let unverifiable = 0;
  const expanded = !!sr.expanded;

  // ── 0. READ INTEGRITY — computed first, because every other condition's
  //       verdict depends on which inputs actually arrived. ─────────────────
  const reads = {
    roster: { ok: !!rosterReadable, rows: rosterReadable ? roster.length : null },
    send_log: { ok: !!sendLogReadable, entries: sendLogReadable ? sendLog.length : null },
    stripe_subscriptions: {
      ok: !!sr.readable, status: sr.status || 0, reason: sr.reason || null,
      pages: sr.pages || 0, returned: sr.readable ? sr.subs.length : null,
      expanded: !!sr.expanded,
    },
    stripe_webhook_endpoints: {
      ok: !!wh.readable, status: wh.status || 0, reason: wh.reason || null,
      count: wh.readable ? wh.endpoints.length : null,
    },
  };
  C.read_integrity.basis = {
    reads_attempted: 4,
    reads_complete: [reads.roster.ok, reads.send_log.ok, reads.stripe_subscriptions.ok, reads.stripe_webhook_endpoints.ok].filter(Boolean).length,
  };
  for (const [name, r] of Object.entries(reads)) {
    if (r.ok) continue;
    push("read_integrity", {
      type: "read_failed", subject: name, severity: "blocking",
      status: r.status || 0, reason: r.reason || "unreadable",
      detail: name === "roster"
        ? "subscribers.json could not be read from R2, so who we are serving is unknown. " +
          "An unreadable roster is NOT an empty roster."
        : name === "send_log"
          ? "feed-send-log.json could not be read; the local continuity tripwire did not run."
          : name === "stripe_subscriptions"
            ? (sr.detail || "the Stripe subscriptions read did not complete")
            : (wh.detail || "the Stripe webhook-endpoint read did not complete"),
    });
  }
  // A degraded (id-only) read is not a failure but it IS incomplete coverage.
  if (sr.readable && !sr.expanded) {
    push("read_integrity", {
      type: "degraded_read", subject: "stripe_subscriptions", severity: "blocking",
      detail: "expand[]=data.customer was refused (403) or disabled, so Stripe customer emails are " +
              "unavailable. Matching is customer-id-only: real gaps are still caught, but an id " +
              "CONFLICT cannot be named as such. Grant Customers:Read on the restricted key.",
    });
  }
  C.read_integrity.verdict = C.read_integrity.findings.length ? "indeterminate" : "clean";

  // ── 1. LOCAL TRIPWIRE — the check that survives a Stripe outage ───────────
  //
  // On 2026-08-31 the local data DID carry a detectable signal nothing looked
  // at: a recipient present in the previous run's sent[] vanished from this
  // run's. It cannot on its own tell "lost a payer" from "legitimately
  // cancelled" — which is what the Stripe read adjudicates — so it is narrowed
  // to the locally unambiguous case: the recipient disappeared AND the roster no
  // longer carries an active row. If the roster still shows them active, that is
  // send-status.js's roster_gap and is left to it.
  //
  // Runs whether or not Stripe is reachable. It is why a Stripe failure cannot
  // launder a red into a blocked.
  const local = { compared: false, prev_at: null, current_at: null, prev_ok: 0, current_ok: 0, dropped: 0 };
  if (sendLogReadable && rosterReadable) {
    const runs = sendLog.filter((e) => e && e.at && !e.skipped && Array.isArray(e.sent) && e.sent.some((s) => s && s.ok));
    runs.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const cur = runs[0] || null;
    // The newest run from a DIFFERENT UTC day. A Monday that ran twice (09-07 has
    // two delivery entries) must not be compared against itself, or a real drop
    // between weeks is masked by an identical same-day pair.
    const prev = cur ? runs.find((r) => day(r.at) !== day(cur.at)) : null;
    if (cur && prev) {
      local.compared = true;
      local.prev_at = prev.at;
      local.current_at = cur.at;
      const okSet = (r) => new Set((r.sent || []).filter((s) => s && s.ok).map((s) => lc(s.to)));
      const curOk = okSet(cur);
      const prevOk = okSet(prev);
      local.prev_ok = prevOk.size;
      local.current_ok = curOk.size;
      for (const addr of prevOk) {
        if (curOk.has(addr)) continue;
        local.dropped++;
        const row = roster.find((r) => lc(r.email) === addr);
        if (row && isActiveRow(row)) {
          addNotice({
            type: "dropped_but_still_active", subject: maskEmail(addr),
            detail: "served in the previous run, absent from the latest one, but the roster still " +
                    "lists them ACTIVE — this is send-status.js's roster_gap, not a roster loss",
          });
          continue;
        }
        push("missing_payers", {
          type: "recipient_dropped_between_runs", severity: "red", stripe_independent: true,
          subject: maskEmail(addr),
          detail: `received the weekly file on ${prev.at} and not on ${cur.at}, and the roster ` +
                  (row ? "row for them is no longer active" : "has no row for them at all") +
                  ". Either they cancelled, or entitlement was revoked by mistake — check Stripe " +
                  "for this customer before assuming the former.",
        });
      }
    }
  }

  // ── 2. ROSTER-ONLY IDENTITY SCAN — runs with NO Stripe at all ────────────
  //
  // NEW IN v2. Three findings v1 could not produce, none of which need Stripe:
  //   (a) two or more rows sharing a normalized email;
  //   (b) two or more rows sharing a Stripe customer id;
  //   (c) an ACTIVE row carrying no Stripe customer id.
  //
  // (c) is not cosmetic. stripe-webhook.js:43 passes the raw event object to
  // deactivateSubscriber(env, o.customer, o); for customer.subscription.deleted
  // that object is a SUBSCRIPTION, which has neither customer_email nor
  // customer_details, so byEmail at :378-379 is "" and matchesForRevoke's email
  // fallback (:371-374) can never fire for a row with a real email. The id
  // branch needs `rowId`. A row with no customer id can therefore NEVER be
  // deactivated by a cancellation: it is a silent permanent entitlement,
  // independent of trial policy.
  const dupByEmail = new Map();
  const dupById = new Map();
  for (const r of roster) {
    const e = lc(r && r.email);
    if (e) { if (!dupByEmail.has(e)) dupByEmail.set(e, []); dupByEmail.get(e).push(r); }
    const c = String((r && r.customer) || "");
    if (c) { if (!dupById.has(c)) dupById.set(c, []); dupById.get(c).push(r); }
  }
  let idlessActive = 0;
  if (rosterReadable) {
    for (const [e, rows] of dupByEmail) {
      if (rows.length < 2) continue;
      const ids = new Set(rows.map((r) => String(r.customer || "")));
      const activeCount = rows.filter(isActiveRow).length;
      push("identity_conflicts", {
        type: "duplicate_roster_rows_same_email", severity: activeCount > 1 ? "red" : "amber",
        subject: maskEmail(e), rows: rows.length, active_rows: activeCount,
        distinct_customer_ids: ids.size,
        detail: rows.length + " roster rows share this normalized email" +
                (ids.size > 1 ? " under " + ids.size + " different Stripe customer ids" : "") +
                (activeCount > 1
                  ? ". More than one is ACTIVE, so weekly-send.js:78 mails this person " + activeCount +
                    " copies and a single cancellation deactivates only the rows it matches."
                  : ". Only one is active; the inactive duplicates are latent — a re-subscribe can " +
                    "reactivate the wrong one."),
      });
    }
    for (const [c, rows] of dupById) {
      if (rows.length < 2) continue;
      const emails = new Set(rows.map((r) => lc(r.email)));
      if (emails.size < 2) continue; // same person, already covered by the email scan
      push("identity_conflicts", {
        type: "one_customer_id_on_several_emails", severity: "red",
        subject: "customer " + (await idTag(c)), rows: rows.length, distinct_emails: emails.size,
        detail: "one Stripe customer id appears on " + rows.length + " roster rows with " +
                emails.size + " different emails. deactivateSubscriber matches on that id " +
                "(stripe-webhook.js:371-372), so ONE cancellation switches off all of them.",
      });
    }
    for (const r of activeRows) {
      if (String(r.customer || "")) continue;
      idlessActive++;
      push("identity_conflicts", {
        type: "active_row_without_customer_id", severity: "red", subject: maskEmail(r.email),
        deactivation_reachable: false,
        detail: "this ACTIVE row carries no Stripe customer id, so customer.subscription.deleted " +
                "can never deactivate it: stripe-webhook.js:43 passes a Subscription object, which " +
                "has no customer_email/customer_details, so byEmail is \"\" at :378-379 and the " +
                "email fallback at :371-374 cannot match a row with a real email. Entitlement here " +
                "is permanent until someone edits the file by hand. Backfill the customer id.",
      });
    }
  }
  C.identity_conflicts.basis = {
    roster_rows_scanned: rosterReadable ? roster.length : 0,
    active_rows_scanned: rosterReadable ? activeRows.length : 0,
    distinct_emails: rosterReadable ? dupByEmail.size : 0,
    distinct_customer_ids: rosterReadable ? dupById.size : 0,
    active_rows_without_customer_id: idlessActive,
    stripe_cross_check_ran: false, // flipped below if Stripe was readable
  };

  // ── 3. CHURN-EVENT COVERAGE — from the webhook-endpoint read ─────────────
  //
  // Belongs to extra_roster_rows because it IS the mechanism that creates them:
  // if Stripe never emits customer.subscription.deleted to this endpoint, every
  // cancellation leaves a live roster row forever and the roster only ever grows.
  let churnCoverage = { known: false, subscribed: null, endpoints_for_host: 0, wildcard: false };
  if (wh.readable) {
    const mine = wh.endpoints.filter((e) => e.url_host === siteHost && e.status !== "disabled");
    churnCoverage.known = true;
    churnCoverage.endpoints_for_host = mine.length;
    churnCoverage.wildcard = mine.some((e) => e.enabled_events.includes("*"));
    churnCoverage.subscribed = mine.some((e) => e.enabled_events.includes("*") || e.enabled_events.includes(CHURN_EVENT));
    if (mine.length === 0) {
      push("extra_roster_rows", {
        type: "no_enabled_webhook_endpoint_for_site", severity: "red", subject: siteHost,
        detail: "Stripe lists no ENABLED webhook endpoint whose host is " + siteHost + ". If that is " +
                "accurate, no Stripe event reaches the site at all: no checkout writes a roster row, " +
                "no cancellation removes one. Verify the host before acting — a proxy or apex/www " +
                "difference produces this too.",
      });
    } else if (churnCoverage.subscribed === false) {
      push("extra_roster_rows", {
        type: "churn_event_not_subscribed", severity: "red", subject: CHURN_EVENT,
        endpoints_for_host: mine.length,
        detail: "the enabled webhook endpoint(s) for " + siteHost + " do NOT subscribe to " +
                CHURN_EVENT + ". stripe-webhook.js:41-45 handles that event and its own comment at " +
                ":38-40 names this dependency. Until it is subscribed, a cancellation never reaches " +
                "deactivateSubscriber, every cancelled customer keeps receiving the paid bundle, and " +
                "a nonconverting trial's row is never switched off. This is a Dashboard setting, " +
                "not a code change.",
      });
    }
  }

  // ── 4. FAIL CLOSED ON THE ROSTER ─────────────────────────────────────────
  // An unreadable roster is NOT an empty roster. Treating a failed R2 read as []
  // would make every Stripe payer look unrostered and fire an alarm for each — a
  // control that manufactures its own emergency.
  if (!rosterReadable) {
    C.missing_payers.verdict = "indeterminate";
    C.extra_roster_rows.verdict = "indeterminate";
    C.identity_conflicts.verdict = "indeterminate";
    C.unknown_products.verdict = "indeterminate";
    return finish();
  }

  // ── 5. STRIPE-DEPENDENT CONDITIONS ───────────────────────────────────────
  if (!sr.readable) {
    // Every Stripe-dependent condition is indeterminate. The Stripe-INDEPENDENT
    // findings already pushed above (the tripwire into missing_payers, the whole
    // roster-only identity scan) are NOT discarded: a condition with findings is
    // an alarm even when its coverage was partial.
    C.missing_payers.basis = { ...C.missing_payers.basis, stripe_entitled_considered: 0, local_tripwire: local };
    C.missing_payers.verdict = C.missing_payers.findings.length ? "alarm" : "indeterminate";
    C.extra_roster_rows.basis = { active_rows_checked: 0, churn_coverage: churnCoverage };
    C.extra_roster_rows.verdict = C.extra_roster_rows.findings.length ? "alarm" : "indeterminate";
    C.identity_conflicts.verdict = C.identity_conflicts.findings.length ? "alarm" : "indeterminate";
    C.unknown_products.basis = { subscriptions_classified: 0, allowlist_configured: allowlistConfigured(products) };
    C.unknown_products.verdict = "indeterminate";
    return finish();
  }

  entitled = sr.subs.filter((s) => s && ENTITLED_STATUSES.has(String(s.status)));
  notEntitled = sr.subs.filter((s) => s && !ENTITLED_STATUSES.has(String(s.status)));
  C.identity_conflicts.basis.stripe_cross_check_ran = true;

  const byCustomer = new Map();
  for (const r of roster) {
    const c = String((r && r.customer) || "");
    if (!c) continue;
    if (!byCustomer.has(c)) byCustomer.set(c, []);
    byCustomer.get(c).push(r);
  }
  const rowsWithEmail = (e) => (e ? roster.filter((r) => lc(r.email) === lc(e)) : []);

  const entitledByCustomer = new Map();
  const entitledByEmail = new Map();
  for (const s of entitled) {
    const c = subCustomerId(s);
    if (c) {
      if (!entitledByCustomer.has(c)) entitledByCustomer.set(c, []);
      entitledByCustomer.get(c).push(s);
    }
    const e = subCustomerEmail(s);
    if (e) {
      const k = lc(e);
      if (!entitledByEmail.has(k)) entitledByEmail.set(k, []);
      entitledByEmail.get(k).push(s);
    }
  }

  // ── 5a. UNKNOWN PRODUCTS — ITS OWN CONDITION, SCANNED OVER EVERY SUB ─────
  //
  // v1's bug: an unrecognised product was only reported when the payer ALSO had
  // no roster row. A payer with a matched row on an unknown product scored
  // clean, which is the condition Codex asked to be named explicitly.
  //
  // v2 scans EVERY entitled subscription, matched or not. And if the allowlist
  // is not configured at all, the condition is INDETERMINATE — not clean, not
  // alarm — because nothing was classifiable and a clean verdict there would be
  // a control reporting that it recognised products it never looked up.
  const allowlisted = allowlistConfigured(products);
  const unknownProductTags = new Set();
  let classifiedMass = 0, classifiedOther = 0, classifiedUnknown = 0;
  let matchedOnPrice = 0, matchedOnProduct = 0;
  for (const s of entitled) {
    const cl = classifySub(s, products);
    if (cl.kind === "mass") { classifiedMass++; if (cl.matched_on === "price") matchedOnPrice++; else matchedOnProduct++; continue; }
    if (cl.kind === "other") { classifiedOther++; if (cl.matched_on === "price") matchedOnPrice++; else matchedOnProduct++; continue; }
    classifiedUnknown++;
    if (!allowlisted) continue; // reported once, below, as an unconfigured allowlist
    const cid = subCustomerId(s);
    const tag = await idTag(cid);
    const rostered = (byCustomer.get(cid) || []).some(isActiveRow);
    // Price ids are account configuration, not customer data — but they are also
    // the thing an attacker would use to enumerate the catalogue, and this body
    // is public. Report a TAG, and the cents, which is enough to identify it in
    // the Dashboard without publishing it.
    for (const pid of subPrices(s)) unknownProductTags.add(await idTag(pid));
    push("unknown_products", {
      type: "entitled_subscription_unknown_price", severity: "amber",
      subject: subCustomerEmail(s) ? maskEmail(subCustomerEmail(s)) : "customer " + tag,
      stripe_status: s.status, cents: subCents(s), rostered,
      price_id_tags: (await Promise.all(subPrices(s).map(idTag))).slice(0, 4),
      detail: "a live subscription whose price id is in neither allowlist" +
              (rostered ? ", held by someone who IS on the active roster" : ", held by someone with no active roster row") +
              ". Amount is " + subCents(s) + "c, which CANNOT disambiguate it: Lead Pack and Radar " +
              "are both 4900c. Add the price id to MASSPERMITS_PRICE_IDS or OTHER_PRICE_IDS.",
    });
  }
  C.unknown_products.basis = {
    subscriptions_classified: entitled.length,
    allowlist_configured: allowlisted,
    allowlist_prices: ((products.masspermits_prices || []).length + (products.other_prices || []).length),
    allowlist_products: ((products.masspermits || []).length + (products.other || []).length),
    classified_mass: classifiedMass,
    classified_other: classifiedOther,
    classified_unknown: classifiedUnknown,
    matched_on_price: matchedOnPrice,
    matched_on_product: matchedOnProduct,
    distinct_unknown_price_tags: unknownProductTags.size,
  };
  if (!allowlisted) {
    push("unknown_products", {
      type: "product_allowlist_unconfigured", severity: "blocking", subject: null,
      subscriptions_unclassifiable: entitled.length,
      detail: "no price or product allowlist is configured, so all " + entitled.length + " entitled " +
              "subscription(s) are unclassifiable and this condition is INDETERMINATE, not clean. " +
              "Run discover-prices.mjs once and set MASSPERMITS_PRICE_IDS / OTHER_PRICE_IDS. " +
              "Until then the control can still find a missing payer, but it cannot tell a " +
              "MassPermits payer from the IRWatch sibling on this shared Stripe account.",
    });
    C.unknown_products.verdict = "indeterminate";
  } else {
    C.unknown_products.verdict = C.unknown_products.findings.length ? "alarm" : "clean";
  }

  // ── 5b. DIRECTION A — MISSING PAYERS ─────────────────────────────────────
  // Someone Stripe says is paying, who we are not serving. This is the incident:
  // the alarm that would have gone red on the FIRST Monday of the outage instead
  // of the twenty-first day.
  let considered = 0;
  for (const s of entitled) {
    const cid = subCustomerId(s);
    const cemail = subCustomerEmail(s);
    const cl = classifySub(s, products);
    const cents = subCents(s);
    const tag = await idTag(cid);
    const tr = trialState(s);

    // Product classification gates DIRECTION A only, never direction B.
    // Misclassifying here produces a false "you may have an unserved payer",
    // which is a prompt to look. Misclassifying in direction B produces a false
    // "this roster row is not paying", which reads like permission to cut
    // someone off. The asymmetry is deliberate.
    if (cl.kind === "other") continue;
    considered++;

    const byId = byCustomer.get(cid) || [];
    if (byId.length) {
      if (byId.some(isActiveRow)) { trialNotice(s, tr, cemail, addNotice); continue; }
      push("missing_payers", {
        type: "payer_inactive_on_roster", severity: "red",
        subject: cemail ? maskEmail(cemail) : "customer " + tag,
        stripe_id_tag: tag, stripe_status: s.status, trialing: tr.trialing,
        detail: "Stripe shows a live subscription for this customer, but their roster row is " +
                "INACTIVE. They are being billed and are receiving nothing. Do not resend blindly: " +
                "confirm in Stripe, then reactivate the row.",
      });
      continue;
    }

    // No row names this customer id. Fall back to EMAIL — not as an identity key,
    // but as a diagnostic, because the gap and its cause are different facts.
    if (cemail) {
      const byEmail = rowsWithEmail(cemail);
      if (byEmail.length) {
        const conflicting = byEmail.filter((r) => r.customer && r.customer !== cid);
        if (conflicting.length) {
          push("identity_conflicts", {
            type: "customer_id_conflict", severity: "red", subject: maskEmail(cemail),
            stripe_id_tag: tag, roster_id_tag: await idTag(conflicting[0].customer),
            detail: "the same person is paying in Stripe under customer " + tag + " while their " +
                    "roster row names customer " + (await idTag(conflicting[0].customer)) + ". This " +
                    "is the 2026-08-31 mechanism exactly: a cancellation for the STALE id revokes a " +
                    "live payer. The roster id must be replaced with the Stripe one — by hand, after " +
                    "confirming in Stripe.",
          });
        }
        if (!byEmail.some(isActiveRow)) {
          push("missing_payers", {
            type: "payer_inactive_on_roster", severity: "red", subject: maskEmail(cemail),
            stripe_id_tag: tag, stripe_status: s.status, trialing: tr.trialing,
            detail: "Stripe shows a live subscription for this person, but every roster row matching " +
                    "their email is INACTIVE. They are being billed and receiving nothing.",
          });
        }
        continue;
      }
    }

    // Nothing matches at all.
    if (cl.kind === "mass" || cents >= MIN_CENTS) {
      push("missing_payers", {
        type: cl.kind === "mass" ? "payer_missing_from_roster" : "unclassified_payer_missing_from_roster",
        severity: "red", subject: cemail ? maskEmail(cemail) : "customer " + tag,
        stripe_id_tag: tag, stripe_status: s.status, cents, trialing: tr.trialing,
        matched_on: cl.matched_on,
        detail: cl.kind === "mass"
          ? "a live MassPermits subscription (matched on " + cl.matched_on + " id) with no roster row " +
            "at all — this customer is paying and is not on the send list."
          : "a live subscription of " + cents + "c with no roster row, and its price id is in no " +
            "allowlist so it cannot be attributed. It may be the sibling product on this Stripe " +
            "account, or an unserved MassPermits payer. " + cents + "c does not decide it: Lead Pack " +
            "and Radar are both 4900c.",
      });
    } else {
      addNotice({
        type: "below_floor_unrostered", subject: cemail ? maskEmail(cemail) : "customer " + tag,
        detail: "a live subscription of " + cents + "c (below the " + MIN_CENTS + "c floor) with no " +
                "roster row — consistent with the sibling product on this shared Stripe account",
      });
    }
  }
  C.missing_payers.basis = {
    stripe_entitled_total: entitled.length,
    stripe_entitled_considered: considered,
    roster_rows_available: roster.length,
    matched_by_customer_id: byCustomer.size,
    local_tripwire: local,
  };
  C.missing_payers.verdict = C.missing_payers.findings.length ? "alarm" : "clean";

  // ── 5c. DIRECTION B — EXTRA ROSTER ROWS ──────────────────────────────────
  //
  // DELIBERATELY BLIND TO PRODUCT. The question is only "does this customer have
  // ANY live subscription", because the dangerous error in this direction is a
  // false negative on classification, which would accuse a real payer of not
  // paying. A live subscription of an unrecognised product is a NOTICE here and
  // an unknown_products finding there — never an extra-row alarm.
  if (entitled.length === 0 && activeRows.length > 0) {
    addNotice({
      type: "stripe_returned_nothing", subject: null,
      detail: "Stripe returned zero entitled subscriptions while the roster has " + activeRows.length +
              " active row(s). Before treating the alarms below as real, check that STRIPE_READ_KEY is " +
              "a LIVE-mode key (rk_live_, not rk_test_) on the right account — a test-mode key reads a " +
              "different, usually empty, dataset and produces precisely this.",
    });
  }

  let checked = 0;
  for (const r of activeRows) {
    const cid = String(r.customer || "");
    if (cid) {
      checked++;
      const live = entitledByCustomer.get(cid) || [];
      if (live.length) {
        for (const s of live) periodNotices(s, r, addNotice);
        continue;
      }
      // Before calling this a non-payer, check whether this person is paying
      // under a DIFFERENT id — the incident's signature, seen from the other side.
      const alt = expanded ? (entitledByEmail.get(lc(r.email)) || []) : [];
      if (alt.length) {
        push("identity_conflicts", {
          type: "customer_id_conflict", severity: "red", subject: maskEmail(r.email),
          roster_id_tag: await idTag(cid), stripe_id_tag: await idTag(subCustomerId(alt[0])),
          detail: "the roster row names a Stripe customer with no live subscription, while this " +
                  "person IS paying under a different customer id. Entitlement is hanging on the " +
                  "wrong id: the next cancellation for the stale one will switch off a payer.",
        });
        continue;
      }
      const dead = notEntitled.filter((s) => subCustomerId(s) === cid).map((s) => s.status);
      push("extra_roster_rows", {
        type: "roster_active_no_live_subscription", severity: "red", subject: maskEmail(r.email),
        roster_id_tag: await idTag(cid),
        stripe_states: dead.length ? Array.from(new Set(dead)) : [],
        churn_event_subscribed: churnCoverage.subscribed,
        detail: "this roster row is ACTIVE and receives the paid product every Monday, but Stripe " +
                "shows no entitled subscription for its customer id" +
                (dead.length ? " (it shows: " + Array.from(new Set(dead)).join(", ") + ")" : "") +
                (expanded ? " and no live subscription under this email either" : "") +
                ". DO NOT auto-revoke: a re-subscription arrives as a NEW customer id, so confirm in " +
                "Stripe first. If the read is degraded (no email expansion) this can also be a " +
                "legitimate re-subscribe the id-only match cannot see." +
                (churnCoverage.subscribed === false
                  ? " NOTE: " + CHURN_EVENT + " is not subscribed on this account's endpoint, which " +
                    "is a sufficient explanation for this row existing."
                  : ""),
      });
      continue;
    }

    // A row with no `customer` field. These are real: the field is only written
    // on the checkout.session.completed path (stripe-webhook.js:330), and a
    // $99/mo subscriber who signed up 2026-06-26 predates it. Already reported
    // as an identity_conflicts finding above; here we only decide whether their
    // ENTITLEMENT can be verified at all.
    const alt = expanded ? (entitledByEmail.get(lc(r.email)) || []) : [];
    if (alt.length) {
      checked++;
      addNotice({
        type: "matched_by_email_only", subject: maskEmail(r.email),
        detail: "this roster row carries no Stripe customer id (legacy record) and was verified by " +
                "email instead. Email is a weaker key and is case-sensitive on Stripe's side; " +
                "backfilling the customer id would make it verifiable AND make it deactivatable.",
      });
      continue;
    }
    if (expanded) {
      checked++;
      push("extra_roster_rows", {
        type: "roster_active_no_live_subscription", severity: "red", subject: maskEmail(r.email),
        roster_id_tag: null, stripe_states: [], churn_event_subscribed: churnCoverage.subscribed,
        detail: "this roster row is ACTIVE, carries NO Stripe customer id, and no live subscription " +
                "in Stripe carries its email. Either they are being served unpaid, or their Stripe " +
                "email differs in case or spelling. Confirm by hand.",
      });
    } else {
      unverifiable++;
      addNotice({
        type: "unverifiable_no_id", subject: maskEmail(r.email),
        detail: "roster row has no Stripe customer id AND the read is degraded (no customer emails), " +
                "so this row could not be checked against Stripe at all",
      });
    }
  }
  C.extra_roster_rows.basis = {
    active_rows_total: activeRows.length,
    active_rows_checked: checked,
    active_rows_unverifiable: unverifiable,
    stripe_entitled_total: entitled.length,
    churn_coverage: churnCoverage,
  };
  // An unverifiable row is a hole in the audit. It does not manufacture an
  // alarm, but it must not be reported as clean: coverage was incomplete.
  C.extra_roster_rows.verdict = C.extra_roster_rows.findings.length
    ? "alarm"
    : (unverifiable > 0 || !churnCoverage.known ? "indeterminate" : "clean");

  C.identity_conflicts.verdict = C.identity_conflicts.findings.length ? "alarm" : "clean";

  return finish();

  // ── assembly ───────────────────────────────────────────────────────────────
  function finish() {
    const alarms = [];
    for (const name of CONDITIONS) for (const f of C[name].findings) if (f.severity !== "blocking") alarms.push({ condition: name, ...f });

    const anyAlarm = CONDITIONS.some((n) => C[n].verdict === "alarm");
    const anyIndet = CONDITIONS.some((n) => C[n].verdict === "indeterminate");
    // RED beats BLOCKED beats OK. A read failure can never discard an alarm that
    // was already provable, and an incomplete read can never produce `ok`.
    const verdict = anyAlarm ? "red" : anyIndet ? "blocked" : "ok";

    const indet = CONDITIONS.filter((n) => C[n].verdict === "indeterminate");
    const alarmed = CONDITIONS.filter((n) => C[n].verdict === "alarm");

    let detail;
    if (verdict === "ok") {
      detail = `All five conditions clean. Stripe returned ${sr.readable ? sr.subs.length : 0} ` +
               `subscription(s), ${entitled.length} entitled; the roster has ${activeRows.length} ` +
               `active row(s); every one was matched and every price id was classified` +
               (churnCoverage.subscribed ? `; ${CHURN_EVENT} is subscribed on the endpoint for ${siteHost}` : "") + ".";
    } else if (verdict === "blocked") {
      detail = "BLOCKED — " + indet.length + " of 5 condition(s) could not be established (" +
               indet.join(", ") + "), so this control is reporting blocked rather than clean. " +
               "A blocked verdict is NOT a green one: entitlement is unverified until it clears.";
    } else {
      const heads = alarms.slice(0, 6).map((a) => a.condition + "/" + a.type + " " + (a.subject || "")).join("; ");
      detail = `RED — ${alarms.length} alarm(s) across ${alarmed.length} condition(s): ${heads}` +
               (alarms.length > 6 ? ` (+${alarms.length - 6} more)` : "") + ". " +
               (indet.length
                 ? "COVERAGE IS PARTIAL: " + indet.join(", ") + " could not be established, so this is " +
                   "the floor, not the whole picture."
                 : "Every remedy here is a human decision: this control never writes the roster.");
    }

    return {
      verdict,
      detail,
      // Nothing here is ever retryable by re-running the sender. A missing payer
      // is missing from the LIST the sender reads, not from the send.
      retry_safe: false,
      checked_at: new Date(now).toISOString(),
      conditions: C,
      condition_verdicts: Object.fromEntries(CONDITIONS.map((n) => [n, C[n].verdict])),
      alarms,
      notices,
      counts: {
        alarms: alarms.length,
        notices: notices.length,
        conditions_clean: CONDITIONS.filter((n) => C[n].verdict === "clean").length,
        conditions_alarm: alarmed.length,
        conditions_indeterminate: indet.length,
        roster_rows: rosterReadable ? roster.length : null,
        roster_active: rosterReadable ? activeRows.length : null,
        stripe_returned: sr.readable ? sr.subs.length : null,
        stripe_entitled: sr.readable ? entitled.length : null,
        unverifiable_rows: unverifiable,
      },
      reads,
      stripe: {
        readable: !!sr.readable,
        status: sr.status || 0,
        reason: sr.reason || null,
        request_id: sr.requestId || null,
        pages: sr.pages || 0,
        expanded: !!sr.expanded,
        api_version: STRIPE_API_VERSION,
        allowlist_configured: allowlistConfigured(products),
      },
      webhook_endpoints: {
        readable: !!wh.readable,
        status: wh.status || 0,
        reason: wh.reason || null,
        request_id: wh.requestId || null,
        count: wh.readable ? wh.endpoints.length : null,
        site_host: siteHost,
        churn_event: CHURN_EVENT,
        churn_coverage: churnCoverage,
      },
      local_tripwire: local,
      // Everything this control deliberately does NOT decide, restated in every
      // response so a reader never has to remember it.
      out_of_scope: [
        "fulfilment: this control never writes subscribers.json and never adds a product, price or trial column to it",
        "Radar policy: whether a trial start is entitled to the monthly bundle is a product decision, not a reconciliation result",
        "receipt: Stripe state is who is PAYING; whether a bundle reached an inbox is a different question with different evidence",
      ],
    };
  }
}

function allowlistConfigured(products) {
  const p = products || {};
  return !!((p.masspermits_prices || []).length || (p.other_prices || []).length ||
            (p.masspermits || []).length || (p.other || []).length);
}

function day(iso) { return String(iso || "").slice(0, 10); }

// Trial facts are REPORTED, never actioned. Codex finding 6: withdraw the claim
// that a nonconverting trial stays active forever — the deletion handler can
// deactivate the row; whether the event arrives is the configuration question
// the webhook-endpoint read above now answers.
function trialNotice(sub, tr, cemail, addNotice) {
  if (!tr.trialing) return;
  addNotice({
    type: "trialing_and_served", subject: cemail ? maskEmail(cemail) : "customer",
    trial_end: tr.trial_end_iso,
    detail: "this customer is in a Stripe TRIAL (status=trialing" +
            (tr.trial_end_iso ? ", ends " + tr.trial_end_iso : "") + ") and has an ACTIVE roster row, " +
            "so weekly-send.js is serving them the paid bundle. The roster carries no trial marker " +
            "(stripe-webhook.js:326-334), so nothing in MassPermits knows this is a trial. Whether " +
            "that is correct is a PRODUCT DECISION, not a defect this control can rule on.",
  });
}

// Non-alarming facts that change what the owner should expect next week.
function periodNotices(sub, row, addNotice) {
  // An `active` subscription with a non-null pause_collection is not actually
  // billing — Stripe deliberately leaves the status unchanged. A NOTICE on
  // purpose: this direction's false positives accuse a real payer of not paying.
  if (sub && sub.pause_collection) {
    addNotice({
      type: "pause_collection", subject: maskEmail(row.email),
      detail: "Stripe status is " + sub.status + " but payment collection is PAUSED, so this " +
              "subscription is not billing while the roster still serves it",
    });
  }
  if (sub && sub.cancel_at_period_end) {
    const t = periodEnd(sub);
    addNotice({
      type: "cancel_at_period_end", subject: maskEmail(row.email),
      detail: "scheduled to end" + (t ? " at " + new Date(t * 1000).toISOString() : "") +
              " — a known upcoming loss, not a fault (period read from items.data[].current_period_end, " +
              "which is where it lives since API 2025-03-31.basil)",
    });
  }
  const tr = trialState(sub);
  if (tr.trialing) trialNotice(sub, tr, null, addNotice);
}
