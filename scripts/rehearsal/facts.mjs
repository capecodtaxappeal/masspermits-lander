// MassPermits monday rehearsal: the RUNNER FACTS (Node built-ins only).
//
//   MODE=sat DATE=2026-10-03 node scripts/rehearsal/facts.mjs [c14.json] [mirror.json]
//
// Emits ONE line of JSON: the facts object the caller POSTs to the rehearsal
// Function. Values are only enums, booleans, integers in [-1, 100000], fixed
// arrays of four integers and one 7-hex short SHA (RUNNER_SCHEMA in
// functions/api/_rehearsal.js; the output is validated against it before it is
// printed). No names, messages or URLs. The optional files hold the C14 and
// mirror-step facts, merged in.
//
// Every GitHub read is a GET through ghGet() in http.mjs. Workflow runs are
// listed BY WORKFLOW FILE (actions/workflows/<file>.yml/runs), never by name,
// and a run counts only if it is on head_branch "main", from this repository
// (head_repository.full_name == GITHUB_REPOSITORY) and not a pull_request or
// pull_request_target event, so a fork's run can neither fake a refresh nor
// hide one. Minutes count from 00:00Z of DATE (each c9.mon_* entry from 00:00Z
// of its own Monday).
//
// Choices where the contract leaves room (documented in the PR):
//   refresh.started_min / send.started_min: the EARLIEST run created on DATE
//     (the scheduled one, and the send that matters for the ordering rule).
//   refresh.completed_min: the newest completed run on DATE.
//   c9.push_runs / c9.push_commits: runs with event "push" of the workflows
//     whose on: has a push: key, created since this workflow's previous run
//     (or 7 days before DATE), and the distinct commits that triggered them.
//   c17.watchdog_mon / _tue: send-watchdog.yml ran on the most recent Tuesday
//     strictly before DATE, and on the Monday before that Tuesday.
//   c15.feed_log_emails (R3b; sat, sun and dry only): email-shaped strings in
//     the job logs of this week's weekly-feed.yml runs (created from 00:00Z of
//     the Monday on or before DATE), GitHub's own noreply addresses excepted.
//     weekly-feed.yml prints the weekly-send response, which lists every
//     recipient, into a log anyone can read on a public repo. The logs are
//     read through ghJobLog() in http.mjs, kept in memory and never printed;
//     only the count leaves. -1 when any log could not be read.

import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRunnerFacts, FACTS_MAX_BYTES } from "../../functions/api/_rehearsal.js";
import { ghGet, ghJobLog } from "./http.mjs";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const WORKFLOWS = { refresh: "weekly-refresh.yml", send: "weekly-feed.yml",
  watchdog: "send-watchdog.yml", rehearsal: "monday-rehearsal.yml" };
const SHIP_STEP = "Ship bundles to R2";
const PAGES_CHECK = "Cloudflare Pages";
export const REPOLL_MS = 60_000;
export const REPOLL_TIMES = 5;
const MAX_RUN_PAGES = 5;
const MAX_FN_COMMITS = 20;
const SENSITIVE = ["weekly-feed.yml", "send-watchdog.yml", "weekly-refresh.yml"];
const MAX_LOG_JOBS = 10;
const EXTENDED_MODES = ["sat", "sun", "dry"];
// An email-shaped string. GitHub's own bot identities (users.noreply.github.com)
// are not customer data and are not counted.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
export function countEmails(text) {
  let n = 0;
  for (const m of String(text).matchAll(EMAIL_RE)) {
    if (!/@users\.noreply\.github\.com$/i.test(m[0])) n++;
  }
  return n;
}

const dateMs = (d) => Date.parse(d + "T00:00:00Z");
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const clampInt = (n) => (Number.isFinite(n) ? Math.max(-1, Math.min(100000, Math.floor(n))) : -1);
const minutesFrom = (iso, base) => {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) && t >= base ? clampInt((t - base) / MIN) : -1;
};
const runState = (s) => (s === "completed" ? "completed" : s === "in_progress" ? "in_progress"
  : ["queued", "waiting", "requested", "pending"].includes(s) ? "queued" : "queued");
