import test from "node:test";
import assert from "node:assert/strict";
import { loadHandlers, withWorld } from "../harness/index.mjs";
const h=await loadHandlers();
const TOKEN="a".repeat(32);
const NOW="2026-09-28T14:00:00Z";
async function accessToken(w,claims={},header={}) {
  const headers=await w.oidcHeaders({claims:{
    iss:"https://test.cloudflareaccess.com",aud:"aud_TEST_only",
    email:"casey@example.com",...claims
  },header});
  return headers.authorization.slice(7);
}
test("I25 Access assertion and cookie fallback use the real signature verifier",async()=>withWorld(async(w)=>{
  const token=await accessToken(w);
  for(const headers of [{"cf-access-jwt-assertion":token},{cookie:"CF_Authorization="+token}]) {
    const result=await h.cfAccess.verifyCfAccess(w.request("/admin/mission",{headers}),w.env);
    assert.equal(result.ok,true);assert.equal(result.email,"casey@example.com");
  }
}));
for(const [name,claims,header,reason] of [
  ["issuer",{iss:"https://other.invalid"},{},"iss"],
  ["audience",{aud:"wrong_TEST"},{},"aud"],
  ["expiry",{exp:1},{},"expired"],
  ["algorithm",{}, {alg:"HS256"},"alg"],
  ["key id",{}, {kid:"missing_TEST"},"kid"],
]){
  test("I25 Access rejects wrong "+name,async()=>withWorld(async(w)=>{
    const token=await accessToken(w,claims,header);
    const r=await h.cfAccess.verifyCfAccess(w.request("/admin/mission",{headers:{"cf-access-jwt-assertion":token}}),w.env);
    assert.equal(r.ok,false);assert.equal(r.reason,reason);assert.equal(w.mail.length,0);
  }));
}
test("I25 Access refuses missing configuration and missing assertions",async()=>withWorld(async(w)=>{
  assert.equal((await h.cfAccess.verifyCfAccess(w.request("/admin/mission"),{})).reason,"not-configured");
  assert.equal((await h.cfAccess.verifyCfAccess(w.request("/admin/mission"),w.env)).reason,"no-assertion");
}));
test("I25 Access rejects a tampered signature without contacting services",async()=>withWorld(async(w)=>{
  const token=await accessToken(w);const parts=token.split(".");
  parts[2]=(parts[2][0]==="A"?"B":"A")+parts[2].slice(1);
  const r=await h.cfAccess.verifyCfAccess(w.request("/admin/mission",{headers:{"cf-access-jwt-assertion":parts.join(".")}}),w.env);
  assert.equal(r.ok,false);assert.equal(r.reason,"sig");
}));
test("I25 I26 Access denial escapes hostile details and prevents cache/indexing",async()=>{
  const r=h.cfAccess.accessDenied({reason:"not-configured",detail:'<script>TEST</script>'});
  const body=await r.text();
  assert.equal(r.status,403);assert.equal(r.headers.get("cache-control"),"no-store");
  assert.match(r.headers.get("x-robots-tag"),/noindex/);assert.doesNotMatch(body,/<script>/);
  assert.match(body,/&lt;script&gt;/);
});
function seedPortal(w,over={}) {
  w.r2.set("subscribers.json",[{email:"casey@example.com",name:"Casey Test",active:true,token:TOKEN,customer:"cus_TEST_portal",...over}]);
  w.r2.set("latest-weekly.zip",new Uint8Array([80,75,3,4]),{uploaded:NOW});
  w.r2.set("latest-weekly.html",'<html><head></head><body><span class="fresh">updated TEST</span><p id="rows">TEST ROWS</p></body></html>',{uploaded:NOW});
  w.r2.set("refresh-status.json",{ran_at:NOW,ok:true});
}
test("I19 I21 I26 full portal rendering injects watermark, publication date and private headers",async()=>withWorld(async(w)=>{
  seedPortal(w);
  const r=await w.call(h.portal,"/leads",{headers:{cookie:"mp_sess="+TOKEN}});
  const body=await r.text();
  assert.equal(r.status,200);assert.match(body,/Licensed to/);assert.match(body,/casey@&hellip;/);
  assert.match(body,/published 2026-09-28/);assert.doesNotMatch(body,/updated TEST/);
  assert.match(body,/TEST ROWS/);assert.match(body,/noindex/);
  assert.match(r.headers.get("cache-control"),/private.*no-store/);
  assert.equal(r.headers.get("referrer-policy"),"no-referrer");
  assert.equal(w.r2.ops.filter(o=>o.op==="put"&&o.key.startsWith("portal-access/")).length,1);
}));
test("I26 unicode and hostile watermark content stays escaped during real HTML rewriting",async()=>withWorld(async(w)=>{
  seedPortal(w,{email:'casey<script>TEST</script>@example.com',name:"Casey \u96ea Test"});
  const r=await w.call(h.portal,"/leads",{headers:{cookie:"mp_sess="+TOKEN}});
  const body=await r.text();assert.equal(r.status,200);assert.doesNotMatch(body,/<script>/);
  assert.match(body,/casey&lt;script&gt;TEST&lt;\/script&gt;/);
}));
test("I21 stale portal suppresses rows while retaining a controlled customer response",async()=>withWorld(async(w)=>{
  seedPortal(w);
  const old="2026-09-01T00:00:00Z";
  w.r2.set("refresh-status.json",{ran_at:old,ok:true});
  w.r2.set("latest-weekly.html","TEST SECRET ROWS",{uploaded:old});
  const r=await w.call(h.portal,"/leads",{headers:{cookie:"mp_sess="+TOKEN}});
  assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/TEST SECRET ROWS/);
}));
test("I27 owner relay rejects provider 500 and accepts a recorded successful request",async()=>withWorld(async(w)=>{
  const headers=await w.oidcHeaders();headers["content-type"]="text/html";
  let r=await w.call(h.mailOwner,"/api/mail-owner?subject=TEST",{method:"POST",headers,body:"<p>TEST</p>"});
  assert.equal(r.status,502);assert.equal((await r.json()).ok,false);
  r=await w.call(h.mailOwner,"/api/mail-owner?subject=TEST",{method:"POST",headers,body:"<p>TEST</p>"});
  assert.equal(r.status,200);assert.equal(w.mail.length,2);
},{mailResponses:[{status:500,body:{message:"TEST rejected"}},{status:200,body:{id:"mail_TEST_owner"}}]}));
