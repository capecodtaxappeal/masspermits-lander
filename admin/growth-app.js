// Road to 100: the only page file that makes a request. One GET to the
// owner-only data route, painted by growth-render.js. Nothing is stored on
// the phone. Refresh re-asks; so does coming back after 10 minutes away.

import { render } from "./growth-render.js";

const TIMEOUT_MS = 20000;
const STALE_MS = 10 * 60 * 1000;
let loadedAt = 0;
let busy = false;

async function load() {
  const root = document.getElementById("app");
  if (!root || busy) return;
  busy = true;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res = { status: 0, json: null };
  try {
    const r = await fetch("/admin/api/growth", {
      credentials: "same-origin", cache: "no-store", signal: ac.signal,
      headers: { "X-MassPermits-Growth": "1" },
    });
    let body = null;
    try { body = await r.json(); } catch (_) { body = null; }
    res = { status: r.status, json: body };
  } catch (_) {
    res = { status: 0, json: null };
  } finally {
    clearTimeout(timer);
    busy = false;
  }
  if (render(root, res) === "ok") loadedAt = Date.now();
}

const btn = document.getElementById("refresh");
if (btn) btn.addEventListener("click", load);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - loadedAt > STALE_MS) load();
});
load();
