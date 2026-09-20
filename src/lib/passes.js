import {allowedGates,listCodes} from './db.js';
import {InputError,required} from './security.js';
import {takeAttempt} from './ratelimit.js';
export async function createPass(env,user,body){
 const ids=[...new Set(Array.isArray(body.gateIds)?body.gateIds:[])];
 if(!ids.length||ids.length>10||ids.some(id=>typeof id!=='string'))throw new InputError('Selecciona entre uno y diez accesos');
 const allowed=await allowedGates(env,user),gates=ids.map(id=>allowed.find(g=>g.id===id));
 if(gates.some(g=>!g))throw new InputError('Acceso no autorizado');
 const label=required(body.label,'Nombre o referencia',60),category=body.category||'Visita';
 if(!['Visita','Entrega','Servicio'].includes(category))throw new InputError('Categoría inválida');
 const mode=body.mode||'repeat',minutes=Number(body.minutes);
 if(!['repeat','visit','unlimited'].includes(mode)||!([30,120,360,1440].includes(minutes)||mode==='unlimited'))throw new InputError('Vigencia inválida');
 if(!await takeAttempt(env,'create-code:'+user.id,30))throw new InputError('Espera antes de crear más pases');
 const now=Date.now(),expires=mode==='unlimited'?null:now+minutes*60000,token=crypto.randomUUID();
 for(let i=0;i<20;i++){
  const n=crypto.getRandomValues(new Uint32Array(1))[0];if(n>=4294000000)continue;const code=String(n%1000000).padStart(6,'0');
  const insert=env.DB.prepare(`INSERT INTO codes(code,tenant_id,gate_id,label,owner,owner_id,single_use,expires_at,created_at,visit_mode,category,creation_token)
   SELECT ?,?,?,?,?,?,0,?,?,?,?,? WHERE (SELECT COUNT(*) FROM codes WHERE tenant_id=?)<20000 AND (SELECT COUNT(*) FROM codes WHERE tenant_id=? AND owner_id=? AND status IN ('active','pending','uncertain') AND (expires_at IS NULL OR expires_at>?))<200 ON CONFLICT(tenant_id,code) DO NOTHING`).bind(code,user.tenant_id,ids[0],label,user.username,user.id,expires,now,mode==='visit'?1:0,category,token,user.tenant_id,user.tenant_id,user.id,now);
  const result=await env.DB.batch([insert,...gates.map(g=>env.DB.prepare('INSERT INTO code_gates(tenant_id,code,gate_id,authorized_config) SELECT tenant_id,code,?,? FROM codes WHERE tenant_id=? AND code=? AND creation_token=?').bind(g.id,g.trigger_config,user.tenant_id,code,token))]);
  if(result[0].meta.changes)return {code};
 }
 throw new InputError('No se pudo crear el pase. Revisa la cuota de códigos activos.');
}
export async function listPasses(env,user,options={}){
 const codes=await listCodes(env,user.tenant_id,user,options);
 if(!codes.length)return [];
 const links=(await env.DB.prepare(`SELECT c.code,g.id,g.name FROM code_gates c JOIN gates g ON g.id=c.gate_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.code IN (${codes.map(()=>'?').join(',')})`).bind(user.tenant_id,...codes.map(c=>c.code)).all()).results;
 return codes.map(c=>({...c,creation_token:undefined,access:links.filter(l=>l.code===c.code).map(l=>({id:l.id,name:l.name})).concat(links.some(l=>l.code===c.code)?[]:[{id:c.gate_id,name:c.gate_name}])}));
}
export async function extendPass(env,user,body){
 if(!Number.isSafeInteger(body.expiresAt))throw new InputError('Actualiza la vigencia antes de extender');
 if(!await takeAttempt(env,'extend-pass:'+user.id,20))throw new InputError('Demasiadas solicitudes');
 const now=Date.now(),owner=user.role==='master'?null:user.id;
 const result=await env.DB.prepare(`UPDATE codes SET expires_at=expires_at+1800000 WHERE tenant_id=? AND code=? AND (? IS NULL OR owner_id=?) AND status='active' AND single_use=0 AND visit_mode=0 AND expires_at=? AND expires_at>? AND expires_at<=? AND expires_at+1800000<=created_at+604800000
  AND EXISTS(SELECT 1 FROM gates g WHERE g.id=codes.gate_id AND g.status='active')
  AND NOT EXISTS(SELECT 1 FROM code_gates cg JOIN gates g ON g.id=cg.gate_id WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND (g.status!='active' OR g.trigger_config!=cg.authorized_config))
  AND EXISTS(SELECT 1 FROM users u WHERE u.id=codes.owner_id AND u.tenant_id=codes.tenant_id AND (u.role='master' OR (EXISTS(SELECT 1 FROM user_gates p WHERE p.user_id=u.id AND p.gate_id=codes.gate_id) AND NOT EXISTS(SELECT 1 FROM code_gates cg WHERE cg.tenant_id=codes.tenant_id AND cg.code=codes.code AND NOT EXISTS(SELECT 1 FROM user_gates p WHERE p.user_id=u.id AND p.gate_id=cg.gate_id)))))`).bind(user.tenant_id,body.code,owner,owner,body.expiresAt,now,now+600000).run();
 if(!result.meta.changes)throw new InputError('No se extendió: actualiza el pase. Solo los reutilizables activos que vencen en diez minutos se pueden extender, hasta siete días desde su creación.');
}
export async function visitorGates(env,tenantId,code){
 const row=await env.DB.prepare("SELECT * FROM codes WHERE tenant_id=? AND code=? AND status='active' AND (expires_at IS NULL OR expires_at>?)").bind(tenantId,code,Date.now()).first();if(!row)return [];
 const user=await env.DB.prepare('SELECT * FROM users WHERE tenant_id=? AND id=?').bind(tenantId,row.owner_id).first();if(!user)return [];
 const gates=await allowedGates(env,user),links=(await env.DB.prepare('SELECT * FROM code_gates WHERE tenant_id=? AND code=?').bind(tenantId,code).all()).results;
 return gates.filter(g=>links.length?links.some(l=>l.gate_id===g.id&&l.authorized_config===g.trigger_config):g.id===row.gate_id).map(g=>({id:g.id,name:g.name}));
}
