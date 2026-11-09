// 오프라인에서도 열리도록 앱 파일을 저장해 둔다 (입력 데이터는 IndexedDB에 따로 저장됨)
const CACHE="safety-check-v3";
const FILES=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./print-pdf.js","./layout.json","./lib/pdf-lib.min.js","./lib/fontkit.umd.min.js","./fonts/KoPubDotum-Bold.ttf","./fonts/KoPubDotum-Medium.ttf"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok&&new URL(e.request.url).origin===location.origin){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));} return r;})
    .catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))));
});
