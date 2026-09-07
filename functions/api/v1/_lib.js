// MassPermits — public AGGREGATE read API, shared runtime.
//
// WHAT THIS SERVES, AND THE LINE IT DEFENDS
// -----------------------------------------
// Aggregates are the marketing; rows are the product. This API answers "how
// many, of what kind, roughly how expensive, where, when" — counts by town,
// trade and ISO week, and declared-value band distributions. It never answers
// "who and at which address", because THE ROWS ARE NOT HERE. The only data this
// code can reach is /feed/aggregates-v1.json, a pre-aggregated cube built by
// PermitPulse/api_build.py, which fails its own build if a row-level key
// (contractor, address, owner, permit_number, …) appears anywhere in it.
//
// That is the important property: the line is enforced by CONSTRUCTION, not by
// a filter in the request path. There is no query, no parameter, no header and
// no bug in this file that can return a permit row, because no permit row was
// deployed. A filter can be bypassed; an absent file cannot.
//
// It is also strictly COARSER than what the site already publishes for free:
// /feed/<town>.json and /feed/<town>.csv carry masked per-permit rows with the
// exact issue date, the street name and the declared value. This API stops at
// the ISO week and never names a street. Anyone who wants to argue the API
// gives away the product has to explain the feed first.
//
// _headers DOES NOT APPLY HERE. Cloudflare Pages' _headers file governs static
// assets only; Function responses carry exactly the headers set in this file.
// Every cache, CORS, licence and rate-limit header is therefore set in code.

export const VERSION = "1";
export const BASE = "/api/v1";
export const CUBE_PATH = "/feed/aggregates-v1.json";
export const SITE = "https://masspermits.com";

// ---------------------------------------------------------------- limits ----
// PER ISOLATE, and honestly labelled as such everywhere it is published. There
// is no KV, no Durable Object and no rate-limiting binding on this project, so
// a token bucket in module scope is what is actually available. It brakes the
// obvious case (one client in a loop landing on one isolate) and does not
// pretend to be a distributed quota.
//
// The real defences are structural, and they are the ones worth relying on:
//   1. THE KEY SPACE IS BOUNDED. Unknown query parameters are rejected, not
//      ignored, and every accepted value is normalised to a vocabulary term.
//      A client cannot mint unlimited distinct URLs, so it cannot walk past the
//      edge cache — which is the attack that actually costs money.
//   2. Every answer is cacheable for a day; the corpus only moves weekly.
//   3. There is nothing here worth scraping in bulk: the whole cube is one
//      public file and we link to it. Rate-limiting a public file is theatre.
export const RATE = { perMinute: 120, burst: 240, isolatePerMinute: 3000 };

const buckets = new Map();           // ip -> {t: tokens, at: ms}
let isolateWindow = { at: 0, n: 0 };

export function rateLimit(ip) {
  const now = Date.now();
  if (now - isolateWindow.at > 60_000) isolateWindow = { at: now, n: 0 };
  isolateWindow.n++;
  if (isolateWindow.n > RATE.isolatePerMinute) {
    return { ok: false, remaining: 0, reset: 60 - Math.floor((now - isolateWindow.at) / 1000), scope: "isolate" };
  }
  if (buckets.size > 20_000) buckets.clear();   // unbounded Map = a memory leak
  let b = buckets.get(ip);
  if (!b) { b = { t: RATE.burst, at: now }; buckets.set(ip, b); }
  b.t = Math.min(RATE.burst, b.t + ((now - b.at) / 60_000) * RATE.perMinute);
  b.at = now;
  if (b.t < 1) {
    return { ok: false, remaining: 0, reset: Math.ceil((1 - b.t) / RATE.perMinute * 60), scope: "ip" };
  }
  b.t -= 1;
  return { ok: true, remaining: Math.floor(b.t), reset: 60, scope: "ip" };
}

// ------------------------------------------------------------------ cube ----
// Per-isolate memo. TTL is short relative to the weekly rebuild, so a fresh
// build is picked up within the hour without a cold start being required.
let cached = null;
const CUBE_TTL_MS = 15 * 60_000;

