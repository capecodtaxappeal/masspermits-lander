// Deterministic, test-only mutation runner. Never edits tracked production source.
import { parse } from "acorn";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLONE = resolve(ROOT, "../../..");
const OUT = resolve(ROOT, "test/harness/.runtime/mutation");
const SCRATCH = resolve(CLONE, ".git/codex-session-scratch/revenue-mutation");
mkdirSync(OUT, {recursive:true}); mkdirSync(SCRATCH, {recursive:true});
const args = process.argv.slice(2);
const value = (flag, fallback) => { const i=args.indexOf(flag); return i<0?fallback:args[i+1]; };
const limit = Number(value("--limit", "24"));
const jobs = Number(value("--jobs", "3"));
const only = value("--file", "");
const rerun = value("--rerun-survivors", "");
if (!Number.isInteger(limit)||limit<1||limit>2000||!Number.isInteger(jobs)||jobs<1||jobs>4)
  throw new Error("Invalid bounded run settings");
const T = n => "test/revenue/"+n+".test.mjs";
const access=[T("access-storage"),T("auth-portal"),T("access-mutation")];
const weekly=[T("weekly-watchdog"),T("failure-injection"),T("operations-mutation")];
const gate=[...weekly,T("presend-contracts"),T("gate-mutation")];
const lifecycle=[...weekly,T("lifecycle-mutation")];
const targets=[
  ["functions/api/stripe-webhook.js",[T("webhook"),T("webhook-mutation")]],
  ["functions/api/_presend.js",gate],
  ["functions/api/pre-send-check.js",gate],
  ["functions/api/weekly-send.js",weekly],
  ["functions/api/send-status.js",weekly],
  ["functions/api/my-leads.js",access],
  ["functions/leads.js",access],
  ["functions/leads/out.js",[T("access-storage")]],
  ["functions/api/_notice.js",[T("webhook"),T("presend-contracts")]],
  ["functions/api/upload-bundle.js",access],
  ["functions/api/get-object.js",access],
  ["functions/api/_github-oidc.js",access],
  ["functions/api/_cf-access.js",access],
  ["functions/api/mail-owner.js",[T("auth-portal"),T("operations-mutation")]],
  ["functions/api/_lifecycle.js",lifecycle],
].filter(([file])=>!only||file===only);
for(const [,tests] of targets) for(const f of tests)
  if(!existsSync(resolve(ROOT,f))) throw new Error("Required test file missing: "+f);
