// MassPermits monday rehearsal: the Function (POST, GitHub OIDC-gated).
//
// On Saturday and Sunday it runs Monday's delivery motions WITHOUT emailing a
// customer and tells the owner GO or NO-GO; on Monday it checks before and
// after the real send. REPORT-ONLY: it fixes nothing, retries nothing and
// sends nothing to anyone but the owner (and, from R2b, the owner's seed
// inboxes). The only writes it can persist are under rehearsal/.
//
// Order of work, and why:
//   1. AUTH FIRST. verifyGitHubOIDC always returns an object, so the test is
//      `auth.ok !== true`, never `!auth`. Nothing is parsed, read or called
//      before it passes, and its reason is never echoed.
//   2. Parameters, then the runner facts body (at most 4 KB).
//   3. rehearsal/log.json. If it exists and cannot be read, the request ends
//      here: it is the mail cap's evidence, and an "empty" log would reset it.
//   4. De-duplication, the run-level WAIT, then the part: links (paged),
//      seed, core. Only core composes or mails.
//
// The response is EXACTLY {ok, verdict, more, codes, error}. The caller prints
// it into a public Actions log, so it carries no count of any kind and nothing
// that names or numbers a buyer. The 401 is exactly {ok:false, error}.
//
// OUTBOUND is locked at run time by outbound(): stripeGet (GET to the Stripe
// API origin only) and sendInternal (the recipient lock, the daily cap and the
// fail-closed attempt record) hold the only two network calls in the files
// this build adds. Nothing here can reach the site itself or the GitHub API.

import { verifyGitHubOIDC } from "./_github-oidc.js";
import { roBucket } from "./_ro_bucket.js";
import { gather } from "./_presend.js";
import { renderWeekly } from "./_rehearsal_mail.js";
import { onRequestGet as myLeadsGet } from "./my-leads.js";
import { onRequestGet as leadsGet } from "../leads.js";
import {
  listStripeSubscriptions, listStripeWebhookEndpoints, listStripePrices, listStripePromotionCodes,
  listStripePaymentLinks, reconcile, STRIPE_API_VERSION,
} from "./_reconcile.js";
import {
  validateRunnerFacts, runLevelWait, shouldSkip, applyAcks, verdictOf, nogoCodes, composeDigest,
  shouldMail, checkC0, checkC1, checkC2, checkC3, checkC4, checkC5, checkC6, checkC7, checkC8, checkC9,
  checkC14, checkC17, checkC18, checkMonPre, checkMonPost, mapReconcile, res, isoDay, dateMs,
  FACTS_MAX_BYTES, NOT_BUILT,
} from "./_rehearsal.js";

const DAY = 86400_000;
const LOG_KEY = "rehearsal/log.json";
const LOG_RECORDS = 200;
const MAIL_KEEP_DAYS = 8;
const DAILY_CAP = 3;
const PAGE_ROWS = 4;
const MAX_PAGE = 24;
const UA = "MassPermits-Rehearsal/1 (monitor; headless)";
const ERRORS = new Set(["bad_param", "unauthorized", "schema", "roster_unreadable",
  "status_unreadable", "log_unreadable", "internal"]);

export async function onRequestPost(context) {
  const { request, env } = context;
  let auth;
  try { auth = await verifyGitHubOIDC(request); } catch { auth = null; }
  if (!auth || auth.ok !== true) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } });
  }
  try {
    return await handle(request, env);
  } catch {
    return reply(500, { ok: false, error: "internal" });
  }
}

function reply(status, o) {
  const body = {
    ok: o.ok === true,
    verdict: typeof o.verdict === "string" ? o.verdict : null,
    more: o.more === true,
    codes: Array.isArray(o.codes) ? o.codes.filter((c) => typeof c === "string") : [],
    error: ERRORS.has(o.error) ? o.error : null,
  };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ── parameters ──────────────────────────────────────────────────────────────
const PARAMS = ["mode", "part", "page", "date", "trigger", "run"];
export function parseParams(url, now) {
  const sp = url.searchParams;
  const keys = [...sp.keys()];
  if (keys.length !== PARAMS.length || new Set(keys).size !== keys.length) return null;
  if (!PARAMS.every((k) => sp.has(k))) return null;
  const p = Object.fromEntries(PARAMS.map((k) => [k, sp.get(k)]));
  if (!["sat", "sun", "mon-pre", "mon-post", "dry"].includes(p.mode)) return null;
  if (!["links", "seed", "core"].includes(p.part)) return null;
  if (!/^(0|[1-9][0-9]?)$/.test(p.page) || Number(p.page) > MAX_PAGE) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(p.date)) return null;
  const d = dateMs(p.date);
  if (!Number.isFinite(d) || isoDay(d) !== p.date) return null;
  const today = dateMs(isoDay(now));
  if (d < today - 3 * DAY || d > today + DAY) return null;
  if (!/^([0-9]{1,20}|sched|dispatch)$/.test(p.trigger)) return null;
  if (!/^[0-9]{1,20}$/.test(p.run)) return null;
  return { ...p, page: Number(p.page) };
}

