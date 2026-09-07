// MassPermits — one-town live vendor probe (Pages Function, Access-gated).
//
// A Pages Function cannot run Python. It does not need to. This is an on-demand
// HTTPS call to the town's real vendor endpoint, driven entirely by a
// declarative spec the engine emits from the same constants the fetcher reads
// (PermitPulse/emit_probe_map.py -> R2 probe-map.json), returning in ~2s.
//
// THIS FILE CONTAINS ZERO TOWN KNOWLEDGE.
// No town names, no slugs, no vendor URLs, no column maps, no user-agents.
// It receives a source key, looks it up in probe-map.json, and executes what it
// finds. That is both the anti-drift property and the SSRF boundary: no URL,
// host, path, header or body ever comes from the request.
//
// WHY NOT workflow_dispatch (which WOULD run the real fetcher)
// -----------------------------------------------------------
// GitHub fine-grained PAT scopes are PER REPOSITORY, not per workflow, and
// every workflow in this repo declares bare `workflow_dispatch: {}`. That
// includes weekly-feed.yml, whose job POSTs /api/weekly-send. So a dispatch
// credential in the Cloudflare Pages environment creates a direct path from
// "anything that can read that env var" to "send real email to real paying
// customers", and it CANNOT be mitigated by scoping, because the scope does
// not exist. A dashboard is not worth a credential that can mail customers, at
// any latency. Endpoint-side mitigations are good against endpoint misuse and
// do nothing against credential leakage, which is the risk that matters.
//
// WHAT THE PROBE PROVES, AND WHAT IT DOES NOT
// -------------------------------------------
// It proves the vendor is reachable, answering in the expected envelope, and
// NON-EMPTY. Then it shows the operator the newest row's cells, indexed, beside
// the field each index maps to. That last part is the payload:
//
//   The Braintree bug fixed on 2026-09-06 shifted PE_LAYOUT indices +1 from 10
//   onward with the WIDTH UNCHANGED at 14. Row counts were normal.
//   source_health read `ok`. The zero-row floor saw nothing. Every automated
//   check here — reachability, envelope, non-empty, width — stays green through
//   that bug, for months. The only thing that catches it is a human seeing
//   `[13] "Permit Issued"` under a label that says `permit`.
//
// It does NOT run our parser. It never moves a town's light. Its verdict
// vocabulary is deliberately non-colour so a probe result can never be mistaken
// for a health state.
//
// HARD RULE, RESTATED IN CODE: if a probe returns 403, THAT IS THE ANSWER. The
// page displays it and stops. No retry, no backoff loop, no UA rotation, no IP
// rotation. The OpenGov/ViewPoint lockout is permanent and intentional, and
// those 117 towns are unreachable from this button by construction — refresh()
// does not iterate them, so emit_probe_map.py never puts them in the map.
//
// THE CUSTOMER LIST IS NEVER TOUCHED HERE either -- not read, not headed, not
// listed and not named, for the reason spelled out at the top of pipeline.js.

import { verifyCfAccess } from "./_cf-access.js";

const COOLDOWN_S = 60;        // per town
const HOURLY_CAP = 20;        // global, all towns
const TIMEOUT_MS = 15_000;    // no retries; a failed probe is an answer
const MAX_BYTES = 4 * 1024 * 1024;
const SAMPLE_CELLS = 40;      // one row is never wider than this in PE_LAYOUT

