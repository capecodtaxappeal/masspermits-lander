// Test for get-drop.js, the read-only private-input route.
//
// It proves three things with REAL RS256 tokens (a throwaway key pair made
// here, served as the JWKS through a stubbed fetch, so _github-oidc.js runs
// unmodified end to end):
//   1. a valid token from weekly-refresh.yml on main can read manual/ keys;
//   2. every other caller is refused BEFORE R2 is touched (bad signature,
//      wrong audience, repo, branch or workflow, expired, unknown key id);
//   3. every key outside the one pattern is refused BEFORE R2 is touched,
//      including subscribers.json and traversal or lookalike spellings.
// It also pins the two allowlists this route must never replace: get-object.js
// READABLE and upload-bundle.js ALLOWED_KEYS. All fixtures are synthetic.
//
//   node functions/api/get-drop.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { onRequestGet, onRequest, KEY_RX, WORKFLOW_REF, MAX_BYTES } =
  await import(new URL("./get-drop.js", import.meta.url));

let failed = 0, passed = 0;
function t(name, ok, got) {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}` + (ok ? "" : `   (got ${JSON.stringify(got)})`));
}

// ---- keys and JWKS -----------------------------------------------------------
const gen = () => crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const good = await gen();
const rogue = await gen();
const jwk = { ...(await crypto.subtle.exportKey("jwk", good.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
let jwksFetches = 0;
globalThis.fetch = async (url) => {
  if (String(url) === "https://token.actions.githubusercontent.com/.well-known/jwks") {
    jwksFetches++;
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  throw new Error("unexpected network call in test: " + url);
};

const b64u = (x) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");
async function token(claims = {}, { key = good.privateKey, kid = "test-kid", alg = "RS256" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://token.actions.githubusercontent.com", aud: "masspermits-cron",
    repository: "capecodtaxappeal/masspermits-lander", ref: "refs/heads/main",
    workflow_ref: WORKFLOW_REF, event_name: "schedule", exp: now + 300, iat: now, ...claims,
  };
  const h = b64u(JSON.stringify({ alg, typ: "JWT", kid }));
  const p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + p));
  return `${h}.${p}.${b64u(sig)}`;
}

// ---- R2 mock: records every read; holds a decoy for every sensitive key ------
const STORE = {
  "manual/manifest.json": '{"schema":1,"files":[]}',
  "manual/sometown/2026-08.json": '{"schema":1,"rows":[]}',
  "manual/sometown/2026-08.r2.json": '{"schema":1,"rows":[]}',
  "subscribers.json": "SECRET-SUBSCRIBERS",
  "manual/subscribers.json": "SECRET-DECOY",
  "engine.tar.gz": "SECRET-ENGINE",
  "latest-weekly.zip": "SECRET-BUNDLE",
  "cold-queue.json": "SECRET-QUEUE",
  "source-health.json": "{}",
};
function env(extra = {}) {
  const reads = [];
  return {
    reads,
    BUNDLES: {
      async get(k) {
        reads.push(k);
        if (k in extra) return extra[k];
        if (!(k in STORE)) return null;
        const b = new TextEncoder().encode(STORE[k]);
        return { size: b.byteLength, body: new Response(b).body };
      },
      async put() { throw new Error("get-drop must never write"); },
      async delete() { throw new Error("get-drop must never delete"); },
      async list() { throw new Error("get-drop must never list"); },
    },
  };
}
const url = (q) => "https://masspermits.com/api/get-drop" + q;
async function call(q, tok, { e = env(), method = "GET", via = onRequestGet } = {}) {
  const headers = tok === undefined ? {} : { Authorization: "Bearer " + tok };
  const res = await via({ request: new Request(url(q), { method, headers }), env: e });
  return { status: res.status, text: await res.text(), reads: e.reads };
}
const enc = encodeURIComponent;

// ---- 1. the one caller that is allowed ----------------------------------------
const T = await token();
for (const k of ["manual/manifest.json", "manual/sometown/2026-08.json", "manual/sometown/2026-08.r2.json"]) {
  const r = await call("?key=" + enc(k), T);
  t(`valid workflow token reads ${k}`, r.status === 200 && r.text === STORE[k] && r.reads.length === 1 && r.reads[0] === k, r);
}
{
  const r = await call("?key=" + enc("manual/othertown/2026-09.json"), T);
  t("missing month file is a 404, not a fallback read", r.status === 404 && r.reads.length === 1, r);
}
{
  const big = { "manual/sometown/2026-07.json": { size: MAX_BYTES + 1, body: new Response("x").body } };
  const e = env(big);
  const r = await call("?key=" + enc("manual/sometown/2026-07.json"), T, { e });
  t("object over 5 MB is refused with 413", r.status === 413 && !r.text.includes("x"), r);
}

// ---- 2. every other caller: refused, and R2 is never read ----------------------
const k0 = "?key=" + enc("manual/manifest.json");
const callers = [
  ["no Authorization header", undefined],
  ["not a JWT", "abc.def"],
  ["signed by another key", await token({}, { key: rogue.privateKey })],
  ["unknown key id", await token({}, { kid: "other-kid" })],
  ["alg none", (await token({}, { alg: "none" })).split(".").slice(0, 2).join(".") + "."],
  ["wrong audience", await token({ aud: "someone-else" })],
  ["wrong issuer", await token({ iss: "https://evil.example" })],
  ["another repository", await token({ repository: "someone/masspermits-lander" })],
  ["a fork's pull request ref", await token({ ref: "refs/pull/7/merge" })],
  ["another branch", await token({ ref: "refs/heads/feature" })],
  ["expired", await token({ exp: Math.floor(Date.now() / 1000) - 5 })],
  ["another workflow on main", await token({ workflow_ref: "capecodtaxappeal/masspermits-lander/.github/workflows/cold-outreach.yml@refs/heads/main" })],
  ["weekly-feed on main", await token({ workflow_ref: "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-feed.yml@refs/heads/main" })],
  ["this workflow from another branch", await token({ workflow_ref: WORKFLOW_REF.replace("@refs/heads/main", "@refs/heads/feature") })],
  ["no workflow_ref claim", await token({ workflow_ref: undefined })],
];
for (const [name, tok] of callers) {
  const r = await call(k0, tok);
  t(`refused: ${name}`, r.status === 401 && r.reads.length === 0 && !r.text.includes("schema"), r);
}

// ---- 3. every key outside the pattern: refused, and R2 is never read ------------
const badKeys = [
  "subscribers.json", "manual/subscribers.json", "manual/../subscribers.json",
  "manual/sometown/../../subscribers.json", "manual/sometown/2026-08.json/../../../subscribers.json",
  "manual/./manifest.json", "manual//manifest.json", "/manual/manifest.json", "manual\\..\\subscribers.json",
  "engine.tar.gz", "latest-weekly.zip", "cold-queue.json", "source-health.json", "refresh-status.json",
  "manual/", "manual/manifest", "manual/manifest.json.bak", "manual/manifest.jsonx", "manual/manifest.json\n",
  "manual/manifest.json%00", "manual/manifest.json\u0000", " manual/manifest.json", "Manual/manifest.json",
  "manual/Sometown/2026-08.json", "manual/some-town/2026-08.json", "manual/s/2026-08.json",
  "manual/sometown/2026-8.json", "manual/sometown/2026-13.json", "manual/sometown/2026-00.json",
  "manual/sometown/1999-08.json", "manual/sometown/2026-08.r1.json", "manual/sometown/2026-08.r10.json",
  "manual/sometown/sub/2026-08.json", "manual/sometown/2026-08.json.gz", "manual/sometown/2026-08",
  "",
];
for (const k of badKeys) {
  const r = await call("?key=" + enc(k), T);
  t(`refused key ${JSON.stringify(k)}`, r.status === 400 && r.reads.length === 0, r);
}
{
  const r = await call("", T);
  t("refused: no key parameter", r.status === 400 && r.reads.length === 0, r);
}
{
  const r = await call("?key=" + enc("manual/manifest.json") + "&key=" + enc("subscribers.json"), T);
  t("refused: two key parameters", r.status === 400 && r.reads.length === 0, r);
}
{
  // A percent-encoded traversal reaches the handler DECODED; it must still fail the pattern.
  const r = await call("?key=manual%2F..%2Fsubscribers.json", T);
  t("refused: percent-encoded traversal", r.status === 400 && r.reads.length === 0, r);
}
for (const m of ["POST", "PUT", "DELETE"]) {
  const r = await call(k0, T, { method: m, via: onRequest });
  t(`refused method ${m}`, r.status === 405 && r.reads.length === 0, r);
}

// ---- 4. the pattern itself, and the allowlists this route must never replace ----
t("KEY_RX has no multiline or global flag", !KEY_RX.flags.includes("m") && !KEY_RX.flags.includes("g"), KEY_RX.flags);
const src = readFileSync(join(here, "get-drop.js"), "utf8");
t("get-drop.js has no write, delete or list call", !/\.(put|delete|list)\s*\(/.test(src), null);
t("get-drop.js has no em or en dash", !/[–—]/.test(src), null);
const go = readFileSync(join(here, "get-object.js"), "utf8");
const readable = [...go.match(/const READABLE = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
t("get-object.js READABLE is exactly the four checkpoint keys",
  JSON.stringify(readable) === JSON.stringify(["cold-queue.json", "cold-state.json", "source-health.json", "suppression.json"]), readable);
const ub = readFileSync(join(here, "upload-bundle.js"), "utf8");
const allowed = ub.slice(ub.indexOf("const ALLOWED_KEYS"), ub.indexOf("};", ub.indexOf("const ALLOWED_KEYS")));
t("upload-bundle.js ALLOWED_KEYS has no manual/ key and no subscribers.json",
  !/"manual\//.test(allowed) && !/subscribers/.test(allowed), null);
t("JWKS was fetched (the real verifier ran)", jwksFetches >= 1, jwksFetches);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
