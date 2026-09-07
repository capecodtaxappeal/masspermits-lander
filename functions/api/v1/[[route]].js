// MassPermits — public AGGREGATE read API, router and handlers.
//
//   GET /api/v1                aggregate service description
//   GET /api/v1/openapi.json   OpenAPI 3.1 description (generated from the cube)
//   GET /api/v1/terms          licence, citation requirement, limits, the line
//   GET /api/v1/dimensions     the vocabularies a query may use
//   GET /api/v1/coverage       per-source coverage: what each town publishes
//   GET /api/v1/counts         permit counts by town / trade / week / month / source
//   GET /api/v1/value-bands    declared-value band distribution at a fixed grain
//
// One catch-all file rather than seven, because every route shares the same
// five steps — canonicalise, brake, cache, answer, caveat — and splitting them
// is how the five drift apart.
//
// See _lib.js for why the row/aggregate line is enforced by construction.

import {
  BASE, CUBE_PATH, SITE, VERSION, RATE, CACHE_CONTROL,
  loadCube, CubeMissing, freshness, envelope, jsonResponse, problem,
  canonQuery, canonKey, resolveFilters, rateLimit, fnv1a, slug,
  capCaveat, collectionCaveat, crossSourceCaveat, round4,
} from "./_lib.js";

const ROUTES = {
  "": { params: [] },
  "openapi.json": { params: [] },
  terms: { params: [] },
  dimensions: { params: [] },
  coverage: { params: ["source", "capped"] },
  counts: { params: ["town", "trade", "region", "source", "from", "to", "group_by", "limit"] },
  "value-bands": { params: ["town", "trade", "region"] },
};

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, If-None-Match",
        "Access-Control-Max-Age": "86400",
        Allow: "GET, HEAD, OPTIONS",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "Method not allowed",
      "This is a read-only API. Use GET.", { code: "method-not-allowed", headers: { Allow: "GET, HEAD, OPTIONS" } });
  }

  const parts = [].concat(context.params && context.params.route ? context.params.route : []);
  const route = parts.join("/").replace(/\/+$/, "");
  const spec = ROUTES[route];
  if (!spec) {
    return problem(404, "No such endpoint", `${BASE}/${route} is not an endpoint.`,
      { code: "no-such-endpoint", endpoints: Object.keys(ROUTES).map((r) => BASE + (r ? "/" + r : "")) });
  }

  const { params, unknown } = canonQuery(url, spec.params);
  if (unknown.length) {
    return problem(400, "Unknown query parameter",
      `This endpoint does not accept ${unknown.map((u) => `\`${u}\``).join(", ")}. `
      + "Unknown parameters are rejected rather than ignored, so that a typo fails "
      + "loudly instead of silently returning a different question's answer.",
      { code: "unknown-parameter", unknown, accepted: spec.params });
  }

  const ip = request.headers.get("cf-connecting-ip") || "anon";
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return problem(429, "Rate limited",
      `Over ${RATE.perMinute} requests/minute. Every answer here is cacheable for a day; `
      + `if you need the whole dataset, download it once: ${SITE}${CUBE_PATH}`,
      { code: "rate-limited", scope: rl.scope, bulk_download: SITE + CUBE_PATH,
        headers: { "Retry-After": String(Math.max(1, rl.reset)), "RateLimit-Remaining": "0" } });
  }

  const key = canonKey(url, params);
  let cache = null;
  try { cache = caches.default; } catch (_) { /* no Cache API in a test harness */ }
  if (cache && request.method === "GET") {
    const hit = await cache.match(new Request(key, { method: "GET" }));
    if (hit) return hit;
  }

  let cube;
  try {
    cube = await loadCube(context);
  } catch (e) {
    const missing = e instanceof CubeMissing;
    return problem(503, "Aggregate data unavailable",
      missing ? "The aggregate file this API reads is missing or is not the schema this "
        + "code understands. No figure is served from memory or from a fallback, so the "
        + "API answers nothing rather than answering wrongly."
        : "Unexpected failure loading the aggregate file.",
      { code: "cube-unavailable", detail: missing ? e.detail : undefined,
        headers: { "Retry-After": "300" } });
  }

  // A snapshot this old no longer describes anything a caller would mean by
  // "Massachusetts building permits". Refusing beats serving a quarter-old
  // picture under a fresh-looking timestamp.
  const f = freshness(cube);
  if (f.hard && route !== "" && route !== "terms" && route !== "openapi.json") {
    return problem(503, "Aggregate data too stale to serve",
      `The corpus was last refreshed ${f.days} days ago (limit ${cube.freshness.hard_stale_days}). `
      + "The pipeline is refreshed weekly; this endpoint returns 503 rather than publish a "
      + "figure that is no longer about the present.",
      { code: "corpus-too-stale", as_of: cube.as_of, corpus_age_days: f.days,
        headers: { "Retry-After": "86400" } });
  }

  let body;
  try {
    body = handle(route, cube, params, url);
  } catch (e) {
    if (e && e.__problem) return e.__problem;
    return problem(500, "Internal error", "The request could not be answered.", { code: "internal" });
  }
  if (body instanceof Response) return body;

  const etag = `W/"${fnv1a(String(cube.as_of) + "|" + key + "|" + VERSION)}"`;
  const res = jsonResponse(body, { cube, etag, rl, request });
  if (cache && request.method === "GET" && res.status === 200) {
    context.waitUntil(cache.put(new Request(key, { method: "GET" }), res.clone()));
  }
  return res;
}

function bail(res) { const e = new Error("problem"); e.__problem = res; throw e; }

// ------------------------------------------------------------------ routes --
function handle(route, cube, p, url) {
  switch (route) {
    case "": return index(cube);
    case "openapi.json": return openapi(cube);
    case "terms": return terms(cube);
    case "dimensions": return dimensions(cube);
    case "coverage": return coverage(cube, p);
    case "counts": return counts(cube, p);
    case "value-bands": return valueBands(cube, p);
  }
}

function index(cube) {
  return envelope(cube, {}, {
    description:
      "A public read API over AGGREGATE Massachusetts building-permit data: counts by "
      + "municipality, trade and ISO week, and declared-value band distributions. "
      + "Compiled from public municipal records on a weekly cadence.",
    what_this_returns: [
      "counts of permits, by town, trade, ISO week, month, source or region",
      "within-source shares, which are the only figures comparable between towns",
      "declared-value band distributions and quartiles, at a fixed set of grains",
      "per-source coverage: what each municipality publishes and what it omits",
    ],
    what_this_never_returns: [
      "permit rows of any kind",
      "owner names, contractor names, applicant names",
      "addresses, including the masked street names the public /feed/ files carry",
      "permit numbers, or exact issue dates (the finest time grain is the ISO week)",
      "any value statistic computed on fewer than "
        + cube.gates.min_valued_rows + " valued permits",
    ],
    why: "Aggregates are how the dataset is described; rows are the product. This API is "
      + "deliberately coarser than the free public feeds at " + SITE + "/feed/, which "
      + "already publish masked per-permit rows with exact dates and street names.",
    endpoints: [
      { path: BASE, method: "GET", description: "this document" },
      { path: BASE + "/openapi.json", method: "GET", description: "OpenAPI 3.1 description" },
      { path: BASE + "/terms", method: "GET", description: "licence, required citation, limits" },
      { path: BASE + "/dimensions", method: "GET", description: "towns, trades, regions, weeks, sources you may query" },
      { path: BASE + "/coverage", method: "GET", description: "per-source coverage and its caveats" },
      { path: BASE + "/counts", method: "GET", description: "permit counts, filtered and grouped" },
      { path: BASE + "/value-bands", method: "GET", description: "declared-value distribution at a grain" },
    ],
    bulk: {
      description: "Every answer this API gives is a slice of one public file. If you want "
        + "all of it, take the file — it is smaller than paginating for it.",
      url: cube.evidence,
      schema: cube.schema,
    },
    rate_limit: {
      requests_per_minute: RATE.perMinute, burst: RATE.burst,
      scope: "per edge isolate, not a distributed quota",
      note: "Answers are cacheable for a day and the query vocabulary is closed, so a "
        + "well-behaved client rarely reaches the origin at all.",
    },
    corpus: cube.corpus,
    freshness: { as_of: cube.as_of, ...cube.freshness },
  });
}

function terms(cube) {
  return envelope(cube, {}, {
    license: cube.license,
    attribution_required: true,
    cite_as: cube.attribution.cite_as,
    terms: [
      "1. Licence. The aggregates served here are published under CC BY-NC 4.0. "
      + "You may copy, transform and build on them, including in a commercial product's "
      + "editorial or research output, but not resell the aggregates themselves as a "
      + "dataset or as a competing feed.",
      "2. Citation. Every published figure taken from this API must name MassPermits and "
      + "link to " + SITE + ". Machine consumers should carry the `cite_as` string and "
      + "the `as_of` date together: the figure is only true as of that date.",
      "3. Caveats travel with the figures. Each response carries a `caveats` array whose "
      + "entries are emitted by computed conditions, not written in advance. If you "
      + "republish a number, republish the caveats attached to it — in particular "
      + "`row_cap` and `not_a_census`, which change what the number means.",
      "4. Coverage. This is a collection, not a census. "
      + cube.corpus.sources_returning_rows + " municipal sources of "
      + cube.corpus.ma_municipalities + " Massachusetts municipalities were returning rows "
      + "at the time of the last refresh. Do not describe these figures as statewide totals.",
      "5. Aggregates only. No endpoint returns permit rows, names or addresses, and none "
      + "will be added. The underlying artifact contains no such field; this is enforced "
      + "at build time, not at request time.",
      "6. No warranty. The records are compiled from public municipal publications that "
      + "differ in completeness, cadence and field coverage. Figures are provided as-is "
      + "for research and reporting.",
      "7. Fair use. " + RATE.perMinute + " requests/minute. If you need the whole dataset, "
      + "download " + cube.evidence + " once rather than paginating; that is what it is for.",
      "8. Row-level data. Permit-level records, including owner and contractor identity, "
      + "are a commercial product and are not available through this API at any price tier. "
      + "See " + SITE + ".",
    ],
    contact: "hello@masspermits.com",
    method: cube.method,
  });
}

function dimensions(cube) {
  const d = cube.dims;
  const townRows = new Map(), tradeRows = new Map(), srcRows = new Map();
  for (const [t, tr, , s, n] of cube.counts) {
    if (t >= 0) townRows.set(t, (townRows.get(t) || 0) + n);
    tradeRows.set(tr, (tradeRows.get(tr) || 0) + n);
    srcRows.set(s, (srcRows.get(s) || 0) + n);
  }
  return envelope(cube, {}, {
    town: d.town.map((name, i) => ({ slug: d.town_slug[i], name, permits: townRows.get(i) || 0 })),
    trade: d.trade.map((name, i) => ({ slug: slug(name), name, permits: tradeRows.get(i) || 0 })),
    region: d.region.map((r) => ({ key: r.key, label: r.label, sources: r.sources.length })),
    source: d.source.map((name, i) => ({
      slug: slug(name), name, region: d.source_region[i], permits: srcRows.get(i) || 0,
      capped: cube._ix.capped.has(i),
    })),
    week: { grain: "iso_week_monday", first: d.week[0], last: d.week[d.week.length - 1], n: d.week.length },
    group_by: ["none", "town", "trade", "week", "month", "source", "region"],
    value_grains: cube.value_grains,
    notes: {
      town_identity: "A town is identified by its slug, the same identifier that names "
        + SITE + "/permits/<slug>. " + (d.town_spellings_collapsed || 0) + " raw spelling(s) "
        + "in the source records collapsed onto an existing town under that rule.",
      region_assignment: "Regions are assigned by SOURCE, not by the city written on a "
        + "permit row: Boston rows carry neighbourhood names, which belong to no region.",
    },
  });
}

function coverage(cube, p) {
  let rows = cube.source_stats;
  const q = {};
  if (p.source !== undefined) {
    const want = slug(p.source);
    rows = rows.filter((r) => slug(r.source) === want);
    if (!rows.length) {
      bail(problem(400, "Unknown source", `No source named ${p.source}.`,
        { code: "unknown-value", field: "source", options: cube.source_stats.map((r) => slug(r.source)) }));
    }
    q.source = rows[0].source;
  }
  if (p.capped !== undefined) {
    const want = /^(1|true|yes)$/i.test(p.capped);
    rows = rows.filter((r) => !!r.capped === want);
    q.capped = want;
  }
  const caveats = [];
  if (rows.some((r) => r.capped)) {
    caveats.push({
      code: "row_cap",
      message: "A capped source returned exactly the fetcher's page limit. Its row count is "
        + "a ceiling on what we hold and its `first` date is where our pull stopped, not "
        + "where the town's records begin.",
      row_cap: cube.caps.row_cap,
      capped_sources: rows.filter((r) => r.capped).map((r) => r.source),
    });
  }
  const noValue = rows.filter((r) => r.valued_pct < 1).length;
  if (noValue) {
    caveats.push({
      code: "sparse_valuation",
      message: "Sources listed here publish no declared value at all, so no value figure "
        + "can be computed for them at any grain.",
      sources_without_value: noValue, sources_listed: rows.length,
      names: rows.filter((r) => r.valued_pct < 1).map((r) => r.source),
    });
  }
  return envelope(cube, q, {
    sources: rows.map((r) => ({
      source: r.source, town: r.source.replace(/,\s*MA$/i, ""),
      permits: r.rows, first: r.first, last: r.last,
      valued_permits: r.valued_rows, valued_pct: r.valued_pct,
      freetext_pct: r.freetext_pct, capped: r.capped,
      region: cube.dims.source_region[r.i] || null,
    })),
    summary: cube.coverage_summary,
  }, {
    caveats,
    coverage: coverageBlock(cube, rows.length),
  });
}

// ------------------------------------------------------------------ counts --
function counts(cube, p) {
  const r = resolveFilters(cube, p);
  if (r.error) {
    bail(problem(400, "Unknown value",
      `\`${r.error.field}=${r.error.value}\` is not in this API's vocabulary. `
      + `Call ${BASE}/dimensions for the full list.`,
      { code: "unknown-value", field: r.error.field, value: r.error.value, options: r.error.options }));
  }
  const groupBy = (p.group_by || "none").toLowerCase();
  const GROUPS = ["none", "town", "trade", "week", "month", "source", "region"];
  if (!GROUPS.includes(groupBy)) {
    bail(problem(400, "Unknown group_by", `group_by=${p.group_by} is not supported.`,
      { code: "unknown-value", field: "group_by", value: p.group_by, options: GROUPS }));
  }
  let limit = p.limit === undefined ? 200 : parseInt(p.limit, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
    bail(problem(400, "Bad limit", "limit must be an integer from 1 to 1000.",
      { code: "bad-limit", field: "limit", value: p.limit }));
  }

  const d = cube.dims;
  const groups = new Map();          // key -> {label, n}
  const denom = new Map();           // key -> n ignoring the trade filter
  const srcCounts = new Map();
  let total = 0, noTown = 0, totalIgnoringTrade = 0;

  for (const [t, tr, w, s, n] of cube.counts) {
    if (r.towns && !r.towns.has(t)) continue;
    if (r.sources && !r.sources.has(s)) continue;
    if (r.weeks && !r.weeks.has(w)) continue;
    // `denom` answers "how many permits of ANY trade did this group publish in
    // the same window" — the denominator that turns a cross-source count into a
    // within-source share, which is the only figure comparable between towns.
    // Not computed when grouping BY trade: there the denominator is the
    // numerator and the ratio would be a constant 1.0 dressed up as a finding.
    if (r.trades) {
      if (WITHIN_GROUPS.includes(groupBy)) {
        const dk = groupKey(groupBy, cube, t, tr, w, s);
        if (dk) denom.set(dk.key, (denom.get(dk.key) || 0) + n);
      }
      totalIgnoringTrade += n;
    }
    if (r.trades && !r.trades.has(tr)) continue;
    total += n;
    if (t < 0) noTown += n;
    srcCounts.set(s, (srcCounts.get(s) || 0) + n);
    const k = groupKey(groupBy, cube, t, tr, w, s);
    if (!k) continue;
    const g = groups.get(k.key);
    if (g) g.n += n; else groups.set(k.key, { label: k.label, n });
  }

  const caveats = [];
  const cap = capCaveat(cube, srcCounts, total);
  if (cap) caveats.push(cap);
  caveats.push(collectionCaveat(cube, srcCounts.size));
  const cs = crossSourceCaveat(groupBy);
  if (cs) caveats.push(cs);
  if (groupBy === "month") {
    caveats.push({
      code: "month_from_week_grain",
      message: "Months are assembled from ISO weeks and a week is attributed to the month "
        + "of its Monday, so a week spanning a month boundary counts entirely in the "
        + "earlier month. Use group_by=week for an exact partition.",
    });
  }
  if (noTown) {
    caveats.push({
      code: "rows_without_town",
      message: "Some permits carry no usable municipality in the published record. They are "
        + "counted in the total and in every source group, and are excluded from town groups.",
      permits: noTown, share_of_result: total ? round4(noTown / total) : 0,
    });
  }
  if (r.effFrom) {
    caveats.push({
      code: "window_snapped_to_weeks",
      message: "Counts are bucketed by ISO week, so the requested range was widened to the "
        + "weeks it intersects. The returned total is exactly the permits in the effective "
        + "window; it is not a pro-rated estimate of the requested one.",
      requested_from: r.q.from, requested_to: r.q.to,
      effective_from: r.effFrom, effective_to: r.effTo,
    });
  }

  const rows = [...groups.entries()].map(([key, { label, n }]) => {
    const g = { key, label, permits: n, share_of_result: total ? round4(n / total) : 0 };
    // The comparable ratio. Present only when a trade filter makes it mean
    // something, and only when the denominator is big enough not to be noise.
    const dv = denom.get(key);
    if (dv !== undefined) {
      g.permits_all_trades = dv;
      if (dv >= MIN_DENOM) {
        g.share_of_group_all_trades = round4(n / dv);
      } else {
        g.share_of_group_all_trades = null;
        g.share_suppressed = `denominator below ${MIN_DENOM} permits`;
      }
    }
    return g;
  });
  const chrono = groupBy === "week" || groupBy === "month";
  rows.sort(chrono ? (a, b) => (a.key < b.key ? -1 : 1) : (a, b) => b.permits - a.permits || (a.key < b.key ? -1 : 1));
  const shown = rows.slice(0, limit);

  return envelope(cube, { ...r.q, group_by: groupBy, limit },
    {
      permits: total,
      ...(r.trades ? { permits_all_trades_in_scope: totalIgnoringTrade,
                       share_within_scope: totalIgnoringTrade ? round4(total / totalIgnoringTrade) : null } : {}),
      group_by: groupBy,
      groups: groupBy === "none" ? null : shown,
      groups_returned: groupBy === "none" ? 0 : shown.length,
      groups_total: groupBy === "none" ? 0 : rows.length,
      truncated: groupBy !== "none" && rows.length > shown.length,
      // Unfiltered, the window is the corpus's real first and last permit date.
      // Reporting the last WEEK's Sunday there would claim data through a date
      // no permit reaches — the same class of error as stamping today's build
      // clock on a page built from last month's rows.
      window: r.effFrom
        ? { from: r.effFrom, to: r.effTo, grain: "iso_week_monday", snapped_to_weeks: true,
            corpus_first: cube.corpus.first, corpus_last: cube.corpus.last }
        : { from: cube.corpus.first, to: cube.corpus.last, grain: "iso_week_monday",
            snapped_to_weeks: false },
    },
    { caveats, coverage: coverageBlock(cube, srcCounts.size) });
}

