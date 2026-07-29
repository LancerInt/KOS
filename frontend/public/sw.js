/* KOS service worker — app-shell caching for offline use (PRD §25).
 *
 * - GET navigations & static assets: cache-first, falling back to network, then
 *   to the cached app shell so the SPA still boots offline.
 * - GET /api/ reads: network-first, falling back to the last cached response.
 * - Non-GET (mutations): never handled here — they hit the network directly, and
 *   the app's offline queue captures them when the network is unavailable.
 */
const CACHE = "kos-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return resp;
          })
          .catch(() => (request.mode === "navigation" ? caches.match("/index.html") : undefined)),
    ),
  );
});