// ── R2 helpers (every read and write goes through a roBucket view) ─────────
async function readJsonSafe(b, key) {
  try {
    const o = await b.get(key);
    return o ? JSON.parse(await o.text()) : null;
  } catch { return null; }
}
async function headSafe(b, key) {
  try {
    const h = await b.head(key);
    return h ? { uploaded: h.uploaded ? new Date(h.uploaded).toISOString() : null, size: h.size } : null;
  } catch { return null; }
}

// subscribers.json, read once per request.
async function readRoster(b) {
  let o;
  try { o = await b.get("subscribers.json"); } catch { return { ok: false, rows: [], code: "parse_error" }; }
  if (!o) return { ok: false, rows: [], code: "missing" };
  let d;
  try { d = JSON.parse(await o.text()); } catch { return { ok: false, rows: [], code: "parse_error" }; }
  if (!Array.isArray(d)) return { ok: false, rows: [], code: "not_array" };
  return { ok: true, rows: d, code: null };
}

// rehearsal/log.json = {v:1, records:[...], mail:[...]}. A MISSING object is a
// fresh start; one that exists but cannot be read, parsed or shaped is null.
async function readLog(b) {
  let o;
  try { o = await b.get(LOG_KEY); } catch { return null; }
  if (!o) return { v: 1, records: [], mail: [] };
  let d;
  try { d = JSON.parse(await o.text()); } catch { return null; }
  if (!d || typeof d !== "object" || Array.isArray(d) || d.v !== 1 ||
      !Array.isArray(d.records) || !Array.isArray(d.mail) ||
      !d.records.every((r) => r && typeof r === "object") ||
      !d.mail.every((m) => m && typeof m === "object")) return null;
  return d;
}
function logHandle(rw, data, run) {
  return {
    data, run,
    async save() {
      const cutoff = isoDay(Date.now() - MAIL_KEEP_DAYS * DAY);
      const out = {
        v: 1,
        records: data.records.slice(0, LOG_RECORDS),
        mail: data.mail.filter((m) => typeof m.day === "string" && m.day >= cutoff),
      };
      const r = await rw.put(LOG_KEY, JSON.stringify(out), { httpMetadata: { contentType: "application/json" } });
      if (!r) throw new Error("log write failed");
    },
  };
}

