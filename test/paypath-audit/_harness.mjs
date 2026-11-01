// Shared harness for the pay path audit (docs/audit/PAYPATH_AUDIT_2026-11-01.md).
//
// Safety: nothing leaves this machine. globalThis.fetch is replaced before any
// handler is imported; only the Resend URL is answered (recorded, never sent)
// and every other URL throws. R2 is an in-memory Map. The GitHub OIDC verifier
// is swapped by a loader hook, because a local process cannot mint an Actions
// token. All addresses are synthetic (@example.test).
//
// Naming rule for every test in this folder:
//   "DEFECT ..."  a real defect. The test asserts the CORRECT behaviour, so it
//                 FAILS today and passes once the fix in the audit doc lands.
//   "OK ..."      documents behaviour that is correct today. Must pass.

import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import path from "node:path";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const API = path.join(REPO, "functions", "api");

// ---- loader: replace only the OIDC verifier --------------------------------
// The stub refuses a request with no Authorization header (so the 401 path is
// still exercised) and otherwise returns the claims in globalThis.__OIDC.
const tmp = mkdtempSync(path.join(tmpdir(), "mp-paypath-"));
const stub = path.join(tmp, "oidc-stub.mjs");
writeFileSync(stub,
  "export async function verifyGitHubOIDC(request){\n" +
  "  if (!request.headers.get('authorization')) return { ok:false, reason:'no-bearer' };\n" +
  "  return { ok:true, payload: globalThis.__OIDC || {} };\n}\n");
const hook = path.join(tmp, "hook.mjs");
writeFileSync(hook, `export async function resolve(s, c, n) {
  if (s.endsWith("_github-oidc.js")) return n(${JSON.stringify(pathToFileURL(stub).href)}, c);
  return n(s, c);
}\n`);
register(pathToFileURL(hook).href);

export const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

// ---- clock -----------------------------------------------------------------
const RealDate = Date;
let NOW = null; // null = real time
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW === null ? RealDate.now() : NOW); else super(...a); }
  static now() { return NOW === null ? RealDate.now() : NOW; }
}
globalThis.Date = FakeDate;
export const clock = {
  set(iso) { NOW = RealDate.parse(iso); },
  real() { NOW = null; },
};

// ---- Resend ----------------------------------------------------------------
export const mail = [];   // every Resend call: { to, subject, body }
export const resend = { delayMs: 0, fail: false, failFor: new Set() };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.resend.com/")) throw new Error("BLOCKED network call to " + u);
  const b = JSON.parse(init.body || "{}");
  const to = (b.to || [])[0];
  if (resend.delayMs) await new Promise((r) => setTimeout(r, resend.delayMs));
  if (resend.fail || resend.failFor.has(to)) {
    return { ok: false, status: 503, text: async () => "simulated outage", json: async () => ({}) };
  }
  mail.push({ to, subject: b.subject || "", body: b });
  return { ok: true, status: 200, text: async () => "{}", json: async () => ({ id: "re_x" }) };
};
export const resetMail = () => { mail.length = 0; resend.delayMs = 0; resend.fail = false; resend.failFor.clear(); };

// ---- R2 --------------------------------------------------------------------
// get() takes its snapshot when CALLED and resolves after `latencyMs`, like a
// real network round trip, so read-modify-write races are reproducible.
export function fakeR2(init = {}, { latencyMs = 0 } = {}) {
  const m = new Map();
  const throwOn = new Set();      // "get:<key>" / "put:<key>", consumed once
  const throwAlways = new Set();  // same, never consumed
  const gets = [];
  const writes = [];
  let n = 0;
  const sleep = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve());
  const set = (k, v, etag, uploaded) => {
    const body = v instanceof Uint8Array ? Buffer.from(v) : Buffer.from(typeof v === "string" ? v : JSON.stringify(v));
    m.set(k, { body, etag: etag || "e" + (++n), uploaded: uploaded || Date.now() });
  };
  for (const [k, v] of Object.entries(init)) set(k, v);
  const obj = (k, v) => ({
    key: k, etag: v.etag, httpEtag: '"' + v.etag + '"', size: v.body.length, uploaded: new RealDate(v.uploaded),
    body: v.body, customMetadata: v.meta || {},
    text: async () => v.body.toString("utf8"),
    json: async () => JSON.parse(v.body.toString("utf8")),
    arrayBuffer: async () => v.body.buffer.slice(v.body.byteOffset, v.body.byteOffset + v.body.byteLength),
  });
  const trip = (op, k) => {
    const t = op + ":" + k;
    if (throwAlways.has(t)) throw new Error("simulated R2 failure on " + t);
    if (throwOn.has(t)) { throwOn.delete(t); throw new Error("simulated R2 failure on " + t); }
  };
  return {
    m, throwOn, throwAlways, gets, writes, set,
    json(k) { const v = m.get(k); return v ? JSON.parse(v.body.toString("utf8")) : null; },
    async get(k) { gets.push(k); trip("get", k); const v = m.get(k); const snap = v ? { ...v } : null; await sleep(); return snap ? obj(k, snap) : null; },
    async head(k) { const v = m.get(k); return v ? obj(k, v) : null; },
    async put(k, val, opts = {}) {
      trip("put", k); await sleep();
      writes.push({ key: k, opts });
      const body = typeof val === "string" ? Buffer.from(val) : Buffer.from(new Uint8Array(val));
      m.set(k, { body, etag: "e" + (++n), uploaded: Date.now(), meta: opts.customMetadata });
    },
    async list() { return { objects: [], truncated: false }; },
    async delete(k) { m.delete(k); },
  };
}

// ---- Stripe ----------------------------------------------------------------
export const WHSEC = "whsec_test_only_not_a_secret";
export function stripeRequest(event, { secret = WHSEC, t = Math.floor(Date.now() / 1000), tamper = false } = {}) {
  const raw = JSON.stringify(event);
  const sig = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const body = tamper ? raw.replace("example.test", "example.invalid") : raw;
  return new Request("https://masspermits.com/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" }, body,
  });
}
let evn = 0;
export const ev = (type, object) => ({ id: "evt_test_" + (++evn), type, data: { object } });

export const OWNER = "owner@example.test";
export function env(r2) {
  return { BUNDLES: r2, RESEND_API_KEY: "re_test_only", FROM_EMAIL: "MassPermits <leads@example.test>",
           STRIPE_WEBHOOK_SECRET: WHSEC, OWNER_EMAIL: OWNER };
}

export const tok = (c) => c.repeat(32);
export const sub = (i, extra = {}) => ({
  email: `sub${String(i).padStart(3, "0")}@example.test`, name: `Test Sub${i}`, customer: `cus_test${i}`,
  since: "2026-09-01", active: true, token: tok("abcdef0123456789"[i % 16]), ...extra,
});
export const zip = (s = "PK fake zip") => new Uint8Array(Buffer.from(s));

export async function body(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } }
