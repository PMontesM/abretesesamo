import {InputError,required} from './security.js';
import {MQTTClient} from './mqtt.js';
import {loadRelayCredentials,brokerEndpoint} from './relay-settings.js';
export function relayId(value){if(typeof value!=='string'||! /^[a-z0-9][a-z0-9-]{0,62}$/.test(value))throw new InputError('Identificador de relé inválido: usa minúsculas, números y guiones');return value;}
export function requiresAvailability(data){return data.info?.availability_topic===true||["2026-09-19-info-1","2026-09-19-availability-2"].includes(data.health?.firmware_revision);}
export function connectionState(data){
  if(data.availability==='offline')return 'offline';
  if((requiresAvailability(data)||data.availability!==undefined)&&data.availability!=='online')return 'unknown';
  if(data.state==='offline')return 'offline';
  if(!data.fresh)return 'unknown';
  if(data.state==='online'&&data.info?.clock_ready!==true)return 'initializing';
  return ['online','initializing','opening','cooldown'].includes(data.state)?data.state:'unknown';
}
export async function listInventory(env){
  const rows=(await env.DB.prepare("SELECT r.*,g.id AS gate_id,g.name AS gate_name,g.tenant_id,t.name AS tenant_name FROM relay_devices r LEFT JOIN gates g ON g.trigger_type='mqtt' AND json_extract(g.trigger_config,'$.deviceId')=r.device_id LEFT JOIN tenants t ON t.id=g.tenant_id ORDER BY r.name,r.device_id LIMIT 500").all()).results;
  return rows.map(row=>({...row,last_connection_state:row.connection_state,connection_state:row.checked_at&&row.checked_at>Date.now()-120000?row.connection_state:'unknown'}));
}
export async function registerRelay(env,body,actor){
  const id=relayId(body.deviceId),name=required(body.name||id,'Nombre del relé',100);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO relay_devices(device_id,name,created_at) VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET name=excluded.name').bind(id,name,Date.now()),
    env.DB.prepare("INSERT INTO platform_audit_log(id,admin_username,action,details,at) VALUES(?,?,'relay_registered',?,?)").bind(crypto.randomUUID(),actor.username,JSON.stringify({deviceId:id,name}),Date.now())
  ]);return id;
}
export async function requireInventory(env,id){relayId(id);if(!await env.DB.prepare('SELECT device_id FROM relay_devices WHERE device_id=?').bind(id).first())throw new InputError('Registra o busca el relé en Configuración antes de asignarlo');}
export function observationStatement(env,id,data,savedAt,discover=false){
  const state=connectionState(data),sample=Number.isSafeInteger(data.health?.sampled_at)?data.health.sampled_at:null,rssi=Number.isInteger(data.health?.rssi)?data.health.rssi:null,pulse=Number.isInteger(data.info?.pulse_ms)?data.info.pulse_ms:null,at=data.observedAt||Date.now();
  if(discover)return env.DB.prepare("INSERT INTO relay_devices(device_id,name,connection_state,checked_at,sampled_at,rssi,pulse_ms,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM relay_settings WHERE id='credentials' AND updated_at=?) ON CONFLICT(device_id) DO UPDATE SET connection_state=excluded.connection_state,checked_at=excluded.checked_at,sampled_at=excluded.sampled_at,rssi=excluded.rssi,pulse_ms=excluded.pulse_ms WHERE relay_devices.checked_at IS NULL OR relay_devices.checked_at<=excluded.checked_at").bind(id,id,state,at,sample,rssi,pulse,Date.now(),savedAt);
  return env.DB.prepare("UPDATE relay_devices SET connection_state=?,checked_at=?,sampled_at=?,rssi=?,pulse_ms=? WHERE device_id=? AND (checked_at IS NULL OR checked_at<=?) AND EXISTS(SELECT 1 FROM relay_settings WHERE id='credentials' AND updated_at=?)").bind(state,at,sample,rssi,pulse,id,at,savedAt);
}
export async function recordObservation(env,id,data,savedAt){if(savedAt)await observationStatement(env,id,data,savedAt).run();}
export async function discoverRelays(env,connect=MQTTClient.connect){
  const checkedAt=Date.now();
  const config=await loadRelayCredentials(env);if(!config)throw new InputError('Guarda primero la conexión MQTT en Configuración');
  let reader;const devices=new Map();let truncated=false;
  try{
    reader=await connect(config.statusUsername,config.statusPassword,{endpoint:brokerEndpoint(config)});
    await reader.subscribe(['gate/+/availability','gate/+/state','gate/+/info','gate/+/health']);
    const deadline=Date.now()+2500;
    for(let count=0;count<900;count++){
      let e;try{e=await reader.wait(e=>e.type===3,Math.max(1,deadline-Date.now()));}catch(error){if(error.code==='MQTT_TIMEOUT')break;throw error;}
      const match=/^gate\/([a-z0-9][a-z0-9-]{0,62})\/(availability|state|info|health)$/.exec(e.topic);
      if(match){const [,id,key]=match;if(!devices.has(id)&&devices.size>=200){truncated=true;break;}const item=devices.get(id)||{};
        try{item[key]=['state','availability'].includes(key)?e.payload:JSON.parse(e.payload);}catch{}devices.set(id,item);
      }
      if(Date.now()>=deadline)break;if(count===899)truncated=true;
    }
    const found=[];
    for(const [id,data] of devices){
      if(!data.state&&!data.availability&&data.info?.protocol!==2)continue;
      data.observedAt=checkedAt;data.fresh=data.info?.protocol===2&&/^[a-f0-9]{32}$/.test(data.info?.boot_id)&&data.health?.boot_id===data.info.boot_id&&Number.isInteger(data.health?.sampled_at)&&data.health.sampled_at*1000>Date.now()-360000&&data.health.sampled_at*1000<=Date.now()+5000;
      found.push(observationStatement(env,id,data,config.savedAt,true));
    }
    for(let i=0;i<found.length;i+=40)await env.DB.batch(found.slice(i,i+40));
    return {found:found.length,truncated};
  }catch(error){if(error instanceof InputError)throw error;throw new InputError('No se pudo buscar relés. Revisa el servidor y que la cuenta de consulta pueda leer gate/+/#');}
  finally{reader?.close();}
}
