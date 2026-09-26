// The runner job's scripts: http.mjs, mode.mjs, facts.mjs, c14.mjs, mirror.mjs.
//
//   node scripts/rehearsal/runner.test.mjs
//
// Acceptance 10 (every runner request is a GET to the GitHub API or to the
// public sample), 13 (mode.mjs, including the workflow_run source guard), 16
// (facts.mjs output from fixture API responses validates against RUNNER_SCHEMA
// imported from _rehearsal.js; runs are listed only by workflow file; fork,
// non-main and pull_request runs are not counted), the runner side of F1, F7,
// F8 and F10, C14's counts (I-20, I-21), the mirror step's c8 facts (I-04
// runner side: MIN_CENTS mutated in a temp copy), and 7 (every runner stdout
// line is free of "@", 32-hex strings, "cus_" and street addresses).
// The global fetch is a stub that throws on any URL it does not know.

import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";
import { makeRunner, makeFetchStub, API_DIR, REPO, readText } from "../../test/rehearsal/harness.mjs";
import * as G from "../../test/rehearsal/r3a_fixtures.mjs";
import { RUNNER_SCHEMA, validateRunnerFacts, fact } from "../../functions/api/_rehearsal.js";
import * as H from "./http.mjs";
import * as Mo from "./mode.mjs";
import * as Fa from "./facts.mjs";
import * as C14 from "./c14.mjs";
import * as Mi from "./mirror.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { check, done } = makeRunner("runner.test.mjs");
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const at = (s) => Date.parse(s);

// stdout capture for the leak test
const printed = [];
const realLog = console.log;
function capture(fn) {
  return async (...a) => {
    const lines = [];
    console.log = (...x) => { lines.push(x.join(" ")); };
    try { return await fn(...a); } finally { console.log = realLog; printed.push(...lines); }
  };
}

// ── the fetch stub: the GitHub API base and the sample URL only ────────────
const GH = "https://api.github.com/repos/capecodtaxappeal/masspermits-lander/";
let sampleBytes = null;
const stub = makeFetchStub({
  [GH + "*"]: () => new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { "x-ratelimit-remaining": "4999" } }),
  "https://masspermits.com/api/sample": () => (sampleBytes ? new Response(sampleBytes, { status: 200 })
    : new Response("no", { status: 404 })),
});
globalThis.fetch = stub.fetch;
process.env.GH_TOKEN = "gh-test-token";

