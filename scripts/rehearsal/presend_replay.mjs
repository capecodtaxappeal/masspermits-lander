// Pre-send gate — DRY RUN. Sends nothing, writes nothing, touches no network.
//
// This imports the PRODUCTION module directly:
//   masspermits-lander/functions/api/_presend.js
// so what is asserted here is what would run in the Worker. A copy of the logic
// in a test file proves nothing about the deployed code, which is the mistake
// that let "a green run is not proof" become a landmine in the first place.
//
// Run:
//   node presend_replay.mjs
//   node presend_replay.mjs --live <dir with rs.json + fsl.json pulled from R2>
//
// Exit 0 = every scenario produced its expected verdict.
// Exit 1 = the gate has changed behaviour. Read the diff before deploying.

import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const MOD = new URL("../../functions/api/_presend.js", import.meta.url).href;
const { evaluate, normalisePolicy, POLICY_DEFAULTS, lastEtagEntry, bestSince,
        windowStart, holdDeadline, headline } = await import(MOD);

const T = (s) => Date.parse(s + (s.length <= 16 ? ":00Z" : (s.endsWith("Z") ? "" : "Z")));
const P = normalisePolicy(null);

let fail = 0, run = 0;

function scenario({ name, at, expect, expect_nothing, expect_disclosure, status,
                    weekly, monthly, log, sha256, policy, actually }) {
  run++;
  const r = evaluate(T(at), {
    policy: normalisePolicy(policy || null),
    status: status ?? null, log: log ?? null,
    weekly: weekly ?? null, monthly: monthly ?? null, sha256: sha256 ?? null,
  });
  const okV = r.verdict === expect;
  const okN = expect_nothing === undefined || r.customer_gets_nothing === expect_nothing;
  // A verdict alone is a weak assertion: three scenarios in the previous version
  // of this file "passed" while the evidence they were written to exercise was
  // being silently ignored. Asserting the DISCLOSURE CODES pins the reason, so a
  // GO_WITH_DISCLOSURE reached for the wrong cause fails here instead of shipping.
  const okD = expect_disclosure === undefined ||
    JSON.stringify([...r.disclosure].sort()) === JSON.stringify([...expect_disclosure].sort());
  if (!okV || !okN || !okD) fail++;
  console.log(`\n${okV && okN && okD ? "  ok  " : "  FAIL"}  ${name}`);
  console.log(`        verdict ${r.verdict}${okV ? "" : `  (expected ${expect})`}` +
              `   customer_gets_nothing=${r.customer_gets_nothing}` +
              `${okN ? "" : ` (expected ${expect_nothing})`}   code=${r.code}` +
              `${okD ? "" : `   disclosure expected [${expect_disclosure}]`}`);
  console.log(`        ${headline(r)}`);
  for (const x of r.reasons) console.log(`        - ${wrap(x)}`);
  for (const x of r.notes || []) console.log(`        . ${wrap(x)}`);
  if (r.disclosure.length) console.log(`        disclosure: ${r.disclosure.join(", ")}`);
  if (actually) console.log(`        WHAT ACTUALLY HAPPENED: ${wrap(actually)}`);
  return r;
}

const wrap = (s) => String(s).replace(/(.{92}) /g, "$1\n          ");

// ── fixtures ────────────────────────────────────────────────────────────────
const obj = (uploaded, etag, size = 930000) => ({ key: "latest-weekly.zip", etag, size, uploaded });

