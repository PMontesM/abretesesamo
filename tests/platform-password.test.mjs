import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDB} from './db.mjs';
import {hashSecret,verifySecret} from '../src/lib/security.js';
import {createSessionCookie} from '../src/lib/auth.js';
import worker from '../src/index.js';
test('cambio propio exige contraseña actual y revoca sesiones sin afectar otros administradores',async()=>{
 const {sqlite,db}=makeDB(),env={DB:db,ADMIN_SIGNING_SECRET:'test-signing-key-with-at-least-32-characters'};
 try{
 const original=await hashSecret('original-password');
 for(const id of ['a','b'])sqlite.prepare('INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,?)').run(id,id,original,1);
 const cookie=async id=>(await createSessionCookie(env,{id,session_version:1},true)).split(';')[0];
 const a=await cookie('a'),b=await cookie('b');
 const req=(path,body,auth=a)=>worker.fetch(new Request('https://test.local'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:auth},...(body?{body:JSON.stringify(body)}:{})}),env,{});
 const change=(currentSecret,newSecret,confirmSecret=newSecret,auth=a)=>req('/platform/api/change-password',{currentSecret,newSecret,confirmSecret},auth);
 assert.equal((await change('original-password','new-password','new-password','')).status,401);
 assert.equal((await change('wrong','new-password')).status,403);
 assert.equal((await change('original-password','new-password','mismatch')).status,400);
 assert.equal((await change('original-password','short')).status,400);
 assert.equal((await change('original-password','original-password')).status,400);
 assert.equal(sqlite.prepare('SELECT secret FROM platform_admins WHERE id=?').get('a').secret,original);
 const result=await change('original-password','new-password');assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
 const row=sqlite.prepare('SELECT * FROM platform_admins WHERE id=?').get('a');assert.equal(row.session_version,2);assert.ok(await verifySecret('new-password',row.secret));assert.ok(!await verifySecret('original-password',row.secret));
 assert.equal((await req('/platform/api/tenants')).status,401);assert.equal((await req('/platform/api/tenants',undefined,b)).status,200);
 const audit=sqlite.prepare('SELECT * FROM platform_audit_log').all();assert.equal(audit.length,1);assert.equal(audit[0].action,'change_own_password');assert.ok(!JSON.stringify(audit).includes('new-password'));
 assert.equal((await req('/platform/login',{username:'a',secret:'new-password'},'')).status,200);
 }finally{sqlite.close();}
});
