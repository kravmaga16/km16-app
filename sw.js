const CACHE='km16-app-20261121-admin-security';const FILES=['./','./index.html','./logo-km16.png','./equipe-km16.jpg','./icon-192.png','./icon-512.png','./manifest.webmanifest','./robots.txt','./sitemap.xml','./stage-visibility.js?v=2','./app-navigation.css?v=1','./app-navigation.mjs?v=1'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('km16-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const PRIVATE_PAGES=new Set(['admin-password-reset.html','adhesion-admin.html','clients.html','course-admin.html','course-operations.html','news-admin.html','trials.html']);
self.addEventListener('fetch',event=>{
 const request=event.request;
 const url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(PRIVATE_PAGES.has(url.pathname.split('/').pop()))return;
 if(url.search&&request.mode==='navigate')return;
 event.respondWith(fetch(request).then(response=>{
  if(response.ok){
   const copy=response.clone();
   event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{}));
  }
  return response;
 }).catch(()=>caches.match(request)));
});
self.addEventListener('push',event=>{
 let d={};try{d=event.data?.json()||{};}catch{}
 const url=d.type==='trial'?'./adhesion.html':/^stage-[a-z0-9-]+$/.test(d.stageProduct||'')?'./adhesion.html?categorie=Stages&produit='+encodeURIComponent(d.stageProduct)+'&source_stage=push-48h':'./#accueil';
 const id=/^[0-9a-f-]{36}$/.test(d.id||'')?d.id:'';
 event.waitUntil(self.registration.showNotification(String(d.title||'Actualité KM16').slice(0,120),{
 body:String(d.body||'Une nouvelle actualité est disponible.').slice(0,180),
 icon:'./icon-192.png',badge:'./icon-192.png',tag:id?'km16-news-'+id:'km16-news',
 data:{url}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
 const candidate=event.notification.data?.url||'';
 const target=/^\.\/adhesion\.html(?:\?categorie=Stages&produit=stage-[a-z0-9-]+(?:&source_stage=push-48h)?)?$/.test(candidate)?candidate:'./#accueil';
 const url=new URL(target,self.registration.scope).href;
 const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const tab of tabs){if(new URL(tab.url).origin===self.location.origin){await tab.navigate(url);return tab.focus();}}
 return self.clients.openWindow(url);
 })());
});