// THE FINGERPRINT, IN THE PLACE THE MODULE ACTUALLY READS IT.
//
// This is the correction that made this file worth re-running. The previous
// version passed `manifest` as a top-level input to evaluate(), which is the
// shape of the ABANDONED design — a standalone bundle-manifest.json object.
// _presend.js:217 reads `status.bundle.weekly`, because bundle_manifest.py
// --merge-status folds the fingerprint into refresh-status.json rather than
// widening upload-bundle.js's ALLOWED_KEYS. So `manifest` was silently dropped
// on the floor: three scenarios FAILED, and worse, three more PASSED while
// exercising nothing. A harness that green-lights an unread input is the
// "a green run is not proof" trap wearing a test suite as a disguise.
const fp = (o = {}) => ({
  schema: 1, built_at: "2026-09-07T09:12:00Z",
  row_key_cols: ["issued_date", "trade", "type_desc", "description", "address",
                 "city", "zip", "valuation_str", "permit_number", "source"],
  weekly: { file: "MassPermits-2026-09-07-WEEKLY.zip", sha256: "aaa", bytes: 934000,
            opens_as_zip: true, has_all_leads: true,
            rows: 5702, distinct_rows: 5687, rowset_sha256: "R2",
            max_issued_date: "2026-09-05", min_issued_date: "2026-08-24",
            distinct_sources: 39, ...o },
});

const okStatus = (ran, extra = {}) => ({ ok: true, degraded: false, ran_at: ran,
  coverage: { live_sources: 39, expected_sources: 140, disclose: true }, ...extra });
// Status WITH this run's bundle fingerprint merged in — the post-ship shape.
const fpStatus = (ran, o = {}, extra = {}) => okStatus(ran, { bundle: fp(o), ...extra });

// A LOG ENTRY CARRYING WHAT WAS ACTUALLY DELIVERED.
//
// The gate's baseline is not "the previous build", it is the last bundle a
// SUBSCRIBER RECEIVED — so these four fields have to survive in the send log.
// weekly-send.js writes `bundle_etag` and nothing else, which is why every
// bundle_rowset / bundle_rows / bundle_max_issued / bundle_bytes comparison in
// _presend.js is unreachable until that changes. Modelling them here is what
// makes that gap visible instead of theoretical.
const delivered = (at, etag, n = 3, f = {}) => ({
  at, subscribers: n, bundle_etag: etag, sent: Array(n).fill({ ok: true }),
  bundle_rowset: "R1", bundle_rows: 5100, bundle_max_issued: "2026-08-29",
  bundle_bytes: 930000, ...f,
});
// A delivery from BEFORE the fingerprint shipped: etag only, no baseline.
const deliveredNoFp = (at, etag, n = 3) =>
  ({ at, subscribers: n, bundle_etag: etag, sent: Array(n).fill({ ok: true }) });
const skip = (at, etag) => ({ at, subscribers: 3, bundle_etag: etag, sent: [], skipped: "identical bundle" });

console.log("═".repeat(96));
console.log("PRE-SEND GATE — REPLAY OF REAL INCIDENTS");
console.log("═".repeat(96));

scenario({
  name: "2026-08-03 14:34 — the incident. Coverage gate aborted; the ship step was skipped.",
  at: "2026-08-03T14:34:30",
  expect: "NO_GO", expect_nothing: true,
  status: { ok: false, degraded: false, ran_at: "2026-08-03T12:26:29Z", error: "coverage gate" },
  weekly: obj("2026-07-27T12:20:00Z", '"e0727"', 562330),
  monthly: obj("2026-07-27T12:20:30Z", '"m0727"'),
  log: [deliveredNoFp("2026-07-27T14:29:24Z", '"e0727"', 2)],
  actually: "weekly-send 500'd, the Actions step failed, nobody was told. The customer " +
    "emailed the same day asking where the file was and waited 33.5 days for a reply. " +
    "He cancelled inside that silence. THE GATE'S JOB HERE IS NOT TO BLOCK - it is to " +
    "set customer_gets_nothing=true so the caller says something.",
});

scenario({
  name: "2026-08-09 20:46 — watchdog fires an unscheduled retry after a good Monday send",
  at: "2026-08-09T20:46:00",
  expect: "NO_GO", expect_nothing: true,
  status: okStatus("2026-08-09T09:31:00Z"),
  weekly: obj("2026-08-09T09:36:00Z", '"e0803b"'),
  log: [deliveredNoFp("2026-08-03T14:00:00Z", '"e0803b"', 2)],
  actually: "Both subscribers got a second copy 15h before their scheduled one. The etag " +
    "guard was added afterwards; this gate catches it one layer earlier, before the " +
    "caller commits to a send.",
});

