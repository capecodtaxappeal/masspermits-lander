// Commercial email must carry a valid postal address (CAN-SPAM).
//
// The two automated sends that lacked one: the sample-request follow-ups
// (nurture.js, email 2 and email 3) and the weekly digest (newsletter-send.js).
// The builders are imported from a temp copy of functions/ with a test-only
// re-export appended to the COPY (same pattern as no-dash-outbound.test.mjs),
// and fetch is stubbed so nothing leaves the machine.
//
//   node --test test/postal-address.test.mjs
//
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADDRESS = "MassPermits, PO Box 781, West Falmouth, MA 02574";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "postal-test-"));
fs.cpSync(path.join(REPO, "functions"), path.join(tmp, "functions"), { recursive: true });
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
fs.appendFileSync(path.join(tmp, "functions/api/nurture.js"), "\nexport { email2, email3 };\n");
fs.appendFileSync(path.join(tmp, "functions/api/newsletter-send.js"), "\nexport { sendDigest, buildDigest };\n");
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);

const sent = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === "https://api.resend.com/emails") {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  throw new Error("test fetch refused: " + url);
};
const env = { RESEND_API_KEY: "test", FROM_EMAIL: "MassPermits <leads@example.com>" };
const feedItems = [
  { title: "Roofing permit at 12 M*** St, Exampleton", _town: "Exampleton", _trade: "Roofing",
    _value: 48000, date_published: "2026-09-21T00:00:00Z" },
  { title: "Solar permit at 4 O** Rd, Sampleville", _town: "Sampleville", _trade: "Solar",
    _value: 31000, date_published: "2026-09-22T00:00:00Z" },
];

test("nurture follow-ups carry the postal address and keep the opt-out line", async () => {
  const nu = await load("functions/api/nurture.js");
  for (const html of [nu.email2({ trade: "Roofing" }), nu.email3({})]) {
    assert.ok(html.includes(ADDRESS), "postal address missing");
    assert.ok(html.includes(`Reply "stop" to opt out.`), "opt-out line changed");
  }
});

test("weekly digest carries the postal address, unsubscribe link and header unchanged", async () => {
  const nd = await load("functions/api/newsletter-send.js");
  const d = nd.buildDigest(feedItems, { _window_total: 2, _window_from: "2026-09-21", _window_to: "2026-09-22" });
  const reader = { email: "reader@example.com", tok: "abc123" };
  const unsub = "https://masspermits.com/api/newsletter?u=cmVhZGVyQGV4YW1wbGUuY29t.abc123";
  for (const dig of [d, { ...d, town: "exampleton" }]) {
    const from = sent.length;
    await nd.sendDigest(env, reader, dig);
    assert.equal(sent.length, from + 1);
    const m = sent[from];
    assert.ok(m.html.includes(ADDRESS), "postal address missing");
    assert.ok(m.html.includes(`<a href="${unsub}" style="color:#9aa">Unsubscribe</a>: one click, no questions.`),
      "unsubscribe link changed");
    // The unsubscribe endpoint handles one-click only on GET (a POST goes to the
    // signup handler), so no List-Unsubscribe-Post header is sent.
    assert.deepEqual(m.headers, { "List-Unsubscribe": `<${unsub}>` });
  }
});
