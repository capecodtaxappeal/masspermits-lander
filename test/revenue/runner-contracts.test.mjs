import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, symlinkSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, relative, isAbsolute, sep, dirname } from "node:path";
import { inspectScratch, prepareScratch, resolveScratch, scratchPath } from "../harness/scratch.mjs";
import { REPO, loadHandlers } from "../harness/index.mjs";

// Every subprocess owns a different source root and therefore a different
// scratch hash. It must never contend with the runner executing this file.
const runtime = resolve(REPO, "test/harness/.runtime/runner-contracts");
const ownedProbeLayouts = [];
const parentLayout = inspectScratch(REPO);
const env = {
  REVENUE_SOURCE_ROOT: "SYNTHETIC_FORBIDDEN_SOURCE_TEST",
  STRIPE_SECRET_KEY: "SYNTHETIC_FORBIDDEN_KEY_TEST",
  TEMP: "SYNTHETIC_FORBIDDEN_TEMP_TEST",
  TMP: "SYNTHETIC_FORBIDDEN_TEMP_TEST",
  TMPDIR: "SYNTHETIC_FORBIDDEN_TEMP_TEST",
};
for (const name of ["SystemRoot", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC"])
  if (process.env[name]) env[name] = process.env[name];

function fixtureRoot(minLength = 0) {
  let path = resolve(runtime, randomUUID().slice(0, 8) + "_TEST");
  if (path.length < minLength) path = resolve(path, "x".repeat(Math.max(1, minLength - path.length - 1)));
  mkdirSync(path, { recursive: true });
  return path;
}

function copyRunner(root = fixtureRoot()) {
  const harness = resolve(root, "test/harness");
  mkdirSync(harness, { recursive: true });
  for (const file of ["run.mjs", "scratch.mjs"])
    copyFileSync(resolve(REPO, "test/harness", file), resolve(harness, file));
  const layout = inspectScratch(root);
  if (layout.clone === parentLayout.clone) ownedProbeLayouts.push(layout);
  return { root, harness, runner: resolve(harness, "run.mjs"), scratch: layout.scratch };
}

// Reuse the guarded, exclusive cleanup path for only the derived probe hashes.
// Never sweep the shared scratch directory or remove an interrupted child's lock.
test.after(() => {
  for (const layout of ownedProbeLayouts) {
    assert.notEqual(layout.scratch, parentLayout.scratch);
    const release = prepareScratch(layout);
    release();
    rmdirSync(layout.scratch);
  }
});

function invoke(fixture, files = [], label = "probe_TEST") {
  // An unrelated working directory must not change the copied runner's root.
  return spawnSync(process.execPath, [fixture.runner, ...files, "--label", label], {
    cwd: runtime, env, encoding: "utf8", timeout: 30000, windowsHide: true,
  });
}

function runProbe(name, body, prepare) {
  const fixture = copyRunner();
  const path = resolve(fixture.root, "probe.test.mjs");
  writeFileSync(path, typeof body === "function" ? body(fixture) : body);
  if (prepare) prepare(fixture);
  return { ...invoke(fixture, [path], name), fixture };
}

function summaryOf(result) {
  assert.equal(result.error, undefined);
  return JSON.parse(result.stdout);
}

function assertPreflightRefusal(result) {
  const summary = summaryOf(result);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(summary.exit, 2);
  assert.equal(summary.childExit, null);
  assert.equal(summary.phase, "preflight");
  assert.ok(summary.layout);
  for (const key of ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"])
    assert.equal(summary.counts[key], null, key + " must not fabricate a zero count");
  assert.deepEqual(summary.failures, []);
  assert.deepEqual(summary.knownBaseline, []);
  assert.deepEqual(summary.unexpected, []);
  return summary;
}

function assertOwnScratch(fixture) {
  assert.notEqual(fixture.scratch, inspectScratch(REPO).scratch);
  const rel = relative(dirname(inspectScratch(REPO).scratch), fixture.scratch);
  assert.ok(rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

function localGit(cwd, args) {
  const gitEnv = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
  for (const name of ["SystemRoot", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC"])
    if (env[name]) gitEnv[name] = env[name];
  const result = spawnSync("git", ["-c", "core.hooksPath=", "-c", "init.templateDir=", "-c", "gc.auto=0", ...args], {
    cwd, env: gitEnv, encoding: "utf8", timeout: 30000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
}

test("harness runner confines temporary files and strips synthetic service overrides", () => {
  const result = runProbe("runner-confinement", ({ scratch }) => `
    import test from "node:test";
    import assert from "node:assert/strict";
    test("isolated child runtime", () => {
      const expected = ${JSON.stringify(scratch)};
      for (const key of ["TEMP", "TMP", "TMPDIR"]) assert.equal(process.env[key], expected);
      assert.equal(process.env.STRIPE_SECRET_KEY, undefined);
      assert.equal(process.env.REVENUE_SOURCE_ROOT, undefined);
    });
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(summary.counts.pass, 1);
  assert.equal(summary.counts.fail, 0);
  assert.equal(summary.childExit, 0);
  assert.equal(summary.layout.root, result.fixture.root);
  assert.equal(summary.layout.scratch, result.fixture.scratch);
  assert.deepEqual(summary.unexpected, []);
  assert.deepEqual(summary.staleTodos, []);
  assert.deepEqual(summary.skippedTests, []);
  const rel = relative(REPO, runtime);
  assert.ok(rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
});

test("harness runner preserves a hard test failure and redacts its address", () => {
  const result = runProbe("runner-failure", `
    import test from "node:test";
    import assert from "node:assert/strict";
    test("synthetic failure casey@example.com", () => assert.fail("expected probe failure"));
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 1);
  assert.equal(summary.childExit, 1);
  assert.equal(summary.counts.fail, 1);
  assert.deepEqual(summary.unexpected, ["synthetic failure [synthetic-address]"]);
  assert.ok(!result.stdout.includes("casey@example.com"));
});

test("harness runner counts formerly waived mission names as unexpected failures", () => {
  const name = "P1-14 the diff from main lists only allowed paths";
  const result = runProbe("runner-no-stale-waiver", `
    import test from "node:test";
    import assert from "node:assert/strict";
    test(${JSON.stringify(name)}, () => assert.fail("expected probe failure"));
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 1);
  assert.equal(summary.counts.fail, 1);
  assert.deepEqual(summary.knownBaseline, []);
  assert.deepEqual(summary.unexpected, [name]);
});

test("harness runner defaults execute all six test directories", () => {
  const fixture = copyRunner();
  const directories = ["test", "test/mission", "test/growth", "test/manual", "functions/api", "test/revenue"];
  for (const [index, directory] of directories.entries()) {
    const destination = resolve(fixture.root, directory);
    mkdirSync(destination, { recursive: true });
    writeFileSync(resolve(destination, "probe.test.mjs"), `
      import test from "node:test";
      test("default-glob-${index}", () => {});
    `);
  }
  const result = invoke(fixture);
  const summary = summaryOf(result);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(summary.counts.tests, directories.length);
  assert.equal(summary.counts.pass, directories.length);
  assert.equal(summary.counts.fail, 0);
  assert.deepEqual(summary.knownBaseline, []);
  assert.deepEqual(summary.unexpected, []);
});

test("harness source override refuses a path outside its own worktree before loading", async () => {
  await assert.rejects(loadHandlers({ sourceRoot: resolve(REPO, "..") }),
    /Source root must stay inside this worktree/);
});

test("harness scratch resolution stays in ordinary and nested worktree clone metadata", () => {
  const ordinary = resolve(REPO, "test/harness/.runtime/synthetic-clone_TEST");
  const common = resolve(ordinary, ".git");
  for (const root of [ordinary, resolve(common, "arbitrary/deep/worktree_TEST")]) {
    const rel = relative(common, scratchPath(root, common));
    assert.ok(rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
    assert.match(rel, /^codex-session-scratch[\\/][a-f0-9]{12}$/);
  }
  assert.notEqual(scratchPath(ordinary, common), scratchPath(resolve(common, "nested"), common));
  assert.throws(() => scratchPath(resolve(ordinary, ".."), common), /physical clone/);
  assert.throws(() => scratchPath(ordinary, resolve(ordinary, "other")), /common .git directory/);
});

test("harness runner fails a passing TODO while preserving the real child exit", () => {
  const result = runProbe("runner-stale-todo", `
    import test from "node:test";
    test("fixed finding_TEST", { todo: "C_TEST awaiting removal" }, () => {});
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 1);
  assert.equal(summary.exit, 1);
  assert.equal(summary.childExit, 0);
  assert.equal(summary.counts.fail, 0);
  assert.equal(summary.counts.todo, 1);
  assert.deepEqual(summary.staleTodos, ["fixed finding_TEST"]);
  assert.deepEqual(summary.unexpected, []);
});

test("harness runner fails a skipped test while preserving the real child exit", () => {
  const result = runProbe("runner-skipped", `
    import test from "node:test";
    test("unexecuted case_TEST", { skip: "synthetic skip" }, () => { throw new Error("must not run"); });
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 1);
  assert.equal(summary.exit, 1);
  assert.equal(summary.childExit, 0);
  assert.equal(summary.counts.skipped, 1);
  assert.deepEqual(summary.skippedTests, ["unexecuted case_TEST"]);
  assert.deepEqual(summary.unexpected, []);
});

test("harness runner reports full nested names for stale TODO and skipped tests", () => {
  const result = runProbe("runner-nested", `
    import { describe, test } from "node:test";
    describe("outer_TEST", () => {
      describe("inner_TEST", () => {
        test("same leaf_TEST", { todo: "C_TEST" }, () => {});
        test("skipped leaf_TEST", { skip: true }, () => {});
      });
      describe("other_TEST", () => {
        test("same leaf_TEST", { todo: "C_TEST" }, () => {});
      });
    });
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 1);
  assert.equal(summary.childExit, 0);
  assert.deepEqual(summary.staleTodos, [
    "outer_TEST > inner_TEST > same leaf_TEST",
    "outer_TEST > other_TEST > same leaf_TEST",
  ]);
  assert.deepEqual(summary.skippedTests, ["outer_TEST > inner_TEST > skipped leaf_TEST"]);
  assert.deepEqual(summary.unexpected, []);
});

test("harness runner reports genuinely failing TODO debt without inventing a failure", () => {
  const result = runProbe("runner-real-todo", `
    import test from "node:test";
    import assert from "node:assert/strict";
    test("reproduced finding_TEST", { todo: "C_TEST" }, () => assert.fail("synthetic known defect"));
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(summary.childExit, 0);
  assert.equal(summary.counts.todo, 1);
  assert.equal(summary.counts.fail, 0);
  assert.deepEqual(summary.staleTodos, []);
  assert.deepEqual(summary.failures, []);
  assert.deepEqual(summary.unexpected, []);
});

test("harness runner respects a nested suite TODO inherited by failing children", () => {
  const result = runProbe("runner-parent-todo", `
    import { describe, test } from "node:test";
    import assert from "node:assert/strict";
    describe("known suite_TEST", { todo: "C_TEST" }, () => {
      test("reproduced child_TEST", () => assert.fail("synthetic known defect"));
    });
  `);
  const summary = summaryOf(result);
  assert.equal(summary.childExit, 0, result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(summary.counts.fail, 0);
  assert.deepEqual(summary.staleTodos, []);
  assert.deepEqual(summary.failures, []);
  assert.deepEqual(summary.unexpected, []);
});

test("harness runner never treats a literal TODO marker in a name as a waiver", () => {
  const result = runProbe("runner-literal-todo", `
    import test from "node:test";
    import assert from "node:assert/strict";
    test("literal # TODO is only a name_TEST", () => assert.fail("ordinary failure"));
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 1);
  assert.equal(summary.childExit, 1);
  assert.equal(summary.counts.fail, 1);
  assert.deepEqual(summary.staleTodos, []);
  assert.deepEqual(summary.unexpected, ["literal # TODO is only a name_TEST"]);
});

test("harness runner keeps duplicate suite names separate when only one is TODO", () => {
  const result = runProbe("runner-duplicate-suite", `
    import { describe, test } from "node:test";
    import assert from "node:assert/strict";
    describe("same suite_TEST", { todo: "C_TEST" }, () => {
      test("same child_TEST", () => assert.fail("known defect"));
    });
    describe("same suite_TEST", () => {
      test("same child_TEST", () => assert.fail("new defect"));
    });
  `);
  const summary = summaryOf(result);
  assert.equal(result.status, 1);
  assert.equal(summary.childExit, 1);
  assert.equal(summary.counts.fail, 1);
  assert.ok(summary.unexpected.includes("same suite_TEST > same child_TEST"));
  assert.equal(summary.unexpected.filter((name) => name === "same suite_TEST > same child_TEST").length, 1);
});

test("harness runner refuses ordinary checkout before executing a test", () => {
  const clone = fixtureRoot();
  localGit(clone, ["init", "--quiet"]);
  const fixture = copyRunner(clone);
  const sentinel = resolve(clone, "executed_TEST");
  const path = resolve(clone, "probe.test.mjs");
  writeFileSync(path, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "unexpected execution");`);
  const summary = assertPreflightRefusal(invoke(fixture, [path]));
  assert.equal(summary.layout.kind, "ordinary-checkout");
  assert.match(summary.error, /ordinary|inside.*source|inside.*root/i);
  assert.equal(existsSync(sentinel), false);
  assert.equal(existsSync(fixture.scratch), false);
});

test("harness runner refuses an overbudget clone before executing a test", () => {
  const clone = fixtureRoot(160);
  assert.ok(clone.length >= 160);
  localGit(clone, ["init", "--quiet"]);
  localGit(clone, ["-c", "user.name=Synthetic Test", "-c", "user.email=casey@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "synthetic_TEST"]);
  const root = resolve(clone, ".git/w_TEST");
  localGit(clone, ["worktree", "add", "--quiet", "--detach", root]);
  const fixture = copyRunner(root);
  const sentinel = resolve(root, "executed_TEST");
  const path = resolve(root, "probe.test.mjs");
  writeFileSync(path, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "unexpected execution");`);
  const summary = assertPreflightRefusal(invoke(fixture, [path]));
  assert.equal(summary.layout.kind, "linked-worktree");
  assert.ok(summary.layout.scratchLength > summary.layout.scratchBudget);
  assert.match(summary.error, /budget|length|too long/i);
  assert.equal(existsSync(sentinel), false);
  assert.equal(existsSync(fixture.scratch), false);
});

test("harness runner clears old own scratch contents and preserves neighboring scratch", () => {
  let ownLeftover, neighborSentinel;
  const result = runProbe("runner-cleanup", `
    import test from "node:test";
    import assert from "node:assert/strict";
    import { readdirSync } from "node:fs";
    test("starts empty_TEST", () => assert.deepEqual(readdirSync(process.env.TEMP), []));
  `, (fixture) => {
    assertOwnScratch(fixture);
    mkdirSync(resolve(fixture.scratch, "abandoned_TEST"), { recursive: true });
    ownLeftover = resolve(fixture.scratch, "abandoned_TEST/old_TEST");
    writeFileSync(ownLeftover, "leftover_TEST");
    const neighbor = fixture.scratch + "-neighbor_TEST";
    mkdirSync(neighbor, { recursive: true });
    neighborSentinel = resolve(neighbor, "sentinel_TEST");
    writeFileSync(neighborSentinel, "neighbor stays_TEST");
  });
  try {
    const summary = summaryOf(result);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(summary.counts.pass, 1);
    assert.equal(existsSync(ownLeftover), false);
    assert.equal(readFileSync(neighborSentinel, "utf8"), "neighbor stays_TEST");
    assert.equal(existsSync(result.fixture.scratch + ".lock"), false);
  } finally { unlinkSync(neighborSentinel); rmdirSync(dirname(neighborSentinel)); }
});

test("harness runner refuses a held scratch lock without removing another run's files", () => {
  const fixture = copyRunner();
  assertOwnScratch(fixture);
  mkdirSync(fixture.scratch, { recursive: true });
  const sentinel = resolve(fixture.scratch, "active_TEST");
  const lock = fixture.scratch + ".lock";
  writeFileSync(sentinel, "owned by another run_TEST");
  writeFileSync(lock, "synthetic held lock_TEST", { flag: "wx" });
  try {
    const summary = assertPreflightRefusal(invoke(fixture));
    assert.match(summary.error, /lock|already.*running|in use/i);
    assert.equal(readFileSync(sentinel, "utf8"), "owned by another run_TEST");
    assert.equal(readFileSync(lock, "utf8"), "synthetic held lock_TEST");
  } finally { unlinkSync(lock); }
});

test("harness runner leaves mutation scratch untouched while resetting its own scratch", () => {
  const fixture = copyRunner();
  assertOwnScratch(fixture);
  const legacy = resolveScratch(fixture.root);
  assert.notEqual(legacy, fixture.scratch);
  mkdirSync(legacy, { recursive: true });
  const sentinel = resolve(legacy, "mutation-owned_TEST");
  writeFileSync(sentinel, "legacy mutation run stays_TEST");
  const path = resolve(fixture.root, "probe.test.mjs");
  writeFileSync(path, 'import test from "node:test"; test("normal_TEST", () => {});');
  try {
    const result = invoke(fixture, [path]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(summaryOf(result).counts.pass, 1);
    assert.equal(readFileSync(sentinel, "utf8"), "legacy mutation run stays_TEST");
  } finally { unlinkSync(sentinel); rmdirSync(legacy); }
});

test("harness runner refuses a junction report directory without writing into its target", () => {
  const fixture = copyRunner();
  const target = resolve(fixture.root, "report-target_TEST");
  mkdirSync(target, { recursive: true });
  const sentinel = resolve(target, "last-summary.json");
  writeFileSync(sentinel, "report target stays_TEST");
  const link = resolve(fixture.harness, ".runtime");
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  try {
    const summary = assertPreflightRefusal(invoke(fixture));
    assert.match(summary.error, /junction|symbolic|symlink|link/i);
    assert.equal(readFileSync(sentinel, "utf8"), "report target stays_TEST");
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally { unlinkSync(link); }
});

for (const name of ["last.tap.txt", "last-summary.json", "probe_TEST.tap.txt", "probe_TEST-summary.json"]) {
  test("harness runner refuses a report file symlink at " + name + " before overwriting its target", () => {
    const fixture = copyRunner();
    const output = resolve(fixture.harness, ".runtime");
    mkdirSync(output, { recursive: true });
    const target = resolve(fixture.root, "report-file-target_TEST");
    writeFileSync(target, "report file target stays_TEST");
    const link = resolve(output, name);
    symlinkSync(target, link, "file");
    try {
      const summary = assertPreflightRefusal(invoke(fixture));
      assert.match(summary.error, /junction|symbolic|symlink|link/i);
      assert.equal(readFileSync(target, "utf8"), "report file target stays_TEST");
      assert.equal(lstatSync(link).isSymbolicLink(), true);
    } finally { unlinkSync(link); }
  });
}

for (const where of ["scratch root", "scratch descendant"]) {
  test("harness runner refuses a junction at " + where + " without deleting its target", () => {
    const fixture = copyRunner();
    assertOwnScratch(fixture);
    const target = resolve(fixture.root, "junction-target_TEST");
    mkdirSync(target, { recursive: true });
    const sentinel = resolve(target, "sentinel_TEST");
    writeFileSync(sentinel, "junction target stays_TEST");
    const link = where === "scratch root" ? fixture.scratch : resolve(fixture.scratch, "redirect_TEST");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    try {
      const summary = assertPreflightRefusal(invoke(fixture));
      assert.match(summary.error, /junction|symbolic|symlink|link/i);
      assert.equal(readFileSync(sentinel, "utf8"), "junction target stays_TEST");
      assert.equal(lstatSync(link).isSymbolicLink(), true);
      assert.equal(existsSync(fixture.scratch + ".lock"), false);
    } finally { unlinkSync(link); }
  });
}