// Non-colour verdict vocabulary. Nothing here maps to green/yellow/red.
const V = {
  OK: "vendor_ok",
  EMPTY: "vendor_empty",
  SHAPE: "vendor_shape_changed",
  WIDTH: "vendor_width_changed",
  UNREACHABLE: "vendor_unreachable",
  NOT_PROBEABLE: "not_probeable",
  COOLDOWN: "cooldown",
  RATE_LIMITED: "rate_limited",
  UNKNOWN: "unknown_town",
};

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await verifyCfAccess(request, env);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 403);

  // A required custom header forces a CORS preflight on any cross-origin
  // attempt and makes this unreachable from a plain cross-site form POST.
  if (request.headers.get("x-masspermits-probe") !== "1") {
    return json({ error: "bad request", reason: "missing X-MassPermits-Probe" }, 400);
  }

  let body;
  try { body = await request.json(); } catch { body = null; }
  const key = body && typeof body.key === "string" ? body.key : "";
  // Shape check before any I/O, my-leads.js style. Source keys are "Town, MA".
  if (!/^[A-Za-z .'-]{2,40}, MA$/.test(key)) {
    return json({ verdict: V.UNKNOWN, error: "malformed source key" }, 400);
  }

  let map;
  try {
    const o = await env.BUNDLES.get("probe-map.json");
    map = o ? JSON.parse(await o.text()) : null;
  } catch {
    map = null;
  }
  if (!map) {
    return json({ verdict: V.NOT_PROBEABLE,
      detail: "probe-map.json is not in R2. Run PermitPulse/emit_probe_map.py " +
              "and publish it with wrangler; it is deliberately not on the CI " +
              "write path." }, 503);
  }

  const spec = (map.sources || {})[key];
  if (!spec) return json({ verdict: V.UNKNOWN, key, detail: "not in probe-map.json" }, 404);
  if (spec.probe !== "payload" && spec.probe !== "transport") {
    return json({ verdict: V.NOT_PROBEABLE, key,
                  detail: spec.reason || "no probe spec for this source" }, 200);
  }

  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const lockKey = "probe/" + slug;

  // ── Pacing. A probe is cheaper for the town than a scrape (25 rows, one
  // page, against PE_PAGE=300 / PE_MAX_ROWS=2400) but it is still a request to
  // a municipal server on a human's whim.
  //
  // Both counters use head()/list() over customMetadata with EMPTY bodies and
  // zero body reads — funnel.js:10-13's convention, which exists to stay inside
  // the Workers subrequest budget no matter how long the lists get.
  let prev = null;
  try { prev = await env.BUNDLES.head(lockKey); } catch { prev = null; }
  if (prev && prev.customMetadata && prev.customMetadata.at) {
    const since = (Date.now() - Number(prev.customMetadata.at)) / 1000;
    if (Number.isFinite(since) && since < COOLDOWN_S) {
      return json({ verdict: V.COOLDOWN, key,
        retry_in_s: Math.ceil(COOLDOWN_S - since),
        last: metaToResult(prev.customMetadata) }, 200);
    }
  }

  const hourPrefix = "probe/hour-" + new Date().toISOString().slice(0, 13) + "/";
  try {
    const l = await env.BUNDLES.list({ prefix: hourPrefix, limit: HOURLY_CAP + 1 });
    if ((l.objects || []).length >= HOURLY_CAP) {
      return json({ verdict: V.RATE_LIMITED, key, cap: HOURLY_CAP,
        detail: `${HOURLY_CAP} probes already this UTC hour.` }, 429);
    }
  } catch { /* a failed count must not become a licence to hammer a town, but
                it must also not be the reason the operator cannot diagnose an
                outage. The per-town 60s cooldown above still holds. */ }

  const t0 = Date.now();
  let out;
  try {
    out = spec.probe === "transport"
      ? await transportProbe(spec)
      : await payloadProbe(spec, prev);
  } catch (e) {
    out = { verdict: V.UNREACHABLE,
            detail: String((e && e.message) || e).slice(0, 200) };
  }
  out.ms = Date.now() - t0;
  out.key = key;
  out.probe = spec.probe;
  out.kind = spec.kind || null;
  out.note = spec.note || null;
  out.at = new Date().toISOString();
  out.map_generated_at = map.generated_at || null;
  out.sensitive_key_pattern = map.sensitive_key_pattern || null;

  // PERSIST VERDICTS AND SHAPES, NEVER PAYLOADS. probe/<slug> stores
  // {verdict, http, rows_returned, cells, ms, at} and nothing else. Never
  // data[0] — those cells are a real permit at a real address.
  const meta = {
    at: String(Date.now()),
    verdict: String(out.verdict || ""),
    http: String(out.http_status == null ? "" : out.http_status),
    rows: String(out.rows_returned == null ? "" : out.rows_returned),
    cells: String(out.cells == null ? "" : out.cells),
    ms: String(out.ms),
  };
  try {
    await env.BUNDLES.put(lockKey, "", { customMetadata: meta });
    await env.BUNDLES.put(hourPrefix + Date.now() + "-" + slug, "",
      { customMetadata: { k: slug, v: meta.verdict } });
  } catch { /* the probe already happened; failing to record it must not turn a
                successful diagnosis into an error page. */ }

  return json(out, 200);
}