export async function loadCube(context) {
  if (cached && Date.now() - cached.at < CUBE_TTL_MS) return cached.cube;
  const url = new URL(CUBE_PATH, new URL(context.request.url).origin);
  let res;
  // env.ASSETS is the in-process static-asset fetcher; the plain fetch is a
  // fallback so this module also runs under a local harness with no bindings.
  if (context.env && context.env.ASSETS && typeof context.env.ASSETS.fetch === "function") {
    res = await context.env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  } else {
    res = await fetch(url.toString(), { cf: { cacheTtl: 900 } });
  }
  if (!res || !res.ok) throw new CubeMissing(res ? res.status : 0);
  const cube = await res.json();
  if (!cube || cube.schema !== "masspermits-aggregates/1") {
    throw new CubeMissing(`unexpected schema ${cube && cube.schema}`);
  }
  index(cube);
  cached = { cube, at: Date.now() };
  return cube;
}

export class CubeMissing extends Error {
  constructor(d) { super("aggregate cube unavailable: " + d); this.detail = String(d); }
}

// Derived lookups, built once per isolate. Kept off the wire file on purpose —
// the cube stays the smallest honest thing, and these are cheap to rebuild.
function index(cube) {
  const d = cube.dims;
  cube._ix = {
    townBySlug: new Map(d.town_slug.map((s, i) => [s, i])),
    tradeBySlug: new Map(d.trade.map((t, i) => [slug(t), i])),
    sourceBySlug: new Map(d.source.map((s, i) => [slug(s), i])),
    regionByKey: new Map(d.region.map((r) => [r.key, r])),
    weekIx: new Map(d.week.map((w, i) => [w, i])),
    capped: new Set(cube.caps.capped_sources),
    // town -> which sources published it (a town can come from more than one
    // source only if two towns slug alike; kept as a set for honesty anyway)
    sourcesByTown: (() => {
      const m = new Map();
      for (const [t, , , s] of cube.counts) {
        if (t < 0) continue;
        let set = m.get(t); if (!set) { set = new Set(); m.set(t, set); }
        set.add(s);
      }
      return m;
    })(),
    valuedBySource: new Map(cube.source_stats.map((r) => [r.i, r.valued_rows])),
  };
}

export function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ----------------------------------------------------------- freshness ------
export function freshness(cube) {
  const as = Date.parse(cube.as_of || "");
  if (!Number.isFinite(as)) return { days: null, stale: true, hard: false };
  const days = Math.floor((Date.now() - as) / 86_400_000);
  return {
    days,
    stale: days > (cube.freshness?.stale_days ?? 21),
    hard: days > (cube.freshness?.hard_stale_days ?? 60),
  };
}

// ------------------------------------------------------------ envelopes -----
// Every successful response carries the same five things: what the data is as
// of, what licence and citation bind the caller, what the query resolved to,
// how much of Massachusetts is actually in scope, and every caveat that a
// COMPUTED condition made true. Caveats are never written into prose here —
// each one is emitted by a predicate over the numbers, and carries the numbers
// that fired it. An asserted caveat nobody evaluates is the same defect as an
// asserted comparative nobody computes.
export function envelope(cube, query, result, extra = {}) {
  const f = freshness(cube);
  const caveats = extra.caveats || [];
  if (f.stale) {
    caveats.push({
      code: "stale_corpus",
      message: `The corpus was last refreshed ${f.days} days ago; it does not describe the most recent weeks.`,
      corpus_age_days: f.days, as_of: cube.as_of,
    });
  }
  return {
    api: {
      name: "MassPermits Aggregate API", version: VERSION,
      docs: SITE + BASE, openapi: SITE + BASE + "/openapi.json",
      terms: SITE + BASE + "/terms",
    },
    as_of: cube.as_of,
    corpus_age_days: f.days,
    license: cube.license,
    attribution: cube.attribution,
    query,
    result,
    coverage: extra.coverage || null,
    caveats,
    evidence: cube.evidence,
    method: cube.method,
    ...(extra.top || {}),
  };
}

// ------------------------------------------------------------- responses ----
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, If-None-Match",
  "Access-Control-Max-Age": "86400",
};

export function baseHeaders(cube) {
  const lic = (cube && cube.license && cube.license.url) || "";
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Attribution": (cube && cube.attribution && cube.attribution.cite_as) || "MassPermits",
    Link: [
      `<${SITE}${BASE}/openapi.json>; rel="service-desc"; type="application/json"`,
      `<${SITE}${BASE}/terms>; rel="terms-of-service"`,
      lic ? `<${lic}>; rel="license"` : null,
      `<${SITE}${CUBE_PATH}>; rel="describedby"; type="application/json"`,
    ].filter(Boolean).join(", "),
    ...CORS,
  };
}

