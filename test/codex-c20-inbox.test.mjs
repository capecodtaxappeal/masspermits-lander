import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {onRequest as inboxStatus} from '../functions/api/inbox-status.js';

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

// Only this endpoint's single JSON object is modeled here. All other effects fail.
async function withWorld(fn,{now}) {
 const originalNow=Date.now;Date.now=()=>Date.parse(now);
 let stored, fault;
 const ops=[];
 const r2={ops,set(key,value){assert.equal(key,'inbox-watchdog-state.json');stored=typeof value==='string'?value:JSON.stringify(value);},
 failNext(op,key,error){assert.equal(op,'get');assert.equal(key,'inbox-watchdog-state.json');fault=error;},
 async get(key){ops.push({op:'get',key});assert.equal(key,'inbox-watchdog-state.json');if(fault){const e=fault;fault=null;throw e;}return stored===undefined?null:{text:async()=>stored};}};
 const w={r2,mail:[],fetchCalls:[],oidcHeaders:authHeaders,call(handler,path,init={}){
 return handler({request:new Request('https://example.test'+path,init),env:{BUNDLES:r2}});}};
 try {return await fn(w);}finally{Date.now=originalNow;}
}
const NOW = '2026-09-28T14:00:00.000Z';
const LIVE = '2026-09-28T12:00:00.000Z';
const KEY = 'inbox-watchdog-state.json';
const PRIVATE = 'PRIVATE_DIAGNOSTIC_TEST';
const check = (name, fn) => test(name, { concurrency: false, timeout: 10000 }, fn);

// Matches the current producer's allowlisted live/dry shape, with synthetic
// counts only. Exercise the actual status handler with a single-object fake.
function run(extra = {}) {
  return { ran_at: LIVE, version: 'gs-TEST', mode: 'live', scanned: 4, waiting: 0,
    oldest_hours: 0, customers_waiting: 0, humans_waiting: 0, cold_replies_waiting: 0,
    alerted: false, errors: 0, roster_armed: true, roster_active: 1,
    roster_cancelled: 1, safe_mode: false, ...extra };
}
function live(extra = {}) {
  const last = run();
  return { last_live_run_at: LIVE, last_run_at: LIVE, last, history: [last], ...extra };
}
function dryOnly() {
  const at = '2026-09-28T13:00:00.000Z';
  return { history: [], last_run_at: at, last_dry_run_at: at,
    last_dry: run({ ran_at: at, mode: 'dry', roster_armed: false }) };
}
async function call(w, auth = true) {
  const response = await w.call(inboxStatus, '/api/inbox-status',
    { headers: auth ? await w.oidcHeaders() : {} });
  const raw = await response.text();
  return { response, raw, body: JSON.parse(raw) };
}
function readOnly(w) {
  assert.equal(w.mail.length, 0);
  assert.ok(w.r2.ops.every(op => op.op === 'get' && op.key === KEY));
}
function unknown(result) {
  assert.equal(result.response.status, 200);
  assert.equal(result.body.verdict, 'unknown'); assert.equal(result.body.alert, true);
  assert.equal(result.body.stale_after_hours, 30);
  assert.ok(typeof result.body.detail === 'string' && result.body.detail.length > 0);
  assert.doesNotMatch(result.raw, new RegExp(PRIVATE));
  assert.doesNotMatch(result.raw, /NaN|Infinity/);
  for (const key of ['last_live_run_at', 'hours_since_run', 'waiting', 'oldest_hours',
    'customers_waiting', 'humans_waiting', 'cold_replies_waiting', 'roster_armed',
    'roster_digests', 'safe_mode', 'scanned', 'errors', 'runs_recorded'])
    assert.equal(result.body[key], null, key + ' must not present untrusted state as known evidence');
}

check('C20 inbox a genuinely absent object keeps the existing never-installation response', async () => {
  await withWorld(async w => {
    const { response, body } = await call(w);
    assert.equal(response.status, 200); assert.equal(body.verdict, 'never'); assert.equal(body.alert, true);
    assert.equal(body.last_live_run_at, null); assert.equal(body.hours_since_run, null);
    assert.equal(body.runs_recorded, 0); readOnly(w);
  }, { now: NOW });
});

check('C20 inbox producer-shaped dry-only evidence does not masquerade as a live monitor', async () => {
  await withWorld(async w => {
    w.r2.set(KEY, dryOnly()); const { response, body } = await call(w);
    assert.equal(response.status, 200); assert.equal(body.verdict, 'never'); assert.equal(body.alert, true);
    assert.equal(body.last_live_run_at, null); assert.equal(body.waiting, null);
    assert.equal(body.runs_recorded, 0); readOnly(w);
  }, { now: NOW });
});

check('C20 inbox producer-shaped live evidence retains every ordinary count and the quiet verdict', async () => {
  await withWorld(async w => {
    w.r2.set(KEY, live()); const { response, body } = await call(w);
    assert.equal(response.status, 200); assert.equal(body.verdict, 'ok'); assert.equal(body.alert, false);
    assert.equal(body.last_live_run_at, LIVE); assert.equal(body.hours_since_run, 2);
    assert.equal(body.roster_digests, 2); assert.equal(body.roster_armed, true);
    assert.equal(body.scanned, 4); assert.equal(body.errors, 0); assert.equal(body.runs_recorded, 1);
    assert.equal(body.safe_mode, false); assert.equal(body.waiting, 0); readOnly(w);
  }, { now: NOW });
});

