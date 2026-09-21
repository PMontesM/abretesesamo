import {superApp} from './super.js';
import Alpine from '@alpinejs/csp';
import focus from '@alpinejs/focus';
import {portonApp,adminApp} from './presentation.js';
import {api,base,config,openGate,csvDownload,infoDialog,date,outcome} from './api.js';
const merge=(target,...parts)=>{for(const p of parts)Object.defineProperties(target,Object.getOwnPropertyDescriptors(p));return target;};
const types={Visita:'fa-solid fa-user',Entrega:'fa-solid fa-motorcycle',Servicio:'fa-solid fa-broom'};
const pass=c=>({id:c.code,code:c.code,name:c.label,type:c.visit_mode||c.single_use?'Un solo uso':c.expires_at?'Con vigencia':'Permanente',icon:types[c.category]||types.Visita,access:c.access,createdAt:c.visit_started_at||c.created_at,expiresAt:c.expires_at,visit:!!c.visit_mode,single:!!c.single_use,started:c.visit_started_at,status:c.status});
const log=l=>({id:l.id,who:l.owner||'Visita',method:l.label||'Panel',icon:l.code?'fa-key':'fa-mobile-screen',dev:l.gate_id,gate:l.gate_name||'Acceso',ok:l.outcome==='sent',reason:outcome[l.outcome]||l.outcome,ago:date(l.at),at:l.at});
const common={
 dashboardUrl:base+'/admin',legacyUrl:base+'/admin?view=codes',usersUrl:base+'/admin?view=users',tenant:config.tenant,user:config.user,error:'',loading:true,busy:false,now:Date.now(),types,typeNames:Object.keys(types),
 get initials(){return this.user.username.slice(0,2).toUpperCase();},
 get noticeCount(){return this.alerts?.length||this.livePasses?.filter(p=>this.expiring(p)).length||0;},
 async run(fn){try{return await fn();}catch(e){this.error=e.message;return null;}},
 async logout(){await this.run(async()=>{await api('/admin/logout',{});location.href=base;});},
 profile(){infoDialog('Mi perfil',this.user.username+'\n'+this.tenant.name+'\n'+(this.user.role==='master'?'Administrador del edificio':'Residente')+'\nPara cambiar tu contraseña, contacta al administrador.');},
 support(){if(this.tenant.supportPhone)window.open('https://wa.me/'+this.tenant.supportPhone,'_blank','noopener');else infoDialog('Soporte','Contacta a la administración del edificio para recibir ayuda con tus accesos.');},
 notifications(){if(this.alerts?.length){document.getElementById('main-scroll').scrollTo({top:0,behavior:'smooth'});}else if(this.livePasses?.some(p=>this.expiring(p))){document.getElementById('pases').scrollIntoView();}else infoDialog('Notificaciones','No hay avisos nuevos en los datos de tu última consulta.');},
 async refresh(){if(this.busy)return;this.busy=true;await this.run(async()=>this.load(await api('/admin/panel?offset='+new Date().getTimezoneOffset())));this.busy=false;this.loading=false;},
 async init(){await this.refresh();this._clock=setInterval(()=>{this.now=Date.now();},15000);},
 destroy(){clearInterval(this._clock);for(const d of this.doors||[]){cancelAnimationFrame(d._raf);clearInterval(d._iv);}clearTimeout(this._arm);clearTimeout(this._tt);},
 hourLabel(i){return String(i).padStart(2,'0');},
 percent(p){return Math.round(this.pct(p));},
 confirmRevoke(p){this.arm('r'+p.id,()=>this.revoke(p));},
 async revoke(p){if(this.busy)return;this.busy=true;const done=await this.run(async()=>{await api('/admin/revoke-code',{code:p.code||p.id});return true;});this.busy=false;if(done){await this.refresh();this.notify('Código revocado');}},
};
function resident(){return merge(portonApp(),common,{
 get passName(){return this.form.name;},set passName(v){this.form.name=v;},get passCategory(){return this.form.type;},set passCategory(v){this.form.type=v;},get passMinutes(){return this.form.mins;},set passMinutes(v){this.form.mins=v;},get passMode(){return this.form.mode;},set passMode(v){this.form.mode=v;},get passDoors(){return this.form.doors;},set passDoors(v){this.form.doors=v;},
get confirmName(){return this.confirmTarget?.name||'';},resultCard:null,confirmTarget:null,durationDays:'1',customDays:1,activityQuery:'',activityGate:'',activityResult:'',doors:[],passes:[],activity:[],form:{name:'',type:'Visita',mins:120,mode:'visit',doors:[]},
 load(data){this.now=data.serverNow;const old=new Map(this.doors.map(d=>[d.id,d]));this.doors=data.gates.map(g=>({...g,kind:g.isDemo?'Demostración':g.hasRelay?'Relé conectado':'Acceso autorizado',icon:'fa-solid fa-door-open',online:!(g.hasRelay&&g.connection_state==='offline'&&g.connection_checked_at>this.now-120000),state:'reposo',progress:0,left:0,hint:false,...(old.has(g.id)?{state:old.get(g.id).state,progress:old.get(g.id).progress,left:old.get(g.id).left}:{}),last:data.logs.find(l=>l.gate_id===g.id&&l.outcome==='sent')?.at}));this.passes=data.passes.map(pass);this.activity=data.logs.map(l=>({gateId:l.gate_id,outcome:l.outcome,code:l.code||'',owner:l.owner||'',icon:l.code?'fa-solid fa-key':'fa-solid fa-mobile-screen',title:(outcome[l.outcome]||l.outcome)+' · '+(l.gate_name||'Acceso'),meta:l.label||l.owner||'Panel',ok:l.outcome==='sent',reason:l.outcome==='sent'?'':outcome[l.outcome],time:date(l.at)}));},
 get livePasses(){return this.passes.filter(p=>['pending','uncertain'].includes(p.status)||(p.status==='active'&&(!p.expiresAt||p.expiresAt>this.now)));},
 accessLabel(p){return p.access.map(a=>a.name).join(' y ');},
 expiring(p){return p.status==='active'&&p.expiresAt&&p.expiresAt-this.now<=600000;},
 canExtend(p){return this.expiring(p)&&!p.visit&&!p.single;},
 passStatus(p){return p.status==='pending'?'En curso':p.status==='uncertain'?'Requiere revisión':this.expiring(p)?'Vence pronto':'Activo';},
 pct(p){return p.expiresAt?Math.max(0,Math.min(100,100*(p.expiresAt-this.now)/Math.max(1,p.expiresAt-p.createdAt))):100;},
 expiryText(p){return !p.expiresAt?'Sin vencimiento':(p.visit&&!p.started?'Puede comenzar hasta ':'Vence ')+date(p.expiresAt);},
 leftText(p){if(!p.expiresAt)return 'sin límite de tiempo';const m=Math.max(0,Math.ceil((p.expiresAt-this.now)/60000));return m<60?m+' min':Math.floor(m/60)+' h '+m%60+' min';},
 statusLine(d){return d.isDemo?'Demostración · no activa hardware':d.hasRelay?(d.connection_checked_at>this.now-120000?({online:'Conectado',offline:'Desconectado',cooldown:'En pausa',opening:'Relé activado',initializing:'Iniciando'}[d.connection_state]||'Sin verificar'):'Sin verificar'):'Acceso autorizado';},
 label(d){return {sosteniendo:'Sigue presionando…',abriendo:'Enviando orden…',abierto:'Orden confirmada',error:'No se confirmó. Consulta el aviso.'}[d.state]||'Mantén presionado para abrir';},
 startHold(id){const d=this.door(id);if(!d||!d.online||!['reposo','error'].includes(d.state))return;d.state='sosteniendo';d.hint=false;const start=performance.now();const tick=()=>{if(d.state!=='sosteniendo')return;d.progress=Math.min(100,(performance.now()-start)/4);if(d.progress>=100){this.send(id);return;}d._raf=requestAnimationFrame(tick);};d._raf=requestAnimationFrame(tick);},
 async send(id){const d=this.door(id);if(d.state==='abriendo'||d.state==='abierto')return;cancelAnimationFrame(d._raf);d.state='abriendo';d.progress=100;try{const result=await openGate(id);d.state='abierto';this.live=result.message;setTimeout(()=>{d.state='reposo';d.progress=0;},6500);}catch(e){d.state='error';d.progress=0;this.error=e.message;this.live=e.message;}},
 confirmDoor(d){this.confirmTarget=d;},confirmSend(){const d=this.confirmTarget;this.confirmTarget=null;if(d)this.send(d.id);},
 openSheet(){this.durationDays='1';this.customDays=1;this.form={name:'',type:'Visita',mins:120,mode:'visit',doors:this.doors.length===1?[this.doors[0].id]:[]};this.formError='';this.sheet=true;this.$nextTick(()=>this.$refs.name?.focus());},
 closePanels(){this.drawer=false;this.sheet=false;this.resultCard=null;this.confirmTarget=null;},selectTab(tab){this.drawer=false;this.tab=tab;},
 deadlineBody(){if(this.form.mode==='unlimited')return {};if(this.form.mode==='visit')return {days:7};const days=this.durationDays==='custom'?Number(this.customDays):Number(this.durationDays);if(!Number.isInteger(days)||days<1||days>30)throw Error('Elige de 1 a 30 días');return {days};},
 get visibleActivity(){const q=this.activityQuery.trim().toLowerCase();return this.activity.filter(a=>(this.filter!=='rechazados'||!a.ok)&&(!this.activityGate||a.gateId===this.activityGate)&&(!this.activityResult||a.outcome===this.activityResult)&&(!q||(a.title+' '+a.meta+' '+a.code+' '+a.owner).toLowerCase().includes(q)));},
 exportActivity(){csvDownload([['Actividad','Referencia','Código','Usuario','Resultado','Fecha'],...this.visibleActivity.map(a=>[a.title,a.meta,a.code,a.owner,outcome[a.outcome]||a.outcome,a.time])]);},
 async createPass(){if(this.busy)return;this.formError='';this.busy=true;try{const created=await api('/admin/passes',{label:this.form.name,category:this.form.type,mode:this.form.mode,gateIds:this.form.doors,...this.deadlineBody()});this.sheet=false;this.busy=false;await this.refresh();this.resultCard=this.passes.find(p=>p.code===created.code)||null;}catch(e){this.formError=e.message;this.busy=false;}},
 async extend(p){if(this.busy)return;this.busy=true;const ok=await this.run(async()=>{await api('/admin/passes/extend',{code:p.code,expiresAt:p.expiresAt});return true;});this.busy=false;if(ok){await this.refresh();this.notify('Vigencia extendida 30 minutos');}},
 text(p){return 'Acceso '+p.type.toLowerCase()+' a '+this.tenant.name+'\nPara: '+p.name+'\nAccesos: '+this.accessLabel(p)+'\nCódigo: '+p.code+'\n'+this.expiryText(p)+(p.visit?'\nAl abrir por primera vez tendrás 10 minutos para volver a abrir.':'')+'\n'+location.origin+base+'?code='+encodeURIComponent(p.code);},
 async copy(p){await this.run(async()=>{await navigator.clipboard.writeText(p.code);this.notify('Código copiado');});},
 share(p){window.open('https://wa.me/?text='+encodeURIComponent(this.text(p)),'_blank','noopener');},
});}
function admin(){return merge(adminApp(),common,{
 openSettings(){this.settingsOpen=true;this.drawer=false;},selectResult(value){this.result=value;this.limit=6;},
 settingsOpen:false,supportPhone:config.tenant?.supportPhone||'',settingsMessage:'',
 async saveSettings(){if(this.busy)return;this.busy=true;this.settingsMessage='';await this.run(async()=>{const d=await api('/admin/support',{phone:this.supportPhone});this.supportPhone=d.phone;this.tenant.supportPhone=d.phone;this.settingsMessage='Contacto de ayuda guardado';});this.busy=false;},
 legacyUrl:base+'/admin?view=passes',activeCodes:0,attemptsRejected:0,lastSent:null,alerts:[],dismissed:[],
 get delta(){return this.totalAyer?Math.round((this.totalHoy/this.totalAyer-1)*100):0;},
 get rejectedPct(){return this.totalHoy+this.attemptsRejected?Math.round(100*this.attemptsRejected/(this.totalHoy+this.attemptsRejected)):0;},
 get online(){return this.devices.filter(d=>d.checked>this.now-120000&&d.connection==='online').length;},
 get chartTicks(){return Array.from({length:5},(_,i)=>Math.round(i*this.chartMax/4));},
 get lastText(){if(!this.lastSent)return 'Sin datos';const m=Math.floor((this.now-this.lastSent)/60000);return m<60?m+' min':m<1440?Math.floor(m/60)+' h':Math.floor(m/1440)+' días';},
 load(data){this.now=data.serverNow;this.activeCodes=data.summary.activeCodes;this.attemptsRejected=data.summary.rejected||0;this.lastSent=data.summary.lastSent;this.hoy=Array(24).fill(0);this.ayer=Array(24).fill(0);for(const h of data.hours)(h.day==='today'?this.hoy:this.ayer)[h.hour]=h.count;this.chartMax=Math.max(4,...this.hoy,...this.ayer);this.log=data.logs.map(log);this.expiring=data.passes.filter(p=>p.status==='active'&&p.expires_at&&p.expires_at<data.summary.midnight+86400000).map(c=>({...pass(c),unit:c.owner,kind:c.category,left:Math.max(1,Math.ceil((c.expires_at-this.now)/60000))+' min'}));
  this.devices=data.gates.map(g=>{const samples=data.observations.filter(o=>o.gate_id===g.id),latest=samples.at(-1),hour=Math.floor(this.now/3600000)*3600000;return {id:g.id,deviceId:g.deviceId||g.name,place:g.name,model:g.isDemo?'Demo':g.hasRelay?'MQTT':'Integración HTTPS',hasRelay:g.hasRelay,connection:g.connection_state,checked:g.connection_checked_at,rssi:latest?.rssi??null,uptime:latest?.uptime_s!=null?Math.floor(latest.uptime_s/3600)+' h '+Math.floor(latest.uptime_s/60)%60+' min':'sin datos',testing:false,cells:Array.from({length:24},(_,i)=>{const o=samples.find(s=>s.hour===hour-(23-i)*3600000);return !o?'unknown':o.state==='offline'?'down':['online','opening','cooldown'].includes(o.state)?(o.rssi!=null&&o.rssi<=-75?'weak':'ok'):'unknown';})};});
  this.alerts=this.devices.filter(d=>d.checked>this.now-120000&&(d.connection==='offline'||this.weak(d))).map(d=>({id:d.id+':'+d.checked,device:d.id,title:d.connection==='offline'?'Dispositivo desconectado':'Señal Wi-Fi débil',body:d.place+' · '+(d.rssi===null?'Sin medición':d.rssi+' dBm')+' · última consulta '+date(d.checked)})).filter(a=>!this.dismissed.includes(a.id));},
 dismiss(id){this.dismissed.push(id);this.alerts=this.alerts.filter(a=>a.id!==id);},
 weak(d){return d.rssi!==null&&d.rssi<=-75;},
 bars(rssi){return rssi===null?0:rssi>=-60?4:rssi>=-70?3:rssi>=-80?2:1;},
 quality(rssi){return rssi===null?'Sin medición':rssi>=-60?'Excelente':rssi>=-70?'Buena':rssi>=-80?'Débil':'Muy débil';},
 stateClass(d){return !d.hasRelay||d.checked<=this.now-120000?'bg-gray-100 text-gray-600':d.connection==='offline'?'bg-red-100 text-red-700':this.weak(d)?'bg-amber-100 text-amber-700':'bg-green-100 text-green-700';},
 stateLabel(d){return d.hasRelay?(d.checked>this.now-120000?({online:this.weak(d)?'Señal débil':'En línea',offline:'Desconectado',opening:'Relé activado',cooldown:'En pausa',initializing:'Iniciando'}[d.connection]||'Sin verificar'):'Sin verificar'):d.model;},
 cellClass(s){return {ok:'bg-emerald-500',weak:'bg-amber-400',down:'bg-red-500',unknown:'bg-gray-200'}[s];},
 cellText(d,i){return 'Hace '+(23-i)+' h: '+({ok:'observado en línea',weak:'señal débil observada',down:'observado desconectado',unknown:'sin observación'}[d.cells[i]]);},
 confirmOpen(d){this.arm('t'+d.id,()=>this.testOpen(d));},
 confirmRevoke(p){this.arm('v'+p.id,()=>this.revoke(p));},
 async testOpen(d){if(d.testing)return;d.testing=true;await this.run(async()=>{const r=await openGate(d.id);this.notify(r.message+'. Comprueba el portón.');});d.testing=false;},
 async check(d){if(d.testing)return;d.testing=true;await this.run(()=>api('/admin/connection',{gateId:d.id}));d.testing=false;await this.refresh();},
 exportCsv(){csvDownload([['Usuario','Referencia','Portón','Resultado','Fecha'],...this.filtered.map(r=>[r.who,r.method,r.gate,r.ok?'Orden enviada':r.reason,r.ago])]);},
});}
Alpine.plugin(focus);Alpine.data('superadmin',superApp);Alpine.data('resident',resident);Alpine.data('admin',admin);window.Alpine=Alpine;Alpine.start();
