import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDB} from './db.mjs';
import * as db from '../src/lib/db.js';
import worker from '../src/index.js';
import {hashSecret} from '../src/lib/security.js';
async function setup(){const {sqlite,db:DB}=makeDB(),env={DB,ADMIN_SIGNING_SECRET:'account-test-only-secret-more-than-32-characters'};for(const slug of ['alpha','beta','foreign'])await db.createTenant(env,{slug,name:slug,gateName:'Gate',triggerType:'demo',masterUsername:'admin',masterEmail:slug==='alpha'?'person@example.com':slug+'@example.com',masterSecret:'global-password'});const beta=sqlite.prepare("SELECT id FROM tenants WHERE slug='beta'").get().id;await db.createUser(env,beta,{username:'resident',email:'Person@Example.com',secret:'unused-password',gateIds:[]});let cookie='';const req=async(path,body,custom=cookie)=>worker.fetch(new Request('https://app.test'+path,{method:body?'POST':'GET',headers:{Cookie:custom,Origin:'https://app.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{});return {sqlite,env,req,setCookie:r=>cookie=r.headers.get('Set-Cookie').split(';')[0],getCookie:()=>cookie};}
test('email provision keeps existing password, multiple buildings and isolated roles',async()=>{
 const s=await setup();try{
 assert.equal((await s.req('/account/login',{email:'person@example.com',secret:'unused-password'})).status,403);
 let r=await s.req('/account/login',{email:'person@example.com',secret:'global-password'});assert.equal(r.status,200);s.setCookie(r);const old=s.getCookie();
 const list=await(await s.req('/account/buildings')).json();assert.deepEqual(list.buildings.map(b=>[b.slug,b.role]),[['alpha','master'],['beta','user']]);assert.equal((await s.req('/t/beta/admin/users')).status,403);assert.equal((await s.req('/t/foreign/admin/panel')).status,401);
 assert.equal((await s.req('/account/link',{})).status,404);
 r=await s.req('/account/password',{currentSecret:'global-password',secret:'new-password',confirmSecret:'new-password'});assert.equal(r.status,200);assert.equal((await s.req('/t/alpha/admin/panel',undefined,old)).status,401);
 r=await s.req('/account/login',{email:'PERSON@example.com',secret:'new-password'});assert.equal(r.status,200);s.setCookie(r);
 s.sqlite.prepare("UPDATE tenants SET status='suspended' WHERE slug='beta'").run();assert.equal((await s.req('/t/beta/admin/panel')).status,403);assert.equal((await(await s.req('/account/buildings')).json()).buildings.length,1);
 await s.req('/account/logout',{});assert.equal((await s.req('/t/alpha/admin/panel')).status,401);
 }finally{s.sqlite.close();}
});
test('global superadmin does not inherit tenant access; sensitive operations use global password',async()=>{
 const s=await setup();try{const secret=await hashSecret('platform-password'),global=await hashSecret('global-password');s.sqlite.prepare('INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)').run('p','platform',secret,Date.now());s.sqlite.prepare('INSERT INTO accounts(id,email,secret,created_at) VALUES(?,?,?,?)').run('pa','super@example.com',global,Date.now());s.sqlite.prepare('INSERT INTO account_platform VALUES(?,?)').run('pa','p');const r=await s.req('/account/login',{email:'super@example.com',secret:'global-password'});assert.equal(r.status,200);s.setCookie(r);assert.equal((await s.req('/platform/api/panel')).status,200);assert.equal((await s.req('/t/alpha/admin/panel')).status,401);assert.equal((await s.req('/platform/api/panel',undefined,'account_session=bad.bad')).status,401);const {verifySession}=await import('../src/lib/auth.js');const session=await verifySession(new Request('https://app.test',{headers:{Cookie:s.getCookie()}}),s.env,null,true);assert.equal(session.secret,global);
 }finally{s.sqlite.close();}
});
