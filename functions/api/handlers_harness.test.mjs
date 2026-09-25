// Harness smoke test: the SHIPPED my-leads.js and leads.js, called in-process
// with in-memory Requests, a no-options roBucket over a fake R2, a waitUntil
// collector and the HTMLRewriter stub. This is the ground the rehearsal's C6
// link check will stand on (R2a); here it proves the harness itself works.
//
//   node functions/api/handlers_harness.test.mjs
//
// Asserts: my-leads.js returns 200 application/zip for weekly and &k=monthly
// with ZERO captured dl/ writes for the rehearsal user-agent (and a twin with a
// human user-agent that DOES capture one, so the zero is not vacuous);
// leads.js with the cookie returns 200 with exactly one captured portal-access/
// write {tok, ua, st} and ZERO persisted; "red" and "missing html" shapes are
// visible; no Request carries an authorization header; bodies are cancelled,
// never read.

import { onRequestGet as myLeadsGet } from "./my-leads.js";
import { onRequestGet as leadsGet } from "../leads.js";
import { roBucket } from "./_ro_bucket.js";
import {
  fakeR2, makeFetchStub, makeRunner, waitUntilCollector, HTMLRewriterStub, tok, zipBytes,
} from "../../test/rehearsal/harness.mjs";

const stub = makeFetchStub({});
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;

const { check, done } = makeRunner("handlers_harness.test.mjs");
const UA = "MassPermits-Rehearsal/1 (monitor; headless)";
const HOUR = 3600_000;

function world({ htmlAgeH = 2, ranAgeH = 2, html = true } = {}) {
  const now = Date.now();
  const init = {
    "subscribers.json": [
      { email: "alex.testperson@example.com", name: "Alex Testperson", customer: "cus_TEST1",
        since: "2026-09-01", active: true, token: tok("a") },
      { email: "old.row@example.com", customer: "cus_TEST4", since: "2026-08-01",
        active: false, cancelled: "2026-09-10", token: tok("c") },
    ],
    "refresh-status.json": { ok: true, ran_at: new Date(now - ranAgeH * HOUR).toISOString() },
    "latest-weekly.zip": { __r2: { uploaded: now - htmlAgeH * HOUR }, value: zipBytes(128) },
    "latest-monthly.zip": { __r2: { uploaded: now - 24 * HOUR }, value: zipBytes(256) },
  };
  if (html) init["latest-weekly.html"] = { __r2: { uploaded: now - htmlAgeH * HOUR },
    value: "<html><head></head><body><span class=\"fresh\">x</span></body></html>" };
  return fakeR2(init);
}

const requests = [];
function mk(url, headers) {
  const r = new Request(url, { headers });
  requests.push(r);
  return r;
}

async function call(handler, request, r2) {
  const ro = roBucket(r2.bucket);
  const wu = waitUntilCollector();
  const res = await handler({ request, env: { BUNDLES: ro }, waitUntil: wu.waitUntil });
  await wu.settle();
  try { if (res.body) await res.body.cancel(); } catch { /* released */ }
  return { res, ro, persisted: r2.writes() };
}

// 1. my-leads.js, weekly and monthly, rehearsal user-agent
for (const k of ["", "&k=monthly"]) {
  const r2 = world();
  const { res, ro, persisted } = await call(myLeadsGet,
    mk("https://masspermits.com/api/my-leads?t=" + tok("a") + k, { "user-agent": UA, "x-mp-synthetic": "1" }), r2);
  const label = k ? "monthly" : "weekly";
  check(`my-leads ${label}: 200`, res.status === 200, res.status);
  check(`my-leads ${label}: content-type application/zip`, res.headers.get("content-type") === "application/zip");
  check(`my-leads ${label}: ZERO captured dl/ writes (the user-agent matches BOTS)`,
    ro.captured.filter((c) => c.key.startsWith("dl/")).length === 0, JSON.stringify(ro.captured));
  check(`my-leads ${label}: 0 persisted writes`, persisted.length === 0);
}

