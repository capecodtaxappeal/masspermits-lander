// Pay path audit: functions/api/weekly-send.js and send-status.js (SHIPPED source).
//   node --test test/paypath-audit/weekly-send.audit.test.mjs
// See _harness.mjs for the DEFECT / OK naming rule and the no-network guard.

import test from "node:test";
import assert from "node:assert/strict";
import { load, fakeR2, env, mail, resetMail, resend, sub, zip, body, clock } from "./_harness.mjs";

const ws = await load("functions/api/weekly-send.js");
const ss = await load("functions/api/send-status.js");
const AUTH = { authorization: "Bearer test-stub" };
const run = (r2, q = "") => ws.onRequest({ request: new Request("https://masspermits.com/api/weekly-send" + q,
  { method: "POST", headers: AUTH }), env: env(r2) });
const status = (r2) => ss.onRequest({ request: new Request("https://masspermits.com/api/send-status", { headers: AUTH }), env: env(r2) });

// Monday 26 Oct 2026, 15:00 UTC: past the 12:00 due time and its 1.5 h grace.
const MON = "2026-10-26T15:00:00Z";
function world(subs, { log, statusObj, zipAge } = {}) {
  clock.set(MON);
  const r2 = fakeR2({ "subscribers.json": subs });
  r2.set("latest-weekly.zip", zip("weekly"), "W1", zipAge !== undefined ? Date.now() - zipAge : undefined);
  r2.set("latest-monthly.zip", zip("monthly"), "M1");
  if (statusObj !== null) r2.set("refresh-status.json", statusObj || { ok: true, ran_at: new Date(Date.now() - 3600_000).toISOString() });
  if (log) r2.set("feed-send-log.json", log);
  return r2;
}
const ROSTER = [sub(1), sub(2), sub(3)];

test("DEFECT W1: two overlapping triggers (cron + watchdog retry) both mail every subscriber", async () => {
  resetMail();
  const r2 = world(ROSTER);
  resend.delayMs = 15; // a real Resend round trip; the log is written only after the whole loop
  await Promise.all([run(r2), run(r2)]);
  const per = {};
  for (const m of mail) per[m.to] = (per[m.to] || 0) + 1;
  assert.deepEqual(Object.values(per), [1, 1, 1], "one Monday email per subscriber, got " + JSON.stringify(per));
  clock.real();
});

test("DEFECT W2: with refresh-status.json absent the freshness gate is skipped and a 30-day-old bundle is mailed", async () => {
  resetMail();
  const r2 = world(ROSTER, { statusObj: null, zipAge: 30 * 86400_000 });
  const res = await run(r2);
  assert.equal(mail.length, 0, "no freshness record must not mean \"fresh\"; status " + res.status);
  clock.real();
});

test("DEFECT S1: a total Resend outage that WAS logged is reported as `unknown` (\"no results were recorded\") and never auto-retried", async () => {
  resetMail();
  const r2 = world(ROSTER);
  resend.fail = true;
  await run(r2);                        // every send fails, feed-send-log.json records it
  resend.fail = false;
  const log = r2.json("feed-send-log.json");
  assert.equal(log[0].sent.every((s) => s.ok === false), true, "precondition: failures are logged");
  const st = await body(await status(r2));
  assert.notEqual(st.verdict, "unknown", "results ARE recorded: detail says " + st.detail);
  assert.equal(st.retry_safe, true, "nobody received it, so a retry cannot double-send");
  clock.real();
});

test("DEFECT S2: a legacy row with no `active` field is mailed by weekly-send but invisible to the watchdog roster check", async () => {
  resetMail();
  const legacy = sub(4); delete legacy.active;
  // This week's log served subs 1 to 3 only; the legacy row was never delivered.
  const at = "2026-10-26T12:05:00Z";
  const r2 = world([...ROSTER, legacy], { log: [{ at, subscribers: 3, bundle_etag: "W1",
    sent: ROSTER.map((s) => ({ to: s.email, ok: true })) }] });
  r2.set("last-send-attempt.json", { at, subscribers: 3 });
  const st = await body(await status(r2));
  assert.equal(st.roster_gap, 1, "weekly-send treats a missing `active` as active (active !== false); the watchdog must too");
  clock.real();
});

test("OK: a second sequential run in the same delivery week sends nothing (09-07 regression holds)", async () => {
  resetMail();
  const r2 = world(ROSTER);
  await run(r2);
  r2.set("latest-weekly.zip", zip("rebuilt"), "W2"); // a refresh re-stamps the bytes
  await run(r2);
  assert.equal(mail.length, 3);
  clock.real();
});

test("OK: inactive rows are skipped and case/whitespace duplicate rows get one email", async () => {
  resetMail();
  const r2 = world([sub(1), { ...sub(1), email: " SUB001@example.test", token: "f".repeat(32) }, sub(2, { active: false })]);
  await run(r2);
  assert.equal(mail.length, 1);
  clock.real();
});

test("OK: weekly-send and send-status responses carry counts only (no address, no domain, no provider error)", async () => {
  resetMail();
  const r2 = world(ROSTER);
  resend.failFor.add("sub002@example.test");
  const a = await (await run(r2)).text();
  const b = await (await status(r2)).text();
  for (const t of [a, b]) {
    assert.ok(!/example\.test|simulated outage|@/.test(t), t.slice(0, 300));
  }
  clock.real();
});

test("OK: weekly-send without an OIDC bearer is refused and sends nothing", async () => {
  resetMail();
  const r2 = world(ROSTER);
  const res = await ws.onRequest({ request: new Request("https://masspermits.com/api/weekly-send", { method: "POST" }), env: env(r2) });
  assert.equal(res.status, 401);
  assert.equal(mail.length, 0);
  clock.real();
});

test("OK: a missing latest-weekly.zip fails loudly (500) instead of reporting success", async () => {
  resetMail();
  const r2 = world(ROSTER);
  r2.m.delete("latest-weekly.zip");
  assert.equal((await run(r2)).status, 500);
  clock.real();
});
