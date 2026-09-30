import {application} from './application.js';
export const getAdminHTML=(tenant,user)=>application({mode:'admin',tenant:{id:tenant.id,slug:tenant.slug,name:tenant.name,supportPhone:tenant.support_phone||''},user:{username:user.username,role:user.role}});