// 1b. twin: a human user-agent IS logged (captured, still not persisted)
{
  const r2 = world();
  const { res, ro, persisted } = await call(myLeadsGet,
    mk("https://masspermits.com/api/my-leads?t=" + tok("a"), { "user-agent": "Mozilla/5.0 (Windows NT 10.0)" }), r2);
  check("twin, human user-agent: 200 and exactly one captured dl/ write",
    res.status === 200 && ro.captured.filter((c) => c.key.startsWith("dl/")).length === 1);
  check("twin: the roBucket dropped it (0 persisted)", persisted.length === 0);
}

// 1c. latest-monthly.zip missing -> 404 on &k=monthly (drill I-14's shape)
{
  const r2 = world();
  r2.store.delete("latest-monthly.zip");
  const { res } = await call(myLeadsGet,
    mk("https://masspermits.com/api/my-leads?t=" + tok("a") + "&k=monthly", { "user-agent": UA }), r2);
  check("missing latest-monthly.zip -> my-leads &k=monthly is 404", res.status === 404, res.status);
}

// 2. leads.js with the cookie
{
  const r2 = world();
  const { res, ro, persisted } = await call(leadsGet,
    mk("https://masspermits.com/leads", { "user-agent": UA, "x-mp-synthetic": "1", cookie: "mp_sess=" + tok("a") }), r2);
  const pa = ro.captured.filter((c) => c.key.startsWith("portal-access/"));
  check("leads.js (cookie): 200", res.status === 200, res.status);
  check("leads.js: exactly one captured portal-access/ write", pa.length === 1, pa.length);
  const m = (pa[0] && pa[0].customMetadata) || {};
  check("leads.js: its metadata carries tok, ua and st", "tok" in m && "ua" in m && "st" in m, JSON.stringify(m));
  check("leads.js: st is \"ok\" on a fresh world", m.st === "ok");
  check("leads.js: tok is an 8-char prefix, never the whole token", m.tok === tok("a").slice(0, 8));
  check("leads.js: ZERO persisted writes", persisted.length === 0);
}

// 2b. stale world -> the red page, still 200, st "red"
{
  const r2 = world({ htmlAgeH: 24 * 10, ranAgeH: 24 * 10 });
  const { res, ro } = await call(leadsGet,
    mk("https://masspermits.com/leads", { "user-agent": UA, cookie: "mp_sess=" + tok("a") }), r2);
  const pa = ro.captured.filter((c) => c.key.startsWith("portal-access/"));
  check("stale world: leads.js still answers 200 (the red page)", res.status === 200, res.status);
  check("stale world: the captured metadata says st \"red\"", pa.length === 1 && pa[0].customMetadata.st === "red");
}

// 2c. latest-weekly.html missing -> 302 to the download
{
  const r2 = world({ html: false });
  const { res, ro } = await call(leadsGet,
    mk("https://masspermits.com/leads", { "user-agent": UA, cookie: "mp_sess=" + tok("a") }), r2);
  check("missing latest-weekly.html: leads.js 302s", res.status === 302, res.status);
  check("missing latest-weekly.html: no portal-access capture", ro.captured.length === 0);
}

// 2d. kill switch on -> 302 to the download
{
  const r2 = world();
  await r2.bucket.put("portal.json", JSON.stringify({ off: true }));
  const { res } = await call(leadsGet,
    mk("https://masspermits.com/leads", { "user-agent": UA, cookie: "mp_sess=" + tok("a") }), r2);
  check("portal.json off:true: leads.js 302s", res.status === 302, res.status);
}

check("no Request handed to a handler carries an authorization header",
  requests.every((r) => !r.headers.has("authorization")));
check("fetch stub: 0 network calls from either handler", stub.calls.length === 0, stub.calls.map((c) => c.url).join(","));
done();
