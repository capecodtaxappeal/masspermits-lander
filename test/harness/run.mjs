// Executes offline tests without reading service credentials or writing outside the clone.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectScratch, prepareScratch, runtimeEnvironment, validateScratchLayout, validateReportPath } from "./scratch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "test/harness/.runtime");
const files = process.argv.slice(2);
const labelAt = files.indexOf("--label");
let label = null;
if (labelAt >= 0) {
  label = files[labelAt + 1];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label || "")) throw new Error("Invalid local report label");
  files.splice(labelAt, 2);
  if (files.includes("--label")) throw new Error("Duplicate report label");
}
const reportFiles = ["last.tap.txt", "last-summary.json", ...(label ? [label + ".tap.txt", label + "-summary.json"] : [])];
function validateReports(layout) {
  validateReportPath(layout, output);
  for (const name of reportFiles) validateReportPath(layout, resolve(output, name));
}
const args = ["--test", "--test-reporter=tap", ...(files.length ? files :
  ["test/*.test.mjs","test/mission/*.test.mjs","test/growth/*.test.mjs","test/manual/*.test.mjs",
    "functions/api/*.test.mjs","test/revenue/*.test.mjs"])];
const redact = (s) => String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-address]");
const countNames = ["tests","suites","pass","fail","cancelled","skipped","todo"];
const emptyCounts = () => Object.fromEntries(countNames.map(name => [name, null]));
function report(summary, text = "") {
  try {
    validateReports(summary.layout);
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, "last.tap.txt"), text);
    writeFileSync(resolve(output, "last-summary.json"), JSON.stringify(summary, null, 2) + "\n");
    if (label) {
      writeFileSync(resolve(output, label + ".tap.txt"), text);
      writeFileSync(resolve(output, label + "-summary.json"), JSON.stringify(summary, null, 2) + "\n");
    }
  } catch (error) {
    summary.reportError = redact(error.message);
    if (summary.exit === 0) summary.exit = 1;
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.exit;
}
const base = { at: new Date().toISOString(), node: process.version, command: ["node", ...args].join(" ") };
let layout = null, release = null;
try {
  layout = inspectScratch(root);
  validateScratchLayout(layout);
  validateReports(layout);
  release = prepareScratch(layout);
} catch (error) {
  report({ ...base, phase: "preflight", layout: error.layout || layout, exit: 2, childExit: null,
    signal: null, counts: emptyCounts(), failures: [], knownBaseline: [], unexpected: [],
    staleTodos: [], skippedTests: [], error: redact(error.message) });
}
if (release) {
  let child, cleanupError = null;
  try {
    const env = { ...runtimeEnvironment(), TEMP: layout.scratch, TMP: layout.scratch, TMPDIR: layout.scratch };
    child = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024, timeout: 180_000, windowsHide: true });
  } catch (error) {
    child = { status: null, signal: null, error, stdout: "", stderr: "" };
  } finally {
    const interrupted = child.status === null || !!child.signal;
    try {
      release({ retain: interrupted });
      if (interrupted) cleanupError = "Test runner interrupted; scratch lock retained until an operator verifies no child process remains.";
    } catch (error) { cleanupError = redact(error.message); }
  }
  const text = redact(child.stdout) + redact(child.stderr);
  const counts = emptyCounts();
  for (const name of countNames) {
    const matches = [...text.matchAll(new RegExp("^# " + name + " (\\d+)$", "gm"))];
    counts[name] = matches.length ? Number(matches.at(-1)[1]) : null;
  }

  // Parent TODO directives arrive after their children, so classify only after
  // the complete hierarchy is collected. Escaped name text is not a directive.
  const active = new Map(), outcomes = [];
  const parentAt = depth => [...active.entries()].filter(([d]) => d < depth).sort((a,b) => b[0]-a[0])[0]?.[1] || null;
  for (const line of text.split(/\r?\n/)) {
    const subtest = line.match(/^(\s*)# Subtest: (.*)$/);
    if (subtest) {
      const depth = subtest[1].length;
      for (const d of active.keys()) if (d >= depth) active.delete(d);
      active.set(depth, { name: subtest[2], parent: parentAt(depth) });
      continue;
    }
    const result = line.match(/^(\s*)(not ok|ok) \d+ - (.*)$/);
    if (!result) continue;
    const depth = result[1].length;
    const directive = result[3].match(/ (?<!\\)# (TODO|SKIP)(?:\s+.*)?$/);
    const name = directive ? result[3].slice(0, directive.index) : result[3];
    const node = active.get(depth) || { name, parent: parentAt(depth) };
    Object.assign(node, { name, ok: result[2] === "ok", directive: directive?.[1] || null });
    outcomes.push(node);
    for (const d of active.keys()) if (d >= depth) active.delete(d);
  }
  const fullName = outcome => {
    const names = [];
    for (let node = outcome; node; node = node.parent) names.unshift(node.name.replace(/\\#/g, "#"));
    return names.join(" > ");
  };
  const underTodo = outcome => {
    for (let parent = outcome.parent; parent; parent = parent.parent) if (parent.directive === "TODO") return true;
    return false;
  };
  const hasFailedDescendant = ancestor => outcomes.some(outcome => {
    if (outcome.ok) return false;
    for (let parent = outcome.parent; parent; parent = parent.parent) if (parent === ancestor) return true;
    return false;
  });
  const staleTodos = outcomes.filter(o => o.ok && o.directive === "TODO" && !hasFailedDescendant(o)).map(fullName);
  const skippedTests = outcomes.filter(o => o.directive === "SKIP").map(fullName);
  const failures = outcomes.filter(o => !o.ok && !o.directive && !underTodo(o)).map(fullName);
  const incomplete = countNames.some(name => counts[name] === null) || counts.tests === 0;
  const problems = [child.error?.message, cleanupError,
    incomplete ? "Test output is incomplete or contains no tests." : null].filter(Boolean);
  const gateFailed = incomplete || problems.length || failures.length || counts.fail > 0 ||
    counts.cancelled > 0 || counts.skipped > 0 || skippedTests.length || staleTodos.length;
  const exit = child.status === 0 ? (gateFailed ? 1 : 0) : (child.status ?? 1);
  report({ ...base, phase: "tests", layout, exit, childExit: child.status, signal: child.signal,
    counts, failures, knownBaseline: [], unexpected: failures, staleTodos, skippedTests,
    error: problems.length ? redact(problems.join("; ")) : null }, text);
}
