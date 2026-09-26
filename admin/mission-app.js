// Mission Control: the only page file that makes a request. Three reads in
// parallel, each handed to mission-render.js as {status, body}; the editor's
// POST too. Nothing is kept on the phone: the payload lives in memory only.

import { render } from "./mission-render.js";

const API = "/admin/api/mission";
const EDIT = "/admin/api/mission-outreach";
const TOWNS = "/admin/mission-towns.json";
const TIMEOUT_MS = 15000;
const STALE_MS = 5 * 60 * 1000;
const MISSION = { "X-MassPermits-Mission": "1" };

const root = document.getElementById("mc-root");
const setup = document.getElementById("mc-setup");
let loadedAt = 0;
let busy = false;

async function read(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, signal: ctl.signal });
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    return { status: res.status, body };
  } catch (_) {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function edit(town, outreach) {
  const r = await read(EDIT, {
    method: "POST",
    headers: { ...MISSION, "Content-Type": "application/json" },
    body: JSON.stringify({ town, outreach }),
  });
  if (r.status === 200 && r.body && r.body.ok === true) {
    load();
    return "Saved.";
  }
  const code = r.body && typeof r.body.error === "string" ? r.body.error : "no answer";
  return "Not saved (" + code.slice(0, 40) + ").";
}

async function load() {
  if (busy) return;
  busy = true;
  const now = Date.now();
  const opts = { now, onRefresh: load, onEdit: edit, setup };
  const main = read(API, { headers: MISSION });
  const map = read(API + "?view=map", { headers: MISSION });
  const towns = read(TOWNS, {});
  const first = await main;
  render(root, { main: first }, opts); // tiles first, while the map is on its way
  const [m, t] = await Promise.all([map, towns]);
  render(root, { main: first, map: m, towns: t }, opts);
  loadedAt = now;
  busy = false;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - loadedAt > STALE_MS) load();
});

render(root, {}, { setup });
load();
