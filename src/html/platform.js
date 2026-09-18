import { page } from './shared.js';
export const getPlatformLoginHTML=()=>page('Acceso a plataforma',{mode:'platform-login'});
export const getPlatformAdminHTML=user=>page('Administración de plataforma',{mode:'platform',user:{username:user.username}});
