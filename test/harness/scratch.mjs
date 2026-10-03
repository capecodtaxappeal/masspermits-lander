import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute, sep, basename, dirname } from "node:path";

// Read only runtime lookup settings. Do not enumerate or copy service variables.
export function runtimeEnvironment() {
  const env = { GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const name of ["SystemRoot", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC"])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}

export function scratchPath(root, commonDir) {
  const common = resolve(root, commonDir);
  if (basename(common) !== ".git") throw new Error("Expected the clone's common .git directory");
  const clone = dirname(common), rel = relative(clone, root);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Worktree must stay inside its physical clone");
  const id = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return resolve(common, "codex-session-scratch", id);
}

export function resolveScratch(root) {
  const result = spawnSync("git", ["-c", "core.excludesFile=", "rev-parse", "--git-common-dir"], {
    cwd: root, env: runtimeEnvironment(), encoding: "utf8", timeout: 10000, windowsHide: true,
  });
  if (result.status !== 0 || result.error) throw new Error("Cannot resolve local clone scratch directory");
  return scratchPath(root, result.stdout.trim());
}
