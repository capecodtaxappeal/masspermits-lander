// The inbox mirror drift test (runner fact c17.inbox_mirror).
//
//   node functions/api/inbox_mirror.test.mjs
//
// Copies the SHIPPED inbox-status.js byte for byte into a temp dir next to a
// stub _github-oidc.js that returns {ok:true}, runs its onRequest over fixture
// inbox-watchdog-state.json objects (one per verdict, plus the 30 h and 72 h
// boundaries), and asserts its JSON verdict equals inboxVerdict() from
// _rehearsal.js for each. scripts/rehearsal/mirror.mjs runs this file and
// reads the last line: "INBOX mirror: ok" or "INBOX mirror: drift".
// No network: inbox-status.js reads only its R2 binding (a fake here).

import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { API_DIR, makeRunner } from "../../test/rehearsal/harness.mjs";
import { installClock, HOUR, MIN } from "../../test/rehearsal/rehearsal_kit.mjs";
import { inboxVerdict } from "./_rehearsal.js";

const { check, done } = makeRunner("inbox_mirror.test.mjs");
const clock = installClock();
const now = Date.parse("2026-10-05T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

// One fixture per verdict, plus the boundaries.
const INBOX_CASES = [
  ["never: no state object", null, "never"],
  ["never: no live run", { last: { waiting: 0 } }, "never"],
  ["stale: 31h", { last_live_run_at: iso(now - 31 * HOUR), last: { waiting: 0, roster_armed: true } }, "stale"],
  ["boundary: exactly 30h is not stale", { last_live_run_at: iso(now - 30 * HOUR), last: { waiting: 0, roster_armed: true } }, "ok"],
  ["boundary: 30h plus a minute is stale", { last_live_run_at: iso(now - 30 * HOUR - MIN), last: { waiting: 0 } }, "stale"],
  ["unarmed", { last_live_run_at: iso(now - 2 * HOUR), last: { waiting: 0, roster_armed: false, safe_mode: true } }, "unarmed"],
  ["boundary: backlog at exactly 72h", { last_live_run_at: iso(now - 2 * HOUR), last: { waiting: 2, oldest_hours: 72, roster_armed: true } }, "backlog"],
  ["boundary: waiting at 71.9h", { last_live_run_at: iso(now - 2 * HOUR), last: { waiting: 1, oldest_hours: 71.9, roster_armed: true } }, "waiting"],
  ["ok", { last_live_run_at: iso(now - 2 * HOUR), last: { waiting: 0, oldest_hours: 0, roster_armed: true, roster_active: 1, roster_cancelled: 0 } }, "ok"],
];

const dir = mkdtempSync(join(tmpdir(), "mp-inbox-mirror-"));
writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
copyFileSync(join(API_DIR, "inbox-status.js"), join(dir, "inbox-status.js"));
writeFileSync(join(dir, "_github-oidc.js"), "export async function verifyGitHubOIDC() { return { ok: true }; }\n");
check("the temp inbox-status.js is byte-identical to the shipped file",
  readFileSync(join(dir, "inbox-status.js"), "utf8") === readFileSync(join(API_DIR, "inbox-status.js"), "utf8"));
const shipped = await import(pathToFileURL(join(dir, "inbox-status.js")).href);

clock.set(now);
let agree = 0;
for (const [name, state, want] of INBOX_CASES) {
  const env = { BUNDLES: { async get() { return state === null ? null : { async text() { return JSON.stringify(state); } }; } } };
  let v = null;
  try {
    const r = await shipped.onRequest({ request: new Request("https://rehearsal.test/inbox"), env });
    v = (await r.json()).verdict;
  } catch { v = "threw"; }
  const mine = inboxVerdict(state, now);
  if (check(`${name}: shipped "${v}" === inboxVerdict "${mine}" (expected ${want})`, v === mine && mine === want)) agree++;
}
clock.real();
const ok = agree === INBOX_CASES.length;
check("inbox mirror: no drift across every fixture", ok, `${agree}/${INBOX_CASES.length}`);
done();
console.log(`INBOX mirror: ${ok ? "ok" : "drift"}`);
