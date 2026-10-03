import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { resolveScratch, scratchPath } from "../harness/scratch.mjs";
import { REPO, loadHandlers } from "../harness/index.mjs";

const runtime = resolve(REPO, "test/harness/.runtime/runner-contracts");
const runner = resolve(REPO, "test/harness/run.mjs");
const env = {
  REVENUE_SOURCE_ROOT: "SYNTHETIC_FORBIDDEN_SOURCE_TEST",
  STRIPE_SECRET_KEY: "SYNTHETIC_FORBIDDEN_KEY_TEST",
  TEMP: "SYNTHETIC_FORBIDDEN_TEMP_TEST",
  TMP: "SYNTHETIC_FORBIDDEN_TEMP_TEST",
  TMPDIR: "SYNTHETIC_FORBIDDEN_TEMP_TEST",
};
for (const name of ["SystemRoot", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC"])
  if (process.env[name]) env[name] = process.env[name];

function runProbe(name, body) {
  mkdirSync(runtime, { recursive: true });
  const path = resolve(runtime, name + ".test.mjs");
  writeFileSync(path, body);
  try {
    // An unrelated working directory must not change the runner's root.
    return spawnSync(process.execPath, [runner, path, "--label", name], {
      cwd: runtime, env, encoding: "utf8", timeout: 30000, windowsHide: true,
    });
  } finally { unlinkSync(path); }
}

test("harness runner confines temporary files and strips synthetic service overrides", () => {
  const result = runProbe("runner-confinement", `
    import test from "node:test";
    import assert from "node:assert/strict";
    import { resolve } from "node:path";
    test("isolated child runtime", () => {
      const expected = ${JSON.stringify(resolveScratch(REPO))};
      for (const key of ["TEMP", "TMP", "TMPDIR"]) assert.equal(process.env[key], expected);
      assert.equal(process.env.STRIPE_SECRET_KEY, undefined);
      assert.equal(process.env.REVENUE_SOURCE_ROOT, undefined);
    });
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.counts.pass, 1);
  assert.equal(summary.counts.fail, 0);
  assert.deepEqual(summary.unexpected, []);
  const rel = relative(REPO, runtime);
  assert.ok(rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
});

test("harness runner preserves a hard test failure and redacts its address", () => {
  const result = runProbe("runner-failure", `
    import test from "node:test";
    import assert from "node:assert/strict";
    test("synthetic failure casey@example.com", () => assert.fail("expected probe failure"));
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const summary = JSON.parse(result.stdout);
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
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.counts.fail, 1);
  assert.deepEqual(summary.knownBaseline, []);
  assert.deepEqual(summary.unexpected, [name]);
});

test("harness runner defaults execute all six test directories", () => {
  // Use unchanged runner files in an ignored fixture tree so this contract does
  // not recursively launch the repository's entire suite. Local git metadata
  // still resolves to this physical clone; no repository or network is created.
  const fixture = resolve(runtime, "default-globs_TEST");
  const fixtureHarness = resolve(fixture, "test/harness");
  mkdirSync(fixtureHarness, { recursive: true });
  for (const file of ["run.mjs", "scratch.mjs"])
    copyFileSync(resolve(REPO, "test/harness", file), resolve(fixtureHarness, file));
  const directories = ["test", "test/mission", "test/growth", "test/manual", "functions/api", "test/revenue"];
  for (const [index, directory] of directories.entries()) {
    const destination = resolve(fixture, directory);
    mkdirSync(destination, { recursive: true });
    writeFileSync(resolve(destination, "probe.test.mjs"), `
      import test from "node:test";
      test("default-glob-${index}", () => {});
    `);
  }
  const result = spawnSync(process.execPath, [resolve(fixtureHarness, "run.mjs")], {
    cwd: runtime, env, encoding: "utf8", timeout: 30000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(result.stdout);
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