// Groupings for which "this trade's share of the group's own permits" is a
// meaningful, cross-source-comparable ratio.
const WITHIN_GROUPS = ["town", "source", "region", "week", "month"];
// Below this the ratio is noise dressed as a finding, so it is withheld and
// said to be withheld rather than printed with three decimal places.
const MIN_DENOM = 20;

function groupKey(groupBy, cube, t, tr, w, s) {
  const d = cube.dims;
  switch (groupBy) {
    case "none": return null;
    case "town": return t < 0 ? null : { key: d.town_slug[t], label: d.town[t] };
    case "trade": return { key: slug(d.trade[tr]), label: d.trade[tr] };
    case "week": return { key: d.week[w], label: d.week[w] };
    case "month": return { key: d.week[w].slice(0, 7), label: d.week[w].slice(0, 7) };
    case "source": return { key: slug(d.source[s]), label: d.source[s] };
    case "region": {
      const k = d.source_region[s];
      if (!k) return { key: "unassigned", label: "(source in no region)" };
      const reg = cube._ix.regionByKey.get(k);
      return { key: k, label: reg ? reg.label : k };
    }
  }
  return null;
}

// -------------------------------------------------------------- value bands --
function valueBands(cube, p) {
  const r = resolveFilters(cube, p);
  if (r.error) {
    bail(problem(400, "Unknown value",
      `\`${r.error.field}=${r.error.value}\` is not in this API's vocabulary.`,
      { code: "unknown-value", field: r.error.field, value: r.error.value, options: r.error.options }));
  }
  if (p.town !== undefined && p.region !== undefined) {
    bail(problem(400, "Contradictory grain",
      "town and region are alternative geographies. Value statistics are stored at a fixed "
      + "set of grains and are computed exactly at each — they are never summed out of "
      + "smaller cells, because summing cells that were individually suppressed undercounts "
      + "silently.",
      { code: "bad-grain", grains: cube.value_grains }));
  }

  const d = cube.dims;
  const ti = p.town !== undefined ? cube._ix.townBySlug.get(slug(p.town)) : undefined;
  const di = p.trade !== undefined ? cube._ix.tradeBySlug.get(slug(p.trade)) : undefined;
  const parts = [];
  if (p.region !== undefined) parts.push("r:" + r.q.region);
  if (ti !== undefined) parts.push("c:" + ti);
  if (di !== undefined) parts.push("t:" + di);
  const grainKey = parts.join("|");
  const v = cube.values[grainKey];
  // Two names for the same cell. `grain` is what a reader understands;
  // `evidence_key` is the literal key to look up in the published aggregate
  // file, so "check our numbers" is a lookup rather than a reconstruction.
  const grain = [
    p.region !== undefined ? "region=" + r.q.region : null,
    ti !== undefined ? "town=" + cube.dims.town_slug[ti] : null,
    di !== undefined ? "trade=" + slug(cube.dims.trade[di]) : null,
  ].filter(Boolean).join(",") || "statewide";

  // Scope, from the fact table — so a suppressed grain still tells you how many
  // permits exist there and why no value figure came back.
  let inScope = 0, valuedSources = 0, scopeSources = new Set();
  for (const [t, tr, , s, n] of cube.counts) {
    if (ti !== undefined && t !== ti) continue;
    if (di !== undefined && tr !== di) continue;
    if (r.sources && !r.sources.has(s)) continue;
    inScope += n; scopeSources.add(s);
  }
  for (const s of scopeSources) if ((cube._ix.valuedBySource.get(s) || 0) > 0) valuedSources++;

  const caveats = [];
  if (valuedSources < scopeSources.size) {
    caveats.push({
      code: "sparse_valuation",
      message: "Only some municipalities in scope publish a declared value at all. The "
        + "distribution below describes the permits that carry one — it is not a sample of "
        + "all permits in scope, and the towns that publish no value are absent entirely.",
      sources_in_scope: scopeSources.size,
      sources_publishing_value: valuedSources,
      sources_without_value: [...scopeSources]
        .filter((s) => !(cube._ix.valuedBySource.get(s) > 0))
        .map((s) => d.source[s]).sort(),
    });
  }
  if (!v) {
    caveats.push({
      code: "small_cell_suppressed",
      message: `No value statistic is published for this grain: fewer than `
        + `${cube.gates.min_valued_rows} permits in it carry a declared value. The gate is `
        + `the same one behind the site's own cost pages, and it is not lowerable by `
        + `parameter.`,
      grain,
      evidence_key: grainKey,
      min_valued_rows: cube.gates.min_valued_rows,
      permits_in_scope: inScope,
    });
    return envelope(cube, r.q, {
      grain,
      evidence_key: grainKey,
      value: null,
      permits_in_scope: inScope,
      definition: VALUE_DEF,
    }, { caveats, coverage: coverageBlock(cube, scopeSources.size) });
  }

  const [n, p25, p50, p75, max, ...bands] = v;
  const edges = cube.gates.value_bands;
  return envelope(cube, r.q, {
    grain,
    evidence_key: grainKey,
    value: {
      valued_permits: n,
      p25, median: p50, p75, max,
      bands: bands.map((c, i) => ({
        from: edges[i], to: i + 1 < edges.length ? edges[i + 1] : null,
        permits: c, share: n ? round4(c / n) : 0,
      })),
    },
    permits_in_scope: inScope,
    valued_share_of_scope: inScope ? round4(n / inScope) : null,
    definition: VALUE_DEF,
    percentile_convention: "value at index floor(q * n) of the sorted values — the same "
      + "convention the site's cost pages use, so the two agree when built from one corpus",
  }, { caveats, coverage: coverageBlock(cube, scopeSources.size) });
}

