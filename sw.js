const CACHE_NAME = "benny-portal-v7";   // v7: 앱별 할 일 배지·인라인 미디어 미리보기·묶음 이름 변경·백업/복원 (2026-11-19)
const PORTAL_PATHS = new Set([
  "/",
  "/index.html",
  "/admin-login.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.svg",
  "/design/tokens.css"   // 포털 색·크기 값이 여기 있음 — 오프라인에서 빠지면 포털이 무늬 없이 뜸
]);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([
      "/",
      "/manifest.webmanifest",
      "/icon-192.png",
      "/design/tokens.css?v=2",
      "/admin-login.js?v=20261118a"
    ])).catch(() => {})
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
  const canonPath = url.pathname === "/index.html" ? "/" : url.pathname;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then(res => {
        if (res && res.ok) {
          const exact = res.clone();
          // ?v= 나 ?source=pwa 꼬리가 붙은 요청은 꼬리 뺀 대표 경로로도 한 벌 더 둔다 → 항상 최신 오프라인 본 유지
          const latest = (url.search || url.pathname === "/index.html") ? res.clone() : null;
          caches.open(CACHE_NAME).then(c => Promise.all([
            c.put(event.request, exact),
            latest && c.put(canonPath, latest)
          ])).catch(() => {});
        }
        return res;
      })
      .catch(() => offlineMatch(event.request, canonPath))
  );
});

// 오프라인 찾는 순서: ① 주소 그대로(?v 까지 같은 것) ② 같은 파일의 가장 최근 대표 경로
// ③ ?v 무시하고 아무거나 — ignoreSearch 는 맞는 것 중 가장 오래된 것을 돌려줘서 맨 마지막에만 쓴다.
// 다 없으면 페이지 탐색(navigate)일 때만 "/" 로 대신하고, 아이콘·매니페스트·스크립트·토큰은 HTML 로 대신하지 않는다.
function offlineMatch(request, canonPath) {
  return caches.match(request)
    .then(r => r || caches.match(canonPath))
    .then(r => r || caches.match(request, { ignoreSearch: true }))
    .then(r => r || (request.mode === "navigate" ? caches.match("/") : Response.error()));
}
