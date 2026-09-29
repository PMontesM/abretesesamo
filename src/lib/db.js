import {requireInventory} from './relay-inventory.js';
import {deviceConfig} from './relay.js';
import { takeAttempt } from './ratelimit.js';
import { InputError, required, username as cleanUsername, hashSecret, triggerConfig, buildingSlug } from './security.js';
const rows=async statement=>(await statement.all()).results||[];
export const tenantBySlug=(env,slug)=>env.DB.prepare('SELECT * FROM tenants WHERE slug=?').bind(slug).first();
export const tenantById=(env,id)=>env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(id).first();
export const getGate=(env,tenantId,id)=>env.DB.prepare('SELECT * FROM gates WHERE tenant_id=? AND id=?').bind(tenantId,id).first();
export const listGates=(env,tenantId)=>rows(env.DB.prepare("SELECT g.*,r.name AS relay_name,r.checked_at AS connection_checked_at,r.connection_state AS last_connection_state,CASE WHEN r.checked_at>? THEN r.connection_state ELSE 'unknown' END AS connection_state FROM gates g LEFT JOIN relay_devices r ON g.trigger_type='mqtt' AND r.device_id=json_extract(g.trigger_config,'$.deviceId') WHERE g.tenant_id=? ORDER BY g.created_at,g.id").bind(Date.now()-120000,tenantId));
export async function allowedGates(env,user) {
  if(user.role==='master')return (await listGates(env,user.tenant_id)).filter(g=>g.status==='active');
  return rows(env.DB.prepare(`SELECT g.*,r.checked_at AS connection_checked_at,CASE WHEN r.checked_at>? THEN r.connection_state ELSE 'unknown' END AS connection_state FROM gates g JOIN user_gates p ON p.gate_id=g.id AND p.tenant_id=g.tenant_id
    LEFT JOIN relay_devices r ON g.trigger_type='mqtt' AND r.device_id=json_extract(g.trigger_config,'$.deviceId')
    WHERE p.user_id=? AND p.tenant_id=? AND g.status='active' ORDER BY g.created_at,g.id`).bind(Date.now()-120000,user.id,user.tenant_id));
}
export async function requireGate(env,user,id) {
  const gate=(await allowedGates(env,user)).find(g=>g.id===id);
  if(!gate)throw new InputError('Portón no disponible o sin permiso');
  return gate;
}
export async function listUsers(env,tenantId) {
  const users=await rows(env.DB.prepare('SELECT id,username,role FROM users WHERE tenant_id=? ORDER BY created_at,id').bind(tenantId));
  const permissions=await rows(env.DB.prepare('SELECT user_id,gate_id FROM user_gates WHERE tenant_id=?').bind(tenantId));
  return users.map(u=>({...u,gateIds:permissions.filter(p=>p.user_id===u.id).map(p=>p.gate_id)}));
}
async function validPermissions(env,tenantId,gateIds) {
  if(!Array.isArray(gateIds)||gateIds.some(id=>typeof id!=='string'))throw new InputError('Selecciona los portones autorizados');
  const unique=[...new Set(gateIds)];
  const gates=await listGates(env,tenantId);
  if(unique.some(id=>!gates.some(g=>g.id===id&&g.status==='active')))throw new InputError('La selección incluye un portón ajeno o inactivo');
  return unique;
}
export async function createUser(env,tenantId,body,actor=null) {
  if(!await tenantById(env,tenantId))throw new InputError('Edificio inexistente');
  const id=crypto.randomUUID(),name=cleanUsername(body.username),hash=await hashSecret(body.secret);
  const gates=await validPermissions(env,tenantId,body.gateIds);
  if(await env.DB.prepare('SELECT id FROM users WHERE tenant_id=? AND username=?').bind(tenantId,name).first())throw new InputError('El usuario ya existe');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,tenant_id,username,secret,role,created_at) VALUES(?,?,?,?,'user',?)").bind(id,tenantId,name,hash,Date.now()),
    ...gates.map(g=>env.DB.prepare('INSERT INTO user_gates(tenant_id,user_id,gate_id) VALUES(?,?,?)').bind(tenantId,id,g)),
    ...auditStatements(env,actor,'create_user',{tenantId,userId:id,gateIds:gates})
  ]);
  return id;
}
export async function setPermissions(env,tenantId,userId,gateIds,actor=null) {
  const user=await env.DB.prepare("SELECT * FROM users WHERE tenant_id=? AND id=? AND role!='master'").bind(tenantId,userId).first();
  if(!user)throw new InputError('Usuario no editable');
  const gates=await validPermissions(env,tenantId,gateIds);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_gates WHERE tenant_id=? AND user_id=?').bind(tenantId,userId),
    ...gates.map(g=>env.DB.prepare('INSERT INTO user_gates(tenant_id,user_id,gate_id) VALUES(?,?,?)').bind(tenantId,userId,g)),
    env.DB.prepare(`UPDATE codes SET status='revoked' WHERE tenant_id=? AND owner_id=? AND status IN ('active','pending','uncertain')
      AND (gate_id NOT IN (SELECT gate_id FROM user_gates WHERE user_id=? AND tenant_id=?) OR EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND NOT EXISTS(SELECT 1 FROM user_gates p WHERE p.user_id=codes.owner_id AND p.gate_id=cg.gate_id)))`).bind(tenantId,userId,userId,tenantId),
    ...auditStatements(env,actor,'set_permissions',{tenantId,userId,gateIds:gates})
  ]);
}
export async function deleteUser(env,tenantId,userId,actor=null) {
  const user=await env.DB.prepare("SELECT id FROM users WHERE tenant_id=? AND id=? AND role!='master'").bind(tenantId,userId).first();
  if(!user)throw new InputError('Usuario no editable');
  await env.DB.batch([
    env.DB.prepare("UPDATE codes SET status='revoked' WHERE tenant_id=? AND owner_id=? AND status IN ('active','pending','uncertain')").bind(tenantId,userId),
    env.DB.prepare('DELETE FROM user_gates WHERE tenant_id=? AND user_id=?').bind(tenantId,userId),
    env.DB.prepare("DELETE FROM users WHERE tenant_id=? AND id=? AND role!='master'").bind(tenantId,userId),
    ...auditStatements(env,actor,'delete_user',{tenantId,userId})
  ]);
}
export async function resetSecret(env,tenantId,userId,secret,actor=null) {
  if(await env.DB.prepare('SELECT 1 FROM account_memberships WHERE user_id=? AND tenant_id=?').bind(userId,tenantId).first())throw new InputError('Esta cuenta usa acceso único. El usuario cambia su contraseña desde Mi cuenta.');
  const hash=await hashSecret(secret);
  if(!await env.DB.prepare('SELECT id FROM users WHERE tenant_id=? AND id=?').bind(tenantId,userId).first())throw new InputError('Usuario inexistente');
  await env.DB.batch([env.DB.prepare('UPDATE users SET secret=?,session_version=session_version+1 WHERE tenant_id=? AND id=?').bind(hash,tenantId,userId),...auditStatements(env,actor,'reset_password',{tenantId,userId})]);
}
export async function createTenant(env,body,actor=null) {
  const custom=body.slug!==undefined&&body.slug!==null&&body.slug!=='';
  const customSlug=custom?required(body.slug,'Enlace personalizado',64):null;
  if(custom&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(customSlug))throw new InputError('El enlace admite minúsculas, números y guiones entre palabras');
  const name=required(body.name,'Nombre'),user=cleanUsername(body.masterUsername),hash=await hashSecret(body.masterSecret);
  const type=body.triggerType||'webhook';if(!['webhook','mqtt','demo'].includes(type))throw new InputError('Integración inválida');
  const config=type==='mqtt'?deviceConfig(body.deviceId):type==='demo'?'{}':triggerConfig(body.triggerUrl,body.method||'GET'),gateName=required(body.gateName,'Nombre del portón');
  if(type==='mqtt')await requireInventory(env,body.deviceId);
  if(type==='mqtt'&&await env.DB.prepare("SELECT id FROM gates WHERE trigger_type='mqtt' AND json_extract(trigger_config,'$.deviceId')=?").bind(body.deviceId).first())throw new InputError('Este dispositivo ya está asignado a otro portón');
  const base=customSlug||buildingSlug(name),id=crypto.randomUUID();
  // The unique index resolves concurrent registrations; the batch rolls back
  // all related records if another request claims the same automatic slug.
  for(let attempt=0;attempt<100;attempt++){
    const suffix=attempt?'-'+(attempt+1):'',slug=customSlug||base.slice(0,64-suffix.length).replace(/-+$/g,'')+suffix;
    if(await tenantBySlug(env,slug)){if(custom)throw new InputError('Ese enlace ya está en uso. Elige otro o usa el enlace automático.');continue;}
    try{
      await env.DB.batch([
        env.DB.prepare("INSERT INTO tenants(id,slug,name,status,created_at) VALUES(?,?,?,'active',?)").bind(id,slug,name,Date.now()),
        env.DB.prepare('INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),id,gateName,type,config,Date.now()),
        env.DB.prepare("INSERT INTO users(id,tenant_id,username,secret,role,created_at) VALUES(?,?,?,?,'master',?)").bind(crypto.randomUUID(),id,user,hash,Date.now()),
        ...auditStatements(env,actor,'create_tenant',{tenantId:id,name,slug})
      ]);
      return id;
    }catch(error){
      const detail=String(error.message)+' '+String(error.cause?.message||'');
      if(!/UNIQUE constraint failed: tenants\.slug/i.test(detail))throw error;
      if(custom)throw new InputError('Ese enlace ya está en uso. Elige otro o usa el enlace automático.');
    }
  }
  throw new InputError('No se pudo generar un enlace libre. Usa Personalizar enlace.');
}
export async function saveGate(env,tenantId,body,actor=null) {
  if(!await tenantById(env,tenantId))throw new InputError('Edificio inexistente');
  const type=body.triggerType||'webhook';if(!['webhook','mqtt','demo'].includes(type))throw new InputError('Integración inválida');
  const name=required(body.name,'Nombre del portón'),config=type==='mqtt'?deviceConfig(body.deviceId):type==='demo'?'{}':triggerConfig(body.triggerUrl,body.method||'GET');
  const status=body.status||'active';if(!['active','inactive'].includes(status))throw new InputError('Estado inválido');
  const id=body.gateId||crypto.randomUUID(),old=body.gateId?await getGate(env,tenantId,id):null;
  if(body.gateId&&!old)throw new InputError('Portón ajeno o inexistente');
  if(type==='mqtt')await requireInventory(env,body.deviceId);
  if(type==='mqtt'&&await env.DB.prepare("SELECT id FROM gates WHERE trigger_type='mqtt' AND json_extract(trigger_config,'$.deviceId')=? AND id!=?").bind(body.deviceId,id).first())throw new InputError('Este dispositivo ya está asignado a otro portón');
  // Never move a device while an unresolved command can still affect it.
  if(old&&(old.trigger_type!==type||old.trigger_config!==config)&&await env.DB.prepare("SELECT id FROM relay_commands WHERE gate_id=? AND (status IN ('pending','uncertain') OR (status='cooldown' AND release_at>?))").bind(id,Date.now()).first())throw new InputError('Resuelve primero la orden pendiente del relé');
  if(old)await env.DB.batch([
    env.DB.prepare("UPDATE codes SET status='revoked' WHERE tenant_id=? AND (gate_id=? OR EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND cg.gate_id=?)) AND status IN ('active','pending','uncertain') AND (?='inactive' OR EXISTS(SELECT 1 FROM gates WHERE id=? AND (trigger_type!=? OR trigger_config!=?)))").bind(tenantId,id,id,status,id,type,config),
    env.DB.prepare('UPDATE gates SET name=?,trigger_type=?,trigger_config=?,status=? WHERE tenant_id=? AND id=?').bind(name,type,config,status,tenantId,id),
    ...auditStatements(env,actor,'save_gate',{tenantId,gateId:id,name,status,triggerType:type})
  ]);
  else await env.DB.batch([env.DB.prepare('INSERT INTO gates(id,tenant_id,name,trigger_type,trigger_config,status,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,tenantId,name,type,config,status,Date.now()),...auditStatements(env,actor,'create_gate',{tenantId,gateId:id,name,triggerType:type})]);
  return id;
}
export async function createCode(env,user,body) {
  const gate=await requireGate(env,user,body.gateId),label=required(body.label,'Nombre o nota',60);
  const days=Number(body.days??0);
  if(!Number.isInteger(days)||days<0||days>3650||typeof body.singleUse!=='boolean')throw new InputError('Vigencia o tipo inválidos');
  if(!await takeAttempt(env,'create-code:'+user.id,30))throw new InputError('Límite de 30 códigos por cinco minutos. Espera antes de crear más.');
  if(body.visit===true&&(body.singleUse||(days<1&&body.expiresAt===undefined)))throw new InputError('Una visita necesita una fecha límite y no puede ser de un solo uso');
  const expires=body.expiresAt===undefined?(days?Date.now()+days*86400000:null):body.expiresAt;
  if(expires!==null&&(!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+3650*86400000))throw new InputError('Elige una fecha futura válida');
  if(body.visit===true&&expires===null)throw new InputError('Elige hasta cuándo puede comenzar la visita');
  for(let i=0;i<20;i++){
    const n=crypto.getRandomValues(new Uint32Array(1))[0];
    if(n>=4294000000)continue;
    const code=String(n%1000000).padStart(6,'0');
    const row=await env.DB.prepare(`INSERT INTO codes(code,tenant_id,gate_id,label,owner,owner_id,single_use,expires_at,created_at,visit_mode)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM codes WHERE tenant_id=?)<20000 AND (SELECT COUNT(*) FROM codes WHERE tenant_id=? AND owner_id=? AND status IN ('active','pending','uncertain') AND (expires_at IS NULL OR expires_at>?))<200 ON CONFLICT DO NOTHING RETURNING *`)
      .bind(code,user.tenant_id,gate.id,label,user.username,user.id,body.singleUse?1:0,expires,Date.now(),body.visit===true?1:0,user.tenant_id,user.tenant_id,user.id,Date.now()).first();
    if(row)return {...row,gate_name:gate.name};
  }
  throw new InputError('No se creó el código: revisa la cuota de 200 accesos vigentes por usuario o 20,000 registros por edificio');
}
export async function listCodes(env,tenantId,user=null,options={}) {
  const owner=user&&user.role!=='master'?user.id:null;
  const page=Number(options.page||0);if(!Number.isSafeInteger(page)||page<0||page>100000)throw new InputError('Página inválida');
  const search=String(options.search||'').trim();if(search.length>64)throw new InputError('Búsqueda inválida');
  const query=String(options.query||'').trim().toLowerCase(),filterOwner=String(options.ownerId||''),filterGate=String(options.gateId||'');
  if(query.length>100||filterOwner.length>100||filterGate.length>100)throw new InputError('Filtro inválido');
  const requestedState=String(options.status||'');const state=requestedState==='current'?'':requestedState;if(state&&!['active','pending','uncertain','revoked','expired','used'].includes(state))throw new InputError('Estado inválido');
  return rows(env.DB.prepare("SELECT c.*,COALESCE((SELECT GROUP_CONCAT(linked.name, ' / ') FROM code_gates cg JOIN gates linked ON linked.id=cg.gate_id AND linked.tenant_id=cg.tenant_id WHERE cg.tenant_id=c.tenant_id AND cg.code=c.code),g.name) AS gate_name,g.status AS gate_status FROM codes c LEFT JOIN gates g ON g.id=c.gate_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=? AND (? IS NULL OR c.owner_id=?) AND (?='' OR (CASE WHEN c.owner_id=? THEN c.code ELSE substr(c.code,1,2)||'••'||substr(c.code,5,2) END)=?) AND (?='' OR CASE WHEN c.status='active' AND c.expires_at IS NOT NULL AND c.expires_at<=? THEN 'expired' ELSE c.status END=?) AND (?=0 OR (c.status IN ('pending','uncertain') OR (c.status='active' AND (c.expires_at IS NULL OR c.expires_at>?)))) AND (?='' OR c.owner_id=?) AND (?='' OR c.gate_id=? OR EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=c.tenant_id AND cg.code=c.code AND cg.gate_id=?)) AND (?='' OR instr(lower((CASE WHEN c.owner_id=? THEN c.code ELSE substr(c.code,1,2)||'••'||substr(c.code,5,2) END)||' '||COALESCE(c.label,'')||' '||COALESCE(c.owner,'')),?)>0) ORDER BY c.created_at DESC,c.code DESC LIMIT 100 OFFSET ?").bind(tenantId,owner,owner,search,user?.id||'',search,state,Date.now(),state,requestedState==='current'?1:0,Date.now(),filterOwner,filterOwner,filterGate,filterGate,filterGate,query,user?.id||'',query,page*100));
}
export async function revokeCode(env,tenantId,code,user=null,actor=null) {
  const owner=user&&user.role!=='master'?user.id:null;
  const r=await env.DB.batch([env.DB.prepare("UPDATE codes SET status='revoked' WHERE tenant_id=? AND code=? AND status IN ('active','pending','uncertain') AND (? IS NULL OR owner_id=?)").bind(tenantId,code,owner,owner),...auditStatements(env,actor,'revoke_code',{tenantId,code},true)]);
  if(!r[0].meta.changes)throw new InputError('Código no disponible para revocar');
}
// Claim and all authorization predicates are one atomic statement. No read/delete race.
export async function claimCode(env,tenantId,code,selected=null) {
 const row=await env.DB.prepare(`UPDATE codes SET status='pending',claim_token=?,claimed_at=?
 WHERE tenant_id=? AND code=? AND status='active' AND (expires_at IS NULL OR expires_at>?)
 AND EXISTS(SELECT 1 FROM tenants t WHERE t.id=codes.tenant_id AND t.status='active')
 AND EXISTS(SELECT 1 FROM gates g WHERE g.id=COALESCE(?,codes.gate_id) AND g.tenant_id=codes.tenant_id AND g.status='active'
 AND ((g.id=codes.gate_id AND NOT EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code)) OR EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND cg.gate_id=g.id AND cg.authorized_config=g.trigger_config)))
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=codes.owner_id AND u.tenant_id=codes.tenant_id AND (u.role='master' OR EXISTS(SELECT 1 FROM user_gates p WHERE p.user_id=u.id AND p.tenant_id=codes.tenant_id AND p.gate_id=COALESCE(?,codes.gate_id))))
 RETURNING *, COALESCE(?,gate_id) AS selected_gate_id,(SELECT trigger_config FROM gates WHERE id=COALESCE(?,codes.gate_id)) AS authorized_config`).bind(crypto.randomUUID(),Date.now(),tenantId,code,Date.now(),selected,selected,selected,selected).first();
 return row?{...row,gate_id:row.selected_gate_id}:null;
}
export async function finishCode(env,row,gate,outcome) {
  const status=outcome==='sent'?(row.single_use?'used':'active'):outcome==='not_sent'?'active':'uncertain';
  const started=outcome==='sent'&&row.visit_mode?(row.visit_started_at||Date.now()):null;
  await env.DB.batch([
    env.DB.prepare("UPDATE codes SET status=?,claim_token=NULL,visit_started_at=COALESCE(visit_started_at,?),expires_at=CASE WHEN ? IS NOT NULL THEN ?+600000 ELSE expires_at END WHERE tenant_id=? AND code=? AND claim_token=? AND status='pending'").bind(status,started,started,started,row.tenant_id,row.code,row.claim_token),
    logStatement(env,row.tenant_id,gate,row.code,row.label,row.owner,outcome,row.owner_id)
  ]);
}
function logStatement(env,tenantId,gate,code,label,owner,outcome,ownerId=null) {
  return env.DB.prepare('INSERT INTO logs(id,tenant_id,gate_id,gate_name,code,label,owner,at,outcome,owner_id) VALUES(?,?,?,?,?,?,?,?,?,COALESCE(?,(SELECT id FROM users WHERE tenant_id=? AND username=?)))')
    .bind(crypto.randomUUID(),tenantId,gate.id,gate.name,code,label,owner,Date.now(),outcome,ownerId,tenantId,owner);
}
export const logOpen=(env,tenantId,gate,code,label,owner,outcome,ownerId=null)=>logStatement(env,tenantId,gate,code,label,owner,outcome,ownerId).run();
export async function resolveCode(env,tenantId,code,action,actor=null) {
  if(!['retry','used'].includes(action))throw new InputError('Resolución inválida');
  const r=await env.DB.batch([env.DB.prepare("UPDATE codes SET status=?,claim_token=NULL WHERE tenant_id=? AND code=? AND (status='uncertain' OR (status='pending' AND claimed_at<?))").bind(action==='retry'?'active':'used',tenantId,code,Date.now()-120000),...auditStatements(env,actor,'resolve_code',{tenantId,code,action},true)]);
  if(!r[0].meta.changes)throw new InputError('Código no pendiente de revisión o solicitud todavía en curso');
}
export async function listLogs(env,tenantId,user) {
  const owner=user.role==='master'?null:user.id;
  const logs=await rows(env.DB.prepare(`SELECT * FROM logs WHERE tenant_id=? AND (? IS NULL OR owner_id=?) ORDER BY at DESC LIMIT 200`).bind(tenantId,owner,owner));
  const count=await env.DB.prepare(`SELECT COUNT(*) AS count FROM logs WHERE tenant_id=? AND (? IS NULL OR owner_id=?) AND at>=? AND outcome='sent'`).bind(tenantId,owner,owner,Date.now()-86400000).first();
  return {logs,opensLast24:count.count};
}
export async function dashboard(env,user) {
  const now=Date.now(),owner=user.role==='master'?null:user.id;
  const [totals,passes,hours]=await Promise.all([
    env.DB.prepare("SELECT SUM(CASE WHEN at>=? AND outcome='sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN at>=? AND outcome IN ('uncertain','pending','not_sent') THEN 1 ELSE 0 END) AS attention, MAX(CASE WHEN outcome='sent' THEN at END) AS lastSent FROM logs WHERE tenant_id=? AND (? IS NULL OR owner_id=?)").bind(now-86400000,now-86400000,user.tenant_id,owner,owner).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM codes c JOIN gates g ON g.id=c.gate_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=? AND (? IS NULL OR c.owner_id=?) AND c.status='active' AND g.status='active' AND (c.expires_at IS NULL OR c.expires_at>?)").bind(user.tenant_id,owner,owner,now).first(),
    rows(env.DB.prepare("SELECT CAST(at/3600000 AS INTEGER)*3600000 AS hour, COUNT(*) AS count FROM logs WHERE tenant_id=? AND (? IS NULL OR owner_id=?) AND at>=? AND outcome='sent' GROUP BY hour ORDER BY hour").bind(user.tenant_id,owner,owner,Math.floor(now/3600000)*3600000-23*3600000))
  ]);
  return {serverNow:now,sent:totals.sent||0,attention:totals.attention||0,lastSent:totals.lastSent,activeCodes:passes.count,hours};
}
export async function listTenants(env) {
  const tenants=await rows(env.DB.prepare("SELECT t.*, (SELECT COUNT(*) FROM codes c WHERE c.tenant_id=t.id AND c.status IN ('pending','uncertain'))+(SELECT COUNT(*) FROM direct_operations o WHERE o.tenant_id=t.id AND o.status IN ('pending','uncertain')) AS needs_review FROM tenants t ORDER BY needs_review DESC,t.created_at DESC"));
  const gates=await rows(env.DB.prepare('SELECT id,tenant_id,name,status FROM gates ORDER BY created_at,id'));
  return tenants.map(t=>({...t,gates:gates.filter(g=>g.tenant_id===t.id)}));
}
export async function reports(env) {
  return rows(env.DB.prepare(`SELECT t.id,t.name,t.status,
    (SELECT COUNT(*) FROM codes c JOIN gates g ON g.id=c.gate_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=t.id AND c.status='active' AND g.status='active' AND (c.expires_at IS NULL OR c.expires_at>?)) AS activeCodes,
    (SELECT COUNT(*) FROM logs l WHERE l.tenant_id=t.id AND l.outcome='sent' AND l.at>=?) AS last24,
    (SELECT COUNT(*) FROM logs l WHERE l.tenant_id=t.id AND l.outcome='sent' AND l.at>=?) AS last7,
    (SELECT COUNT(*) FROM logs l WHERE l.tenant_id=t.id AND l.outcome='sent' AND l.at>=?) AS last30
    FROM tenants t ORDER BY t.name`).bind(Date.now(),Date.now()-86400000,Date.now()-7*86400000,Date.now()-30*86400000));
}
export const audit=(env,admin,action,details)=>env.DB.prepare('INSERT INTO platform_audit_log(id,admin_username,action,details,at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),admin,action,JSON.stringify(details),Date.now()).run();
export const listAudit=env=>rows(env.DB.prepare('SELECT * FROM platform_audit_log ORDER BY at DESC LIMIT 200'));
export async function cleanup(env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM relay_observations WHERE hour<?').bind(Date.now()-48*3600000),
    env.DB.prepare("UPDATE relay_commands SET status='uncertain' WHERE status='pending' AND created_at<?").bind(Date.now()-120000),
    env.DB.prepare("UPDATE relay_commands SET status='completed' WHERE status='cooldown' AND release_at<=?").bind(Date.now()),
    env.DB.prepare("DELETE FROM relay_commands WHERE status IN ('completed','not_sent','closed') AND created_at<?").bind(Date.now()-30*86400000),
    env.DB.prepare("UPDATE logs SET outcome='uncertain' WHERE outcome='pending' AND id IN (SELECT id FROM direct_operations WHERE status='pending' AND created_at<?)").bind(Date.now()-120000),
    env.DB.prepare("UPDATE direct_operations SET status='uncertain' WHERE status='pending' AND created_at<?").bind(Date.now()-120000),
    env.DB.prepare("UPDATE codes SET status='uncertain' WHERE status='pending' AND claimed_at<?").bind(Date.now()-120000),
    env.DB.prepare("UPDATE codes SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=?").bind(Date.now()),
    env.DB.prepare('DELETE FROM logs WHERE at<?').bind(Date.now()-30*86400000),
    env.DB.prepare('DELETE FROM login_attempts WHERE expires_at<?').bind(Date.now())
  ]);
}

export function auditStatements(env,actor,action,details,changedOnly=false){
  if(!actor)return [];
  return [env.DB.prepare('INSERT INTO platform_audit_log(id,admin_username,action,details,at) SELECT ?,?,?,?,?'+(changedOnly?' WHERE changes()>0':'')).bind(crypto.randomUUID(),actor.username,action,JSON.stringify({...details,actorId:actor.id,scope:actor.tenant_id?'tenant':'platform'}),Date.now())];
}
export async function changePlatformPassword(env,admin,secret){
 const r=await env.DB.batch([env.DB.prepare('UPDATE platform_admins SET secret=?,session_version=session_version+1 WHERE id=? AND session_version=?').bind(secret,admin.id,admin.session_version),...auditStatements(env,admin,'change_own_password',{},true)]);return r[0].meta.changes;
}
export async function setTenantStatus(env,tenantId,status,actor){
 await env.DB.batch([env.DB.prepare('UPDATE tenants SET status=? WHERE id=?').bind(status,tenantId),...auditStatements(env,actor,'tenant_status',{tenantId,status})]);
}

export async function setSupport(env,tenantId,value,actor){const phone=String(value||'').replace(/[ +()-]/g,'');if(phone&&!/^[1-9][0-9]{7,14}$/.test(phone))throw new InputError('Escribe el teléfono con código de país, por ejemplo 525512345678');await env.DB.batch([env.DB.prepare('UPDATE tenants SET support_phone=? WHERE id=?').bind(phone,tenantId),...auditStatements(env,actor,'support_contact',{tenantId,phone})]);return phone;}
export async function visitorStatus(env,tenantId,code){
 const row=await env.DB.prepare("SELECT c.*,g.name AS gate_name,g.status AS gate_status,u.role FROM codes c JOIN gates g ON g.id=c.gate_id AND g.tenant_id=c.tenant_id JOIN users u ON u.id=c.owner_id AND u.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.code=? AND (u.role='master' OR EXISTS(SELECT 1 FROM user_gates p WHERE p.tenant_id=c.tenant_id AND p.user_id=c.owner_id AND p.gate_id=c.gate_id))").bind(tenantId,code).first();
 if(!row)return {state:'unavailable',message:'Este acceso no está disponible. Pide ayuda a quien te invitó.'};
 const state=row.status==='active'&&row.expires_at&&row.expires_at<=Date.now()?'expired':row.gate_status!=='active'?'unavailable':row.status;
 const messages={active:'Tu acceso está disponible.',expired:'Este acceso venció. Pide uno nuevo a quien te invitó.',revoked:'Este acceso fue cancelado. Contacta a quien te invitó.',used:'Este acceso ya fue utilizado. Pide uno nuevo.',pending:'El envío está pendiente de confirmar. No repitas la apertura; contacta al administrador.',uncertain:'No pudimos confirmar el envío. Contacta al administrador antes de repetir.',unavailable:'Este portón no está disponible. Contacta al administrador.'};
 const last=await env.DB.prepare("SELECT at FROM logs WHERE tenant_id=? AND code=? AND outcome='sent' ORDER BY at DESC LIMIT 1").bind(tenantId,code).first();
 return {state,message:messages[state]||messages.unavailable,gateName:row.gate_name,visitExpiresAt:row.visit_mode&&row.visit_started_at?row.expires_at:null,lastSentAt:last?.at||null,serverNow:Date.now()};
}
