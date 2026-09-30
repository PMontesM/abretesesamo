export function initNavigation(panel,pages,fallback,aliases={}){
 panel._pages=pages;panel._defaultPage=fallback;
 const read=()=>{const url=new URL(location.href);const candidate=url.searchParams.get('section')||aliases[url.searchParams.get('view')]||url.hash.slice(1);navigate(panel,pages.includes(candidate)?candidate:fallback,false);};
 panel._navigationListener=read;window.addEventListener('popstate',read);read();
}
export function navigate(panel,id,push=true){
 if(!panel._pages?.includes(id))return;
 panel.page=id;panel.afterNavigation?.(id);if(panel._pages.includes(panel.tab))panel.tab=id;panel.drawer=false;
 if(push){const url=new URL(location.href);url.searchParams.delete('view');url.searchParams.set('section',id);url.hash='';if(url.href!==location.href)history.pushState(null,'',url);}
 panel.$nextTick(()=>{const main=document.getElementById('main-scroll');main?.scrollTo({top:0,behavior:'instant'});if(push){const heading=document.querySelector('[data-panel-page="'+id+'"] h2');if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}}});
}
export function destroyNavigation(panel){window.removeEventListener('popstate',panel._navigationListener);}
