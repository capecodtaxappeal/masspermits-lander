import test from "node:test";
import assert from "node:assert/strict";
import {loadHandlers,withWorld} from "../harness/index.mjs";
const h=await loadHandlers();
const NOW="2026-10-26T14:00:00.000Z", DUE="2026-10-26T12:00:00.000Z";
const DAY=86400_000, WEEK=7*DAY, TOKEN="a".repeat(32);
const scenario=(name,fn,options={})=>test(name,{concurrency:false,timeout:10000},()=>withWorld(fn,{now:NOW,...options}));
async function call(w,handler,path,options={}) {
  return w.call(handler,path,{...options,headers:{...await w.oidcHeaders(),...options.headers}});
}
function seed(w) {
  const uploaded="2026-10-26T10:00:00.000Z";
  w.r2.set("subscribers.json",[{email:"casey@example.com",name:"Casey TEST",active:true,token:TOKEN,since:"2026-09-08"}]);
  w.r2.set("feed-send-log.json",[{at:DUE,subscribers:1,sent:[{to:"casey@example.com",ok:true}]}]);
  w.r2.set("latest-weekly.zip",Buffer.from("504b0506000000000000000000000000000000000000","hex"),{uploaded,etag:"OPS_WEEKLY_TEST"});
  w.r2.set("latest-weekly.html","<!doctype html><p>town-a TEST</p>",{uploaded});
  w.r2.set("refresh-status.json",{ok:true,ran_at:uploaded});
}

scenario("S7 owner relay authenticates before reading request bodies or calling provider",async w=>{
  const request=w.request("/api/mail-owner",{method:"POST",body:"TEST"});
  request.text=async()=>{throw new Error("Body must not be read");};
  const r=await w.call(h.mailOwner,request);
  assert.equal(r.status,401);assert.equal(w.mail.length,0);assert.equal(w.r2.ops.length,0);
});
scenario("S7 owner relay preserves subject and body while ignoring caller-selected recipients",async w=>{
  const html="<p>town-a TEST \u96ea</p>";
  const r=await call(w,h.mailOwner,"/api/mail-owner?subject=Synthetic%20TEST&to=casey%2Buntrusted%40example.com",{method:"POST",body:html});
  assert.equal(r.status,200);assert.match(r.headers.get("content-type"),/application\/json/);
  const b=await r.json();assert.equal(b.ok,true);assert.equal(b.subject,"Synthetic TEST");
  assert.deepEqual(w.mail,[{from:w.env.FROM_EMAIL,to:[w.env.OWNER_EMAIL],subject:"Synthetic TEST",html}]);
});
scenario("S7 owner relay defaults absent subjects and bounds supplied subjects at 160 characters",async w=>{
  for(const [query,expected] of [["","MassPermits automation"],["?subject="+ "x".repeat(161),"x".repeat(160)]]) {
    const r=await call(w,h.mailOwner,"/api/mail-owner"+query,{method:"POST",body:"TEST"});
    assert.equal(r.status,200);assert.equal((await r.json()).subject,expected);assert.equal(w.mail.at(-1).subject,expected);
  }
});
scenario("S7 owner relay accepts the ASCII body limit and rejects empty or oversized bodies before provider",async w=>{
  for(const [size,status] of [[0,400],[512*1024,200],[512*1024+1,400]]) {
    const before=w.mail.length;
    const r=await call(w,h.mailOwner,"/api/mail-owner",{method:"POST",body:"x".repeat(size)});
    assert.equal(r.status,status);
    assert.equal(w.mail.length-before,status===200?1:0);
  }
});
for(const status of [429,500]) scenario("S7 owner relay exposes provider "+status+" without returning provider body",async w=>{
  const r=await call(w,h.mailOwner,"/api/mail-owner",{method:"POST",body:"TEST"});
  assert.equal(r.status,502);
  assert.deepEqual(await r.json(),{ok:false,error:"resend "+status});
  assert.equal(w.mail.length,1);
},{mailResponses:[{status,body:"SYNTHETIC_PROVIDER_DETAIL_TEST"}]});

