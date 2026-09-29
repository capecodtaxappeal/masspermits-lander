import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/upload-bundle.js';

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

async function call(key,headers) {
 headers ??= await authHeaders();
 const puts=[];
 const response=await onRequest({request:new Request('https://example.test/api/upload-bundle?key='+encodeURIComponent(key),{method:'PUT',headers,body:'SYNTHETIC_TEST'}),env:{BUNDLES:{put:async (...args)=>{puts.push(args);return {etag:'etag_TEST'};}}}});
 return {response,puts};
}
for(const key of ['constructor','toString','__proto__','hasOwnProperty','valueOf','subscribers.json','unknown_TEST']) {
 test('C17 rejects undeclared upload key '+key+' before storage',async()=>{
  const {response,puts}=await call(key);assert.equal(response.status,400);assert.equal(puts.length,0);
 });
}
test('C17 preserves every declared upload key',async()=>{
 for(const key of ['latest-monthly.zip','latest-weekly.zip','latest-sample.zip','refresh-status.json','run-log.txt','cold-state.json','cold-log.txt','source-health.json','latest-weekly.html']){
  const {response,puts}=await call(key);assert.equal(response.status,200,key);assert.equal(puts.length,1);assert.equal(puts[0][0],key);
 }
});
test('C17 still requires authentication before storage',async()=>{
 const {response,puts}=await call('latest-weekly.zip',{});assert.equal(response.status,401);assert.equal(puts.length,0);
});
