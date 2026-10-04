// MassPermits monday rehearsal: the mirror step (Node built-ins only; no
// network).
//
//   node scripts/rehearsal/mirror.mjs > mirror.json
//
// Prints one line of JSON with enums and booleans only:
//   mirror            ok|drift|error  the weekly mail mirror: runs
//                     functions/api/rehearsal_mirror.test.mjs (the SHIPPED
//                     weekly-send.js in a temp copy, its Resend bodies against
//                     renderWeekly for synthetic subscribers)
//   c17.inbox_mirror  ok|drift|error  runs functions/api/inbox_mirror.test.mjs
//                     (the SHIPPED inbox-status.js against inboxVerdict)
//   purchase.*        the purchase-email render: runs
//                     functions/api/purchase_render.test.mjs (the SHIPPED
//                     stripe-webhook.js, a synthetic signed checkout)
//   c8.min_cents      N from the single line "const MIN_CENTS = N;" in
//                     functions/api/stripe-webhook.js, read as TEXT; -1 unless
//                     exactly one
//   c8.events_mirror  ok|drift|error  the string literals compared with
//                     `event.type ===` in that file, against HANDLED_EVENTS
// The three tests run in child processes; each installs its own throwing
// fetch stub, so none of them can reach the network or send mail.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDLED_EVENTS } from "../../functions/api/_rehearsal.js";

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Run one test file; ok if it exits 0, drift if it ran and reported
// failures, error if it did not run to its RESULT line.
export function runTest(rel, root = REPO_ROOT) {
  const r = spawnSync(process.execPath, [join(root, rel)], { cwd: root, encoding: "utf8", timeout: 180_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/^RESULT \S+ pass=(\d+) fail=(\d+)$/m);
  const state = r.status === 0 && m && m[2] === "0" ? "ok" : m && m[2] !== "0" ? "drift" : "error";
  return { state, out };
}

// c8 facts from stripe-webhook.js read as text.
export function c8Facts(path = join(REPO_ROOT, "functions", "api", "stripe-webhook.js")) {
  let src;
  try { src = readFileSync(path, "utf8").replace(/\r\n/g, "\n"); } catch { return { min_cents: -1, events_mirror: "error" }; }
  const mins = [...src.matchAll(/^\s*const MIN_CENTS = (\d+);\s*$/gm)];
  const n = mins.length === 1 ? Number(mins[0][1]) : -1;
  const lits = new Set([...src.matchAll(/event\.type\s*===\s*(["'])([^"'\n]+)\1/g)].map((m) => m[2]));
  const want = new Set(HANDLED_EVENTS);
  const same = lits.size === want.size && [...want].every((e) => lits.has(e));
  return { min_cents: Number.isInteger(n) && n >= 0 && n <= 100000 ? n : -1, events_mirror: same ? "ok" : "drift" };
}

// purchase.* from purchase_render.test.mjs's PURCHASE line.
export function purchaseFacts(run) {
  const m = run.out.match(/^PURCHASE facts \(shipped stripe-webhook\.js\): render=(\w+) link_first=(true|false) month_line=(true|false)$/m);
  if (run.state !== "ok" || !m || m[1] !== "ok") return { render: "error" };
  return { render: "ok", link_first: m[2] === "true", month_line: m[3] === "true" };
}

export function mirrorFacts(root = REPO_ROOT) {
  const mail = runTest("functions/api/rehearsal_mirror.test.mjs", root);
  const inbox = runTest("functions/api/inbox_mirror.test.mjs", root);
  const inboxState = inbox.state === "ok" && /^INBOX mirror: ok$/m.test(inbox.out) ? "ok"
    : /^INBOX mirror: drift$/m.test(inbox.out) || inbox.state === "drift" ? "drift" : "error";
  const purchase = purchaseFacts(runTest("functions/api/purchase_render.test.mjs", root));
  return {
    mirror: mail.state,
    purchase,
    c8: c8Facts(join(root, "functions", "api", "stripe-webhook.js")),
    c17: { inbox_mirror: inboxState },
  };
}

export function main() {
  const f = mirrorFacts();
  console.log(JSON.stringify(f));
  return f;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) main();
