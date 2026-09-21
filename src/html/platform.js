import {application} from './application.js';
import { page } from './shared.js';
export const getPlatformLoginHTML=(security={})=>page('Acceso a plataforma',{...security,mode:'platform-login'});
export const getPlatformAdminHTML=(user,view,tenantId)=>{const config={mode:'platform',user:{username:user.username},view,tenantId};return view?page('Administración de plataforma',config):application(config);};
