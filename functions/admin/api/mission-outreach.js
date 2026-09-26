// MassPermits — Mission Control outreach editor (POST /admin/api/mission-outreach).
//
// OFF unless MISSION_OUTREACH_EDIT is exactly "1". It changes one town's
// outreach state in admin/outreach.json and nothing else.
//
// ORDER, AND WHY
//   1. the flag: off -> 404 before any read, so the route does not exist.
//   2. verifyOwner (functions/api/_owner_gate.js), the same gate as the page.
//   3. X-MassPermits-Mission: 1 and Sec-Fetch-Site: same-origin, both required:
//      a write must come from this site's own page.
//   4. application/json, at most 512 bytes, exactly {town, outreach}.
//   5. read admin/outreach.json through readView; absent or unparseable -> 409
//      (the owner seeds it; this route never creates or repairs it).
//   6. ONE conditional put of that key through writerFor(), which refuses any
//      other key; a changed object in between -> 409, nothing lost.

import { verifyOwner, denied, secHeaders } from "../../api/_owner_gate.js";
import { readView } from "../../api/_mission_r2.js";
import { TOWN_KEYS } from "../../api/_mission_data.js";

const KEY = "admin/outreach.json";
const BODY_MAX = 512;              // {town, outreach} never needs more
const OBJECT_MAX = 64 * 1024;      // the page treats a bigger object as unreadable
const HISTORY_MAX = 200;           // newest entries kept
const STATES = ["planned", "sent", "answered", "declined"];
const TOWNS = new Set(TOWN_KEYS);  // the 351 keys of admin/mission-towns.json

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: secHeaders() });
}

// A writer for exactly one key: the only write this build can make.
function writerFor(bucket) {
  return Object.freeze({
    put(key, body, opts) {
      if (key !== KEY) throw new Error("writer_refused");
      return bucket.put(KEY, body, opts);
    },
  });
}

function parseBody(text) {
  let b;
  try { b = JSON.parse(text); } catch (_) { return null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const keys = Object.keys(b).sort();
  if (keys.length !== 2 || keys[0] !== "outreach" || keys[1] !== "town") return null;
  if (typeof b.town !== "string" || !TOWNS.has(b.town)) return null;
  if (b.outreach !== null && !STATES.includes(b.outreach)) return null;
  return b;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env || env.MISSION_OUTREACH_EDIT !== "1") return json({ error: "not_found" }, 404);
  const now = typeof context.now === "number" ? context.now : Date.now();

  let auth;
  try {
    auth = await verifyOwner(request, env);
  } catch (_) {
    auth = { ok: false, status: 403, reason: "verify-error" };
  }
  if (!auth || auth.ok !== true) return denied(auth, request);

  if (request.headers.get("x-masspermits-mission") !== "1") return json({ error: "forbidden" }, 403);
  if (request.headers.get("sec-fetch-site") !== "same-origin") return json({ error: "forbidden" }, 403);
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return json({ error: "bad_request" }, 400);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX) return json({ error: "bad_request" }, 400);

  let body;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > BODY_MAX) return json({ error: "bad_request" }, 400);
    body = parseBody(new TextDecoder().decode(bytes));
  } catch (_) {
    body = null;
  }
  if (!body) return json({ error: "bad_request" }, 400);

  try {
    const obj = await readView(env.BUNDLES).get(KEY);
    if (!obj) return json({ error: "not_seeded" }, 409);
    // The put is conditional on this etag. Without one, onlyIf would be empty
    // and the write unconditional, so a concurrent change could be lost.
    const etag = typeof obj.etag === "string" && obj.etag ? obj.etag
      : typeof obj.httpEtag === "string" ? obj.httpEtag.replace(/"/g, "") : "";
    if (!etag) return json({ error: "changed" }, 409);
    if (typeof obj.size === "number" && obj.size > OBJECT_MAX) return json({ error: "unreadable" }, 409);
    let doc;
    try { doc = JSON.parse(await obj.text()); } catch (_) { doc = null; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc) ||
      !doc.towns || typeof doc.towns !== "object" || Array.isArray(doc.towns)) {
      return json({ error: "unreadable" }, 409);
    }
    const at = new Date(now).toISOString();
    const prev = doc.towns[body.town] && typeof doc.towns[body.town] === "object" ? doc.towns[body.town] : {};
    const from = STATES.includes(prev.outreach) ? prev.outreach : null;
    const next = { ...prev };
    if (body.outreach === null) {
      delete next.outreach;
      delete next.since;
    } else {
      next.outreach = body.outreach;
      next.since = at.slice(0, 10);
    }
    doc.towns[body.town] = next;
    doc.updated_at = at;
    const history = Array.isArray(doc.history) ? doc.history : [];
    history.push({ at, town: body.town, from, to: body.outreach });
    doc.history = history.slice(-HISTORY_MAX);
    const text = JSON.stringify(doc);
    if (new TextEncoder().encode(text).length > OBJECT_MAX) return json({ error: "too_large" }, 409);

    const { put } = writerFor(env.BUNDLES);
    const done = await put(KEY, text, {
      onlyIf: { etagMatches: etag },
      httpMetadata: { contentType: "application/json" },
    });
    if (!done) return json({ error: "changed" }, 409);
    return json({ ok: true }, 200);
  } catch (_) {
    return json({ error: "unavailable" }, 503);
  }
}
