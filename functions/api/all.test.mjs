// Runs every rehearsal-era test (functions/api/*.test.mjs and
// scripts/rehearsal/*.test.mjs), each in its own Node process (so a fetch stub,
// a JWKS cache or a module cache in one file can never leak into another), and
// prints per-file pass, fail and skip counts, then every skip reason.
//
//   node functions/api/all.test.mjs
//
// Exit 0 only when every file exits 0.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const self = basename(fileURLToPath(import.meta.url));

const files = readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs") && f !== self)
  .sort()
  .map((f) => join(here, f));
// The runner job's tests (R3a) live next to the runner scripts.
const runnerDir = join(repo, "scripts", "rehearsal");
files.push(...readdirSync(runnerDir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => join(runnerDir, f)));
// The pre-send gate replay (taken unchanged from claude/seed-rehearsal-inputs).
// Never with --live.
files.push(join(repo, "scripts", "rehearsal", "presend_replay.mjs"));

const rows = [];
const skips = [];
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [f], { cwd: repo, encoding: "utf8", timeout: 120_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  let pass = null, fail = null, skip = 0;
  const m = out.match(/^RESULT \S+ pass=(\d+) fail=(\d+)(?: skip=(\d+))?$/m);
  if (m) { pass = +m[1]; fail = +m[2]; skip = m[3] ? +m[3] : 0; }
  else {
    // Files that predate the shared runner print their own "ok"/"FAIL" lines.
    pass = (out.match(/^\s+ok\s/gm) || []).length;
    fail = (out.match(/^\s+FAIL\s/gm) || []).length;
  }
  for (const s of out.matchAll(/^\s+SKIP\s+(.*)$/gm)) skips.push(`${basename(f)}: ${s[1]}`);
  const ok = r.status === 0 && fail === 0;
  if (!ok) {
    bad++;
    console.log(`\n--- ${basename(f)} (exit ${r.status}) ---\n${out}`);
  }
  rows.push([basename(f), pass, fail, skip, ok ? "PASS" : "FAIL"]);
}

console.log("\nfile                                   pass  fail  skip  result");
for (const [f, p, x, k, s] of rows) {
  console.log(`${f.padEnd(38)} ${String(p).padStart(4)}  ${String(x).padStart(4)}  ${String(k).padStart(4)}  ${s}`);
}
const skipped = skips.length ? `, ${skips.length} skipped:\n` + skips.map((s) => "  " + s).join("\n") : "";
console.log(bad ? `\n${bad} file(s) FAILED${skipped}` : `\nall files passed${skipped}`);
process.exitCode = bad ? 1 : 0;
