// MassPermits — Mission Control outreach editor (POST /admin/api/mission-outreach).
//
// OFF unless MISSION_OUTREACH_EDIT is exactly "1": then every request is a 404
// with no R2 op. When on, it changes one town's outreach state in ONE R2 key,
// admin/outreach.json, which the owner seeds; it never creates it.
//
// ORDER, AND WHY
//   1. the flag (off -> 404, nothing read)
//   2. verifyOwner (functions/api/_owner_gate.js), as the data route
//   3. X-MassPermits-Mission: 1, and Sec-Fetch-Site present AND same-origin:
//      a write must come from the page itself, never from another site
//   4. Content-Type application/json, body at most 512 bytes, exactly
//      {town, outreach}: town one of the 351 map keys, outreach one of the
//      four states or null (clears it)
//   5. read the object through the read-only view, with its etag; absent or
//      unparseable -> 409 and nothing is written
//   6. ONE conditional put (onlyIf etagMatches), through writerFor(), which
//      can write that one key and no other. A lost race -> 409.
// Responses are {ok:true} or {error:<fixed code>}; no exception text, no body
// echo, nothing on the console.

import { verifyOwner, denied, secHeaders } from "../../api/_owner_gate.js";
import { readView } from "../../api/_mission_r2.js";
import { TOWN_KEYS } from "../../api/_mission_data.js";

const KEY = "admin/outreach.json";
const BODY_MAX = 512;               // {town, outreach} is never longer
const OBJECT_MAX = 64 * 1024;       // the data route treats a larger object as unreadable
const HISTORY_MAX = 200;            // newest entries kept
const STATES = new Set(["planned", "sent", "answered", "declined"]);
const TOWNS = new Set(TOWN_KEYS);   // the 351 keys of admin/mission-towns.json

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: secHeaders() });
}

// The one writer: put for admin/outreach.json only; any other key throws.
function writerFor(bucket) {
  const only = "admin/outreach.json";
  return Object.freeze({
    put(key, value, options) {
      if (key !== only) throw new Error("writer_key");
      return bucket.put(key, value, options);
    },
  });
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function byteLength(s) {
  return new TextEncoder().encode(s).length;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env || env.MISSION_OUTREACH_EDIT !== "1") {
    return new Response("Not found", { status: 404, headers: secHeaders("text/plain; charset=utf-8") });
  }
  const now = typeof context.now === "number" ? context.now : Date.now();

  let auth;
  try {
    auth = await verifyOwner(request, env);
  } catch (_) {
    auth = { ok: false, status: 403, reason: "verify-error" };
  }
  if (!auth || auth.ok !== true) return denied(auth, request);

  if (request.headers.get("x-masspermits-mission") !== "1") {
    return json({ error: "forbidden", reason: "missing-mission-header" }, 403);
  }
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return json({ error: "forbidden", reason: "cross-site" }, 403);
  }
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return json({ error: "bad_content_type" }, 400);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX) return json({ error: "too_large" }, 400);

  let input;
  try {
    const text = await request.text();
    if (byteLength(text) > BODY_MAX) return json({ error: "too_large" }, 400);
    input = JSON.parse(text);
  } catch (_) {
    return json({ error: "bad_body" }, 400);
  }
  if (!isObj(input)) return json({ error: "bad_body" }, 400);
  const keys = Object.keys(input).sort();
  if (keys.length !== 2 || keys[0] !== "outreach" || keys[1] !== "town") return json({ error: "bad_body" }, 400);
  const { town, outreach } = input;
  if (typeof town !== "string" || !TOWNS.has(town)) return json({ error: "bad_town" }, 400);
  if (outreach !== null && !(typeof outreach === "string" && STATES.has(outreach))) {
    return json({ error: "bad_state" }, 400);
  }

  try {
    const ro = readView(env.BUNDLES);
    const obj = await ro.get(KEY);
    if (!obj) return json({ error: "not_seeded" }, 409);
    const etag = String(obj.etag || "");
    let doc;
    try {
      if (typeof obj.size === "number" && obj.size > OBJECT_MAX) throw new Error("size");
      doc = JSON.parse(await obj.text());
    } catch (_) {
      return json({ error: "unreadable" }, 409);
    }
    if (!isObj(doc) || !etag) return json({ error: "unreadable" }, 409);
    if (!isObj(doc.towns)) doc.towns = {};

    const prev = isObj(doc.towns[town]) ? doc.towns[town] : {};
    const from = STATES.has(prev.outreach) ? prev.outreach : null;
    const next = { ...prev };
    if (outreach === null) {
      delete next.outreach;
      delete next.since;
    } else {
      next.outreach = outreach;
      next.since = new Date(now).toISOString().slice(0, 10);
    }
    if (Object.keys(next).length) doc.towns[town] = next;
    else delete doc.towns[town];
    const history = Array.isArray(doc.history) ? doc.history : [];
    history.push({ at: new Date(now).toISOString(), town, from, to: outreach });
    doc.history = history.slice(-HISTORY_MAX);
    doc.updated_at = new Date(now).toISOString();
    if (doc.version === undefined) doc.version = 1;

    const body = JSON.stringify(doc);
    if (byteLength(body) > OBJECT_MAX) return json({ error: "too_large" }, 409);
    const { put } = writerFor(env.BUNDLES);
    const done = await put(KEY, body, {
      onlyIf: { etagMatches: etag },
      httpMetadata: { contentType: "application/json" },
    });
    if (!done) return json({ error: "conflict" }, 409);
    return json({ ok: true }, 200);
  } catch (_) {
    return json({ error: "unavailable" }, 503);
  }
}
