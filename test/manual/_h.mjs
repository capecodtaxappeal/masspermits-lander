// Shared harness for the manual-inputs tests. Test-only; nothing here ships.
//
// * load(): copies the shipped files byte for byte into a temp dir with a
//   {"type":"module"} package.json, keeping the relative layout, and imports
//   them from there. The shipped files are never touched.
// * FakeR2: in-memory get/head/put/delete with R2's conditional put
//   (onlyIf etagMatches, or Headers If-None-Match: *). It has NO list method,
//   and it records every op, so a test can prove which keys were reached.
// * installFetch(): serves the test JWKS for GitHub and for Access, and
//   THROWS on any other URL. No test reaches the network.
// * RS256 minters for GitHub OIDC and Cloudflare Access tokens.
// * file fixtures built here: pdf, xlsx (a real zip), csv, and the refusals.
// Every address in these tests is assembled at run time from neutral parts
// under the reserved .example domain, so no literal address sits in the repo.

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SHIPPED = [
  "functions/api/_manual_store.js",
  "functions/api/_github-oidc.js",
  "functions/api/_cf-access.js",
  "functions/api/_owner_gate.js",
  "functions/api/get-drop.js",
  "functions/admin/api/drop.js",
  "workers/manual-intake/src/intake.js",
];

let loaded = null;
export async function load() {
  if (loaded) return loaded;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-test-"));
  for (const rel of SHIPPED) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), dst);
  }
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const imp = (rel) => import(pathToFileURL(path.join(dir, rel)).href);
  loaded = {
    store: await imp("functions/api/_manual_store.js"),
    getDrop: await imp("functions/api/get-drop.js"),
    drop: await imp("functions/admin/api/drop.js"),
    intake: await imp("workers/manual-intake/src/intake.js"),
  };
  return loaded;
}

// ── addresses, built at run time ───────────────────────────────────────────
export const AT = String.fromCharCode(64);
export const addr = (local, domain) => local + AT + domain;

// ── fake R2 ────────────────────────────────────────────────────────────────
export class FakeR2 {
  constructor({ yieldEvery = false } = {}) {
    this.objects = new Map();
    this.ops = [];
    this.yieldEvery = yieldEvery;
    this.putRefusals = 0;
  }
  async tick() { if (this.yieldEvery) await new Promise((r) => setImmediate(r)); }
  static etag(buf) { return createHash("md5").update(buf).digest("hex"); }
  seed(key, body) {
    const buf = Buffer.from(body);
    this.objects.set(key, { buf, etag: FakeR2.etag(buf), customMetadata: {}, uploaded: new Date() });
  }
  wrap(key, o) {
    const buf = o.buf;
    return {
      key, size: buf.length, etag: o.etag, httpEtag: '"' + o.etag + '"', uploaded: o.uploaded,
      customMetadata: o.customMetadata,
      body: new Blob([buf]).stream(),
      text: async () => buf.toString("utf8"),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    };
  }
  async get(key) {
    this.ops.push(["get", key]);
    await this.tick();
    const o = this.objects.get(key);
    return o ? this.wrap(key, o) : null;
  }
  async head(key) {
    this.ops.push(["head", key]);
    await this.tick();
    const o = this.objects.get(key);
    if (!o) return null;
    const w = this.wrap(key, o);
    delete w.body; delete w.text; delete w.arrayBuffer;
    return w;
  }
  async put(key, value, opts = {}) {
    this.ops.push(["put", key]);
    await this.tick();
    const cur = this.objects.get(key);
    const c = opts.onlyIf;
    if (c) {
      if (typeof c.get === "function") {
        if (c.get("If-None-Match") === "*" && cur) { this.putRefusals++; return null; }
        const im = c.get("If-Match");
        if (im && (!cur || cur.etag !== im.replace(/"/g, ""))) { this.putRefusals++; return null; }
      } else {
        if (c.etagMatches !== undefined && (!cur || cur.etag !== c.etagMatches)) { this.putRefusals++; return null; }
        if (c.etagDoesNotMatch !== undefined && cur && (c.etagDoesNotMatch === "*" || cur.etag === c.etagDoesNotMatch)) { this.putRefusals++; return null; }
      }
    }
    const buf = Buffer.from(typeof value === "string" ? value : value instanceof Uint8Array ? value : new Uint8Array(value));
    const o = { buf, etag: FakeR2.etag(buf), customMetadata: opts.customMetadata || {}, uploaded: new Date() };
    this.objects.set(key, o);
    return { key, etag: o.etag, size: buf.length };
  }
  async delete(key) {
    this.ops.push(["delete", key]);
    await this.tick();
    this.objects.delete(key);
  }
  keysTouched() { return [...new Set(this.ops.map((o) => o[1]))]; }
}

// ── fetch stub and JWT minters ─────────────────────────────────────────────
export const GH_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
export const TEAM = "team-x.cloudflareaccess.com";
export const ACCESS_JWKS = "https://" + TEAM + "/cdn-cgi/access/certs";

const gen = () => crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
export const keys = { good: await gen(), rogue: await gen() };
const pub = { ...(await crypto.subtle.exportKey("jwk", keys.good.publicKey)), kid: "kid-1", alg: "RS256", use: "sig" };

export const fetchCalls = [];
export function installFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    if (u === GH_JWKS || u === ACCESS_JWKS) return new Response(JSON.stringify({ keys: [pub] }), { status: 200 });
    throw new Error("unexpected network call in test");
  };
}
installFetch();

const b64u = (x) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");
export async function jwt(payload, { key = keys.good.privateKey, kid = "kid-1", alg = "RS256" } = {}) {
  const h = b64u(JSON.stringify({ alg, typ: "JWT", kid }));
  const p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + p));
  return `${h}.${p}.${b64u(sig)}`;
}

