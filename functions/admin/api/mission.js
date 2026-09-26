// MassPermits — Mission Control data route (GET /admin/api/mission).
//
// The owner's phone page reads this. Two views:
//   (no query)   tiles, needs-you lines, detail sections
//   ?view=map    the 351-town status projection
// Nothing else is accepted: any other parameter is a 400 before any read.
//
// ORDER, AND WHY
//   1. verifyOwner (functions/api/_owner_gate.js): apex host, configuration,
//      the Access header, a verified person's token, the allowlist. Nothing
//      is read before it passes.
//   2. X-MassPermits-Mission: 1, and Sec-Fetch-Site same-origin when present:
//      a cross-site page cannot make the owner's browser pull this payload.
//   3. reads, ONLY through readView(env.BUNDLES), which has no write method.
//      _presend.js gather() gets the same view, so its reads are counted too.
//   4. the pure rules in _mission_data.js, then privacyWalk as the last step.
// One try/catch after auth answers 503 {error:"unavailable"}; no exception
// text, stack or R2 body reaches a response or a console line.

import { verifyOwner, denied, secHeaders } from "../../api/_owner_gate.js";
import { gather } from "../../api/_presend.js";
import { readView, cachedProjection } from "../../api/_mission_r2.js";
import { stripeSnapshot } from "../../api/_mission_stripe.js";
import {
  buildMain, buildMap, finish, projectSourceHealth, projectRegistry, parseOutreach,
} from "../../api/_mission_data.js";

const LIST_PAGES = 3;          // per email-keyed prefix; still truncated -> "at least"
const LIST_PREFIXES = { prospects: "prospects/", agents: "agent-prospects/", newsletter: "newsletter/" };

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: secHeaders() });
}

