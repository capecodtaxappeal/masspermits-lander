// MassPermits monday rehearsal: fixtures for the R3a tests (Node built-ins
// only). Everything is synthetic: cus_TEST / sub_TEST / price_TEST ids,
// @example.com addresses, commit shas made of one repeated hex digit.
//
//   ghWorld(o)      a fake ghGet(path) for facts.mjs: workflow runs listed BY
//                   FILE, jobs and steps, commits, "Cloudflare Pages"
//                   check-runs. Every path it is asked for is recorded.
//   stripeWorld(o)  route handlers for the harness fetch stub that answer the
//                   five Stripe list reads, with has_more, expansions and the
//                   refusals the readers must survive.
// Like harness.mjs, nothing here touches the global object.

export const REPO = "capecodtaxappeal/masspermits-lander";
const MIN = 60_000;

// ── GitHub ──────────────────────────────────────────────────────────────────
let runSeq = 7000;
// run({file, created, ...}) -> a workflow run object as the Actions API lists it.
export function run(o) {
  const created = typeof o.created === "number" ? o.created : Date.parse(o.created);
  const id = o.id ?? ++runSeq;
  return {
    id, name: o.name || o.file, path: ".github/workflows/" + o.file, file: o.file,
    event: o.event || "schedule", status: o.status || "completed",
    conclusion: o.status && o.status !== "completed" ? null : (o.conclusion ?? "success"),
    created_at: new Date(created).toISOString(),
    run_started_at: new Date(o.started ?? created + MIN).toISOString(),
    updated_at: new Date(o.updated ?? created + 40 * MIN).toISOString(),
    head_branch: o.branch ?? "main",
    head_sha: o.head_sha || "c".repeat(40),
    head_repository: { full_name: o.repo ?? REPO },
    // steps of its jobs, for the jobs endpoint
    __steps: o.steps || null,
  };
}
// A refresh run whose "Ship bundles to R2" step completed `shipAfter` ms after
// it was created (null: no ship step), with optional failures.
export function refreshRun(created, o = {}) {
  const c = typeof created === "number" ? created : Date.parse(created);
  const ship = o.shipAfter === null ? null : c + (o.shipAfter ?? 35 * MIN);
  const steps = [
    { name: "Set up job", number: 1, status: "completed", conclusion: "success", completed_at: new Date(c + MIN).toISOString() },
    { name: "Build bundles", number: 2, status: "completed", conclusion: o.buildFails ? "failure" : "success",
      completed_at: new Date(c + 20 * MIN).toISOString() },
  ];
  if (ship !== null) {
    steps.push({ name: "Ship bundles to R2 (curl + OIDC)", number: 3, status: "completed",
      conclusion: o.buildFails ? "skipped" : o.shipFails ? "failure" : "success", completed_at: new Date(ship).toISOString() });
  }
  steps.push({ name: "Commit heartbeat", number: 4, status: "completed", conclusion: o.afterFails ? "failure" : o.buildFails || o.shipFails ? "skipped" : "success",
    completed_at: new Date(c + 38 * MIN).toISOString() });
  const failed = o.buildFails || o.shipFails || o.afterFails;
  return run({ file: "weekly-refresh.yml", created: c, steps, conclusion: failed ? "failure" : "success", ...o.run });
}

// commit({sha, date, paths}) -> a commit as GET commits lists it (plus paths).
export function commit(sha, date, paths = []) {
  return { sha, commit: { committer: { date: new Date(typeof date === "number" ? date : Date.parse(date)).toISOString() } }, __paths: paths };
}
export const sha = (c) => String(c).repeat(40).slice(0, 40);

