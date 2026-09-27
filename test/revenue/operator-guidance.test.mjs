import test from "node:test";
import assert from "node:assert/strict";
import {withWorld} from "../harness/index.mjs";
import {onRequestGet} from "../../functions/api/pipeline-now.js";
const NOW="2026-09-28T14:00:00.000Z";
async function read(w) {
  const token=(await w.oidcHeaders({claims:{iss:"https://test.cloudflareaccess.com",aud:"aud_TEST_only",email:"casey@example.com"}})).authorization.slice(7);
  const r=await w.call(onRequestGet,"/api/pipeline-now",{headers:{"cf-access-jwt-assertion":token}});
  assert.equal(r.status,200);
  return r.json();
}
test("C21 overdue refresh guidance requires evidence review without a workflow-edit trigger",()=>withWorld(async w=>{
  w.r2.set("refresh-status.json",{ok:true,ran_at:"2026-09-27T10:00:00.000Z"});
  const b=await read(w),data=b.rows.find(r=>r.id==="data");
  assert.equal(data.state,"bad");assert.equal(b.what_to_do,data.detail);
  assert.doesNotMatch(data.detail,/push any edit|workflows\/weekly-refresh\.yml on main|Force one/i);
  assert.match(data.detail,/inspect.*run/i);assert.match(data.detail,/review.*before.*trigger/i);
  assert.equal(w.mail.length,0);
  assert.equal(w.r2.ops.some(op=>op.op==="put"||op.op==="delete"),false);
},{now:NOW}));
test("C21 fresh data retains the existing healthy data-row result",()=>withWorld(async w=>{
  w.r2.set("refresh-status.json",{ok:true,ran_at:"2026-09-28T10:00:00.000Z",count:12,
    coverage:{live_sources:1,expected_sources:1}});
  const b=await read(w),data=b.rows.find(r=>r.id==="data");
  assert.equal(data.state,"good");assert.match(data.detail,/12 rows/);
  assert.equal(w.mail.length,0);
},{now:NOW}));
test("C21 operator evidence still requires genuine Access authorization",()=>withWorld(async w=>{
  const r=await w.call(onRequestGet,"/api/pipeline-now");
  assert.equal(r.status,403);assert.equal(w.r2.ops.length,0);assert.equal(w.mail.length,0);
},{now:NOW}));
