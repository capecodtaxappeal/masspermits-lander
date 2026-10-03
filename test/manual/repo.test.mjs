// Repository guards for the manual-inputs change: what it may touch, what it
// must never touch, and what may never be written into this public repo.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

// The never-edit guard is anchored to PR #7's OWN commit range, as merged. It
// used to diff merge-base(origin/main, HEAD) against the working tree. That
// proved the point while PR #7 was the branch under review, but once PR #7 was
// on main it judged every later branch instead, and failed each one that edits
// a money-path file for its own approved reasons. A fixed range keeps the proof
// about PR #7 and stops judging work that is not PR #7's. Later changes to these
// files are reviewed on their own branches.
const PR7 = {
  base: "1068e8070e88a436fbf5f86b88bf075e1f3a01c5",  // main when PR #7 branched
  head: "0e080ecf660bfb7290509862cd48f58e9818353a",  // PR #7's last commit
  merge: "7aa5cdf8c12bf4d92f18a4eaa1b0133d413df651", // the merge that put it on main
};

const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const hasCommit = (sha, run = git) => { try { run("cat-file", "-e", sha + "^{commit}"); return true; } catch (_) { return false; } };
const changedIn = (base, head, run = git) => lines(run("diff", "--name-only", base, head)).sort();

// Every path in `changed` that this guard forbids, in a stable order.
function violations(changed) {
  return [
    ...changed.filter((p) => p.startsWith(".github/")),
    ...NEVER_EDIT.filter((f) => changed.includes(f)),
    ...changed.filter((p) => p.includes("node_modules/")),
  ];
}

test("every shipped file exists", () => {
  for (const f of NEW_FILES) assert.ok(fs.existsSync(path.join(H.REPO, f)), f);
});

test("PR #7's own range changed nothing under .github/ and none of the money-path files", (t) => {
  if (!Object.values(PR7).every((sha) => hasCommit(sha))) return t.skip("PR #7's commits are not in this clone");
  // The anchor is the range that was actually merged, not a guess.
  assert.equal(git("merge-base", PR7.base, PR7.head).trim(), PR7.base, "base is an ancestor of head");
  const parents = git("rev-list", "--parents", "-n", "1", PR7.merge).trim().split(/\s+/).slice(1);
  assert.ok(parents.includes(PR7.head), "the merge commit has PR #7's head as a parent");
  const changed = changedIn(PR7.base, PR7.head);
  for (const f of NEW_FILES) assert.ok(changed.includes(f), "the range is PR #7's own: " + f);
  assert.deepEqual(violations(changed), []);
  // What the merge brought to main, conflict resolution included, is clean too.
  assert.deepEqual(violations(changedIn(PR7.merge + "^1", PR7.merge)), []);
});

test("a later branch that edits a money-path file does not fail the PR #7 guard", (t) => {
  // A throwaway repository: a base, a stand-in for PR #7 that adds only a
  // manual-inputs file, then a later branch that edits weekly-send.js.
  // core.longpaths: a test runner may put the temp dir deep inside a clone's
  // .git, past the Windows 260-character limit for the object files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr7-anchor-"));
  const ident = ["-c", "user.name=guard test", "-c", "user.email=" + H.addr("guard", "example.invalid"),
    "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "core.longpaths=true"];
  const g = (...a) => execFileSync("git", [...ident, ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (msg) => { g("add", "-A"); g("commit", "-q", "-m", msg); return g("rev-parse", "HEAD").trim(); };
  try {
    g("init", "-q");
    g("symbolic-ref", "HEAD", "refs/heads/main");
  } catch (e) {
    return t.skip("git cannot create a scratch repository here");
  }
  try {
    put("functions/api/weekly-send.js", "// v1\n");
    put("functions/api/stripe-webhook.js", "// v1\n");
    const base = commit("base");
    put("functions/api/_manual_store.js", "// stand-in\n");
    const head = commit("stand-in for PR #7");
    g("checkout", "-q", "-b", "later");
    put("functions/api/weekly-send.js", "// v2, an approved later fix\n");
    commit("later branch edits a money-path file");
    put("functions/api/stripe-webhook.js", "// v2, uncommitted\n");

    // The anchored guard reads only the fixed range, so the later work passes.
    assert.deepEqual(violations(changedIn(base, head, g)), []);

    // Not vacuous: the old merge-base comparison flags this very branch.
    const mb = g("merge-base", "main", "HEAD").trim();
    assert.equal(mb, head);
    const old = [...new Set([...lines(g("diff", "--name-only", mb)),
      ...lines(g("ls-files", "--others", "--exclude-standard"))])].sort();
    assert.deepEqual(violations(old), ["functions/api/weekly-send.js", "functions/api/stripe-webhook.js"]);

    // And the guard still bites when the anchored range itself touches one.
    g("checkout", "-q", "-f", "-b", "bad", base);
    put("functions/api/stripe-webhook.js", "// edited inside the range\n");
    put(".github/workflows/x.yml", "on: push\n");
    const badHead = commit("a range that breaks the rule");
    assert.deepEqual(violations(changedIn(base, badHead, g)), [".github/workflows/x.yml", "functions/api/stripe-webhook.js"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