// ── Transport-only: the seven monthly publishers ────────────────────────────
// PDF (pdfplumber) and XLSX towns. A Worker cannot parse either, so this
// returns a MEASUREMENT — {http_status, ms, bytes, content_type} — and says so.
// Enough to catch a site-wide outage or "the town closed its public archive" in
// one second. Never a greyed-out mystery button; always a stated reason.
async function transportProbe(spec) {
  const r = await doFetch(spec.url, { method: "GET", headers: spec.headers || {} });
  const buf = await readCapped(r);
  const ct = r.headers.get("content-type") || "";
  const magic = new Uint8Array(buf.slice(0, 4));
  const isPdf = magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46;
  const looksHtml = /html/i.test(ct);

  let verdict = V.OK, detail = "";
  if (!r.ok) {
    // NOTE the vocabulary: any non-2xx reports as vendor_unreachable with the
    // HTTP status printed verbatim beside it. Read the status, not the word —
    // a 404 on a monthly document means the file is not there, which is a
    // different problem from DNS or TLS, and the number says which.
    verdict = V.UNREACHABLE;
    detail = `HTTP ${r.status}. Read the status code, not the verdict word: ` +
             "404 means the document is not published where the fetcher looks; " +
             "5xx/timeout means the town's site is down.";
  } else if (spec.expect === "pdf" && !isPdf) {
    verdict = V.SHAPE;
    detail = "200 OK but the body does not start with %PDF — the town is " +
             "serving something else at the fetcher's URL (a login page, an " +
             "error page, or an HTML redirect).";
  } else if (spec.expect === "html" && !looksHtml && buf.byteLength < 200) {
    verdict = V.SHAPE;
    detail = "200 OK but the listing page is tiny and not HTML.";
  }
  return {
    verdict, detail,
    http_status: r.status,
    bytes: buf.byteLength,
    content_type: ct.slice(0, 120),
    url_host: hostOf(spec.url),
    parsed: false,
    transport_note:
      "Reachability only. This does NOT download or parse a monthly document, " +
      "and it says nothing about whether the file's contents changed shape.",
  };
}

