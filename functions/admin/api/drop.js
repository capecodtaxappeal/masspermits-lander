// MassPermits: owner drop box API (GET and POST /admin/api/drop).
//
//   GET   the per-source view for admin/drop.html: label, cadence, accepted
//         types, last received, days since, state, the last 10 receipts
//         (date, size, type, route). Never a file name, hash or content.
//   POST  one file as the raw request body. The source slug rides in the
//         X-Drop-Slug header and the original file name, URI-encoded, in
//         X-Drop-Name, so neither appears in a URL or a request log.
//
// ORDER, AND WHY
//   1. verifyOwner (functions/api/_owner_gate.js): apex host, configuration,
//      the Access header, a verified person's token, the allowlist. Cloudflare
//      Access also covers /admin/* at the edge; this is the in-code half, so
//      a drifted Access application fails closed instead of open.
//   2. X-MassPermits-Drop: 1, and Sec-Fetch-Site same-origin when present.
//      A custom header forces a CORS preflight, and this route answers no
//      preflight and sends no Access-Control-Allow-* header, so another site
//      cannot make the owner's browser post a file here.
//   3. the slug must be in MANUAL_SOURCES; the size is checked from
//      Content-Length before the body is read, and again after.
//   4. sniff() decides the type by content; the source's accept list must
//      include it; ingest() writes under manual-raw/ and nowhere else.
// No console line anywhere in this route: Pages logs are not private.

import { verifyOwner, denied, secHeaders } from "../../api/_owner_gate.js";
import { parseSources, sniff, ingest, readIndex, ownerView, MAX_UPLOAD_BYTES } from "../../api/_manual_store.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: secHeaders() });
}

function sameOrigin(request) {
  if (request.headers.get("x-masspermits-drop") !== "1") return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin";
}

async function view(env) {
  const sources = parseSources(env.MANUAL_SOURCES);
  const idx = await readIndex(env.BUNDLES);
  return {
    now: new Date().toISOString(),
    index: idx.state,
    sources: ownerView(sources, idx.state === "unreadable" ? null : idx.index),
  };
}

async function upload(request, env) {
  const sources = parseSources(env.MANUAL_SOURCES);
  const slug = String(request.headers.get("x-drop-slug") || "");
  if (!Object.prototype.hasOwnProperty.call(sources, slug)) return json({ ok: false, error: "unknown-source" }, 400);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return json({ ok: false, error: "too-large" }, 413);

  let name = "";
  try { name = decodeURIComponent(String(request.headers.get("x-drop-name") || "")); } catch (_) { name = ""; }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length === 0) return json({ ok: false, error: "empty" }, 400);
  if (body.length > MAX_UPLOAD_BYTES) return json({ ok: false, error: "too-large" }, 413);

  const s = await sniff(body);
  if (!s.ok) return json({ ok: false, error: s.reason }, s.reason === "too-large" ? 413 : 415);
  if (!sources[slug].accept.includes(s.ext)) return json({ ok: false, error: "type-not-accepted", ext: s.ext }, 415);

  const r = await ingest(env.BUNDLES, { slug, bytes: body, ext: s.ext, name, via: "drop" });
  if (r.status === "stored") return json({ ok: true, status: "stored", message: "Received", ext: s.ext, bytes: r.bytes });
  if (r.status === "duplicate") return json({ ok: true, status: "duplicate", message: "already received", ext: s.ext, bytes: r.bytes });
  return json({ ok: false, error: r.reason }, 503);
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  if (method !== "GET" && method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }),
      { status: 405, headers: { ...secHeaders(), Allow: "GET, POST" } });
  }
  const auth = await verifyOwner(request, env);
  if (!auth.ok) return denied(auth, request);
  if (!sameOrigin(request)) return json({ error: "bad-request" }, 400);
  if (!env || !env.BUNDLES) return json({ error: "unavailable" }, 503);
  try {
    return method === "GET" ? json(await view(env)) : await upload(request, env);
  } catch (_) {
    return json({ error: "unavailable" }, 503);
  }
}
