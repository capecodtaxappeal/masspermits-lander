// Marketing mail must never pitch the Weekly Feed to someone who is paying for it.
//
// newsletter-send.js (weekly digest) and nurture.js (sample follow-ups) both
// read subscribers.json and drop paying rows before sending. They used to keep
// a row as "paying" only when `active === true`, while weekly-send.js delivers
// the paid file to every row where `active !== false`. So a row with no
// `active` field (or `active: null`) received the paid file AND the sales pitch
// for it. Both marketing senders now use the sender's own rule: a row is paying
// unless it says `active: false`.
//
// The real onRequest handlers run from a temp copy of functions/ (same pattern
// as postal-address.test.mjs). In the COPY only, the GitHub OIDC verifier is
// replaced by a stub, because a local process cannot mint an Actions token.
// R2 is an in-memory fake, fetch is stubbed, and any URL that is not the
// Resend API or the site's own public feed throws. Nothing leaves the machine.
//
//   node --test test/marketing-paying-suppression.test.mjs
//
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paying-suppression-"));
fs.cpSync(path.join(REPO, "functions"), path.join(tmp, "functions"), { recursive: true });
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
fs.writeFileSync(path.join(tmp, "functions/api/_github-oidc.js"),
  "export async function verifyGitHubOIDC() { return { ok: true, reason: 'test stub' }; }\n");
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);

// ---- addresses (reserved example domain) ------------------------------------
const PAID_TRUE = "paid.true@example.com";        // active: true
const PAID_MISSING = "paid.missing@example.com";  // no active field: the D2 case
const PAID_NULL = "paid.null@example.com";        // active: null, weekly-send serves it
const LAPSED = "lapsed@example.com";              // active: false, a former customer
const READER = "reader@example.com";              // never subscribed

const ROSTER = [
  { email: PAID_TRUE, name: "T", active: true, customer: "cus_t" },
  { email: " Paid.Missing@Example.com ", name: "M", customer: "cus_m" },   // case and spaces too
  { email: PAID_NULL, name: "N", active: null, customer: "cus_n" },
  { email: LAPSED, name: "L", active: false, customer: "cus_l" },
];
const EVERYONE = [PAID_TRUE, PAID_MISSING, PAID_NULL, LAPSED, READER];

// ---- fake R2 (get, put, list with prefix and customMetadata) ----------------
function makeR2() {
  const m = new Map();
  return {
    m,
    set(key, body, customMetadata = {}) {
      m.set(key, { body: typeof body === "string" ? body : JSON.stringify(body), customMetadata });
    },
    get: async (key) => {
      const v = m.get(key);
      return v ? { key, customMetadata: v.customMetadata, text: async () => v.body } : null;
    },
    put: async (key, body, opts = {}) => {
      m.set(key, { body: String(body), customMetadata: opts.customMetadata || {} });
    },
    list: async ({ prefix = "" } = {}) => ({
      objects: [...m.keys()].filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k, customMetadata: m.get(k).customMetadata })),
      truncated: false,
    }),
  };
}

// ---- fetch: Resend is recorded, the public feed is served, the rest throws --
let sent = [];
const FEED = {
  _window_total: 2, _window_from: "2026-09-21", _window_to: "2026-09-22",
  items: [
    { title: "Roofing permit at 12 M*** St, Exampleton", _town: "Exampleton", _trade: "Roofing",
      _value: 48000, date_published: "2026-09-21T00:00:00Z" },
    { title: "Solar permit at 4 O** Rd, Sampleville", _town: "Sampleville", _trade: "Solar",
      _value: 31000, date_published: "2026-09-22T00:00:00Z" },
  ],
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === "https://api.resend.com/emails") {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  if (u === "https://masspermits.com/feed/permits.json") {
    return new Response(JSON.stringify(FEED), { status: 200 });
  }
  throw new Error("test fetch refused: " + u);
};

