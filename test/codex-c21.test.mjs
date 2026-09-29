import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/pipeline-now.js';

const keys = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk = {...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'kid_SYNTHETIC_TEST',alg:'RS256',use:'sig'};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url=String(input instanceof Request ? input.url : input);
  assert.ok(['https://token.actions.githubusercontent.com/.well-known/jwks','https://test.cloudflareaccess.com/cdn-cgi/access/certs'].includes(url),'Only the intercepted synthetic key lookup is allowed');
  return Response.json({keys:[jwk]});
};
after(()=>{globalThis.fetch=originalFetch;});
async function authHeaders(access=false) {
  const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const head=b64({alg:'RS256',kid:jwk.kid});
  const body=b64({iss:access?'https://test.cloudflareaccess.com':'https://token.actions.githubusercontent.com',aud:access?'aud_TEST':'masspermits-cron',repository:'capecodtaxappeal/masspermits-lander',ref:'refs/heads/main',exp:Math.floor(Date.now()/1000)+600});
  const data=head+'.'+body;
  const signature=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))).toString('base64url');
  return access?{'cf-access-jwt-assertion':data+'.'+signature}:{authorization:'Bearer '+data+'.'+signature};
}

async function read(status,authorized=true) {
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-09-28T14:00:00Z');
 const reads=[];
 const env={CF_ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',CF_ACCESS_AUD:'aud_TEST',BUNDLES:{
  async get(key){reads.push(key);return key==='refresh-status.json'?{text:async()=>JSON.stringify(status)}:null;},
  async head(){return null;}}};
 try {const response=await onRequestGet({request:new Request('https://example.test/api/pipeline-now',{headers:authorized?await authHeaders(true):{}}),env});
 return {response,body:await response.json(),reads};}finally{Date.now=originalNow;}
}
test('C21 overdue refresh advice asks for evidence review without a workflow edit trigger',async()=>{
 const {response,body}=await read({ok:true,ran_at:'2026-09-27T10:00:00Z'});
 assert.equal(response.status,200);const data=body.rows.find(r=>r.id==='data');assert.equal(data.state,'bad');assert.equal(body.what_to_do,data.detail);
 assert.doesNotMatch(data.detail,/push any edit|workflows\/weekly-refresh\.yml on main|Force one/i);
 assert.match(data.detail,/inspect.*run/i);assert.match(data.detail,/review.*before.*trigger/i);
});
test('C21 fresh data keeps the healthy data row',async()=>{
 const {response,body}=await read({ok:true,ran_at:'2026-09-28T10:00:00Z',count:12,coverage:{live_sources:1,expected_sources:1}});
 assert.equal(response.status,200);const data=body.rows.find(r=>r.id==='data');assert.equal(data.state,'good');assert.match(data.detail,/12 rows/);
});
test('C21 unsigned callers cannot read operator data',async()=>{
 const {response,reads}=await read({},false);assert.equal(response.status,403);assert.deepEqual(reads,[]);
});
