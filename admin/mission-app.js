// Mission Control: the only page file that makes a request. It fetches the
// default view, the map view and the geometry in parallel and hands every
// response (JSON or an error status) to the renderer. Nothing is kept on the
// phone: the last payload lives only in memory.

import { render } from "./mission-render.js";
import { MSG } from "./mission-view.js";

const API = "/admin/api/mission";
const HDR = { "X-MassPermits-Mission": "1" };
const root = document.getElementById("mission-root");
const setup = document.getElementById("setup-needed");
let loadedAt = 0;
let seq = 0;

// {status, body}; status 0 = network failure or the 15 s timeout.
async function call(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: ctl.signal, ...init });
    let body = null;
    try { body = await r.json(); } catch (_) { body = null; }
    return { status: r.status, body };
  } catch (_) {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function edit(town, outreach) {
  const r = await call("/admin/api/mission-outreach", { method: "POST",
    headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ town, outreach }) });
  if (r.status === 200) return "Saved. Tap Refresh to see it on the map.";
  if (!r.status) return MSG.unreadable;
  return "Not saved (" + (r.body && typeof r.body.error === "string" ? r.body.error : r.status) + ").";
}

function load() {
  const mine = ++seq;
  const state = {};
  const paint = () => { if (mine === seq) render(root, state, { now: Date.now(), onRefresh: load, onEdit: edit, setup }); };
  const main = call(API, { headers: HDR }).then((r) => { state.main = r; paint(); });
  const map = call(API + "?view=map", { headers: HDR }).then((r) => { state.map = r; });
  const towns = call("/admin/mission-towns.json").then((r) => { state.towns = r.status === 200 && r.body ? r.body : null; });
  Promise.all([main, map, towns]).then(() => { loadedAt = Date.now(); paint(); });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - loadedAt > 5 * 60 * 1000) load();
});

render(root, {}, { now: Date.now(), onRefresh: load, setup });
load();
