// roBucket: the read-only R2 view the monday rehearsal hands to everything.
//
//   node functions/api/ro_bucket.test.mjs
//
// Proves: exactly five methods; get/head/list pass through; put/delete are
// captured and dropped by default (rehearsal/ included); only
// {allowPrefix: "rehearsal/"} persists, and only under that prefix; multipart
// methods do not exist, so calling them throws with 0 bucket operations; put
// returns a Promise that .catch() can chain on.

import { roBucket } from "./_ro_bucket.js";
import { fakeR2, makeRunner, makeFetchStub } from "../../test/rehearsal/harness.mjs";

const stub = makeFetchStub({});
globalThis.fetch = stub.fetch; // any network call from here is a failure

const { check, done } = makeRunner("ro_bucket.test.mjs");

// 1. shape
{
  const r2 = fakeR2();
  const ro = roBucket(r2.bucket);
  const own = Object.keys(ro).sort();
  check("own enumerable methods are exactly delete, get, head, list, put",
    JSON.stringify(own) === JSON.stringify(["delete", "get", "head", "list", "put"]), own.join(","));
  check("it is a plain object, not a Proxy-like wrapper",
    Object.getPrototypeOf(ro) === Object.prototype);
  check("the captured log is exposed as an array", Array.isArray(ro.captured));
  for (const m of ["createMultipartUpload", "resumeMultipartUpload"]) {
    let threw = false;
    try { ro[m]("rehearsal/x"); } catch { threw = true; }
    check(`${m} throws`, threw);
  }
  check("the multipart attempts made 0 operations on the bucket", r2.ops.length === 0, r2.ops.length);
  let added = false;
  try { ro.extra = () => 1; added = typeof ro.extra === "function"; } catch { added = false; }
  check("no method can be added to it", !added);
}

// 2. reads pass through
{
  const r2 = fakeR2({ "refresh-status.json": { ok: true }, "dl/a": "", "dl/b": "" });
  const ro = roBucket(r2.bucket);
  const g = await ro.get("refresh-status.json");
  check("get passes through", g && (await g.json()).ok === true);
  const h = await ro.head("refresh-status.json");
  check("head passes through", h && typeof h.etag === "string");
  const l = await ro.list({ prefix: "dl/" });
  check("list passes through", l.objects.length === 2);
  check("reads reach the bucket", r2.ops.filter((o) => o.op !== "put").length === 3);
}

// 3. default: every write dropped, rehearsal/ included
{
  const r2 = fakeR2();
  const ro = roBucket(r2.bucket);
  const p = ro.put("rehearsal/x", "1");
  check("put returns a Promise", p && typeof p.then === "function");
  let chained = false;
  try { await ro.put("portal-access/2026-10-04/1-aaaaaaaa", "", { customMetadata: { st: "ok" } }).catch(() => {}); chained = true; } catch { chained = false; }
  check("put(...).catch() chains (leads.js pattern)", chained);
  await p;
  await ro.put("dl/2026-10-04/1-aaaaaaaa", "");
  await ro.put("subscribers.json", "[]");
  await ro.delete("subscribers.json");
  await ro.delete(["rehearsal/a", "rehearsal/b"]);
  check("roBucket(bucket) with NO options drops a put to rehearsal/x",
    r2.text("rehearsal/x") === null);
  check("0 writes reached the bucket", r2.writes().length === 0, JSON.stringify(r2.writes()));
  check("every write is captured", ro.captured.length === 6, ro.captured.length);
  check("every captured write is marked not persisted", ro.captured.every((c) => c.persisted === false));
  check("captured metadata is kept for the portal-access write",
    ro.captured[1].customMetadata && ro.captured[1].customMetadata.st === "ok");
}

// 4. allowPrefix "rehearsal/": only that prefix persists
{
  const r2 = fakeR2({ "subscribers.json": "[]" });
  const ro = roBucket(r2.bucket, { allowPrefix: "rehearsal/" });
  await ro.put("rehearsal/log.json", "[]");
  await ro.put("rehearsalX/log.json", "[]");
  await ro.put("subscribers.json", "[{}]");
  await ro.put("dl/x", "");
  await ro.delete("subscribers.json");
  await ro.delete(["rehearsal/log.json", "subscribers.json"]);
  const persisted = r2.writes().map((w) => w.op + ":" + w.key);
  check("only the rehearsal/ put persisted",
    JSON.stringify(persisted) === JSON.stringify(["put:rehearsal/log.json"]), persisted.join(","));
  check("subscribers.json untouched", r2.text("subscribers.json") === "[]");
  check("a mixed delete batch is dropped whole", r2.text("rehearsal/log.json") === "[]");
  check("captured marks exactly one persisted write",
    ro.captured.filter((c) => c.persisted).length === 1);
}

// 5. an empty or non-string allowPrefix is no prefix at all
{
  for (const opts of [{ allowPrefix: "" }, { allowPrefix: null }, { allowPrefix: 1 }, {}]) {
    const r2 = fakeR2();
    const ro = roBucket(r2.bucket, opts);
    await ro.put("rehearsal/x", "1");
    await ro.put("anything", "1");
    check(`allowPrefix ${JSON.stringify(opts.allowPrefix)} persists nothing`, r2.writes().length === 0);
  }
}

check("0 network calls", stub.calls.length === 0 && stub.unexpected.length === 0);
done();
