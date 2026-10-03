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
function publicCounts(body, gap, failed) {
  assert.equal(body.roster_gap,gap);
  assert.equal(body.last_failed,failed);
  assert.doesNotMatch(JSON.stringify(body),/casey|example\.com|Casey TEST|TEST rejection/i);
  assert.ok(!JSON.stringify(body).includes(TOKEN));
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
  assert.deepEqual(await r.json(),{ok:true});
  assert.deepEqual(w.mail,[{from:w.env.FROM_EMAIL,to:[w.env.OWNER_EMAIL],subject:"Synthetic TEST",html}]);
});
scenario("S7 owner relay defaults absent subjects and bounds supplied subjects at 160 characters",async w=>{
  for(const [query,expected] of [["","MassPermits automation"],["?subject="+ "x".repeat(161),"x".repeat(160)]]) {
    const r=await call(w,h.mailOwner,"/api/mail-owner"+query,{method:"POST",body:"TEST"});
    assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});
    assert.deepEqual(w.mail.at(-1),{from:w.env.FROM_EMAIL,to:[w.env.OWNER_EMAIL],subject:expected,html:"TEST"});
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


// Exhaustive mutation follow-up: independent observable sender/status contracts.
for(const [label,handler,path] of [
  ["sender",h.weeklySend,"/api/weekly-send"],["watchdog",h.sendStatus,"/api/send-status"]
]) scenario("S7 "+label+" rejects missing authorization with 401 before storage",async w=>{
  const r=await w.call(handler,path);
  assert.equal(r.status,401);assert.equal((await r.json()).error,"unauthorized");
  assert.equal(w.mail.length,0);assert.equal(w.r2.ops.length,0);
});
scenario("S7 ordinary weekly mail retains recipient first name, private link, dated bytes and success evidence",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  const r=await call(w,h.weeklySend,"/api/weekly-send"),b=await r.json();
  assert.equal(b.ok,true);assert.equal(b.delivered,1);assert.equal(b.failed,0);
  assert.equal(w.mail.length,1);
  const m=w.mail[0];
  assert.deepEqual(m.to,["casey@example.com"]);assert.equal(m.from,w.env.FROM_EMAIL);
  assert.equal(m.subject,"Your weekly MassPermits leads");
  assert.match(m.html,/<p>Hi Casey,/);assert.doesNotMatch(m.html,/<p>Hi TEST,/);
  assert.ok(m.html.includes("/api/my-leads?t="+TOKEN));
  assert.equal(m.attachments[0].filename,"MassPermits-weekly-2026-10-26.zip");
  assert.deepEqual(Buffer.from(m.attachments[0].content,"base64"),
    Buffer.from("504b0506000000000000000000000000000000000000","hex"));
});
scenario("S7 unnamed legacy recipient without a token still gets attachment without a fabricated private link",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  w.r2.set("subscribers.json",[{email:"casey@example.com"}]);
  const b=await (await call(w,h.weeklySend,"/api/weekly-send")).json();
  assert.equal(b.delivered,1);assert.equal(w.mail.length,1);
  assert.match(w.mail[0].html,/<p>Hi,/);
  assert.doesNotMatch(w.mail[0].html,/\/api\/my-leads\?t=|undefined/);
});
for(const [label,refresh,parts] of [
  ["healthy but disclosed",{ok:true,coverage:{disclose:true,live_sources:4,expected_sources:7,
    monthly_sources:["town-a, MA"]}},["<b>4 of 7</b>","town-a","publish their permits"]],
  ["degraded without coverage",{ok:false,degraded:true},["<b>fewer of our usual</b>"]],
  ["disclosed without monthly towns",{ok:true,coverage:{disclose:true,live_sources:4,expected_sources:7,
    monthly_sources:[]}},["<b>4 of 7</b>"]]
]) scenario("S7 "+label+" keeps the disclosure subject and accurate coverage wording",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  w.r2.set("refresh-status.json",{ran_at:NOW,...refresh});
  const b=await (await call(w,h.weeklySend,"/api/weekly-send")).json();
  assert.equal(b.delivered,1);assert.equal(w.mail.length,1);
  const m=w.mail[0];assert.equal(m.subject,"Your weekly MassPermits leads: reduced coverage, please read");
  for(const text of parts)assert.ok(m.html.includes(text),text);
  if(!refresh.coverage?.monthly_sources?.length)assert.doesNotMatch(m.html,/publish their permits/);
  assert.equal(w.r2.json("last-send-attempt.json").degraded,true);
});
for(const [label,age,expected] of [
  ["one millisecond before",8*DAY-1,200],["exactly at",8*DAY,500],["one millisecond after",8*DAY+1,500]
]) scenario("S7 sender refresh freshness "+label+" eight days",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  w.r2.set("refresh-status.json",{ok:true,ran_at:new Date(w.now-age).toISOString()});
  const r=await call(w,h.weeklySend,"/api/weekly-send");
  assert.equal(r.status,expected);assert.equal(w.mail.length,expected===200?1:0);
});
scenario("S7 short provider rejection preserves its leading diagnostic in the private log",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  await call(w,h.weeklySend,"/api/weekly-send");
  const sent=w.r2.json("feed-send-log.json")[0].sent;
  assert.equal(sent[0].ok,false);assert.equal(sent[0].error,"resend 500 TEST_PROVIDER_FAILURE");
},{mailResponses:[{status:500,body:"TEST_PROVIDER_FAILURE"}]});
scenario("S7 first weekly result creates a log when no prior log object exists",async w=>{
  seed(w);await w.r2.delete("feed-send-log.json");
  const b=await (await call(w,h.weeklySend,"/api/weekly-send")).json();
  assert.equal(b.delivered,1);
  const log=w.r2.json("feed-send-log.json");
  assert.equal(log.length,1);assert.equal(log[0].at,NOW);assert.equal(log[0].sent[0].ok,true);
});
for(const skip of [false,true]) scenario("S7 "+(skip?"skipped":"accepted")+" weekly result preserves the new evidence and prior outcomes",async w=>{
  seed(w);
  const history=Array.from({length:3},(_,i)=>({at:new Date(w.now-(i+1)*DAY).toISOString(),
    bundle_etag:skip&&i===0?"OPS_WEEKLY_TEST":"HISTORY_TEST_"+i,
    sent:[{to:"casey@example.com",ok:true}],history_TEST:i}));
  w.r2.set("feed-send-log.json",history);
  const r=await call(w,h.weeklySend,"/api/weekly-send");assert.equal(r.status,200);
  assert.equal(w.mail.length,skip?0:1);
  const saved=w.r2.json("feed-send-log.json");
  assert.equal(saved.length,4);assert.equal(saved[0].at,NOW);
  assert.deepEqual(saved.slice(1),history);
  if(skip)assert.match(saved[0].skipped,/identical bundle/);
});
scenario("S7 prior-week identical-bundle skip response waits for its attempted evidence write",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[{at:new Date(Date.parse(DUE)-WEEK).toISOString(),bundle_etag:"OPS_WEEKLY_TEST",
    sent:[{to:"casey@example.com",ok:true}]}]);
  const put=w.r2.put.bind(w.r2);let release,entered;
  const hold=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  w.r2.put=async(key,...args)=>{if(key==="feed-send-log.json"){entered();await hold;}return put(key,...args);};
  let finished=false;
  const pending=call(w,h.weeklySend,"/api/weekly-send").then(r=>{finished=true;return r;});
  try{await Promise.race([started,pending.then(()=>{throw new Error("Response finished before evidence write began");})]);
    await new Promise(r=>setImmediate(r));assert.equal(finished,false);assert.equal(w.mail.length,0);}
  finally{release();await pending;}
  assert.equal(w.r2.json("feed-send-log.json")[0].at,NOW);
  assert.match(w.r2.json("feed-send-log.json")[0].skipped,/identical bundle/);
});
scenario("S7 ordinary provider request waits for the attempted marker write",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  const put=w.r2.put.bind(w.r2);let release,entered;
  const hold=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  w.r2.put=async(key,...args)=>{if(key==="last-send-attempt.json"){entered();await hold;}return put(key,...args);};
  const pending=call(w,h.weeklySend,"/api/weekly-send");
  try{await Promise.race([started,pending.then(()=>{throw new Error("Response finished before attempt marker began");})]);
    await new Promise(r=>setImmediate(r));assert.equal(w.mail.length,0);}
  finally{release();await pending;}
  assert.equal(w.mail.length,1);
});
scenario("S7 watchdog retains historical timestamps and coverage when this week has no selected result",async w=>{
  seed(w);
  const old="2026-10-19T14:00:00.000Z",coverage={live_sources:4,expected_sources:7};
  w.r2.set("last-send-attempt.json",{at:old});
  w.r2.set("feed-send-log.json",[{at:old,coverage,sent:[{to:"casey@example.com",ok:true}]}]);
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.verdict,"missed");assert.equal(b.last_attempt_at,old);assert.equal(b.last_log_at,old);
  assert.equal(b.last_subscribers,0);assert.deepEqual(b.last_coverage,coverage);
  assert.ok(b.detail.includes(old));assert.equal(w.mail.length,0);
});
scenario("S7 partial-send diagnosis reports failure count against the actual attempt size",async w=>{
  seed(w);w.r2.set("last-send-attempt.json",{at:DUE});
  w.r2.set("feed-send-log.json",[{at:DUE,sent:[
    {to:"casey@example.com",ok:true},{to:"casey+two@example.com",ok:false,error:"TEST rejection"}]}]);
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.verdict,"partial");assert.equal(b.retry_safe,false);assert.equal(b.last_subscribers,2);
  assert.match(b.detail,/1 of 2 deliveries FAILED/);
  publicCounts(b,0,1);
});
scenario("S7 watchdog attempt age remains a readable rounded duration",async w=>{
  seed(w);w.r2.set("feed-send-log.json",[]);
  w.r2.set("last-send-attempt.json",{at:new Date(w.now-1.95*3600_000).toISOString()});
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.verdict,"unknown");assert.equal(b.retry_safe,false);
  assert.match(b.detail,/attempted (?:1\.9|1\.95|2(?:\.0+)?)h/);
});
scenario("S7 missing unpublished portal keeps the documented fresh-ZIP fallback state",async w=>{
  seed(w);await w.r2.delete("latest-weekly.html");
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.portal.state,"not_shipped");assert.equal(b.portal.alert,false);assert.equal(b.verdict,"ok");
  assert.equal(b.portal.published_at,null);assert.equal(b.portal.age_hours,null);
});
scenario("S7 portal staleness begins immediately after the eight-day boundary",async w=>{
  seed(w);const uploaded=new Date(w.now-8*DAY-1).toISOString();
  w.r2.set("latest-weekly.html","TEST",{uploaded});w.r2.set("latest-weekly.zip","TEST",{uploaded});
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.portal.state,"stale");assert.equal(b.portal.alert,true);assert.equal(b.retry_safe,false);
  assert.match(b.portal.detail,/in 8 days/);
});
scenario("S7 portal publication drift uses the documented nearest-minute value",async w=>{
  seed(w);const uploaded="2026-10-26T10:00:00.000Z";
  w.r2.set("latest-weekly.html","TEST",{uploaded});
  w.r2.set("latest-weekly.zip","TEST",{uploaded:new Date(Date.parse(uploaded)+15.5*60_000).toISOString()});
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.portal.drift_minutes,16);assert.equal(b.portal.state,"drift");assert.equal(b.portal.alert,true);
});
scenario("S7 blank-email roster rows do not create fabricated unserved identities",async w=>{
  seed(w);w.r2.set("subscribers.json",[
    {email:"casey@example.com",active:true},{email:"",active:true},{active:true}]);
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  publicCounts(b,0,0);assert.equal(b.verdict,"ok");
});

