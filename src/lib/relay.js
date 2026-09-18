import {MQTTClient} from './mqtt.js';
import {InputError} from './security.js';
import {recordObservation,connectionState} from './relay-inventory.js';
import {loadRelayCredentials,brokerEndpoint} from './relay-settings.js';
export class RelayError extends Error {constructor(message,uncertain=false){super(message);this.uncertain=uncertain;}}
export function deviceConfig(value){if(typeof value!=='string'||! /^[a-z0-9][a-z0-9-]{0,62}$/.test(value))throw new InputError('Identificador de dispositivo inválido: usa letras minúsculas, números y guiones');return JSON.stringify({deviceId:value});}
function device(gate){let cfg;try{cfg=JSON.parse(gate.trigger_config);deviceConfig(cfg.deviceId);}catch{throw new RelayError('Revisa el identificador del dispositivo');}return cfg.deviceId;}
async function credentials(env){
  let saved;try{saved=await loadRelayCredentials(env);}catch{throw new RelayError('Vuelve a guardar las credenciales en Configuración');}
  if(!saved)throw new RelayError('Configura primero las cuentas en Configuración');
  return saved;
}
function account(saved,write=false){return [saved[write?'commandUsername':'statusUsername'],saved[write?'commandPassword':'statusPassword'],{endpoint:brokerEndpoint(saved)}];}
function parse(text){try{return JSON.parse(text);}catch{return null;}}
function validInfo(i){return i?.protocol===2&&/^[a-f0-9]{32}$/.test(i.boot_id)&&Number.isInteger(i.pulse_ms)&&i.pulse_ms>=100&&i.pulse_ms<=2000&&Number.isInteger(i.cooldown_ms)&&i.cooldown_ms>=0&&i.cooldown_ms<=60000;}
async function snapshot(reader,id,allowOffline=false){
  const root='gate/'+id+'/',deadline=Date.now()+6000,result={};
  while(!result.state||!result.info||!result.health){
    const e=await reader.wait(e=>e.type===3&&[root+'state',root+'info',root+'health'].includes(e.topic),Math.max(1,deadline-Date.now()));
    const key=e.topic.slice(root.length);result[key]=key==='state'?e.payload:parse(e.payload);
    if(allowOffline&&result.state==='offline')return {...result,observedAt:Date.now(),fresh:false};
    if(Date.now()>=deadline)throw new RelayError('No llegaron los datos completos del dispositivo');
  }
  result.observedAt=Date.now();
  result.fresh=validInfo(result.info)&&result.health.boot_id===result.info.boot_id&&Number.isInteger(result.health.sampled_at)&&result.health.sampled_at*1000<=Date.now()+5000&&result.health.sampled_at*1000>=Date.now()-360000;
  return result;
}
export async function relayStatus(env,gate,connect=MQTTClient.connect){
  const id=device(gate);let reader,writer,saved,data;const checkedAt=Date.now();
  try{
    saved=await credentials(env);reader=await connect(...account(saved));await reader.subscribe(['gate/'+id+'/state','gate/'+id+'/info','gate/'+id+'/health']);data=await snapshot(reader,id,true);
    await recordObservation(env,id,{...data,observedAt:checkedAt},saved.savedAt);
    // Authenticate the sending account without publishing anything to the device.
    writer=await connect(...account(saved,true));
    const lock=await env.DB.prepare("SELECT status FROM relay_commands WHERE device_id=? AND (status IN ('pending','uncertain') OR (status='cooldown' AND release_at>?))").bind(id,Date.now()).first();
    return {...data,connectionState:connectionState(data),deviceId:id,commandAuthenticated:true,lock:lock?.status||null,ready:!lock&&data.fresh&&data.state==='online'&&data.info.clock_ready===true};
  }
  catch(e){if(saved&&!data)await recordObservation(env,id,{state:'unknown',observedAt:checkedAt},saved.savedAt);throw new RelayError(e instanceof RelayError?e.message:'No se pudo comprobar la conexión MQTT. Revisa el servidor, las cuentas y sus permisos.');}finally{reader?.close();writer?.close();}
}
export async function relayOpen(env,gate,sourceId,connect=MQTTClient.connect){
  const id=device(gate),saved=await credentials(env),readCreds=account(saved),writeCreds=account(saved,true),commandId=crypto.randomUUID();
  let reader,writer,published=false,reserved=false,safeReject=false;
  try{
    // A durable device lock is shared by visitor codes and resident actions.
    const acquired=await env.DB.batch([
      env.DB.prepare("UPDATE relay_commands SET status='completed' WHERE device_id=? AND status='cooldown' AND release_at<=?").bind(id,Date.now()),
      env.DB.prepare("INSERT INTO relay_commands(id,device_id,tenant_id,gate_id,source_id,status,created_at) SELECT ?,?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM gates g JOIN tenants t ON t.id=g.tenant_id WHERE g.id=? AND g.tenant_id=? AND g.status='active' AND t.status='active' AND g.trigger_type='mqtt' AND g.trigger_config=?) ON CONFLICT DO NOTHING").bind(commandId,id,gate.tenant_id,gate.id,sourceId,Date.now(),gate.id,gate.tenant_id,gate.trigger_config)
    ]);
    if(!acquired[1].meta.changes)throw new RelayError('Hay una orden en curso, un tiempo de espera o una revisión pendiente para este relé');
    reserved=true;
    reader=await connect(...readCreds);
    await reader.subscribe(['gate/'+id+'/state','gate/'+id+'/info','gate/'+id+'/health','gate/'+id+'/ack']);
    const data=await snapshot(reader,id,true);
    await recordObservation(env,id,data,saved.savedAt);
    if(data.state==='offline')throw new RelayError('El dispositivo está desconectado');
    if(!data.fresh)throw new RelayError('El dispositivo no tiene información reciente o usa otro firmware');
    if(data.state!=='online'||data.info.clock_ready!==true)throw new RelayError('El dispositivo está desconectado, iniciando o atendiendo otra orden');
    writer=await connect(...writeCreds);
    const issued=Math.floor(Date.now()/1000),command={id:commandId,action:'OPEN',boot_id:data.info.boot_id,issued_at:issued,expires_at:issued+10};
    await env.DB.prepare('UPDATE relay_commands SET boot_id=?,expires_at=? WHERE id=?').bind(command.boot_id,command.expires_at,commandId).run();
    // Set before send: a transport exception cannot prove that nothing was transmitted.
    published=true;writer.publish('gate/'+id+'/cmd',JSON.stringify(command));
    const deadline=Date.now()+14000;
    while(true){
      const e=await reader.wait(e=>e.type===3&&e.topic==='gate/'+id+'/ack'&&!e.retained,Math.max(1,deadline-Date.now()));
      const ack=parse(e.payload);
      if(ack?.protocol===2&&ack.id===commandId&&ack.boot_id===command.boot_id){
        if(ack.status==='rejected'){safeReject=true;throw new RelayError('El relé rechazó la orden; puede estar ocupado o tener el reloj desajustado');}
        if(ack.status==='completed'||(ack.status==='duplicate'&&ack.reason==='completed')){
          await env.DB.prepare("UPDATE relay_commands SET status='cooldown',release_at=? WHERE id=?").bind(Date.now()+data.info.cooldown_ms+1000,commandId).run();
          return {commandId,confirmed:true};
        }
      }
      if(Date.now()>=deadline)throw Error('No llegó la confirmación del relé');
    }
  }catch(e){
    const uncertain=published&&!safeReject;
    if(reserved){try{await env.DB.prepare('UPDATE relay_commands SET status=? WHERE id=? AND status=\'pending\'').bind(uncertain?'uncertain':'not_sent',commandId).run();}catch{throw new RelayError('No se pudo guardar el resultado; solicita revisión del relé',true);}}
    if(e instanceof RelayError)throw new RelayError(e.message,uncertain);
    throw new RelayError(uncertain?'El relé no confirmó que terminara el pulso':'No se pudo conectar con el relé. Revisa las credenciales y la conexión',uncertain);
  }finally{reader?.close();writer?.close();}
}
export async function pendingRelays(env,tenantId){return (await env.DB.prepare("SELECT r.*,g.name AS gate_name FROM relay_commands r JOIN gates g ON g.id=r.gate_id WHERE r.tenant_id=? AND r.status IN ('pending','uncertain') ORDER BY r.created_at").bind(tenantId).all()).results;}
export async function resolveRelay(env,tenantId,id,actor){
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE relay_commands SET status='closed' WHERE tenant_id=? AND id=? AND status IN ('pending','uncertain') AND created_at<?").bind(tenantId,id,Date.now()-120000),
    env.DB.prepare("INSERT INTO platform_audit_log(id,admin_username,action,details,at) SELECT ?,?,'resolve_relay',?,? WHERE changes()>0").bind(crypto.randomUUID(),actor.username,JSON.stringify({tenantId,commandId:id}),Date.now())
  ]);if(!result[0].meta.changes)throw new InputError('La orden sigue en curso o ya fue revisada. Espera dos minutos desde el envío.');
}
