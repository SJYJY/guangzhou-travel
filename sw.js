// 离线缓存（仅在 https / localhost 下生效，例如部署到 GitHub Pages 后）
// 改了网站文件后把 VER 加 1，用户刷新即可拿到新版
const VER = "gz-v2";
const CORE = ["./", "index.html", "guide.html", "gallery.html", "weather.html", "css/style.css",
  "js/common.js", "js/gate.js", "js/app.js", "js/weather.js", "data/spots.js", "data/info.js", "data/routes.js", "data/photos.js",
  "lib/leaflet.js", "lib/leaflet.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];
const TILE_CACHE = "gz-tiles", API_CACHE = "gz-api";

self.addEventListener("install", e => { e.waitUntil(caches.open(VER).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== TILE_CACHE && k !== API_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name), ks = await c.keys();
  for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 地图瓦片：缓存优先
  if (url.hostname.endsWith("autonavi.com")) {
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); c.put(req, res.clone()); if (Math.random() < 0.02) trim(TILE_CACHE, 4000); return res;
    }));
    return;
  }
  // 天气 / 路线 / 搜索 / 区界：网络优先，断网时用缓存
  if (/open-meteo\.com|openstreetmap\.de|komoot\.io|datav\.aliyun\.com/.test(url.hostname)) {
    e.respondWith(fetch(req).then(res => { const cp = res.clone(); caches.open(API_CACHE).then(c => c.put(req, cp)); return res; })
      .catch(() => caches.match(req)));
    return;
  }
  // 本站文件：先给缓存，后台更新
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VER).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