scenario({
  name: "2026-08-31 12:00 nominal — refresh had not started yet (it began 16:38)",
  at: "2026-08-31T12:00:00",
  expect: "HOLD", expect_nothing: false,
  status: okStatus("2026-08-30T14:21:16Z"),
  weekly: obj("2026-08-30T14:21:16Z", '"e0830"'),
  log: [deliveredNoFp("2026-08-24T12:44:04Z", '"e0824"')],
  actually: "Nothing ran at 12:00. weekly-feed's own cron was deferred to 18:46 and landed " +
    "after the 16:44 refresh BY LUCK. HOLD is the verdict the system has never had: on 4 of " +
    "the last 9 Mondays this was the true state at the nominal send time.",
});

scenario({
  name: "2026-08-31 20:30 — same Monday, past the 20:00 hold deadline, refresh still absent",
  at: "2026-08-31T20:30:00",
  expect: "GO_WITH_DISCLOSURE", expect_nothing: false,
  status: okStatus("2026-08-30T14:21:16Z"),
  weekly: obj("2026-08-30T14:21:16Z", '"e0830"'),
  log: [deliveredNoFp("2026-08-24T12:44:04Z", '"e0824"')],
  actually: "This is the conversion the whole design turns on. The same inputs that were a " +
    "silent HOLD at 12:00 become a SEND at 20:00, with the data's real date stated. " +
    "Holding is allowed to be quiet only because it expires.",
});

scenario({
  name: "Upload PUT failed, the `if: always()` status PUT still ran",
  at: "2026-09-07T12:05:00",
  expect: "NO_GO", expect_nothing: true,
  status: okStatus("2026-09-07T11:58:00Z"),
  weekly: obj("2026-08-31T16:44:00Z", '"e0831"'),
  log: [deliveredNoFp("2026-08-31T18:46:18Z", '"e0824"')],
  actually: "Today: weekly-send reads ok:true and a fresh ran_at, mails last week's file, the " +
    "etag guard turns it into a silent skip, and the watchdog reports `stale_bundle` — a " +
    "true alarm with a false cause. Nothing compares the status against the object.",
});

scenario({
  name: "Fresh bytes, ZERO new leads (the date stamp moved, the data did not)",
  at: "2026-09-07T12:05:00",
  expect: "GO_WITH_DISCLOSURE", expect_nothing: false, expect_disclosure: ["no_new_rows"],
  // rowset_sha256 R1 === the rowset the subscriber already received. The etag
  // and the byte count both changed; the leads did not.
  status: fpStatus("2026-09-07T11:58:00Z", { rowset_sha256: "R1", max_issued_date: "2026-08-29" },
                   { coverage: { live_sources: 39, expected_sources: 140, disclose: false } }),
  weekly: obj("2026-09-07T11:58:00Z", '"eNew"', 934000),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "Completely invisible today. build_bundle.py:185 stamps date.today() into the " +
    "HTML and the filename, so the bytes and the etag change every day whether or not one " +
    "permit was scraped. This is the ONLY check that can tell the difference, and it is " +
    "unreachable until weekly-send.js records bundle_rowset in the send log.",
});

scenario({
  name: "Rows churned in and out of the 14-day window, but nothing NEWER was published",
  at: "2026-09-07T12:05:00",
  expect: "GO_WITH_DISCLOSURE", expect_nothing: false, expect_disclosure: ["no_newer_permits"],
  // A different rowset — so the crude "did anything change" test passes — but
  // the newest permit is still the one they already have. F2: _within_days
  // anchors each source's window to that source's own newest permit, so a town
  // that published nothing contributes the same 14 days it did last week.
  status: fpStatus("2026-09-07T11:58:00Z", { rowset_sha256: "R9", max_issued_date: "2026-08-29" },
                   { coverage: { live_sources: 39, expected_sources: 140, disclose: false } }),
  weekly: obj("2026-09-07T11:58:00Z", '"eChurn"', 934000),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "Expected 3 weeks in 4 for the 7 monthly publishers (Amherst, Barnstable, " +
    "Chatham, Lexington, Plymouth, Reading, Sudbury). Disclosed generically today, " +
    "never measured.",
});