const VALUE_DEF =
  "declared_value: the project value the applicant declared on the permit application. "
  + "It is not a contract price, not a final cost, and not an assessment. Municipalities "
  + "differ in whether they publish it at all and in how they round it.";

// ---------------------------------------------------------------- coverage ---
function coverageBlock(cube, inResult) {
  return {
    sources_in_result: inResult,
    sources_returning_rows: cube.corpus.sources_returning_rows,
    sources_errored: cube.corpus.sources_errored,
    ma_municipalities: cube.corpus.ma_municipalities,
    towns_published: cube.corpus.towns_published,
    note: "MassPermits collects from municipalities that publish permit records in a form "
      + "we can lawfully fetch. Most do not. Treat every figure as a description of this "
      + "collection, never of Massachusetts.",
    detail: SITE + BASE + "/coverage",
  };
}

// ----------------------------------------------------------------- openapi ---
// Generated from the cube so the enums are the vocabulary that actually exists.
// A hand-maintained spec drifts from its API, and an agent that trusts a drifted
// enum sends requests this API rejects.
function openapi(cube) {
  const d = cube.dims;
  const param = (name, schema, description) => ({ name, in: "query", required: false, schema, description });
  const townEnum = d.town_slug;
  const tradeEnum = d.trade.map(slug);
  const regionEnum = d.region.map((r) => r.key);
  const sourceEnum = d.source.map(slug);
  const envelopeSchema = {
    type: "object",
    required: ["api", "as_of", "license", "attribution", "result", "caveats"],
    properties: {
      api: { type: "object" },
      as_of: { type: "string", format: "date-time", description: "When the corpus behind this answer was last refreshed. A figure is only true as of this instant." },
      corpus_age_days: { type: ["integer", "null"] },
      license: { type: "object" },
      attribution: { type: "object", description: "Citation is required. `cite_as` is the string to carry with any republished figure." },
      query: { type: "object", description: "The query as this API resolved it. Compare it with what you sent." },
      result: { type: ["object", "null"] },
      coverage: { type: ["object", "null"] },
      caveats: {
        type: "array",
        description: "Emitted by computed conditions over the returned numbers, not written in advance. Republish them with the figures.",
        items: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } },
      },
      evidence: { type: "string", format: "uri", description: "The complete aggregate file behind every answer." },
      method: { type: "string", format: "uri" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "MassPermits Aggregate API",
      version: "1.0." + String(cube.as_of || "").slice(0, 10).replace(/-/g, ""),
      summary: "Aggregate Massachusetts building-permit statistics. No permit rows.",
      description:
        "Counts of Massachusetts building permits by municipality, trade and ISO week, plus "
        + "declared-value band distributions, compiled weekly from public municipal records.\n\n"
        + "**This API returns aggregates only.** It has no endpoint for permit rows, owner or "
        + "contractor names, addresses, permit numbers or exact issue dates, and none will be "
        + "added: the deployed artifact contains no such field. Row-level records are a "
        + "commercial product.\n\n"
        + "**It is a collection, not a census.** "
        + cube.corpus.sources_returning_rows + " municipal sources of "
        + cube.corpus.ma_municipalities + " Massachusetts municipalities were returning rows at "
        + "the last refresh. Every response carries a `coverage` block and a `caveats` array; "
        + "the caveats are generated by conditions computed over the numbers being returned, "
        + "and any republished figure must carry them.\n\n"
        + "**Bulk:** every answer is a slice of one public file, " + cube.evidence + ". "
        + "Download it rather than paginating.",
      termsOfService: SITE + BASE + "/terms",
      contact: { name: "MassPermits", url: SITE, email: "hello@masspermits.com" },
      license: { name: "CC BY-NC 4.0", identifier: "CC-BY-NC-4.0", url: cube.license.url },
    },
    servers: [{ url: SITE + BASE }],
    externalDocs: { description: "Method and corrections", url: cube.method },
    paths: {
      "/": { get: { operationId: "getService", summary: "Service description", responses: ok(envelopeSchema) } },
      "/terms": { get: { operationId: "getTerms", summary: "Licence, citation requirement and limits", responses: ok(envelopeSchema) } },
      "/dimensions": { get: { operationId: "getDimensions", summary: "The vocabularies a query may use", responses: ok(envelopeSchema) } },
      "/coverage": {
        get: {
          operationId: "getCoverage",
          summary: "Per-source coverage: rows, date span, valued share, free-text share, row cap",
          parameters: [
            param("source", { type: "string", enum: sourceEnum }, "Restrict to one municipal source."),
            param("capped", { type: "boolean" }, "Only sources whose row count is a fetcher ceiling (true) or only those that are not (false)."),
          ],
          responses: ok(envelopeSchema),
        },
      },
      "/counts": {
        get: {
          operationId: "getCounts",
          summary: "Permit counts, filtered and grouped",
          description:
            "Counts are bucketed by ISO week (named by the Monday). `from`/`to` widen to the "
            + "weeks they intersect and the effective window is returned.\n\n"
            + "When a `trade` filter is set, each group also carries `share_within_source` — "
            + "that trade's share of the group's own permits. **That share is the comparable "
            + "figure.** Raw counts differ between towns mostly because publication differs, "
            + "so ranking towns by `permits` measures this pipeline rather than Massachusetts.",
          parameters: [
            param("town", { type: "string", enum: townEnum }, "Town slug, as at /permits/<slug>."),
            param("trade", { type: "string", enum: tradeEnum }, "Trade slug."),
            param("region", { type: "string", enum: regionEnum }, "Region key. Assigned by source, not by the city on a permit row."),
            param("source", { type: "string", enum: sourceEnum }, "Municipal source slug."),
            param("from", { type: "string", format: "date" }, "Inclusive start; widened to the containing ISO week."),
            param("to", { type: "string", format: "date" }, "Inclusive end; widened to the containing ISO week."),
            param("group_by", { type: "string", enum: ["none", "town", "trade", "week", "month", "source", "region"], default: "none" }, "Grouping."),
            param("limit", { type: "integer", minimum: 1, maximum: 1000, default: 200 }, "Maximum groups returned."),
          ],
          responses: ok(envelopeSchema),
        },
      },
      "/value-bands": {
        get: {
          operationId: "getValueBands",
          summary: "Declared-value band distribution and quartiles at a fixed grain",
          description:
            "Value statistics exist only at the grains listed in `value_grains`, are computed "
            + "exactly at each, and are withheld entirely below "
            + cube.gates.min_valued_rows + " valued permits. They are never summed out of "
            + "smaller cells, because summing individually suppressed cells undercounts "
            + "silently. There is no date filter: the value layer has no time grain.\n\n"
            + "Most municipalities in the corpus publish no declared value at all, so the "
            + "distribution describes the permits that carry one. `valued_share_of_scope` and "
            + "the `sparse_valuation` caveat give you the denominator.",
          parameters: [
            param("town", { type: "string", enum: townEnum }, "Town slug. Mutually exclusive with region."),
            param("trade", { type: "string", enum: tradeEnum }, "Trade slug."),
            param("region", { type: "string", enum: regionEnum }, "Region key. Mutually exclusive with town."),
          ],
          responses: ok(envelopeSchema),
        },
      },
    },
    components: {
      schemas: { Envelope: envelopeSchema },
      responses: {
        Problem: {
          description: "RFC 9457 problem document",
          content: { "application/problem+json": { schema: { type: "object", required: ["type", "title", "status"] } } },
        },
      },
    },
  };
}

function ok(schema) {
  return {
    200: { description: "Aggregate answer", content: { "application/json": { schema } } },
    400: { $ref: "#/components/responses/Problem" },
    429: { $ref: "#/components/responses/Problem" },
    503: { $ref: "#/components/responses/Problem" },
  };
}
