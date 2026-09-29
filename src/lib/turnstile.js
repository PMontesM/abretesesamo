// Validate before any database access. Never trust a browser-only challenge.
export function challengeAction(pathname) {
  const path='/'+pathname.split('/').filter(Boolean).join('/');
  if(['/account/login','/account/link'].includes(path)||path==='/platform/login'||/^\/t\/[^/]+\/api\/login$/.test(path))return 'login';
  if(path==='/api/visitor-entry'||/^\/t\/[^/]+\/api\/(access-state|open)$/.test(path))return 'visitor';
  return null;
}
export function turnstileConfig(env) {
  return {turnstileRequired:env.TURNSTILE_REQUIRED==='true',turnstileSiteKey:env.TURNSTILE_SITE_KEY||''};
}
export async function checkTurnstile(request,env) {
  const action=request.method==='POST'&&challengeAction(new URL(request.url).pathname);
  if(!action||env.TURNSTILE_REQUIRED!=='true')return null;
  const reject=(error,status=403)=>Response.json({ok:false,error},{status});
  if(!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_SITE_KEY)return reject('La verificación de seguridad no está disponible. Intenta más tarde.',503);
  const token=request.headers.get('X-Turnstile-Token');
  if(!token||token.length>2048)return reject('Completa la verificación de seguridad e intenta de nuevo.');
  let result;
  try {
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,...(request.headers.get('cf-connecting-ip')?{remoteip:request.headers.get('cf-connecting-ip')}:{})}),
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw Error('Verification unavailable');
    result=await response.json();
  } catch {return reject('No pudimos verificar la conexión. Intenta de nuevo; no se envió ninguna orden.',503);}
  if(result.success!==true||result.hostname!==(env.PUBLIC_HOSTNAME||new URL(request.url).hostname)||result.action!==action)
    return reject('La verificación venció o no es válida. Intenta de nuevo.');
  return null;
}