// ── Payload probe: the 32 sources whose rows arrive as JSON ─────────────────
async function payloadProbe(spec, prev) {
  let cookie = "";
  if (spec.prime_url) {
    // PermitEyes hands out a session cookie on the public page and the ajax
    // endpoint requires it. Same two-step the real fetcher does; Workers' fetch
    // has no cookie jar, so carry it by hand.
    const p = await doFetch(spec.prime_url, {
      method: "GET",
      headers: { "User-Agent": (spec.headers && spec.headers["User-Agent"]) || "" },
      redirect: "follow",
    });
    cookie = collectCookies(p);
    // The Norwell test, in one line: publicview.php 200s and lands on
    // login.php when a town switches its public view off. That is an
    // authorization decision by the publisher, not an outage, and the house
    // answer to it is OUT — never a side door through the ajax endpoint.
    const finalUrl = p.url || spec.prime_url;
    if (/login\.php/i.test(finalUrl)) {
      return { verdict: V.SHAPE, http_status: p.status,
        final_url: finalUrl.slice(0, 200), url_host: hostOf(spec.prime_url),
        detail: "The public view redirected to login.php. The town has closed " +
                "its public record access. This is an authorization decision by " +
                "the publisher, not an outage — the source should come OUT of " +
                "the registry, not be reached another way." };
    }
    if (!p.ok) {
      return { verdict: V.UNREACHABLE, http_status: p.status,
        url_host: hostOf(spec.prime_url),
        detail: `Priming ${spec.prime_url.slice(0, 120)} returned HTTP ${p.status}.` };
    }
  }

  const headers = Object.assign({}, spec.headers || {});
  if (cookie) headers["Cookie"] = cookie;
  const init = { method: spec.method === "POST" ? "POST" : "GET", headers };
  if (init.method === "POST") init.body = spec.body || "";

  const url = spec.post_url || spec.url;
  const r = await doFetch(url, init);
  const buf = await readCapped(r);
  const text = new TextDecoder().decode(buf);

  // Check 1 — reachable, HTTP 2xx, TLS. Catches the site-wide TLS outage class
  // (Amherst, 2026-08-11..14) in one second.
  if (!r.ok) {
    return { verdict: V.UNREACHABLE, http_status: r.status, bytes: buf.byteLength,
      url_host: hostOf(url),
      detail: r.status === 403
        ? "403. That is the answer. This endpoint does not retry, back off, " +
          "rotate a user-agent or rotate an IP — an access decision by the " +
          "publisher is respected, not worked around."
        : `HTTP ${r.status} from the vendor.`,
      body_head: text.slice(0, 300) };
  }

  // Check 2 — the expected JSON array is present.
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    return { verdict: V.SHAPE, http_status: r.status, bytes: buf.byteLength,
      url_host: hostOf(url),
      detail: "200 OK but the body is not JSON — the vendor changed its " +
              "response envelope, or served an HTML error/login page.",
      body_head: text.slice(0, 300) };
  }
  let arr = parsed;
  for (const seg of spec.json_path || []) {
    arr = arr && typeof arr === "object" ? arr[seg] : undefined;
  }
  if (!Array.isArray(arr)) {
    return { verdict: V.SHAPE, http_status: r.status, bytes: buf.byteLength,
      url_host: hostOf(url),
      detail: `200 OK, valid JSON, but no array at ${JSON.stringify(spec.json_path || [])} ` +
              "— the vendor changed its response envelope.",
      body_head: text.slice(0, 300) };
  }

  // Check 3 — the array is NON-EMPTY. A probe that returns green on a 200 is
  // "a green run is not proof" reproduced inside the button built to eliminate
  // it. This is the exact 2026-08-01 signature: fetch_opengov returning [] per
  // town with errors:{}.
  if (arr.length === 0) {
    return { verdict: V.EMPTY, http_status: r.status, rows_returned: 0,
      bytes: buf.byteLength, url_host: hostOf(url),
      detail: "The vendor answered 200 and returned 0 rows — the silent-death " +
              "shape. This is what the 2026-08-01 lockout looked like from the " +
              "inside, and it is the single most important thing this button " +
              "can find." };
  }

  // Rows may be positional arrays (PermitEyes) or objects (CKAN/Socrata/ArcGIS).
  const rawRow = spec.arcgis_attributes && arr[0] && arr[0].attributes
    ? arr[0].attributes : arr[0];
  const isArrayRow = Array.isArray(rawRow);
  const cells = isArrayRow ? rawRow.length : Object.keys(rawRow || {}).length;

  // Check 4 — width vs LAST OBSERVED, and vs the highest index PE_LAYOUT
  // actually reads. NOT `cells === requested_ncols`: requested_ncols is the
  // width we ASK for in the DataTables body, not the width the server returns.
  // scraper.py:288-290 records the real widths (Braintree 14, Rockland 12,
  // Hingham 17) and rockland/hingham are exactly the two towns with no `ncols`
  // in PE_LAYOUT, so their emitted expectation is the default 14. Asserting
  // equality there is a permanent false "shape changed" on 2 of 29 PermitEyes
  // towns, on a healthy day, forever — and permanent red is how a board teaches
  // its only user to ignore red.
  //
  // The real invariant is: is the payload still wide enough for every cell we
  // parse, and did the width move since last time?
  const prevCells = prev && prev.customMetadata && prev.customMetadata.cells
    ? Number(prev.customMetadata.cells) : null;
  const maxIdx = spec.max_index_used == null ? null : Number(spec.max_index_used);

  let verdict = V.OK, detail = "";
  if (isArrayRow && maxIdx !== null && cells <= maxIdx) {
    verdict = V.SHAPE;
    detail = `The payload is ${cells} cells wide but PE_LAYOUT reads index ` +
             `${maxIdx}. Every row parsed from this town is losing at least one ` +
             "mapped field right now.";
  } else if (Number.isFinite(prevCells) && prevCells > 0 && prevCells !== cells) {
    verdict = V.WIDTH;
    detail = `Width moved from ${prevCells} (last probe) to ${cells}. Advisory: ` +
             "a width change does not prove the map is wrong, and an unchanged " +
             "width does not prove it is right — the Braintree bug shifted every " +
             "index from 10 onward with the width unchanged at 14.";
  }

  // Check 5 — the newest row's cells, indexed, beside the field each index maps
  // to. THE PAYLOAD. See this file's header for why this is the check that
  // matters. Sensitive positions are marked, not removed: the page renders them
  // "<withheld - click to reveal>" so a screenshot does not casually contain a
  // resident's name, but the operator can see them, because masking here
  // DESTROYS the only signal that catches column drift — and column drift is
  // itself a privacy bug (Wakefield's swapped columns wrote homeowner names
  // into the address field on 167 of 519 rows).
  const sensitive = new Set((spec.sensitive_indices || []).map(String));
  const fields = spec.fields || {};
  let sample;
  if (isArrayRow) {
    sample = rawRow.slice(0, SAMPLE_CELLS).map((c, i) => ({
      i, field: fields[String(i)] || null,
      value: stripTags(c), sensitive: sensitive.has(String(i)),
    }));
  } else {
    sample = Object.keys(rawRow || {}).slice(0, SAMPLE_CELLS).map((k, i) => ({
      i, key: k, field: null, value: stripTags(rawRow[k]), sensitive: null,
      // sensitivity for object rows is decided on the page from
      // map.sensitive_key_pattern applied to `key` — the pattern lives in the
      // map so town/vendor knowledge stays out of this file.
    }));
  }

  return {
    verdict, detail,
    http_status: r.status,
    rows_returned: arr.length,
    cells,
    cells_prev: Number.isFinite(prevCells) ? prevCells : null,
    requested_ncols: spec.requested_ncols == null ? null : Number(spec.requested_ncols),
    max_index_used: maxIdx,
    order_col: spec.order_col == null ? null : Number(spec.order_col),
    row_shape: isArrayRow ? "array" : "object",
    bytes: buf.byteLength,
    url_host: hostOf(url),
    sample,
  };
}

