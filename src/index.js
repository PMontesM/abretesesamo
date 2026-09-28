import {protectCodes,resolveCodeBody} from './lib/code-privacy.js';
import {checkTurnstile,turnstileConfig} from './lib/turnstile.js';
import {createPass,listPasses,extendPass,visitorGates} from './lib/passes.js';
import {panelData} from './lib/panel.js';
import {relayStatus} from './lib/relay.js';
import {relayOpen,RelayError} from './lib/relay.js';
import * as operations from './lib/operations.js';
import * as db from './lib/db.js';
import { createSessionCookie, clearSessionCookie, verifySession, login } from './lib/auth.js';
import { InputError, jsonBody, username, triggerConfig } from './lib/security.js';
import { takeAttempt } from './lib/ratelimit.js';
import { handlePlatform } from './platform.js';
import { getPublicHTML } from './html/public.js';
import { getAdminHTML } from './html/admin.js';
const json=(body,status=200)=>Response.json(body,{status});
const html=body=>new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}});
export class TriggerError extends Error {}
export async function triggerGate(gate,env,sourceId=crypto.randomUUID()) {
  if(gate?.status==='active'&&gate.trigger_type==='mqtt')return relayOpen(env,gate,sourceId);
  if(gate?.status==='active'&&gate.trigger_type==='demo')return;
  if(!gate||gate.status!=='active'||gate.trigger_type!=='webhook')throw new TriggerError('Portón no disponible');
  let config;try {config=JSON.parse(gate.trigger_config);}catch{throw new TriggerError('Configuración inválida');}
  let safe;try{safe=JSON.parse(triggerConfig(config.url,config.method||'GET'));}catch{throw new TriggerError('Revisa la URL HTTPS y el método del portón');}
  // Follow redirect chains as the original integration did, without retrying a URL.
  // One timeout covers the whole chain. Never forward provider URLs/tokens to the UI.
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  const visited=new Set();
  let target=safe.url,method=safe.method;
  try {
    for(let hops=0;hops<=5;hops++){
      if(visited.has(target))throw new TriggerError('La integración devolvió una redirección circular');
      visited.add(target);
      let response;
      try{response=await fetch(target,{method,redirect:'manual',signal:controller.signal});}
      catch{throw new TriggerError(controller.signal.aborted?'El proveedor no respondió en 30 segundos':'No se pudo conectar con el proveedor');}
      if(response.ok)return;
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('Location');
        if(!location)throw new TriggerError('La integración devolvió una redirección sin destino');
        let next;try{next=new URL(location,target);}catch{throw new TriggerError('La integración devolvió un destino inválido');}
        if(next.protocol!=='https:'||next.username||next.password)throw new TriggerError('La integración redirigió a un destino no permitido');
        if(hops===5)throw new TriggerError('La integración devolvió demasiadas redirecciones');
        if(response.status===303||([301,302].includes(response.status)&&method==='POST'))method='GET';
        target=next.href;
        continue;
      }
      throw new TriggerError('El proveedor respondió HTTP '+response.status);
    }
  } finally {clearTimeout(timer);}
}
function triggerReason(error){return (error instanceof TriggerError||error instanceof RelayError)?error.message:'Fallo inesperado al enviar la orden';}