scenario("S7 sender retains artifact fingerprints including a zero row count and actual byte length",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  const status=w.r2.json("refresh-status.json");
  status.bundle={weekly:{rows:0,rowset_sha256:"b".repeat(64),max_issued_date:"2026-10-25"}};
  w.r2.set("refresh-status.json",status);
  const r=await call(w,h.weeklySend,"/api/weekly-send");
  assert.equal(r.status,200);assert.equal((await r.json()).delivered,1);
  const log=w.r2.json("feed-send-log.json")[0],file=await w.r2.head("latest-weekly.zip");
  assert.equal(log.bundle_rows,0);assert.equal(log.bundle_rowset,"b".repeat(64));
  assert.equal(log.bundle_max_issued,"2026-10-25");assert.equal(log.bundle_bytes,file.size);
  assert.deepEqual(w.r2.json("last-send-attempt.json"),{at:NOW,subscribers:1,degraded:false});
});
scenario("S7 sender keeps unavailable fingerprints absent instead of inventing zero evidence",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  await call(w,h.weeklySend,"/api/weekly-send");
  const log=w.r2.json("feed-send-log.json")[0];
  for(const field of ["bundle_rows","bundle_rowset","bundle_max_issued","bundle_bytes"])
    assert.equal(Object.hasOwn(log,field),false);
});
scenario("S7 sender bounds rejected-provider evidence and still attempts the following recipient",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  w.r2.set("subscribers.json",[
    {email:"casey@example.com",active:true},{email:"casey+two@example.com",active:true}]);
  const r=await call(w,h.weeklySend,"/api/weekly-send");
  const b=await r.json();assert.equal(b.delivered,1);assert.equal(b.failed,1);assert.equal(w.mail.length,2);
  const sent=w.r2.json("feed-send-log.json")[0].sent;
  assert.equal(sent[0].ok,false);assert.equal(sent[0].error.length,120);assert.equal(sent[1].ok,true);
},{mailResponses:[{status:500,body:"x".repeat(300)},{status:200,body:{id:"mail_OPS_TEST"}}]});
scenario("S7 portal watchdog counts only post-due metadata and returns no reader identifiers",async w=>{
  seed(w);
  const due=Date.parse(DUE);
  for(const [offset,tok] of [[-1,"BEFORE_TEST"],[0,"abcd1234"],[1000,"abcd1234"],[2000,"fedc4321"],[3000,null]]) {
    const ts=due+offset;
    w.r2.set("portal-access/"+new Date(ts).toISOString().slice(0,10)+"/"+ts+"-TEST","PRIVATE_TEST",
      {customMetadata:tok?{tok}:{}});
  }
  const r=await call(w,h.sendStatus,"/api/send-status"),b=await r.json();
  assert.equal(r.status,200);assert.equal(b.verdict,"ok");assert.equal(b.retry_safe,false);
  assert.equal(b.portal.state,"ok");assert.equal(b.portal.alert,false);
  assert.equal(b.portal.opens_since_due,4);assert.equal(b.portal.distinct_readers_since_due,2);
  assert.equal(b.portal.published_at,"2026-10-26T10:00:00.000Z");
  assert.equal(b.portal.age_hours,4);assert.equal(b.portal.drift_minutes,0);
  assert.equal(b.last_log_at,DUE);assert.equal(b.last_subscribers,1);
  assert.equal(b.last_attempt_at,null);assert.equal(b.last_coverage,null);
  assert.doesNotMatch(JSON.stringify(b),/abcd1234|fedc4321|BEFORE_TEST|PRIVATE_TEST/);
  assert.equal(w.r2.ops.some(x=>x.op==="get"&&x.key.startsWith("portal-access/")),false);
});
scenario("S7 portal reader-count failure remains unknown rather than a fabricated zero",async w=>{
  seed(w);w.r2.failNext("list","portal-access/2026-10-26/");
  const r=await call(w,h.sendStatus,"/api/send-status"),b=await r.json();
  assert.equal(b.portal.opens_since_due,null);assert.equal(b.portal.distinct_readers_since_due,null);
});
for(const [name,age,drift,state,alert] of [
  ["at eight days",8*24,0,"ok",false],["older than eight days",8*24+1,0,"stale",true],
  ["at fifteen minutes",4,15,"ok",false],["beyond fifteen minutes",4,16,"drift",true]
]) scenario("S7 portal watchdog "+name,async w=>{
  seed(w);
  const uploaded=new Date(w.now-age*3600_000).toISOString();
  w.r2.set("latest-weekly.html","TEST",{uploaded});
  w.r2.set("latest-weekly.zip","TEST",{uploaded:new Date(Date.parse(uploaded)+drift*60_000).toISOString()});
  const r=await call(w,h.sendStatus,"/api/send-status"),b=await r.json();
  assert.equal(b.portal.state,state);assert.equal(b.portal.alert,alert);assert.equal(b.retry_safe,false);
  assert.equal(b.verdict,alert?"portal_"+state:"ok");
});
scenario("S7 delivery failure outranks an independently stale portal",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  w.r2.set("latest-weekly.html","TEST",{uploaded:"2026-10-01T10:00:00Z"});
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.verdict,"missed");assert.equal(b.retry_safe,true);assert.equal(b.portal.state,"stale");
});

