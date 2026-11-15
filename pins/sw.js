// 핀톡은 /pintalk/ 으로 옮겼습니다. 예전 주소의 서비스워커는 캐시를 지우고 스스로 해제합니다.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil((async()=>{
  for(const k of await caches.keys()) if(k.startsWith("drawing-pins")) await caches.delete(k);
  await self.registration.unregister();
  for(const c of await self.clients.matchAll({type:"window"})) c.navigate(c.url);
})()));
