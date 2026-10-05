import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {makeDB} from './db.mjs';
import worker from '../src/index.js';
test('instalación vacía completa: esquema único, superadmin, tenant y demo sin hardware',async()=>{
 const {sqlite,db}=makeDB(),env={DB:db,ADMIN_SIGNING_SECRET:'fresh-install-test-key-with-more-than-32-characters'};
 const check=readFileSync(new URL('../database/verificar.sql',import.meta.url),'utf8');
 assert.ok(Object.values(sqlite.prepare(check).get()).every(v=>v===0));
 const old=makeDB({legacy:true});old.migrate();
 for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()){
  const shape=db=>db.prepare(`PRAGMA table_info(${row.name})`).all().map(c=>[c.name,c.type,c.notnull,c.dflt_value,c.pk]);
  assert.deepEqual(shape(sqlite),shape(old.sqlite));
 }
 const dir=mkdtempSync(join(tmpdir(),'gate-fresh-test-'));
 const request=(path,body,cookie)=>worker.fetch(new Request('https://demo.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil:p=>p});
 try{
  const out=execFileSync(process.execPath,[fileURLToPath(new URL('../tools/crear-superadmin.mjs',import.meta.url)),'+12025550199'],{cwd:dir,encoding:'utf8'});
  const password=out.match(/Contraseña: (.+)/)[1].trim();sqlite.exec(readFileSync(join(dir,'.private/crear-superadmin.sql'),'utf8'));
  const login=await request('/account/login',{phone:'+12025550199',secret:password});assert.equal(login.status,200);const cookie=login.headers.get('Set-Cookie').split(';')[0];
  const create=await request('/platform/api/tenants',{name:'Edificio de prueba',slug:'prueba',gateName:'Puerta',triggerUrl:'https://demo.test/health',masterUsername:'admin',masterPhone:'+12025550100',masterSecret:'password-test'},cookie);assert.equal(create.status,200,await create.text());
  execFileSync(process.execPath,[fileURLToPath(new URL('../tools/crear-demo.mjs',import.meta.url)),'https://demo.test',join(dir,'demo')],{cwd:dir});
  sqlite.exec(readFileSync(join(dir,'demo/crear-tenant-demo.sql'),'utf8'));
  const demo=JSON.parse(readFileSync(join(dir,'demo/accesos-demo.json'),'utf8'));
  assert.equal((await request('/account/login',{phone:demo.users[0].phone,secret:demo.users[0].password})).status,200);
  const prev=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{assert.equal(new URL(url).pathname,'/health');calls++;return new Response('OK');};
  try{assert.equal((await request('/t/residencial-demo/api/open',{code:'120101'})).status,200);assert.equal(calls,0);}finally{globalThis.fetch=prev;}
  const counts=sqlite.prepare(check).get();assert.equal(counts.tenants,2);assert.equal(counts.platform_admins,1);
 }finally{
  sqlite.close();old.sqlite.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('gate-fresh-test-'));rmSync(dir,{recursive:true,force:true});
 }
});
