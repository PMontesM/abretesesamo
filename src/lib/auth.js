import { verifySecret } from './security.js';
const TTL = 3600;
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function sign(env, value) {
  if (!env.ADMIN_SIGNING_SECRET || env.ADMIN_SIGNING_SECRET.length < 32) throw new Error('Falta configurar una clave de firma segura');
  const key = await crypto.subtle.importKey('raw',enc.encode(env.ADMIN_SIGNING_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(value))));
}
export async function createSessionCookie(env, user, platform=false) {
  const payload=b64(enc.encode(JSON.stringify({id:user.id,t:user.tenant_id,v:user.session_version,e:Date.now()+TTL*1000})));
  const scope=platform?'platform':'tenant';
  return `${scope}_session=${payload}.${await sign(env,scope+':'+payload)}; HttpOnly; Secure; SameSite=Strict; Path=${platform?'/platform':'/'}; Max-Age=${TTL}`;
}
export function clearSessionCookie(platform=false) {
  return `${platform?'platform':'tenant'}_session=; HttpOnly; Secure; SameSite=Strict; Path=${platform?'/platform':'/'}; Max-Age=0`;
}
export async function verifySession(request,env,tenantId=null,platform=false) {
  const scope=platform?'platform':'tenant';
  const raw=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(scope+'_session='))?.split('=')[1];
  if (!raw || raw.length>2048) return null;
  const [payload,sig]=raw.split('.');
  if (!sig) return null;
  const expected=await sign(env,scope+':'+payload);
  if (sig.length!==expected.length) return null;
  let diff=0; for(let i=0;i<sig.length;i++) diff|=sig.charCodeAt(i)^expected.charCodeAt(i);
  if(diff)return null;
  let p; try {p=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));}catch{return null;}
  if(!Number.isFinite(p.e)||p.e<=Date.now()||(!platform&&p.t!==tenantId))return null;
  const user=platform ? await env.DB.prepare('SELECT * FROM platform_admins WHERE id=?').bind(p.id).first() : await env.DB.prepare('SELECT * FROM users WHERE tenant_id=? AND id=?').bind(tenantId,p.id).first();
  if(!user||user.session_version!==p.v)return null;
  return user;
}
export async function login(env, tenantId, username, secret, platform=false) {
  const user=platform ? await env.DB.prepare('SELECT * FROM platform_admins WHERE username=?').bind(username).first() : await env.DB.prepare('SELECT * FROM users WHERE tenant_id=? AND username=?').bind(tenantId,username).first();
  // Equal work for unknown usernames; never return hashes to the browser.
  const dummy='pbkdf2$100000$00000000000000000000000000000000$'+'0'.repeat(64);
  const valid=await verifySecret(secret,user?.secret||dummy);
  return valid&&user ? user : null;
}