// ghWorld({runs: [...], commits: [...newest first], checkRuns: {sha: list | (now) => list},
//          status: {pathRegexSource: httpStatus}, now: () => ms})
export function ghWorld(o = {}) {
  const paths = [];
  const now = o.now || (() => Date.now());
  const runs = o.runs || [];
  const commits = (o.commits || []).slice().sort((a, b) =>
    Date.parse(b.commit.committer.date) - Date.parse(a.commit.committer.date));
  const reply = (json, status = 200) => ({ status, ok: status >= 200 && status < 300, json, rateLimited: status === 429 });
  async function gh(path) {
    paths.push(path);
    for (const [re, st] of Object.entries(o.status || {})) {
      if (new RegExp(re).test(path)) return { status: st, ok: false, json: null, rateLimited: st === 429 || o.rateLimited === true };
    }
    const u = new URL("https://x.invalid/" + path);
    let m;
    if ((m = u.pathname.match(/^\/actions\/workflows\/([^/]+)\/runs$/))) {
      const page = Number(u.searchParams.get("page") || 1);
      const list = runs.filter((r) => r.file === m[1]).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return reply({ total_count: list.length, workflow_runs: list.slice((page - 1) * 100, page * 100).map(strip) });
    }
    if ((m = u.pathname.match(/^\/actions\/runs\/(\d+)\/jobs$/))) {
      const r = runs.find((x) => String(x.id) === m[1]);
      return r ? reply({ total_count: 1, jobs: [{ id: 1, steps: r.__steps || [] }] }) : reply(null, 404);
    }
    if (u.pathname === "/commits") {
      const p = u.searchParams.get("path");
      const since = Date.parse(u.searchParams.get("since") || "");
      const until = Date.parse(u.searchParams.get("until") || "");
      const per = Number(u.searchParams.get("per_page") || 30);
      const list = commits.filter((c) => {
        const t = Date.parse(c.commit.committer.date);
        return (!p || c.__paths.some((x) => x === p || x.startsWith(p + "/"))) &&
          (!Number.isFinite(since) || t >= since) && (!Number.isFinite(until) || t <= until);
      });
      return reply(list.slice(0, per).map(({ __paths, ...c }) => c));
    }
    if ((m = u.pathname.match(/^\/commits\/([0-9a-f]{40})\/check-runs$/))) {
      const v = (o.checkRuns || {})[m[1]];
      const list = typeof v === "function" ? v(now()) : v || [];
      return reply({ total_count: list.length, check_runs: list });
    }
    return reply(null, 404);
  }
  const strip = ({ __steps, file, ...r }) => r;
  return { gh, paths };
}
export const pagesRun = (conclusion) => ({ name: "Cloudflare Pages", status: "completed", conclusion });

// ── Stripe ──────────────────────────────────────────────────────────────────
export const MP_PRICE = "price_TEST_MP";
export const MP_PRODUCT = "prod_TEST_MP";
export const SIB_PRICE = "price_TEST_SIB";
export const SIB_PRODUCT = "prod_TEST_SIB";
export const ALL_EVENTS = ["customer.subscription.deleted", "invoice.payment_failed", "radar.early_fraud_warning.created",
  "charge.dispute.created", "review.opened", "review.closed", "invoice.paid", "invoice.payment_succeeded",
  "checkout.session.completed"];

// stripeSub(i, o) -> a raw Subscription on buyer i's synthetic customer.
export function stripeSub(i, o = {}) {
  return {
    id: "sub_TEST" + i, object: "subscription", status: o.status || "active", created: o.created ?? 1754006400,
    customer: o.expand === false ? "cus_TEST" + i
      : { id: o.customer || "cus_TEST" + i, object: "customer", email: o.email || `buyer${i}.testperson@example.com` },
    cancel_at_period_end: false, pause_collection: null,
    // The billing period lives on the ITEM on the pinned API version (the
    // Subscription object has no current_period_end). Default: 2026-11-20.
    items: { object: "list", data: [{ id: "si_TEST" + i, quantity: 1,
      current_period_end: o.periodEnd === undefined ? 1795132800 : o.periodEnd,
      price: { id: o.price || MP_PRICE, product: o.product || MP_PRODUCT, unit_amount: o.cents ?? 9900 } }] },
  };
}
export const endpoint = (o = {}) => ({ id: "we_TEST" + (o.n || 1), object: "webhook_endpoint",
  url: o.url || "https://masspermits.com/api/stripe-webhook", status: o.status || "enabled",
  enabled_events: o.events || ALL_EVENTS.slice() });
export const price = (id, product, cents, o = {}) => ({ id, object: "price", product, unit_amount: cents, currency: "usd",
  active: true, recurring: o.oneTime ? null : { interval: "month" } });
// A promotion code in the pinned API version's shape (promotion.coupon).
export const promo = (n, coupon) => ({ id: "promo_TEST" + n, object: "promotion_code", active: true,
  promotion: { type: "coupon", coupon } });
export const coupon = (o) => ({ id: "coupon_TEST", object: "coupon", percent_off: o.pct ?? null, amount_off: o.amt ?? null,
  currency: o.amt ? "usd" : null, ...(o.products ? { applies_to: { products: o.products } } : {}) });
export const paymentLink = (n, prices) => ({ id: "plink_TEST" + n, object: "payment_link", active: true,
  line_items: { object: "list", has_more: false, data: prices.map((p, k) => ({ id: "li_TEST" + n + k, price: { id: p } })) } });

