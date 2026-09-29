import {config} from './api.js';
export function buildingPicker(){return {options:[],linked:false,selected:config.mode==='platform'?'/platform/admin':'/t/'+config.tenant.slug+'/admin',
 async init(){try{const r=await fetch('/account/buildings'),d=await r.json();if(!r.ok||!d.ok)return;this.linked=d.linked;this.options=d.buildings.map(b=>({url:'/t/'+b.slug+'/admin',label:b.name+' · '+(b.role==='master'?'Administrador':'Residente')}));if(d.platform)this.options.unshift({url:'/platform/admin',label:'Superadministración'});this.$nextTick(()=>{this.$refs.buildingSelect.value=this.selected;});}catch{}},
 get accountLink(){return '/account'+(config.tenant?'?building='+encodeURIComponent(config.tenant.slug):'');},
 change(){const root=window.Alpine.$data(document.body);if(root.busy||root.doors?.some(d=>['abriendo','sosteniendo'].includes(d.state))){this.selected=config.mode==='platform'?'/platform/admin':'/t/'+config.tenant.slug+'/admin';root.error='Espera a que termine la operación antes de cambiar de edificio.';return;}if(this.options.some(o=>o.url===this.selected))location.href=this.selected;}
};}