export const WORKFLOW_REF = "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-refresh.yml@refs/heads/main";
export function ghClaims(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://token.actions.githubusercontent.com", aud: "masspermits-cron",
    repository: "capecodtaxappeal/masspermits-lander", ref: "refs/heads/main",
    workflow_ref: WORKFLOW_REF, job_workflow_ref: WORKFLOW_REF, event_name: "schedule",
    exp: now + 300, iat: now, ...over,
  };
}

export const ACCESS_AUD = "aud-tag-test";
export const OWNER = addr("owner", "owner.example");
export function accessClaims(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://" + TEAM, aud: [ACCESS_AUD], type: "app", email: OWNER, sub: "sub-1",
    exp: now + 600, iat: now - 5, nbf: now - 5, ...over,
  };
}

export const SOURCES = {
  "town-a": { label: "Town A", cadence: "weekly", accept: ["csv", "xlsx", "pdf"] },
  "town-b": { label: "Town B", cadence: "monthly", accept: ["pdf"] },
};
export function pagesEnv(r2, over = {}) {
  return {
    BUNDLES: r2, CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: ACCESS_AUD,
    ADMIN_ALLOWED_EMAILS: OWNER, MANUAL_SOURCES: JSON.stringify(SOURCES), ...over,
  };
}

// ── file fixtures ──────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zip([{ name, data, deflate?, flags? }]) -> Buffer
export function zip(entries) {
  const locals = [], centrals = [];
  let off = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data);
    const data = e.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const flags = e.flags || 0, method = e.deflate ? 8 : 0, crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, name, data);
    centrals.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

const CT_XLSX = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
const CT_XLSM = CT_XLSX.replace("spreadsheetml.sheet.main+xml", "vnd.ms-excel.sheet.macroEnabled.main+xml")
  .replace("</Types>", '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');

export const F = {
  csv: () => Buffer.from("col_a,col_b,col_c\r\n1,2,3\r\n4,5,6\r\n"),
  csvBom: () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("col_a;col_b\n1;2\n")]),
  pdf: (extra = "") => Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n" + extra + "trailer << /Root 1 0 R >>\n%%EOF\n"),
  xlsx: (deflate = true) => zip([
    { name: "[Content_Types].xml", data: CT_XLSX, deflate },
    { name: "xl/workbook.xml", data: "<workbook/>", deflate },
    { name: "xl/printerSettings/printerSettings1.bin", data: "printer" },
  ]),
  xlsm: () => zip([
    { name: "[Content_Types].xml", data: CT_XLSM, deflate: true },
    { name: "xl/workbook.xml", data: "<workbook/>" },
    { name: "xl/vbaProject.bin", data: "vba" },
  ]),
  xlsmTypesOnly: () => zip([
    { name: "[Content_Types].xml", data: CT_XLSM.replace(/<Override PartName="\/xl\/vbaProject[^>]*>/, ""), deflate: true },
    { name: "xl/workbook.xml", data: "<workbook/>" },
  ]),
  zipEncrypted: () => zip([
    { name: "[Content_Types].xml", data: CT_XLSX },
    { name: "xl/workbook.xml", data: "<workbook/>", flags: 1 },
  ]),
  ole: () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]),
  exe: () => Buffer.concat([Buffer.from("MZ"), Buffer.from([0x90, 0, 3, 0, 0, 0, 4, 0]), Buffer.alloc(200)]),
  nestedZip: () => zip([{ name: "inner.zip", data: zip([{ name: "a.csv", data: "a,b\n1,2\n" }]) }]),
  xlsxWithEmbedding: () => zip([
    { name: "[Content_Types].xml", data: CT_XLSX },
    { name: "xl/workbook.xml", data: "<workbook/>" },
    { name: "xl/embeddings/oleObject1.bin", data: "x" },
  ]),
  docx: () => zip([
    { name: "[Content_Types].xml", data: CT_XLSX.replace("spreadsheetml.sheet.main", "wordprocessingml.document.main") },
    { name: "word/document.xml", data: "<w/>" },
  ]),
  zipSlip: () => zip([
    { name: "[Content_Types].xml", data: CT_XLSX },
    { name: "xl/../../evil.xml", data: "x" },
  ]),
  pdfEncrypted: () => Buffer.from("%PDF-1.6\n1 0 obj << >> endobj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF\n"),
  html: () => Buffer.from("<!doctype html><html><body>error,page</body></html>\n"),
  oneColumn: () => Buffer.from("justone\n1\n2\n"),
  latin1: () => Buffer.from([0x63, 0x6f, 0x6c, 0x2c, 0xe9, 0x0a]),
  empty: () => Buffer.alloc(0),
  oversize: () => Buffer.concat([Buffer.from("a,b\n"), Buffer.alloc(10 * 1024 * 1024, 0x31)]),
};