const digest = s=>createHash("sha256").update(s).digest("hex");
const sources = new Map();
function collect(dir) {
  for(const item of readdirSync(dir,{withFileTypes:true})) {
    if(item.isSymbolicLink()) throw new Error("Unexpected source symlink");
    const path=resolve(dir,item.name);
    if(item.isDirectory()) collect(path);
    else if(item.name.endsWith(".js")) sources.set(relative(ROOT,path).split(sep).join("/"),readFileSync(path,"utf8"));
  }
}
collect(resolve(ROOT,"functions"));
function confined(path) {
  const rel=relative(CLONE,path);
  if(rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel)) throw new Error("Scratch escapes clone");
  return path;
}
function sandbox(id) {
  const dir=confined(resolve(SCRATCH,id)); mkdirSync(dir,{recursive:true});
  for(const [file,source] of sources) {
    const dst=resolve(dir,file); mkdirSync(dirname(dst),{recursive:true}); writeFileSync(dst,source);
  }
  return dir;
}
const flips={"===":"!==","!==":"===","==":"!=","!=":"==","<":">=",">":"<=","<=":">",">=":"<","&&":"||","||":"&&"};
function candidates(file,source) {
  const tokens=[];
  const ast=parse(source,{ecmaVersion:"latest",sourceType:"module",locations:true,onToken:tokens});
  const found=[],seen=new Set();
  function add(node,start,end,replacement,kind,label) {
    const key=start+":"+end+":"+replacement; if(seen.has(key))return;seen.add(key);
    found.push({id:digest(file+":"+key).slice(0,16),file,start,end,replacement,kind,
      line:node.loc.start.line,column:node.loc.start.column,original:label,
      sourceSHA256:digest(source)});
  }
  function visit(node) {
    if(!node||typeof node!=="object")return;
    if((node.type==="BinaryExpression"||node.type==="LogicalExpression")&&flips[node.operator]) {
      const tok=tokens.find(t=>t.start>=node.left.end&&t.end<=node.right.start&&source.slice(t.start,t.end)===node.operator);
      if(tok)add(node,tok.start,tok.end,flips[node.operator],"comparison",node.operator);
    }
    if(node.type==="AwaitExpression")
      add(node,node.start,node.argument.start,"","drop-await","await");
    if(node.type==="UnaryExpression"&&node.operator==="!")
      add(node,node.start,node.argument.start,"","invert-filter","!");
    if(node.type==="IfStatement"||node.type==="ConditionalExpression"||
       node.type==="WhileStatement"||node.type==="DoWhileStatement") {
      const n=node.test;
      add(n,n.start,n.end,"!("+source.slice(n.start,n.end)+")","invert-condition","predicate");
    }
    if(node.type==="Literal"&&typeof node.value==="boolean")
      add(node,node.start,node.end,String(!node.value),"boolean",String(node.value));
    if(node.type==="Literal"&&typeof node.value==="number"&&Number.isSafeInteger(node.value)&&node.value>=0&&node.value<=86400000)
      add(node,node.start,node.end,String(node.value+1),"boundary-plus-one",String(node.value));
    for(const [key,value] of Object.entries(node)) {
      if(["loc","start","end","raw"].includes(key))continue;
      if(Array.isArray(value)) {
        for(const child of value) if(child?.type)visit(child);
      } else if(value?.type)visit(value);
    }
  }
  visit(ast);
  return found.sort((a,b)=>a.start-b.start||a.kind.localeCompare(b.kind));
}
function select(list) {
  const groups=new Map();
  for(const m of list){ if(!groups.has(m.kind))groups.set(m.kind,[]);groups.get(m.kind).push(m); }
  for(const list of groups.values())list.sort((a,b)=>digest("S7-v1:"+a.id).localeCompare(digest("S7-v1:"+b.id)));
  const result=[];
  while(result.length<limit) {
    let took=false;
    for(const kind of [...groups.keys()].sort())if(groups.get(kind).length&&result.length<limit){result.push(groups.get(kind).shift());took=true;}
    if(!took)break;
  }
  return result;
}
const envBase={TEMP:SCRATCH,TMP:SCRATCH,TMPDIR:SCRATCH,
  GIT_NO_LAZY_FETCH:"1",GIT_TERMINAL_PROMPT:"0",GIT_OPTIONAL_LOCKS:"0"};
for(const name of ["SystemRoot","WINDIR","PATH","Path","PATHEXT"])if(process.env[name])envBase[name]=process.env[name];
function run(tests,sourceRoot) {
  return new Promise(resolveRun=>{
    const start=Date.now();let stdout="",stderr="",timedOut=false;
    const child=spawn(process.execPath,["--test","--test-reporter=tap",...tests],{
      cwd:ROOT,env:{...envBase,REVENUE_SOURCE_ROOT:sourceRoot},windowsHide:true,stdio:["ignore","pipe","pipe"]});
    child.stdout.on("data",x=>{stdout+=x;if(stdout.length>16*1024*1024)child.kill();});
    child.stderr.on("data",x=>{stderr+=x;if(stderr.length>1024*1024)child.kill();});
    const timer=setTimeout(()=>{
      timedOut=true;
      // Kill only this generated subprocess tree, never unrelated Node tasks.
      if(process.platform==="win32" && child.pid) {
        const stopped=spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],
          {env:envBase,windowsHide:true,stdio:"ignore",timeout:5000});
        if(stopped.status!==0)child.kill();
      } else child.kill();
    },30000);
    child.on("error",error=>{clearTimeout(timer);resolveRun({error:error.code||"spawn-error",status:null,hard:[],counts:{},ms:Date.now()-start});});
    child.on("close",(status,signal)=>{
      clearTimeout(timer);
      const hard=[...stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(x=>x[1]).filter(x=>!x.includes("# TODO"));
      const counts={};for(const k of ["tests","pass","fail","todo","cancelled","skipped"]) {
        const matches=[...stdout.matchAll(new RegExp("^# "+k+" (\\d+)$","gm"))];
        counts[k]=matches.length?Number(matches.at(-1)[1]):null;
      }
      resolveRun({status,signal,timedOut,hard,counts,ms:Date.now()-start,
        error:stdout.length>16*1024*1024||stderr.length>1024*1024?"output-limit":null});
    });
  });
}
const report={at:new Date().toISOString(),sourceRoot:ROOT,seed:"S7-v1",limit,jobs,
  method:"AST mutation; deterministic operator-stratified selection (exhaustive when limit covers every candidate); TODOs never kill; timeouts/errors remain unresolved",
  baseline:[],files:[],results:[],
  testSHA256:Object.fromEntries([...new Set(targets.flatMap(([,tests])=>tests))]
    .map(file=>[file,digest(readFileSync(resolve(ROOT,file),"utf8"))])),
  harnessSHA256:Object.fromEntries(["test/harness/index.mjs","test/harness/mutate.mjs","test/harness/package-lock.json"]
    .map(file=>[file,digest(readFileSync(resolve(ROOT,file),"utf8"))]))};