// A healthy MassPermits Stripe account for buyers `ids`.
export function healthyStripe(ids = [1, 2, 3], over = {}) {
  return {
    subs: ids.map((i) => stripeSub(i)),
    endpoints: [endpoint()],
    prices: [price(MP_PRICE, MP_PRODUCT, 9900), price(SIB_PRICE, SIB_PRODUCT, 300)],
    promos: [promo(1, coupon({ pct: 50, products: [MP_PRODUCT] }))],
    links: [paymentLink(1, [MP_PRICE])],
    ...over,
  };
}

// stripeWorld(get) -> {routes, calls}: get() returns the current account
// (so one fetch stub can serve many drills). Account fields:
//   subs, endpoints, prices, promos, links   the list data
//   fail: {subscriptions|webhook_endpoints|prices|promotion_codes|payment_links: status}
//   refuseAppliesTo, refuseLinkExpand, refuseCustomerExpand   4xx on that expansion
//   hasMore: {name: value}                    override has_more on the first page
//   pageSize                                  split lists into pages of this size
export function stripeWorld(get) {
  const calls = [];
  const list = (data, hasMore) => new Response(JSON.stringify({ object: "list", data, has_more: hasMore, url: "/v1/x" }),
    { status: 200, headers: { "content-type": "application/json", "Request-Id": "req_TEST" } });
  const err = (status) => new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status });
  const serve = (name, all) => (url, init) => {
    const acct = get();
    calls.push({ url, method: init.method, name });
    if (acct.fail && acct.fail[name]) return err(acct.fail[name]);
    const u = new URL(url);
    const expand = u.searchParams.getAll("expand[]");
    if (name === "subscriptions" && acct.refuseCustomerExpand && expand.includes("data.customer")) return err(403);
    if (name === "promotion_codes" && acct.refuseAppliesTo && expand.some((e) => e.endsWith("applies_to"))) return err(400);
    if (name === "payment_links" && acct.refuseLinkExpand && expand.includes("data.line_items")) return err(400);
    let data = all(acct, u) || [];
    if (name === "subscriptions" && !expand.includes("data.customer")) {
      data = data.map((s) => ({ ...s, customer: typeof s.customer === "object" ? s.customer.id : s.customer }));
    }
    if (name === "promotion_codes" && !expand.some((e) => e.endsWith("applies_to"))) {
      data = data.map((p) => { const c = p.promotion && p.promotion.coupon;
        if (!c || typeof c !== "object") return p;
        const { applies_to, ...rest } = c; void applies_to;
        return { ...p, promotion: { ...p.promotion, coupon: rest } }; });
    }
    if (name === "payment_links" && !expand.includes("data.line_items")) data = data.map(({ line_items, ...l }) => { void line_items; return l; });
    const size = acct.pageSize || 1000;
    const after = u.searchParams.get("starting_after");
    const start = after ? data.findIndex((x) => x.id === after) + 1 : 0;
    const page = data.slice(start, start + size);
    let more = start + size < data.length;
    if (!after && acct.hasMore && name in acct.hasMore) more = acct.hasMore[name];
    return list(page, more);
  };
  const routes = {
    "https://api.stripe.com/v1/subscriptions*": serve("subscriptions", (a) => a.subs),
    "https://api.stripe.com/v1/webhook_endpoints*": serve("webhook_endpoints", (a) => a.endpoints),
    "https://api.stripe.com/v1/prices*": serve("prices", (a) => a.prices),
    "https://api.stripe.com/v1/promotion_codes*": serve("promotion_codes", (a) => a.promos),
    "https://api.stripe.com/v1/payment_links*": (url, init) => {
      const m = new URL(url).pathname.match(/^\/v1\/payment_links\/([A-Za-z0-9_]+)\/line_items$/);
      if (m) {
        calls.push({ url, method: init.method, name: "line_items" });
        const l = (get().links || []).find((x) => x.id === m[1]);
        return list(l ? l.line_items.data : [], false);
      }
      return serve("payment_links", (a) => a.links)(url, init);
    },
  };
  return { routes, calls };
}

// Env for a keyed rehearsal.
export const STRIPE_ENV = { STRIPE_READ_KEY: "rk_test_rehearsal", MASSPERMITS_PRICE_IDS: MP_PRICE,
  MASSPERMITS_PRODUCT_IDS: MP_PRODUCT, OTHER_PRICE_IDS: SIB_PRICE, OTHER_PRODUCT_IDS: SIB_PRODUCT };
