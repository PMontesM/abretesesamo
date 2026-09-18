import { page } from './shared.js';
export const getAdminHTML=(tenant,user)=>page(tenant.name,{mode:'admin',tenant:{id:tenant.id,slug:tenant.slug,name:tenant.name,supportPhone:tenant.support_phone||''},user:{username:user.username,role:user.role}});
