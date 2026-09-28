import {InputError} from './security.js';
const encoder=new TextEncoder(),decoder=new TextDecoder();
export const maskCode=code=>/^\d{6}$/.test(String(code))?code.slice(0,2)+'••'+code.slice(-2):code;
const principal=user=>user?.tenant_id?'user:'+user.id:'platform:'+user?.id;
async function key(env){if(!env.ADMIN_SIGNING_SECRET)throw Error('Missing signing secret');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode('code-management:'+env.ADMIN_SIGNING_SECRET)),'AES-GCM',false,['encrypt','decrypt']);}
async function reference(env,tenant,code,user){const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),encoder.encode(JSON.stringify({tenant,code,principal:principal(user)}))));return btoa(String.fromCharCode(...iv,...encrypted));}
export async function protectCodes(env,value,user,tenant){
 if(Array.isArray(value))return Promise.all(value.map(v=>protectCodes(env,v,user,tenant)));
 if(!value||typeof value!=='object')return value;
 const out={...value},scope=value.tenant_id||value.tenantId||tenant;
 for(const [k,v] of Object.entries(out)){
  if(['creation_token','claim_token'].includes(k)){delete out[k];continue;}
  if(k==='details'&&typeof v==='string'){try{out[k]=JSON.stringify(await protectCodes(env,JSON.parse(v),user,scope));}catch{out[k]='Detalle no disponible';}continue;}
  if(v&&typeof v==='object')out[k]=await protectCodes(env,v,user,scope);
 }
 if(typeof value.code==='string'&&/^\d{6}$/.test(value.code)&&!(user?.tenant_id&&value.owner_id===user.id)){
  out.code=maskCode(value.code);out.codeMasked=true;
  if(scope)out.codeRef=await reference(env,scope,value.code,user);
 }
 return out;
}
export async function resolveCodeBody(env,body,user,tenant){
 if(body.codeRef){try{if(typeof body.codeRef!=='string'||body.codeRef.length>1024)throw Error();const bytes=Uint8Array.from(atob(body.codeRef),c=>c.charCodeAt(0));const data=JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await key(env),bytes.slice(12))));if(data.tenant!==tenant||data.principal!==principal(user)||!/^\d{6}$/.test(data.code))throw Error();return {...body,code:data.code};}catch{throw new InputError('Referencia de código inválida. Actualiza la lista.');}}
 if(!user?.tenant_id||!await env.DB.prepare('SELECT 1 FROM codes WHERE tenant_id=? AND code=? AND owner_id=?').bind(tenant,body.code||'',user.id).first())throw new InputError('Selecciona el código desde la lista actualizada.');
 return body;
}
