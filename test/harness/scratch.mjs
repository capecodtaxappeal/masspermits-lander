import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute, sep, basename, dirname, join } from "node:path";

// Pinned Miniflare 4.20260730.0 / workerd 1.20260730.1 measurements:
// deepest live R2 suffix 147 chars (sqlite-shm / sqlite-wal).
// 259 - 147 - 8 safety chars = 104. Apply this portable budget everywhere.
export const SCRATCH_PATH_BUDGET = 104;

// Read only runtime lookup settings. Do not enumerate or copy service variables.
export function runtimeEnvironment() {
  const env = { GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const name of ["SystemRoot", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC"])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

export function scratchPath(root, commonDir) {
  root = resolve(root);
  const common = resolve(root, commonDir);
  if (basename(common) !== ".git") throw new Error("Expected the clone's common .git directory");
  const clone = dirname(common);
  if (!within(clone, root)) throw new Error("Worktree must stay inside its physical clone");
  const id = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return resolve(common, "codex-session-scratch", id);
}

function commonDirectory(root) {
  const result = spawnSync("git", ["-c", "core.excludesFile=", "rev-parse", "--git-common-dir"], {
    cwd: root, env: runtimeEnvironment(), encoding: "utf8", timeout: 10000, windowsHide: true,
  });
  if (result.status !== 0 || result.error) throw new Error("Cannot resolve local clone scratch directory");
  return resolve(root, result.stdout.trim());
}

export function resolveScratch(root) {
  return scratchPath(root, commonDirectory(root));
}

export function runnerScratchPath(root, commonDir) {
  const legacy = scratchPath(root, commonDir);
  const id = createHash("sha256").update("runner-v3\0" + resolve(root)).digest("hex").slice(0, 12);
  const scratch = resolve(dirname(legacy), id);
  if (scratch === legacy) throw new Error("Runner scratch must differ from legacy tool scratch");
  return scratch;
}

export function inspectScratch(root) {
  root = resolve(root);
  const commonDir = commonDirectory(root), clone = dirname(commonDir);
  const scratch = runnerScratchPath(root, commonDir);
  const canonicalScratch = resolve(realpathSync(commonDir), relative(commonDir, scratch));
  return {
    kind: relative(clone, root) === "" ? "ordinary-checkout" : "linked-worktree",
    root, clone, commonDir, scratch,
    scratchLength: scratch.length, canonicalScratch, canonicalScratchLength: canonicalScratch.length,
    scratchBudget: SCRATCH_PATH_BUDGET,
  };
}

function refuse(message, layout) {
  const error = new Error(message);
  error.layout = layout;
  throw error;
}

export function validateScratchLayout(layout) {
  const { root, commonDir, clone, scratch } = layout;
  if (clone !== dirname(commonDir) || scratch !== runnerScratchPath(root, commonDir) || !within(clone, scratch))
    refuse("Scratch does not match this clone's owned scratch directory.", layout);
  if (within(root, scratch))
    refuse("Unsupported layout: scratch is inside the worktree root. Use a linked worktree inside the physical clone; ordinary checkouts conflict with the P3-2 contract.", layout);
  const measuredLength = Math.max(scratch.length, layout.canonicalScratchLength || 0);
  if (measuredLength > SCRATCH_PATH_BUDGET)
    refuse("Unsupported layout: scratch path length " + measuredLength + " exceeds the portable budget of " + SCRATCH_PATH_BUDGET + ". Use a shorter physical clone path and a linked worktree inside it.", layout);
}

// Refuse links before cleanup, including directory junctions. Validate every
// existing ancestor and every descendant; never recurse through a link.
function noLinkedAncestors(clone, target) {
  if (!within(clone, target)) throw new Error("Cleanup path escaped the physical clone");
  const canonicalClone = realpathSync(clone);
  let current = clone;
  for (const part of ["", ...relative(clone, target).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    if (!existsSync(current)) {
      // lstat also catches a dangling symlink, which existsSync reports false.
      try { if (lstatSync(current).isSymbolicLink()) throw new Error("Scratch path contains a symbolic link or junction"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      continue;
    }
    if (lstatSync(current).isSymbolicLink() || !within(canonicalClone, realpathSync(current)))
      throw new Error("Scratch path contains a symbolic link or junction");
  }
}

export function validateReportPath(layout, target) {
  if (!layout || !within(layout.root, target) || !within(layout.clone, layout.root))
    throw new Error("Report path is not confined to the worktree");
  noLinkedAncestors(layout.clone, layout.root);
  noLinkedAncestors(layout.clone, target);
}

function noLinkedDescendants(target) {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error("Scratch contains a symbolic link or junction; nothing was removed");
  if (stat.isDirectory()) {
    for (const name of readdirSync(target)) noLinkedDescendants(join(target, name));
  }
}

// A sibling lock survives scratch cleanup. Never remove an existing lock:
// an active runner or a crashed runner needs operator review, not a guess.
export function prepareScratch(layout) {
  validateScratchLayout(layout);
  noLinkedAncestors(layout.clone, layout.root);
  noLinkedAncestors(layout.clone, layout.commonDir);
  noLinkedAncestors(layout.clone, layout.scratch);
  const parent = dirname(layout.scratch), lock = layout.scratch + ".lock";
  noLinkedAncestors(layout.clone, lock);
  mkdirSync(parent, { recursive: true });
  const token = randomUUID();
  let fd;
  try { fd = openSync(lock, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST")
      refuse("Scratch is locked by an active or interrupted runner. No files were removed. Verify no runner is active before manually removing this worktree's lock: " + lock, layout);
    throw error;
  }
  let open = true;
  const release = ({ retain = false } = {}) => {
    if (open) { closeSync(fd); open = false; }
    if (retain) return;
    noLinkedAncestors(layout.clone, lock);
    const saved = JSON.parse(readFileSync(lock, "utf8"));
    if (saved.token !== token) throw new Error("Scratch lock ownership changed; lock was not removed");
    unlinkSync(lock);
  };
  try {
    writeFileSync(fd, JSON.stringify({ token, pid: process.pid, root: layout.root }) + "\n");
    if (existsSync(layout.scratch)) {
      noLinkedDescendants(layout.scratch);
      // The absolute target was derived from the clone and checked above. Only
      // this source root's hash is removed, never the parent or sibling hashes.
      rmSync(layout.scratch, { recursive: true, force: false });
    }
    mkdirSync(layout.scratch);
    return release;
  } catch (error) {
    try { release(); } catch (releaseError) { error.message += "; lock release failed: " + releaseError.message; }
    throw error;
  }
}
