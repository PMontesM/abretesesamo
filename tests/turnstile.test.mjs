import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {checkTurnstile,challengeAction} from '../src/lib/turnstile.js';
const env={TURNSTILE_REQUIRED:'true',TURNSTILE_SITE_KEY:'test-site',TURNSTILE_SECRET_KEY:'test-secret',PUBLIC_HOSTNAME:'app.test'};
const request=(path='/t/demo/api/open',token='valid')=>new Request('https://app.test'+path,{method:'POST',headers:{...(token?{'X-Turnstile-Token':token}:{}),'cf-connecting-ip':'192.0.2.1'}});
test('protected routes include platform, tenant login and both visitor entry points',()=>{
 for(const path of ['/account/login','/account/link','/platform/login','/t/demo/api/login','/t/demo/api/login/'])assert.equal(challengeAction(path),'login');
 for(const path of ['/t/demo/api/open','/t/demo/api/access-state','//t//demo/api/open/'])assert.equal(challengeAction(path),'visitor');
 assert.equal(challengeAction('/t/demo/admin/open-gate'),null);
});
test('missing token and alternate host are rejected before DB or outbound requests',async()=>{
 let calls=0;const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
 const guarded={...env,DB:{prepare(){throw Error('Database must not run');}}};
 try{
  for(const path of ['/account/login','/account/link','/platform/login','/t/demo/api/login','/t/demo/api/open','/t/demo/api/access-state'])assert.equal((await worker.fetch(request(path,null),guarded,{})).status,403);
  assert.equal((await worker.fetch(new Request('https://alternate.workers.dev/health'),guarded,{})).status,404);
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});
test('validates host, action, success and handles upstream failure without opening',async()=>{
 const old=globalThis.fetch;let result={success:true,hostname:'app.test',action:'visitor'},sent;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');sent=JSON.parse(options.body);return Response.json(result);};
 try{
  assert.equal(await checkTurnstile(request(),env),null);assert.equal(sent.response,'valid');assert.equal(sent.remoteip,'192.0.2.1');
  for(const change of [{hostname:'evil.test'},{action:'login'},{success:false,'error-codes':['timeout-or-duplicate']}]){result={success:true,hostname:'app.test',action:'visitor',...change};assert.equal((await checkTurnstile(request(),env)).status,403);}
  globalThis.fetch=async()=>{throw Error('network');};assert.equal((await checkTurnstile(request(),env)).status,503);
  assert.equal((await checkTurnstile(request(),{...env,TURNSTILE_SECRET_KEY:''})).status,503);
  assert.equal((await checkTurnstile(request('/t/demo/api/open','a'.repeat(2049)),env)).status,403);
  assert.equal(await checkTurnstile(request('/t/demo/admin/open-gate',null),env),null);
 }finally{globalThis.fetch=old;}
});
