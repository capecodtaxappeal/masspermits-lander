// Mission Control: the only page file that makes a request. It starts the
// two API views and the town geometry together, paints the tiles as soon as
// the default view answers (the map follows when its two requests land),
// hands every response (JSON or error status) to mission-render.js, and
// re-fetches on Refresh or when the page comes back after more than 5
// minutes. A refresh that fails after a good load keeps the earlier render,
// marked as not updated. Nothing is kept on the phone beyond this tab's
// memory. The only timer is the 15 s per-request timeout.

import { render } from "./mission-render.js";
import { screenOf } from "./mission-view.js";

const MISSION = { "X-MassPermits-Mission": "1" };
const TIMEOUT_MS = 15000;
const STALE_MS = 5 * 60 * 1000;
const root = document.getElementById("mission");
let loadedAt = 0;
let busy = false;
let geo = null;
let good = null; // the last good load, in memory only: {main, map, towns, at}

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
  const got = { main: null, map: null, towns: null };
  let kept = false;
  const paint = () => {
    if (!got.main) return;
    if (screenOf(got.main) === "ok") {
      good = { ...got, at: Date.now() };
      render(root, got, opts());
    } else if (screenOf(got.main) === "error" && good) {
      kept = true;
      render(root, good, { ...opts(), stale: good.at });
    } else {
      render(root, got, opts());
    }
  };
  const arrive = (name) => (r) => {
    got[name] = r;
    if (name === "towns" && r.status === 200 && r.json) geo = r;
    if (!kept) paint();
  };
  await Promise.all([
    request("/admin/api/mission", { headers: MISSION }).then(arrive("main")),
    request("/admin/api/mission?view=map", { headers: MISSION }).then(arrive("map")),
    (geo ? Promise.resolve(geo) : request("/admin/mission-towns.json", {})).then(arrive("towns")),
  ]);
  loadedAt = Date.now();
  busy = false;
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
