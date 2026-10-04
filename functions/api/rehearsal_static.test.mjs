// Static guards for the monday rehearsal build (the file-level rules; the
// behavioural locks live in the other *.test.mjs files).
//
//   node functions/api/rehearsal_static.test.mjs
//
// Covers acceptance 4 (route grep), 8 (paths), 14 (no-dispatch grep), 15
// (imports, harness assignments, no onRequest export in functions/ tests) and
// the file-level parts of 18 (R2b: exactly one member .fetch(, the env.ASSETS
// call inside readAsset()). *.test.mjs files are exempt from the content
// greps, as the rules say.
//
// Scope, re-anchored for go-live (2026-10-04). This file used to diff
// origin/main against the working tree. That proved the point while PR #1 was
// the branch under review, but once PR #1 is on main it would judge every
// later branch instead (any approved edit to weekly-send.js would fail "only
// ADDS files"), and on main itself the diff is empty, so "exactly 2 fetch(
// calls" would fail. The same mistake was fixed for PR #7's guard in
// 0b2254aa4. Now:
//   - the PATH rules (8) read PR #1's own fixed commit range, PR1.base to
//     PR1.head, and skip when those commits are not in the clone;
//   - the CONTENT rules (4, 14, 15, 18, hygiene) read the rehearsal's OWN files
//     as they are today, a fixed set: FN_ALLOW, everything under
//     scripts/rehearsal/, docs/rehearsal/ and test/rehearsal/, and the
//     rehearsal's test files. Nothing else in the repository is judged here.

import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRunner, readText } from "../../test/rehearsal/harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const { check, skip, done } = makeRunner("rehearsal_static.test.mjs");

const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  .split("\n").filter(Boolean);
const PR1 = {
  base: "7db6190a03be21eb1dc16cf7801e6c1abe8a7cca",  // main when PR #1 branched (2026-09-24)
  head: "455808d9f6c19b8b0cea2da7645584ac42f71b2a",  // PR #1's last commit (the cleanup)
};
const hasCommit = (sha) => { try { git("cat-file", "-e", sha + "^{commit}"); return true; } catch { return false; } };

// ── 8. paths: PR #1's own range ─────────────────────────────────────────────
const NEVER = ["functions/api/stripe-webhook.js", "functions/api/weekly-send.js",
  "functions/api/my-leads.js", "functions/api/send-status.js", "functions/api/_presend.js",
  "functions/api/_github-oidc.js", "functions/api/upload-bundle.js", "functions/api/get-object.js",
  "functions/api/_notice.js", "functions/api/inbox-status.js", "functions/api/funnel.js",
  "functions/leads.js", "functions/_middleware.js"];
const FN_ALLOW = new Set(["functions/api/_ro_bucket.js", "functions/api/_rehearsal.js",
  "functions/api/_rehearsal_mail.js", "functions/api/_reconcile.js", "functions/api/rehearsal.js",
  "functions/api/rehearsal-seed.js"]);
if (!hasCommit(PR1.base) || !hasCommit(PR1.head)) {
  skip("PR #1's path rules", "PR #1's commits are not in this clone");
} else {
  check("PR #1's range is real: base is an ancestor of head", git("merge-base", PR1.base, PR1.head)[0] === PR1.base);
  const changed = git("diff", "--name-only", PR1.base, PR1.head).sort();
  const added = new Set(git("diff", "--name-only", "--diff-filter=A", PR1.base, PR1.head));
  console.log(`PR #1 range ${PR1.base.slice(0, 9)}..${PR1.head.slice(0, 9)}: ${changed.length} paths`);
  check("PR #1: no changed path under .github/", !changed.some((p) => p.startsWith(".github/")));
  const touchedNever = changed.filter((p) => NEVER.includes(p));
  check("PR #1: none of the NEVER-edit files changed", touchedNever.length === 0, touchedNever.join(","));
  const strayFn = [...added].filter((p) => p.startsWith("functions/") && !p.endsWith(".test.mjs") && !FN_ALLOW.has(p));
  check("PR #1: no new functions/ path outside the FILE RULES allowlist", strayFn.length === 0, strayFn.join(","));
  const otherChanged = changed.filter((p) => !added.has(p));
  check("PR #1 only ADDS files (no shipped file modified)", otherChanged.length === 0, otherChanged.join(","));
  check("PR #1 added every file of FN_ALLOW", [...FN_ALLOW].every((p) => added.has(p)));
}

