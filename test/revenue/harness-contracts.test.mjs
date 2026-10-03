import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Miniflare, HTMLRewriter } from "../harness/platform.mjs";
import { MemoryR2, withWorld, signedRequest, stripeEvent, loadHandlers, TEST_WEBHOOK_SECRET } from "../harness/index.mjs";

let mf, real, externalAttempts = 0;
const worker = `export default { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/list-limit") {
    const options=await request.json();
    try {
      const page=await env.BUNDLES.list(options);
      return Response.json({accepted:true,count:page.objects.length,
        truncated:page.truncated,hasCursor:!!page.cursor});
    } catch(e) { return Response.json({accepted:false,errorClass:e.name}); }
  }
  if (path === "/body") {
    await env.BUNDLES.put("headers_TEST","abc",{httpMetadata:{contentType:"text/plain",cacheControl:"private"}});
    const o=await env.BUNDLES.get("headers_TEST");const headers=new Headers();o.writeHttpMetadata(headers);
    const body=await o.text();const used=o.bodyUsed;let repeatThrows=false;
    try { await o.text(); } catch { repeatThrows=true; }
    return Response.json({header:headers.get("content-type"),body,used,repeatThrows});
  }
  if (path === "/html") return new HTMLRewriter().on("span", {
    element(e) { e.setInnerContent("<Casey & Test>"); }
  }).transform(new Response("<p><span>old</span></p>", {headers:{"content-type":"text/html"}}));
  if (path === "/crypto") {
    const body = await request.text();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_TEST_only_secret"),
      {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body));
    return new Response([...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,"0")).join(""));
  }
  if (path === "/request") return Response.json({
    method:request.method, body:await request.text(), header:request.headers.get("x-test")
  }, {headers:{"cache-control":"private, no-store"}});
  return new Response("TEST unknown route",{status:404});
}};`;
before(async () => {
  mf = new Miniflare({
    modules: true, script: worker, compatibilityDate: "2026-07-01",
    r2Buckets: ["BUNDLES"], r2Persist: false, cf: false,
    outboundService: async () => { externalAttempts++; throw new Error("TEST external network forbidden"); },
  });
  await mf.ready;
  real = await mf.getR2Bucket("BUNDLES");
});
after(async () => { if (mf) await mf.dispose(); assert.equal(externalAttempts, 0); });