const CONCLUSIONS = ["success", "failure", "cancelled", "timed_out", "skipped"];
const conclusionOf = (c) => (CONCLUSIONS.includes(c) ? c : "failure");
const STEP_STATES = ["success", "failure", "skipped", "cancelled"];
// The newest-first sort every run list uses.
const byCreatedDesc = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);
const startedAt = (r) => r.run_started_at || r.created_at;

// Which workflow files have a push: key under on:. Line rules, no YAML
// dependency: `on: push`, `on: [push, ...]`, or an indented `push:` inside the
// top-level on: block.
export function pushWorkflows(files) {
  const out = [];
  for (const { file, text } of files) {
    const lines = String(text).split("\n");
    let inOn = false, hit = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+#.*$/, "");
      if (/^on:\s*(\S.*)?$/.test(line) || /^"on":/.test(line)) {
        const rest = line.replace(/^"?on"?:\s*/, "");
        if (/(^|[\s\[,])push([\s\],]|$)/.test(rest)) hit = true;
        inOn = rest === "";
        continue;
      }
      if (inOn && /^\S/.test(line)) inOn = false;
      if (inOn && /^\s+push\s*:/.test(line)) hit = true;
    }
    if (hit) out.push(file);
  }
  return out.sort();
}

function readWorkflowDir(root) {
  const dir = join(root, ".github", "workflows");
  try {
    return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()
      .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));
  } catch { return []; }
}

