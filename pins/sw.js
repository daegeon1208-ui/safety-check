// 도면 하자 핀 앱: 오프라인에서도 열리도록 앱 파일을 저장해 둔다 (도면·핀 기록은 IndexedDB에 따로 저장됨)
const CACHE="drawing-pins-v50";
const FILES=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./dwg2pdf.js","./sample.pdf","../lib/pdfjs.min.js","../lib/pdfjs.worker.min.js","../lib/pdf-lib.min.js","../lib/fontkit.umd.min.js","../fonts/KoPubDotum-Medium.ttf","../fonts/PretendardVariable.woff2"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:"reload"})))));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("drawing-pins-")&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin) return;
  const key=url.origin+url.pathname;
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{ if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(key,c));} return r;})
    .catch(()=>caches.match(key).then(r=>r||caches.match(e.request,{ignoreSearch:true})).then(r=>r||caches.match(new URL("./index.html",self.registration.scope).href))));
});
