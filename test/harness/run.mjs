// Executes offline tests without reading service credentials or writing outside the clone.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveScratch, runtimeEnvironment } from "./scratch.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temp = resolveScratch(root);
const output = resolve(root, "test/harness/.runtime");
mkdirSync(temp, { recursive: true });
mkdirSync(output, { recursive: true });
const env = { ...runtimeEnvironment(), TEMP: temp, TMP: temp, TMPDIR: temp };
const files = process.argv.slice(2);
const labelAt = files.indexOf("--label");
let label = null;
if (labelAt >= 0) {
  label = files[labelAt + 1];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label || "")) throw new Error("Invalid local report label");
  files.splice(labelAt, 2);
  if (files.includes("--label")) throw new Error("Duplicate report label");
}
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
if (label) {
  writeFileSync(resolve(output, label + ".tap.txt"), text);
  writeFileSync(resolve(output, label + "-summary.json"), JSON.stringify(summary, null, 2) + "\n");
}
console.log(JSON.stringify(summary, null, 2));
process.exitCode = child.status ?? 1;
