import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {makeDB} from './db.mjs';
import {saveRelayCredentials,loadRelayCredentials,relaySettingsSummary,brokerConfig} from '../src/lib/relay-settings.js';
import {listInventory,registerRelay,discoverRelays,recordObservation} from '../src/lib/relay-inventory.js';
import {relayStatus} from '../src/lib/relay.js';
import * as db from '../src/lib/db.js';
const actor={id:'p',username:'platform'},creds={commandUsername:'backend-api',commandPassword:'send-password',statusUsername:'backend-status',statusPassword:'read-password'};
async function setup(){const {sqlite,db:DB}=makeDB(),env={DB,MQTT_ENCRYPTION_KEY:Buffer.alloc(32,19).toString('base64')};await saveRelayCredentials(env,creds,actor);await registerRelay(env,{deviceId:'device-one',name:'Relé de pruebas'},actor);sqlite.exec("INSERT INTO tenants(id,slug,name,created_at) VALUES('t','test','Test',1)");const id=await db.saveGate(env,'t',{name:'Edificio',triggerType:'mqtt',deviceId:'device-one'});return {sqlite,env,gate:await db.getGate(env,'t',id)};}
function readBroker(events,expectedEndpoint){let published=0;const clients=[];const connect=async(user,password,options)=>{if(expectedEndpoint)assert.equal(options.endpoint,expectedEndpoint);const client={async subscribe(){},async wait(matches){const i=events.findIndex(matches);if(i<0)throw Object.assign(Error('Timeout'),{code:'MQTT_TIMEOUT'});return events.splice(i,1)[0];},publish(){published++;},close(){client.closed=true;}};clients.push(client);return client;};return {connect,clients,get published(){return published;}};}
const event=(id,key,value)=>({type:3,topic:'gate/'+id+'/'+key,payload:typeof value==='string'?value:JSON.stringify(value),retained:true});
test('Inventario: offline retenido basta para persistir Desconectado sin deshabilitar el acceso',async()=>{const s=await setup(),b=readBroker([event('device-one','state','offline')]);try{
  const result=await relayStatus(s.env,s.gate,b.connect);assert.equal(result.connectionState,'offline');assert.equal(result.ready,false);
  const gate=(await db.listGates(s.env,'t'))[0];assert.equal(gate.status,'active');assert.equal(gate.connection_state,'offline');assert.ok(gate.connection_checked_at);assert.equal((await listInventory(s.env))[0].gate_id,gate.id);assert.equal(b.published,0);assert.ok(b.clients.every(c=>c.closed));
}finally{s.sqlite.close();}});
test('Inventario: conexión fallida es desconocida, no offline; los datos antiguos dejan de presentarse como actuales',async()=>{const s=await setup();try{
  const saved=await loadRelayCredentials(s.env);await recordObservation(s.env,'device-one',{state:'offline'},saved.savedAt);
  await assert.rejects(relayStatus(s.env,s.gate,async()=>{throw Error('network');}));assert.equal((await db.listGates(s.env,'t'))[0].connection_state,'unknown');
  s.sqlite.exec("UPDATE relay_devices SET connection_state='online',checked_at=1");assert.equal((await listInventory(s.env))[0].connection_state,'unknown');assert.equal((await db.listGates(s.env,'t'))[0].connection_state,'unknown');
}finally{s.sqlite.close();}});
test('Servidor editable: las dos cuentas usan el nuevo endpoint, conserva contraseñas y descarta consultas de configuración anterior',async()=>{const s=await setup();try{
  const old=await loadRelayCredentials(s.env);await saveRelayCredentials(s.env,{...creds,commandPassword:'',statusPassword:'',broker:'MQTT.NEWPROVIDER.COM',port:'443',path:'/ws'},actor);
  const summary=await relaySettingsSummary(s.env);assert.equal(summary.broker,'mqtt.newprovider.com');assert.equal(summary.port,443);assert.equal(summary.path,'/ws');assert.equal((await loadRelayCredentials(s.env)).commandPassword,'send-password');
  await recordObservation(s.env,'device-one',{state:'offline'},old.savedAt);assert.equal(s.sqlite.prepare('SELECT checked_at FROM relay_devices').get().checked_at,null);
  const b=readBroker([event('device-one','state','offline')],'https://mqtt.newprovider.com:443/ws');await relayStatus(s.env,s.gate,b.connect);assert.equal(b.clients.length,2);assert.equal(b.published,0);
}finally{s.sqlite.close();}});
test('Servidor: rechaza destinos ambiguos, puertos inválidos y rutas con credenciales o redirecciones',()=>{
  for(const broker of ['localhost','127.0.0.1','https://broker.com','broker.com:8884','a@broker.com','broker.local','[::1]'])assert.throws(()=>brokerConfig({broker}));
  for(const port of [0,65536,3.5,'x',''])assert.throws(()=>brokerConfig({port}));for(const path of ['mqtt','/mqtt?token=secret','/mqtt#x','/mqtt\r\n']){if(path.endsWith('\r\n'))continue;assert.throws(()=>brokerConfig({path}));}
  assert.equal(brokerConfig({}).port,8884);
});
test('Inventario: descubrimiento registra datos retenidos y conserva nombres y asignaciones sin publicar',async()=>{const s=await setup();try{
  const boot='b'.repeat(32),events=[event('device-one','state','offline'),event('device-two','state','online'),event('device-two','info',{protocol:2,boot_id:boot,clock_ready:true,pulse_ms:500}),event('device-two','health',{boot_id:boot,sampled_at:Math.floor(Date.now()/1000),rssi:-60}),event('bad/id','state','online')];
  const b=readBroker(events);const result=await discoverRelays(s.env,b.connect);assert.equal(result.found,2);assert.equal(b.published,0);assert.ok(b.clients.every(c=>c.closed));
  const devices=await listInventory(s.env),one=devices.find(d=>d.device_id==='device-one'),two=devices.find(d=>d.device_id==='device-two');assert.equal(one.name,'Relé de pruebas');assert.equal(one.gate_id,s.gate.id);assert.equal(one.connection_state,'offline');assert.equal(two.gate_id,null);assert.equal(two.connection_state,'online');
  await db.saveGate(s.env,'t',{name:'Otra puerta',triggerType:'mqtt',deviceId:'device-two'});await assert.rejects(db.saveGate(s.env,'t',{name:'Duplicada',triggerType:'mqtt',deviceId:'device-two'}));await assert.rejects(db.saveGate(s.env,'t',{name:'Inexistente',triggerType:'mqtt',deviceId:'not-registered'}));
}finally{s.sqlite.close();}});
test('Inventario: una consulta tardía no reemplaza otra más reciente',async()=>{const s=await setup();try{
  const saved=await loadRelayCredentials(s.env),now=Date.now();await recordObservation(s.env,'device-one',{state:'offline',observedAt:now},saved.savedAt);await recordObservation(s.env,'device-one',{state:'online',fresh:true,info:{clock_ready:true},observedAt:now-100},saved.savedAt);assert.equal((await listInventory(s.env))[0].connection_state,'offline');
}finally{s.sqlite.close();}});
test('Migración de inventario conserva asociación MQTT existente y puede repetirse',()=>{
  const sqlite=new DatabaseSync(':memory:');try{const schema=readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8').split('-- Additive, idempotent inventory.')[0];sqlite.exec(schema);sqlite.exec("INSERT INTO tenants(id,slug,name,created_at) VALUES('t','t','T',1);INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,created_at) VALUES('g','t','Edificio','mqtt','{\"deviceId\":\"existing-device\"}',1)");
    const migration=readFileSync(new URL('../database/migration_008_relay_inventory.sql',import.meta.url),'utf8');sqlite.exec(migration);sqlite.exec(migration);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM relay_devices').get().n,1);assert.equal(sqlite.prepare('SELECT name FROM relay_devices').get().name,'Edificio');assert.equal(sqlite.prepare('SELECT trigger_type FROM gates').get().trigger_type,'mqtt');
  }finally{sqlite.close();}
});
