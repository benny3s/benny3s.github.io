const CACHE_NAME = "benny-portal-v1";
const PORTAL_PATHS = new Set([
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon.svg"
]);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(["/", "/manifest.webmanifest", "/icon-192.png"])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // 하위 앱(/bridge/, /when/ 등)은 가로채지 않고 루트 포털 파일만 네트워크 우선 + 오프라인 캐시 폴백 처리
  if (url.origin !== self.location.origin || !PORTAL_PATHS.has(url.pathname)) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match("/")))
  );
});
