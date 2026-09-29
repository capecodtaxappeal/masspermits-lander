// Combine source-identical mutation rounds without hiding unresolved outcomes.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,dirname,relative,isAbsolute,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
function inside(path) {
  const full=resolve(ROOT,path),rel=relative(ROOT,full);
  if(rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))throw new Error("Report path escapes worktree");
  return full;
}
const paths=process.argv.slice(2);
if(paths.length<1)throw new Error("Provide an exhaustive report, optionally followed by source-identical reruns");
const rounds=paths.map(path=>{
  const raw=readFileSync(inside(path),"utf8"),report=JSON.parse(raw);
  if(!report.completedAt)throw new Error("Incomplete mutation report");
  return {path,sha256:createHash("sha256").update(raw).digest("hex"),report};
});
const original=rounds[0].report;
if(original.files.some(f=>f.selected!==f.candidates))throw new Error("First round must be exhaustive");
const byId=new Map(original.results.map(m=>[m.id,{...m,evidenceRound:1}]));
if(byId.size!==original.results.length)throw new Error("Duplicate first-round IDs");
for(let i=1;i<rounds.length;i++) {
  const r=rounds[i].report,ids=new Set();
  for(const f of r.files) {
    const old=original.files.find(o=>o.file===f.file);
    if(!old||old.sourceSHA256!==f.sourceSHA256||old.candidates!==f.candidates)
      throw new Error("Mutation source or catalog changed: "+f.file);
  }
  for(const m of r.results) {
    const old=byId.get(m.id);
    if(!old||ids.has(m.id)||old.file!==m.file||old.sourceSHA256!==m.sourceSHA256)
      throw new Error("Unknown, duplicate or changed mutation: "+m.id);
    if(m.outcome==="pending")throw new Error("Pending mutation");
    ids.add(m.id);byId.set(m.id,{...m,evidenceRound:i+1});
  }
}
const results=[...byId.values()];
function summary(rows) {
  const counts=rows.reduce((out,m)=>(out[m.outcome]=(out[m.outcome]||0)+1,out),{});
  const valid=rows.length-(counts.invalid||0),killed=counts.killed||0;
  return {selected:rows.length,valid,killed,survived:counts.survived||0,invalid:counts.invalid||0,
    unresolved:valid-killed-(counts.survived||0),outcomes:counts,
    score:valid?Number((100*killed/valid).toFixed(1)):null};
}
const files=original.files.map(f=>({file:f.file,sourceSHA256:f.sourceSHA256,candidates:f.candidates,
  ...summary(results.filter(m=>m.file===f.file))}));
const output={
  generatedAt:new Date().toISOString(),
  method:rounds.length===1 ? "One complete exhaustive run against a single recorded source, test and harness hash set. Invalid syntax is excluded; timeout and process errors remain unresolved in the denominator. TODO assertions never kill." : "Accumulated evidence from an exhaustive catalog and source-identical reruns after additive test strengthening. Latest observed result wins for a repeated ID. Invalid syntax is excluded; timeout and process errors remain unresolved in the denominator. TODO assertions never kill.",
  rounds:rounds.map(({path,sha256,report:r})=>({path,sha256,startedAt:r.at,completedAt:r.completedAt,
    testCheckpoint:r.testCheckpoint||null,testSHA256:r.testSHA256||null,harnessSHA256:r.harnessSHA256||null,
    selected:r.results.length,baseline:r.baseline})),
  total:summary(results),
  payingPath:summary(results.filter(m=>m.file!=="functions/api/_lifecycle.js")),
  supplementalLifecycle:summary(results.filter(m=>m.file==="functions/api/_lifecycle.js")),
  files,results
};
const destination="test/harness/.runtime/mutation/final-summary.json";
mkdirSync(dirname(inside(destination)),{recursive:true});
writeFileSync(inside(destination),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({destination,total:output.total,payingPath:output.payingPath,files},null,2));
