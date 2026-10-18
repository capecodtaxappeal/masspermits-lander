// /api/request-sample: the optional towns and role fields.
//
// What this file proves, against a temp copy of the shipped Function:
//  * towns: only exact names from _ma_towns.js, at most 10, no repeats;
//    unknown towns, HTML or script text, over-long values, non-strings and an
//    11th town are dropped without an error; role: one of the three values or
//    nothing;
//  * towns and role land in the prospects/<email> JSON body and never in
//    customMetadata;
//  * the email to the prospect is byte for byte what main sent before this
//    change (snapshot in test/fixtures/request-sample-prospect.snapshot.json);
//  * the owner notification names the first two towns (+N more) in the
//    subject, falls back to the area, and lists towns and role HTML-escaped.
//
// Nothing leaves this machine: in-memory R2, Resend calls recorded by a stub.
// Every address is invented.
//
//   node --test test/request-sample-towns.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO, PROSPECT, FakeBucket, loadRequestSample, post } from "./_request_sample_harness.mjs";

const mod = await loadRequestSample();
const AT = String.fromCharCode(64);
let seq = 0;
const fresh = () => "reader" + (++seq) + AT + "example.net";
const KEY = (e) => "prospects/" + encodeURIComponent(e);
const OWNER = (sent, email) => sent.find((s) => s.to[0] !== email);
const PROSP = (sent, email) => sent.find((s) => s.to[0] === email);

test("towns: unknown names, HTML, script text, over-long values and an 11th town are dropped", async () => {
  const email = fresh();
  const long = "Boston".padEnd(400, "x");
  const eleven = ["Acton", "Adams", "Agawam", "Alford", "Amesbury", "Amherst", "Andover", "Arlington", "Ashby", "Ashfield", "Athol"];
  const towns = ["Springfield, IL", "<b>Boston</b>", "<script>alert(1)</script>", long, "boston", " Boston", 42, null,
    { name: "Boston" }, ["Salem"], ...eleven, "Acton", "Salem"];
  const { res, bucket, sent } = await post(mod, { email, trade: "Roofing", area: "all", towns, role: "Owner or on the tools" });
  assert.equal(res.status, 200);
  const rec = bucket.json(KEY(email));
  assert.deepEqual(rec.towns, eleven.slice(0, 10), "first 10 valid, the 11th and the repeat dropped");
  assert.equal(rec.role, "Owner or on the tools");
  assert.equal(sent.length, 2);
});

test("towns and role: wrong types or values are dropped silently, the request still succeeds", async () => {
  for (const [towns, role] of [
    ["Boston", "Owner"], [{ 0: "Boston", length: 1 }, "owner or on the tools"], [null, "<script>x</script>"],
    [[], "Office, sales or estimating ".repeat(20)], [["Boston".repeat(10)], ["Supplier or distributor"]],
    [undefined, undefined],
  ]) {
    const email = fresh();
    const { res, bucket } = await post(mod, { email, trade: "Solar", area: "Cape Cod", towns, role });
    assert.equal(res.status, 200);
    const rec = bucket.json(KEY(email));
    assert.ok(rec, "still enrolled");
    assert.equal("towns" in rec, false, JSON.stringify(towns));
    assert.equal("role" in rec, false, JSON.stringify(role));
    assert.deepEqual(Object.keys(rec), ["email", "trade", "area", "ts", "stage"], "record shape as before");
  }
});

test("storage: towns and role in the JSON body, never in customMetadata", async () => {
  const email = fresh();
  const { bucket } = await post(mod, { email, trade: "HVAC", area: "boston",
    towns: ["Salem", "Beverly"], role: "Office, sales or estimating" });
  const o = bucket.objects.get(KEY(email));
  const rec = JSON.parse(o.body);
  assert.deepEqual(rec.towns, ["Salem", "Beverly"]);
  assert.equal(rec.role, "Office, sales or estimating");
  assert.deepEqual(Object.keys(o.opts.customMetadata).sort(), ["stage", "trade", "ts"]);
  assert.doesNotMatch(JSON.stringify(o.opts), /Salem|Office/);
  assert.equal(o.opts.httpMetadata.contentType, "application/json");
});

test("prospect email: byte for byte the same as main's (snapshot)", async () => {
  const snap = JSON.parse(fs.readFileSync(path.join(REPO, "test/fixtures/request-sample-prospect.snapshot.json"), "utf8"));
  assert.equal(snap.length, 4);
  for (const s of snap) {
    for (const extra of [{}, { towns: ["Acton", "Boston", "Salem"], role: "Supplier or distributor" }]) {
      const { sent } = await post(mod, { email: PROSPECT, trade: s.trade, area: s.area, company: "", ...extra }, { bucket: new FakeBucket() });
      const p = PROSP(sent, PROSPECT);
      assert.equal(p.subject, s.subject, s.trade + " subject");
      assert.equal(p.html, s.html, s.trade + " html");
    }
  }
});

test("owner notification: subject names two towns (+N more), body lists towns and role", async () => {
  const cases = [
    [["Acton", "Boston", "Salem", "Lynn"], "Free-sample request: Roofing / Acton, Boston (+2 more)"],
    [["Acton", "Boston", "Salem"], "Free-sample request: Roofing / Acton, Boston (+1 more)"],
    [["Acton", "Boston"], "Free-sample request: Roofing / Acton, Boston"],
    [["Acton"], "Free-sample request: Roofing / Acton"],
    [[], "Free-sample request: Roofing / Cape Cod"],
    [["Nowhere"], "Free-sample request: Roofing / Cape Cod"],
  ];
  for (const [towns, subject] of cases) {
    const email = fresh();
    const { sent } = await post(mod, { email, trade: "Roofing", area: "Cape Cod", towns, role: "Supplier or distributor" });
    const o = OWNER(sent, email);
    assert.equal(o.subject, subject);
    const valid = towns.filter((t) => t !== "Nowhere");
    assert.ok(o.html.includes("Towns: <b>" + (valid.length ? valid.join(", ") : "(none)") + "</b>"), o.html);
    assert.ok(o.html.includes("Role: <b>Supplier or distributor</b>"));
  }
  const email = fresh();
  const { sent } = await post(mod, { email, trade: "", area: "", towns: [], role: "" });
  const o = OWNER(sent, email);
  assert.equal(o.subject, "Free-sample request: Building / all", "unchanged fallback");
  assert.ok(o.html.includes("Towns: <b>(none)</b> &nbsp; Role: <b>(none)</b>"));
});

test("owner notification: towns and role are HTML-escaped", async () => {
  // Called directly, past the whitelist, to prove the escaping itself.
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}"); };
  try {
    await mod.__test.notifyOwner({ FROM_EMAIL: "x", RESEND_API_KEY: "k" }, fresh(), "Roofing", "all",
      ["<script>alert(1)</script>", "A & B"], 'Owner "<i>"');
  } finally { globalThis.fetch = realFetch; }
  const html = sent[0].html;
  assert.ok(html.includes("Towns: <b>&lt;script&gt;alert(1)&lt;/script&gt;, A &amp; B</b>"), html);
  assert.ok(html.includes("Role: <b>Owner &quot;&lt;i&gt;&quot;</b>"));
  assert.doesNotMatch(html, /<script>|<i>/);
});
