// Regression test for health.js, the public /api/health tile.
//
// WHY THIS FILE EXISTS. On 2026-09-23 the daily refresh shipped fresh bundles
// but its refresh-status.json upload did not land, and this endpoint kept
// saying the refresh was fine: its only staleness rule was 8 days. At 03:14Z
// on 09-24 the status was 36.9 h old and nothing was flagged. The first case
// below replays that exact moment from the real R2 timestamps and must flag it.
//
// It reads the SHIPPED source next to it, so it cannot drift, and it mocks R2
// with an object that throws on any key other than the three health.js is
// allowed to read. Every fixture is synthetic apart from the timestamps: no
// town, person or customer data is in this file.
//
//   node functions/api/health.test.mjs
//
// HEALTH_JS=<path> points it at another copy of health.js (used to prove the
// old file fails the lag cases). HEALTH_DUMP=<file> writes every output as JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.env.HEALTH_JS || join(here, "health.js");
const load = async (p) => import("data:text/javascript;base64," +
  Buffer.from(readFileSync(p, "utf8")).toString("base64"));
const { onRequestGet } = await load(target);
const presendSrc = readFileSync(join(here, "_presend.js"), "utf8");
const { POLICY_DEFAULTS } = await load(join(here, "_presend.js"));

let failed = 0;
const dump = {};
function t(name, ok, got) {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}` + (ok ? "" : `   (got ${JSON.stringify(got)})`));
}

// ---- R2 mock: exactly the three reads health.js is allowed to make ---------
function mockEnv(fx) {
  return {
    BUNDLES: {
      async get(key) {
        if (key !== "refresh-status.json") throw new Error("health.js read a forbidden key: " + key);
        if (fx.status === undefined && fx.statusRaw === undefined) return null;
        const body = fx.statusRaw !== undefined ? fx.statusRaw : JSON.stringify(fx.status);
        return { uploaded: fx.statusUp ? new Date(fx.statusUp) : undefined, async text() { return body; } };
      },
      async head(key) {
        if (key === "latest-weekly.zip") return fx.zip ? { uploaded: new Date(fx.zip) } : null;
        if (key === "latest-weekly.html") return fx.html ? { uploaded: new Date(fx.html) } : null;
        throw new Error("health.js headed a forbidden key: " + key);
      },
    },
  };
}

async function run(label, nowIso, fx) {
  const realNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    const res = await onRequestGet({ env: mockEnv(fx), request: new Request("https://example.invalid/api/health") });
    const out = await res.json();
    dump[label] = out;
    return out;
  } finally {
    Date.now = realNow;
  }
}

// A status object with the real shape. Counts and names are synthetic.
const status = (ran_at, extra = {}) => ({
  ok: true, degraded: false, count: 70000, ran_at, runner: "github-actions",
  coverage: { live_sources: 70, expected_sources: 79, lost_sources: 9, disclose: false, monthly_sources: ["x", "y"] },
  source_health: { tracked: 79, dead: ["Synthtown A", "Synthtown B"], failing: ["Synthtown C"], collapsed: [], vanished: [] },
  ...extra,
});
const H = 3600_000;
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const has = (arr, re) => Array.isArray(arr) && arr.some((s) => re.test(s));
const reasons = (o) => (o && o.lag && Array.isArray(o.lag.reasons) ? o.lag.reasons : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// REAL R2 timestamps (r2-snapshot 2026-09-24T03:59Z toplevel listing and the
// run 121-123 step times from the public GitHub API).
const RAN_0922 = "2026-09-22T14:20:46.250230+00:00";  // refresh-status.json ran_at, run 121
const UP_0922 = "2026-09-22T14:20:59.199Z";           // its R2 upload time
const ZIP_0923 = "2026-09-23T14:35:13.215Z";          // run 122's latest-weekly.zip
const HTML_0923 = "2026-09-23T14:35:14.823Z";         // run 122's latest-weekly.html
const RAN_0924 = "2026-09-24T14:23:39.713246+00:00";  // run 123's ran_at (it landed)
// Run 123's own upload times were not captured; these sit inside its observed
// step windows (bundles 14:23:39-44, status 14:23:46-47).
const ZIP_0924 = "2026-09-24T14:23:41.000Z", HTML_0924 = "2026-09-24T14:23:42.000Z";
const UP_0924 = "2026-09-24T14:23:47.000Z";
const MISS = { status: status(RAN_0922), statusUp: UP_0922, zip: ZIP_0923, html: HTML_0923 };

console.log("THE 09-23 MISS, REPLAYED FROM REAL TIMESTAMPS");
{
  const o = await run("A_0924T0314_36.9h", "2026-09-24T03:14:46Z", MISS);
  t("A. 09-24 03:14Z: refresh-status.json is 36.9 h old", o.refresh && o.refresh.age_hours === 36.9, o.refresh);
  t("A. the lag is FLAGGED", !!(o.lag && o.lag.flag === true), o.lag);
  t("A. named as status_not_landed", !!reasons(o) && reasons(o).includes("status_not_landed"), reasons(o));
  t("A. not called refresh_late: the zip is only 12.7 h old", !!reasons(o) && !reasons(o).includes("refresh_late"), reasons(o));
  t("A. a warning line says 36.9 h", has(o.warnings, /36\.9 h/), o.warnings);
  t("A. the tile is not 'ok'", o.status !== "ok", o.status);
  t("A. download_ahead_minutes = 1454 (zip 24.2 h after status)", !!o.lag && o.lag.download_ahead_minutes === 1454, o.lag);
  // Same moment with no dead or failing source, so nothing else can turn the
  // tile amber: before this change it said HEALTHY here.
  const clean = { ...MISS, status: status(RAN_0922, { source_health: { tracked: 79, dead: [], failing: [] } }) };
  const c = await run("A2_0924T0314_36.9h_clean", "2026-09-24T03:14:46Z", clean);
  t("A2. with no other warning, the lag alone turns the tile from ok to warn",
    c.status === "warn" && c.warnings.length === 1 && has(c.warnings, /36\.9 h/), { status: c.status, warnings: c.warnings });
}
{
  const o = await run("B_0923T1506", "2026-09-23T15:06:00Z", MISS);
  t("B. 09-23 15:06Z, 31 min after the zip: flagged already", !!o.lag && o.lag.flag === true, o.lag);
  t("B. only status_not_landed (status is 24.8 h old)", same(reasons(o), ["status_not_landed"]), reasons(o));
}
{
  const o = await run("C_0923T1440", "2026-09-23T14:40:00Z", MISS);
  t("C. 09-23 14:40Z, 5 min after the zip: not yet (a normal run's status lands in seconds)",
    !!o.lag && o.lag.flag === false, o.lag);
}
{
  const o = await run("D_0924T1616_healthy", "2026-09-24T16:16:19Z",
    { status: status(RAN_0924), statusUp: UP_0924, zip: ZIP_0924, html: HTML_0924 });
  t("D. 09-24 16:16Z after run 123 landed: no lag", !!o.lag && o.lag.flag === false && same(reasons(o), []), o.lag);
  t("D. its lines are only the source counts", same(o.problems, []) && !has(o.warnings, /status|refresh|zip/), o);
}

console.log("\nNORMAL DAYS MUST STAY QUIET");
{
  // The longest normal gap between two landed runs, 16 scheduled runs 09-09..09-24: 26.2 h.
  const T = "2026-09-20T13:48:43Z";
  const o = await run("E_normal_26.2h", plus(T, 26.2 * H),
    { status: status(T), statusUp: plus(T, 5_000), zip: plus(T, -3_000), html: plus(T, -2_000) });
  t("E. a late but normal next run (26.2 h) is not flagged", !!o.lag && o.lag.flag === false, o.lag);
}
{
  const T = "2026-09-20T13:48:43Z";
  const fx = { status: status(T), statusUp: plus(T, 5_000), zip: plus(T, -3_000), html: plus(T, -2_000) };
  const a = await run("F1_35.9h", plus(T, 35.9 * H), fx);
  t("F. 35.9 h, nothing landed: not yet", !!a.lag && a.lag.flag === false, a.lag);
  const b = await run("F2_36.1h", plus(T, 36.1 * H), fx);
  t("F. 36.1 h, nothing landed: refresh_late", same(reasons(b), ["refresh_late"]), reasons(b));
  t("F. and it is a problem, not a warning", b.status === "bad" && has(b.problems, /36\.1 h/), b.problems);
}
{
  const T = "2026-09-20T13:48:43Z";
  const o = await run("G_40h_no_zip", plus(T, 40 * H), { status: status(T), statusUp: plus(T, 5_000) });
  t("G. 40 h and no zip in R2: refresh_late, says the zip is missing",
    same(reasons(o), ["refresh_late"]) && has(o.problems, /missing latest-weekly\.zip/), o.problems);
}
{
  const T = "2026-09-20T13:48:43Z";
  const o = await run("K_9_days", plus(T, 9 * 24 * H),
    { status: status(T), statusUp: plus(T, 5_000), zip: plus(T, -3_000), html: plus(T, -2_000) });
  t("K. 9 days: the old 8-day line fires", has(o.problems, /ran 9 days ago/), o.problems);
  t("K. and the 36 h line does not repeat it", !has(o.problems, /no refresh has landed/), o.problems);
  t("K. lag.reasons still says refresh_late", !!reasons(o) && reasons(o).includes("refresh_late"), reasons(o));
}

{
  // The edge between the two: status 36.2 h old, zip 35.9 h old (only 18 min apart).
  const T = "2026-09-20T13:48:43Z";
  const o = await run("O_status_late_edge", plus(T, 36.2 * H),
    { status: status(T), statusUp: plus(T, 5_000), zip: plus(T, 18 * 60_000), html: plus(T, 18 * 60_000) });
  t("O. status 36.2 h, zip 35.9 h: status_late, a warning", same(reasons(o), ["status_late"]) &&
    has(o.warnings, /36\.2 h old \(limit 36 h\)/) && same(o.problems, []), { reasons: reasons(o), warnings: o.warnings });
}

console.log("\nTHE OTHER DIRECTION: STATUS LANDED, BUNDLE DID NOT");
{
  const T = "2026-09-20T13:48:43Z";
  const fx = { status: status(T), statusUp: plus(T, 5_000), zip: plus(T, -7 * H), html: plus(T, -7 * H) };
  const o = await run("H1_bundle_not_landed", plus(T, 1 * H), fx);
  t("H. ok status uploaded 7 h after the zip: bundle_not_landed", same(reasons(o), ["bundle_not_landed"]), reasons(o));
  const f = await run("H2_failed_run", plus(T, 1 * H), { ...fx, status: status(T, { ok: false, error: "gate abort" }) });
  t("H. a FAILED run ships no bundle by design: not bundle_not_landed",
    !!reasons(f) && !reasons(f).includes("bundle_not_landed") && has(f.problems, /FAILED/), f);
}

console.log("\nUNCHANGED BEHAVIOUR");
{
  const o = await run("I_never_ran", "2026-09-24T03:14:46Z", { zip: ZIP_0923, html: HTML_0923 });
  t("I. no status object: still never_ran and bad", o.refresh && o.refresh.state === "never_ran" && o.status === "bad", o.refresh);
  t("I. lag has nothing to measure: not flagged", !!o.lag && o.lag.flag === false, o.lag);
  const j = await run("J_unparseable", "2026-09-24T03:14:46Z",
    { statusRaw: "{not json", statusUp: UP_0922, zip: ZIP_0923, html: HTML_0923 });
  t("J. unparseable status: still never_ran", j.refresh && j.refresh.state === "never_ran", j.refresh);
}
{
  const o = dump["A_0924T0314_36.9h"];
  const keys = ["status", "checked_at", "problems", "warnings", "refresh", "coverage", "sources", "portal"];
  t("M. every key the tile and build_cold_queue_v2.py read is still there",
    keys.every((k) => k in o) && o.coverage.live_sources === 70, Object.keys(o));
  t("M. dead/failing are still counts", o.sources.dead === 2 && o.sources.failing === 1, o.sources);
}

console.log("\nPUBLIC-SAFE: COUNTS AND TIMESTAMPS ONLY");
{
  const all = JSON.stringify(dump);
  t("L. no town name from source_health reaches the output", !/Synthtown/.test(all), "name found");
  const o = dump["A_0924T0314_36.9h"];
  const ok = !!o.lag && Object.entries(o.lag).every(([k, v]) =>
    v === null || typeof v === "number" || typeof v === "boolean" ||
    (k === "reasons" && Array.isArray(v) && v.every((c) => /^[a-z_]+$/.test(c))) ||
    (k === "status_uploaded_at" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v)));
  t("L. lag holds only numbers, booleans, reason codes and one ISO time", ok, o.lag);
  t("L. no em or en dash in any line this file's new rules print",
    !/[\u2013\u2014]/.test(JSON.stringify([...Object.values(dump)].flatMap((x) =>
      (x.warnings || []).concat(x.problems || []).filter((s) => /land|limit|zip was/.test(s))))), "dash");
}

console.log("\nSAME LIMITS AS THE PRE-SEND GATE (_presend.js)");
{
  const o = dump["A_0924T0314_36.9h"];
  t(`N. lag limit = POLICY_DEFAULTS.max_status_age_h (${POLICY_DEFAULTS.max_status_age_h} h)`,
    !!o.lag && o.lag.limit_hours === POLICY_DEFAULTS.max_status_age_h, o.lag && o.lag.limit_hours);
  const src = readFileSync(target, "utf8");
  const m = src.match(/DIVERGE_MS\s*=\s*(\d+)\s*\*\s*3600_000/);
  t(`N. bundle_not_landed uses divergence_h (${POLICY_DEFAULTS.divergence_h} h)`,
    !!m && Number(m[1]) === POLICY_DEFAULTS.divergence_h && /divergence_h/.test(presendSrc), m && m[1]);
}

if (process.env.HEALTH_DUMP) writeFileSync(process.env.HEALTH_DUMP, JSON.stringify(dump, null, 1));
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
