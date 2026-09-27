// D28 (Patrick, 2026-09-27): counts only in anything printed to a public log.
//
// weekly-send.js's response is printed by weekly-feed.yml and by the
// send-watchdog.yml retry; send-status.js's body is printed with `jq .` by
// send-watchdog.yml. This repo is public, so those Actions logs are readable
// by any signed-in GitHub user, and with a handful of subscribers even an
// address's domain can point to one person. Both endpoints are RUN here
// (onRequest, from a temp copy of functions/ with the OIDC check stubbed to
// pass and fetch stubbed so nothing leaves the machine) against a world with
// one failed delivery whose provider error quotes the address, and one
// active subscriber the run missed. The response must carry counts, and no
// address, domain or error text. The per-recipient detail must still be
// written to the private R2 send log.
//
//   node --test test/public-log-counts.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "public-log-counts-"));
fs.cpSync(path.join(REPO, "functions"), path.join(tmp, "functions"), { recursive: true });
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
// Test-only: the COPY's OIDC check always passes. The shipped file is untouched.
fs.writeFileSync(path.join(tmp, "functions/api/_github-oidc.js"),
  "export async function verifyGitHubOIDC() { return { ok: true }; }\n");
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DOMAIN = "tile-co.example.com";
const SUBS = [
  { email: "ann@example.com", name: "Ann Example", active: true, token: "a".repeat(32), customer: "cus_TEST000001" },
  { email: "bo@example.com", name: "Bo Example", active: true, token: "b".repeat(32), customer: "cus_TEST000002" },
  { email: "cy@" + DOMAIN, name: "Cy Example", active: true, token: "c".repeat(32), customer: "cus_TEST000003" },
];

class FakeR2 {
  constructor(objs) { this.o = new Map(Object.entries(objs)); this.puts = []; }
  async get(k) {
    if (!this.o.has(k)) return null;
    const v = this.o.get(k);
    const body = typeof v === "string" ? v : JSON.stringify(v);
    return { etag: "etag-" + k, httpEtag: '"etag-' + k + '"', uploaded: new Date(Date.now() - 3600_000), size: body.length,
      text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  }
  async head(k) { return this.o.has(k) ? { uploaded: new Date(Date.now() - 3600_000), size: 1 } : null; }
  async put(k, v) { this.puts.push(k); this.o.set(k, typeof v === "string" ? v : String(v)); return {}; }
  async list() { return { objects: [], truncated: false }; }
}

// send-status reads the clock: pin it to a Wednesday, well past Monday's due time and grace.
const WED = Date.parse("2026-09-30T18:00:00Z");
async function atWednesday(fn) {
  const real = Date.now;
  Date.now = () => WED;
  try { return await fn(); } finally { Date.now = real; }
}

const leaks = (text) => [/@/, new RegExp(DOMAIN.replace(/\./g, "\\.")), /example\.com/, /quoted/i]
  .filter((re) => re.test(text)).map(String);

test("D28 weekly-send: a failed delivery is a count in the response, never a domain or error text", async () => {
  const r2 = new FakeR2({
    "refresh-status.json": { ran_at: new Date(Date.now() - 2 * 3600_000).toISOString(), ok: true, count: 10 },
    "subscribers.json": SUBS,
    "latest-weekly.zip": "PK-test-bundle",
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.resend.com/emails") {
      const to = JSON.parse(init.body).to;
      const addr = Array.isArray(to) ? to[0] : to;
      if (String(addr).endsWith("@" + DOMAIN)) {
        return new Response("quoted: " + addr + " is not a valid recipient", { status: 422 });
      }
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    }
    throw new Error("test fetch refused: " + url);
  };
  let res, text;
  try {
    const ws = await load("functions/api/weekly-send.js");
    const env = { RESEND_API_KEY: "test", FROM_EMAIL: "MassPermits <leads@example.com>", BUNDLES: r2 };
    res = await ws.onRequest({ request: new Request("https://masspermits.com/api/weekly-send", { method: "POST" }), env });
    text = await res.text();
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.deepEqual([body.subscribers, body.delivered, body.failed], [3, 2, 1]);
  assert.ok(!("failed_domains" in body), "failed_domains is gone");
  for (const [k, v] of Object.entries(body)) {
    assert.ok(["number", "boolean", "string"].includes(typeof v) || v === null, k + " is a scalar");
  }
  assert.deepEqual(leaks(text), [], "nothing address-shaped in the public response: " + text);
  // the private log still has the detail
  const log = JSON.parse(r2.o.get("feed-send-log.json"));
  const failed = log[0].sent.filter((s) => !s.ok);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].to, "cy@" + DOMAIN);
});

test("D28 send-status: roster_gap and last_failed are counts, and no address reaches detail", async () => {
  const at = new Date(WED - 60_000).toISOString();
  const r2 = new FakeR2({
    "last-send-attempt.json": { at, subscribers: 3, degraded: false },
    "feed-send-log.json": [{ at, subscribers: 3, sent: [
      { to: "ann@example.com", ok: true },
      { to: "cy@" + DOMAIN, ok: false, error: "resend 422 quoted: cy@" + DOMAIN + " is not a valid recipient" },
    ] }],
    // Bo is active and was not in the run at all; Cy failed.
    "subscribers.json": SUBS,
  });
  const ss = await load("functions/api/send-status.js");
  const res = await atWednesday(() => ss.onRequest({ request: new Request("https://masspermits.com/api/send-status"), env: { BUNDLES: r2 } }));
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text);
  assert.equal(typeof body.roster_gap, "number");
  assert.equal(typeof body.last_failed, "number");
  assert.equal(body.last_failed, 1);
  assert.equal(body.roster_gap, 2, "Bo (not in the run) and Cy (not delivered)");
  assert.deepEqual(leaks(text), [], "nothing address-shaped in the public body: " + text);
});

test("D28 send-status: the roster_gap verdict's detail names a count, not who", async () => {
  // Everyone in the run was delivered, but Bo is active and was not in it.
  const at = new Date(WED - 60_000).toISOString();
  const r2 = new FakeR2({
    "last-send-attempt.json": { at, subscribers: 2, degraded: false },
    "feed-send-log.json": [{ at, subscribers: 2, sent: [{ to: "ann@example.com", ok: true }, { to: "cy@" + DOMAIN, ok: true }] }],
    "subscribers.json": SUBS,
  });
  const ss = await load("functions/api/send-status.js");
  const res = await atWednesday(() => ss.onRequest({ request: new Request("https://masspermits.com/api/send-status"), env: { BUNDLES: r2 } }));
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.roster_gap, 1);
  assert.equal(body.verdict, "roster_gap");
  assert.match(body.detail, /1 ACTIVE subscriber\(s\) were not in the run at all and are being billed but received nothing\./);
  assert.deepEqual(leaks(text), [], text);
});
