/* Skjutjournal – service worker.
   HTML network-first (uppdateringar syns direkt online), statiska filer cache-first.
   CDN/Supabase går alltid mot nätet.
   OBS: höj VERSION nedan när du pushar en ny version så att installerade
   användare får notisen "Uppdatering finns". */
const VERSION = "v13";
const CACHE = "hskf-" + VERSION;
const ASSETS = ["./","./index.html","./manifest.json","./favicon.svg","./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  // skipWaiting görs först när användaren klickar "Uppdatera nu"
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("message", e=>{ if(e.data && e.data.type==="SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", e=>{
  const req=e.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;            // CDN / Supabase -> nätet
  if(req.mode==="navigate"){
    e.respondWith(
      fetch(req).then(r=>{ const cp=r.clone(); caches.open(CACHE).then(c=>c.put("./index.html",cp)); return r; })
                .catch(()=>caches.match("./index.html"))
    );
    return;
  }
  e.respondWith(caches.match(req).then(r=>r||fetch(req)));
});