// s-maxage of a day because the corpus moves weekly; SWR of a week so an edge
// never has to block on the origin for data that is, by design, a snapshot.
export const CACHE_CONTROL = "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800";

export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export function jsonResponse(body, { cube, status = 200, etag, rl, request } = {}) {
  const text = JSON.stringify(body, null, 1);
  const h = { ...baseHeaders(cube), "Cache-Control": CACHE_CONTROL };
  if (etag) h.ETag = etag;
  if (rl) {
    h["RateLimit-Limit"] = String(RATE.perMinute);
    h["RateLimit-Remaining"] = String(rl.remaining);
    h["RateLimit-Reset"] = String(rl.reset);
    h["RateLimit-Policy"] = `${RATE.perMinute};w=60;burst=${RATE.burst};comment="per edge isolate"`;
  }
  if (etag && request) {
    const inm = request.headers.get("if-none-match");
    if (inm && inm.split(",").some((v) => v.trim() === etag)) {
      return new Response(null, { status: 304, headers: h });
    }
  }
  return new Response(request && request.method === "HEAD" ? null : text, { status, headers: h });
}

// RFC 9457 problem+json. An error an agent can branch on beats an error a human
// has to read: `type` is a stable URI, and every 400 names what it would accept.
export function problem(status, title, detail, extra = {}) {
  return new Response(JSON.stringify({
    type: `${SITE}${BASE}/errors/${extra.code || "error"}`,
    title, status, detail, ...extra,
  }, null, 1), {
    status,
    headers: {
      "Content-Type": "application/problem+json; charset=utf-8",
      "Cache-Control": status === 429 || status === 503 ? "no-store" : "public, max-age=60",
      ...CORS,
      ...(extra.headers || {}),
    },
  });
}

// ----------------------------------------------------- query canonicalisation
// UNKNOWN PARAMETERS ARE REJECTED, NOT IGNORED. That is a cache decision before
// it is a strictness decision: ignoring them lets any client mint unlimited
// distinct URLs for the same answer and walk straight past the edge cache. It
// is also the friendlier behaviour — a typo'd `trade=roofin` fails loudly with
// the vocabulary attached instead of silently returning the statewide total.
export function canonQuery(url, allowed) {
  const out = {};
  const bad = [];
  for (const [k, v] of url.searchParams) {
    if (!allowed.includes(k)) { bad.push(k); continue; }
    if (k in out) continue;                       // first wins; repeats ignored
    out[k] = String(v).trim().slice(0, 64);
  }
  return { params: out, unknown: bad };
}

export function canonKey(url, params) {
  const keys = Object.keys(params).sort();
  const qs = keys.map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
  return url.origin + url.pathname.replace(/\/+$/, "") + (qs ? "?" + qs : "");
}

// ------------------------------------------------------------- resolution ---
// Resolve a user's filter words into cube indices, or fail with the vocabulary.
export function resolveFilters(cube, p) {
  const ix = cube._ix;
  const q = {};
  const err = (field, value, options) => ({
    field, value, options: options.slice(0, 400),
  });

  let towns = null, trades = null, sources = null, region = null;

  if (p.town !== undefined) {
    const i = ix.townBySlug.get(slug(p.town));
    if (i === undefined) return { error: err("town", p.town, cube.dims.town_slug) };
    towns = new Set([i]); q.town = cube.dims.town[i]; q.town_slug = cube.dims.town_slug[i];
  }
  if (p.trade !== undefined) {
    const i = ix.tradeBySlug.get(slug(p.trade));
    if (i === undefined) return { error: err("trade", p.trade, cube.dims.trade.map(slug)) };
    trades = new Set([i]); q.trade = cube.dims.trade[i];
  }
  if (p.source !== undefined) {
    const i = ix.sourceBySlug.get(slug(p.source));
    if (i === undefined) return { error: err("source", p.source, cube.dims.source.map(slug)) };
    sources = new Set([i]); q.source = cube.dims.source[i];
  }
  if (p.region !== undefined) {
    const r = ix.regionByKey.get(slug(p.region).replace(/-/g, ""));
    if (!r) return { error: err("region", p.region, cube.dims.region.map((x) => x.key)) };
    region = r;
    const set = new Set(r.sources);
    sources = sources ? new Set([...sources].filter((x) => set.has(x))) : set;
    q.region = r.key; q.region_label = r.label;
  }

  // Weeks. A week is INCLUDED WHEN IT INTERSECTS the requested range, and the
  // effective week window is reported back. Snapping silently — either way —
  // would make the returned count disagree with the returned window, and the
  // whole point of this API is that its numbers reconcile.
  let weeks = null, effFrom = null, effTo = null;
  const from = isoDate(p.from), to = isoDate(p.to);
  if (p.from !== undefined && !from) return { error: err("from", p.from, ["YYYY-MM-DD"]) };
  if (p.to !== undefined && !to) return { error: err("to", p.to, ["YYYY-MM-DD"]) };
  if (from || to) {
    weeks = new Set();
    cube.dims.week.forEach((w, i) => {
      const end = addDays(w, 6);
      if (from && end < from) return;
      if (to && w > to) return;
      weeks.add(i);
      if (!effFrom || w < effFrom) effFrom = w;
      if (!effTo || end > effTo) effTo = end;
    });
    q.from = from || null; q.to = to || null;
    q.effective_from = effFrom; q.effective_to = effTo;
  }
  return { q, towns, trades, sources, region, weeks, effFrom, effTo };
}