async function route(request,env,ctx) {
  const url=new URL(request.url);
  if(env.PUBLIC_HOSTNAME&&url.hostname!==env.PUBLIC_HOSTNAME)return new Response('No encontrado',{status:404});
  if(request.method==='POST'){
    const origin=request.headers.get('Origin');
    if(origin&&origin!==url.origin)return json({ok:false,error:'Origen no autorizado'},403);
  }
  const challengeFailure=await checkTurnstile(request,env);
  if(challengeFailure)return challengeFailure;
  if(url.pathname==='/health')return json({ok:true,service:'Servidor web; no confirma estado físico del portón'});
  if(url.pathname==='/platform'||url.pathname.startsWith('/platform/'))return handlePlatform(request,env,ctx,url);
  const parts=url.pathname.split('/').filter(Boolean);
  if(parts[0]!=='t'||!parts[1])return new Response('No encontrado',{status:404});
  const tenant=await db.tenantBySlug(env,parts[1]);
  if(!tenant)return new Response('No encontrado',{status:404});
  if(tenant.status!=='active')return json({ok:false,error:'Edificio suspendido temporalmente'},403);
  const rest='/'+parts.slice(2).join('/');
  if(rest==='/'&&request.method==='GET')return html(getPublicHTML(tenant,turnstileConfig(env)));
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  if(rest==='/api/login'&&request.method==='POST'){
    if(!await takeAttempt(env,`login:${tenant.id}:${ip}`))return json({ok:false,error:'Demasiados intentos. Espera cinco minutos.'},429);
    const b=await jsonBody(request),user=await login(env,tenant.id,username(b.username),b.secret);
    if(!user)return json({ok:false,error:'Usuario o contraseña incorrectos'},403);
    return Response.json({ok:true},{headers:{'Set-Cookie':await createSessionCookie(env,user)}});
  }
  if(rest==='/api/access-state'&&request.method==='POST'){
    if(!await takeAttempt(env,`visitor:${tenant.id}:${ip}`,30))return json({ok:false,error:'Demasiadas solicitudes. Espera cinco minutos.'},429);
    const b=await jsonBody(request);if(!/^\d{6}$/.test(b.code||''))throw new InputError('El código debe tener seis dígitos');return json({ok:true,...await db.visitorStatus(env,tenant.id,b.code),gates:await visitorGates(env,tenant.id,b.code)});
  }
  if(rest==='/api/open'&&request.method==='POST'){
    if(!await takeAttempt(env,`visitor:${tenant.id}:${ip}`,30))return json({ok:false,error:'Demasiadas solicitudes. Espera cinco minutos.'},429);
    const b=await jsonBody(request);
    if(!/^\d{6}$/.test(b.code||''))throw new InputError('El código debe tener seis dígitos');
    const candidate=await env.DB.prepare("SELECT visit_mode,visit_started_at FROM codes WHERE tenant_id=? AND code=? AND status='active' AND (expires_at IS NULL OR expires_at>?)").bind(tenant.id,b.code,Date.now()).first();

    const gates=await visitorGates(env,tenant.id,b.code);
    if(gates.length>1&&!b.gateId)return json({ok:true,selectionRequired:true,gates,message:'Selecciona el acceso que quieres abrir.'});
    if(b.gateId&&!gates.some(g=>g.id===b.gateId))return json({ok:false,error:'Este pase no autoriza ese acceso'},403);
    if(candidate?.visit_mode&&!candidate.visit_started_at&&b.confirmVisit!==true)return json({ok:true,confirmationRequired:true,message:'¿Estás frente al portón? Al abrir por primera vez tendrás 10 minutos para volver a abrir. Después, el código dejará de funcionar.'});
    const row=await db.claimCode(env,tenant.id,b.code,b.gateId||null);
    if(!row)return json({ok:false,error:(await db.visitorStatus(env,tenant.id,b.code)).message},403);
    const gate=await db.getGate(env,tenant.id,row.gate_id);
    let outcome='sent',reason='';
    try {if(gate?.trigger_config!==row.authorized_config)throw new TriggerError('La configuración del portón cambió');await triggerGate(gate,env,row.claim_token);}catch(error) {outcome=error instanceof RelayError&&!error.uncertain?'not_sent':'uncertain';reason=triggerReason(error);console.warn(JSON.stringify({event:'gate_trigger_failed',gateId:gate?.id,reason}));}
    // Persist completion with its audit record. Failure leaves the reservation for review.
    try{await db.finishCode(env,row,gate||{id:row.gate_id,name:'Portón no disponible'},outcome);}catch{return json({ok:false,error:'La orden pudo ejecutarse, pero no se pudo guardar el resultado. No reintentes; solicita revisión al administrador.'},503);}
    if(outcome==='not_sent')return json({ok:false,error:reason+'. No se envió una nueva orden; el código conserva su vigencia.'},409);
    if(outcome!=='sent')return json({ok:false,error:'No se pudo confirmar la orden. '+reason+'. El código queda en revisión; contacta al administrador.'},502);
    return json({ok:true,message:`Orden de apertura enviada a ${gate.name}`,gateName:gate.name,visitExpiresAt:row.visit_mode?(await env.DB.prepare('SELECT expires_at FROM codes WHERE tenant_id=? AND code=?').bind(tenant.id,row.code).first()).expires_at:null,serverNow:Date.now()});
  }
  const user=await verifySession(request,env,tenant.id);
  if(!user){
    if(rest==='/admin'&&request.method==='GET')return Response.redirect(url.origin+'/t/'+tenant.slug,302);
    return json({ok:false,error:'Tu sesión terminó. Vuelve a iniciar sesión.'},401);
  }
  if(rest==='/admin'&&request.method==='GET')return html(getAdminHTML(tenant,user,url.searchParams.get('view')));
  if(rest==='/admin/panel'&&request.method==='GET')return json({ok:true,...await protectCodes(env,await panelData(env,user,url.searchParams.get('offset')),user,tenant.id)});
  if(rest==='/admin/passes'&&request.method==='GET')return json({ok:true,passes:await protectCodes(env,await listPasses(env,user,Object.fromEntries(url.searchParams)),user,tenant.id)});
  if(rest==='/admin/passes'&&request.method==='POST')return json({ok:true,...await createPass(env,user,await jsonBody(request))});
  if(rest==='/admin/passes/extend'&&request.method==='POST'){await extendPass(env,user,await resolveCodeBody(env,await jsonBody(request),user,tenant.id));return json({ok:true});}
  if(rest==='/admin/connection'&&request.method==='POST'){if(user.role!=='master')return json({ok:false,error:'Solo administración puede consultar dispositivos'},403);if(!await takeAttempt(env,'connection:'+user.tenant_id,6))return json({ok:false,error:'Espera cinco minutos antes de consultar de nuevo'},429);const gate=await db.requireGate(env,user,(await jsonBody(request)).gateId);if(gate.trigger_type!=='mqtt')return json({ok:true,connection:null});return json({ok:true,connection:await relayStatus(env,gate)});}
  if(rest==='/admin/dashboard'&&request.method==='GET')return json({ok:true,...await db.dashboard(env,user)});
  if(rest==='/admin/logout'&&request.method==='POST'){
    await env.DB.prepare('UPDATE users SET session_version=session_version+1 WHERE tenant_id=? AND id=?').bind(tenant.id,user.id).run();
    return Response.json({ok:true},{headers:{'Set-Cookie':clearSessionCookie()}});
  }
  if(rest==='/admin/gates'&&request.method==='GET')return json({ok:true,gates:(await db.allowedGates(env,user)).map(g=>({id:g.id,name:g.name,status:g.status,hasRelay:g.trigger_type==='mqtt',connection_state:g.connection_state,connection_checked_at:g.connection_checked_at}))});
  if(rest==='/admin/open-gate'&&request.method==='POST'){
    const b=await jsonBody(request),gate=await db.requireGate(env,user,b.gateId);
    if(!await takeAttempt(env,`direct:${user.id}`,30))return json({ok:false,error:'Demasiadas solicitudes. Espera cinco minutos.'},429);
    const operation=await operations.reserve(env,user,gate,b.requestId);
    if(operation.replay)return operation.status==='sent'?json({ok:true,message:'La orden ya fue enviada a '+operation.gate_name,operationId:operation.id}):json({ok:false,error:'Esta orden está en revisión o ya fue cerrada. No se ha vuelto a enviar.',operationId:operation.id,operationClosed:operation.status==='closed'},409);
    let outcome='sent',reason='';try{await triggerGate(gate,env,operation.id);}catch(error){outcome=error instanceof RelayError&&!error.uncertain?'not_sent':'uncertain';reason=triggerReason(error);}
    try{await operations.finish(env,operation.id,outcome);}catch{return json({ok:false,error:'La orden pudo ejecutarse. No se pudo guardar el resultado; solicita revisión y no repitas la apertura.',operationId:operation.id},503);}
    if(outcome==='not_sent')return json({ok:false,error:reason+'. No se envió una nueva orden.',operationId:operation.id,operationClosed:true},409);
    return outcome==='sent'?json({ok:true,message:'Orden de apertura enviada a '+gate.name,operationId:operation.id}):json({ok:false,error:'No se confirmó la orden. El portón queda bloqueado para nuevas órdenes del panel hasta que plataforma revise el resultado.',operationId:operation.id},502);
  }
  if(rest==='/admin/support'&&request.method==='POST'){if(user.role!=='master')return json({ok:false,error:'Solo el administrador puede cambiar el contacto.'},403);const b=await jsonBody(request);return json({ok:true,phone:await db.setSupport(env,tenant.id,b.phone,user)});}
  if(rest==='/admin/create-code'&&request.method==='POST')return json({ok:true,code:await db.createCode(env,user,await jsonBody(request))});
  if(rest==='/admin/codes'&&request.method==='GET')return json({ok:true,codes:await protectCodes(env,await db.listCodes(env,tenant.id,user,Object.fromEntries(url.searchParams)),user,tenant.id)});
  if(rest==='/admin/revoke-code'&&request.method==='POST'){
    const b=await resolveCodeBody(env,await jsonBody(request),user,tenant.id);await db.revokeCode(env,tenant.id,b.code,user,user);return json({ok:true});
  }
  if(rest==='/admin/logs'&&request.method==='GET')return json({ok:true,...await protectCodes(env,await db.listLogs(env,tenant.id,user),user,tenant.id)});
  if(rest.startsWith('/admin/users')||rest==='/admin/create-user'||rest==='/admin/delete-user'){
    if(user.role!=='master')return json({ok:false,error:'Solo el administrador principal gestiona usuarios'},403);
    if(rest==='/admin/users'&&request.method==='GET')return json({ok:true,users:await db.listUsers(env,tenant.id)});
    if(request.method==='POST'){
      const b=await jsonBody(request);
      if(rest==='/admin/create-user')await db.createUser(env,tenant.id,b,user);
      else if(rest==='/admin/delete-user')await db.deleteUser(env,tenant.id,b.userId,user);
      else if(rest==='/admin/users/permissions')await db.setPermissions(env,tenant.id,b.userId,b.gateIds,user);
      else if(rest==='/admin/users/reset')await db.resetSecret(env,tenant.id,b.userId,b.secret,user);
      else return json({ok:false,error:'No encontrado'},404);
      return json({ok:true});
    }
  }
  return json({ok:false,error:'No encontrado'},404);
}
export default {
  async fetch(request,env,ctx){
    let res;
    try{res=await route(request,env,ctx);}catch(err){res=json({ok:false,error:err instanceof InputError?err.message:'No se pudo completar la operación. Actualiza la lista antes de reintentar.'},err instanceof InputError?400:500);}
    const headers=new Headers(res.headers);
    headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(res.body,{status:res.status,headers});
  },
  async scheduled(event,env,ctx){ctx.waitUntil(db.cleanup(env));}
};
