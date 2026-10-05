import {normalizePhone} from './lib/account-provision.js';
import {Hono} from 'hono';
import {visitorGates} from './lib/passes.js';
import {accountSession,accountCookie,clearAccountCookie} from './lib/account-session.js';
import {hashSecret,verifySecret,InputError,jsonBody,username} from './lib/security.js';
import {takeAttempt} from './lib/ratelimit.js';
import {page} from './html/shared.js';
import {turnstileConfig} from './lib/turnstile.js';
const dummy='pbkdf2$100000$00000000000000000000000000000000$'+'0'.repeat(64);
function email(value){const e=String(value||'').trim().toLowerCase();if(e.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(e))throw new InputError('Escribe un correo electrónico válido.');return e;}
export async function accountBuildings(env,a){return (await env.DB.prepare("SELECT t.id,t.slug,t.name,u.role FROM account_memberships m JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id WHERE m.account_id=? AND t.status='active' ORDER BY t.name,t.id").bind(a.id).all()).results;}
async function destination(env,a){if(await env.DB.prepare('SELECT 1 FROM account_platform WHERE account_id=?').bind(a.id).first())return '/platform/admin';const buildings=await accountBuildings(env,a);return buildings.length?'/t/'+buildings[0].slug+'/admin':'/account';}
async function limited(c,kind,max=10){const ip=c.req.raw.headers.get('cf-connecting-ip')||'unknown';if(!await takeAttempt(c.env,kind+':'+ip,max))throw new InputError('Demasiados intentos. Espera cinco minutos.');}
export const accounts=new Hono();
accounts.get('/',c=>c.redirect('/visit',302));
accounts.get('/visit',c=>c.html(page('Acceso de visitantes',{mode:'account-visitor',...turnstileConfig(c.env)})));
accounts.post('/api/visitor-entry',async c=>{
 const ip=c.req.raw.headers.get('cf-connecting-ip')||'unknown';
 if(!await takeAttempt(c.env,'visitor-entry:'+ip,10))return c.json({ok:false,error:'Demasiados intentos. Espera cinco minutos.'},429);
 const b=await jsonBody(c.req.raw);
 if(!/^\d{6}$/.test(b.code||''))throw new InputError('El código debe tener seis dígitos');
 const row=await c.env.DB.prepare("SELECT t.id,t.slug FROM codes c JOIN tenants t ON t.id=c.tenant_id WHERE c.code=? AND t.status='active' AND c.status='active' AND (c.expires_at IS NULL OR c.expires_at>?)").bind(b.code,Date.now()).first();
 if(!row||!(await visitorGates(c.env,row.id,b.code)).length)return c.json({ok:false,error:'Código no disponible. Revisa los seis dígitos o solicita uno nuevo.'},403);
 return c.json({ok:true,tenantId:row.id,redirect:'/t/'+row.slug});
});
accounts.get('/login',async c=>{const a=await accountSession(c.req.raw,c.env);if(a)return c.redirect(await destination(c.env,a),302);return c.html(page('Un solo acceso para tus edificios',{mode:'account-login',...turnstileConfig(c.env)}));});
accounts.get('/account',async c=>{const a=await accountSession(c.req.raw,c.env);if(!a)return c.redirect('/login',302);return c.html(page('Mi cuenta',{mode:'account-settings',email:a.email,phone:a.phone,...turnstileConfig(c.env)}));});
accounts.post('/account/login',async c=>{await limited(c,'account-login');const b=await jsonBody(c.req.raw),e=b.phone?normalizePhone(b.phone):email(b.email),a=await c.env.DB.prepare(b.phone?'SELECT * FROM accounts WHERE phone=?':'SELECT * FROM accounts WHERE email=? AND phone IS NULL').bind(e).first();if(!await verifySecret(b.secret,a?.secret||dummy)||!a)return c.json({ok:false,error:'Teléfono o contraseña incorrectos.'},403);return c.json({ok:true,redirect:await destination(c.env,a)},200,{'Set-Cookie':await accountCookie(c.env,a)});});
accounts.get('/account/buildings',async c=>{const a=await accountSession(c.req.raw,c.env);return a?c.json({ok:true,linked:true,email:a.email,phone:a.phone,buildings:await accountBuildings(c.env,a),platform:!!await c.env.DB.prepare('SELECT 1 FROM account_platform WHERE account_id=?').bind(a.id).first()}):c.json({ok:true,linked:false,buildings:[]});});
accounts.post('/account/password',async c=>{const a=await accountSession(c.req.raw,c.env);if(!a)return c.json({ok:false,error:'Inicia sesión de nuevo.'},401);if(!await takeAttempt(c.env,'account-password:'+a.id,6))throw new InputError('Espera cinco minutos.');const b=await jsonBody(c.req.raw);if(!await verifySecret(b.currentSecret,a.secret))throw new InputError('Contraseña actual incorrecta.');if(b.secret!==b.confirmSecret)throw new InputError('Las contraseñas no coinciden.');const secret=await hashSecret(b.secret);const result=await c.env.DB.prepare('UPDATE accounts SET secret=?,session_version=session_version+1 WHERE id=? AND session_version=?').bind(secret,a.id,a.session_version).run();if(!result.meta.changes)throw new InputError('Tu sesión cambió. Inicia sesión de nuevo.');return c.json({ok:true},200,{'Set-Cookie':clearAccountCookie()});});
accounts.post('/account/logout',async c=>{const a=await accountSession(c.req.raw,c.env);if(a)await c.env.DB.prepare('UPDATE accounts SET session_version=session_version+1 WHERE id=?').bind(a.id).run();const headers=new Headers();headers.append('Set-Cookie',clearAccountCookie());headers.append('Set-Cookie','tenant_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');headers.append('Set-Cookie','platform_session=; HttpOnly; Secure; SameSite=Strict; Path=/platform; Max-Age=0');headers.set('Content-Type','application/json');return new Response(JSON.stringify({ok:true}),{headers});});