export function isoDate(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t + "T00:00:00Z")) ? t : null;
}

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------- caveats ------
// Each of these is a PREDICATE over computed numbers. If the predicate is false
// the caveat does not appear; if it is true the caveat carries the numbers that
// made it true. None of them is a sentence somebody decided to always print.

// The single most important one. `fetch_permiteyes` pages until it hits its
// limit, so a source sitting exactly on that limit returned a CEILING, not a
// count — and its earliest date is where our pull stopped, not where the town's
// records begin. 3 of 39 sources were capped on the 2026-09-06 corpus; 14 of 28
// on the snapshot before the limit was raised. A counts API that does not say
// this is publishing our pagination as if it were Massachusetts.
export function capCaveat(cube, srcCounts, total) {
  const capped = [...srcCounts.entries()].filter(([s]) => cube._ix.capped.has(s));
  if (!capped.length) return null;
  const n = capped.reduce((a, [, v]) => a + v, 0);
  return {
    code: "row_cap",
    message: "Some sources in this result returned exactly the fetcher's page limit. "
      + "For those sources the count is a floor on activity and a ceiling on what we "
      + "collected, and their earliest date is where our pull stopped, not where the "
      + "town's records begin.",
    row_cap: cube.caps.row_cap,
    capped_sources: capped.map(([s]) => cube.dims.source[s]).sort(),
    permits_from_capped_sources: n,
    share_of_result: total ? round4(n / total) : 0,
  };
}

// Coverage is 39 sources of 351 municipalities. Any count is a count of what we
// collected. Always present on counts, because the condition — "this is not a
// census" — is always true, and it is computed, not asserted: the numbers in it
// come from the corpus.
export function collectionCaveat(cube, srcCount) {
  return {
    code: "not_a_census",
    message: "Counts describe permits MassPermits collected, not permits Massachusetts "
      + "issued. Municipal publication differs by town, and most municipalities publish "
      + "nothing we can lawfully fetch.",
    sources_in_result: srcCount,
    sources_returning_rows: cube.corpus.sources_returning_rows,
    ma_municipalities: cube.corpus.ma_municipalities,
    coverage_share_of_municipalities: round4(cube.corpus.sources_returning_rows / cube.corpus.ma_municipalities),
  };
}

// Raw counts differ across sources mostly because collection differs, so any
// ranking of towns against each other measures our pipeline. Emitted only when
// the caller actually grouped in a way that invites the comparison.
export function crossSourceCaveat(groupBy) {
  if (groupBy !== "town" && groupBy !== "source" && groupBy !== "region") return null;
  return {
    code: "cross_source_incomparable",
    message: "Raw counts are not comparable between towns: they reflect what each "
      + "municipality publishes and how much of it we hold. Compare within-group shares "
      + "(`share_of_group_all_trades`, present when a trade filter is set) rather than "
      + "`permits` between groups.",
    grouped_by: groupBy,
  };
}

export function round4(x) { return Math.round(x * 10000) / 10000; }
