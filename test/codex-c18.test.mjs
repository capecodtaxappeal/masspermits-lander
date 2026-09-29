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

const KEY='latest-weekly.zip';
function bucket(exists=true) {
 let stored=exists?{body:'OLD_TEST',etag:'old_TEST'}:null;
 const puts=[];
 return {puts,get value(){return stored;},
  async put(key,body,opts){
   puts.push({key,opts});const c=opts.onlyIf;
   if(c?.etagMatches!==undefined && (c.etagMatches==='*'?!stored:stored?.etag!==c.etagMatches))return null;
   if(c?.etagDoesNotMatch!==undefined && (c.etagDoesNotMatch==='*'?!!stored:stored?.etag===c.etagDoesNotMatch))return null;
   stored={body:Buffer.from(body).toString(),etag:'new_'+puts.length+'_TEST'};
   return {etag:stored.etag,httpEtag:'"'+stored.etag+'"'};
  }};
}
async function upload(b,conditions={},opts={}) {
 const headers={...await authHeaders(),...conditions};
 return onRequest({request:new Request('https://example.test/api/upload-bundle?key='+(opts.key||KEY),{method:opts.method||'PUT',headers:opts.noAuth?conditions:headers,body:opts.body??'NEXT_TEST'}),env:{BUNDLES:b}});
}
test('C18 unconditional uploads preserve the exact success shape and content metadata',async()=>{
 for(const [key,contentType] of [['latest-weekly.zip','application/zip'],['latest-monthly.zip','application/zip'],['latest-sample.zip','application/zip'],['refresh-status.json','application/json'],['run-log.txt','text/plain'],['cold-state.json','application/json'],['cold-log.txt','text/plain'],['source-health.json','application/json'],['latest-weekly.html','text/html']]){
 const b=bucket();const r=await upload(b,{}, {key,method:'POST'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,key,bytes:9});assert.equal(b.puts.length,1);assert.equal(b.puts[0].opts.httpMetadata.contentType,contentType);assert.equal(b.puts[0].opts.onlyIf,undefined);
 }
});
for(const [label,header,value,exists,status,condition] of [
 ['matching tag','If-Match','"old_TEST"',true,200,{etagMatches:'old_TEST'}],
 ['stale tag','If-Match','"old_TEST"',false,412,{etagMatches:'old_TEST'}],
 ['wrong tag','If-Match','"obsolete_TEST"',true,412,{etagMatches:'obsolete_TEST'}],
 ['existing wildcard','If-Match','*',true,200,{etagMatches:'*'}],
 ['missing wildcard','If-Match','*',false,412,{etagMatches:'*'}],
 ['new object','If-None-Match','*',false,200,{etagDoesNotMatch:'*'}],
 ['existing object','If-None-Match','*',true,412,{etagDoesNotMatch:'*'}],
 ['same excluded tag','If-None-Match','"old_TEST"',true,412,{etagDoesNotMatch:'old_TEST'}],
 ['different excluded tag','If-None-Match','"other_TEST"',true,200,{etagDoesNotMatch:'other_TEST'}],
 ['absent excluded tag','If-None-Match','"old_TEST"',false,200,{etagDoesNotMatch:'old_TEST'}],
 ['trimmed strong tag','If-Match','  "old_TEST"\t',true,200,{etagMatches:'old_TEST'}]
]){
 test('C18 atomic conditional upload '+label,async()=>{
  const b=bucket(exists),before=b.value;const r=await upload(b,{[header]:value});assert.equal(r.status,status);assert.equal(b.puts.length,1);assert.deepEqual(b.puts[0].opts.onlyIf,condition);
  if(status===412){assert.deepEqual(b.value,before);assert.equal((await r.json()).error,'precondition failed');assert.equal(r.headers.get('etag'),null);}
  else {assert.equal(b.value.body,'NEXT_TEST');assert.equal(r.headers.get('etag'),'"'+b.value.etag+'"');}
 });
}
for(const [name,headers] of [
 ['empty',{'If-Match':''}],['bare',{'If-Match':'old_TEST'}],['empty quoted',{'If-Match':'""'}],
 ['weak',{'If-Match':'W/"old_TEST"'}],['weak exclusion',{'If-None-Match':'W/"old_TEST"'}],
 ['list',{'If-Match':'"old_TEST", "next_TEST"'}],['wildcard list',{'If-None-Match':'*, "next_TEST"'}],
 ['quoted wildcard',{'If-Match':'"*"'}],['space',{'If-Match':'"old TEST"'}],['quote',{'If-Match':'"old"TEST"'}],
 ['both',{'If-Match':'*','If-None-Match':'*'}],['modified date',{'If-Modified-Since':'Mon, 28 Sep 2026 12:00:00 GMT'}],
 ['unmodified date',{'If-Unmodified-Since':'Mon, 28 Sep 2026 12:00:00 GMT'}],['range',{'If-Range':'"old_TEST"'}]
]){
 test('C18 unsupported '+name+' precondition fails before storage',async()=>{
  const b=bucket(),before=b.value;const r=await upload(b,headers);assert.equal(r.status,400);assert.equal(b.puts.length,0);assert.deepEqual(b.value,before);
 });
}
test('C18 opaque punctuation is forwarded as a literal strong tag',async()=>{
 const b=bucket();const r=await upload(b,{'If-Match':'"old_TEST,back\\slash"'});
 assert.equal(r.status,412);assert.deepEqual(b.puts[0].opts.onlyIf,{etagMatches:'old_TEST,back\\slash'});
});
test('C18 competing uploads have one winner and no unconditional retry',async()=>{
 const b=bucket();const responses=await Promise.all([upload(b,{'If-Match':'"old_TEST"'},{body:'LEFT_TEST'}),upload(b,{'If-Match':'"old_TEST"'},{body:'RIGHT_TEST'})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,412]);assert.equal(b.puts.length,2);assert.ok(['LEFT_TEST','RIGHT_TEST'].includes(b.value.body));
 assert.ok(b.puts.every(p=>p.opts.onlyIf.etagMatches==='old_TEST'));
});
test('C18 a failed conditional put returns an error without a fallback write',async()=>{
 const attempts=[];const b={async put(...args){attempts.push(args);throw new Error('WRITE_TEST');}};
 const r=await upload(b,{'If-Match':'"old_TEST"'});assert.equal(r.status,500);assert.equal(attempts.length,1);assert.deepEqual(attempts[0][2].onlyIf,{etagMatches:'old_TEST'});
});
test('C18 conditions cannot bypass authentication, protected keys or empty bodies',async()=>{
 for(const [opts,status] of [[{noAuth:true},401],[{key:'subscribers.json'},400],[{body:''},400]]){
 const b=bucket();const r=await upload(b,{'If-Match':'*'},opts);assert.equal(r.status,status);assert.equal(b.puts.length,0);
 }
});
