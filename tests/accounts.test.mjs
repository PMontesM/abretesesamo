import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDB} from './db.mjs';
import * as db from '../src/lib/db.js';
import worker from '../src/index.js';
import {hashSecret} from '../src/lib/security.js';
async function setup(){const {sqlite,db:DB}=makeDB(),env={DB,ADMIN_SIGNING_SECRET:'account-test-only-secret-more-than-32-characters'};for(const slug of ['alpha','beta','foreign'])await db.createTenant(env,{slug,name:slug,gateName:'Gate',triggerType:'demo',masterUsername:'admin',masterSecret:'local-password'});const beta=sqlite.prepare("SELECT id FROM tenants WHERE slug='beta'").get().id;await db.createUser(env,beta,{username:'resident',secret:'resident-password',gateIds:[]});let cookie='';const req=async(path,body,custom=cookie)=>worker.fetch(new Request('https://app.test'+path,{method:body?'POST':'GET',headers:{Cookie:custom,Origin:'https://app.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{});return {sqlite,env,req,setCookie:r=>cookie=r.headers.get('Set-Cookie').split(';')[0],getCookie:()=>cookie};}
test('one email links distinct buildings with proof, retains per-building roles and enforces isolation',async()=>{
 const s=await setup();try{
 let r=await s.req('/account/link',{email:'Person@Example.com',secret:'global-password',building:'alpha',username:'admin',localSecret:'local-password'});assert.equal(r.status,200);s.setCookie(r);const firstCookie=s.getCookie();assert.equal((await s.req('/t/alpha/admin/panel')).status,200);assert.equal((await s.req('/t/beta/admin/panel')).status,401);
 r=await s.req('/account/link',{building:'beta',username:'resident',localSecret:'wrong'});assert.equal(r.status,400);
 r=await s.req('/account/link',{building:'beta',username:'resident',localSecret:'resident-password'});assert.equal(r.status,200);s.setCookie(r);
 const buildings=await (await s.req('/account/buildings')).json();assert.deepEqual(buildings.buildings.map(b=>[b.slug,b.role]),[['alpha','master'],['beta','user']]);assert.equal(buildings.email,'person@example.com');assert.equal((await s.req('/t/beta/admin/panel')).status,200);assert.equal((await s.req('/t/beta/admin/users')).status,403);assert.equal((await s.req('/t/foreign/admin/panel')).status,401);
 assert.equal((await s.req('/t/alpha/api/login',{username:'admin',secret:'local-password'},'')).status,403);
 assert.equal((await s.req('/account/link',{email:'person@example.com',secret:'wrong',building:'foreign',username:'admin',localSecret:'local-password'},'')).status,400);
 r=await s.req('/account/password',{currentSecret:'global-password',secret:'new-password',confirmSecret:'new-password'});assert.equal(r.status,200);assert.equal((await s.req('/t/alpha/admin/panel',undefined,firstCookie)).status,401);
 r=await s.req('/account/login',{email:'PERSON@example.com',secret:'new-password'},'');assert.equal(r.status,200);s.setCookie(r);assert.equal((await s.req('/t/beta/admin/panel')).status,200);
 s.sqlite.prepare("UPDATE tenants SET status='suspended' WHERE slug='beta'").run();assert.equal((await s.req('/t/beta/admin/panel')).status,403);assert.equal((await (await s.req('/account/buildings')).json()).buildings.length,1);
 await s.req('/account/logout',{});assert.equal((await s.req('/t/alpha/admin/panel')).status,401);
 }finally{s.sqlite.close();}
});
test('global superadmin requires proof of that account; malformed cookies and cross-origin requests fail',async()=>{
 const s=await setup();try{const secret=await hashSecret('platform-password');s.sqlite.prepare('INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)').run('p','platform',secret,Date.now());let r=await s.req('/account/link',{kind:'platform',email:'super@example.com',secret:'global-password',username:'platform',localSecret:'platform-password'});assert.equal(r.status,200);s.setCookie(r);assert.equal((await s.req('/platform/api/panel')).status,200);assert.equal((await s.req('/t/alpha/admin/panel')).status,401);assert.equal((await s.req('/platform/api/panel',undefined,'account_session=bad.bad')).status,401);
 r=await worker.fetch(new Request('https://app.test/account/login',{method:'POST',headers:{Origin:'https://evil.test'}}),s.env,{});assert.equal(r.status,403);assert.ok(r.headers.get('Content-Security-Policy'));assert.equal((await s.req('/')).status,302);
 }finally{s.sqlite.close();}
});