function isoOf(d) {
  if (!d) return null;
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

// { state: "present"|"absent"|"unreadable", uploaded, size } — never an etag.
async function headOf(ro, key) {
  try {
    const h = await ro.head(key);
    if (!h) return { state: "absent", uploaded: null, size: null };
    return { state: "present", uploaded: isoOf(h.uploaded), size: typeof h.size === "number" ? h.size : null };
  } catch (_) {
    return { state: "unreadable", uploaded: null, size: null };
  }
}

// { state: "ok"|"absent"|"unreadable", value, uploaded }
async function jsonOf(ro, key) {
  try {
    const o = await ro.get(key);
    if (!o) return { state: "absent", value: null, uploaded: null };
    const value = JSON.parse(await o.text());
    return { state: "ok", value, uploaded: isoOf(o.uploaded) };
  } catch (_) {
    return { state: "unreadable", value: null, uploaded: null };
  }
}

// Keys under these prefixes are email addresses: only customMetadata leaves here.
async function metaOf(ro, prefix) {
  const items = [];
  let cursor;
  try {
    for (let page = 0; page < LIST_PAGES; page++) {
      const r = await ro.list({ prefix, cursor, include: ["customMetadata"] });
      for (const o of (r && r.objects) || []) items.push({ ...((o && o.customMetadata) || {}) });
      if (!r || !r.truncated) return { state: "ok", items, truncated: false };
      cursor = r.cursor;
      if (!cursor) break;
    }
    return { state: "ok", items, truncated: true };
  } catch (_) {
    return { state: "unreadable", items: [], truncated: false };
  }
}

// gather() (the unedited _presend.js) returns null both for an object that is
// absent and for one whose read throws or whose body does not parse. For the
// two send files that difference decides between "nothing was sent" and
// "could not read", so gather() gets this view: same reads, same counter, and
// a note of which watched key could not be read. No extra R2 op.
function watched(ro, keys) {
  const bad = new Set();
  const view = {
    async get(key, options) {
      if (!keys.includes(key)) return ro.get(key, options);
      let o;
      try {
        o = await ro.get(key, options);
      } catch (e) {
        bad.add(key);
        throw e;
      }
      if (!o) return o;
      let text;
      try {
        text = await o.text();
        JSON.parse(text);
      } catch (_) {
        bad.add(key);
      }
      return { uploaded: o.uploaded, size: o.size, text: async () => text };
    },
    head: (key) => ro.head(key),
    list: (options) => ro.list(options),
  };
  return { view, state: (key) => (bad.has(key) ? "unreadable" : "ok") };
}

function lastEtag(log) {
  if (!Array.isArray(log)) return "";
  for (const e of log) if (e && typeof e.bundle_etag === "string" && e.bundle_etag) return e.bundle_etag;
  return "";
}

async function mainView(env, ro, auth, now) {
  const sendFiles = watched(ro, ["feed-send-log.json", "last-send-attempt.json"]);
  const renv = { ...env, BUNDLES: sendFiles.view };
  const [g, statusHead, htmlHead, roster, funnel, deliveries, engagement, outreachHead, probeHead,
    sourceHealth, prospects, agents, newsletter, stripe] = await Promise.all([
    gather(renv, { hash: false }),
    headOf(ro, "refresh-status.json"),
    headOf(ro, "latest-weekly.html"),
    jsonOf(ro, "subscribers.json"),
    jsonOf(ro, "funnel-metrics.json"),
    jsonOf(ro, "delivery-log.json"),
    jsonOf(ro, "engagement.json"),
    headOf(ro, "admin/outreach.json"),
    headOf(ro, "probe-map.json"),
    cachedProjection(ro, "source-health.json", projectSourceHealth)
      .catch(() => ({ state: "unreadable", proj: null, uploaded: null })),
    metaOf(ro, LIST_PREFIXES.prospects),
    metaOf(ro, LIST_PREFIXES.agents),
    metaOf(ro, LIST_PREFIXES.newsletter),
    stripeSnapshot(env, now),
  ]);

  // Etags are compared here and leave only as a boolean.
  const weeklyTag = g && g.weekly && g.weekly.etag ? String(g.weekly.etag) : "";
  const sentTag = lastEtag(g && g.log);
  const sameBundle = !!weeklyTag && !!sentTag && weeklyTag.replace(/"/g, "") === sentTag.replace(/"/g, "");

  // Named fields only: never a head, a gather() result or a log entry spread.
  const gathered = {
    policy: g ? g.policy : null,
    status: g ? g.status : null,
    log: g ? g.log : null,
    attempt: g ? g.attempt : null,
    log_state: sendFiles.state("feed-send-log.json"),
    attempt_state: sendFiles.state("last-send-attempt.json"),
    weekly: g && g.weekly ? { uploaded: g.weekly.uploaded, size: g.weekly.size } : null,
    monthly: g && g.monthly ? { uploaded: g.monthly.uploaded, size: g.monthly.size } : null,
  };
  if (outreachHead.state === "present" && typeof outreachHead.size === "number" && outreachHead.size > 64 * 1024) {
    outreachHead.state = "unreadable";
  }
  const payload = buildMain({
    now, signedInAs: auth.email, outreachEdit: env.MISSION_OUTREACH_EDIT === "1",
    gathered, statusHead, htmlHead, roster, funnel, deliveries, engagement, outreachHead, probeHead,
    sourceHealth, lists: { prospects, agents, newsletter }, stripe, sameBundle,
  });
  return finish(payload, true);
}

async function mapView(ro, now) {
  const [sh, reg, rs, out] = await Promise.all([
    cachedProjection(ro, "source-health.json", projectSourceHealth),
    cachedProjection(ro, "probe-map.json", projectRegistry),
    ro.get("refresh-status.json"),
    ro.get("admin/outreach.json").catch(() => "unreadable"),
  ]);
  let status = null;
  if (rs) {
    try { status = JSON.parse(await rs.text()); } catch (_) { status = null; }
  }
  let outreach = { state: "absent", towns: {}, ignored: [] };
  let outreachAt = null;
  if (out === "unreadable") {
    outreach = { state: "unreadable", towns: {}, ignored: [] };
  } else if (out) {
    outreachAt = isoOf(out.uploaded);
    let text = null;
    try {
      text = typeof out.size === "number" && out.size > 64 * 1024 ? null : await out.text();
    } catch (_) {
      text = null;
    }
    outreach = parseOutreach(text, out.size);
  }
  const payload = buildMap({
    now, status, sh: sh.proj, registry: reg.proj, outreach,
    asOf: {
      refresh: rs ? isoOf(rs.uploaded) : null,
      source_health: sh.uploaded, registry: reg.uploaded, outreach: outreachAt,
    },
  });
  return finish(payload, false);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  // The clock: the route edge is the only place Date.now() is read for data.
  const now = typeof context.now === "number" ? context.now : Date.now();

  let auth;
  try {
    auth = await verifyOwner(request, env);
  } catch (_) {
    auth = { ok: false, status: 403, reason: "verify-error" };
  }
  if (!auth || auth.ok !== true) return denied(auth, request);

  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (request.headers.get("x-masspermits-mission") !== "1") {
    return json({ error: "forbidden", reason: "missing-mission-header" }, 403);
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return json({ error: "forbidden", reason: "cross-site" }, 403);
  }

  let view = "main";
  try {
    const params = [...new URL(request.url).searchParams];
    if (params.length > 1 || (params.length === 1 && (params[0][0] !== "view" || params[0][1] !== "map"))) {
      return json({ error: "bad_param" }, 400);
    }
    if (params.length === 1) view = "map";
  } catch (_) {
    return json({ error: "bad_param" }, 400);
  }

  try {
    const ro = readView(env.BUNDLES);
    const body = view === "map" ? await mapView(ro, now) : await mainView(env, ro, auth, now);
    return json(body, 200);
  } catch (_) {
    return json({ error: "unavailable" }, 503);
  }
}