scenario("S7 clean delivery diagnosis reports its actual accepted-recipient count",async w=>{
  seed(w);
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.verdict,"ok");assert.match(b.detail,/delivered to 1 subscriber\(s\)/);
});
scenario("S7 roster-gap diagnosis preserves accepted and unserved counts independently",async w=>{
  seed(w);w.r2.set("subscribers.json",[
    {email:"casey@example.com",active:true},{email:"casey+two@example.com",active:true}]);
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.verdict,"roster_gap");assert.equal(b.retry_safe,false);
  assert.match(b.detail,/delivered to 1 subscriber\(s\), but 1 ACTIVE subscriber\(s\)/);
  publicCounts(b,1,0);
});
scenario("S7 partial delivery reports separate unserved and failed counts without exposing recipients",async w=>{
  seed(w);w.r2.set("subscribers.json",[
    {email:"casey@example.com",active:true},{email:"casey+two@example.com",active:true}]);
  w.r2.set("feed-send-log.json",[{at:DUE,sent:[
    {to:"casey@example.com",ok:true},{to:"casey+two@example.com",ok:false,error:"TEST rejection"}]}]);
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.verdict,"partial");assert.equal(b.retry_safe,false);
  publicCounts(b,1,1);
});

scenario("S7 portal reader counts include the current UTC day at exact midnight",async w=>{
  seed(w);
  const midnight=Date.parse("2026-10-27T00:00:00.000Z");
  for(const [at,tok] of [[Date.parse(DUE),"MIDDAY_TEST"],[midnight,"MIDNIGHT_TEST"]])
    w.r2.set("portal-access/"+new Date(at).toISOString().slice(0,10)+"/"+at+"-TEST","",
      {customMetadata:{tok}});
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.portal.opens_since_due,2);assert.equal(b.portal.distinct_readers_since_due,2);
},{now:"2026-10-27T00:00:00.000Z"});
scenario("S7 portal reader counts do not include keys from a future UTC day",async w=>{
  seed(w);
  const tomorrow=Date.parse("2026-10-27T12:00:00.000Z");
  w.r2.set("portal-access/2026-10-27/"+tomorrow+"-TEST","",{customMetadata:{tok:"FUTURE_TEST"}});
  const b=await (await call(w,h.sendStatus,"/api/send-status")).json();
  assert.equal(b.portal.opens_since_due,0);assert.equal(b.portal.distinct_readers_since_due,0);
});