// ── OUTBOUND ────────────────────────────────────────────────────────────────
// Built once per request. Holds the only two network calls in this build.
const norm = (s) => String(s).trim().toLowerCase();
const ATTEMPTS = new Set(["pending", "sent", "failed"]);
export function outbound(env, roster, log) {
  // Stripe: GET to the API origin, nothing else. Passed as fetchImpl to every
  // _reconcile.js reader.
  async function stripeGet(url, init = {}) {
    let u;
    try { u = new URL(typeof url === "string" ? url : String(url)); } catch { throw new Error("outbound_blocked"); }
    if (u.origin !== "https://api.stripe.com") throw new Error("outbound_blocked");
    if (init.method !== undefined && init.method !== "GET") throw new Error("outbound_blocked");
    return fetch(u.href, { method: "GET", headers: init.headers || {} });
  }

  // THE RECIPIENT LOCK. `to` must be exactly one address that is the owner's
  // (REHEARSAL_TO, OWNER_EMAIL) or a seed (REHEARSAL_SEEDS, at most 3), and
  // must equal no roster row, active or not. Both sides are trimmed and
  // lower-cased; an env value counts only if it is non-empty.
  function lock(to) {
    if (typeof to !== "string") throw new Error("refused");
    const t = norm(to);
    if (!t || t.split("@").length !== 2) throw new Error("refused");
    const counted = (v) => (typeof v === "string" && norm(v) ? norm(v) : null);
    const owners = [counted(env.REHEARSAL_TO), counted(env.OWNER_EMAIL)].filter(Boolean);
    const seeds = typeof env.REHEARSAL_SEEDS === "string"
      ? env.REHEARSAL_SEEDS.split(",").map(norm).filter(Boolean).slice(0, 3) : [];
    const kind = owners.includes(t) ? "owner" : seeds.includes(t) ? "seed" : null;
    if (!kind) throw new Error("refused");
    if (kind === "seed" && !roster.ok) throw new Error("refused");
    // Every roster row, active or not, whatever type its email field has.
    const rowEmails = (r) => (r && r.email != null ? (Array.isArray(r.email) ? r.email : [r.email]) : []);
    if (roster.ok && roster.rows.some((r) => rowEmails(r).some((e) => e != null && norm(e) === t))) {
      throw new Error("refused");
    }
    return { t, kind };
  }

  async function sendInternal(to, subject, html, attachments) {
    const day = isoDay(Date.now());
    const record = (kind, result) => {
      const m = { day, kind, run: log.run, result, at: new Date(Date.now()).toISOString() };
      log.data.mail.unshift(m);
      return m;
    };
    let who;
    try { who = lock(to); } catch { record("none", "refused"); return { result: "refused" }; }
    if (env.REHEARSAL_MAIL !== "1") { record(who.kind, "off"); return { result: "off" }; }
    const used = log.data.mail.filter((m) => m.day === day && m.kind === who.kind && ATTEMPTS.has(m.result)).length;
    if (used >= DAILY_CAP) { record(who.kind, "capped"); return { result: "capped" }; }
    // The attempt is recorded BEFORE the call. If that write fails, no call.
    const m = record(who.kind, "pending");
    try { await log.save(); } catch {
      m.result = "capped";
      return { result: "capped", writeFailed: true };
    }
    let ok = false;
    try {
      const body = { from: env.FROM_EMAIL, to: [who.t], subject, html };
      if (Array.isArray(attachments) && attachments.length) body.attachments = attachments;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ok = r.ok;
      if (ok) {
        const j = await r.json().catch(() => null);
        if (j && typeof j.id === "string") m.id = j.id.slice(0, 64);
      }
    } catch { ok = false; }
    // No retry, ever. A failure is recorded and reported in the next digest.
    m.result = ok ? "sent" : "failed";
    try { await log.save(); } catch { /* the pending record already counts */ }
    return { result: m.result };
  }

  return { stripeGet, sendInternal };
}