// collect(opts) -> the facts object (not yet validated).
// opts: {gh, date, mode, repository, runId, now: () => ms, sleep: (ms) => Promise,
//        readText(relPath) -> string|null, workflowFiles: [{file, text}]}
export async function collect(opts) {
  const { gh, date, repository } = opts;
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const readText = opts.readText || ((p) => { try { return readFileSync(join(REPO_ROOT, p), "utf8"); } catch { return null; } });
  const workflowFiles = opts.workflowFiles || readWorkflowDir(REPO_ROOT);
  const runId = String(opts.runId || "");
  const d0 = dateMs(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !Number.isFinite(d0)) throw new Error("bad date");

  // Actions API health: only the Actions and commits reads that feed the
  // refresh/send/c9/c17 facts decide `api`. C0's check-run reads report
  // through c0.* alone.
  let api = "ok";
  const worse = { ok: 0, error: 1, forbidden: 2, rate_limited: 3 };
  const note = (r) => {
    const k = r.rateLimited ? "rate_limited" : r.status === 403 ? "forbidden" : "error";
    if (worse[k] > worse[api]) api = k;
  };
  const get = async (path) => {
    const r = await gh(path);
    if (!r || !r.ok) { note(r || { status: 0 }); return null; }
    return r.json;
  };

  const trusted = (r) => r && typeof r === "object" && r.head_branch === "main" &&
    r.head_repository && r.head_repository.full_name === repository &&
    r.event !== "pull_request" && r.event !== "pull_request_target" &&
    Number.isFinite(Date.parse(r.created_at));
  const since = isoDay(d0 - 29 * DAY);
  async function runsOf(file) {
    const all = [];
    for (let page = 1; page <= MAX_RUN_PAGES; page++) {
      const j = await get(`actions/workflows/${file}/runs?branch=main&per_page=100&created=%3E%3D${since}&page=${page}`);
      if (!j || !Array.isArray(j.workflow_runs)) break;
      all.push(...j.workflow_runs);
      if (j.workflow_runs.length < 100) break;
    }
    return all.filter(trusted).sort(byCreatedDesc);
  }
  const onDay = (runs, day) => runs.filter((r) => isoDay(Date.parse(r.created_at)) === day);
  const jobsCache = new Map();
  async function stepsOf(run) {
    if (!/^[0-9]{1,20}$/.test(String(run.id))) return null;
    if (jobsCache.has(run.id)) return jobsCache.get(run.id);
    const j = await get(`actions/runs/${run.id}/jobs?per_page=100`);
    const steps = j && Array.isArray(j.jobs)
      ? j.jobs.flatMap((job, ji) => (Array.isArray(job.steps) ? job.steps : []).map((s) => ({ ...s, job: ji }))) : null;
    jobsCache.set(run.id, steps);
    return steps;
  }

  const log = opts.log || null;
  const facts = { v: 1 };
  const [refreshRuns, sendRuns, watchdogRuns, rehearsalRuns] = [
    await runsOf(WORKFLOWS.refresh), await runsOf(WORKFLOWS.send),
    await runsOf(WORKFLOWS.watchdog), await runsOf(WORKFLOWS.rehearsal)];

  // ── refresh.* ──────────────────────────────────────────────────────────
  const rToday = onDay(refreshRuns, date);
  const refresh = { state: "none", conclusion: "none", ship_step: "absent", failed_at: "none",
    runs: rToday.length, started_min: -1, completed_min: -1, shipped_min: [-1, -1, -1, -1] };
  if (rToday.length) {
    refresh.state = runState(rToday[0].status);
    const earliest = rToday[rToday.length - 1];
    refresh.started_min = minutesFrom(startedAt(earliest), d0);
    const done = rToday.find((r) => r.status === "completed");
    if (done) {
      refresh.conclusion = conclusionOf(done.conclusion);
      refresh.completed_min = minutesFrom(done.updated_at, d0);
      const steps = await stepsOf(done);
      if (steps) {
        const ship = steps.find((s) => String(s.name || "").startsWith(SHIP_STEP));
        refresh.ship_step = ship ? (STEP_STATES.includes(ship.conclusion) ? ship.conclusion : "failure") : "absent";
        const failed = steps.find((s) => s.conclusion === "failure");
        if (!failed) refresh.failed_at = "none";
        else if (!ship) refresh.failed_at = "before_ship";
        else if (failed === ship) refresh.failed_at = "ship";
        else {
          const order = (s) => s.job * 10000 + (Number(s.number) || 0);
          refresh.failed_at = order(failed) < order(ship) ? "before_ship" : "after_ship";
        }
      }
    }
    const shipped = [];
    for (const r of rToday) {
      const steps = await stepsOf(r);
      const ship = steps && steps.find((s) => String(s.name || "").startsWith(SHIP_STEP) && s.conclusion === "success");
      if (ship) { const m = minutesFrom(ship.completed_at, d0); if (m >= 0) shipped.push(m); }
    }
    shipped.sort((a, b) => a - b);
    refresh.shipped_min = [0, 1, 2, 3].map((i) => (i < shipped.length ? shipped[i] : -1));
  }
  facts.refresh = refresh;

  // ── send.* ─────────────────────────────────────────────────────────────
  const sToday = onDay(sendRuns, date);
  const send = { state: sToday.length ? runState(sToday[0].status) : "none", runs: sToday.length, started_min: -1 };
  if (sToday.length) send.started_min = minutesFrom(startedAt(sToday[sToday.length - 1]), d0);
  facts.send = send;

  // ── c9.* ───────────────────────────────────────────────────────────────
  const weeklySend = readText("functions/api/weekly-send.js");
  const mondays = [];
  { // the last 4 Mondays strictly before DATE, newest first
    const back = new Date(d0 - DAY);
    back.setUTCDate(back.getUTCDate() - ((back.getUTCDay() - 1 + 7) % 7));
    for (let k = 0; k < 4; k++) mondays.push(back.getTime() - k * 7 * DAY);
  }
  const firstStart = (runs, mon) => {
    const day = onDay(runs, isoDay(mon));
    return day.length ? minutesFrom(startedAt(day[day.length - 1]), mon) : -1;
  };
  const pushFiles = pushWorkflows(workflowFiles);
  const prev = rehearsalRuns.find((r) => String(r.id) !== runId && Date.parse(r.created_at) < now());
  const sinceMs = prev ? Date.parse(prev.created_at) : d0 - 7 * DAY;
  let pushRuns = 0;
  const pushShas = new Set();
  for (const file of pushFiles) {
    const runs = file === WORKFLOWS.refresh ? refreshRuns : file === WORKFLOWS.send ? sendRuns
      : file === WORKFLOWS.watchdog ? watchdogRuns : file === WORKFLOWS.rehearsal ? rehearsalRuns : await runsOf(file);
    for (const r of runs) {
      if (r.event === "push" && Date.parse(r.created_at) >= sinceMs) { pushRuns++; if (r.head_sha) pushShas.add(r.head_sha); }
    }
  }
  let sensitive = 0;
  if (new Date(d0).getUTCDay() === 1) {
    const until = send.started_min >= 0 ? d0 + send.started_min * MIN : Math.min(now(), d0 + DAY);
    const shas = new Set();
    for (const f of SENSITIVE) {
      const j = await get(`commits?sha=main&path=.github/workflows/${f}&since=${new Date(d0).toISOString()}` +
        `&until=${new Date(until).toISOString()}&per_page=100`);
      if (Array.isArray(j)) for (const c of j) if (c && c.sha) shas.add(c.sha);
    }
    sensitive = shas.size;
  }
  facts.c9 = {
    guard1_present: typeof weeklySend === "string" && weeklySend.includes("selectRecipients"),
    mon_refresh_start: mondays.map((m) => firstStart(refreshRuns, m)),
    mon_send_start: mondays.map((m) => firstStart(sendRuns, m)),
    mon_watchdog_start: mondays.map((m) => firstStart(watchdogRuns, m)),
    refresh_late_min: refresh.started_min >= 0 ? Math.max(0, refresh.started_min - 540) : -1,
    push_workflows: pushFiles.length,
    push_commits: clampInt(pushShas.size),
    push_runs: clampInt(pushRuns),
    monday_sensitive: clampInt(sensitive),
  };

  // ── c17.* ──────────────────────────────────────────────────────────────
  const okRefresh = refreshRuns.find((r) => r.status === "completed" && r.conclusion === "success");
  const tue = (() => { const t = new Date(d0 - DAY); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() - 2 + 7) % 7)); return t.getTime(); })();
  facts.c17 = {
    refresh_ok_age_h: okRefresh ? clampInt((now() - Date.parse(okRefresh.updated_at || okRefresh.created_at)) / HOUR) : -1,
    watchdog_mon: onDay(watchdogRuns, isoDay(tue - DAY)).length > 0,
    watchdog_tue: onDay(watchdogRuns, isoDay(tue)).length > 0,
    rehearsal_prev_h: prev ? clampInt((now() - Date.parse(prev.created_at)) / HOUR) : -1,
  };

  // ── c15.feed_log_emails (sat, sun, dry) ─────────────────────────────────
  if (EXTENDED_MODES.includes(opts.mode)) {
    facts.c15 = { feed_log_emails: await feedLogEmails({ gh, log, sendRuns, d0, now }) };
  }

  // ── c0.*: the deploy of F, the newest main commit touching functions/ ──
  facts.c0 = await c0Facts({ gh, now, sleep });
  facts.api = api;
  return facts;
}