// ── the rehearsal's own files, as they are today ────────────────────────────
const under = (dir) => {
  const out = [];
  const walk = (rel) => {
    let ents;
    try { ents = readdirSync(join(repo, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel + "/" + e.name;
      if (e.isDirectory()) walk(r); else out.push(r);
    }
  };
  walk(dir);
  return out.sort();
};
const REHEARSAL_TESTS = ["all", "guard1_probe", "handlers_harness", "inbox_mirror", "oidc_harness",
  "purchase_render", "reconcile", "rehearsal_c16", "rehearsal_cleanup", "rehearsal_drills", "rehearsal_function",
  "rehearsal_mirror", "rehearsal_r2b", "rehearsal_r3a_drills", "rehearsal_r3b", "rehearsal_r4", "rehearsal_static",
  "rehearsal_unit", "ro_bucket"].map((n) => `functions/api/${n}.test.mjs`);
const own = [...FN_ALLOW, ...under("scripts/rehearsal"), ...under("docs/rehearsal"), ...under("test/rehearsal"),
  ...REHEARSAL_TESTS].filter((p) => existsSync(join(repo, p)));
const ownSet = new Set(own);
check("the rehearsal's own files are all present", [...FN_ALLOW, ...REHEARSAL_TESTS].every((p) => existsSync(join(repo, p))),
  [...FN_ALLOW, ...REHEARSAL_TESTS].filter((p) => !existsSync(join(repo, p))).join(","));
const nonTest = own.filter((p) => !p.endsWith(".test.mjs"));
check("scope: no shipped money-path file is in the rehearsal's own set, so a later approved edit to one is never judged here",
  !NEVER.some((p) => ownSet.has(p)));
const read = (p) => readText(join(repo, p));

// ── 4. route grep ───────────────────────────────────────────────────────────
const LIST = "weekly-send|mail-owner|newsletter-send|newsletter|nurture|lifecycle-send|request-sample|agent-sample|upload-bundle|funnel|hit";
const ROUTE = [new RegExp(`(?<![A-Za-z0-9_])/api/(${LIST})\\b`), new RegExp(`masspermits\\.com/api/(${LIST})\\b`),
               /force=1/, /[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.pages\.dev/, /[0-9a-f]{8}\.[A-Za-z0-9-]+\.pages\.dev/];
for (const p of nonTest) {
  const hits = ROUTE.filter((re) => re.test(read(p))).map(String);
  check(`route grep clean: ${p}`, hits.length === 0, hits.join(" "));
}

// ── 14. no-dispatch grep ────────────────────────────────────────────────────
const DISPATCH = [/\/dispatches/, /\/rerun/, /\/cancel/, /\/force-cancel/, /actions: write/,
                  /(^|[^A-Za-z0-9_])gh (workflow|run|api)/m];
for (const p of nonTest) {
  const hits = DISPATCH.filter((re) => re.test(read(p))).map(String);
  check(`no-dispatch grep clean: ${p}`, hits.length === 0, hits.join(" "));
}

// ── 15. harness assignments and imports ─────────────────────────────────────
for (const p of nonTest) {
  check(`no "globalThis.fetch =" or "self.fetch =" in ${p}`, !/(globalThis|self)\.fetch\s*=(?!=)/.test(read(p)));
}
const fnTests = git("ls-files", "--cached", "--others", "--exclude-standard", "functions")
  .filter((p) => p.endsWith(".test.mjs") && existsSync(join(repo, p)));
// Literal rule on every rehearsal test file. Any other test file under
// functions/ is judged with // comments stripped, and a comment-only hit is
// printed as a note (stripe-webhook.test.mjs:23 says "exports only
// onRequestPost" in a comment; it exports nothing).
const ONREQ = /export[^;\n]*\bonRequest/;
for (const p of fnTests) {
  if (ownSet.has(p)) { check(`no onRequest* export in ${p}`, !ONREQ.test(read(p))); continue; }
  const code = read(p).split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  check(`no onRequest* export in pre-existing ${p} (code, comments stripped)`, !ONREQ.test(code));
  if (ONREQ.test(read(p))) console.log(`NOTE ${p}: the literal pattern matches a comment only`);
}
const IMPORT_ALLOW = new Set(["./_presend.js", "./_github-oidc.js", "./_ro_bucket.js", "./_rehearsal.js",
  "./_rehearsal_mail.js", "./_reconcile.js", "./my-leads.js", "../leads.js"]);
const fnNonTest = nonTest.filter((p) => p.startsWith("functions/"));
// rehearsal-seed.js (R2b) may import ./_ro_bucket.js only.
const SEED_IMPORT_ALLOW = new Set(["./_ro_bucket.js"]);
for (const p of fnNonTest) {
  const s = read(p);
  const specs = [...s.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1])
    .concat([...s.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1]));
  const allow = p === "functions/api/rehearsal-seed.js" ? SEED_IMPORT_ALLOW : IMPORT_ALLOW;
  const bad = specs.filter((x) => !allow.has(x));
  check(`imports inside the allowlist: ${p}`, bad.length === 0, bad.join(","));
  check(`no dynamic import(): ${p}`, !/\bimport\s*\(/.test(s));
}
for (const p of ["functions/api/rehearsal.js", "functions/api/_rehearsal.js"]) {
  if (existsSync(join(repo, p))) check(`no request.headers in ${p}`, !read(p).includes("request.headers"));
}

// ── 18 (the parts that apply now) ───────────────────────────────────────────
const FREE_FETCH = /(?<![A-Za-z0-9_$.])fetch\s*\(/g;
const MEMBER_FETCH = /\.fetch\s*\(/g;
const count = (re, s) => (s.match(re) || []).length;
const fnSrc = fnNonTest.map(read);
const hasRehearsal = existsSync(join(repo, "functions/api/rehearsal.js"));
const free = fnSrc.reduce((n, s) => n + count(FREE_FETCH, s), 0);
check(`free fetch( calls in added functions/ files: ${hasRehearsal ? "exactly 2" : "0 before rehearsal.js exists"}`,
  free === (hasRehearsal ? 2 : 0), free);
// (a') R2b: the regex \.fetch\s*\( matches exactly once across the added
// non-test functions/ files, on env.ASSETS inside readAsset() in rehearsal.js.
const member = fnNonTest.flatMap((p) => read(p).split("\n").map((l, i) => ({ p, i, l })))
  .filter((x) => /\.fetch\s*\(/.test(x.l));
check("(a') exactly one .fetch( member call across added functions/ files", member.length === 1,
  member.map((x) => `${x.p}:${x.i + 1}`).join(","));
check("(a') ... it is the env.ASSETS call in rehearsal.js, verbatim",
  member.length === 1 && member[0].p === "functions/api/rehearsal.js" &&
  member[0].l.trim() === 'return env.ASSETS.fetch(new Request(new URL(path, "https://masspermits.com")));');
if (existsSync(join(repo, "functions/api/rehearsal.js"))) {
  const src = read("functions/api/rehearsal.js");
  const m = src.match(/export async function readAsset\(env, path\) \{\n([\s\S]*?)\n\}/);
  check("(a') ... inside readAsset(env, path), after the literal-path guard", !!m &&
    /^  if \(path !== "\/index\.html" && path !== "\/offer\.html"\) throw /.test(m[1]) &&
    m[1].includes("env.ASSETS.fetch("));
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  check("(a') ASSETS appears in no other code line of rehearsal.js", (code.match(/ASSETS/g) || []).length === 1);
}
if (existsSync(join(repo, "functions/api/rehearsal-seed.js"))) {
  const s = read("functions/api/rehearsal-seed.js");
  check("rehearsal-seed.js: no fetch of any kind", !/fetch/.test(s));
  check("rehearsal-seed.js: no api.resend.com, no env.ASSETS", !s.includes("api.resend.com") && !s.includes("ASSETS"));
  check("rehearsal-seed.js: every write goes through roBucket with allowPrefix rehearsal/",
    /roBucket\(env\.BUNDLES, \{ allowPrefix: "rehearsal\/" \}\)/.test(s) && (s.match(/BUNDLES/g) || []).length === 1);
  const handlers = [...s.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)]
    .map((m) => m[1])
    .filter((n) => n.startsWith("onRequest"));
  check("rehearsal-seed.js: its only handler is onRequestPost", handlers.join() === "onRequestPost", handlers.join());
}
for (const p of fnNonTest) {
  const s = read(p);
  const hits = [/typeof fetch/, /globalThis\.fetch/, /self\.fetch/, /[=:?(,]\s*fetch(?![A-Za-z0-9_$])/]
    .filter((re) => re.test(s)).map(String);
  check(`no indirect reference to the global fetch: ${p}`, hits.length === 0, hits.join(" "));
}
const resendCount = nonTest.reduce((n, p) => n + count(/api\.resend\.com/g, read(p)), 0);
check(`"api.resend.com" in added non-test files: ${hasRehearsal ? "exactly 1" : "0 before rehearsal.js exists"}`,
  resendCount === (hasRehearsal ? 1 : 0), resendCount);
if (existsSync(join(repo, "functions/api/_rehearsal_mail.js"))) {
  const s = read("functions/api/_rehearsal_mail.js");
  check("_rehearsal_mail.js: 0 fetch calls", count(/fetch\s*\(/g, s) === 0);
  check("_rehearsal_mail.js: no api.resend.com", !s.includes("api.resend.com"));
  check("_rehearsal_mail.js: imports nothing", !/^\s*import\b/m.test(s));
}
if (existsSync(join(repo, "functions/api/_ro_bucket.js"))) {
  const s = read("functions/api/_ro_bucket.js");
  check("_ro_bucket.js: imports nothing, no fetch, no Proxy", !/^\s*import\b/m.test(s) && !/fetch\s*\(/.test(s) && !/new\s+Proxy/.test(s));
}

// ── public-repo hygiene on the rehearsal's own files ───────────────────────
// Email-shaped strings in the rehearsal's files must be synthetic
// (@example.com), or the shipped business address the mail mirror reproduces
// verbatim.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
for (const p of own) {
  const s = read(p);
  const emails = (s.match(EMAIL) || []).filter((e) => !/@example\.com$/i.test(e) && e !== "leads@masspermits.com");
  check(`only synthetic email addresses in ${p}`, emails.length === 0, emails.length + " non-synthetic");
  const hex = s.match(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/g) || [];
  check(`no 32-hex literal in ${p}`, hex.length === 0, hex.length);
  const cus = (s.match(/cus_[A-Za-z0-9]+/g) || []).filter((c) => !c.startsWith("cus_TEST"));
  check(`only cus_TEST customer ids in ${p}`, cus.length === 0, cus.length);
  check(`no secret-shaped strings in ${p}`, !/(sk|rk)_live_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}/.test(s));
}

done();
