// Mission Control: the only page file that makes a request. It fetches the
// two API views and the town geometry in parallel, hands every response
// (JSON or error status) to mission-render.js, and re-fetches on Refresh or
// when the page comes back after more than 5 minutes. Nothing is kept on the
// phone beyond this tab's memory.

import { render } from "./mission-render.js";

const MISSION = { "X-MassPermits-Mission": "1" };
const TIMEOUT_MS = 15000;
const STALE_MS = 5 * 60 * 1000;
const root = document.getElementById("mission");
let loadedAt = 0;
let busy = false;
let geo = null;

async function request(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, signal: ac.signal });
    let json = null;
    try { json = await r.json(); } catch (_) { json = null; }
    return { status: r.status, json };
  } catch (_) {
    return { status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

const opts = () => ({ now: Date.now(), onRefresh: load, onEdit: edit });

async function load() {
  if (busy) return;
  busy = true;
  const [main, map, towns] = await Promise.all([
    request("/admin/api/mission", { headers: MISSION }),
    request("/admin/api/mission?view=map", { headers: MISSION }),
    geo || request("/admin/mission-towns.json", {}),
  ]);
  if (towns.status === 200 && towns.json) geo = towns;
  loadedAt = Date.now();
  busy = false;
  render(root, { main, map, towns }, opts());
}

async function edit(town, outreach, done) {
  const r = await request("/admin/api/mission-outreach", {
    method: "POST",
    headers: { ...MISSION, "Content-Type": "application/json" },
    body: JSON.stringify({ town, outreach }),
  });
  if (r.status === 200 && r.json && r.json.ok === true) {
    done("Saved.");
    load();
  } else {
    done("Not saved (" + String((r.json && r.json.error) || r.status) + "). Reload and try again.");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - loadedAt > STALE_MS) load();
});
render(root, { main: null, map: null, towns: null }, opts());
load();
