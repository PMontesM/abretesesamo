// Presentation state and interactions from the supplied prototypes; no demo data.
const interaction={
 drawer:false,armed:null,toastMsg:'',toastOn:false,
 arm(key,fn){if(this.armed===key){this.armed=null;clearTimeout(this._arm);fn();return;}this.armed=key;clearTimeout(this._arm);this._arm=setTimeout(()=>{this.armed=null;},3000);},
 notify(msg){this.toastMsg=msg;this.toastOn=true;clearTimeout(this._tt);this._tt=setTimeout(()=>{this.toastOn=false;},5000);}
};
export function portonApp(){return {...interaction,sheet:false,tab:'accesos',live:'',filter:'todo',formError:'',
 door(id){return this.doors.find(d=>d.id===id);},
 cancelHold(id){const d=this.door(id);if(!d||d.state!=='sosteniendo')return;cancelAnimationFrame(d._raf);d.state='reposo';d.progress=0;d.hint=true;},
 icon(d){return {abriendo:'fa-solid fa-spinner fa-spin',abierto:'fa-solid fa-lock-open',error:'fa-solid fa-triangle-exclamation'}[d.state]||'fa-solid fa-lock';},
 btnClass(d){return d.state==='error'?'border-red-300 bg-red-50':['reposo','sosteniendo'].includes(d.state)?'border-gray-300 bg-white hover:bg-gray-50':'border-transparent bg-white';},
 textClass(d){return d.state==='error'?'text-red-700':'text-material-dark';},
 fillClass(d){return d.state==='abierto'?'bg-green-600':'bg-material-dark';},
 grouped(code){return code.slice(0,3)+' '+code.slice(3);},
 get visibleActivity(){return this.filter==='rechazados'?this.activity.filter(a=>!a.ok):this.activity;},get rejectedCount(){return this.activity.filter(a=>!a.ok).length;}
};}
export function adminApp(){return {...interaction,hoy:Array(24).fill(0),ayer:Array(24).fill(0),chartMax:4,hover:null,devices:[],expiring:[],log:[],result:'todos',devFilter:'todos',q:'',limit:6,
 get totalHoy(){return this.hoy.reduce((a,b)=>a+b,0);},get totalAyer(){return this.ayer.reduce((a,b)=>a+b,0);},get peak(){return this.hoy.indexOf(Math.max(...this.hoy));},
 get filtered(){const q=this.q.trim().toLowerCase();return this.log.filter(r=>(this.result==='todos'||(this.result==='exito'?r.ok:!r.ok))&&(this.devFilter==='todos'||r.dev===this.devFilter)&&(!q||(r.who+' '+r.method).toLowerCase().includes(q)));},
 get shown(){return this.filtered.slice(0,this.limit);},get okCount(){return this.log.filter(r=>r.ok).length;},get badCount(){return this.log.filter(r=>!r.ok).length;},
 hour(i){return String(i).padStart(2,'0')+':00';},goLog(){this.$nextTick(()=>document.getElementById('bitacora').scrollIntoView({behavior:'smooth'}));},focusDevice(id){this.devFilter=id;this.result='todos';this.q='';this.limit=6;this.goLog();},showRejected(){this.result='rechazados';this.devFilter='todos';this.q='';this.limit=6;this.goLog();},clearFilters(){this.result='todos';this.devFilter='todos';this.q='';}
};}
