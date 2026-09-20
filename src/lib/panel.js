import * as db from './db.js';
import {listPasses} from './passes.js';
export async function panelData(env,user,offset=0){
 offset=Number(offset);if(!Number.isInteger(offset)||Math.abs(offset)>840)offset=0;
 const now=Date.now(),midnight=Math.floor((now-offset*60000)/86400000)*86400000+offset*60000;
 const [allowed,passes,history]=await Promise.all([db.allowedGates(env,user),listPasses(env,user,{status:'current'}),db.listLogs(env,user.tenant_id,user)]);
 const gates=allowed.map(g=>({id:g.id,name:g.name,hasRelay:g.trigger_type==='mqtt',isDemo:g.trigger_type==='demo',connection_state:g.connection_state,connection_checked_at:g.connection_checked_at}));
 const result={serverNow:now,gates,passes,...history};
 if(user.role!=='master')return result;
 const [summary,byHour,observations]=await Promise.all([
   env.DB.prepare("SELECT SUM(CASE WHEN at>=? AND outcome='sent' THEN 1 ELSE 0 END) AS today,SUM(CASE WHEN at<? AND outcome='sent' THEN 1 ELSE 0 END) AS yesterday,SUM(CASE WHEN at>=? AND outcome!='sent' THEN 1 ELSE 0 END) AS rejected,MAX(CASE WHEN outcome='sent' THEN at END) AS lastSent FROM logs WHERE tenant_id=? AND at>=?").bind(midnight,midnight,midnight,user.tenant_id,midnight-86400000).first(),
   env.DB.prepare("SELECT CAST((at-?)/3600000 AS INTEGER)%24 AS hour,CASE WHEN at>=? THEN 'today' ELSE 'yesterday' END AS day,COUNT(*) AS count FROM logs WHERE tenant_id=? AND at>=? AND outcome='sent' GROUP BY hour,day").bind(offset*60000,midnight,user.tenant_id,midnight-86400000).all(),
   env.DB.prepare("SELECT o.*,g.id AS gate_id FROM relay_observations o JOIN gates g ON g.trigger_type='mqtt' AND json_extract(g.trigger_config,'$.deviceId')=o.device_id WHERE g.tenant_id=? AND o.hour>=? ORDER BY o.checked_at").bind(user.tenant_id,now-24*3600000).all()
 ]);
 const counts=await env.DB.prepare("SELECT COUNT(*) AS n FROM codes WHERE tenant_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?)").bind(user.tenant_id,now).first();
 result.summary={...summary,activeCodes:counts.n,midnight};result.hours=byHour.results;result.observations=observations.results;
 result.gates=gates.map(g=>({...g,deviceId:allowed.find(a=>a.id===g.id).trigger_type==='mqtt'?JSON.parse(allowed.find(a=>a.id===g.id).trigger_config).deviceId:null}));return result;
}
