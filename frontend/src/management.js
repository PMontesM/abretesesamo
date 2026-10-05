// Shared browser UI. All database content uses textContent; each action captures its own building ID.
export function mountManagement(root,config,options={}){
  const $=id=>document.getElementById(id),view=root,nav=null,notice=document.createElement('div');
  const platform=config.mode==='platform',base=platform?'/platform':'/t/'+(config.tenant?.slug||'');
  let revision=0;const codeFilters=new Map();
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  function feedback(target,text,error=false){target.textContent=text;target.className='message '+(error?'error':'success');target.setAttribute('role',error?'alert':'status');if(text){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'instant'});}}
  const message=(text,error=false)=>feedback(notice,text,error);
  function openingResult(target,text){target.replaceChildren();const badge=target.closest('section')?.querySelector('.gate-badge');if(badge){badge.classList.remove('gate-opening');void badge.offsetWidth;badge.classList.add('gate-opening');}target.append(el('strong',text),el('p','La orden se envió correctamente. Comprueba que el portón se abra.'));target.className='message success opening-result';target.setAttribute('role','status');target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'instant'});}
  const date=value=>value?new Date(value).toLocaleString():'Sin vencimiento';
  const states={active:'Activo',inactive:'Inactivo',suspended:'Suspendido',revoked:'Revocado',expired:'Vencido',pending:'En curso / revisión',uncertain:'Requiere revisión',used:'Utilizado',sent:'Orden enviada',not_sent:'No enviada',closed:'Revisión cerrada'};
  const status=c=>c.status==='active'&&c.expires_at&&c.expires_at<=Date.now()?'Vencido':(states[c.status]||c.status);
  async function api(path,body){
    let r;try{r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw Error('Sin conexión. Actualiza los datos antes de repetir una operación.');}
    let data;try{data=await r.json();}catch{throw Error(r.status===429?'Demasiadas solicitudes. Espera un momento antes de intentar de nuevo.':'Respuesta inesperada del servidor');}
    if(!r.ok||!data.ok){if(r.status===401)location.href='/login';const error=Error(data.error||'No se pudo completar la operación');error.operationClosed=data.operationClosed;throw error;}
    return data;
  }
  function ask(text){return new Promise(resolve=>{const d=dialog('Confirmar cambio',f=>{f.append(el('p',text));},async()=>resolve(true),'Confirmar');d.addEventListener('close',()=>resolve(false),{once:true});});}
  const iconPaths={settings:'M4 7h16M4 17h16M8 4v6M16 14v6',gate:'M3 21V4h18v17M3 7h18M7 7v14M12 7v14M17 7v14M2 21h20',codes:'M4 4h16v16H4zM8 8h8M8 12h5M8 16h7',history:'M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0',building:'M4 21V3h12v18M16 10h4v11M8 7h4M8 11h4M8 15h4M2 21h20',chart:'M4 20V4M4 20h17M9 16v-5M14 16V7M19 16v-8',logout:'M9 21H4V3h5M14 8l5 4-5 4M8 12h11',plus:'M12 5v14M5 12h14',refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3'};
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[name]||iconPaths.gate);svg.append(path);return svg;}
  function gateBadge(){const d=el('div',undefined,'gate-badge'),svg=icon('gate');svg.replaceChildren();for(const [cls,path] of [['gate-frame','M2 21V3h20v18'],['gate-left','M4 6h8v14H4zM8 6v14'],['gate-right','M12 6h8v14h-8zM16 6v14']]){const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('class',cls);p.setAttribute('d',path);svg.append(p);}d.append(svg);return d;}
  function markNav(name){for(const b of document.querySelectorAll('#nav button,.mobile-tabs button')){const active=b.dataset.label===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}if($('view-label'))$('view-label').textContent=name;}
  function stat(value,label,symbol,role=false){const d=el('div',undefined,'stat-card'),badge=el('div',undefined,'stat-icon'),text=el('div');badge.append(icon(symbol));text.append(el('div',value,'stat-value'+(role?' role':'')),el('div',label,'stat-label'));d.append(badge,text);return d;}
  function heading(title,subtitle){const d=el('div',undefined,'view-heading');d.append(el('h2',title),el('p',subtitle));return d;}
  function button(text,action,cls=''){
    const b=el('button',text,cls);b.type='button';b.dataset.label=text;const symbols={'Inicio':'chart','Abrir portón':'gate','Portones':'gate','Códigos':'codes','Historial':'history','Usuarios':'users','Edificios':'building','Configuración':'settings','Reportes':'chart','Auditoría':'history','Cerrar sesión':'logout','Crear código':'plus','Crear edificio':'plus','Agregar usuario':'plus','Agregar portón':'plus','Actualizar':'refresh'};if(symbols[text])b.prepend(icon(symbols[text]));
    b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;try{await action();}catch(e){message(e.message,true);}finally{b.disabled=false;}});return b;
  }
  function section(title){const s=el('section');s.append(el('h2',title));return s;}
  function table(parent,headers,rows){const grid=el('div',undefined,'management-grid');if(!rows.length)grid.append(el('p','No hay registros.','empty-state'));for(const values of rows){const card=el('article',undefined,'management-card');values.forEach((v,i)=>{const field=el('div',undefined,'management-value');field.append(el('span',headers[i],'management-label'));field.append(v instanceof Node?v:el('p',String(v??'—')));card.append(field);});grid.append(card);}parent.append(grid);}
  function actions(...buttons){const d=el('div',undefined,'actions');d.append(...buttons);return d;}
  function filterLayout(form){form.classList.add('filter-form');for(const label of [...form.querySelectorAll(':scope > label')]){const field=el('div',undefined,'field'),control=label.nextElementSibling;label.before(field);field.append(label,control);}}
  function input(form,label,type='text',value='',required=true){const id='f-'+crypto.randomUUID(),l=el('label',label);l.htmlFor=id;const n=el('input');n.id=id;n.type=type;n.value=value;n.required=required;if(type==='password'){n.autocomplete='new-password';n.minLength=8;n.maxLength=128;}else n.maxLength=2048;form.append(l,n);if(type==='password'){const toggle=button('Mostrar contraseña',()=>{const show=n.type==='password';n.type=show?'text':'password';toggle.textContent=show?'Ocultar contraseña':'Mostrar contraseña';toggle.setAttribute('aria-pressed',String(show));},'secondary password-toggle');toggle.setAttribute('aria-pressed','false');form.append(toggle);}return n;}
  function select(form,label,options,value=''){const id='f-'+crypto.randomUUID(),l=el('label',label);l.htmlFor=id;const n=el('select');n.id=id;n.required=true;options.forEach(([v,name])=>{const o=el('option',name);o.value=v;n.append(o);});n.value=value;form.append(l,n);return n;}
  function gateChecks(form,gates,selected=[]){const field=el('fieldset');field.append(el('legend','Portones autorizados'));const checks=[];gates.filter(g=>g.status==='active').forEach(g=>{const label=el('label'),c=el('input');c.type='checkbox';c.value=g.id;c.checked=selected.includes(g.id);label.append(c,document.createTextNode(g.name));field.append(label);checks.push(c);});if(!checks.length)field.append(el('p','No hay portones activos. El usuario quedará sin acceso.'));form.append(field);return ()=>checks.filter(c=>c.checked).map(c=>c.value);}
  function dialog(title,build,submit,label='Guardar'){
    const d=el('dialog'),form=el('form'),error=el('div',undefined,'message error');d.setAttribute('aria-label',title);error.setAttribute('role','alert');form.append(el('h2',title));const fields=build(form);const save=el('button',label);save.type='submit';form.append(error,actions(button('Cancelar',()=>d.close(),'secondary'),save));d.className='management-dialog';d.append(form);document.body.append(d);
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;error.textContent='';try{await submit(fields);d.close();}catch(e){error.textContent=e.message;}finally{save.disabled=false;}});
    d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();return d;
  }
  async function screen(loader){const rev=++revision;view.replaceChildren(el('p','Cargando…'));message('');try{const result=await loader();if(rev===revision)view.replaceChildren(result);}catch(e){if(rev===revision){view.replaceChildren();message(e.message,true);}}}
  function codeResult(c,tenant){const text=`Edificio: ${tenant.name}\nPortón: ${c.gate_name}\nCódigo: ${c.code}\nPara: ${c.label}\n${c.visit_mode&&!c.visit_started_at?'Puede comenzar hasta':'Vigencia'}: ${date(c.expires_at)}\nTipo: ${c.visit_mode?'Una visita · 10 minutos':c.single_use?'Un solo uso':!c.expires_at?'Sin vencimiento':'Reutilizable'}\n${location.origin}/t/${tenant.slug}/?code=${encodeURIComponent(c.code)}`;
    const d=el('dialog');d.className='code-result';d.append(el('h2','Compartir acceso'),el('p',tenant.name+' · '+c.gate_name,'muted'),el('code',c.code,'result-number'),el('p',text,'result-details'));const link=el('a','Compartir por WhatsApp','button');link.href='https://wa.me/?text='+encodeURIComponent(text);link.target='_blank';link.rel='noopener noreferrer';d.append(actions(button('Copiar',async()=>{await navigator.clipboard.writeText(text);message('Acceso copiado');}),link,button('Cerrar',()=>d.close(),'secondary')));d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();
  }
  async function codeTable(parent,tenant,platformView=false){
    const path=platformView?'/platform/api/codes?tenantId='+encodeURIComponent(tenant.id):base+'/admin/codes';
    const outer=parent,key=(platformView?'platform:':'tenant:')+tenant.id;let filters=codeFilters.get(key)||{page:0,search:'',status:'current'};codeFilters.set(key,filters);
    let content=outer.querySelector('[data-code-list]');if(!content){content=el('div');content.dataset.codeList='true';outer.append(content);}parent=content;parent.replaceChildren();
    const form=el('form'),search=input(form,'Buscar código exacto','text',filters.search,false),state=select(form,'Estado del código',[['current','Vigentes y por revisar'],['','Todos, incluidos anteriores'],['active','Activo'],['pending','En curso'],['uncertain','Requiere revisión'],['revoked','Revocado'],['used','Utilizado'],['expired','Vencido']],filters.status);search.maxLength=64;state.required=false;
    const apply=el('button','Buscar');apply.type='submit';form.append(apply);form.addEventListener('submit',async e=>{e.preventDefault();filters.page=0;filters.search=search.value.trim();filters.status=filters.search&&state.value==='current'?'':state.value;apply.disabled=true;try{await codeTable(outer,tenant,platformView);}catch(e){message(e.message,true);}finally{apply.disabled=false;}});filterLayout(form);parent.append(form);
    const data=await api(path+(path.includes('?')?'&':'?')+new URLSearchParams(filters));parent.append(el('p','Página '+(filters.page+1)+' · hasta 100 códigos. Usa la búsqueda para encontrar cualquier código anterior.','muted'));
    if(!platformView&&config.user.role!=='master')passCards(parent,data.codes,tenant);else {parent.classList.add('access-cards');table(parent,['Código','Nota','Portón','Creado por','Tipo','Vencimiento','Estado','Acciones'],data.codes.map(c=>{
      const buttons=[];
      if(['pending','uncertain'].includes(c.status))buttons.push(button('Revocar',async()=>{if(!await ask('¿Revocar futuras aperturas? Una orden ya enviada no puede cancelarse.'))return;await api(platformView?'/platform/api/codes/revoke':base+'/admin/revoke-code',{tenantId:tenant.id,code:c.code,codeRef:c.codeRef});await codeTable(outer,tenant,platformView);},'danger'));
      if(status(c)==='Activo'){
        if(!c.codeMasked)buttons.push(button('Compartir',()=>codeResult(c,tenant),'secondary'));
        buttons.push(button('Revocar',async()=>{if(!await ask('¿Revocar este código?'))return;await api(platformView?'/platform/api/codes/revoke':base+'/admin/revoke-code',{tenantId:tenant.id,code:c.code,codeRef:c.codeRef});await (platformView?building(tenant):codes());},'danger'));
      }
      if(platformView&&['pending','uncertain'].includes(c.status)){
        buttons.push(button('Resolver',()=>dialog('Revisar apertura de '+c.gate_name,f=>{f.append(el('p','Comprueba físicamente si la orden se ejecutó. Permitir otro intento puede causar una segunda apertura. Una solicitud reciente no se puede liberar hasta pasados dos minutos.'));return select(f,'Resultado',[['used','Cerrar el código sin permitir otro intento'],['retry','Permitir otro intento']],'used');},async choice=>{await api('/platform/api/codes/resolve',{tenantId:tenant.id,code:c.code,codeRef:c.codeRef,action:choice.value});await building(tenant);})));
      }
      return [el('code',c.code),c.label,c.gate_name||'Portón no disponible',c.owner,c.visit_mode?'Una visita · 10 minutos':c.single_use?'Un uso':!c.expires_at?'Sin vencimiento':'Reutilizable',date(c.expires_at),status(c),actions(...buttons)];
    }));}
    const prev=button('Página anterior',async()=>{filters.page--;await codeTable(outer,tenant,platformView);},'secondary'),next=button('Página siguiente',async()=>{filters.page++;await codeTable(outer,tenant,platformView);},'secondary');prev.disabled=filters.page===0;next.disabled=data.codes.length<100;parent.append(actions(prev,next));
  }
  function welcomeUser(tenant,phone,password,gates){const text='¡Bienvenido a '+tenant.name+'!\nEntra en '+location.origin+'/login\nTeléfono: '+phone+(password?'\nContraseña inicial para cuenta nueva: '+password:'')+'\nPuedes abrir tus accesos, crear códigos para visitantes y consultar tu historial. Si ya tienes una cuenta, conserva su contraseña y selecciona este edificio.';dialog('Compartir acceso',f=>{f.append(el('p',text,'whitespace-pre-wrap'));const link=el('a','Compartir por WhatsApp','button');link.href='https://wa.me/?text='+encodeURIComponent(text);link.target='_blank';link.rel='noopener noreferrer';f.append(link);},async()=>{},'Cerrar');}
  async function userPanel(tenant,platformView=false){
    const s=section('Usuarios de '+tenant.name),suffix=platformView?'?tenantId='+encodeURIComponent(tenant.id):'';
    const [{users},{gates}]=await Promise.all([api(platformView?'/platform/api/users'+suffix:base+'/admin/users'),api(platformView?'/platform/api/gates'+suffix:base+'/admin/gates')]);
    const refresh=()=>platformView?building(tenant):usersView();
    const search=input(s,'Buscar usuario','search','',false);search.placeholder='Escribe el nombre de usuario';search.addEventListener('input',()=>{for(const row of s.querySelectorAll('.management-card'))row.hidden=!row.firstElementChild.textContent.toLowerCase().includes(search.value.trim().toLowerCase());});s.append(button('Agregar usuario',()=>dialog('Nuevo usuario',f=>({name:input(f,'Nombre del usuario'),phone:input(f,'Teléfono (con código de país)','tel'),secret:input(f,'Contraseña (mínimo 8 caracteres)','password'),permissions:gateChecks(f,gates)}),async a=>{await api(platformView?'/platform/api/users':base+'/admin/create-user',{tenantId:tenant.id,username:a.name.value,phone:a.phone.value,secret:a.secret.value,gateIds:a.permissions()});await refresh();welcomeUser(tenant,a.phone.value,a.secret.value,gates.filter(g=>a.permissions().includes(g.id)));})));
    table(s,['Usuario','Rol','Portones autorizados','Acciones'],users.map(u=>{
      const buttons=[button('Compartir',()=>welcomeUser(tenant,u.phone||u.username,null,gates.filter(g=>g.status==='active'&&(u.role==='master'||u.gateIds.includes(g.id)))),'secondary'),...(!u.phone&&!u.email?[button('Cambiar contraseña',()=>dialog('Contraseña de '+u.username,f=>input(f,'Nueva contraseña','password'),async secret=>{await api(platformView?'/platform/api/reset-secret':base+'/admin/users/reset',{tenantId:tenant.id,userId:u.id,secret:secret.value});message('Contraseña actualizada y sesiones anteriores invalidadas.');}))]:[])];
      if(u.role!=='master'){
        buttons.push(button('Permisos',()=>dialog('Permisos de '+u.username,f=>{f.append(el('p','Quitar un permiso revoca sus códigos activos de ese portón.'));return gateChecks(f,gates,u.gateIds);},async getIds=>{await api(platformView?'/platform/api/users/permissions':base+'/admin/users/permissions',{tenantId:tenant.id,userId:u.id,gateIds:getIds()});await refresh();}),'secondary'));
        buttons.push(button('Eliminar',async()=>{if(!await ask('¿Eliminar usuario y revocar sus códigos activos? Sus sesiones dejarán de funcionar.'))return;await api(platformView?'/platform/api/users/delete':base+'/admin/delete-user',{tenantId:tenant.id,userId:u.id});await refresh();},'danger'));
      }
      return [u.username,u.role==='master'?'Administrador':'Usuario',u.role==='master'?'Todos los portones activos':gates.filter(g=>u.gateIds.includes(g.id)).map(g=>g.name+(g.status!=='active'?' (inactivo)':'')).join(', ')||'Sin acceso',actions(...buttons)];
    }));return s;
  }
  function supportDialog(tenant,platformView){dialog('Contacto de ayuda',f=>{f.append(el('p','Este número aparecerá para residentes y visitantes. Incluye el código de país. Déjalo vacío para retirarlo.'));return input(f,'Teléfono de WhatsApp','tel',tenant.support_phone||tenant.supportPhone||'',false);},async phone=>{const d=await api(platformView?'/platform/api/support':base+'/admin/support',{tenantId:tenant.id,phone:phone.value});tenant.supportPhone=tenant.support_phone=d.phone;message('Contacto de ayuda guardado.');});}
  function helpButton(){return button('Necesito ayuda',()=>{const d=dialog('Ayuda para entrar',f=>{f.append(el('p','Si tu acceso venció o fue cancelado, pide uno nuevo a quien te invitó.'),el('p','Si no se confirmó el envío, no repitas la apertura. Contacta al administrador para revisar lo ocurrido.'));if(config.tenant?.supportPhone){const link=el('a','Contactar por WhatsApp','button');link.href='https://wa.me/'+config.tenant.supportPhone+'?text='+encodeURIComponent('Hola, necesito ayuda para entrar a '+config.tenant.name+'.');link.target='_blank';link.rel='noopener noreferrer';f.append(link);}else f.append(el('p','Contacta a quien te invitó o a la administración del edificio.'));},async()=>{},'Entendido');},'secondary');}
  const connectionNames={online:'Conectado',offline:'Desconectado',initializing:'Iniciando',opening:'Relé activado',cooldown:'Pausa entre órdenes',unknown:'Sin verificar'};
  function connectionBadge(state,checked){
    const badge=el('span',undefined,'status-pill');
    const paint=()=>{const current=checked&&checked>Date.now()-120000?state:'unknown';badge.textContent=connectionNames[current]||'Sin verificar';badge.className='status-pill '+(current==='online'?'good':current==='offline'?'bad':current==='unknown'?'':'warn');};paint();
    if(checked&&checked>Date.now()-120000)setTimeout(()=>{if(badge.isConnected)paint();},Math.max(1,checked+120001-Date.now()));return badge;
  }
  function relaySelect(form,devices,current=''){
    const available=devices.filter(d=>!d.gate_id||d.device_id===current);
    const field=select(form,'Relé del inventario',[['',available.length?'Selecciona un relé':'No hay relés disponibles'],...available.map(d=>[d.device_id,d.name+' · '+d.device_id])],current);
    form.append(el('p','Registra o busca los dispositivos en Configuración. Un relé solo puede asignarse a un portón.','muted'));return field;
  }
  async function gateDialog(tenant,gate=null){
    const cfg=gate?JSON.parse(gate.trigger_config):{}, {devices}=await api('/platform/api/relay-inventory');
    dialog(gate?'Editar '+gate.name:'Nuevo portón',f=>{
      f.append(el('p','Cambiar la integración o deshabilitar el portón revoca sus códigos.','muted'));
      const name=input(f,'Nombre','text',gate?.name||''),type=select(f,'Cómo se controla',[['mqtt','Relé conectado (MQTT)'],['webhook','Enlace de activación HTTPS'],['demo','Demostración sin hardware']],gate?.trigger_type||'mqtt');
      const mqtt=el('div'),webhook=el('div'),device=relaySelect(mqtt,devices,cfg.deviceId||'');
      const url=input(webhook,'URL de activación HTTPS','url',cfg.url||''),method=select(webhook,'Método',[['GET','GET'],['POST','POST']],cfg.method||'GET');f.append(mqtt,webhook);
      const refresh=()=>{mqtt.hidden=type.value!=='mqtt';webhook.hidden=type.value!=='webhook';device.disabled=mqtt.hidden;url.disabled=method.disabled=webhook.hidden;};type.addEventListener('change',refresh);refresh();
      return {name,type,device,url,method,status:select(f,'Acceso',[['active','Habilitado'],['inactive','Deshabilitado']],gate?.status||'active')};
    },async a=>{await api('/platform/api/gates',{tenantId:tenant.id,gateId:gate?.id,name:a.name.value,triggerType:a.type.value,deviceId:a.device.value,triggerUrl:a.url.value,method:a.method.value,status:a.status.value});await building(tenant);});
  }
  function showConnection(c,name){
    dialog('Conexión de '+name,f=>{
      if(c.lock)f.append(el('p',c.lock==='cooldown'?'Espera unos segundos entre órdenes.':'Hay una orden pendiente de confirmación o revisión para este relé.'));
      f.append(el('p',c.ready?'Dispositivo conectado y listo para recibir una orden.':'El dispositivo no está listo para recibir órdenes.'),connectionBadge(c.connectionState,c.observedAt),
        el('p','Relé: '+c.deviceId),el('p','Consulta: '+date(c.observedAt)),el('p','Último reporte de salud: '+(c.health?.sampled_at?date(c.health.sampled_at*1000):'No disponible')),
        el('p','Disponibilidad MQTT: '+(c.availability??'No informada')),el('p','Último motivo de reinicio reportado: '+(c.health?.reset_reason||'No disponible')),el('p','Firmware: '+(c.health?.firmware_revision||'No informado')),el('p','Tiempo encendido al último reporte: '+(Number.isFinite(c.health?.uptime_s)?c.health.uptime_s+' segundos':'No disponible')),el('p','Pulso configurado: '+(c.info?.pulse_ms??'—')+' ms'),el('p','Señal WiFi: '+(c.health?.rssi??'—')+' dBm'),el('p','Esta consulta no acciona el relé. La conexión no indica si el portón está abierto o cerrado.','muted'));
    },async()=>{},'Cerrar');
  }
  async function connection(tenant,gate){
    let result;try{result=await api('/platform/api/gates/connection',{tenantId:tenant.id,gateId:gate.id});}finally{await building(tenant);}
    showConnection(result.connection,gate.name);
  }
  async function inventoryConnection(device){
    let result;try{result=await api('/platform/api/relay-inventory/connection',{deviceId:device.device_id});}finally{await configuration();}
    showConnection(result.connection,device.name);
  }
  function registerDevice(device=null){dialog(device?'Nombre del relé':'Registrar relé',f=>{
    f.append(el('p','El identificador debe coincidir con el configurado en el dispositivo. Puedes registrarlo aunque esté desconectado.'));
    const name=input(f,'Nombre del relé','text',device?.name||''),id=input(f,'Identificador del relé','text',device?.device_id||'');id.disabled=Boolean(device);return {name,id};
  },async a=>{await api('/platform/api/relay-inventory',{name:a.name.value,deviceId:a.id.value});await configuration();});}
  async function configuration(){markNav('Configuración');await screen(async()=>{
    const [{settings},{devices}]=await Promise.all([api('/platform/api/relay-settings'),api('/platform/api/relay-inventory')]);
    const container=el('div');container.append(heading('Configuración','Conexión MQTT e inventario de dispositivos de la plataforma.'));
    const server=section('Servidor MQTT');server.append(el('p',settings.broker+':'+settings.port+settings.path,'mqtt-endpoint'),el('p',settings.configured?'Cuentas centrales guardadas.':'Falta configurar las cuentas centrales.'),button('Editar conexión MQTT',relaySettings,'secondary'));container.append(server);
    const inventory=section('Inventario de relés');inventory.append(el('p','Busca dispositivos que hayan publicado su estado o regístralos manualmente. Después podrás asignarlos a un edificio.','muted'),
      actions(button('Buscar relés',async()=>{const d=await api('/platform/api/relay-inventory/discover',{});await configuration();message(d.found+' relés encontrados.'+(d.truncated?' Se alcanzó el límite de la consulta; puedes registrar los demás manualmente.':''));}),button('Registrar relé',()=>registerDevice(),'secondary'),button('Actualizar lista',configuration,'secondary')),
      el('p','La conexión muestra la última consulta y pasa a Sin verificar después de dos minutos. Actualizar lista no consulta el servidor MQTT; usa Buscar relés o Comprobar conexión.','muted'));
    inventory.classList.add('access-cards');table(inventory,['Relé','Identificador','Asignado a','Conexión','Última consulta','Acciones'],devices.map(d=>[d.name,d.device_id,d.gate_id?d.tenant_name+' · '+d.gate_name:'Disponible para asignar',connectionBadge(d.connection_state,d.checked_at),d.checked_at?date(d.checked_at):'Sin consultar',actions(button('Comprobar conexión',()=>inventoryConnection(d),'secondary'),button('Editar nombre',()=>registerDevice(d),'secondary'))]));container.append(inventory);return container;
  });}
  async function relaySettings(){
    const {settings}=await api('/platform/api/relay-settings');
    dialog('Conexión MQTT',f=>{
      f.append(el('p','Configura el servidor y las dos cuentas centrales que usará la plataforma.'),el('p',settings.configured?'Deja las contraseñas vacías para conservarlas.':'Escribe las credenciales de ambas cuentas.'));
      const broker=input(f,'Servidor MQTT','text',settings.broker),port=input(f,'Puerto WebSocket seguro','number',settings.port),path=input(f,'Ruta WebSocket','text',settings.path);port.min=1;port.max=65535;port.step=1;
      f.append(el('p','Usa el puerto WebSocket con TLS de tu proveedor; puede ser distinto del puerto TCP configurado en el relé. Cambiar el servidor aquí no reconfigura los dispositivos.','muted'),el('h3','Cuenta para enviar órdenes'));
      const commandUsername=input(f,'Usuario de envío','text',settings.commandUsername),commandPassword=input(f,'Contraseña de envío','password','',!settings.configured);commandPassword.minLength=1;commandPassword.maxLength=1024;
      f.append(el('h3','Cuenta para consultar dispositivos'));
      const statusUsername=input(f,'Usuario de consulta','text',settings.statusUsername),statusPassword=input(f,'Contraseña de consulta','password','',!settings.configured);statusPassword.minLength=1;statusPassword.maxLength=1024;
      f.append(el('p','Las contraseñas se guardan cifradas. La consulta necesita acceso a gate/+/# para encontrar los relés.','muted'));
      const currentSecret=input(f,'Tu contraseña de plataforma para confirmar','password');currentSecret.autocomplete='current-password';
      return {broker,port,path,commandUsername,commandPassword,statusUsername,statusPassword,currentSecret};
    },async fields=>{await api('/platform/api/relay-settings',Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value])));await configuration();message('Conexión MQTT guardada. Comprueba los dispositivos con la nueva configuración.');});
  }
  async function building(tenant){markNav('Edificios');await screen(async()=>{
    const container=el('div'),head=section(tenant.name);head.append(el('p','Edificio: '+tenant.slug),button('Configurar ayuda',()=>supportDialog(tenant,true),'secondary'),button(tenant.status==='active'?'Suspender edificio':'Reactivar edificio',async()=>{if(!await ask('¿Cambiar el estado de '+tenant.name+'?'))return;await api('/platform/api/tenants/status',{tenantId:tenant.id,status:tenant.status==='active'?'suspended':'active'});tenant.status=tenant.status==='active'?'suspended':'active';await building(tenant);},'secondary'),button('Volver a edificios',tenants,'secondary'));container.append(head);const tabs=el('nav',undefined,'management-tabs');tabs.setAttribute('aria-label','Secciones del edificio');for(const [id,label] of [['gates','Portones'],['users','Usuarios'],['codes','Códigos'],['review','Revisiones']]){const tab=button(label,()=>{options.buildingTab=id;return building(tenant);},'secondary');tab.setAttribute('aria-pressed',String((options.buildingTab||'gates')===id));tabs.append(tab);}container.append(tabs);
    const gatesSection=section('Portones registrados'),{gates}=await api('/platform/api/gates?tenantId='+encodeURIComponent(tenant.id));gatesSection.append(button('Agregar portón',()=>gateDialog(tenant)));
    table(gatesSection,['Nombre','Acceso','Conexión del relé','Integración','Acciones'],gates.map(g=>{const c=JSON.parse(g.trigger_config);let host='Configuración inválida';try{host=g.trigger_type==='mqtt'?'Relé · '+c.deviceId:g.trigger_type==='demo'?'DEMO · no opera hardware':new URL(c.url).hostname;}catch{}return [g.name,g.status==='active'?'Habilitado':'Deshabilitado',g.trigger_type==='mqtt'?connectionBadge(g.connection_state,g.connection_checked_at):'No aplica',host,actions(button('Editar',()=>gateDialog(tenant,g),'secondary'),...(g.trigger_type==='mqtt'?[button('Comprobar conexión',()=>connection(tenant,g),'secondary')]:[]))];}));if(!options.buildingTab||options.buildingTab==='gates')container.append(gatesSection);
    const relayPending=await api('/platform/api/relays?tenantId='+encodeURIComponent(tenant.id));
    if(relayPending.commands.length){const relaySection=section('Relés que necesitan revisión');relaySection.append(el('p','Comprueba lo ocurrido en el lugar antes de liberar una orden sin confirmar. Después revisa también el código o la orden del panel correspondiente.'));
      table(relaySection,['Portón','Fecha','Estado','Acciones'],relayPending.commands.map(c=>[c.gate_name,date(c.created_at),states[c.status],button('Liberar después de revisar',async()=>{if(!await ask('¿Ya comprobaste lo ocurrido? Esto permite nuevas órdenes al relé y no lo activa.'))return;await api('/platform/api/relays/resolve',{tenantId:tenant.id,commandId:c.id});await building(tenant);},'secondary')]));if(options.buildingTab==='review')container.append(relaySection);}

    const pendingSection=section('Órdenes del panel pendientes de revisión'),pending=await api('/platform/api/operations?tenantId='+encodeURIComponent(tenant.id));
    table(pendingSection,['Portón','Fecha','Estado','Acciones'],pending.operations.map(o=>[o.gate_name,date(o.created_at),states[o.status],button('Cerrar revisión',async()=>{if(!await ask('Comprueba físicamente el portón. Cerrar esta revisión permitirá nuevas órdenes y no enviará ninguna.'))return;await api('/platform/api/operations/resolve',{tenantId:tenant.id,operationId:o.id});await building(tenant);})]));if(options.buildingTab==='review')container.append(pendingSection);
    if(options.buildingTab==='users')container.append(await userPanel(tenant,true));if(options.buildingTab==='codes'){const codeSection=section('Códigos de '+tenant.name);await codeTable(codeSection,tenant,true);container.append(codeSection);}return container;
  });}
  async function newTenant(){const {devices}=await api('/platform/api/relay-inventory');return dialog('Nuevo edificio',f=>{
    const name=input(f,'Nombre'),preview=el('p',undefined,'mqtt-endpoint'),hint=el('p','Se genera a partir del nombre. Si ya existe, añadiremos un número.','muted'),customBox=el('div');
    preview.setAttribute('aria-live','polite');
    const slug=input(customBox,'Enlace personalizado');slug.maxLength=64;slug.pattern='[a-z0-9]+(-[a-z0-9]+)*';slug.autocapitalize='none';slug.spellcheck=false;
    let custom=false;
    const generate=()=>name.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64).replace(/-+$/g,'')||'edificio';
    const update=()=>{customBox.hidden=!custom;slug.disabled=!custom;preview.textContent=name.value.trim()||custom?'Vista previa: '+location.origin+'/t/'+(custom?slug.value:generate()):'Escribe el nombre para ver el enlace.';hint.textContent=custom?'El enlace debe ser único. Usa minúsculas, números y guiones.':'Se genera a partir del nombre. Si ya existe, añadiremos un número.';toggle.textContent=custom?'Usar enlace automático':'Personalizar enlace';toggle.setAttribute('aria-expanded',String(custom));};
    const toggle=button('Personalizar enlace',()=>{custom=!custom;if(custom&&!slug.value)slug.value=generate();update();if(custom)slug.focus();},'secondary');
    name.addEventListener('input',update);slug.addEventListener('input',update);f.append(preview,hint,toggle,customBox);update();
    const gate=input(f,'Nombre del primer portón');
    const type=select(f,'Cómo se controla',[['mqtt','Relé conectado (MQTT)'],['webhook','Enlace de activación HTTPS'],['demo','Demostración sin hardware']],'mqtt');
    const mqtt=el('div'),webhook=el('div'),device=relaySelect(mqtt,devices),url=input(webhook,'URL de activación HTTPS','url'),method=select(webhook,'Método',[['GET','GET'],['POST','POST']],'GET');f.append(mqtt,webhook);
    const refresh=()=>{mqtt.hidden=type.value!=='mqtt';webhook.hidden=type.value!=='webhook';device.disabled=mqtt.hidden;url.disabled=method.disabled=webhook.hidden;};type.addEventListener('change',refresh);refresh();
    return {name,slug,getSlug:()=>custom?slug.value:undefined,gate,type,device,url,method,user:input(f,'Nombre del administrador'),phone:input(f,'Teléfono del administrador','tel'),secret:input(f,'Contraseña del administrador','password')};
  },async a=>{const result=await api('/platform/api/tenants',{name:a.name.value,slug:a.getSlug(),gateName:a.gate.value,triggerType:a.type.value,deviceId:a.device.value,triggerUrl:a.url.value,method:a.method.value,masterUsername:a.user.value,masterPhone:a.phone.value,masterSecret:a.secret.value});await tenants();message('Edificio creado. Enlace: '+location.origin+'/t/'+result.slug);});}
  async function tenants(){options.navigate('edificios');}
  async function reports(){markNav('Reportes');await screen(async()=>{const s=section('Uso por edificio'),{report}=await api('/platform/api/reports');s.append(el('p','Las cifras cuentan órdenes con respuesta satisfactoria de la integración, no aperturas físicas confirmadas.','muted'));table(s,['Edificio','Estado','Códigos activos','Últimas 24 h','Últimos 7 días','Últimos 30 días'],report.map(r=>[r.name,states[r.status],r.activeCodes,r.last24,r.last7,r.last30]));return s;});}
  async function audit(){markNav('Auditoría');await screen(async()=>{const s=section('Auditoría de plataforma'),{log}=await api('/platform/api/audit');s.append(el('p','Últimas 200 acciones','muted'));table(s,['Fecha','Administrador','Acción','Detalle'],log.map(l=>[date(l.at),l.admin_username,l.action,l.details]));return s;});}
  async function start(){root.classList.add('management-ui');notice.className='message';root.before(notice);if(options.mode==='configuration')await configuration();else if(options.mode==='reports')await reports();else if(options.mode==='new'){root.append(el('p','Completa los datos del edificio.'));const modal=await newTenant();modal.addEventListener('close',()=>{options.navigate('edificios');},{once:true});}else if(options.mode==='building'){const {tenants:items}=await api('/platform/api/tenants');const tenant=items.find(t=>t.id===options.tenantId);if(!tenant)throw Error('Selecciona un edificio válido.');await building(tenant);}}
  start().catch(e=>message(e.message,true));return ()=>{revision++;notice.remove();root.replaceChildren();};
}
