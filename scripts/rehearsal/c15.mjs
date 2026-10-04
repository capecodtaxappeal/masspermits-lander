// MassPermits monday rehearsal: C15, the runner's static half (Node built-ins
// only, no network).
//
//   node scripts/rehearsal/c15.mjs > "$RUNNER_TEMP/c15.json"
//
// Scans the checkout of main (the runner checks out main, never the triggering
// head) and prints ONE line of JSON, counts and booleans only:
//   {"c15":{"secrets":N,"workflow_tokens":N,"private_files":N,"ignore_missing":N,"route_home":bool}}
// Nothing it finds is printed: no path, no line, no value.
//
//   secrets          credential-shaped strings in any file of the checkout
//                    (Stripe live secret and restricted keys, webhook signing
//                    secrets, Resend keys, GitHub tokens, private-key blocks,
//                    AWS and Google keys). The repo is public AND the site is
//                    served from its root, so any hit is published twice.
//   workflow_tokens  hard-coded tokens in .github/workflows/*: a hex run of 32
//                    or more, a literal Bearer value, or any secrets pattern.
//                    Excepted: a hex run right after "@" (a pinned action SHA)
//                    and a key that the site root already publishes as
//                    <key>.txt holding exactly that key (the IndexNow protocol
//                    requires that key to be public).
//   private_files    files in the checkout whose name .gitignore reserves for
//                    R2 money-path objects or the engine (subscribers.json,
//                    feed-send-log.json, engine.tar.gz, a .zip bundle, ...).
//   ignore_missing   how many of the required .gitignore lines are absent.
//   route_home       index.html, outside comments, scripts and styles, still
//                    tells an existing subscriber where their leads are
//                    ("already subscribed", "my leads", "sign in" or "log in";
//                    see the "NO ROUTE HOME" comment in index.html).
// A scan that fails prints -1 everywhere and route_home false.

import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve as resolvePath, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_FILE = 5 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", ".wrangler"]);

// Credential shapes. Each is specific enough that documentation and code
// mentioning a key TYPE ("sk_live_", "whsec_") do not match.
export const SECRET_PATTERNS = [
  /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g,
  /\bwhsec_[A-Za-z0-9+/=]{24,}/g,
  /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
];
export function countSecrets(text) {
  let n = 0;
  for (const re of SECRET_PATTERNS) n += (String(text).match(re) || []).length;
  return n;
}

// Hard-coded tokens in one workflow file. publicKeys: keys the site root
// publishes on purpose (IndexNow).
export function countWorkflowTokens(text, publicKeys = new Set()) {
  const s = String(text);
  let n = countSecrets(s);
  for (const m of s.matchAll(/(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g)) {
    if (s[m.index - 1] === "@") continue;
    if (publicKeys.has(m[0].toLowerCase())) continue;
    n++;
  }
  for (const m of s.matchAll(/\bbearer\s+([^\s"'$\\]{16,})/gi)) {
    if (!/^[0-9a-fA-F]{32,}$/.test(m[1])) n++; // a hex value is counted above
  }
  return n;
}

// Names .gitignore reserves for R2 money-path objects, the engine and bundles.
export const PRIVATE_NAMES = ["subscribers.json", "delivery-log.json", "feed-send-log.json",
  "last-send-attempt.json", "engagement.json", "actionability.json", "engine.tar.gz",
  "latest-weekly.html", "latest-monthly.html"];
export const isPrivateFile = (rel) => {
  const name = basename(rel);
  return PRIVATE_NAMES.includes(name) || /\.zip$/i.test(name) || /^MassPermits-.*\.(html|csv)$/.test(name);
};

// The .gitignore lines that keep subscriber data, secrets and the engine out
// of this public repo. Each must appear as its own line.
export const REQUIRED_IGNORES = [".env*", ".wrangler/", "*.zip", "subscribers.json", "delivery-log.json",
  "feed-send-log.json", "last-send-attempt.json", "engagement.json", "engine.tar.gz", "actionability.json",
  "latest-weekly.html", "latest-monthly.html"];
export function ignoreMissing(text) {
  if (typeof text !== "string") return REQUIRED_IGNORES.length;
  const lines = new Set(text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  return REQUIRED_IGNORES.filter((r) => !lines.has(r)).length;
}

const ROUTE_HOME = /already (?:a )?subscri(?:bed|ber)|my leads|sign in|log in/;
export function hasRouteHome(html) {
  if (typeof html !== "string") return false;
  const visible = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&rsquo;|&#8217;/g, "'").replace(/\s+/g, " ").toLowerCase();
  return ROUTE_HOME.test(visible);
}

function walk(root, rel = "", out = []) {
  for (const name of readdirSync(join(root, rel))) {
    if (SKIP_DIRS.has(name)) continue;
    const r = rel ? rel + "/" + name : name;
    const st = lstatSync(join(root, r)); // a symlink is neither followed nor read
    if (st.isDirectory()) walk(root, r, out);
    else if (st.isFile()) out.push({ rel: r, size: st.size });
  }
  return out;
}
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

// scan(root) -> {c15: {...}}. root: a checkout of main.
export function scan(root = REPO_ROOT) {
  const files = walk(root);
  const read = (rel) => { try { return readFileSync(join(root, rel), "utf8"); } catch { return null; } };
  const publicKeys = new Set(files.filter((f) => !f.rel.includes("/") && /^[0-9a-f]{32}\.txt$/.test(f.rel))
    .filter((f) => (read(f.rel) || "").trim() === f.rel.slice(0, 32)).map((f) => f.rel.slice(0, 32)));
  let secrets = 0, workflowTokens = 0, privateFiles = 0;
  for (const f of files) {
    if (isPrivateFile(f.rel)) privateFiles++;
    if (f.size > MAX_FILE) continue;
    const buf = readFileSync(join(root, f.rel));
    if (!isText(buf)) continue;
    const text = buf.toString("utf8");
    secrets += countSecrets(text);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.rel)) workflowTokens += countWorkflowTokens(text, publicKeys);
  }
  const cap = (n) => Math.min(n, 100000);
  return { c15: { secrets: cap(secrets), workflow_tokens: cap(workflowTokens), private_files: cap(privateFiles),
    ignore_missing: ignoreMissing(read(".gitignore")), route_home: hasRouteHome(read("index.html")) } };
}

export const BLIND = { c15: { secrets: -1, workflow_tokens: -1, private_files: -1, ignore_missing: -1, route_home: false } };

export function main(root = REPO_ROOT) {
  let out;
  try { out = scan(root); } catch { out = BLIND; }
  console.log(JSON.stringify(out));
  return out;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) main();