function facts(extra={}) {return {active:true,payment_failing:false,payment_failing_days:null,collided:false,
  observed_cycles:4,downloads:3,days_since_download:1,cycles_hit_4:3,have_send_log:true,
  cycles_missing_4:0,cycles_delivered_4:4,cycles_due_4:4,cycles_no_product_4:0,
  machine_suspect:0,inactive_clicks:0,no_file:0,...extra};}
for(const [name,input,state,engagement,action] of [
  ["ordinary engagement",{},"healthy","engaged","none"],
  ["four cycles",{cycles_hit_4:4},"healthy","engaged","ask_referral"],
  ["casual engagement",{cycles_hit_4:2},"healthy","casual","none"],
  ["warming",{observed_cycles:1,downloads:0},"warming","warming","none"],
  ["never used",{downloads:0},"never-downloaded","never","ask_how_they_use_it"],
  ["lapsed",{days_since_download:22},"lapsed","lapsed","contact_48h"],
  ["exact lapse boundary",{days_since_download:21},"healthy","engaged","none"],
  ["token collision",{collided:true},"unattributable","unattributable","lengthen_join_key"],
  ["payment trouble",{payment_failing:true},"payment-failing","engaged","watch_stripe"],
  ["cancelled",{active:false},"cancelled","engaged","none"],
  ["cancelled winback",{active:false,inactive_clicks:1},"cancelled","engaged","winback"],
  ["legacy row",{active:undefined},"healthy","engaged","none"]
]) test("S7 lifecycle classification "+name,()=>{
  const result=h.lifecycle.classifyRow(facts(input));
  assert.equal(result.state,state);assert.equal(result.engagement,engagement);assert.equal(result.action,action);
});
test("S7 lifecycle blames missed delivery on the service before labeling customer disengagement",()=>{
  for(const extra of [{cycles_missing_4:1},{cycles_delivered_4:0,cycles_due_4:4},{no_file:1}]) {
    const r=h.lifecycle.classifyRow(facts({downloads:0,...extra}));
    assert.equal(r.blame,"us");assert.equal(r.action,"fix_delivery_first");
  }
  assert.equal(h.lifecycle.classifyRow(facts({have_send_log:false})).blame,"unknown");
  assert.equal(h.lifecycle.classifyRow(facts({active:false,cycles_missing_4:3,cycles_delivered_4:0})).flags.includes("delivery_gap"),false);
});
test("S7 lifecycle flags stale dunning only beyond thirty days for an eligible row",()=>{
  for(const [age,active,expected] of [[null,true,false],[30,true,false],[30.01,true,true],[31,false,false],[31,undefined,true]]) {
    const r=h.lifecycle.classifyRow(facts({active,payment_failing:true,payment_failing_days:age}));
    assert.equal(r.flags.includes("dunning_stale"),expected);
    if(active!==false)assert.equal(r.action,expected?"check_dunning_endstate":"watch_stripe");
  }
});
test("S7 lifecycle explicitly records opportunity, skipped-cycle and machine signals",()=>{
  const r=h.lifecycle.classifyRow(facts({cycles_delivered_4:3,cycles_no_product_4:1,machine_suspect:1}));
  assert.deepEqual(r.flags,["skipped_cycle","low_opportunity","machine_suspect"]);
  assert.equal(h.lifecycle.classifyRow(facts()).flags.length,0);
});
test("S7 lifecycle cycle boundaries and token-prefix width are explicit",()=>{
  const due=Date.parse(DUE);
  assert.equal(h.lifecycle.lastDueAt(due-1),due-WEEK);
  assert.equal(h.lifecycle.lastDueAt(due),due);
  for(const [offset,expected] of [[1,0],[0,0],[-1,1],[-WEEK,1],[-WEEK-1,2]])
    assert.equal(h.lifecycle.cycleIndex(due+offset,due),expected);
  assert.equal(h.lifecycle.t8of("0123456789abcdef"),"01234567");
  assert.equal(h.lifecycle.t8of(null),"");
});
test("S7 lifecycle rollup dedupes clicks, separates scanner/denial events and keeps public output anonymous",()=>{
  const now=Date.parse(NOW),start=now-DAY;
  const token="abcdef12"+"a".repeat(24);
  const event=(ts,metadata)=>({key:"dl/2026-10-25/"+ts+"-TEST",customMetadata:{t:"abcdef12",d:"d",...metadata}});
  const result=h.lifecycle.rollup({now,instrumentedAt:"2026-09-08",
    subs:[{email:"casey@example.com",name:"Casey TEST",token,since:"2026-09-08",active:true}],
    sendLog:[],prev:{rows:[{t8:"abcdef12",state:"warming"}]},
    events:[event(start,{}),event(start+600000,{}),event(start+600001,{d:"m"}),
      event(start+700000,{m:"1"}),event(start+800000,{r:"inactive"}),
      event(start+900000,{r:"no_match"}),event(start+1000000,{r:"no_file"})]});
  assert.equal(result.rows[0].downloads,2);
  assert.equal(result.rows[0].first_download,new Date(start).toISOString());
  assert.equal(result.rows[0].last_download,new Date(start+600001).toISOString());
  assert.equal(result.rows[0].device,"m");
  assert.equal(result.response.downloads_28d,2);
  assert.equal(result.response.machine_suspect,1);assert.equal(result.response.inactive_403,1);
  assert.equal(result.response.unmatched_403,1);assert.equal(result.response.no_file,1);
  assert.equal(result.response.served_no_file,1);assert.equal(result.response.transitions,1);
  assert.equal(result.alert,true);
  assert.doesNotMatch(JSON.stringify(result.response),/casey|abcdef12|Casey|example\.com/);
  assert.doesNotMatch(JSON.stringify(result.rows),/casey@example|Casey TEST/);
});
test("S7 lifecycle collision warns about identity attribution and preserves both rows",()=>{
  const now=Date.parse(NOW);
  const result=h.lifecycle.rollup({now,instrumentedAt:"2026-09-08",events:[],sendLog:[],subs:[
    {token:"12345678"+"a".repeat(24),email:"casey@example.com",since:"2026-09-08",active:true},
    {token:"12345678"+"b".repeat(24),email:"casey+two@example.com",since:"2026-09-08",active:true}]});
  assert.equal(result.rows.length,2);assert.equal(result.response.unattributable,2);assert.equal(result.alert,true);
  assert.ok(result.rows.every(r=>r.action==="lengthen_join_key"));
});
