// MassPermits monday rehearsal: resolve mode, date, trigger and parts from the
// event that started the runner job (Node built-ins only; no network).
//
//   node scripts/rehearsal/mode.mjs
//
// Reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH and GITHUB_REPOSITORY, writes
// mode, date, trigger, parts and idle_reason to GITHUB_OUTPUT, and prints them
// (enums, a date and a run id only). The workflow_dispatch "mode" input reaches
// this file only through the event JSON, never through the workflow text.
//
//   schedule "0 20 * * 6" sat, "0 20 * * 0" sun, "0 10 * * 1" mon-pre:
//     date = the latest date on or before now on the cron's weekday (a late
//     backstop keeps its day).
//   schedule "30 20 * * 1" and "0 13 * * 2": mon-post, date = the send
//     window's Monday, windowStart(now, {send_dow: 1}) from _presend.js (the
//     Tuesday backstop, and a Monday run delayed past midnight, are Monday's).
//   workflow_run: FIRST the source guard, then the weekday of created_at (UTC):
//     Sat sat, Sun sun, Mon mon-pre, Tue-Fri idle. trigger = the run id.
//   workflow_dispatch: the mode input; date = today UTC (the Monday rule for
//     mon-post); trigger "dispatch".
//   anything else: idle (event).

import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { windowStart } from "../../functions/api/_presend.js";

const DAY = 86400_000;
export const MODES = ["sat", "sun", "mon-pre", "mon-post", "dry"];
export const PARTS = { sat: "links core", "mon-pre": "links core", dry: "links core",
  sun: "links seed core", "mon-post": "core", idle: "" };
export const IDLE_REASONS = ["path", "repo", "branch", "event", "weekday"];
const SCHEDULES = {
  "0 20 * * 6": { mode: "sat", dow: 6 },
  "0 20 * * 0": { mode: "sun", dow: 0 },
  "0 10 * * 1": { mode: "mon-pre", dow: 1 },
  "30 20 * * 1": { mode: "mon-post" },
  "0 13 * * 2": { mode: "mon-post" },
};
const REFRESH_PATH = ".github/workflows/weekly-refresh.yml";
const REFRESH_EVENTS = ["schedule", "push", "workflow_dispatch"];

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// The latest date on or before `now` whose UTC weekday is `dow`.
export function latestOnOrBefore(now, dow) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return isoDay(d.getTime());
}
const mondayOf = (now) => isoDay(windowStart(now, { send_dow: 1 }));

const idle = (idle_reason) => ({ mode: "idle", date: "", trigger: "", parts: "", idle_reason });
const active = (mode, date, trigger) => ({ mode, date, trigger, parts: PARTS[mode], idle_reason: "" });

// resolve({eventName, event, repository, now}) -> {mode, date, trigger, parts, idle_reason}
// Throws only on a malformed event (the step then fails loudly).
export function resolve({ eventName, event, repository, now }) {
  const ev = event && typeof event === "object" ? event : {};
  if (eventName === "schedule") {
    const s = SCHEDULES[String(ev.schedule || "")];
    if (!s) throw new Error("unknown schedule");
    const date = s.mode === "mon-post" ? mondayOf(now) : latestOnOrBefore(now, s.dow);
    return active(s.mode, date, "sched");
  }
  if (eventName === "workflow_run") {
    const w = ev.workflow_run && typeof ev.workflow_run === "object" ? ev.workflow_run : {};
    // THE SOURCE GUARD. The workflow_run trigger matches by workflow NAME, so a
    // fork's pull request could add a same-named workflow, or give
    // weekly-refresh.yml a pull_request trigger, and fire this on main.
    if (w.path !== REFRESH_PATH) return idle("path");
    const head = w.head_repository && typeof w.head_repository === "object" ? w.head_repository : {};
    if (!repository || head.full_name !== repository) return idle("repo");
    if (w.head_branch !== "main") return idle("branch");
    if (!REFRESH_EVENTS.includes(w.event)) return idle("event");
    const created = Date.parse(String(w.created_at || ""));
    if (!Number.isFinite(created)) throw new Error("bad created_at");
    const id = String(w.id ?? "");
    if (!/^[0-9]{1,20}$/.test(id)) throw new Error("bad run id");
    const dow = new Date(created).getUTCDay();
    const mode = dow === 6 ? "sat" : dow === 0 ? "sun" : dow === 1 ? "mon-pre" : null;
    if (!mode) return idle("weekday");
    return active(mode, isoDay(created), id);
  }
  if (eventName === "workflow_dispatch") {
    const m = String((ev.inputs && ev.inputs.mode) || "dry");
    if (!MODES.includes(m)) throw new Error("bad mode input");
    return active(m, m === "mon-post" ? mondayOf(now) : isoDay(now), "dispatch");
  }
  return idle("event");
}

export function main(env = process.env, now = Date.now()) {
  let event = {};
  try { event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH || "", "utf8")); } catch { event = {}; }
  const r = resolve({ eventName: env.GITHUB_EVENT_NAME, event, repository: env.GITHUB_REPOSITORY, now });
  const lines = ["mode", "date", "trigger", "parts", "idle_reason"].map((k) => `${k}=${r[k]}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join(" "));
  return r;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) main();