// C0. F = the newest main commit touching functions/ (bot commits never do).
// fn_state is judged over the "Cloudflare Pages" check-run on F and on every
// later main commit (a later build deploys F's functions too): success if any
// succeeded; failure if every completed one failed; missing if none. The
// check-run appears only once complete (under a minute after a push), so a
// missing one is re-polled every 60 s for up to 5 min before it is reported.
export async function c0Facts({ gh, now, sleep }) {
  const out = { fn_state: "error", fn_age_min: -1, fn_sha7: undefined, head_state: "error" };
  const j = async (p) => { const r = await gh(p); return r && r.ok ? r.json : null; };
  const fl = await j("commits?sha=main&path=functions&per_page=1");
  const F = Array.isArray(fl) && fl[0] && typeof fl[0].sha === "string" ? fl[0] : null;
  if (!F) { delete out.fn_sha7; return out; }
  const fAt = Date.parse((F.commit && F.commit.committer && F.commit.committer.date) || "");
  const later = await j(`commits?sha=main&since=${Number.isFinite(fAt) ? new Date(fAt).toISOString() : ""}&per_page=100`);
  const head = await j("commits?sha=main&per_page=1");
  if (!Number.isFinite(fAt) || !Array.isArray(later) || !Array.isArray(head)) { delete out.fn_sha7; return out; }
  const shas = [F.sha, ...later.map((c) => c && c.sha).filter((s) => typeof s === "string" && s !== F.sha)]
    .filter((s) => /^[0-9a-f]{40}$/.test(s)).slice(0, MAX_FN_COMMITS);
  const headSha = head[0] && typeof head[0].sha === "string" && /^[0-9a-f]{40}$/.test(head[0].sha) ? head[0].sha : null;
  async function states(sha) {
    const r = await j(`commits/${sha}/check-runs?check_name=${encodeURIComponent(PAGES_CHECK)}&per_page=100`);
    if (!r || !Array.isArray(r.check_runs)) return null;
    const done = r.check_runs.filter((c) => c && c.name === PAGES_CHECK && c.status === "completed");
    return { success: done.some((c) => c.conclusion === "success"),
      failed: done.filter((c) => !["success", "neutral", "skipped"].includes(c.conclusion)).length,
      completed: done.length };
  }
  async function judge() {
    let any = false, failedAll = true, completed = 0;
    for (const sha of shas) {
      const s = await states(sha);
      if (!s) return "error";
      if (s.success) any = true;
      completed += s.completed;
      if (s.completed && s.failed < s.completed) failedAll = false;
    }
    if (any) return "success";
    if (completed > 0 && failedAll) return "failure";
    return "missing";
  }
  let st = await judge();
  for (let k = 0; st === "missing" && k < REPOLL_TIMES; k++) {
    await sleep(REPOLL_MS);
    st = await judge();
  }
  out.fn_state = st;
  out.fn_age_min = clampInt((now() - fAt) / MIN);
  out.fn_sha7 = F.sha.slice(0, 7);
  if (!headSha) out.head_state = "error";
  else {
    const h = await states(headSha);
    out.head_state = !h ? "error" : h.success ? "success" : h.completed ? "failure" : "missing";
  }
  return out;
}

