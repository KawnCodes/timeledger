const prefix = 'timeledger-'+self.registration.scope+'-';
const cacheName = prefix+'v4';
const assets = ['./','./index.html','./style.css','./app.mjs','./core.mjs','./storage.mjs','./icons.mjs','./sync.mjs','./config.mjs','./game.mjs','./sound.mjs','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./mark.png','./contours.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(assets)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==cacheName)await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  const url=new URL(event.request.url);
  if(!url.href.startsWith(self.registration.scope))return;
  if(event.request.mode==='navigate'){
    event.respondWith(caches.open(cacheName).then(async c=>(await c.match('./index.html'))||fetch(event.request)));return;
  }
  event.respondWith(caches.open(cacheName).then(async c=>(await c.match(event.request))||fetch(event.request)));
});
