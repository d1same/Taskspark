const CACHE = "taskspark-shell-13";
const SHELL = ["./", "index.html", "app.css", "app.js", "icons.js", "theme.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "fonts/plus-jakarta-sans-500.woff2", "fonts/plus-jakarta-sans-600.woff2", "fonts/plus-jakarta-sans-700.woff2", "fonts/plus-jakarta-sans-800.woff2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