// ── the handler ─────────────────────────────────────────────────────────────
async function handle(request, env) {
  const now = Date.now();
  const params = parseParams(new URL(request.url), now);
  if (!params) return reply(400, { ok: false, error: "bad_param" });

  const text = await request.text();
  if (new TextEncoder().encode(text).length > FACTS_MAX_BYTES) return reply(400, { ok: false, error: "schema" });
  let raw;
  try { raw = JSON.parse(text); } catch { return reply(400, { ok: false, error: "schema" }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.v !== 1) {
    return reply(400, { ok: false, error: "schema" });
  }
  const { facts, dropped } = validateRunnerFacts(raw);

  const rw = roBucket(env.BUNDLES, { allowPrefix: "rehearsal/" });
  const data = await readLog(rw);
  if (!data) return reply(500, { ok: false, error: "log_unreadable" });
  const log = logHandle(rw, data, params.run);

  if (shouldSkip(data.records, params)) return reply(200, { ok: true, verdict: "SKIPPED" });

  const base = { date: params.date, mode: params.mode, part: params.part, trigger: params.trigger,
    run: params.run, at: new Date(now).toISOString() };
  const upsert = (rec) => {
    const i = data.records.findIndex((r) => r.date === rec.date && r.mode === rec.mode &&
      r.part === rec.part && r.trigger === rec.trigger && r.run === rec.run);
    if (i >= 0) data.records.splice(i, 1);
    data.records.unshift(rec);
  };

  const wait = params.mode === "dry" ? null : runLevelWait(params.mode, { facts, dropped });
  if (wait) {
    upsert({ ...base, verdict: "WAIT", code: wait });
    await log.save().catch(() => {});
    return reply(200, { ok: true, verdict: "WAIT" });
  }

  const roster = await readRoster(rw);
  const out = outbound(env, roster, log);

  if (params.part === "links") {
    const r = await links(env, rw, roster, params);
    upsert({ ...base, verdict: null, code: null, persisted: r.persisted });
    await log.save().catch(() => {});
    return reply(200, { ok: true, more: r.more });
  }
  if (params.part === "seed") {
    // C20 is built in R2b. Until then the seed part records that and stops.
    upsert({ ...base, verdict: null, code: "C20.not_built" });
    await log.save().catch(() => {});
    return reply(200, { ok: true });
  }
  return core({ env, rw, params, facts, dropped, roster, log, out, now, base, upsert });
}

// ── part=links: C6, in-process ──────────────────────────────────────────────
async function callHandler(handler, env, request) {
  const ro = roBucket(env.BUNDLES);
  const pending = [];
  const context = { request, env: { ...env, BUNDLES: ro }, waitUntil: (p) => { pending.push(p); } };
  let r;
  try {
    r = await handler(context);
  } catch {
    await Promise.allSettled(pending);
    return { error: true, captured: ro.captured };
  }
  await Promise.allSettled(pending);
  const status = r.status;
  const type = r.headers.get("content-type") || "";
  const loc = r.headers.get("location") || "";
  try { if (r.body) await r.body.cancel(); } catch { /* released */ }
  return { status, type, toDownload: status === 302 && loc.startsWith("/api/my-leads"), captured: ro.captured };
}
const synthetic = (extra) => ({ "user-agent": UA, "x-mp-synthetic": "1", ...extra });

async function links(env, rw, roster, params) {
  const key = `rehearsal/links-${params.run}.json`;
  const prev = await readJsonSafe(rw, key);
  // Page 0 always starts a fresh store: a re-run of the same workflow run keeps
  // its run id, and pages from the earlier attempt must not be judged.
  const store = params.page > 0 && prev && prev.pages && prev.date === params.date && prev.mode === params.mode
    ? prev : { date: params.date, mode: params.mode, pages: {} };
  if (!roster.ok) {
    store.pages[params.page] = { rows: [], more: false };
    await rw.put(key, JSON.stringify(store));
    return { more: false, persisted: 0 };
  }
  const portal = await readJsonSafe(rw, "portal.json");
  store.paused = !!(portal && portal.off === true);
  const active = [];
  roster.rows.forEach((r, i) => { if (r && r.email && r.active !== false) active.push({ r, i }); });
  const slice = active.slice(params.page * PAGE_ROWS, params.page * PAGE_ROWS + PAGE_ROWS);
  const rows = [];
  let persisted = 0;
  for (const { r, i } of slice) {
    const token = typeof r.token === "string" ? r.token : "";
    if (!/^[0-9a-f]{32}$/.test(token)) { rows.push({ row: i, no_token: true }); continue; }
    const dl = async (k) => {
      const x = await callHandler(myLeadsGet, env, new Request(
        "https://masspermits.com/api/my-leads?t=" + token + k, { headers: synthetic() }));
      const p = x.captured.filter((c) => c.persisted).length;
      persisted += p;
      return { status: x.status || 0, zip: x.type === "application/zip", error: !!x.error, persisted: p,
        dl: x.captured.filter((c) => c.op === "put" && c.key.startsWith("dl/")).length };
    };
    const weekly = await dl("");
    const monthly = await dl("&k=monthly");
    let leads = { skipped: true };
    if (!store.paused) {
      const x = await callHandler(leadsGet, env, new Request("https://masspermits.com/leads",
        { headers: synthetic({ cookie: "mp_sess=" + token }) }));
      const acc = x.captured.filter((c) => c.op === "put" && c.key.startsWith("portal-access/"));
      const p = x.captured.filter((c) => c.persisted).length;
      persisted += p;
      const st = acc[0] && acc[0].customMetadata && acc[0].customMetadata.st;
      leads = { status: x.status || 0, access: acc.length, st: st === "ok" || st === "red" ? st : null,
        persisted: p, to_download: !!x.toDownload, error: !!x.error };
    }
    rows.push({ row: i, weekly, monthly, leads });
  }
  const more = (params.page + 1) * PAGE_ROWS < active.length;
  store.pages[params.page] = { rows, more };
  if (more && params.page >= MAX_PAGE) store.too_many = true;
  await rw.put(key, JSON.stringify(store));
  return { more: more && params.page < MAX_PAGE, persisted };
}

// ── Stripe reads and reconcile() (C7 keyed half, C8, mon-post step 2) ──────
// Every read goes through out.stripeGet (GET to the Stripe API origin only).
// Without a key each reader returns unreadable "no-key" and makes no call.
// reconcile() runs whenever the roster is readable, key or not: without Stripe
// it still runs its tripwire and roster-only identity scan. Its return value
// is bound ONLY to `recon` and read ONLY by mapReconcile().
const csv = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
async function stripeSide(env, out, roster, sendLog, sendLogOk, now, withC8) {
  const key = typeof env.STRIPE_READ_KEY === "string" ? env.STRIPE_READ_KEY : "";
  const opts = { key, apiVersion: STRIPE_API_VERSION, fetchImpl: out.stripeGet };
  const stripeResult = await listStripeSubscriptions({ ...opts, expandCustomer: env.STRIPE_NO_EXPAND !== "1" });
  const webhookResult = await listStripeWebhookEndpoints(opts);
  const c8reads = withC8 ? {
    prices: await listStripePrices(opts),
    promos: await listStripePromotionCodes(opts),
    links: await listStripePaymentLinks(opts),
  } : {};
  const products = { masspermits_prices: csv(env.MASSPERMITS_PRICE_IDS), other_prices: csv(env.OTHER_PRICE_IDS),
    masspermits: csv(env.MASSPERMITS_PRODUCT_IDS), other: csv(env.OTHER_PRODUCT_IDS) };
  const siteHost = env.SITE_HOST || "masspermits.com";
  const keyed = !!key && stripeResult.readable === true;
  let mapped = [];
  if (roster.ok) {
    const recon = await reconcile({ roster: roster.rows, rosterReadable: true, sendLog: sendLogOk ? sendLog : [],
      sendLogReadable: sendLogOk, stripeResult, webhookResult, products, siteHost, now });
    mapped = mapReconcile(recon, { rows: roster.rows, stripeResult, products, keyed });
  }
  return {
    stripe: { keyed: !!key, readable: stripeResult.readable === true, reason: stripeResult.reason || null,
      subs: stripeResult.readable ? stripeResult.subs : [] },
    c8: { keyed: !!key, webhookResult, siteHost, priceIds: products.masspermits_prices,
      productIds: products.masspermits, ...c8reads },
    priceIds: products.masspermits_prices, mapped,
  };
}

// ── part=core: every check, the verdict, the one mail ──────────────────────
async function core(ctx) {
  const { env, rw, params, facts, dropped, roster, log, out, now, base, upsert } = ctx;
  const { mode, date, run } = params;
  const data = log.data;
  const inp = await gather({ BUNDLES: rw }, { hash: false });
  const heads = { weeklyZip: inp.weekly, monthlyZip: inp.monthly,
    weeklyHtml: await headSafe(rw, "latest-weekly.html") };
  const sendLog = inp.log;
  const sendLogOk = Array.isArray(sendLog);
  const [inboxState, ack, funnel] = await Promise.all([
    readJsonSafe(rw, "inbox-watchdog-state.json"),
    readJsonSafe(rw, "rehearsal-ack.json"),
    readJsonSafe(rw, "funnel-metrics.json"),
  ]);
  // C7 and C8 run in sat, sun and dry; mon-post needs reconcile() for step 2;
  // mon-pre reads nothing from Stripe.
  const sx = mode === "mon-pre" ? { stripe: null, c8: null, priceIds: [], mapped: [] }
    : await stripeSide(env, out, roster, sendLog, sendLogOk, now, mode !== "mon-post");
  const { stripe, priceIds, mapped } = sx;
  const coverage = inp.status && ((inp.status.coverage && inp.status.coverage.disclose) || inp.status.degraded)
    ? (inp.status.coverage || { note: "reduced coverage" }) : null;
  const c = { facts, dropped, mode, date, now, status: inp.status, heads, inp, sendLog, sendLogOk, roster,
    inboxState, stripe, priceIds, funnel, coverage, weeklySize: inp.weekly ? inp.weekly.size : undefined,
    render: renderWeekly };
  const monPreRecs = data.records.filter((r) => r.part === "core" && r.mode === "mon-pre" &&
    r.date === date && r.verdict && r.verdict !== "WAIT");
  const linksPersisted = data.records.filter((r) => r.part === "links" &&
    dateMs(r.date) > dateMs(date) - 3 * DAY && dateMs(r.date) <= dateMs(date))
    .reduce((n, r) => n + (r.persisted || 0), 0);

  let results = [];
  let sunday = null;
  if (mode === "mon-post") {
    results.push(...checkMonPost({ ...c, monPre: monPreRecs, linksPersisted, mapped }));
  } else {
    const store = await readJsonSafe(rw, `rehearsal/links-${run}.json`);
    const c0 = checkC0(c);
    results.push(...c0, ...checkC1(c), ...checkC2(c), ...checkC3(c), ...checkC4(c));
    if (mode !== "mon-pre") results.push(...checkC5(c));
    results.push(...checkC6({ roster, store }));
    if (mode !== "mon-pre") results.push(...checkC7({ ...c, mapped }), ...checkC8({ ...sx.c8, facts, dropped, mapped }));
    results.push(...checkC9(c));
    if (mode !== "mon-pre") results.push(...checkC14(c));
    results.push(...checkC17(c));
    if (mode === "mon-pre") {
      const sunDate = isoDay(dateMs(date) - DAY);
      sunday = await readJsonSafe(rw, `rehearsal/${sunDate}.json`);
      if (sunday && (typeof sunday !== "object" || !sunday.verdict)) sunday = null;
      const sunCore = data.records.filter((r) => r.part === "core" && r.mode === "sun" && r.date === sunDate);
      const mp = checkMonPre({ ...c, sunday, sunCore });
      results.push(...mp);
      if (mp.ordering) results.push(...checkMonPost({ ...c, monPre: monPreRecs, linksPersisted }));
    }
    // C0 NO-GO: the deployed Function is not the one on main, so C3-C8 are
    // judging unknown code.
    if (c0.some((r) => r.result === "NO-GO")) {
      const blocked = new Set(["C3", "C4", "C5", "C6", "C7", "C8"]);
      const ids = [...new Set(results.filter((r) => blocked.has(r.id)).map((r) => r.id))];
      results = results.filter((r) => !blocked.has(r.id))
        .concat(ids.map((id) => res(id, "BLIND", id + ".c0_blocked")));
    }
  }
  const prevCore = data.records.filter((r) => r.part === "core" && r.run !== run && r.verdict);
  const since = prevCore.length ? Date.parse(prevCore[0].at || "") || now - 7 * DAY : now - 7 * DAY;
  results.push(...checkC18(data.mail, since, run));
  results = applyAcks(results, ack, date);
  const verdict = verdictOf(results, false);

  // C18: at most one mail per run, to the owner only.
  const prev = data.records.filter((r) => r.part === "core" && r.run !== run && r.date === date &&
    r.mode === mode && r.verdict && r.verdict !== "WAIT");
  let mail = "none";
  const own = [];
  if (shouldMail({ mode, verdict, results, prev, sunday })) {
    const d = composeDigest(results, { verdict, mode, date, rosterReadable: roster.ok, notBuilt: NOT_BUILT });
    const counted = (v) => (typeof v === "string" && v.trim() ? v : null);
    const to = counted(env.REHEARSAL_TO) || counted(env.OWNER_EMAIL) || undefined;
    const r = await out.sendInternal(to, d.subject, d.html);
    mail = r.result;
    if (r.writeFailed || r.result === "capped") own.push("C18.mail_capped");
    if (r.result === "failed") own.push("C18.mail_failed");
    if (r.result === "refused") own.push("C18.mail_refused");
  }
  const codes = [...new Set([...nogoCodes(results), ...own])].sort();

  // Worst result per check, and every non-PASS code: codes only, no buyer.
  const rank = { PASS: 0, WARN: 1, WAIT: 2, BLIND: 3, "NO-GO": 4 };
  const checks = {};
  for (const r of results) {
    if (!(r.id in checks) || rank[r.result] > rank[checks[r.id]]) checks[r.id] = r.result;
  }
  const findings = [...new Set(results.filter((r) => r.result !== "PASS")
    .map((r) => `${r.result} ${r.code}${r.acked ? " acked" : ""}`))];
  const rec = { ...base, verdict, code: codes[0] || null, mail, checks, findings };
  if (mode === "mon-pre") {
    rec.bundle_etag = (inp.weekly && inp.weekly.etag) || null;
    rec.rowset_sha256 = (inp.status && inp.status.bundle && inp.status.bundle.weekly &&
      inp.status.bundle.weekly.rowset_sha256) || null;
  }
  upsert(rec);
  if (mode === "sun") {
    const w = inp.status && inp.status.bundle && inp.status.bundle.weekly;
    await rw.put(`rehearsal/${date}.json`, JSON.stringify({
      date, run, verdict, mail, checks,
      bundle_etag: (inp.weekly && inp.weekly.etag) || null,
      rowset_sha256: (w && w.rowset_sha256) || null,
      rows: w && typeof w.rows === "number" ? w.rows : null,
      live_sources: (inp.status && inp.status.coverage && inp.status.coverage.live_sources) ?? null,
    })).catch(() => {});
  }
  await log.save().catch(() => {});
  return reply(200, { ok: true, verdict, more: false, codes });
}
