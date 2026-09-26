// MassPermits — read-only R2 view and projection caches for Mission Control.
//
// readView(bucket) is the ONLY way the Mission Control routes touch R2. It
// hands out exactly three methods (get, head, list) and a counter; nothing
// that writes exists on it, so a write cannot be expressed through it, only
// through the raw binding, which the routes never hold after building the view.
//
// The two big objects the map needs (source-health.json, ~220 KB, and
// probe-map.json, ~260 KB) are parsed only when their etag changes. The cache
// keeps the etag here, beside a small PROJECTION of the object, and the etag
// never leaves this file: payloads carry only an object's uploaded time and
// size. Raw objects are never cached.

export function readView(bucket) {
  let ops = 0;
  const view = {
    // async, so a missing binding rejects instead of throwing mid-expression
    async get(key, options) { ops++; return bucket.get(key, options); },
    async head(key) { ops++; return bucket.head(key); },
    async list(options) { ops++; return bucket.list(options); },
  };
  Object.defineProperty(view, "ops", { get: () => ops, enumerable: false });
  return Object.freeze(view);
}

// key -> { etag, uploaded, size, proj }. Module level: one per isolate.
let projections = new Map();

export function resetMissionCaches() {
  projections = new Map();
}

function isoOrNull(d) {
  if (!d) return null;
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

// head first; get and project only when the etag differs from the cached one.
// Returns { state: "present" | "absent" | "unreadable", proj, uploaded, size }.
// A head or get that throws propagates, so the caller decides what "could not
// read" means for its view. An object that does not parse is "unreadable".
export async function cachedProjection(ro, key, project) {
  const h = await ro.head(key);
  if (!h) {
    projections.set(key, null);
    return { state: "absent", proj: null, uploaded: null, size: null };
  }
  const etag = String(h.etag || h.httpEtag || "");
  const hit = projections.get(key);
  if (hit && etag && hit.etag === etag) {
    return { state: "present", proj: hit.proj, uploaded: hit.uploaded, size: hit.size };
  }
  const o = await ro.get(key);
  if (!o) {
    projections.set(key, null);
    return { state: "absent", proj: null, uploaded: null, size: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(await o.text());
  } catch (_) {
    projections.set(key, null);
    return { state: "unreadable", proj: null, uploaded: isoOrNull(o.uploaded), size: sizeOf(o) };
  }
  const proj = project(parsed);
  const entry = {
    etag: String(o.etag || o.httpEtag || etag),
    uploaded: isoOrNull(o.uploaded || h.uploaded),
    size: sizeOf(o),
    proj,
  };
  if (entry.etag) projections.set(key, entry);
  return { state: "present", proj, uploaded: entry.uploaded, size: entry.size };
}

function sizeOf(o) {
  return o && typeof o.size === "number" ? o.size : null;
}