check('C20 inbox a newer dry run cannot freshen a stale live heartbeat or erase its backlog', async () => {
  await withWorld(async w => {
    const at = '2026-09-27T07:00:00.000Z';
    const last = run({ ran_at: at, waiting: 2, oldest_hours: 80 });
    w.r2.set(KEY, { ...live({ last_live_run_at: at, last, history: [last] }), ...dryOnly(), history: [last] });
    const { body } = await call(w);
    assert.equal(body.verdict, 'stale'); assert.equal(body.alert, true);
    assert.equal(body.last_live_run_at, at); assert.equal(body.waiting, 2); readOnly(w);
  }, { now: NOW });
});

for (const fault of ['get', 'body', 'JSON']) check(`C20 inbox ${fault} failure is unknown without exposing private error text`, async () => {
  await withWorld(async w => {
    w.r2.set(KEY, fault === 'JSON' ? '{' + PRIVATE : live());
    if (fault === 'get') w.r2.failNext('get', KEY, new Error(PRIVATE));
    if (fault === 'body') {
      const get = w.r2.get.bind(w.r2);
      w.r2.get = async key => { const object = await get(key); object.text = async () => { throw new Error(PRIVATE); }; return object; };
    }
    unknown(await call(w)); readOnly(w);
  }, { now: NOW });
});

for (const [name, value] of [['null', 'null'], ['array', '[]'], ['boolean', 'false'],
  ['number', '0'], ['string', JSON.stringify(PRIVATE)], ['empty object', '{}'],
  ['wrong history', JSON.stringify(live({ history: PRIVATE }))]]) {
  check(`C20 inbox present ${name} state is not confused with an absent object`, async () => {
    await withWorld(async w => { w.r2.set(KEY, value); unknown(await call(w)); readOnly(w); }, { now: NOW });
  });
}

for (const [name, value] of [['unparseable', PRIVATE], ['empty', ''], ['number', 0],
  ['boolean', false], ['object', { private: PRIVATE }], ['array', [PRIVATE]]]) {
  check(`C20 inbox ${name} live timestamp stays alerting and is not echoed`, async () => {
    await withWorld(async w => { w.r2.set(KEY, live({ last_live_run_at: value })); unknown(await call(w)); readOnly(w); }, { now: NOW });
  });
}

check('C20 inbox lost live timestamp with retained live history is unknown rather than never installed', async () => {
  await withWorld(async w => {
    w.r2.set(KEY, live({ last_live_run_at: null })); unknown(await call(w)); readOnly(w);
  }, { now: NOW });
});

for (const [name, last] of [['missing', undefined], ['null', null], ['array', []],
  ['unknown armed state', run({ roster_armed: undefined })],
  ['text count', run({ waiting: PRIVATE })], ['missing age', run({ oldest_hours: undefined })],
  ['negative count', run({ scanned: -1 })], ['text safe mode', run({ safe_mode: PRIVATE })]]) {
  check(`C20 inbox ${name} live summary is unknown instead of quiet or a thrown formatter error`, async () => {
    await withWorld(async w => { w.r2.set(KEY, live({ last })); unknown(await call(w)); readOnly(w); }, { now: NOW });
  });
}

check('C20 inbox legacy optional summary metadata and valid offset dates remain supported', async () => {
  await withWorld(async w => {
    const last = run(); delete last.safe_mode; delete last.mode; delete last.ran_at; delete last.version;
    w.r2.set(KEY, live({ last_live_run_at: '2026-09-28T08:00:00-04:00', last }));
    const { body } = await call(w);
    assert.equal(body.verdict, 'ok'); assert.equal(body.alert, false);
    assert.equal(body.hours_since_run, 2); assert.equal(body.safe_mode, false); readOnly(w);
  }, { now: NOW });
});

for (const [age, expected] of [[30 * 3600_000, 'ok'], [30 * 3600_000 + 1, 'stale']]) {
  check(`C20 inbox existing thirty-hour boundary remains ${expected} at age ${age}`, async () => {
    await withWorld(async w => {
      w.r2.set(KEY, live({ last_live_run_at: new Date(Date.parse(NOW) - age).toISOString() }));
      const { body } = await call(w); assert.equal(body.verdict, expected);
      assert.equal(body.alert, expected === 'stale'); readOnly(w);
    }, { now: NOW });
  });
}

for (const [hours, expected] of [[71.99, 'waiting'], [72, 'backlog']]) {
  check(`C20 inbox existing escalation boundary remains ${expected} at ${hours} hours`, async () => {
    await withWorld(async w => {
      w.r2.set(KEY, live({ last: run({ waiting: 1, oldest_hours: hours }) }));
      const { body } = await call(w); assert.equal(body.verdict, expected);
      assert.equal(body.alert, expected === 'backlog'); readOnly(w);
    }, { now: NOW });
  });
}

check('C20 inbox unarmed safe mode remains an alert rather than being reclassified as invalid', async () => {
  await withWorld(async w => {
    w.r2.set(KEY, live({ last: run({ roster_armed: false, safe_mode: true }) }));
    const { body } = await call(w); assert.equal(body.verdict, 'unarmed'); assert.equal(body.alert, true);
    assert.equal(body.safe_mode, true); assert.match(body.detail, /SAFE MODE/); readOnly(w);
  }, { now: NOW });
});

check('C20 inbox unauthorized requests still return 401 without reading state', async () => {
  await withWorld(async w => {
    w.r2.set(KEY, '{' + PRIVATE); const { response, body } = await call(w, false);
    assert.equal(response.status, 401); assert.equal(body.error, 'unauthorized');
    assert.equal(w.r2.ops.length, 0); assert.equal(w.mail.length, 0); assert.equal(w.fetchCalls.length, 0);
  }, { now: NOW });
});
