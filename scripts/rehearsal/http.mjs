// MassPermits monday rehearsal: ALL of the runner's HTTP (Node built-ins only).
//
// Exactly three functions, every request a GET, every URL hard-coded:
//   ghGet(path)   GET https://api.github.com/repos/capecodtaxappeal/masspermits-lander/<path>
//                 with Authorization: Bearer $GH_TOKEN (the job's github.token,
//                 read-only: contents, actions and checks read).
//   getSample()   GET https://masspermits.com/api/sample (the public sample).
//   ghJobLog(id)  (R3b, C15) GET .../actions/jobs/<id>/logs with the token and
//                 redirect "manual". GitHub answers 302 with a short-lived
//                 signed Location. That Location is fetched ONCE, WITHOUT the
//                 Authorization header, and only when its host is exactly
//                 LOG_HOST, the host GitHub's REST docs name for log downloads
//                 ("Download job logs for a workflow run": Location:
//                 https://pipelines.actions.githubusercontent.com/...). Any other
//                 host, scheme, port or a userinfo part is refused with no second
//                 request. The text stays in memory; the caller prints counts only.
// No other runner file makes a network call, and nothing here writes to
// GitHub: there is no method parameter to pass.
//
// ghGet returns {status, ok, json, rateLimited} and never throws on an HTTP
// status; a network failure is status 0. getSample returns {status, bytes}.
// ghJobLog returns {ok, text} or {ok:false, reason}; it never throws on a
// response.

const GH_BASE = "https://api.github.com/repos/capecodtaxappeal/masspermits-lander/";
const SAMPLE_URL = "https://masspermits.com/api/sample";
const UA = "MassPermits-Rehearsal/1 (runner; read-only)";
export const LOG_HOST = "pipelines.actions.githubusercontent.com";
const LOG_MAX_BYTES = 16 * 1024 * 1024;

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

// C15: one job's log, as text. id must be a plain job id.
export async function ghJobLog(id) {
  if (typeof id !== "string" && typeof id !== "number") throw new Error("ghJobLog: bad id");
  if (!/^[0-9]{1,20}$/.test(String(id))) throw new Error("ghJobLog: bad id");
  let r;
  try {
    r = await fetch(`${GH_BASE}actions/jobs/${id}/logs`, {
      method: "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN || ""}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
      },
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  const loc = r.headers.get("location");
  try { if (r.body) await r.body.cancel(); } catch { /* released */ }
  if (![301, 302, 303, 307, 308].includes(r.status) || !loc) return { ok: false, reason: "no_redirect" };
  let u;
  try { u = new URL(loc); } catch { return { ok: false, reason: "bad_location" }; }
  if (u.protocol !== "https:" || u.hostname !== LOG_HOST || u.port !== "" || u.username || u.password) {
    return { ok: false, reason: "host_refused" };
  }
  let s;
  try {
    // No Authorization header: the signed URL carries its own short-lived grant.
    s = await fetch(u.href, { method: "GET", redirect: "error", headers: { "User-Agent": UA } });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (s.status !== 200 || !s.body) {
    try { if (s.body) await s.body.cancel(); } catch { /* released */ }
    return { ok: false, reason: "status" };
  }
  const chunks = [];
  let size = 0;
  const reader = s.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LOG_MAX_BYTES) {
        try { await reader.cancel(); } catch { /* released */ }
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "network" };
  }
  return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks)) };
}
