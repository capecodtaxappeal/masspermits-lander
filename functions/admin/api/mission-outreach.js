// MassPermits — Mission Control outreach editor (POST /admin/api/mission-outreach).
//
// OFF unless MISSION_OUTREACH_EDIT === "1": then it answers 404 before
// anything else, with no R2 op. When on, it changes ONE town's outreach state
// in ONE R2 object, admin/outreach.json, which the owner seeds by hand.
//
// ORDER, AND WHY
//   1. the flag (404 when off: the route does not exist)
//   2. verifyOwner (functions/api/_owner_gate.js), the same gate as the page
//   3. X-MassPermits-Mission: 1 and Sec-Fetch-Site: same-origin, both
//      REQUIRED here (a write must come from the page itself)
//   4. Content-Type application/json, body at most 512 bytes, exactly
//      {town, outreach}: town one of the 351 map keys, outreach one of the
//      four states or null (clear)
//   5. read the object with its etag; absent or unparseable is 409 and
//      nothing is written (the owner seeds it; this route never creates it)
//   6. one conditional put, onlyIf etagMatches the etag read in step 5, so a
//      concurrent change is a 409, never a lost update
// Responses carry only {ok:true} or {error:<fixed code>}.

import { verifyOwner, denied, secHeaders } from "../../api/_owner_gate.js";
import { readView } from "../../api/_mission_r2.js";
import { TOWN_KEYS } from "../../api/_mission_data.js";

const KEY = "admin/outreach.json";
const MAX_BODY = 512;              // {town, outreach} is under 80 bytes
const MAX_OBJECT = 64 * 1024;      // the reader treats anything larger as unreadable
const HISTORY_MAX = 200;           // newest entries kept
const STATES = new Set(["planned", "sent", "answered", "declined"]);
// The 351 map keys (the same constant the reader joins on; a test proves it
// equals the keys of admin/mission-towns.json).
const TOWNS = new Set(TOWN_KEYS);

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: secHeaders() });
}

// The only write path: put, for exactly one key. Any other key throws.
function writerFor(bucket) {
  return Object.freeze({
    put(key, value, options) {
      if (key !== KEY) throw new Error("writer_key");
      return bucket.put(key, value, options);
    },
  });
}

// Reads at most MAX_BODY + 1 bytes, so an oversized body is refused without
// being buffered whole.
async function readBody(request) {
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_BODY) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      try { await reader.cancel(); } catch (_) { /* ignore */ }
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

function parseEdit(text) {
  let o;
  try { o = JSON.parse(text); } catch (_) { return null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const keys = Object.keys(o).sort();
  if (keys.length !== 2 || keys[0] !== "outreach" || keys[1] !== "town") return null;
  if (typeof o.town !== "string" || !TOWNS.has(o.town)) return null;
  if (o.outreach !== null && !STATES.has(o.outreach)) return null;
  return { town: o.town, outreach: o.outreach };
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
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

  if (request.headers.get("x-masspermits-mission") !== "1") return json({ error: "forbidden" }, 403);
  if (request.headers.get("sec-fetch-site") !== "same-origin") return json({ error: "forbidden" }, 403);
  const ctype = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (ctype !== "application/json") return json({ error: "bad_request" }, 400);

  let edit;
  try {
    const text = await readBody(request);
    edit = text === null ? null : parseEdit(text);
  } catch (_) {
    edit = null;
  }
  if (!edit) return json({ error: "bad_request" }, 400);

  try {
    const ro = readView(env.BUNDLES);
    const obj = await ro.get(KEY);
    if (!obj) return json({ error: "absent" }, 409);
    if (typeof obj.size === "number" && obj.size > MAX_OBJECT) return json({ error: "unreadable" }, 409);
    let doc;
    try { doc = JSON.parse(await obj.text()); } catch (_) { doc = null; }
    if (!isObj(doc) || !isObj(doc.towns)) return json({ error: "unreadable" }, 409);
    const etag = typeof obj.etag === "string" && obj.etag ? obj.etag : "";
    if (!etag) return json({ error: "unreadable" }, 409);

    const at = new Date(now).toISOString();
    const prev = isObj(doc.towns[edit.town]) ? doc.towns[edit.town] : {};
    const from = STATES.has(prev.outreach) ? prev.outreach : null;
    const next = { ...prev };
    if (edit.outreach === null) {
      delete next.outreach;
      delete next.since;
    } else {
      next.outreach = edit.outreach;
      next.since = at.slice(0, 10);
    }
    if (Object.keys(next).length) doc.towns[edit.town] = next;
    else delete doc.towns[edit.town];
    const history = Array.isArray(doc.history) ? doc.history : [];
    history.push({ at, town: edit.town, from, to: edit.outreach });
    doc.history = history.slice(-HISTORY_MAX);
    doc.updated_at = at;

    const out = JSON.stringify(doc);
    if (new TextEncoder().encode(out).byteLength > MAX_OBJECT) return json({ error: "too_large" }, 409);

    const { put } = writerFor(env.BUNDLES);
    const res = await put(KEY, out, {
      onlyIf: { etagMatches: etag },
      httpMetadata: { contentType: "application/json" },
    });
    if (!res) return json({ error: "conflict" }, 409);
    return json({ ok: true }, 200);
  } catch (_) {
    return json({ error: "unavailable" }, 503);
  }
}
