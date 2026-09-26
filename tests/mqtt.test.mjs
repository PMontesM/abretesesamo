import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDB} from './db.mjs';
import {relayOpen,relayStatus,resolveRelay} from '../src/lib/relay.js';
import {saveRelayCredentials,loadRelayCredentials,relaySettingsSummary} from '../src/lib/relay-settings.js';
import {MQTTClient,packet} from '../src/lib/mqtt.js';
import * as db from '../src/lib/db.js';
import worker from '../src/index.js';
import {createSessionCookie} from '../src/lib/auth.js';
import {hashSecret} from '../src/lib/security.js';
const boot='a'.repeat(32),actor={id:'p',username:'platform'};
async function setup(){
  const {sqlite,db:DB}=makeDB(),env={DB,MQTT_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),ADMIN_SIGNING_SECRET:'test-secret-only-for-session-with-32-characters'};
  sqlite.exec("INSERT INTO tenants(id,slug,name,created_at) VALUES('t','test','Test',1); INSERT INTO relay_devices(device_id,name,created_at) VALUES('test-relay','Test relay',1); INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,created_at) VALUES('g','t','Gate','mqtt','{\"deviceId\":\"test-relay\"}',1);");
  await saveRelayCredentials(env,{commandUsername:'backend-api',commandPassword:'secret-write',statusUsername:'backend-status',statusPassword:'secret-read'},actor);
  return {sqlite,env,gate:await db.getGate(env,'t','g')};
}
function broker({acks=['completed'],state='online',fresh=true,bootId=boot,failPublish=false,hold=false,availability,revision,protocol=3,ackProtocol=protocol}={}){
  const events=[{topic:'gate/test-relay/state',payload:state},{topic:'gate/test-relay/info',payload:JSON.stringify({protocol,boot_id:boot,pulse_ms:500,cooldown_ms:6000,clock_ready:true})},{topic:'gate/test-relay/health',payload:JSON.stringify({boot_id:boot,sampled_at:Math.floor(Date.now()/1000)-(fresh?0:600),rssi:-71,firmware_revision:revision})}].map(e=>({...e,type:3,retained:true}));
  if(availability!==undefined)events.push({type:3,topic:'gate/test-relay/availability',payload:availability,retained:true});
  let subscribed=false,pending,release;const sent=[],clients=[];
  const connect=async(user,password)=>{assert.match(password,/^secret-/);const client={
    async subscribe(topics){assert.equal(user,'backend-status');assert.ok(topics.includes('gate/test-relay/info'));subscribed=true;if(hold)await new Promise(r=>release=r);},
    async wait(matches){let i=events.findIndex(matches);if(i>=0)return events.splice(i,1)[0];throw Object.assign(Error('simulated ack timeout'),{code:'MQTT_TIMEOUT'});},
    publish(topic,payload){assert.ok(subscribed);assert.equal(user,'backend-api');const c=JSON.parse(payload);sent.push(c);assert.equal(topic,'gate/test-relay/cmd');assert.match(c.id,/^[a-f0-9-]{36}$/);assert.equal(c.expires_at-c.issued_at,10);assert.equal(c.boot_id,boot);if(failPublish)throw Error('socket error');for(const status of acks){events.push({type:3,topic:'gate/test-relay/ack',retained:false,payload:JSON.stringify({id:c.id,boot_id:bootId,protocol:ackProtocol,status,...(status==='duplicate'?{reason:'completed'}:{})})});}},
    close(){client.closed=true;}
  };clients.push(client);return client;};
  return {connect,sent,clients,release:()=>release?.()};
}
test('MQTT: credenciales cifradas y resumen sin contraseñas; preservar vacías y rechazar sustitución de usuario sin contraseña',async()=>{
  const s=await setup();try{
    const stored=JSON.stringify(s.sqlite.prepare('SELECT * FROM relay_settings').all());assert.ok(!stored.includes('secret-write'));assert.ok(!stored.includes('secret-read'));
    const summary=await relaySettingsSummary(s.env);assert.deepEqual(Object.keys(summary).sort(),['broker','commandUsername','configured','path','port','statusUsername']);
    await saveRelayCredentials(s.env,{commandUsername:'backend-api',commandPassword:'',statusUsername:'backend-status',statusPassword:''},actor);assert.equal((await loadRelayCredentials(s.env)).commandPassword,'secret-write');
    await assert.rejects(saveRelayCredentials(s.env,{commandUsername:'other',statusUsername:'backend-status'},actor));
    await assert.rejects(loadRelayCredentials({...s.env,MQTT_ENCRYPTION_KEY:Buffer.alloc(32,18).toString('base64')}));
    assert.ok(!JSON.stringify(s.sqlite.prepare('SELECT * FROM platform_audit_log').all()).includes('secret-write'));
  }finally{s.sqlite.close();}
});
test('MQTT: consulta retenida no publica ni reserva órdenes',async()=>{const s=await setup(),b=broker();try{const r=await relayStatus(s.env,s.gate,b.connect);assert.equal(r.ready,true);assert.equal(r.health.rssi,-71);assert.equal(b.sent.length,0);assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM relay_commands').get().n,0);assert.ok(b.clients.every(c=>c.closed));}finally{s.sqlite.close();}});
test('MQTT: ajustes solo para plataforma, reautenticación y ninguna contraseña en HTTP',async()=>{const s=await setup();try{
  const secret=await hashSecret('platform-password');s.sqlite.prepare('INSERT INTO platform_admins(id,username,secret,created_at) VALUES(?,?,?,1)').run('p','platform',secret);const admin=s.sqlite.prepare('SELECT * FROM platform_admins').get();
  const cookie=(await createSessionCookie(s.env,admin,true)).split(';')[0];
  const req=(body,auth='')=>worker.fetch(new Request('https://test.invalid/platform/api/relay-settings',{method:body?'POST':'GET',headers:{Cookie:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),s.env,{});
  assert.equal((await req()).status,401);const summary=await (await req(null,cookie)).text();assert.ok(!summary.includes('secret-write'));assert.ok(!summary.includes('secret-read'));
  const before=s.sqlite.prepare('SELECT payload FROM relay_settings').get().payload;
  assert.equal((await req({currentSecret:'wrong'},cookie)).status,400);assert.equal(s.sqlite.prepare('SELECT payload FROM relay_settings').get().payload,before);
  const good=await req({currentSecret:'platform-password',commandUsername:'backend-api',commandPassword:'new-secret',statusUsername:'backend-status'},cookie);assert.equal(good.status,200);assert.ok(!(await good.text()).includes('new-secret'));assert.equal((await loadRelayCredentials(s.env)).commandPassword,'new-secret');
}finally{s.sqlite.close();}});
test('MQTT: confirmación completa, TTL y cooldown compartido; nunca reenvía',async()=>{const s=await setup(),b=broker({acks:['accepted','completed']});try{
  const r=await relayOpen(s.env,s.gate,'source',b.connect);assert.equal(r.confirmed,true);assert.equal(b.sent.length,1);const row=s.sqlite.prepare('SELECT * FROM relay_commands').get();assert.equal(row.boot_id,boot);assert.equal(row.status,'cooldown');assert.equal(row.source_id,'source');
  await assert.rejects(relayOpen(s.env,s.gate,'source2',b.connect),e=>!e.uncertain);assert.equal(b.sent.length,1);assert.ok(b.clients.every(c=>c.closed));
  s.sqlite.exec("UPDATE relay_commands SET release_at=0");const next=broker();await relayOpen(s.env,s.gate,'next',next.connect);assert.equal(next.sent.length,1);assert.notEqual(next.sent[0].id,b.sent[0].id);
}finally{s.sqlite.close();}});
test('MQTT: desconexión y salud vieja no envían; accepted sin completed y boot distinto quedan en revisión',async()=>{
  for(const [opts,uncertain,count] of [[{state:'offline'},false,0],[{fresh:false},false,0],[{acks:['accepted']},true,1],[{bootId:'b'.repeat(32)},true,1],[{failPublish:true},true,1],[{acks:['rejected']},false,1]]){
    const s=await setup(),b=broker(opts);try{await assert.rejects(relayOpen(s.env,s.gate,'source',b.connect),e=>e.uncertain===uncertain);assert.equal(b.sent.length,count);assert.equal(s.sqlite.prepare('SELECT status FROM relay_commands').get().status,uncertain?'uncertain':'not_sent');assert.ok(b.clients.every(c=>c.closed));}finally{s.sqlite.close();}
  }
});
test('MQTT: solicitudes simultáneas comparten bloqueo, revisión requiere espera y queda auditada',async()=>{const s=await setup(),b=broker({hold:true,acks:[]});try{
  const first=relayOpen(s.env,s.gate,'visitor',b.connect);first.catch(()=>{});
  while(!b.clients.length)await new Promise(r=>setTimeout(r,1));
  await assert.rejects(relayOpen(s.env,s.gate,'resident',b.connect),e=>!e.uncertain);b.release();await assert.rejects(first,e=>e.uncertain);assert.equal(b.sent.length,1);
  const id=s.sqlite.prepare('SELECT id FROM relay_commands').get().id;await assert.rejects(resolveRelay(s.env,'t',id,actor));s.sqlite.exec('UPDATE relay_commands SET created_at=1');await resolveRelay(s.env,'t',id,actor);assert.equal(s.sqlite.prepare('SELECT status FROM relay_commands').get().status,'closed');assert.equal(b.sent.length,1);
}finally{s.sqlite.close();}});
test('MQTT: fallos de persistencia previos nunca envían; posteriores conservan revisión',async()=>{
  for(const after of [false,true]){const s=await setup(),b=broker();try{
    s.sqlite.exec(after?"CREATE TRIGGER fail_result BEFORE UPDATE OF status ON relay_commands WHEN NEW.status='cooldown' BEGIN SELECT RAISE(ABORT,'disk'); END;":"CREATE TRIGGER fail_reserve BEFORE INSERT ON relay_commands BEGIN SELECT RAISE(ABORT,'disk'); END;");
    await assert.rejects(relayOpen(s.env,s.gate,'s',b.connect),e=>e.uncertain===after);assert.equal(b.sent.length,after?1:0);
    if(after)assert.equal(s.sqlite.prepare('SELECT status FROM relay_commands').get().status,'uncertain');
  }finally{s.sqlite.close();}}
});
test('MQTT: asignación única, validación del topic y reserva rechazada si cambió la integración',async()=>{const s=await setup();try{
  await assert.rejects(db.saveGate(s.env,'t',{name:'Second',triggerType:'mqtt',deviceId:'test-relay'}));
  for(const deviceId of ['../test','test/#','test+','Test',''])await assert.rejects(db.saveGate(s.env,'t',{name:'Second',triggerType:'mqtt',deviceId}));
  s.sqlite.exec("INSERT INTO relay_devices(device_id,name,created_at) VALUES('changed','Changed',1)");await db.saveGate(s.env,'t',{gateId:'g',name:'Gate',triggerType:'mqtt',deviceId:'changed'});const b=broker();await assert.rejects(relayOpen(s.env,s.gate,'s',b.connect));assert.equal(b.clients.length,0);
}finally{s.sqlite.close();}});
test('MQTT: falta de configuración devuelve código activo sin iniciar visita y libera operación directa',async()=>{const s=await setup();try{
  s.sqlite.exec("DELETE FROM relay_settings; INSERT INTO users(id,tenant_id,username,secret,role,created_at) VALUES('u','t','admin','test','master',1); INSERT INTO codes(code,tenant_id,gate_id,owner_id,created_at,visit_mode) VALUES('123456','t','g','u',1,1);");
  const req=(path,body,cookie='')=>worker.fetch(new Request('https://test.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)}),s.env,{});
  const r=await req('/t/test/api/open',{code:'123456',confirmVisit:true});assert.equal(r.status,409);const c=s.sqlite.prepare('SELECT * FROM codes').get();assert.equal(c.status,'active');assert.equal(c.visit_started_at,null);
  const user=s.sqlite.prepare('SELECT * FROM users').get(),cookie=(await createSessionCookie(s.env,user)).split(';')[0];const direct=await req('/t/test/admin/open-gate',{gateId:'g',requestId:crypto.randomUUID()},cookie);assert.equal(direct.status,409);assert.equal((await direct.json()).operationClosed,true);assert.equal(s.sqlite.prepare('SELECT status FROM direct_operations').get().status,'closed');
}finally{s.sqlite.close();}});

class Socket {
  listeners={};sent=[];closed=false;accept(){}addEventListener(k,f){this.listeners[k]=f;}
  send(data){this.sent.push(data);if(data[0]===0x10)this.deliver(packet(0x20,[0,0]));if(data[0]===0x82)this.deliver(packet(0x90,[0,1,1]));}
  close(){this.closed=true;}
  deliver(data){this.listeners.message({data:Uint8Array.from(data).buffer});}
}
test('MQTT wire: CONNECT clean session, unique IDs, SUBACK, PUBLISH non-retained and fragmentation/QoS1 ACK',async()=>{
  const sockets=[],fetcher=async(url,options)=>{assert.ok(url.startsWith('https://'));assert.equal(options.headers['Sec-WebSocket-Protocol'],'mqtt');const ws=new Socket();sockets.push(ws);return {status:101,webSocket:ws};};
  const a=await MQTTClient.connect('u','p',fetcher),b=await MQTTClient.connect('u','p',fetcher);
  assert.notDeepEqual(sockets[0].sent[0],sockets[1].sent[0]);assert.equal(sockets[0].sent[0][9],0xc2);
  await a.subscribe(['gate/test/state']);a.publish('gate/test/cmd','payload');assert.equal(sockets[0].sent.at(-1)[0],0x32);
  const topic=new TextEncoder().encode('gate/test/state'),payload=new TextEncoder().encode('online'),incoming=packet(0x33,[0,topic.length,...topic,0,8,...payload]);
  sockets[0].deliver(incoming.slice(0,3));sockets[0].deliver(incoming.slice(3));const e=await a.wait(e=>e.type===3);assert.equal(e.payload,'online');assert.equal(e.retained,true);assert.deepEqual(Array.from(sockets[0].sent.at(-1)),[0x40,2,0,8]);
  a.close();b.close();assert.ok(sockets.every(s=>s.closed));
});
test('MQTT wire: timeout, denied subscription and malformed packets fail without reconnect',async()=>{
  const ws=new Socket(),client=new MQTTClient(ws);await assert.rejects(client.wait(e=>false,2));
  ws.send=function(data){this.sent.push(data);if(data[0]===0x82)this.deliver(packet(0x90,[0,1,128]));};await assert.rejects(client.subscribe(['gate/test/state']));
  ws.deliver(packet(0x30,[0,99,1]));await assert.rejects(client.wait(e=>true));client.close();assert.equal(ws.closed,true);
});

for(const availability of ['online','offline',undefined,'invalid'])test('MQTT nueva disponibilidad: '+availability,async()=>{
 const s=await setup(),b=broker({availability,revision:'2026-09-19-info-1'});
 try{
  if(availability===undefined){await assert.rejects(relayStatus(s.env,s.gate,b.connect),/disponibilidad/);}
  else {const r=await relayStatus(s.env,s.gate,b.connect);assert.equal(r.ready,availability==='online');assert.equal(r.connectionState,availability==='offline'?'offline':availability==='online'?'online':'unknown');}
  const opener=broker({availability,revision:'2026-09-19-info-1'});
  if(availability==='online'){await relayOpen(s.env,s.gate,'new-fw',opener.connect);assert.equal(opener.sent.length,1);}
  else {await assert.rejects(relayOpen(s.env,s.gate,'new-fw',opener.connect),e=>!e.uncertain);assert.equal(opener.sent.length,0);}
 }finally{s.sqlite.close();}
});

test('MQTT: solo protocolo 3; rechaza 2 antes de publicar e ignora confirmaciones de otro protocolo',async()=>{
 const s=await setup();const old=broker({protocol:2});await assert.rejects(relayOpen(s.env,s.gate,'old',old.connect));assert.equal(old.sent.length,0);
 const wrong=broker({ackProtocol:2});await assert.rejects(relayOpen(s.env,s.gate,'wrong-ack',wrong.connect),e=>e.uncertain===true);assert.equal(wrong.sent.length,1);
});
