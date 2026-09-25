// MassPermits monday rehearsal: ALL of the runner's HTTP (Node built-ins only).
//
// Exactly two functions, both GET, both hard-coded:
//   ghGet(path)   GET https://api.github.com/repos/capecodtaxappeal/masspermits-lander/<path>
//                 with Authorization: Bearer $GH_TOKEN (the job's github.token,
//                 read-only: contents, actions and checks read).
//   getSample()   GET https://masspermits.com/api/sample (the public sample).
// No other runner file makes a network call, and nothing here writes to
// GitHub: there is no method parameter to pass.
//
// ghGet returns {status, ok, json, rateLimited} and never throws on an HTTP
// status; a network failure is status 0. getSample returns {status, bytes}.

const GH_BASE = "https://api.github.com/repos/capecodtaxappeal/masspermits-lander/";
const SAMPLE_URL = "https://masspermits.com/api/sample";
const UA = "MassPermits-Rehearsal/1 (runner; read-only)";

// A relative API path under the repo: no scheme, no leading slash, no "..",
// no whitespace, nothing that could move the request to another host.
const PATH_OK = /^[A-Za-z0-9][A-Za-z0-9_./?=&%,:+-]*$/;

export async function ghGet(path) {
  if (typeof path !== "string" || !PATH_OK.test(path) || path.includes("..") || path.includes("//")) {
    throw new Error("ghGet: bad path");
  }
  const url = new URL(GH_BASE + path);
  if (url.origin !== "https://api.github.com" || !url.pathname.startsWith("/repos/capecodtaxappeal/masspermits-lander/")) {
    throw new Error("ghGet: bad path");
  }
  let r;
  try {
    r = await fetch(url.href, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN || ""}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
      },
    });
  } catch {
    return { status: 0, ok: false, json: null, rateLimited: false };
  }
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  const remaining = r.headers.get("x-ratelimit-remaining");
  return { status: r.status, ok: r.status >= 200 && r.status < 300, json,
    rateLimited: r.status === 429 || (r.status === 403 && remaining === "0") };
}

export async function getSample() {
  let r;
  try {
    r = await fetch(SAMPLE_URL, { method: "GET", headers: { "User-Agent": UA } });
  } catch {
    return { status: 0, bytes: null };
  }
  if (r.status !== 200) {
    try { if (r.body) await r.body.cancel(); } catch { /* released */ }
    return { status: r.status, bytes: null };
  }
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
}