// ════════════════════════════════════════════════════════════════════════════
// 10. http.mjs
// ════════════════════════════════════════════════════════════════════════════
{
  const r = await H.ghGet("actions/workflows/weekly-refresh.yml/runs?branch=main&per_page=100");
  const c = stub.calls.at(-1);
  check("10 ghGet: one GET to api.github.com/repos/capecodtaxappeal/masspermits-lander/...",
    r.ok && c.method === "GET" && c.url === GH + "actions/workflows/weekly-refresh.yml/runs?branch=main&per_page=100");
  check("10 ghGet sends Authorization: Bearer $GH_TOKEN", c.headers.authorization === "Bearer gh-test-token");
  const before = stub.calls.length;
  for (const bad of ["https://evil.example/x", "/repos/other/x", "../other/x", "a//b", "a b", "x@example.com/y",
    "", "actions/../../../orgs", "#frag"]) {
    let threw = false;
    try { await H.ghGet(bad); } catch { threw = true; }
    check(`10 ghGet refuses ${JSON.stringify(bad)}`, threw);
  }
  check("10 the refused paths made 0 fetch calls", stub.calls.length === before);
  sampleBytes = zip([["a.txt", "hello"]]);
  const s = await H.getSample();
  check("10 getSample: one GET to https://masspermits.com/api/sample", s.status === 200 && stub.calls.at(-1).method === "GET" &&
    stub.calls.at(-1).url === "https://masspermits.com/api/sample" && !("authorization" in stub.calls.at(-1).headers));
  sampleBytes = null;
  const src = readdirSync(here).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .map((f) => [f, readText(join(here, f))]);
  const fetchers = src.filter(([, s]) => /fetch\s*\(/.test(s)).map(([f]) => f);
  check("10 no runner file but http.mjs contains \"fetch(\"", fetchers.join() === "http.mjs", fetchers.join());
  // R3b adds ghJobLog: two more fetch( calls, both GET (the API request and
  // the one redirect target). r3b_runner.test.mjs tests them.
  const httpSrc = src.find(([f]) => f === "http.mjs")[1];
  const logFn = httpSrc.slice(httpSrc.indexOf("export async function ghJobLog"));
  check("10 http.mjs holds exactly four fetch( calls, all method GET: ghGet, getSample and two in ghJobLog",
    (httpSrc.match(/fetch\s*\(/g) || []).length === 4 && (httpSrc.match(/method: "GET"/g) || []).length === 4 &&
    (logFn.match(/fetch\s*\(/g) || []).length === 2);
  const mods = src.flatMap(([f, s]) => [...s.matchAll(/^\s*import\b[^;]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => [f, m[1]]));
  const badMods = mods.filter(([, m]) => !m.startsWith("node:") && !m.startsWith("./") && !m.startsWith("../../functions/api/"));
  check("runner scripts import only Node built-ins, each other and functions/api modules", badMods.length === 0,
    badMods.map((x) => x.join(":")).join(","));
  check("no runner file writes to GitHub (no method other than GET anywhere)",
    src.every(([, s]) => !/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(s)));
}

// ════════════════════════════════════════════════════════════════════════════
// 13. mode.mjs
// ════════════════════════════════════════════════════════════════════════════
{
  const sched = (s, now) => Mo.resolve({ eventName: "schedule", event: { schedule: s }, repository: G.REPO, now: at(now) });
  const cases = [
    ["0 20 * * 6", "2026-10-03T20:07:00Z", "sat", "2026-10-03", "on time"],
    ["0 20 * * 6", "2026-10-04T02:00:00Z", "sat", "2026-10-03", "late sat backstop keeps its date (F10)"],
    ["0 20 * * 0", "2026-10-04T20:05:00Z", "sun", "2026-10-04", "on time"],
    ["0 20 * * 0", "2026-10-05T02:00:00Z", "sun", "2026-10-04", "late sun backstop keeps its date (F10)"],
    ["0 10 * * 1", "2026-10-05T10:02:00Z", "mon-pre", "2026-10-05", "on time"],
    ["0 10 * * 1", "2026-10-05T16:40:00Z", "mon-pre", "2026-10-05", "6.5 h late"],
    ["30 20 * * 1", "2026-10-05T20:41:00Z", "mon-post", "2026-10-05", "on time"],
    ["30 20 * * 1", "2026-10-06T01:15:00Z", "mon-post", "2026-10-05", "Monday run delayed past midnight"],
    ["0 13 * * 2", "2026-10-06T13:05:00Z", "mon-post", "2026-10-05", "Tuesday backstop (F1)"],
    ["0 13 * * 2", "2026-10-06T19:00:00Z", "mon-post", "2026-10-05", "Tuesday backstop, late"],
  ];
  for (const [s, now, mode, date, note] of cases) {
    const r = sched(s, now);
    check(`13 schedule "${s}" at ${now} -> ${mode} ${date} (${note})`, r.mode === mode && r.date === date && r.trigger === "sched" &&
      r.parts === Mo.PARTS[mode], JSON.stringify(r));
  }
  let threw = false;
  try { sched("0 9 * * 1", "2026-10-05T09:00:00Z"); } catch { threw = true; }
  check("13 an unknown schedule string fails the step (never guessed)", threw);
  check("13 parts: sat/mon-pre/dry links core, sun links seed core, mon-post core",
    Mo.PARTS.sat === "links core" && Mo.PARTS["mon-pre"] === "links core" && Mo.PARTS.dry === "links core" &&
    Mo.PARTS.sun === "links seed core" && Mo.PARTS["mon-post"] === "core");

  const wr = (over = {}, created = "2026-10-03T09:41:00Z") => Mo.resolve({ eventName: "workflow_run", repository: G.REPO,
    now: at(created) + 40 * MIN, event: { workflow_run: { id: 123456789, path: ".github/workflows/weekly-refresh.yml",
      head_repository: { full_name: G.REPO }, head_branch: "main", event: "schedule", created_at: created, ...over } } });
  for (const ev of ["schedule", "push", "workflow_dispatch"]) {
    const r = wr({ event: ev });
    check(`13 valid Saturday workflow_run (event ${ev}) -> sat, date, trigger = run id`,
      r.mode === "sat" && r.date === "2026-10-03" && r.trigger === "123456789" && r.parts === "links core", JSON.stringify(r));
  }
  check("13 workflow_run on a Sunday -> sun", wr({}, "2026-10-04T09:30:00Z").mode === "sun");
  check("13 workflow_run on a Monday -> mon-pre", wr({}, "2026-10-05T09:44:00Z").mode === "mon-pre");
  for (const d of ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]) {
    const r = wr({}, d + "T09:40:00Z");
    check(`13 workflow_run on ${d} (Tue-Fri) -> idle weekday`, r.mode === "idle" && r.idle_reason === "weekday");
  }
  const guards = [
    [{ path: ".github/workflows/other.yml" }, "path"],
    [{ head_repository: { full_name: "someone/fork" } }, "repo"],
    [{ head_repository: null }, "repo"],
    [{ head_branch: "claude/x" }, "branch"],
    [{ event: "pull_request" }, "event"],
    [{ event: "pull_request_target" }, "event"],
  ];
  for (const [over, reason] of guards) {
    const r = wr(over);
    check(`13 source guard: Saturday workflow_run with ${JSON.stringify(over)} -> idle ${reason}`,
      r.mode === "idle" && r.idle_reason === reason && r.parts === "", JSON.stringify(r));
  }
  const disp = (mode, now) => Mo.resolve({ eventName: "workflow_dispatch", event: { inputs: mode === undefined ? {} : { mode } },
    repository: G.REPO, now: at(now) });
  check("workflow_dispatch dry -> today, trigger dispatch", disp("dry", "2026-10-07T11:00:00Z").date === "2026-10-07" &&
    disp("dry", "2026-10-07T11:00:00Z").trigger === "dispatch");
  check("workflow_dispatch with no input -> dry", disp(undefined, "2026-10-07T11:00:00Z").mode === "dry");
  check("workflow_dispatch mon-post on a Wednesday -> that week's Monday", disp("mon-post", "2026-10-07T11:00:00Z").date === "2026-10-05");
  let bad = false;
  try { disp("sat&part=seed", "2026-10-07T11:00:00Z"); } catch { bad = true; }
  check("workflow_dispatch with an injected mode fails the step", bad);
  check("any other event -> idle event", Mo.resolve({ eventName: "push", event: {}, repository: G.REPO, now: Date.now() }).idle_reason === "event");
  // main(): reads the event file, writes GITHUB_OUTPUT
  const dir = mkdtempSync(join(tmpdir(), "mp-mode-"));
  writeFileSync(join(dir, "event.json"), JSON.stringify({ workflow_run: { id: 42, path: ".github/workflows/weekly-refresh.yml",
    head_repository: { full_name: G.REPO }, head_branch: "main", event: "schedule", created_at: "2026-10-04T09:30:00Z" } }));
  writeFileSync(join(dir, "out"), "");
  const r = await capture(Mo.main)({ GITHUB_EVENT_NAME: "workflow_run", GITHUB_EVENT_PATH: join(dir, "event.json"),
    GITHUB_REPOSITORY: G.REPO, GITHUB_OUTPUT: join(dir, "out") }, at("2026-10-04T10:15:00Z"));
  const out = readText(join(dir, "out"));
  check("mode.mjs main(): GITHUB_OUTPUT gets mode, date, trigger, parts, idle_reason",
    r.mode === "sun" && /^mode=sun$/m.test(out) && /^date=2026-10-04$/m.test(out) && /^trigger=42$/m.test(out) &&
    /^parts=links seed core$/m.test(out) && /^idle_reason=$/m.test(out), out);
}

// ════════════════════════════════════════════════════════════════════════════
// 16. facts.mjs
// ════════════════════════════════════════════════════════════════════════════
// A healthy world for `date`, with the fork/branch/pull_request decoys the
// contract says must not count.
function world(date, o = {}) {
  const d0 = at(date + "T00:00:00Z");
  const runs = [];
  const monday = (k) => { const x = new Date(d0 - DAY); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.getTime() - k * 7 * DAY; };
  for (let k = 0; k < 4; k++) {
    const m = monday(k);
    runs.push(G.refreshRun(m + 9 * HOUR + 5 * MIN));
    runs.push(G.run({ file: "weekly-feed.yml", created: m + 12 * HOUR + 3 * MIN, started: m + 12 * HOUR + 5 * MIN }));
    runs.push(G.run({ file: "send-watchdog.yml", created: m + 13 * HOUR }));
    runs.push(G.run({ file: "send-watchdog.yml", created: m + DAY + 13 * HOUR }));
  }
  if (o.refreshToday !== false) runs.push(G.refreshRun(o.refreshAt ?? d0 + 9 * HOUR, o.refresh || {}));
  runs.push(G.run({ file: "monday-rehearsal.yml", created: d0 - 18 * HOUR, event: "schedule" }));
  // decoys on the date: a fork, a branch and a pull_request run, all newest
  runs.push(G.refreshRun(d0 + 15 * HOUR, { buildFails: true, run: { repo: "someone/fork" } }));
  runs.push(G.refreshRun(d0 + 16 * HOUR, { buildFails: true, run: { branch: "claude/x" } }));
  runs.push(G.refreshRun(d0 + 17 * HOUR, { buildFails: true, run: { event: "pull_request" } }));
  runs.push(G.run({ file: "weekly-feed.yml", created: d0 + 18 * HOUR, status: "in_progress", event: "pull_request_target" }));
  runs.push(...(o.runs || []));
  const F = G.sha("a"), later = G.sha("b");
  const commits = o.commits || [G.commit(F, d0 - 3 * DAY, ["functions/api/x.js"]), G.commit(later, d0 - 2 * DAY, ["data.json"])];
  const checkRuns = o.checkRuns || { [F]: [G.pagesRun("success")], [later]: [G.pagesRun("success")] };
  return G.ghWorld({ runs, commits, checkRuns, now: o.now, status: o.status });
}
function clock(start) {
  let t = at(start);
  let sleeps = 0;
  return { now: () => t, sleep: async (ms) => { sleeps++; t += ms; }, get sleeps() { return sleeps; } };
}
const WEEKLY_SEND = "export async function onRequest() { /* selectRecipients */ }";
const PUSH_FILES = [
  { file: "weekly-refresh.yml", text: "name: x\non:\n  schedule:\n    - cron: \"0 9 * * 1\"\n  push:\n    branches: [main]\n" },
  { file: "weekly-feed.yml", text: "name: y\non:\n  schedule:\n    - cron: \"0 12 * * 1\"\n  workflow_dispatch: {}\n" },
  { file: "other.yml", text: "name: z\non: [push, pull_request]\n" },
  { file: "comment.yml", text: "name: c\non:\n  workflow_dispatch: {}   # no push: here\n" },
];
async function factsFor(date, nowIso, o = {}) {
  const c = clock(nowIso);
  const w = world(date, { ...o, now: c.now });
  const facts = await Fa.collect({ gh: w.gh, date, mode: o.mode || "sat", repository: G.REPO, runId: "999",
    now: c.now, sleep: c.sleep, readText: (p) => (p === "functions/api/weekly-send.js" ? (o.weeklySend ?? WEEKLY_SEND) : null),
    workflowFiles: PUSH_FILES });
  return { facts, paths: w.paths, sleeps: c.sleeps };
}
const MIRROR_FACTS = { mirror: "ok", purchase: { render: "ok", link_first: true, month_line: false },
  c8: { min_cents: 500, events_mirror: "ok" }, c17: { inbox_mirror: "ok" } };
const C14_FACTS = { c14: { fetched: true, house_numbers: 0, contractor_echo: 0, owner_cue: 0, email_like: 0, hex32: 0 } };
// R3b: the C15 scan and C22 step outputs (their own tests: r3b_runner.test.mjs).
const C15_FACTS = { c15: { secrets: 0, workflow_tokens: 0, private_files: 0, ignore_missing: 0, route_home: true } };
const C22_FACTS = { c22: { dmarc: "same", spf: "same", dkim: "same", mx: "same" } };
{
  const { facts, paths, sleeps } = await factsFor("2026-10-03", "2026-10-03T20:30:00Z");
  const line = Fa.finalize(Fa.merge(facts, C14_FACTS, MIRROR_FACTS, C15_FACTS, C22_FACTS));
  const v = validateRunnerFacts(JSON.parse(line));
  const keys = Object.keys(RUNNER_SCHEMA);
  const absent = keys.filter((k) => fact(v.facts, k) === undefined);
  check("16 facts.mjs output (fixture API responses) validates against RUNNER_SCHEMA imported from _rehearsal.js: 0 dropped",
    v.dropped.length === 0, v.dropped.join(","));
  check("16 ... and carries every RUNNER_SCHEMA key", absent.length === 0, absent.join(","));
  check("16 one line of JSON, at most 4 KB", !line.includes("\n") && Buffer.byteLength(line) <= 4096, Buffer.byteLength(line));
  const runsReq = paths.filter((p) => /\/runs(\?|$)/.test(p) && !/^actions\/runs\//.test(p));
  check("16 every runs listing request is by workflow file (/actions/workflows/<file>.yml/runs)",
    runsReq.length > 0 && runsReq.every((p) => /^actions\/workflows\/[a-z-]+\.yml\/runs\?/.test("" + p) && ("/" + p).includes("/actions/workflows/")),
    runsReq.join(" "));
  check("16 no request lists runs by name or across the repo", !paths.some((p) => /^actions\/runs\?|[?&]name=/.test(p)));
  check("16 the fork, branch and pull_request decoy runs on the date are not counted",
    facts.refresh.runs === 1 && facts.refresh.state === "completed" && facts.refresh.conclusion === "success" &&
    facts.send.state === "none", JSON.stringify([facts.refresh, facts.send]));
  check("refresh.shipped_min: the ship step's completed_at in minutes (09:35 -> 575)",
    facts.refresh.shipped_min.join() === "575,-1,-1,-1" && facts.refresh.ship_step === "success" && facts.refresh.failed_at === "none");
  check("refresh.started_min 541 (run_started_at), refresh_late_min 1", facts.refresh.started_min === 541 && facts.c9.refresh_late_min === 1);
  check("c9.mon_send_start: last 4 Mondays, 12:05 -> 725 each", facts.c9.mon_send_start.join() === "725,725,725,725");
  check("c9.mon_refresh_start and mon_watchdog_start filled", facts.c9.mon_refresh_start.every((x) => x === 546) &&
    facts.c9.mon_watchdog_start.every((x) => x === 781));
  check("c9.guard1_present from weekly-send.js text", facts.c9.guard1_present === true);
  check("c9.push_workflows counts on: push keys (2 of 4 fixture files)", facts.c9.push_workflows === 2);
  check("c17: watchdog Monday and Tuesday present, previous rehearsal 38 h ago",
    facts.c17.watchdog_mon === true && facts.c17.watchdog_tue === true && facts.c17.rehearsal_prev_h === 38);
  check("c17.refresh_ok_age_h from the newest successful trusted refresh (10 h)", facts.c17.refresh_ok_age_h === 10, facts.c17.refresh_ok_age_h);
  check("F8 runner side: F 3 days old with success, no re-poll", facts.c0.fn_state === "success" && sleeps === 0 &&
    facts.c0.fn_sha7 === "aaaaaaa");
  check("api ok", facts.api === "ok");
  const noGuard = await factsFor("2026-10-03", "2026-10-03T20:30:00Z", { weeklySend: "export const x = 1;" });
  check("c9.guard1_present false when weekly-send.js lacks selectRecipients", noGuard.facts.c9.guard1_present === false);
}
{ // refresh states and failure positions
  const f = async (refresh, refreshAt) => (await factsFor("2026-10-03", "2026-10-03T20:30:00Z", { refresh, refreshAt })).facts.refresh;
  const b = await f({ buildFails: true });
  check("a build failure: conclusion failure, ship_step skipped, failed_at before_ship, shipped_min empty",
    b.conclusion === "failure" && b.ship_step === "skipped" && b.failed_at === "before_ship" && b.shipped_min.join() === "-1,-1,-1,-1");
  const s = await f({ shipFails: true });
  check("a ship failure: ship_step failure, failed_at ship", s.ship_step === "failure" && s.failed_at === "ship");
  const a = await f({ afterFails: true });
  check("a failure after the ship: ship_step success, failed_at after_ship, shipped_min kept",
    a.ship_step === "success" && a.failed_at === "after_ship" && a.shipped_min[0] === 575);
  const q = await f({ run: { status: "in_progress" } });
  check("a running refresh: state in_progress, conclusion none", q.state === "in_progress" && q.conclusion === "none");
  const none = (await factsFor("2026-10-03", "2026-10-03T20:30:00Z", { refreshToday: false })).facts.refresh;
  check("no trusted refresh on the date: state none, runs 0 (the fork's run does not count)", none.state === "none" && none.runs === 0);
  const two = (await factsFor("2026-10-03", "2026-10-03T20:30:00Z",
    { runs: [G.refreshRun(at("2026-10-03T13:25:00Z"), { shipAfter: 35 * MIN })] })).facts.refresh;
  check("two refreshes on the date: runs 2, shipped_min ascending [575, 840]", two.runs === 2 && two.shipped_min.join() === "575,840,-1,-1");
}
{ // F1 runner side: Tuesday 13:05Z backstop, date = Monday; Tuesday's refresh is not Monday's
  const date = Mo.resolve({ eventName: "schedule", event: { schedule: "0 13 * * 2" }, repository: G.REPO, now: at("2026-10-06T13:05:00Z") }).date;
  const { facts } = await factsFor(date, "2026-10-06T13:05:00Z", { mode: "mon-post", runs: [
    G.run({ file: "weekly-feed.yml", created: at("2026-10-05T14:00:00Z"), started: at("2026-10-05T14:01:00Z") }),
    G.refreshRun(at("2026-10-06T12:05:00Z"), { shipAfter: 46 * MIN }),
  ] });
  check("F1 runner: date resolves to Monday 2026-10-05", date === "2026-10-05");
  check("F1 runner: refresh facts are Monday's only (runs 1, shipped_min [575]); Tuesday's 12:51Z ship is not counted",
    facts.refresh.runs === 1 && facts.refresh.shipped_min.join() === "575,-1,-1,-1", JSON.stringify(facts.refresh));
  check("F1 runner: send completed, started 14:01 (841)", facts.send.state === "completed" && facts.send.started_min === 841);
}
{ // F7 runner side: F pushed 2 min ago, no check-run anywhere
  const now = "2026-10-03T20:30:00Z";
  const F = G.sha("d");
  const r = await factsFor("2026-10-03", now, { commits: [G.commit(F, at(now) - 2 * MIN, ["functions/api/x.js"])], checkRuns: {} });
  check("F7 runner: re-polls every 60 s, 5 times, then reports missing", r.sleeps === Fa.REPOLL_TIMES && r.facts.c0.fn_state === "missing");
  check("F7 runner: fn_age_min is measured after the re-poll (2 + 5 = 7 < 15)", r.facts.c0.fn_age_min === 7, r.facts.c0.fn_age_min);
  check("F7 runner: HEAD is F, no check-run -> head_state missing", r.facts.c0.head_state === "missing");
  const late = await factsFor("2026-10-03", now, { commits: [G.commit(F, at(now) - 2 * MIN, ["functions/api/x.js"])],
    checkRuns: { [F]: (t) => (t >= at(now) + 3 * MIN ? [G.pagesRun("success")] : []) } });
  check("F7 runner: a check-run that appears on the 3rd re-poll -> success after 3 sleeps", late.facts.c0.fn_state === "success" && late.sleeps === 3);
}
{ // F8 runner side: F 3 days old with success, HEAD a bot commit 20 s old with no check-run
  const now = "2026-10-03T20:30:00Z";
  const F = G.sha("a"), bot = G.sha("e");
  const r = await factsFor("2026-10-03", now, { commits: [G.commit(F, at(now) - 3 * DAY, ["functions/api/x.js"]),
    G.commit(bot, at(now) - 20_000, ["data.json"])], checkRuns: { [F]: [G.pagesRun("success")] } });
  check("F8 runner: fn_state success, head_state missing, no re-poll", r.facts.c0.fn_state === "success" &&
    r.facts.c0.head_state === "missing" && r.sleeps === 0 && r.facts.c0.fn_age_min === 3 * 24 * 60);
  const fail = await factsFor("2026-10-03", now, { commits: [G.commit(F, at(now) - 3 * DAY, ["functions/api/x.js"]),
    G.commit(bot, at(now) - 2 * DAY, ["data.json"])], checkRuns: { [F]: [G.pagesRun("failure")], [bot]: [G.pagesRun("failure")] } });
  check("I-05 runner: every completed check-run failed -> fn_state failure", fail.facts.c0.fn_state === "failure");
  const mixed = await factsFor("2026-10-03", now, { commits: [G.commit(F, at(now) - 3 * DAY, ["functions/api/x.js"]),
    G.commit(bot, at(now) - 2 * DAY, ["data.json"])], checkRuns: { [F]: [G.pagesRun("failure")], [bot]: [G.pagesRun("success")] } });
  check("a later main commit's successful build deploys F -> success", mixed.facts.c0.fn_state === "success");
  const forb = await factsFor("2026-10-03", now, { status: { "check-runs": 403 } });
  check("check-runs unreadable (403) -> c0 error, api still ok (C0 does not blind the Actions facts)",
    forb.facts.c0.fn_state === "error" && forb.facts.api === "ok");
}
{ // F10 runner side: late weekend backstops keep their date
  for (const [cron, runAt, date] of [["0 20 * * 6", "2026-10-04T02:00:00Z", "2026-10-03"], ["0 20 * * 0", "2026-10-05T02:00:00Z", "2026-10-04"]]) {
    const m = Mo.resolve({ eventName: "schedule", event: { schedule: cron }, repository: G.REPO, now: at(runAt) });
    const { facts } = await factsFor(m.date, runAt, { refreshAt: at(m.date + "T13:25:00Z") });
    check(`F10 runner: ${cron} at ${runAt} -> ${m.mode} ${m.date}, that date's refresh completed, shipped 14:00 (840)`,
      m.date === date && facts.refresh.state === "completed" && facts.refresh.conclusion === "success" &&
      facts.refresh.shipped_min[0] === 840, JSON.stringify([m, facts.refresh.shipped_min]));
  }
}
{ // api health
  const f403 = await factsFor("2026-10-03", "2026-10-03T20:30:00Z", { status: { "^actions/workflows/": 403 } });
  check("runs listing 403 -> api forbidden (the Function then blinds the Actions facts)", f403.facts.api === "forbidden");
  const w = G.ghWorld({ status: { "^actions/workflows/": 429 }, rateLimited: true });
  const rl = await Fa.collect({ gh: w.gh, date: "2026-10-03", repository: G.REPO, now: () => at("2026-10-03T20:30:00Z"),
    sleep: async () => {}, readText: () => null, workflowFiles: [] });
  check("runs listing 429 -> api rate_limited", rl.api === "rate_limited");
}
{ // push runs and Monday-sensitive commits
  const date = "2026-10-05";
  const d0 = at(date + "T00:00:00Z");
  const { facts } = await factsFor(date, "2026-10-05T16:00:00Z", { mode: "mon-pre", runs: [
    G.refreshRun(d0 - 5 * HOUR, { run: { event: "push", head_sha: G.sha("1") } }),
    G.refreshRun(d0 - 4 * HOUR, { run: { event: "push", head_sha: G.sha("2") } }),
    G.run({ file: "weekly-feed.yml", created: d0 + 14 * HOUR, started: d0 + 14 * HOUR + MIN }),
  ], commits: [G.commit(G.sha("a"), d0 - 3 * DAY, ["functions/api/x.js"]),
    G.commit(G.sha("3"), d0 + 10 * HOUR, [".github/workflows/send-watchdog.yml"]),
    G.commit(G.sha("4"), d0 + 15 * HOUR, [".github/workflows/weekly-feed.yml"])] });
  check("c9.push_runs / push_commits: push-event runs of push workflows since the previous rehearsal run",
    facts.c9.push_runs === 2 && facts.c9.push_commits === 2, JSON.stringify(facts.c9));
  check("c9.monday_sensitive: a Monday commit to send-watchdog.yml before the send counts, one after it does not (I-18 runner side)",
    facts.c9.monday_sensitive === 1, facts.c9.monday_sensitive);
}
{ // pushWorkflows line rules
  const pw = Fa.pushWorkflows(PUSH_FILES);
  check("pushWorkflows: block push:, inline [push, ...]; not a comment, not workflow_dispatch only", pw.join() === "other.yml,weekly-refresh.yml", pw.join());
  const real = Fa.pushWorkflows(readdirSync(join(REPO, ".github", "workflows")).filter((f) => f.endsWith(".yml"))
    .map((f) => ({ file: f, text: readText(join(REPO, ".github", "workflows", f)) })));
  check("pushWorkflows on this repo's workflows includes weekly-refresh.yml", real.includes("weekly-refresh.yml"), real.join());
}
{ // facts.mjs main(): one line on stdout and in GITHUB_OUTPUT
  const dir = mkdtempSync(join(tmpdir(), "mp-facts-"));
  writeFileSync(join(dir, "c14.json"), JSON.stringify(C14_FACTS));
  writeFileSync(join(dir, "mirror.json"), JSON.stringify(MIRROR_FACTS));
  writeFileSync(join(dir, "out"), "");
  const c = clock("2026-10-03T20:30:00Z");
  const w = world("2026-10-03", { now: c.now });
  const line = await capture(Fa.main)({ MODE: "sat", DATE: "2026-10-03", GITHUB_REPOSITORY: G.REPO, GITHUB_RUN_ID: "999",
    GITHUB_OUTPUT: join(dir, "out") }, [join(dir, "c14.json"), join(dir, "mirror.json")], { gh: w.gh, now: c.now, sleep: c.sleep });
  const out = readFileSync(join(dir, "out"), "utf8");
  check("facts.mjs main(): GITHUB_OUTPUT gets facts=<the same one line>", out === `facts=${line}\n`);
  const v = validateRunnerFacts(JSON.parse(line));
  check("facts.mjs main(): merged c14 + mirror facts validate with 0 dropped", v.dropped.length === 0 &&
    fact(v.facts, "c14.fetched") === true && fact(v.facts, "mirror") === "ok");
  const bad = Fa.finalize({ v: 1, api: "ok", mirror: "sideways", extra: "x", refresh: { runs: 1.5 } });
  check("finalize drops a bad enum, a bad int and an unknown key", bad === '{"v":1,"api":"ok"}', bad);
}

// ════════════════════════════════════════════════════════════════════════════
// C14: the sample scan
// ════════════════════════════════════════════════════════════════════════════
// A small ZIP writer (deflate and stored) so the reader is tested on real zips.
function zip(files, method = 8) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), raw = enc.encode(text);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, data);
    central.push(ch, nb);
    off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}
const CSV_HEAD = "Town,Permit Type,Description,Value,Contractor,Owner\n";
const clean = [["MassPermits-sample.csv", CSV_HEAD +
  "Barnstable,Roofing,\"Strip and re-roof, 2 layers\",18500,(subscribers only),(subscribers only)\n" +
  "Bourne,Solar,Roof-mounted PV 7.2 kW,24000,,\n" +
  "Boston,Deck,Replace rear deck,9000,(subscribers only),\n"],
  ["README.txt", "This free sample shows 3 of this week's permits. Contractor and owner details are in the paid file.\n"]];
{
  const c = C14.scan(C14.unzip(zip(clean)));
  check("C14 clean sample -> every count 0", Object.values(c).every((x) => x === 0), JSON.stringify(c));
  const stored = C14.scan(C14.unzip(zip(clean, 0)));
  check("C14 reads stored (uncompressed) entries too", Object.values(stored).every((x) => x === 0));
  const withText = (desc) => [[clean[0][0], clean[0][1].replace("Replace rear deck", desc)], clean[1]];
  const i20 = C14.scan(C14.unzip(zip(withText("Replace rear deck at 14 Quarry Hill Rd"))));
  check("I-20 runner: a house number in a description -> house_numbers 1", i20.house_numbers === 1, JSON.stringify(i20));
  const i20t = C14.scan(C14.unzip(zip(withText("Replace rear deck on 2 posts"))));
  check("I-20 twin: numbers without a street -> 0", i20t.house_numbers === 0);
  const i21 = C14.scan(C14.unzip(zip(withText("New porch for the owners of Quimbly Farm"))));
  check("I-21 runner: \"the owners of <invented name>\" -> owner_cue > 0", i21.owner_cue > 0, JSON.stringify(i21));
  const i21t = C14.scan(C14.unzip(zip(withText("New porch paid by the owners of the property"))));
  check("I-21 twin: \"the owners of the property\" -> 0", i21t.owner_cue === 0);
  const col = C14.scan(C14.unzip(zip([["s.csv", CSV_HEAD + "Bourne,Roofing,x,1,Zenith Roofing Co,Pat Invented\n"]])));
  check("C14 an unmasked contractor and owner column value -> contractor_echo 1, owner_cue 1",
    col.contractor_echo === 1 && col.owner_cue === 1, JSON.stringify(col));
  const em = C14.scan(C14.unzip(zip([["r.txt", "Questions: sample.person@example.com token " + "f".repeat(32)]])));
  check("C14 an email and a 32-hex string -> email_like 1, hex32 1", em.email_like === 1 && em.hex32 === 1);
  sampleBytes = zip(clean);
  const ok = await C14.c14Facts();
  check("C14 through getSample(): fetched true, counts 0", ok.fetched === true && ok.house_numbers === 0);
  sampleBytes = null;
  const miss = await C14.c14Facts();
  check("C14 sample 404 -> fetched false, every count -1 (the Function reads BLIND)", miss.fetched === false &&
    Object.entries(miss).filter(([k]) => k !== "fetched").every(([, v]) => v === -1));
  const junk = await C14.c14Facts(async () => ({ status: 200, bytes: new TextEncoder().encode("not a zip at all") }));
  check("C14 a body that is not a zip -> fetched false", junk.fetched === false);
  sampleBytes = zip(clean);
  const lines = [];
  console.log = (...x) => lines.push(x.join(" "));
  try { await C14.main(); } finally { console.log = realLog; }
  printed.push(...lines);
  check("C14 main(): one line {\"c14\": {...}}", lines.length === 1 && JSON.parse(lines[0]).c14.fetched === true);
  sampleBytes = null;
}

// ════════════════════════════════════════════════════════════════════════════
// the mirror step
// ════════════════════════════════════════════════════════════════════════════
{
  const shipped = Mi.c8Facts();
  check("c8 facts from the shipped stripe-webhook.js: min_cents 500, events_mirror ok",
    shipped.min_cents === 500 && shipped.events_mirror === "ok", JSON.stringify(shipped));
  const dir = mkdtempSync(join(tmpdir(), "mp-c8-"));
  const src = readText(join(API_DIR, "stripe-webhook.js"));
  const put = (name, s) => { writeFileSync(join(dir, name), s); return join(dir, name); };
  const m1000 = Mi.c8Facts(put("a.js", src.replace("const MIN_CENTS = 500;", "const MIN_CENTS = 1000;")));
  check("I-04 runner: MIN_CENTS mutated to 1000 in a temp copy -> c8.min_cents 1000", m1000.min_cents === 1000);
  check("c8: two MIN_CENTS lines -> -1", Mi.c8Facts(put("b.js", src + "\nconst MIN_CENTS = 700;\n")).min_cents === -1);
  check("c8: no MIN_CENTS line -> -1", Mi.c8Facts(put("c.js", src.replace("const MIN_CENTS = 500;", "const FLOOR = 500;"))).min_cents === -1);
  const extra = Mi.c8Facts(put("d.js", src + '\nif (event.type === "customer.subscription.updated") {}\n'));
  check("c8: a new event.type literal -> events_mirror drift", extra.events_mirror === "drift");
  const fewer = Mi.c8Facts(put("e.js", src.replace('event.type === "review.closed"', 'event.kind === "review.closed"')));
  check("c8: a handled event removed -> events_mirror drift", fewer.events_mirror === "drift");
  check("c8: unreadable file -> events_mirror error, min_cents -1", Mi.c8Facts(join(dir, "missing.js")).events_mirror === "error");
  // runTest's reading of a child's RESULT line
  const t = mkdtempSync(join(tmpdir(), "mp-mirror-"));
  writeFileSync(join(t, "pass.test.mjs"), 'console.log("RESULT x pass=3 fail=0");\n');
  writeFileSync(join(t, "fail.test.mjs"), 'console.log("RESULT x pass=2 fail=1"); process.exitCode = 1;\n');
  writeFileSync(join(t, "crash.test.mjs"), 'throw new Error("boom");\n');
  check("runTest: exit 0 with fail=0 -> ok; fail>0 -> drift; no RESULT -> error",
    Mi.runTest("pass.test.mjs", t).state === "ok" && Mi.runTest("fail.test.mjs", t).state === "drift" &&
    Mi.runTest("crash.test.mjs", t).state === "error");
  // the real step against the shipped code
  const lines = [];
  console.log = (...x) => lines.push(x.join(" "));
  let f;
  try { f = Mi.main(); } finally { console.log = realLog; }
  printed.push(...lines);
  check("mirror step on the shipped code: mirror ok, inbox ok, purchase rendered, c8 ok",
    f.mirror === "ok" && f.c17.inbox_mirror === "ok" && f.purchase.render === "ok" && f.c8.events_mirror === "ok", JSON.stringify(f));
  check("mirror step reports today's purchase copy: link_first true, month_line true (C5 NO-GO C5.purchase_copy)",
    f.purchase.link_first === true && f.purchase.month_line === true);
  const v = validateRunnerFacts({ v: 1, ...f });
  check("mirror step output validates against RUNNER_SCHEMA", v.dropped.length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. runner stdout is leak-free
// ════════════════════════════════════════════════════════════════════════════
{
  const street = /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Rd|Road|Ave|Avenue|Ln|Lane|Dr|Drive|Way|Ct|Court)\b/;
  const bad = printed.filter((l) => l.includes("@") || /[0-9a-f]{32}/i.test(l) || l.includes("cus_") || street.test(l));
  check(`7 every runner stdout line (${printed.length}) has no "@", 32-hex, "cus_" or street`, printed.length >= 4 && bad.length === 0,
    bad.join(" | "));
}
check("10 fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
check("10 every runner request was a GET to the GitHub API base or the sample URL",
  stub.calls.every((c) => c.method === "GET" && (c.url.startsWith(GH) || c.url === "https://masspermits.com/api/sample")));
done();
