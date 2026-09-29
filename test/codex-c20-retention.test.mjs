import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {runRollup} from '../functions/api/_lifecycle.js';
const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Network forbidden');};after(()=>{globalThis.fetch=oldFetch;});
const NOW=Date.parse('2026-09-28T14:00:00Z');
function bucket(failWrite=false,failDelete=false,n=3) {
 const operations=[],events=Array.from({length:n},(_,i)=>({key:'dl/2025-01-01/1735689600000-'+String(i).padStart(8,'0'),customMetadata:{}}));
 return {operations,events,async get(){return null;},async list(){return {objects:events,truncated:false};},
 async put(key,body){operations.push({op:'put',key,body});if(failWrite)throw new Error('SAVE_TEST');return {};},
 async delete(keys){operations.push({op:'delete',keys});if(failDelete)throw new Error('DELETE_TEST');}};
}
test('C20 retention keeps every source event when aggregate persistence fails',async()=>{
 const b=bucket(true);const result=await runRollup(b,{now:NOW});
 assert.equal(result.response.stored,false);assert.equal(result.response.pruned,0);assert.equal(result.response.prune_remaining,3);
 assert.deepEqual(b.operations.map(x=>x.op),['put']);assert.equal(b.operations[0].key,'engagement.json');
});
test('C20 retention prunes only after durable aggregate persistence',async()=>{
 const b=bucket();const result=await runRollup(b,{now:NOW});
 assert.equal(result.response.stored,true);assert.equal(result.response.pruned,3);assert.equal(result.response.prune_remaining,0);
 assert.deepEqual(b.operations.map(x=>x.op),['put','delete']);assert.deepEqual(b.operations[1].keys,b.events.map(x=>x.key));
 assert.ok(Array.isArray(JSON.parse(b.operations[0].body).rows));
});
test('C20 retention delete failure does not invalidate the saved aggregate',async()=>{
 const b=bucket(false,true);const result=await runRollup(b,{now:NOW});
 assert.equal(result.response.stored,true);assert.equal(result.response.pruned,0);assert.equal(result.response.prune_remaining,3);
});
test('C20 retention retains its bounded batch size after successful save',async()=>{
 const b=bucket(false,false,301);const result=await runRollup(b,{now:NOW});
 assert.equal(result.response.stored,true);assert.equal(result.response.pruned,200);
 assert.ok(b.operations.filter(x=>x.op==='delete').every(x=>x.keys.length<=100));
 assert.equal(result.response.pruned+result.response.prune_remaining,301);
});