scenario("S7 independently stale HTML alerts when ZIP head metadata is absent",async w=>{
  seed(w);
  const uploaded=new Date(Date.parse(NOW)-9*DAY).toISOString();
  w.r2.set("latest-weekly.html","<!doctype html><p>town-a TEST</p>",{uploaded});
  w.r2.store.delete("latest-weekly.zip");
  const r=await call(w,h.sendStatus,"/api/send-status");
  assert.equal(r.status,200);
  const b=await r.json();
  assert.equal(b.verdict,"portal_stale");assert.equal(b.retry_safe,false);
  assert.equal(b.portal.state,"stale");assert.equal(b.portal.alert,true);
  assert.equal(b.portal.published_at,uploaded);assert.equal(b.portal.age_hours,216);
  assert.equal(b.portal.drift_minutes,null);
  assert.equal(w.mail.length,0);assert.equal(w.r2.ops.some(o=>o.op==="put"||o.op==="delete"),false);
});

scenario("S7 independently stale HTML alerts when the ZIP head promise rejects asynchronously",async w=>{
  seed(w);
  const uploaded=new Date(Date.parse(NOW)-9*DAY).toISOString();
  w.r2.set("latest-weekly.html","<!doctype html><p>town-a TEST</p>",{uploaded});
  const head=w.r2.head.bind(w.r2);
  let rejected=false;
  w.r2.head=async key=>{
    if(key==="latest-weekly.zip") {
      await Promise.resolve();rejected=true;throw new Error("ZIP_HEAD_TEST");
    }
    return head(key);
  };
  const r=await call(w,h.sendStatus,"/api/send-status");
  assert.equal(r.status,200);
  const b=await r.json();
  assert.equal(rejected,true);
  assert.equal(b.verdict,"portal_stale");assert.equal(b.retry_safe,false);
  assert.equal(b.portal.state,"stale");assert.equal(b.portal.alert,true);
  assert.equal(b.portal.published_at,uploaded);assert.equal(b.portal.age_hours,216);
  assert.equal(b.portal.drift_minutes,null);
  assert.equal(w.mail.length,0);assert.equal(w.r2.ops.some(o=>o.op==="put"||o.op==="delete"),false);
});

scenario("S7 an asynchronously rejected HTML head retains the current not-shipped fallback semantics",async w=>{
  seed(w);
  const head=w.r2.head.bind(w.r2);
  let rejected=false;
  w.r2.head=async key=>{
    if(key==="latest-weekly.html") {
      await Promise.resolve();rejected=true;throw new Error("HTML_HEAD_TEST");
    }
    return head(key);
  };
  const r=await call(w,h.sendStatus,"/api/send-status");
  assert.equal(r.status,200);
  const b=await r.json();
  assert.equal(rejected,true);
  assert.equal(b.verdict,"ok");assert.equal(b.retry_safe,false);
  assert.equal(b.portal.state,"not_shipped");assert.equal(b.portal.alert,false);
  assert.equal(b.portal.published_at,null);assert.equal(b.portal.age_hours,null);
  assert.equal(b.portal.drift_minutes,null);
  assert.equal(w.mail.length,0);assert.equal(w.r2.ops.some(o=>o.op==="put"||o.op==="delete"),false);
});
