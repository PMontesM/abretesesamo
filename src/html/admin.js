import {application} from './application.js';
import { page } from './shared.js';
export const getAdminHTML=(tenant,user,view)=>{const config={mode:'admin',tenant:{id:tenant.id,slug:tenant.slug,name:tenant.name,supportPhone:tenant.support_phone||''},user:{username:user.username,role:user.role},view};return view&&view!=='passes'?page(tenant.name,config):application(config);};
