// A checkout must find the subscriber's existing roster row whatever the case
// or spacing of the email Stripe sends.
//
// addSubscriber() in stripe-webhook.js looked the buyer up with
// `s.email === email`, while every other lookup in that file lower-cases, and
// weekly-send.js trims and lower-cases. So a re-subscribe from "Casey@..." when
// the row says "casey@..." did not reactivate the cancelled row or move it to
// the new Stripe customer. It appended a SECOND row with a new download token,
// leaving the old one behind to be matched by later cancellations.
//
// Runs the SHIPPED onRequestPost with a correctly signed test event. R2 is an
// in-memory fake, fetch is stubbed, and any URL that is not the Resend API
// throws. Addresses are @example.com. Nothing leaves the machine.
//
//   node --test test/webhook-subscriber-email.test.mjs
//
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sw = await import(pathToFileURL(path.join(REPO, "functions/api/stripe-webhook.js")).href);
const SECRET = "whsec_test_only";

let mail = [];
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.resend.com/emails") throw new Error("BLOCKED network call to " + url);
  mail.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: "test" }), { status: 200 });
};

function makeR2(roster) {
  const m = new Map();
  const put = (k, v) => m.set(k, String(v));
  put("subscribers.json", JSON.stringify(roster));
  put("latest-monthly.zip", "PK monthly test bytes");
  return {
    m,
    roster: () => JSON.parse(m.get("subscribers.json")),
    get: async (k) => {
      if (!m.has(k)) return null;
      const b = Buffer.from(m.get(k));
      return { text: async () => b.toString("utf8"),
               arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    },
    put: async (k, v) => put(k, v),
  };
}

async function checkout(r2, email, customer) {
  const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed", data: { object: {
    mode: "subscription", amount_total: 9900, customer, customer_details: { email, name: "Casey Test" } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(t + "." + payload).digest("hex");
  const res = await sw.onRequestPost({
    request: new Request("https://masspermits.com/api/stripe-webhook",
      { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: payload }),
    env: { BUNDLES: r2, STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test",
           FROM_EMAIL: "MassPermits <leads@example.com>", OWNER_EMAIL: "owner@example.com" },
  });
  return { status: res.status, body: await res.json() };
}

const TOKEN = "a".repeat(32);
const link = (m) => (String(m.html).match(/my-leads\?t=([a-f0-9]+)/) || [])[1];

test.beforeEach(() => { mail = []; });

test("a re-subscribe in a different case reactivates the cancelled row instead of adding one", async () => {
  const r2 = makeR2([{ email: "casey@example.com", name: "Casey", customer: "cus_old", since: "2026-06-26",
                       active: false, cancelled: "2026-09-01", token: TOKEN }]);
  const { status } = await checkout(r2, "Casey@Example.com", "cus_new");
  assert.equal(status, 200);
  const roster = r2.roster();
  assert.equal(roster.length, 1, "one person, one row");
  assert.equal(roster[0].active, true);
  assert.equal(roster[0].cancelled, undefined);
  assert.equal(roster[0].customer, "cus_new", "the newest checkout names the paying Stripe customer");
  assert.equal(roster[0].token, TOKEN, "the subscriber keeps the download link they already have");
  assert.equal(mail.length, 1);
  assert.equal(link(mail[0]), TOKEN);
});

test("leading or trailing spaces on either side still match", async () => {
  const r2 = makeR2([{ email: " casey@example.com ", name: "Casey", customer: "cus_1", active: true, token: TOKEN }]);
  await checkout(r2, "CASEY@example.com  ", "cus_1");
  const roster = r2.roster();
  assert.equal(roster.length, 1);
  assert.equal(roster[0].token, TOKEN);
  assert.equal(link(mail[0]), TOKEN);
});

test("with a stale duplicate on file, the active row is the one updated", async () => {
  const stale = { email: "Casey@example.com", customer: "cus_dead", active: false, token: "b".repeat(32) };
  const live = { email: "casey@example.com", customer: "cus_live", active: true, token: TOKEN };
  const r2 = makeR2([stale, live]);
  await checkout(r2, "casey@EXAMPLE.com", "cus_live");
  const roster = r2.roster();
  assert.equal(roster.length, 2, "no third row");
  assert.equal(roster[0].active, false, "the stale row is not revived");
  assert.equal(roster[1].active, true);
  assert.equal(link(mail[0]), TOKEN);
});

test("a genuinely new buyer still gets a new row and a fresh token", async () => {
  const r2 = makeR2([{ email: "casey@example.com", customer: "cus_1", active: true, token: TOKEN }]);
  await checkout(r2, "drew@example.com", "cus_2");
  const roster = r2.roster();
  assert.equal(roster.length, 2);
  assert.equal(roster[1].email, "drew@example.com");
  assert.equal(roster[1].active, true);
  assert.match(roster[1].token, /^[a-f0-9]{32}$/);
  assert.notEqual(roster[1].token, TOKEN);
  assert.equal(link(mail[0]), roster[1].token);
});
