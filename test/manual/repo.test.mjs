// Repository guards for the manual-inputs change: what it may touch, what it
// must never touch, and what may never be written into this public repo.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_h.mjs";

const read = (p) => fs.readFileSync(path.join(H.REPO, p), "utf8");
const git = (...a) => execFileSync("git", a, { cwd: H.REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

// The files this feature ships. Every rule below reads these.
const NEW_FILES = [
  "functions/api/_manual_store.js", "functions/api/get-drop.js", "functions/admin/api/drop.js",
  "admin/drop.html", "admin/drop-app.js", "admin/drop.css",
  "workers/manual-intake/src/index.js", "workers/manual-intake/src/intake.js",
  "workers/manual-intake/wrangler.toml", "workers/manual-intake/package.json",
  "docs/manual-inputs/ENGINE_CONTRACT.md", "docs/manual-inputs/SETUP.md", "docs/manual-inputs/SECURITY.md",
  "test/manual/_h.mjs", "test/manual/store.test.mjs", "test/manual/drop.test.mjs",
  "test/manual/get-drop.test.mjs", "test/manual/intake.test.mjs", "test/manual/repo.test.mjs",
];
const NEVER_EDIT = [
  "functions/api/weekly-send.js", "functions/api/stripe-webhook.js", "functions/api/my-leads.js",
  "functions/leads.js", "functions/api/send-status.js", "functions/api/get-object.js",
  "functions/api/upload-bundle.js", "functions/api/get-engine.js", "functions/api/_github-oidc.js",
  "functions/api/_cf-access.js", "functions/api/_owner_gate.js", "functions/_middleware.js",
];

function changedFiles() {
  let base = null;
  for (const ref of ["origin/main", "main"]) {
    try { base = git("merge-base", ref, "HEAD").trim(); break; } catch (_) { /* next */ }
  }
  if (!base) return null;
  const tracked = git("diff", "--name-only", base).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

test("every shipped file exists", () => {
  for (const f of NEW_FILES) assert.ok(fs.existsSync(path.join(H.REPO, f)), f);
});

test("nothing under .github/ and none of the money-path files is changed", (t) => {
  const changed = changedFiles();
  if (!changed) return t.skip("no main ref to compare against");
  assert.deepEqual(changed.filter((p) => p.startsWith(".github/")), []);
  for (const f of NEVER_EDIT) assert.ok(!changed.includes(f), f);
  assert.ok(!changed.some((p) => p.includes("node_modules/")));
});

test("get-object READABLE and upload-bundle ALLOWED_KEYS are exactly as before", () => {
  const readable = read("functions/api/get-object.js").match(/const READABLE = new Set\(\[([\s\S]*?)\]\)/)[1];
  assert.deepEqual([...readable.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    ["cold-queue.json", "cold-state.json", "suppression.json", "source-health.json"]);
  const allowed = read("functions/api/upload-bundle.js").match(/const ALLOWED_KEYS = \{([\s\S]*?)\n\};/)[1];
  assert.deepEqual([...allowed.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]),
    ["latest-monthly.zip", "latest-weekly.zip", "latest-sample.zip", "refresh-status.json", "run-log.txt",
      "cold-state.json", "cold-log.txt", "source-health.json", "latest-weekly.html"]);
});

test("the new code reaches the bucket only through _manual_store.js, never lists, never logs", () => {
  for (const f of ["functions/api/get-drop.js", "functions/admin/api/drop.js", "workers/manual-intake/src/intake.js"]) {
    const src = read(f).replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/BUNDLES\s*\.\s*(get|put|head|delete|list)/.test(src), f);
    assert.ok(!/\.list\s*\(/.test(src), f);
  }
  const storeSrc = read("functions/api/_manual_store.js").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\.list\s*\(/.test(storeSrc));
  assert.ok(!/bucket\.(get|put|head|delete)\(\s*(?!check\()/.test(storeSrc), "every bucket call is wrapped in check()");
  for (const f of ["functions/api/_manual_store.js", "functions/api/get-drop.js", "functions/admin/api/drop.js"]) {
    assert.ok(!/console\./.test(read(f)), f + " logs nothing");
  }
  assert.equal((read("workers/manual-intake/src/intake.js").match(/console\./g) || []).length, 1, "one log call, in log()");
});

test("the page uses no HTML sink and no storage API", () => {
  for (const f of ["admin/drop.html", "admin/drop-app.js"]) {
    const src = read(f);
    for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /eval\(/, /new Function/,
      /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /<script>/]) {
      assert.ok(!re.test(src), f + " " + re);
    }
  }
  assert.match(read("_headers"), /\n\/admin\/drop\n  Content-Security-Policy: default-src 'none'; script-src 'self';[^\n]*frame-ancestors 'none'[^\n]*\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet\n  Referrer-Policy: no-referrer\n  Cache-Control: private, no-store\n/);
});

test("no em or en dash in any shipped file", () => {
  const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]|&[mn]dash;|&#0*821[12];|&#[xX]0*201[34];|\\\\u201[34]", "i");
  for (const f of NEW_FILES) assert.ok(!DASH.test(read(f)), f);
});

test("no email address anywhere in the shipped files", () => {
  const ADDR = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
  for (const f of NEW_FILES) {
    assert.deepEqual(read(f).match(ADDR) || [], [], f);
  }
});

test("no town name in any shipped file (checked against the 351-town list)", () => {
  const towns = Object.keys(JSON.parse(read("admin/mission-towns.json")).towns);
  assert.equal(towns.length, 351);
  for (const f of NEW_FILES) {
    const src = read(f);
    const hits = towns.filter((t) => new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(src));
    assert.deepEqual(hits, [], f);
  }
});

test("the intake Worker has its own package and lock, and node_modules is ignored", () => {
  assert.ok(fs.existsSync(path.join(H.REPO, "workers/manual-intake/package-lock.json")));
  assert.equal(JSON.parse(read("workers/manual-intake/package.json")).dependencies["postal-mime"], "4.0.0");
  assert.equal(git("check-ignore", "workers/manual-intake/node_modules/x").trim(), "workers/manual-intake/node_modules/x");
  assert.equal(git("check-ignore", "manual-raw/town-a/x.csv").trim(), "manual-raw/town-a/x.csv");
});