// C15 runner half: the email-shaped strings in this week's weekly-feed.yml job
// logs. The week starts at 00:00Z of the Monday on or before DATE. Its reads
// go straight to gh(), not get(): a failed log read makes this fact -1 and
// leaves `api` (the refresh/send/c9/c17 facts) alone.
async function feedLogEmails({ gh, log, sendRuns, d0, now }) {
  if (typeof log !== "function") return -1;
  const monday = d0 - ((new Date(d0).getUTCDay() + 6) % 7) * DAY;
  const runs = sendRuns.filter((r) => { const t = Date.parse(r.created_at); return t >= monday && t <= now(); });
  const ids = [];
  for (const r of runs) {
    if (!/^[0-9]{1,20}$/.test(String(r.id))) return -1;
    const res = await gh(`actions/runs/${r.id}/jobs?per_page=100`);
    const j = res && res.ok ? res.json : null;
    if (!j || !Array.isArray(j.jobs)) return -1;
    for (const job of j.jobs) {
      if (!job || !/^[0-9]{1,20}$/.test(String(job.id))) return -1;
      ids.push(String(job.id));
    }
  }
  if (ids.length > MAX_LOG_JOBS) return -1;
  let n = 0;
  for (const id of ids) {
    let r;
    try { r = await log(id); } catch { return -1; }
    if (!r || r.ok !== true || typeof r.text !== "string") return -1;
    n += countEmails(r.text);
  }
  return clampInt(n);
}

// Merge extra fact objects (C14, mirror) into facts, deep by one level.
export function merge(facts, ...extras) {
  const out = JSON.parse(JSON.stringify(facts));
  for (const e of extras) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    for (const [k, v] of Object.entries(e)) {
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
        out[k] = { ...out[k], ...v };
      } else if (!(k in out)) out[k] = v;
    }
  }
  return out;
}

// finalize(facts) -> the one-line JSON: only keys RUNNER_SCHEMA accepts, and
// at most FACTS_MAX_BYTES.
export function finalize(facts) {
  const { facts: ok } = validateRunnerFacts(facts);
  const line = JSON.stringify(ok);
  if (new TextEncoder().encode(line).length > FACTS_MAX_BYTES) throw new Error("facts too large");
  return line;
}

export async function main(env = process.env, argv = process.argv.slice(2), deps = {}) {
  const gh = deps.gh || ghGet;
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
  const facts = await collect({ gh, log: deps.log || ghJobLog, date: env.DATE, mode: env.MODE,
    repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, now: deps.now, sleep: deps.sleep });
  const line = finalize(merge(facts, ...argv.map(readJson)));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `facts=${line}\n`);
  console.log(line);
  return line;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.log("facts: failed"); process.exitCode = 1; });
}
