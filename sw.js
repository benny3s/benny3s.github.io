const CACHE_NAME = "benny-portal-v3";   // v2: 공통 토큰 /design/tokens.css 도 오프라인 캐시 · v3: tokens ?v=2, 오프라인 찾는 순서 고침 (2026-10-29)
const PORTAL_PATHS = new Set([
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon.svg",
  "/design/tokens.css"   // 포털 색·크기 값이 여기 있음 — 오프라인에서 빠지면 포털이 무늬 없이 뜸
]);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(["/", "/manifest.webmanifest", "/icon-192.png", "/design/tokens.css?v=2"])).catch(() => {})
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
          const exact = res.clone();
          // ?v= 같은 꼬리가 붙은 요청은 꼬리 뺀 주소로도 한 벌 더 둔다 → 그 파일의 "가장 최근 것" 자리 (늘 1개)
          const latest = url.search ? res.clone() : null;
          caches.open(CACHE_NAME).then(c => Promise.all([
            c.put(event.request, exact),
            latest && c.put(url.pathname, latest)
          ])).catch(() => {});
        }
        return res;
      })
      .catch(() => offlineMatch(event.request, url))
  );
});

// 오프라인 찾는 순서: ① 주소 그대로(?v 까지 같은 것) ② 같은 파일의 가장 최근 것(꼬리 뺀 주소)
// ③ ?v 무시하고 아무거나 — ignoreSearch 는 맞는 것 중 가장 오래된 것을 돌려줘서 맨 마지막에만 쓴다.
// 다 없으면 화면(HTML)만 "/" 로 대신하고, 토큰 파일은 HTML 로 대신하지 않는다.
function offlineMatch(request, url) {
  return caches.match(request)
    .then(r => r || caches.match(url.pathname))
    .then(r => r || caches.match(request, { ignoreSearch: true }))
    .then(r => r || (url.pathname === "/design/tokens.css" ? Response.error() : caches.match("/")));
}
