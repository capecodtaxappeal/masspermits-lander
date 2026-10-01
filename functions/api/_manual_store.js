// MassPermits: hand-delivered engine inputs, the storage side (shared module).
//
// Imported by functions/admin/api/drop.js (the owner drop box), by
// functions/api/get-drop.js (the engine read route, KEY_RX only) and by the
// separate email Worker in workers/manual-intake/. It exports no onRequest
// handler, so Pages never routes it.
//
// WHAT IT MAY TOUCH: only keys under "manual-raw/". Every R2 call in this file
// goes through scoped(), which throws on any other key before the bucket is
// reached. There is no list() call anywhere. subscribers.json, the engine,
// the bundles and every send log are unreachable from here by construction.
//
// WHAT IT STORES
//   manual-raw/<slug>/<yyyymmddTHHMMSSZ>-<sha256 first 12 hex>.<ext>
//       the raw bytes, written once with If-None-Match: * and never replaced.
//   manual-raw/index.json
//       { "schema": 1, "entries": [ { key, slug, sha256, bytes, ext,
//         received_at, via, name } ] }  append-only, updated only by a
//       conditional put on the etag that was read, retried on conflict.
//
// WHAT IT NEVER DOES: log. Callers log counts only. This repo is public and
// so are the Pages and Actions logs; a file name can name a place.

export const PREFIX = "manual-raw/";
export const INDEX_KEY = "manual-raw/index.json";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const EXTS = ["csv", "xlsx", "pdf"];
export const SLUG_RX = /^[a-z0-9][a-z0-9-]{1,39}$/;

// The one pattern the engine read route accepts. Anchored, ASCII only, no
// dot other than the one before the extension, so no traversal spelling can
// match it however it was encoded on the way in.
export const KEY_RX = new RegExp(
  "^manual-raw/(?:index\\.json|[a-z0-9][a-z0-9-]{1,39}/" +
  "20\\d\\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3])[0-5]\\d[0-5]\\dZ" +
  "-[0-9a-f]{12}\\.(?:csv|xlsx|pdf))$");

const CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};
export function contentTypeOf(key) {
  const ext = String(key).split(".").pop();
  return CONTENT_TYPES[ext] || "application/json";
}

// ------------------------------------------------------------ configuration

// MANUAL_SOURCES: {"town-a": {"label": "...", "cadence": "weekly", "accept": ["csv"]}}
// Anything malformed is dropped, never guessed at. An empty result means the
// drop box has nothing to offer, which is the safe failure.
export function parseSources(raw) {
  let obj;
  try { obj = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_) { return {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [slug, v] of Object.entries(obj)) {
    if (!SLUG_RX.test(slug) || !v || typeof v !== "object") continue;
    const cadence = v.cadence === "monthly" ? "monthly" : v.cadence === "weekly" ? "weekly" : null;
    if (!cadence) continue;
    const accept = Array.isArray(v.accept)
      ? [...new Set(v.accept.map((e) => String(e).toLowerCase().replace(/^\./, "")))].filter((e) => EXTS.includes(e))
      : [];
    if (!accept.length) continue;
    const label = String(v.label == null ? slug : v.label).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60) || slug;
    out[slug] = { label, cadence, accept };
  }
  return out;
}

// ------------------------------------------------------------ content checks

