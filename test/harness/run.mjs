// Executes offline tests without reading service credentials or writing outside the clone.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const clone = resolve(root, "../../..");
const temp = resolve(clone, ".git/codex-session-scratch/revenue-continuous");
const output = resolve(root, "test/harness/.runtime");
mkdirSync(temp, { recursive: true });
mkdirSync(output, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp,
  GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
for (const key of ["NODE_OPTIONS","NODE_PATH","HEALTH_JS","HEALTH_DUMP","MISSION_DEMO_OUT",
  "MISSION_ORACLE_LOG","MISSION_ORACLE_OFF","MISSION_TABLE","MASSPERMITS_STRIPE_READ_ONLY_KEY",
  "STRIPE_SECRET_KEY","STRIPE_API_KEY","STRIPE_WEBHOOK_SECRET","CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN","RESEND_API_KEY"]) delete env[key];
const files = process.argv.slice(2);
const args = ["--test", "--test-reporter=tap", ...(files.length ? files :
  ["test/*.test.mjs","test/mission/*.test.mjs","functions/api/*.test.mjs","test/revenue/*.test.mjs"])];
const child = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024, timeout: 180_000, windowsHide: true });
const redact = (s) => String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-address]");
const text = redact(child.stdout) + redact(child.stderr);
const counts = {};
for (const name of ["tests","suites","pass","fail","cancelled","skipped","todo"]) {
  const matches = [...text.matchAll(new RegExp("^# " + name + " (\\d+)$", "gm"))];
  counts[name] = matches.length ? Number(matches.at(-1)[1]) : null;
}
const failures = [...text.matchAll(/^not ok \d+ - (.+)$/gm)]
  .map((m) => m[1]).filter((name) => !name.includes("# TODO"));
const knownNames = [
  "P1-14 the diff from main lists only allowed paths",
  "P2-5 _headers gains exactly the /admin/mission block, outside the widget block",
  "P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/",
  "P1-14 route strings never appear in non-test added files",
];
const summary = { at: new Date().toISOString(), node: process.version, command: ["node", ...args].join(" "),
  exit: child.status, signal: child.signal, counts, failures,
  knownBaseline: failures.filter((x) => knownNames.includes(x)),
  unexpected: failures.filter((x) => !knownNames.includes(x)), error: child.error?.message || null };
writeFileSync(resolve(output, "last.tap.txt"), text);
writeFileSync(resolve(output, "last-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
process.exitCode = child.status ?? 1;
