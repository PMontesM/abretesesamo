import {protectCodes,resolveCodeBody} from './lib/code-privacy.js';
import {turnstileConfig} from './lib/turnstile.js';
import {superPanel} from './lib/super-panel.js';
import {relayStatus,pendingRelays,resolveRelay,RelayError} from './lib/relay.js';
import {listInventory,registerRelay,requireInventory,discoverRelays} from './lib/relay-inventory.js';
import {relaySettingsSummary,saveRelayCredentials} from './lib/relay-settings.js';
import * as operations from './lib/operations.js';
import * as db from './lib/db.js';
import { login, createSessionCookie, clearSessionCookie, verifySession } from './lib/auth.js';
import { jsonBody, username, InputError, hashSecret, verifySecret } from './lib/security.js';
import { takeAttempt } from './lib/ratelimit.js';
import { getPlatformLoginHTML, getPlatformAdminHTML } from './html/platform.js';
const json=body=>Response.json({ok:true,...body});
const html=body=>new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}});
export async function handlePlatform(request,env,ctx,url){
  const rest=url.pathname.replace(/^\/platform/,'')||'/';
  if(rest==='/'&&request.method==='GET')return html(getPlatformLoginHTML(turnstileConfig(env)));
  if(rest==='/login'&&request.method==='POST'){
    const ip=request.headers.get('cf-connecting-ip')||'unknown';
    if(!await takeAttempt(env,`platform:${ip}`,10))return Response.json({ok:false,error:'Demasiados intentos. Espera cinco minutos.'},{status:429});
    const b=await jsonBody(request),user=await login(env,null,username(b.username),b.secret,true);
    if(!user)return Response.json({ok:false,error:'Usuario o contraseña incorrectos'},{status:403});
    return Response.json({ok:true},{headers:{'Set-Cookie':await createSessionCookie(env,user,true)}});
  }
  const admin=await verifySession(request,env,null,true);
  if(!admin)return Response.json({ok:false,error:'Tu sesión terminó. Vuelve a iniciar sesión.'},{status:401});
  const json=async body=>Response.json({ok:true,...await protectCodes(env,body,admin,url.searchParams.get('tenantId'))});
  if(rest==='/admin'&&request.method==='GET')return html(getPlatformAdminHTML(admin,url.searchParams.get('view'),url.searchParams.get('tenantId')));
  if(rest==='/logout'&&request.method==='POST'){
    await env.DB.prepare('UPDATE platform_admins SET session_version=session_version+1 WHERE id=?').bind(admin.id).run();
    return Response.json({ok:true},{headers:{'Set-Cookie':clearSessionCookie(true)}});
  }
  if(request.method==='GET'){
    if(rest==='/api/panel')return json(await superPanel(env,url.searchParams.get('offset')));
    if(rest==='/api/relay-inventory')return json({devices:await listInventory(env)});
    if(rest==='/api/relay-settings')return json({settings:await relaySettingsSummary(env)});
    if(rest==='/api/tenants')return json({tenants:await db.listTenants(env)});
    if(rest==='/api/reports')return json({report:await db.reports(env)});
    if(rest==='/api/audit')return json({log:await db.listAudit(env)});
    const tenantId=url.searchParams.get('tenantId');
    if(!tenantId||!await db.tenantById(env,tenantId))throw new InputError('Edificio inexistente');
    if(rest==='/api/relays')return json({commands:await pendingRelays(env,tenantId)});
    if(rest==='/api/operations')return json({operations:await operations.list(env,tenantId)});
    if(rest==='/api/gates')return json({gates:await db.listGates(env,tenantId)});
    if(rest==='/api/users')return json({users:await db.listUsers(env,tenantId)});
    if(rest==='/api/codes')return json({codes:await db.listCodes(env,tenantId,null,Object.fromEntries(url.searchParams))});
  }
  if(request.method==='POST'){
    const b=await jsonBody(request);
    if(rest==='/api/relay-settings'){
      if(!await takeAttempt(env,'relay-settings:'+admin.id,10))throw new InputError('Demasiados intentos. Espera cinco minutos.');
      if(!await verifySecret(b.currentSecret,admin.secret))throw new InputError('Tu contraseña de plataforma es incorrecta');
      await saveRelayCredentials(env,b,admin);return json({});
    }
    if(rest==='/api/relay-inventory'){
      if(!await takeAttempt(env,'relay-register:'+admin.id,30))throw new InputError('Espera unos minutos antes de registrar más relés');
      return json({deviceId:await registerRelay(env,b,admin)});
    }
    if(rest==='/api/relay-inventory/discover'){
      if(!await takeAttempt(env,'relay-discover:'+admin.id,5))throw new InputError('Espera unos minutos antes de buscar otra vez');
      return json(await discoverRelays(env));
    }
    if(rest==='/api/relay-inventory/connection'){
      if(!await takeAttempt(env,'relay-status:'+admin.id,30))throw new InputError('Espera unos minutos antes de consultar otra vez');
      await requireInventory(env,b.deviceId);
      try{return json({connection:await relayStatus(env,{trigger_config:JSON.stringify({deviceId:b.deviceId})})});}catch(e){if(e instanceof RelayError)throw new InputError(e.message);throw e;}
    }
    if(rest==='/api/change-password'){
      if(!await takeAttempt(env,`platform-password:${admin.id}`,10))return Response.json({ok:false,error:'Demasiados intentos. Espera cinco minutos.'},{status:429});
      if(!await verifySecret(b.currentSecret,admin.secret))return Response.json({ok:false,error:'La contraseña actual es incorrecta.'},{status:403});
      if(b.newSecret!==b.confirmSecret)throw new InputError('Las contraseñas nuevas no coinciden.');
      if(b.newSecret===b.currentSecret)throw new InputError('Elige una contraseña diferente de la actual.');
      const secret=await hashSecret(b.newSecret);
      const changed=await db.changePlatformPassword(env,admin,secret);
      if(!changed)return Response.json({ok:false,error:'Tu sesión terminó. Vuelve a iniciar sesión.'},{status:401});
      return Response.json({ok:true},{headers:{'Set-Cookie':clearSessionCookie(true)}});
    }
    if(rest==='/api/tenants'){
      const id=await db.createTenant(env,b,admin);return json({tenantId:id,slug:(await db.tenantById(env,id)).slug});
    }
    const tenantId=b.tenantId;
    if(!tenantId||!await db.tenantById(env,tenantId))throw new InputError('Edificio inexistente');
    let detail={tenantId};
    if(rest==='/api/relays/resolve'){await resolveRelay(env,tenantId,b.commandId,admin);return json({});}
    if(rest==='/api/gates/connection'){
      if(!await takeAttempt(env,'relay-status:'+admin.id,30))throw new InputError('Espera unos minutos antes de consultar otra vez');
      const gate=await db.getGate(env,tenantId,b.gateId);if(!gate||gate.trigger_type!=='mqtt')throw new InputError('Selecciona un portón con relé MQTT');
      try{return json({connection:await relayStatus(env,gate)});}catch(e){if(e instanceof RelayError)throw new InputError(e.message);throw e;}
    }
    if(rest==='/api/support'){return json({phone:await db.setSupport(env,tenantId,b.phone,admin)});}
    if(rest==='/api/operations/resolve'){await operations.resolve(env,tenantId,b.operationId,admin);return json({});}
    if(rest==='/api/tenants/status'){
      if(!['active','suspended'].includes(b.status))throw new InputError('Estado inválido');
      await db.setTenantStatus(env,tenantId,b.status,admin);detail.status=b.status;
    }else if(rest==='/api/gates'){
      detail.gateId=await db.saveGate(env,tenantId,b,admin);detail.status=b.status||'active';
    }else if(rest==='/api/users'){
      detail.userId=await db.createUser(env,tenantId,b,admin);
    }else if(rest==='/api/users/delete'){
      await db.deleteUser(env,tenantId,b.userId,admin);detail.userId=b.userId;
    }else if(rest==='/api/users/permissions'){
      await db.setPermissions(env,tenantId,b.userId,b.gateIds,admin);detail.userId=b.userId;detail.gateIds=b.gateIds;
    }else if(rest==='/api/reset-secret'){
      await db.resetSecret(env,tenantId,b.userId,b.secret,admin);detail.userId=b.userId;
    }else if(rest==='/api/codes/revoke'){
      const resolved=await resolveCodeBody(env,b,admin,tenantId);await db.revokeCode(env,tenantId,resolved.code,null,admin);
    }else if(rest==='/api/codes/resolve'){
      const resolved=await resolveCodeBody(env,b,admin,tenantId);await db.resolveCode(env,tenantId,resolved.code,b.action,admin);detail.resolution=b.action;
    }else return Response.json({ok:false,error:'No encontrado'},{status:404});
    return json(detail);
  }
  return Response.json({ok:false,error:'No encontrado'},{status:404});
}
