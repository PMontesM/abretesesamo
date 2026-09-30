import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { makeDB } from './db.mjs';
import worker from '../src/index.js';
import * as data from '../src/lib/db.js';
import { hashSecret,verifySecret } from '../src/lib/security.js';
import { getAdminHTML } from '../src/html/admin.js';
import { getPlatformAdminHTML } from '../src/html/platform.js';
import { getPublicHTML } from '../src/html/public.js';
const {sqlite,db,migrate}=makeDB({legacy:true});
const env={DB:db,ADMIN_SIGNING_SECRET:'test-signing-key-32-characters-minimum-123'};
const ctx={waitUntil:p=>p};
let cookie,platformCookie,calls=[],failure=false;
globalThis.fetch=async(url)=>{calls.push(url);if(failure)throw Error('timeout');return new Response('ok');};
async function req(path,body,c=cookie){return worker.fetch(new Request('https://app.test'+path,{method:body===undefined?'GET':'POST',headers:{...(c?{Cookie:c}:{}),...(body===undefined?{}:{'Content-Type':'application/json','Origin':'https://app.test'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);}
const json=async r=>{const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;};
const tenant={id:'a',slug:'alpha',name:'Alpha'};
let code;
async function managementRef(code){const row=sqlite.prepare('SELECT label FROM codes WHERE tenant_id=? AND code=?').get('a',code);const d=await json(await req('/platform/api/codes?tenantId=a&status=',undefined,platformCookie));return d.codes.find(c=>c.label===row.label).codeRef;}

test('migración conserva permisos actuales y revoca códigos sin propietario',()=>{
 sqlite.exec(`INSERT INTO tenants VALUES('a','alpha','Alpha',1,'active'); INSERT INTO tenants VALUES('b','beta','Beta',1,'active');
 INSERT INTO gates VALUES('g1','a','Principal','webhook','{"url":"https://device.test/one"}',1);
 INSERT INTO gates VALUES('g2','a','Trasero','webhook','{"url":"https://device.test/two"}',2);
 INSERT INTO gates VALUES('gb','b','Ajeno','webhook','{"url":"https://device.test/foreign"}',1);
 INSERT INTO users VALUES('master','a','admin','123456','master',1);
 INSERT INTO users VALUES('resident','a','resident','654321','user',1);
 INSERT INTO codes VALUES('999999','a','g1','Huérfano','missing',1,NULL,1);
 INSERT INTO platform_admins VALUES('pa','platform','platform-old',1);`);
 migrate();assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM user_gates').get().n,2);
 assert.equal(sqlite.prepare("SELECT status FROM codes WHERE code='999999'").get().status,'revoked');
});
test('herramienta migra contraseñas existentes sin texto plano en la BD',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gate-test-'));
 try{
  writeFileSync(join(dir,'u.json'),JSON.stringify([{results:sqlite.prepare('SELECT * FROM users').all()}]));
  writeFileSync(join(dir,'p.json'),JSON.stringify([{results:sqlite.prepare('SELECT * FROM platform_admins').all()}]));
  execFileSync(process.execPath,[new URL('./fixtures/legacy/migrate-credentials.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),join(dir,'u.json'),join(dir,'p.json'),join(dir,'out.sql')]);
  sqlite.exec(readFileSync(join(dir,'out.sql'),'utf8'));
  assert.ok(await verifySecret('123456',sqlite.prepare("SELECT secret FROM users WHERE id='master'").get().secret));
  assert.ok(!await verifySecret('wrong',sqlite.prepare("SELECT secret FROM users WHERE id='master'").get().secret));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('login explícito separa contraseña de código y no revela hashes',async()=>{
 const r=await req('/t/alpha/api/login',{username:'admin',secret:'123456'},null);await json(r);cookie=r.headers.get('Set-Cookie').split(';')[0];
 const p=await req('/platform/login',{username:'platform',secret:'platform-old'},null);await json(p);platformCookie=p.headers.get('Set-Cookie').split(';')[0];
 const users=await json(await req('/t/alpha/admin/users'));assert.ok(users.users.every(u=>!('secret'in u)));
 assert.equal((await req('/t/alpha/api/open',{code:'123456'},null)).status,403);
 assert.equal((await req('/t/beta/admin/gates',undefined,cookie)).status,401);
});
test('crear código almacena el portón elegido y devuelve referencia y vigencia',async()=>{
 const d=await json(await req('/t/alpha/admin/create-code',{gateId:'g2',label:'Visita',days:2,singleUse:true}));code=d.code.code;
 assert.equal(d.code.gate_name,'Trasero');assert.equal(d.code.gate_id,'g2');assert.ok(d.code.expires_at>Date.now());
 assert.equal((await req('/t/alpha/admin/create-code',{gateId:'gb',label:'X',days:1,singleUse:false})).status,400);
 assert.equal((await req('/t/alpha/admin/create-code',{gateId:'g2',label:'X',days:-1,singleUse:false})).status,400);
});
test('dos solicitudes simultáneas solo envían una orden de un solo uso',async()=>{
 calls=[];const results=await Promise.all([req('/t/alpha/api/open',{code},null),req('/t/alpha/api/open',{code},null)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);assert.deepEqual(calls,['https://device.test/two']);
 assert.equal(sqlite.prepare('SELECT status FROM codes WHERE code=?').get(code).status,'used');
 assert.equal(sqlite.prepare('SELECT gate_name FROM logs WHERE code=?').get(code).gate_name,'Trasero');
});
test('fallo del dispositivo conserva código en revisión y bloquea reintento automático',async()=>{
 const d=await json(await req('/t/alpha/admin/create-code',{gateId:'g2',label:'Fallo',days:1,singleUse:true}));const c=d.code.code;
 failure=true;assert.equal((await req('/t/alpha/api/open',{code:c},null)).status,502);failure=false;
 assert.equal(sqlite.prepare('SELECT status FROM codes WHERE code=?').get(c).status,'uncertain');
 calls=[];assert.equal((await req('/t/alpha/api/open',{code:c},null)).status,403);assert.equal(calls.length,0);
 await json(await req('/platform/api/codes/resolve',{tenantId:'a',codeRef:await managementRef(c),action:'retry'},platformCookie));
 await json(await req('/t/alpha/api/open',{code:c},null));
});
test('permisos restringen apertura, creación y códigos existentes',async()=>{
 const r=await req('/t/alpha/api/login',{username:'resident',secret:'654321'},null);await json(r);const c=r.headers.get('Set-Cookie').split(';')[0];
 const made=await json(await req('/t/alpha/admin/create-code',{gateId:'g2',label:'Residente',days:1,singleUse:false},c));
 await json(await req('/t/alpha/admin/users/permissions',{userId:'resident',gateIds:['g1']}));
 assert.equal((await req('/t/alpha/admin/open-gate',{gateId:'g2'},c)).status,400);
 assert.equal((await req('/t/alpha/admin/create-code',{gateId:'g2',label:'X',days:1,singleUse:false},c)).status,400);
 assert.equal((await req('/t/alpha/api/open',{code:made.code.code},null)).status,403);
 assert.equal((await req('/t/alpha/admin/users',undefined,c)).status,403);
 assert.equal((await req('/t/alpha/admin/users/permissions',{userId:'resident',gateIds:['gb']})).status,400);
});
test('desactivar portón revoca códigos; reactivar no los restaura',async()=>{
 const d=await json(await req('/t/alpha/admin/create-code',{gateId:'g2',label:'Desactivar',days:1,singleUse:false}));
 await json(await req('/platform/api/gates',{tenantId:'a',gateId:'g2',name:'Trasero',triggerUrl:'https://device.test/two',status:'inactive'},platformCookie));
 assert.equal((await req('/t/alpha/api/open',{code:d.code.code},null)).status,403);
 await json(await req('/platform/api/gates',{tenantId:'a',gateId:'g2',name:'Trasero nuevo',triggerUrl:'https://device.test/two',status:'active'},platformCookie));
 assert.equal(sqlite.prepare('SELECT status FROM codes WHERE code=?').get(d.code.code).status,'revoked');
 const ts=await json(await req('/platform/api/tenants',undefined,platformCookie));assert.equal(ts.tenants.find(t=>t.id==='a').gates.length,2);
 assert.equal((await req('/platform/api/gates',{tenantId:'b',gateId:'g2',name:'Incorrecto',triggerUrl:'https://device.test/two'},platformCookie)).status,400);
});
test('cambiar contraseña invalida sesión y borrar usuario invalida sesión y códigos',async()=>{
 await json(await req('/t/alpha/admin/create-user',{username:'new',email:'new@example.com',secret:'password-new',gateIds:['g1']}));
 const u=sqlite.prepare("SELECT id FROM users WHERE username='new'").get();
 let r=await req('/t/alpha/api/login',{username:'new',email:'new@example.com',secret:'password-new'},null);await json(r);let c=r.headers.get('Set-Cookie').split(';')[0];
 await json(await req('/t/alpha/admin/users/reset',{userId:u.id,secret:'password-next'}));
 assert.equal((await req('/t/alpha/admin/gates',undefined,c)).status,401);
 r=await req('/t/alpha/api/login',{username:'new',secret:'password-next'},null);await json(r);c=r.headers.get('Set-Cookie').split(';')[0];
 const d=await json(await req('/t/alpha/admin/create-code',{gateId:'g1',label:'Borrar',days:1,singleUse:false},c));
 await json(await req('/t/alpha/admin/delete-user',{userId:u.id}));
 assert.equal((await req('/t/alpha/admin/gates',undefined,c)).status,401);
 assert.equal((await req('/t/alpha/api/open',{code:d.code.code},null)).status,403);
});
test('métricas cuentan todas las órdenes en 24h, no solo las visibles',async()=>{
 const gate=await data.getGate(env,'a','g1');for(let i=0;i<230;i++)await data.logOpen(env,'a',gate,'DIRECTO','Prueba','admin','sent');
 const d=await json(await req('/t/alpha/admin/logs'));assert.equal(d.logs.length,200);assert.ok(d.opensLast24>=230);
 const r=await json(await req('/platform/api/reports',undefined,platformCookie));assert.equal(r.report.find(t=>t.id==='a').last24,d.opensLast24);
});
test('contenido hostil se escapa y el JavaScript de todas las pantallas compila',()=>{
 const evil={...tenant,name:'</script><script>globalThis.pwned=true</script>'};
 for(const html of [getPublicHTML(evil),getAdminHTML(evil,{username:'admin',role:'master'}),getPlatformAdminHTML({username:'<img onerror=alert(1)>'})]){
  assert.ok(!html.includes('<script>globalThis.pwned'));
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 }
});
test('límite atómico de intentos de superadministrador',async()=>{
 sqlite.exec('DELETE FROM login_attempts');
 for(let i=0;i<10;i++)assert.equal((await req('/platform/login',{username:'platform',secret:'wrong'},null)).status,403);
 assert.equal((await req('/platform/login',{username:'platform',secret:'wrong'},null)).status,429);
});

test('portones nuevos no conceden permisos implícitos a residentes',async()=>{
 const d=await json(await req('/platform/api/gates',{tenantId:'a',name:'Servicio',triggerUrl:'https://device.test/service'},platformCookie));
 const user=sqlite.prepare("SELECT * FROM users WHERE id='resident'").get();
 assert.ok(!(await data.allowedGates(env,user)).some(g=>g.id===d.gateId));
 assert.equal((await req('/platform/api/gates',{tenantId:'a',name:'Inseguro',triggerUrl:'http://device.test'},platformCookie)).status,400);
});
test('solicitudes pendientes no se liberan antes de dos minutos y se recuperan para revisión',async()=>{
 const d=await json(await req('/t/alpha/admin/create-code',{gateId:'g1',label:'Interrupción',days:1,singleUse:true}));
 const row=await data.claimCode(env,'a',d.code.code);assert.ok(row);
 assert.equal((await req('/platform/api/codes/resolve',{tenantId:'a',codeRef:await managementRef(row.code),action:'retry'},platformCookie)).status,400);
 sqlite.prepare('UPDATE codes SET claimed_at=? WHERE code=?').run(Date.now()-130000,row.code);
 await data.cleanup(env);
 assert.equal(sqlite.prepare('SELECT status FROM codes WHERE code=?').get(row.code).status,'uncertain');
 await json(await req('/platform/api/codes/resolve',{tenantId:'a',codeRef:await managementRef(row.code),action:'used'},platformCookie));
});
test('códigos vencidos, edificios suspendidos y sesiones cerradas bloquean aperturas',async()=>{
 const d=await json(await req('/t/alpha/admin/create-code',{gateId:'g1',label:'Vencer',days:1,singleUse:false}));
 sqlite.prepare('UPDATE codes SET expires_at=? WHERE code=?').run(Date.now()-1,d.code.code);
 assert.equal((await req('/t/alpha/api/open',{code:d.code.code},null)).status,403);
 await json(await req('/platform/api/tenants/status',{tenantId:'a',status:'suspended'},platformCookie));
 assert.equal((await req('/t/alpha/admin/open-gate',{gateId:'g1'})).status,403);
 await json(await req('/platform/api/tenants/status',{tenantId:'a',status:'active'},platformCookie));
 await json(await req('/t/alpha/admin/logout',{}));
 assert.equal((await req('/t/alpha/admin/gates')).status,401);
});
test('usuario recreado no hereda historial del anterior con igual nombre',async()=>{
 const resident=sqlite.prepare("SELECT * FROM users WHERE id='resident'").get();
 await data.logOpen(env,'a',await data.getGate(env,'a','g1'),'DIRECTO','Privado','resident','sent');
 await data.deleteUser(env,'a',resident.id);
 const newId=await data.createUser(env,'a',{username:'resident',secret:'a-new-password',gateIds:['g1']});
 const replacement=sqlite.prepare('SELECT * FROM users WHERE id=?').get(newId);
 assert.equal((await data.listLogs(env,'a',replacement)).logs.length,0);
});
