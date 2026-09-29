import {randomUUID,randomBytes,pbkdf2Sync,randomInt} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const [originArg,outArg,flag]=process.argv.slice(2);
if(!originArg||!outArg||flag!=='--prepare-reset')throw Error('Uso: node tools/restablecer-demo.mjs https://host directorio-privado --prepare-reset. Solo genera archivos; respaldar antes de aplicar el SQL.');
const origin=new URL(originArg).origin;if(!origin.startsWith('https://'))throw Error('Se requiere HTTPS');
const out=resolve(outArg);mkdirSync(out,{recursive:true});
const sql=[],q=x=>x===null?'NULL':typeof x==='number'?String(x):"'"+String(x).replaceAll("'","''")+"'";
const insert=(table,data)=>sql.push(`INSERT INTO ${table}(${Object.keys(data).join(',')}) VALUES(${Object.values(data).map(q).join(',')});`);
// Explicit reset of tenant data; preserve platform identities and MQTT inventory/settings.
for(const table of ['code_gates','logs','direct_operations','relay_commands','codes','user_gates','account_memberships','users','gates','tenants'])sql.push('DELETE FROM '+table+';');
sql.push('DELETE FROM accounts WHERE NOT EXISTS(SELECT 1 FROM account_platform p WHERE p.account_id=accounts.id);');
sql.push('DELETE FROM login_attempts;');
sql.push('DELETE FROM relay_observations;');
sql.push("UPDATE relay_devices SET connection_state='unknown',checked_at=NULL,sampled_at=NULL,rssi=NULL,pulse_ms=NULL;");
sql.push('DELETE FROM platform_audit_log;');
const now=Date.now(),tenantId=randomUUID();
insert('tenants',{id:tenantId,slug:'residencial-demo',name:'Residencial Aurora · DEMO',status:'active',created_at:now});
const gates=['Portón principal · demo','Estacionamiento · demo','Acceso de servicio · demo'].map(name=>({id:randomUUID(),name}));
for(const g of gates)insert('gates',{...g,tenant_id:tenantId,trigger_type:'demo',trigger_config:'{}',status:'active',created_at:now});
const users=[['demo','admin@demo.example','master',[0,1,2]],['ana.demo','ana@demo.example','user',[0,1]],['carlos.demo','carlos@demo.example','user',[0,1]],['servicio.demo','servicio@demo.example','user',[2]]].map(([username,email,role,access])=>{
 const id=randomUUID(),accountId=randomUUID(),password='Demo-'+randomBytes(12).toString('base64url'),salt=randomBytes(16),secret=`pbkdf2$100000$${salt.toString('hex')}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')}`;
 insert('users',{id,tenant_id:tenantId,username,secret,role,created_at:now});insert('accounts',{id:accountId,email,secret,created_at:now});insert('account_memberships',{account_id:accountId,user_id:id,tenant_id:tenantId});
 if(role!=='master')for(const n of access)insert('user_gates',{tenant_id:tenantId,user_id:id,gate_id:gates[n].id});
 return {id,username,email,role,password};
});
const used=new Set(),passes=[];
for(const [label,owner,access,mode,days,status] of [['Familia · acceso permanente',1,[0,1],'unlimited',0,'active'],['Visita · una ventana de 10 minutos',2,[0,1],'visit',7,'active'],['Estacionamiento · siete días',1,[1],'repeat',7,'active'],['Mantenimiento · un día',3,[2],'repeat',1,'active'],['Invitación vencida',1,[0],'repeat',-1,'expired'],['Servicio cancelado',3,[2],'repeat',7,'revoked']]){
 let code;do{code=String(randomInt(1000000)).padStart(6,'0');}while(used.has(code));used.add(code);
 insert('codes',{code,tenant_id:tenantId,gate_id:gates[access[0]].id,label,owner:users[owner].username,owner_id:users[owner].id,single_use:0,visit_mode:mode==='visit'?1:0,expires_at:days?now+days*86400000:null,created_at:now,status});
 for(const n of access)insert('code_gates',{tenant_id:tenantId,code,gate_id:gates[n].id,authorized_config:'{}'});
 passes.push({code,label,mode,status});
}
insert('platform_audit_log',{id:randomUUID(),admin_username:'maintenance',action:'reset_demo',details:JSON.stringify({reason:'Restablecimiento solicitado; cuentas por correo, códigos únicos y portones simulados',tenantId}),at:now});
writeFileSync(resolve(out,'restablecer-demo.sql'),sql.join('\n')+'\n',{flag:'wx'});
writeFileSync(resolve(out,'accesos-demo.json'),JSON.stringify({tenantId,users,passes},null,2),{flag:'wx'});
writeFileSync(resolve(out,'ACCESOS-DEMO.md'),`# Demo de PortonSmart\n\nLogin: ${origin}/login\nVisitantes: ${origin}/visit\nEnlace del edificio: ${origin}/t/residencial-demo\n\nLas aperturas son simuladas. Los correos son identificadores ficticios y no reciben mensajes. Las cuentas ya están activadas.\n\n| Rol | Correo | Contraseña |\n|---|---|---|\n${users.map(u=>`| ${u.role==='master'?'Administrador':'Residente'} | ${u.email} | ${u.password} |`).join('\n')}\n\n## Códigos de ejemplo\n\n${passes.map(p=>`- **${p.code}**: ${p.label} (${p.status}).`).join('\n')}\n\nLa visita de un solo uso permite reintentos durante diez minutos desde su primera apertura. No se inicia al consultar el código. Las cuentas de superadministración se conservan.\n`,{flag:'wx'});
console.log('SQL y accesos preparados. No se modificó la base remota.');
