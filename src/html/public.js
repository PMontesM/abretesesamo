import { page } from './shared.js';
export const getPublicHTML=tenant=>page(tenant.name,{mode:'public',tenant:{id:tenant.id,slug:tenant.slug,name:tenant.name,supportPhone:tenant.support_phone||''}});
