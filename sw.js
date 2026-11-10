// 오프라인에서도 열리도록 앱 파일을 저장해 둔다 (입력 데이터는 IndexedDB에 따로 저장됨)
// 인터넷이 되면 항상 서버의 최신 파일을 먼저 확인한다 (브라우저 캐시를 거치지 않음)
const CACHE="safety-check-v21";
const FILES=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./print-pdf.js","./layout-2026-10.json","./layout-2026-11.json","./lib/pdf-lib.min.js","./lib/fontkit.umd.min.js","./fonts/KoPubDotum-Bold.ttf","./fonts/KoPubDotum-Medium.ttf"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:"reload"})))));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin) return;
  const key=url.origin+url.pathname;   // ?v= 는 빼고 저장
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{ if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(key,c));} return r;})
    .catch(()=>caches.match(key).then(r=>r||caches.match(e.request,{ignoreSearch:true})).then(r=>r||caches.match("./index.html"))));
});
