// P1-14: structure, greps, syntax, and budgets.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, stub, get } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");
const git = (...a) => execFileSync("git", a, { cwd: H.REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

// P2 may extend this list with its page files (FILE RULES), never with anything else.
const FUNCTION_FILES = [
  "functions/api/_owner_gate.js", "functions/api/_mission_r2.js", "functions/api/_mission_stripe.js",
  "functions/api/_mission_data.js", "functions/admin/api/mission.js",
];
const ALLOWED = (p) => FUNCTION_FILES.includes(p) ||
  /^test\/mission\/[A-Za-z0-9_-]+\.test\.mjs$/.test(p) || p === "test/mission/_harness.mjs";
const NEVER_EDIT = [
  "functions/api/stripe-webhook.js", "functions/api/weekly-send.js", "functions/api/my-leads.js",
  "functions/api/send-status.js", "functions/api/_presend.js", "functions/api/_github-oidc.js",
  "functions/api/upload-bundle.js", "functions/api/get-object.js", "functions/api/_notice.js",
  "functions/api/inbox-status.js", "functions/api/funnel.js", "functions/leads.js", "functions/_middleware.js",
  "functions/api/_cf-access.js", "functions/api/pipeline.js", "functions/api/pipeline-now.js",
  "functions/api/pipeline-probe.js", "functions/api/pipeline-lifecycle.js", "functions/api/health.js",
  "functions/api/cold-status.js", "functions/api/traffic.js", "functions/api/live.js", "functions/api/sample.js",
  "functions/api/cf-traffic.js", "admin/now.html", "admin/pipeline.html", "robots.txt",
];
const ROUTES = ["weekly-send", "mail-owner", "newsletter-send", "newsletter", "nurture", "lifecycle-send",
  "request-sample", "agent-sample", "upload-bundle", "funnel", "hit"].map((r) => "/api/" + r);
const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");

function changedFiles() {
  let base;
  for (const ref of ["origin/main", "main"]) {
    try { base = git("merge-base", ref, "HEAD").trim(); break; } catch (_) { /* next */ }
  }
  assert.ok(base, "no main ref to compare against");
  const tracked = git("diff", "--name-only", base).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

const changed = changedFiles();
const added = changed.filter((p) => fs.existsSync(path.join(H.REPO, p)));
const nonTest = added.filter((p) => !p.endsWith(".test.mjs"));

test("P1-14 the diff from main lists only allowed paths", () => {
  const bad = changed.filter((p) => !ALLOWED(p));
  assert.deepEqual(bad, []);
  for (const p of NEVER_EDIT) assert.ok(!changed.includes(p), p);
  assert.ok(!changed.some((p) => p.startsWith(".github/")));
  assert.ok(!changed.some((p) => /(^|\/)(package(-lock)?\.json|wrangler\.toml|_routes\.json)$|node_modules/.test(p)));
  for (const f of FUNCTION_FILES) assert.ok(changed.includes(f), "missing " + f);
});

test("P1-14 exports: helpers export no onRequest*; the route exports onRequestGet only", () => {
  for (const mod of [m.gate, m.r2, m.stripe, m.data]) {
    assert.ok(!Object.keys(mod).some((k) => k.startsWith("onRequest")));
  }
  assert.deepEqual(Object.keys(m.mission), ["onRequestGet"]);
});

test("P1-14 import allowlist; no node:, no dynamic import, no fetch reassignment", () => {
  const names = ["_cf-access.js", "_presend.js", "_owner_gate.js", "_mission_r2.js", "_mission_stripe.js", "_mission_data.js"];
  for (const f of FUNCTION_FILES) {
    const src = read(f);
    const prefix = f.startsWith("functions/admin/api/") ? "../../api/" : "./";
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gms)].map((x) => x[1]);
    for (const s of specs) assert.ok(names.map((n) => prefix + n).includes(s), f + " imports " + s);
    assert.ok(!/\bimport\s*\(/.test(src), f + " dynamic import");
    assert.ok(!/["']node:/.test(src), f + " node: import");
    assert.ok(!/\brequire\s*\(|\bprocess\.|\bBuffer\b/.test(src), f + " node globals");
    assert.ok(!/globalThis\.fetch\s*=|self\.fetch\s*=/.test(src), f);
  }
});

test("P1-14 outbound: exactly one fetch call, inside stripeGet()", () => {
  const counts = (re) => FUNCTION_FILES.reduce((a, f) => a + (read(f).match(re) || []).length, 0);
  assert.equal(counts(/(?<![A-Za-z0-9_$.])fetch\s*\(/g), 1);
  assert.equal(counts(/\.fetch\s*\(/g), 0);
  assert.equal(counts(/typeof fetch|globalThis\.fetch|self\.fetch/g), 0);
  assert.equal(counts(/[=:?(,]\s*fetch(?![A-Za-z0-9_$])/g), 0);
  const src = read("functions/api/_mission_stripe.js");
  const start = src.indexOf("export async function stripeGet(");
  const end = src.indexOf("\n}\n", start);
  const at = src.search(/(?<![A-Za-z0-9_$.])fetch\s*\(/);
  assert.ok(start >= 0 && at > start && at < end, "the one fetch is inside stripeGet");
});

test("P1-14 writes: no put, delete or multipart in any P1 file", () => {
  for (const f of FUNCTION_FILES) {
    const src = read(f);
    for (const re of [/\.put\(/, /\.delete\(/, /createMultipartUpload/, /resumeMultipartUpload/]) {
      assert.ok(!re.test(src), f + " " + re);
    }
  }
  assert.deepEqual(Object.keys(m.r2.readView(new H.FakeR2())).sort(), ["get", "head", "list"]);
});

test("P1-14 route strings never appear in non-test added files", () => {
  for (const f of nonTest) {
    const src = read(f);
    for (const r of ROUTES) {
      assert.ok(!new RegExp(r.replace(/[/-]/g, "\\$&") + "(?![A-Za-z0-9-])").test(src), f + " names " + r);
    }
    assert.ok(!src.includes("force" + "=1"), f);
  }
});

test("P1-14 no key-shaped literal in any added file", () => {
  for (const f of added) {
    const src = read(f);
    assert.ok(!/(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/.test(src), f);
    assert.ok(!/whsec_[A-Za-z0-9]{10,}/.test(src), f);
  }
});

test("P1-14 no real email address in any added file", () => {
  for (const f of added) {
    const emails = read(f).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    for (const e of emails) assert.match(e, /@(example\.(com|org)|([a-z0-9-]+\.)*(example|invalid))$/i, f + ": " + e);
  }
});

test("P1-14 node --check on each new non-test file", () => {
  for (const f of FUNCTION_FILES) execFileSync(process.execPath, ["--check", path.join(H.REPO, f)]);
});

// ── budgets ────────────────────────────────────────────────────────────────
async function worstWorld() {
  const w = await H.quietWorld(NOW);
  w.r2.listLimit = 1;
  for (const [prefix, meta] of [["prospects/", { stage: "sent", trade: "roofing" }],
    ["agent-prospects/", { stage: "sent", town: "Barnstable" }], ["newsletter/", { c: "1", un: "0" }]]) {
    for (let i = 0; i < 5; i++) {
      w.r2.set(prefix + "budget" + i + "@example.com", "", { customMetadata: { ...meta, ts: String(NOW - H.DAY) } });
    }
  }
  return w;
}

export const budget = {};

test("P1-14 budget: R2 ops <= 25 default (cold, every list truncated after 3 pages), <= 6 map cold, <= 4 warm", async () => {
  const w = await worstWorld();
  w.r2.ops.length = 0;
  const res = await get(w, { cold: true });
  assert.equal(res.status, 200);
  budget.default_cold = w.r2.ops.length;
  assert.ok(w.r2.ops.length <= 25, "default ops " + w.r2.ops.length);
  assert.equal(w.r2.ops.filter((o) => o.op === "list").length, 9);
  assert.ok(res.body.tiles.find((t) => t.id === "signups").sub.startsWith("at least"));
  w.r2.ops.length = 0;
  await get(w, { cold: false });
  budget.default_warm = w.r2.ops.length;
  w.r2.ops.length = 0;
  await get(w, { query: "?view=map", cold: true });
  budget.map_cold = w.r2.ops.length;
  assert.ok(w.r2.ops.length <= 6, "map cold " + w.r2.ops.length);
  w.r2.ops.length = 0;
  await get(w, { query: "?view=map", cold: false });
  budget.map_warm = w.r2.ops.length;
  assert.ok(w.r2.ops.length <= 4, "map warm " + w.r2.ops.length);
  assert.ok(!w.r2.ops.some((o) => o.op === "put" || o.op === "delete"));
  const keys = new Set(w.r2.ops.map((o) => o.key));
  for (const k of ["cold-queue.json", "suppression.json", "latest-weekly.zip"]) {
    assert.ok(!w.r2.ops.some((o) => o.op === "get" && o.key === k), k);
  }
  assert.ok(keys.size > 0);
});

test("P1-14 budget: Stripe calls <= 6 without paging and <= 15 with", async () => {
  const w = await worstWorld();
  const e = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A + "," + H.PRICE_B };
  stub.stripe = H.stripeFake(H.stripeData(w.roster, NOW));
  stub.reset();
  await get(w, { env: e });
  budget.stripe_no_paging = stub.stripeCalls().length;
  assert.ok(stub.stripeCalls().length <= 6);
  stub.stripe = H.stripeFake(H.stripeData(w.roster, NOW), { pageSize: 1, alwaysMore: () => true });
  stub.reset();
  const res = await get(w, { env: e });
  budget.stripe_paging = stub.stripeCalls().length;
  assert.ok(stub.stripeCalls().length <= 15, "stripe calls " + stub.stripeCalls().length);
  assert.ok(H.lineIds(res.body, "known").includes("stripe_partial"));
  // a JWKS fetch on a cold isolate plus the worst Stripe case stays under 45 subrequests with R2
  assert.ok(1 + 15 + 25 <= 45);
});

test("P1-14 payload <= 16 KB with 20 synthetic customers; map <= 30 KB", async () => {
  const w = await worstWorld();
  const e = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A + "," + H.PRICE_B };
  stub.stripe = H.stripeFake(H.stripeData(w.roster, NOW));
  const res = await get(w, { env: e });
  assert.equal(res.body.detail.customers.rows.length, 20);
  budget.payload_bytes = Buffer.byteLength(res.text);
  assert.ok(budget.payload_bytes <= 16 * 1024, "payload " + budget.payload_bytes);
  // map: every town carries facts (worst case)
  const big = await H.healthyWorld(NOW, { sources: 340 });
  big.r2.set("admin/outreach.json", { version: 1, towns: { Adams: { outreach: "sent", since: "2026-09-20" },
    Alford: { outreach: "answered" }, Ashfield: { outreach: "planned", locked: true } } });
  const map = await get(big, { query: "?view=map" });
  budget.map_bytes = Buffer.byteLength(map.text);
  assert.ok(budget.map_bytes <= 30 * 1024, "map " + budget.map_bytes);
  const quietMap = await get(w, { query: "?view=map" });
  budget.map_bytes_quiet = Buffer.byteLength(quietMap.text);
  if (process.env.MISSION_TABLE) console.log("BUDGET " + JSON.stringify(budget));
});