scenario({
  name: "A skip is the newest log entry, then something re-triggers the send (G2)",
  at: "2026-09-07T13:40:00",
  expect: "NO_GO", expect_nothing: true,
  status: okStatus("2026-09-07T09:31:00Z"),
  weekly: obj("2026-09-07T09:36:00Z", '"eSame"'),
  log: [skip("2026-09-07T12:40:00Z", '"eSame"'), delivered("2026-09-07T12:02:00Z", '"eSame"')],
  actually: "weekly-send.js:87 takes priorLog[0]. A skip entry carries sent:[], so " +
    "`(prior.sent||[]).some(x=>x.ok)` is false, the guard does not trip, and the next " +
    "trigger re-sends bytes every subscriber already holds. Editing weekly-feed.yml fires " +
    "a send (L-12), so this is one careless commit away from being 2026-08-09 again.",
});

scenario({
  name: "The refresh simply stopped running (A2 — nothing in the system watches for this)",
  at: "2026-09-07T12:05:00",
  expect: "NO_GO", expect_nothing: true,
  status: okStatus("2026-09-04T09:31:00Z"),
  weekly: obj("2026-09-04T09:36:00Z", '"e0904"'),
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "weekly-send.js:43 tolerates 8 days, which is 8x the delivery cadence. A refresh " +
    "dead since last Monday clears that gate and mails week-old data as this week's.",
});

scenario({
  name: "Truncated upload — upload-bundle.js only rejects zero bytes",
  at: "2026-09-07T12:05:00",
  expect: "NO_GO", expect_nothing: true,
  // The BUILD was fine (fingerprint says 934,000 bytes, sha256 aaa). R2 holds
  // 41,000 bytes, so both the size band and the digest disagree with it.
  status: fpStatus("2026-09-07T11:58:00Z"),
  weekly: obj("2026-09-07T11:58:00Z", '"eTrunc"', 41000),
  sha256: "digest-of-a-truncated-file",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "Nothing checks that the object opens as a zip, contains ALL-leads.csv, or has " +
    "any rows.",
});

scenario({
  name: "Wrong bytes in R2 — sha256 disagrees with the fingerprint",
  at: "2026-09-07T12:05:00",
  expect: "NO_GO", expect_nothing: true,
  status: fpStatus("2026-09-07T11:58:00Z"),
  weekly: obj("2026-09-07T11:58:00Z", '"eX"', 934000),
  sha256: "not-aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
});

scenario({
  name: "The object in R2 does not open as a zip at all",
  at: "2026-09-07T12:05:00",
  expect: "NO_GO", expect_nothing: true,
  status: fpStatus("2026-09-07T11:58:00Z", { opens_as_zip: false, has_all_leads: false }),
  weekly: obj("2026-09-07T11:58:00Z", '"eRot"', 934000),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
});

scenario({
  name: "The bundle opens, but ALL-leads.csv — the file they paid for — is not in it",
  at: "2026-09-07T12:05:00",
  expect: "NO_GO", expect_nothing: true,
  status: fpStatus("2026-09-07T11:58:00Z", { has_all_leads: false, rows: 0, rowset_sha256: "EMPTY",
                                             max_issued_date: null }),
  weekly: obj("2026-09-07T11:58:00Z", '"eNoCsv"', 934000),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
});

scenario({
  name: "The bundle built cleanly and contains zero rows",
  at: "2026-09-07T12:05:00",
  expect: "NO_GO", expect_nothing: true,
  status: fpStatus("2026-09-07T11:58:00Z", { rows: 0, distinct_rows: 0, rowset_sha256: "EMPTY",
                                             max_issued_date: null }),
  weekly: obj("2026-09-07T11:58:00Z", '"eEmpty"', 934000),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "A source can return [] without raising. The zero-row floor in scraper.py is " +
    "per-source; nothing asserts the assembled bundle is non-empty.",
});