// ── plumbing ────────────────────────────────────────────────────────────────

// The ONLY place this file makes an outbound request. The URL always comes from
// probe-map.json and never from the HTTP request. https is asserted anyway:
// a map that somehow carried an http:// or file: URL must not be executed.
async function doFetch(url, init) {
  let u;
  try { u = new URL(url); } catch { throw new Error("probe-map holds a malformed URL"); }
  if (u.protocol !== "https:") throw new Error("probe-map holds a non-https URL");
  return fetch(u.toString(), Object.assign({
    redirect: "follow",
    // 15s, no retries, no backoff loop. A failed probe is an answer, not
    // something to try harder at.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }, init));
}

async function readCapped(r) {
  const buf = await r.arrayBuffer();
  return buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
}

function collectCookies(resp) {
  let list = [];
  try {
    list = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
  } catch { list = []; }
  if (!list.length) {
    const one = resp.headers.get("set-cookie");
    if (one) list = [one];
  }
  return list.map((c) => String(c).split(";")[0].trim()).filter(Boolean).join("; ");
}

// scraper._pe_strip's shape: PermitEyes cells arrive with markup in them.
// Tags are stripped here so the raw view shows the VALUE; the page renders
// every one of these with textContent, never innerHTML.
function stripTags(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 300);
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

function metaToResult(m) {
  return { verdict: m.verdict || null,
           http_status: m.http ? Number(m.http) : null,
           rows_returned: m.rows ? Number(m.rows) : null,
           cells: m.cells ? Number(m.cells) : null,
           ms: m.ms ? Number(m.ms) : null,
           at: m.at ? new Date(Number(m.at)).toISOString() : null };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}