const enc = new TextEncoder();
const ascii = (b, from, len) => {
  let s = "";
  for (let i = from; i < from + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};
function indexOfBytes(hay, needle, from = 0) {
  const n = enc.encode(needle);
  outer: for (let i = from; i <= hay.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

// PDF names that make a file something other than a plain document: an
// encrypted body, an embedded file (a nested archive by another name), or
// active content. The engine only ever wants text and tables.
const PDF_REFUSE = ["/Encrypt", "/EmbeddedFile", "/JavaScript", "/Launch", "/RichMedia", "/XFA"];

function sniffPdf(b) {
  // %PDF- within the first 1024 bytes is what readers accept; require it at 0.
  if (ascii(b, 0, 5) !== "%PDF-") return null;
  if (indexOfBytes(b, "%%EOF", Math.max(0, b.length - 2048)) < 0) return { ok: false, reason: "pdf-truncated" };
  for (const name of PDF_REFUSE) {
    if (indexOfBytes(b, name) >= 0) {
      return { ok: false, reason: name === "/Encrypt" ? "encrypted" : "active-content" };
    }
  }
  return { ok: true, ext: "pdf" };
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// The central directory of a zip, or a reason it is not one we accept.
function zipEntries(b) {
  const min = Math.max(0, b.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return { reason: "zip-broken" };
  const count = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOff = u32(b, eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) return { reason: "zip64" };
  if (u16(b, eocd + 4) !== 0 || u16(b, eocd + 6) !== 0) return { reason: "zip-multidisk" };
  if (count === 0 || count > 5000 || cdOff + cdSize > eocd) return { reason: "zip-broken" };
  const entries = [];
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return { reason: "zip-broken" };
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    const csize = u32(b, p + 20);
    const usize = u32(b, p + 24);
    const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = ascii(b, p + 46, nlen);
    entries.push({ name, flags, method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return { entries };
}

const NESTED = /\.(zip|xlsx|xlsm|xlsb|xls|xltm|docx|docm|pptx|pptm|jar|7z|rar|gz|tgz|tar|bz2|xz|cab|iso|exe|dll|msi|ole|ps1|bat|cmd|vbs|js|lnk)$/i;

async function inflateRaw(bytes, cap) {
  const ds = new DecompressionStream("deflate-raw");
  const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { try { await reader.cancel(); } catch (_) { /* ignore */ } return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function readEntry(b, e, cap) {
  if (e.local + 30 > b.length || u32(b, e.local) !== 0x04034b50) return null;
  const start = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
  const data = b.subarray(start, start + e.csize);
  if (data.length !== e.csize) return null;
  if (e.method === 0) return e.csize <= cap ? data : null;
  if (e.method === 8) return inflateRaw(data, cap);
  return null;
}

async function sniffZip(b) {
  if (!(b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)) return null;
  const z = zipEntries(b);
  if (!z.entries) return { ok: false, reason: z.reason };
  let types = null, hasXl = false, total = 0;
  for (const e of z.entries) {
    total += e.usize;
    if (e.flags & 0x1) return { ok: false, reason: "encrypted" };
    if (e.method !== 0 && e.method !== 8) return { ok: false, reason: "zip-method" };
    const n = e.name;
    if (!n || n.startsWith("/") || n.includes("\\") || n.split("/").includes("..") || /[^\x20-\x7e]/.test(n)) {
      return { ok: false, reason: "zip-path" };
    }
    const lower = n.toLowerCase();
    if (/vbaproject|vbadata|\/macrosheets\/|\/activex\/|\/embeddings\/|\/dialogsheets\//.test(lower)) {
      return { ok: false, reason: lower.includes("embeddings") ? "nested-archive" : "macro" };
    }
    // printerSettings*.bin is ordinary; vbaProject.bin was refused above.
    if (NESTED.test(lower)) return { ok: false, reason: "nested-archive" };
    if (n === "[Content_Types].xml") types = e;
    if (n.startsWith("xl/")) hasXl = true;
  }
  // 100 to 1 is far past any real spreadsheet and well short of a zip bomb.
  if (total > 200 * 1024 * 1024 || total > 100 * Math.max(1, b.length)) return { ok: false, reason: "zip-bomb" };
  if (!types || !hasXl) return { ok: false, reason: "not-accepted" };
  const xml = await readEntry(b, types, 512 * 1024);
  if (!xml) return { ok: false, reason: "zip-broken" };
  const text = new TextDecoder().decode(xml);
  if (/macroEnabled|vbaProject|ms-office\.vba|ms-excel\.(?:intl)?macrosheet|activeX/i.test(text)) return { ok: false, reason: "macro" };
  if (!/spreadsheetml\.sheet\.main\+xml/.test(text)) return { ok: false, reason: "not-accepted" };
  return { ok: true, ext: "xlsx" };
}

function sniffCsv(b) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(b);
  } catch (_) {
    return { ok: false, reason: "unrecognized" };
  }
  // Text, but not text with control bytes (binaries decode surprisingly often).
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return { ok: false, reason: "unrecognized" };
  const first = text.split(/\r?\n/, 1)[0].trim();
  // An HTML error page or a feed saved under a .csv name.
  if (!first || first.startsWith("<") || first.startsWith("{") || first.startsWith("[")) return { ok: false, reason: "no-header" };
  if (first.length > 8192) return { ok: false, reason: "no-header" };
  const delim = [",", ";", "\t", "|"].find((d) => first.includes(d));
  if (!delim) return { ok: false, reason: "no-header" };
  const cells = first.split(delim).map((c) => c.replace(/^"|"$/g, "").trim()).filter(Boolean);
  if (cells.length < 2) return { ok: false, reason: "no-header" };
  return { ok: true, ext: "csv" };
}

// sniff(bytes) -> { ok: true, ext } | { ok: false, reason }
// Decides by content only. A file name is never consulted.
export async function sniff(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || new ArrayBuffer(0));
  if (b.length === 0) return { ok: false, reason: "empty" };
  if (b.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "too-large" };
  // OLE2 compound file: a legacy .xls, or an Office file with a password
  // (Office wraps an encrypted xlsx in one). Either way, refused.
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return { ok: false, reason: "encrypted" };
  const pdf = sniffPdf(b);
  if (pdf) return pdf;
  try {
    const zip = await sniffZip(b);
    if (zip) return zip;
  } catch (_) {
    return { ok: false, reason: "zip-broken" };
  }
  // Known binary magics that could otherwise be mistaken for nothing at all.
  if ((b[0] === 0x4d && b[1] === 0x5a) || (b[0] === 0x7f && ascii(b, 1, 3) === "ELF") ||
      (b[0] === 0x1f && b[1] === 0x8b) || ascii(b, 0, 4) === "Rar!" || (b[0] === 0x37 && b[1] === 0x7a)) {
    return { ok: false, reason: "unrecognized" };
  }
  return sniffCsv(b);
}

// ------------------------------------------------------------ names, keys

// A display name kept only in the private index: no path, no control bytes,
// a conservative character set, at most 80 characters.
export function sanitizeName(name) {
  let s = String(name == null ? "" : name);
  s = s.split(/[\\/]/).pop();
  s = s.normalize("NFKC").replace(/[^A-Za-z0-9 ._()-]+/g, "_").replace(/_+/g, "_").replace(/\.{2,}/g, ".");
  s = s.replace(/^[\s._-]+/, "").trim();
  return s.slice(0, 80) || "file";
}

export function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function objectKey(slug, date, sha256, ext) {
  if (!SLUG_RX.test(slug) || !EXTS.includes(ext) || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error("bad key parts");
  const key = `${PREFIX}${slug}/${stamp(date)}-${sha256.slice(0, 12)}.${ext}`;
  if (!KEY_RX.test(key)) throw new Error("bad key");
  return key;
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------ the R2 scope

// Every bucket call in this module passes through here. A key outside
// manual-raw/ throws before the binding is touched.
function scoped(bucket) {
  const check = (k) => {
    if (typeof k !== "string" || !k.startsWith(PREFIX) || k.includes("..") || k.includes("\\") || !(k === INDEX_KEY || KEY_RX.test(k))) {
      throw new Error("key outside manual-raw");
    }
    return k;
  };
  return {
    get: (k) => bucket.get(check(k)),
    head: (k) => bucket.head(check(k)),
    put: (k, v, o) => bucket.put(check(k), v, o),
    delete: (k) => bucket.delete(check(k)),
  };
}

// The engine read route's only door to the bucket: one get, scoped.
export async function getManual(bucket, key) {
  return scoped(bucket).get(key);
}

// { state: "absent" | "ok" | "unreadable", index, etag }
export async function readIndex(bucket) {
  const r2 = scoped(bucket);
  const obj = await r2.get(INDEX_KEY);
  if (!obj) return { state: "absent", index: { schema: 1, entries: [] }, etag: null };
  try {
    const index = JSON.parse(await obj.text());
    if (!index || index.schema !== 1 || !Array.isArray(index.entries)) throw new Error("shape");
    return { state: "ok", index, etag: obj.etag };
  } catch (_) {
    return { state: "unreadable", index: null, etag: obj.etag };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ingest(bucket, { slug, bytes, ext, name, via, now }) ->
//   { status: "stored" | "duplicate", key, sha256, bytes }
//   { status: "error", reason }
// The caller has already run sniff() and checked the slug and its accept list.
export async function ingest(bucket, { slug, bytes, ext, name, via, now = new Date(), retries = 8 }) {
  const r2 = scoped(bucket);
  if (!SLUG_RX.test(slug) || !EXTS.includes(ext) || (via !== "drop" && via !== "email")) {
    return { status: "error", reason: "bad-request" };
  }
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sha = await sha256Hex(body);
  const same = (e) => e && e.slug === slug && e.sha256 === sha;

  const first = await readIndex(bucket);
  if (first.state === "unreadable") return { status: "error", reason: "index-unreadable" };
  const seen = first.index.entries.find(same);
  if (seen) return { status: "duplicate", key: seen.key, sha256: sha, bytes: body.length };

  const key = objectKey(slug, now, sha, ext);
  let created = false;
  const put = await r2.put(key, body, {
    onlyIf: new Headers({ "If-None-Match": "*" }),
    httpMetadata: { contentType: CONTENT_TYPES[ext] },
    customMetadata: { sha256: sha, via },
  });
  if (put) {
    created = true;
  } else {
    // The key exists: same slug, same second, same hash prefix. Only a
    // concurrent copy of the same file gets here; confirm it by full hash.
    const h = await r2.head(key);
    if (!h || !h.customMetadata || h.customMetadata.sha256 !== sha) return { status: "error", reason: "key-conflict" };
  }

  const entry = {
    key, slug, sha256: sha, bytes: body.length, ext,
    received_at: now.toISOString(), via, name: sanitizeName(name),
  };
  let cur = first;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(400, 20 * 2 ** attempt) + Math.floor(Math.random() * 20));
      cur = await readIndex(bucket);
      if (cur.state === "unreadable") break;
    }
    const other = cur.index.entries.find(same);
    if (other) {
      if (created && other.key !== key) await r2.delete(key);
      return { status: "duplicate", key: other.key, sha256: sha, bytes: body.length };
    }
    const next = { schema: 1, entries: [...cur.index.entries, entry] };
    const ok = await r2.put(INDEX_KEY, JSON.stringify(next), {
      onlyIf: cur.etag ? { etagMatches: cur.etag } : new Headers({ "If-None-Match": "*" }),
      httpMetadata: { contentType: "application/json" },
    });
    if (ok) return { status: "stored", key, sha256: sha, bytes: body.length };
  }
  // Never leave an object the index does not name.
  if (created) { try { await r2.delete(key); } catch (_) { /* ignore */ } }
  return { status: "error", reason: "index-busy" };
}

// ------------------------------------------------------------ the owner view

const DAY_MS = 86400_000;
export const DUE = { weekly: { soon: 7, over: 9 }, monthly: { soon: 31, over: 40 } };

export function stateFor(cadence, daysSince) {
  const d = DUE[cadence];
  if (!d || daysSince == null) return "overdue";
  if (daysSince > d.over) return "overdue";
  if (daysSince > d.soon) return "due soon";
  return "ok";
}

// Per slug: label, cadence, accept, last received, days since, state, and
// the last 10 receipts (date, size, type, route). Never a name, never a hash.
export function ownerView(sources, index, now = new Date()) {
  const entries = (index && Array.isArray(index.entries)) ? index.entries : [];
  return Object.entries(sources).map(([slug, s]) => {
    const mine = entries.filter((e) => e && e.slug === slug && typeof e.received_at === "string")
      .sort((a, b) => (a.received_at < b.received_at ? 1 : a.received_at > b.received_at ? -1 : 0));
    const last = mine.length ? mine[0].received_at : null;
    const t = last ? Date.parse(last) : NaN;
    const days = Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY_MS)) : null;
    return {
      slug, label: s.label, cadence: s.cadence, accept: s.accept,
      last_received: last, days_since: days, state: stateFor(s.cadence, days),
      receipts: mine.slice(0, 10).map((e) => ({
        received_at: e.received_at, bytes: Number(e.bytes) || 0, ext: String(e.ext || ""), via: e.via === "email" ? "email" : "drop",
      })),
    };
  });
}