const env = (r2) => ({ BUNDLES: r2, RESEND_API_KEY: "test", FROM_EMAIL: "MassPermits <leads@example.com>" });
const recipients = () => sent.map((s) => s.to[0]).sort();
const run = async (mod, r2) => {
  const res = await mod.onRequest({ request: new Request("https://masspermits.com/api/x", { method: "POST" }), env: env(r2) });
  return { status: res.status, body: await res.json() };
};

// roster null means subscribers.json is absent.
function digestWorld(roster = ROSTER) {
  const r2 = makeR2();
  r2.set("refresh-status.json", { ok: true, ran_at: new Date().toISOString() });
  if (roster !== null) r2.set("subscribers.json", roster);
  for (const e of EVERYONE) r2.set("newsletter/" + encodeURIComponent(e), "{}", { c: "1", tok: "tok" + e.length });
  return r2;
}

function nurtureWorld(roster = ROSTER) {
  const r2 = makeR2();
  if (roster !== null) r2.set("subscribers.json", roster);
  const tenDaysAgo = new Date(Date.now() - 10 * 86400_000).toISOString();
  for (const e of EVERYONE) {
    r2.set("prospects/" + encodeURIComponent(e), "{}", { stage: "1", ts: tenDaysAgo, trade: "Roofing" });
  }
  return r2;
}

test.beforeEach(() => { sent = []; });

test("weekly digest: a paying row with no active field, or active null, gets no pitch", async () => {
  const nd = await load("functions/api/newsletter-send.js");
  const { status, body } = await run(nd, digestWorld());
  assert.equal(status, 200);
  assert.deepEqual(recipients(), [LAPSED, READER].sort(),
    "only the lapsed customer and the plain reader are pitched the Weekly Feed");
  assert.equal(body.suppressed_paying, 3);
  assert.equal(body.sent, 2);
});

test("sample follow-ups: a paying row with no active field, or active null, gets no pitch", async () => {
  const nu = await load("functions/api/nurture.js");
  const r2 = nurtureWorld();
  const { status, body } = await run(nu, r2);
  assert.equal(status, 200);
  assert.deepEqual(recipients(), [LAPSED, READER].sort());
  assert.equal(body.suppressed_paying, 3);
  assert.equal(body.sent_followup1, 2);
  // A suppressed paying prospect is left exactly where it was, not advanced.
  assert.equal(r2.m.get("prospects/" + encodeURIComponent(PAID_MISSING)).customMetadata.stage, "1");
  assert.equal(r2.m.get("prospects/" + encodeURIComponent(LAPSED)).customMetadata.stage, "2");
});

test("both senders agree with weekly-send on who is paying", async () => {
  // weekly-send.js delivers to every row with an email where active !== false.
  const served = ROSTER.filter((s) => s && s.email && s.active !== false)
    .map((s) => String(s.email).trim().toLowerCase()).sort();
  const nd = await load("functions/api/newsletter-send.js");
  await run(nd, digestWorld());
  const pitched = new Set(recipients());
  for (const e of served) assert.ok(!pitched.has(e), "the digest pitched a row weekly-send serves");
  sent = [];
  const nu = await load("functions/api/nurture.js");
  await run(nu, nurtureWorld());
  const followed = new Set(recipients());
  for (const e of served) assert.ok(!followed.has(e), "a follow-up pitched a row weekly-send serves");
});

test("both senders still fail closed when the roster is missing or unreadable", async () => {
  const nd = await load("functions/api/newsletter-send.js");
  const nu = await load("functions/api/nurture.js");
  for (const roster of [null, "{not json", { not: "an array" }]) {
    sent = [];
    const a = await run(nd, digestWorld(roster));
    assert.equal(a.status, 500); assert.equal(a.body.ok, false);
    const b = await run(nu, nurtureWorld(roster));
    assert.equal(b.status, 500); assert.equal(b.body.ok, false);
    assert.equal(sent.length, 0, "nothing is sent without a readable roster");
  }
});
