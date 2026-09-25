// Runs every rehearsal-era test, each in its own Node process (so a fetch stub,
// a JWKS cache or a module cache in one file can never leak into another), and
// prints per-file pass counts.
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
// The pre-send gate replay (taken unchanged from claude/seed-rehearsal-inputs).
// Never with --live.
files.push(join(repo, "scripts", "rehearsal", "presend_replay.mjs"));

const rows = [];
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [f], { cwd: repo, encoding: "utf8", timeout: 120_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  let pass = null, fail = null;
  const m = out.match(/^RESULT \S+ pass=(\d+) fail=(\d+)$/m);
  if (m) { pass = +m[1]; fail = +m[2]; }
  else {
    // Files that predate the shared runner print their own "ok"/"FAIL" lines.
    pass = (out.match(/^\s+ok\s/gm) || []).length;
    fail = (out.match(/^\s+FAIL\s/gm) || []).length;
  }
  const ok = r.status === 0 && fail === 0;
  if (!ok) {
    bad++;
    console.log(`\n--- ${basename(f)} (exit ${r.status}) ---\n${out}`);
  }
  rows.push([basename(f), pass, fail, ok ? "PASS" : "FAIL"]);
}

console.log("\nfile                                   pass  fail  result");
for (const [f, p, x, s] of rows) {
  console.log(`${f.padEnd(38)} ${String(p).padStart(4)}  ${String(x).padStart(4)}  ${s}`);
}
console.log(bad ? `\n${bad} file(s) FAILED` : "\nall files passed");
process.exitCode = bad ? 1 : 0;