const baselineRoot=sandbox("baseline");
for(const [file,tests] of targets) {
  const signature=tests.join("|");let base=report.baseline.find(x=>x.signature===signature);
  if(!base) {
    const result=await run(tests,baselineRoot);base={signature,tests,...result};report.baseline.push(base);
    if(result.status!==0||result.hard.length||result.timedOut||result.error)
      throw new Error("Mutation baseline not healthy: "+JSON.stringify(base));
  }
  const all=candidates(file,sources.get(file));
  let chosen=select(all);
  if(rerun) {
    const previous=JSON.parse(readFileSync(confined(resolve(ROOT,rerun)),"utf8"));
    const priorFile=previous.files.find(f=>f.file===file);
    if(!priorFile || priorFile.sourceSHA256!==digest(sources.get(file)))
      throw new Error("Cannot carry mutation evidence across a changed source: "+file);
    const ids=new Set(previous.results.filter(r=>r.outcome!=="killed").map(r=>r.id));
    chosen=all.filter(m=>ids.has(m.id));
  }
  report.files.push({file,sourceSHA256:digest(sources.get(file)),candidates:all.length,selected:chosen.length,tests});
  report.results.push(...chosen.map(m=>({...m,tests,outcome:"pending"})));
}
const clean = r=>({...r,results:r.results.map(({replacement,start,end,tests,...m})=>m)});
writeFileSync(resolve(OUT,"catalog.json"),JSON.stringify(clean(report),null,2)+"\n");
let next=0,finished=0;
async function worker(slot) {
  const root=sandbox("worker-"+slot);
  while(next<report.results.length) {
    const m=report.results[next++],source=sources.get(m.file);
    const changed=source.slice(0,m.start)+m.replacement+source.slice(m.end);
    try {parse(changed,{ecmaVersion:"latest",sourceType:"module"});}
    catch {m.outcome="invalid";finished++;continue;}
    writeFileSync(resolve(root,m.file),changed);
    const result=await run(m.tests,root);
    writeFileSync(resolve(root,m.file),source);
    m.durationMs=result.ms;m.killedBy=result.hard;m.counts=result.counts;
    m.outcome=result.timedOut?"timeout":result.error?"runner-error":result.hard.length?"killed":
      result.status===0?"survived":"unclassified-error";
    finished++;
    writeFileSync(resolve(OUT,"progress.json"),JSON.stringify(clean(report),null,2)+"\n");
    if(finished%12===0||finished===report.results.length)
      console.log(JSON.stringify({finished,total:report.results.length,killed:report.results.filter(x=>x.outcome==="killed").length}));
  }
}
await Promise.all(Array.from({length:jobs},(_,i)=>worker(i)));
for(const f of report.files) {
  const rows=report.results.filter(r=>r.file===f.file);
  f.killed=rows.filter(r=>r.outcome==="killed").length;
  f.survived=rows.filter(r=>r.outcome==="survived").length;
  f.invalid=rows.filter(r=>r.outcome==="invalid").length;
  f.unresolved=rows.length-f.killed-f.survived-f.invalid;
  f.score=rows.length-f.invalid?Number((100*f.killed/(rows.length-f.invalid)).toFixed(1)):null;
}
for(const [file,expected] of Object.entries(report.testSHA256))
  if(digest(readFileSync(resolve(ROOT,file),"utf8"))!==expected)
    throw new Error("Test changed during mutation run: "+file);
report.completedAt=new Date().toISOString();
const filename=rerun?"rerun.json":"results.json";
writeFileSync(resolve(OUT,filename),JSON.stringify(clean(report),null,2)+"\n");
console.log(JSON.stringify({report:"test/harness/.runtime/mutation/"+filename,files:report.files},null,2));
process.exitCode=report.results.some(m=>["runner-error","unclassified-error","timeout","pending"].includes(m.outcome))?1:0;
