const CACHE='km16-news-push-20261105';const FILES=['./','./index.html','./logo-km16.png','./equipe-km16.jpg','./alex.jpg','./mickael.jpg','./dominique.jpg','./pierre.jpg','./nathalie.jpg','./veronique.jpg','./jonathan.jpg','./frederic.jpg','./axel.jpg','./matthieu.jpg','./romain.jpg','./elsa.jpg','./vincent.jpg','./icon-192.png','./icon-512.png','./manifest.webmanifest','./robots.txt','./sitemap.xml'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone))}return r}).catch(()=>caches.match(e.request)))});
self.addEventListener('push',event=>{
 let d={};try{d=event.data?.json()||{};}catch{}
 const id=/^[0-9a-f-]{36}$/.test(d.id||'')?d.id:'';
 event.waitUntil(self.registration.showNotification(String(d.title||'Actualité KM16').slice(0,120),{
 body:String(d.body||'Une nouvelle actualité est disponible.').slice(0,180),
 icon:'./icon-192.png',badge:'./icon-192.png',tag:id?'km16-news-'+id:'km16-news',
 data:{url:'./#accueil'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
 const url=new URL('./#accueil',self.registration.scope).href;
 const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 for(const tab of tabs){if(new URL(tab.url).origin===self.location.origin){await tab.navigate(url);return tab.focus();}}
 return self.clients.openWindow(url);
 })());
});