scenario({
  name: "The good Monday: fresh, verified, new rows, coverage still disclosed",
  at: "2026-09-07T12:05:00",
  expect: "GO_WITH_DISCLOSURE", expect_nothing: false, expect_disclosure: ["reduced_coverage"],
  status: fpStatus("2026-09-07T11:58:00Z"),
  weekly: obj("2026-09-07T11:58:00Z", '"eGood"', 934000),
  monthly: obj("2026-09-07T11:58:30Z", '"mGood"'),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "coverage.disclose has been true since the 2026-08-01 OpenGov lockout (39 live " +
    "against a marketed baseline of 140), so every real send today carries the note.",
});

scenario({
  name: "The clean Monday, hypothetically — full coverage restored",
  at: "2026-09-07T12:05:00",
  expect: "GO", expect_nothing: false, expect_disclosure: [],
  status: fpStatus("2026-09-07T11:58:00Z", {},
    { coverage: { live_sources: 140, expected_sources: 140, disclose: false } }),
  weekly: obj("2026-09-07T11:58:00Z", '"eGood"', 934000),
  monthly: obj("2026-09-07T11:58:30Z", '"mGood"'),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
});

scenario({
  name: "THE FIRST SEND AFTER THE FINGERPRINT SHIPS — no baseline yet, and it says so",
  at: "2026-09-07T12:05:00",
  expect: "GO_WITH_DISCLOSURE", expect_nothing: false, expect_disclosure: ["reduced_coverage"],
  status: fpStatus("2026-09-07T11:58:00Z"),
  weekly: obj("2026-09-07T11:58:00Z", '"eFirst"', 934000),
  monthly: obj("2026-09-07T11:58:30Z", '"mFirst"'),
  sha256: "aaa",
  // The last delivery predates the change, so it carries an etag and nothing else.
  log: [deliveredNoFp("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "One send's worth of blind spot, stated in the notes rather than implied away. " +
    "It self-heals as soon as one delivery is logged with a fingerprint.",
});

scenario({
  name: "TODAY'S REAL SHAPE — no fingerprint yet, so row freshness is unverifiable",
  at: "2026-09-07T12:05:00",
  expect: "GO_WITH_DISCLOSURE", expect_nothing: false, expect_disclosure: ["reduced_coverage"],
  status: okStatus("2026-09-07T11:58:00Z"),
  weekly: obj("2026-09-07T11:58:00Z", '"eToday"'),
  monthly: obj("2026-09-06T14:29:02Z", '"mToday"'),
  log: [deliveredNoFp("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "Until bundle_manifest.py --merge-status ships, the gate still closes " +
    "A1/A2/B1/B3, but it cannot tell new data from a re-dated copy and it says so " +
    "instead of implying it can.",
});

scenario({
  name: "latest-monthly.zip is a month stale — reported, never gating",
  at: "2026-09-07T12:05:00",
  expect: "GO_WITH_DISCLOSURE", expect_nothing: false, expect_disclosure: ["reduced_coverage"],
  status: fpStatus("2026-09-07T11:58:00Z"),
  weekly: obj("2026-09-07T11:58:00Z", '"eGood"', 934000),
  monthly: obj("2026-08-04T09:20:00Z", '"mOld"'),
  sha256: "aaa",
  log: [delivered("2026-08-31T18:46:18Z", '"e0831"')],
  actually: "latest-monthly.zip is what stripe-webhook.js mails a brand new buyer and what " +
    "my-leads.js serves for k=monthly. Nothing has ever checked it. A stale monthly must " +
    "not block the weekly send, so this is a line in the report, not a block.",
});

// ── unit checks on the two one-line fixes ──────────────────────────────────
console.log("\n" + "═".repeat(96));
console.log("UNIT — the two one-line fixes this gate depends on");
console.log("═".repeat(96));

function unit(name, got, want) {
  run++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

const logSkipOverDeliver = [skip("2026-09-07T12:40:00Z", '"eSame"'),
                            delivered("2026-09-07T12:02:00Z", '"eSame"')];
unit("G2 lastEtagEntry finds the newest entry WITH an etag, skip included",
     lastEtagEntry(logSkipOverDeliver).at, "2026-09-07T12:40:00Z");
unit("G2 lastEtagEntry ignores an etag-less entry on top",
     lastEtagEntry([{ at: "2026-09-07T13:00:00Z", sent: [] }, delivered("2026-09-07T12:02:00Z", '"e1"')]).at,
     "2026-09-07T12:02:00Z");
unit("G1 bestSince prefers a real delivery over a later skip (the C5 false alarm)",
     bestSince(logSkipOverDeliver, T("2026-09-07T12:00:00")).at, "2026-09-07T12:02:00Z");
unit("G1 bestSince ignores everything before the due time",
     bestSince([delivered("2026-08-31T18:46:18Z", '"e0831"')], T("2026-09-07T12:00:00")), null);
unit("G1 bestSince falls back to the skip when nothing delivered",
     bestSince([skip("2026-09-07T12:40:00Z", '"e"')], T("2026-09-07T12:00:00")).skipped !== undefined, true);

unit("windowStart is 00:00 Monday, not 12:00 — a 09:14 upload is inside its own send window",
     new Date(windowStart(T("2026-09-07T12:05:00"), P)).toISOString(), "2026-09-07T00:00:00.000Z");
unit("holdDeadline is 20:00 UTC on send day",
     new Date(holdDeadline(T("2026-09-07T12:05:00"), P)).toISOString(), "2026-09-07T20:00:00.000Z");
unit("a malformed policy cannot open the gate (enforce stays false)",
     normalisePolicy({ enforce: "yes", hold_until_hour: 99, max_bundle_age_h: -1 }).enforce, false);
unit("a malformed policy cannot widen the bundle age limit",
     normalisePolicy({ max_bundle_age_h: 9999 }).max_bundle_age_h, POLICY_DEFAULTS.max_bundle_age_h);
unit("a policy CAN legitimately move the hold deadline",
     normalisePolicy({ hold_until_hour: 18 }).hold_until_hour, 18);

// ── optional: score the live R2 copies if a human has pulled them ──────────
const liveIdx = process.argv.indexOf("--live");
if (liveIdx > -1 && process.argv[liveIdx + 1]) {
  const d = process.argv[liveIdx + 1];
  const rd = (f) => existsSync(path.join(d, f))
    ? JSON.parse(readFileSync(path.join(d, f), "utf8")) : null;
  console.log("\n" + "═".repeat(96));
  console.log("LIVE — scored against R2 copies in " + d);
  console.log("═".repeat(96));
  const status = rd("rs.json");
  console.log("  refresh-status.json carries a `bundle` fingerprint: " +
              !!(status && status.bundle));
  const r = evaluate(Date.now(), {
    // No bm.json: the fingerprint travels inside refresh-status.json.
    policy: P, status, log: rd("fsl.json"),
    // NO object metadata is available from a CLI copy. Inferring `uploaded`
    // from refresh-status.json is EXACTLY the assumption this gate exists to
    // remove, so the live path declares the object absent instead of guessing,
    // and the NO_GO it produces is a statement about the harness, not about R2.
    weekly: null, monthly: null, sha256: null,
  });
  console.log(`  verdict ${r.verdict}  code=${r.code}  ${headline(r)}`);
  for (const x of r.reasons) console.log(`    - ${wrap(x)}`);
  for (const x of r.notes || []) console.log(`    . ${wrap(x)}`);
  console.log("\n  The object metadata a real verdict needs (etag, size, uploaded) exists only " +
    "\n  through env.BUNDLES.head(). Deploy /api/pre-send-check and read it there.");
}

console.log("\n" + "═".repeat(96));
console.log(`${run - fail}/${run} checks passed.`);
console.log("No email was sent. No R2 object was written. No network call was made.");
console.log("═".repeat(96));
process.exit(fail ? 1 : 0);
