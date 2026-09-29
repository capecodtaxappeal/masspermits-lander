import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/my-leads.js';
const TOKEN='a'.repeat(32), PRIVATE='PRIVATE_STORAGE_TEST';
const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Network forbidden');};after(()=>{globalThis.fetch=oldFetch;});
async function call({roster=JSON.stringify([{token:TOKEN,active:true}]),rosterFailure=false,bodyFailure=false,bundleFailure=false,bundle='ZIP_TEST',token=TOKEN}={}) {
 const gets=[],waits=[],writes=[];
 const response=await onRequestGet({request:new Request('https://example.test/api/my-leads?t='+token),env:{BUNDLES:{
  async get(key){gets.push(key);if(key==='subscribers.json'){if(rosterFailure)throw new Error(PRIVATE);return roster===undefined?null:{text:async()=>{if(bodyFailure)throw new Error(PRIVATE);return roster;}};}
   if(bundleFailure)throw new Error(PRIVATE);return bundle===null?null:{body:bundle};},
  async put(...args){writes.push(args);}
 }},waitUntil:p=>waits.push(p)});
 await Promise.all(waits);return {response,gets,writes};
}
for(const [name,opts] of [['missing',{roster:undefined}],['null',{roster:'null'}],['object',{roster:'{}'}],['string',{roster:'"wrong_TEST"'}],['malformed',{roster:'{TEST'}],['get failure',{rosterFailure:true}],['body failure',{bodyFailure:true}]]){
 test('C15 unavailable roster '+name+' gives controlled 503',async()=>{
  // Use null return explicitly for the missing object case.
  if(name==='missing') {
   const r=await onRequestGet({request:new Request('https://example.test/?t='+TOKEN),env:{BUNDLES:{get:async()=>null}}});
   assert.equal(r.status,503);return;
  }
  const {response,gets}=await call(opts);assert.equal(response.status,503);assert.deepEqual(gets,['subscribers.json']);assert.doesNotMatch(await response.text(),new RegExp(PRIVATE));
 });
}
test('C15 failed bundle read returns controlled 503 without diagnostics',async()=>{
 const {response}=await call({bundleFailure:true});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),new RegExp(PRIVATE));
});
test('C15 valid active and missing-active rows still receive private bytes',async()=>{
 for(const row of [{token:TOKEN,active:true},{token:TOKEN}]){
 const {response}=await call({roster:JSON.stringify([row])});assert.equal(response.status,200);assert.equal(await response.text(),'ZIP_TEST');assert.equal(response.headers.get('cache-control'),'no-store');}
});
test('C15 empty and explicitly inactive rosters remain denied',async()=>{
 for(const roster of [[],[{token:TOKEN,active:false}]]){
 const {response,gets}=await call({roster:JSON.stringify(roster)});assert.equal(response.status,403);assert.deepEqual(gets,['subscribers.json']);}
});
test('C15 absent bundle remains not ready while malformed token reads nothing',async()=>{
 const noFile=await call({bundle:null});assert.equal(noFile.response.status,404);
 const malformed=await call({token:'bad_TEST'});assert.equal(malformed.response.status,400);assert.deepEqual(malformed.gets,[]);
});
