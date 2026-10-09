// MassPermits monday rehearsal: C14, the public sample privacy scan
// (Node built-ins only).
//
//   node scripts/rehearsal/c14.mjs > c14.json
//
// Downloads the public sample through getSample() in http.mjs, unzips it with
// zlib in memory, and COUNTS what must never be in it. It prints one line of
// JSON, {"c14": {...}}, counts only: never a matched string, a file name or a
// line. Nothing is written to disk but that line (the caller redirects it).
//
//   house_numbers    a number followed by a capitalised street name and a
//                    street suffix ("12 Quarry Hill Rd")
//   contractor_echo  a filled, unmasked value in a contractor / applicant /
//                    licensee / company column, or "Contractor: Name" in text
//   owner_cue        "the owners of <Name>", "homeowner <First Last>",
//                    "Owner: <Name>", or a filled, unmasked owner column
//   email_like       anything email-shaped
//   hex32            any 32-hex string (the shape of a subscriber token)
// A sample that cannot be fetched or unzipped is fetched:false with every
// count -1, which the Function reads as BLIND.

import { inflateRawSync } from "node:zlib";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { getSample } from "./http.mjs";

const MAX_ENTRIES = 500;
const MAX_TOTAL = 64 * 1024 * 1024;

// A minimal ZIP reader: the End Of Central Directory, then each central
// directory entry, then its local header and data (stored or deflated).
export function unzip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new Error("too many entries");
  const out = [];
  let total = 0;
  const dec = new TextDecoder("utf-8");
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("bad local header");
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = b.subarray(start, start + csize);
    total += usize;
    if (total > MAX_TOTAL) throw new Error("too large");
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) raw = inflateRawSync(data, { maxOutputLength: MAX_TOTAL });
    else throw new Error("unsupported compression");
    out.push({ name, text: dec.decode(raw) });
  }
  return out;
}

// A small RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const SUFFIX = "St|Street|Rd|Road|Ave|Avenue|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Blvd|Boulevard|" +
  "Ter|Terrace|Cir|Circle|Hwy|Highway|Pkwy|Parkway|Sq|Square|Pike|Tpke|Turnpike";
const HOUSE = new RegExp(`\\b\\d{1,5}[A-Za-z]?\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Z][A-Za-z'-]+\\s+){1,3}(?:${SUFFIX})\\b`, "g");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const HEX32 = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{32}(?![0-9A-Fa-f])/g;
const CONTRACTOR_TEXT = /\b(?:contractor|applicant|licensee)\s*[:=]\s*[A-Z][A-Za-z&.'-]+/gi;
const OWNER_TEXT = [
  /\b(?:the\s+)?owners?\s+of\s+(?:the\s+)?[A-Z][a-z]+/g,
  /\bhome\s*owners?\s*[:=]?\s*[A-Z][a-z]+\s+[A-Z][a-z]+/gi,
  /\b(?:property\s+)?owner\s*[:=]\s*[A-Z][a-z]+/gi,
];
const CONTRACTOR_COL = /contractor|applicant|licensee|builder|company|business/i;
const OWNER_COL = /owner/i;
// A value the sample is allowed to show in a sensitive column.
const MASKED = /^\s*$|^[\s\-*•·x#?_.]+$|redact|hidden|mask|withheld|upgrade|subscribe|paid|full (list|version)|not shown|n\/a|^none$|^unknown$/i;

const count = (re, s) => (String(s).match(re) || []).length;

// scan([{name, text}]) -> counts
export function scan(files) {
  const c = { house_numbers: 0, contractor_echo: 0, owner_cue: 0, email_like: 0, hex32: 0 };
  for (const f of files) {
    const t = f.text;
    c.house_numbers += count(HOUSE, t);
    c.email_like += count(EMAIL, t);
    c.hex32 += count(HEX32, t);
    c.contractor_echo += count(CONTRACTOR_TEXT, t);
    for (const re of OWNER_TEXT) c.owner_cue += count(re, t);
    if (/\.csv$/i.test(f.name)) {
      const rows = parseCsv(t);
      const head = rows[0] || [];
      const cCols = head.map((h, i) => (CONTRACTOR_COL.test(h) ? i : -1)).filter((i) => i >= 0);
      const oCols = head.map((h, i) => (OWNER_COL.test(h) && !CONTRACTOR_COL.test(h) ? i : -1)).filter((i) => i >= 0);
      for (const r of rows.slice(1)) {
        for (const i of cCols) if (r[i] !== undefined && !MASKED.test(r[i])) c.contractor_echo++;
        for (const i of oCols) if (r[i] !== undefined && !MASKED.test(r[i])) c.owner_cue++;
      }
    }
  }
  for (const k of Object.keys(c)) c[k] = Math.min(c[k], 100000);
  return c;
}

export async function c14Facts(fetchSample = getSample) {
  const blind = { fetched: false, house_numbers: -1, contractor_echo: -1, owner_cue: -1, email_like: -1, hex32: -1 };
  let r;
  try { r = await fetchSample(); } catch { return blind; }
  if (!r || r.status !== 200 || !r.bytes) return blind;
  let files;
  try { files = unzip(r.bytes); } catch { return blind; }
  try { return { fetched: true, ...scan(files) }; } catch { return blind; }
}

export async function main() {
  const c14 = await c14Facts();
  console.log(JSON.stringify({ c14 }));
  return c14;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) main();
