const CACHE='km16-app-20261121-services';const FILES=['./','./index.html','./logo-km16.png','./equipe-km16.jpg','./icon-192.png','./icon-512.png','./manifest.webmanifest','./robots.txt','./sitemap.xml','./stage-visibility.js?v=2','./app-navigation.css?v=1','./app-navigation.mjs?v=1'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('km16-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone))}return r}).catch(()=>caches.match(e.request)))});
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
