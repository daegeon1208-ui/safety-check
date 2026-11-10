// 현장 AR 마킹: 오프라인에서도 열리도록 앱 파일 저장 (기록은 IndexedDB에 따로 저장됨)
const CACHE="ar-mark-v1";
const FILES=["./","./index.html","./manifest.webmanifest","./lib/three.module.min.js","../icon-192.png","../icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:"reload"})))));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("ar-mark-")&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin) return;
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{ if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(url.origin+url.pathname,c));} return r;})
    .catch(()=>caches.match(url.origin+url.pathname).then(r=>r||caches.match("./index.html"))));
});