async function trace(bucket, prefix) {
  const k = prefix + "/one";
  const result = [];
  result.push(await bucket.get(k) === null, await bucket.head(k) === null);
  const first = await bucket.put(k, "first", { customMetadata: {kind:"TEST"}, httpMetadata:{contentType:"text/plain"} });
  const read = await bucket.get(k);
  result.push(first.size, first.httpEtag, read.customMetadata, read.httpMetadata.contentType);
  await bucket.put(k, "second", {onlyIf:{etagMatches:first.etag}});
  result.push(await read.text(), read.bodyUsed);
  const denied = await bucket.put(k, "wrong", {onlyIf:{etagMatches:first.etag}});
  result.push(denied === null, await (await bucket.get(k)).text());
  const head = await bucket.head(k);
  result.push(head.etag !== first.etag, head.uploaded instanceof Date);
  const wrongRead = await bucket.get(k, {onlyIf:{etagMatches:"wrong_TEST"}});
  result.push(wrongRead !== null && !wrongRead.body);
  const exists = await bucket.put(k, "duplicate", {onlyIf:{etagDoesNotMatch:"*"}});
  const created = await bucket.put(prefix + "/two", "new", {onlyIf:{etagDoesNotMatch:"*"}});
  result.push(exists === null, created !== null);
  return result;
}
test("HARNESS R2 snapshot bodies, metadata, etags and conditional operations agree with local workerd", async () => {
  const fake = new MemoryR2();
  assert.deepEqual(await trace(fake,"trace"), await trace(real,"trace"));
});
test("HARNESS two conditional writers produce one winner in fake and local workerd", async () => {
  async function run(bucket,key) {
    const base = await bucket.put(key,"base");
    const results = await Promise.all([
      bucket.put(key,"left",{onlyIf:{etagMatches:base.etag}}),
      bucket.put(key,"right",{onlyIf:{etagMatches:base.etag}}),
    ]);
    return results.filter(Boolean).length;
  }
  assert.equal(await run(new MemoryR2(),"race"), 1);
  assert.equal(await run(real,"race"), 1);
});
test("HARNESS paginated prefix listing and metadata inclusion agree with local workerd", async () => {
  async function run(bucket) {
    for(let i=0;i<7;i++) await bucket.put("page_TEST/"+i,"x",{customMetadata:{tok:"TEST"+i}});
    await bucket.put("other_TEST/0","x");
    const keys=[], metadata=[];
    let cursor;
    do {
      const page = await bucket.list({prefix:"page_TEST/",limit:2,cursor,include:["customMetadata"]});
      for(const o of page.objects) { keys.push(o.key); metadata.push(o.customMetadata.tok); }
      cursor=page.truncated?page.cursor:undefined;
    } while(cursor);
    await bucket.delete(["page_TEST/1","page_TEST/2"]);
    return {keys,metadata,deleted:await bucket.get("page_TEST/1")===null};
  }
  assert.deepEqual(await run(new MemoryR2()),await run(real));
});
test("HARNESS consumed body semantics and headers agree with local workerd", async () => {
  const bucket=new MemoryR2();
  await bucket.put("used","abc",{httpMetadata:{contentType:"text/plain",cacheControl:"private"}});
  const o=await bucket.get("used");const headers=new Headers();o.writeHttpMetadata(headers);
  const body=await o.text();const used=o.bodyUsed;let repeatThrows=false;
  try { await o.text(); } catch { repeatThrows=true; }
  const actual=await mf.dispatchFetch("https://offline.invalid/body");
  assert.deepEqual({header:headers.get("content-type"),body,used,repeatThrows},await actual.json());
  assert.equal(repeatThrows,true);
});
test("HARNESS HTML escaping matches actual workerd HTMLRewriter", async () => {
  const local = new HTMLRewriter().on("span",{element(e){e.setInnerContent("<Casey & Test>");}})
    .transform(new Response("<p><span>old</span></p>",{headers:{"content-type":"text/html"}}));
  const actual = await mf.dispatchFetch("https://offline.invalid/html");
  assert.equal(await local.text(),await actual.text());
});
test("HARNESS raw-body HMAC fixture agrees with workerd crypto.subtle and real webhook verification", async () => {
  const payload = '1730000000.{"test":"CASEY_TEST","newline":"\\n"}';
  const actual = await mf.dispatchFetch("https://offline.invalid/crypto",{method:"POST",body:payload});
  assert.equal(await actual.text(),createHmac("sha256",TEST_WEBHOOK_SECRET).update(payload).digest("hex"));
  await withWorld(async(w)=>{
    const h=await loadHandlers();
    const event=stripeEvent("unhandled_TEST_event");
    const r=await w.call(h.webhook,signedRequest(event));
    assert.equal(r.status,200);assert.equal(w.mail.length,0);assert.equal(w.r2.ops.length,0);
  });
});
test("HARNESS Request and Response raw text and case-insensitive headers match workerd", async () => {
  const body='{"marker":"TEST","line":"\\n"}';
  const node=new Request("https://offline.invalid/request",{method:"POST",headers:{"X-Test":"TEST"},body});
  const expected={method:node.method,body:await node.text(),header:node.headers.get("x-test")};
  const actual=await mf.dispatchFetch("https://offline.invalid/request",{method:"POST",headers:{"X-Test":"TEST"},body});
  assert.deepEqual(await actual.json(),expected);assert.equal(actual.headers.get("cache-control"),"private, no-store");
});
test("HARNESS unknown outbound URLs throw before any real network", async () => withWorld(async()=>{
  await assert.rejects(()=>fetch("https://blocked.invalid/test"),/TEST blocked external request/);
}));
test("HARNESS fault queue consumes exactly one selected storage operation", async()=>{
  const b=new MemoryR2({a:"TEST"});
  b.failNext("get","a");
  await assert.rejects(()=>b.get("a"),/TEST injected/);
  assert.equal(await (await b.get("a")).text(),"TEST");
});

// Numeric cases observed against the same denied-transport local workerd binding.
// Nonnumeric/nonfinite coercions are deliberately outside this finite table.
for (const [label,limit,count,truncated] of [
  ["omitted",undefined,2,false], ["maximum 1000",1000,2,false],
  ["too large 1001",1001,null,false], ["zero",0,null,false],
  ["negative two",-2,null,false], ["default sentinel negative one",-1,2,false],
  ["negative fraction",-1.5,2,false], ["fraction below one",0.5,null,false],
  ["fraction above one",1.5,1,true], ["fraction above maximum",1000.5,2,false],
  ["too large 2000",2000,null,false],
]) test("HARNESS R2 list limit "+label+" agrees with local workerd",async()=>{
  const prefix="limit_contract_TEST/"+label.replaceAll(" ","_")+"/";
  const fake=new MemoryR2();
  for(const bucket of [fake,real])for(let i=0;i<2;i++)
    await bucket.put(prefix+i,"TEST",{customMetadata:{marker:"TEST"}});
  const options={prefix,include:["customMetadata"]};
  if(limit!==undefined)options.limit=limit;
  const response=await mf.dispatchFetch("https://offline.invalid/list-limit",{
    method:"POST",body:JSON.stringify(options)});
  const actual=await response.json();
  assert.deepEqual(actual,count===null?{accepted:false,errorClass:"Error"}:
    {accepted:true,count,truncated,hasCursor:truncated});
  let simulated;
  try {
    const page=await fake.list(options);
    simulated={accepted:true,count:page.objects.length,truncated:page.truncated,hasCursor:!!page.cursor};
  } catch(e) { simulated={accepted:false,errorClass:e.name}; }
  assert.deepEqual(simulated,actual);
});
