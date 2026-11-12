/* Service worker: keeps ಜಲಗಾರ usable offline.
   Language files other than en/kn are cached the first time they are used.
   Bump VERSION whenever you change index.html / app.js / config.js. */
const VERSION="v19";
const SHELL = "plog-shell-" + VERSION;
const MEDIA = "plog-media";
const FILES = ["./", "./index.html", "./app.js", "./config.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/logo.svg",
  "./i18n/languages.json", "./i18n/en.json", "./i18n/kn.json", "./i18n/_context.json"];
const MEDIA_MAX = 150;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith("plog-shell-") && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

function isMedia(url) {
  return /^(fonts\.googleapis\.com|fonts\.gstatic\.com|img\.youtube\.com|lh3\.googleusercontent\.com)$/.test(url.hostname) ||
    (url.hostname === "drive.google.com" && url.pathname === "/thumbnail");
}
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_MAX; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // app files: answer from cache at once, refresh the cache in the background
    if (req.mode === "navigate") {
      e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(SHELL).then(x => x.put("./index.html", c)); return r; })
        .catch(() => caches.match("./index.html")));
      return;
    }
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(x => x.put(req, c)); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (isMedia(url)) {
    // fonts, photo thumbnails and video thumbnails: cache first
    e.respondWith(caches.open(MEDIA).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === "opaque") { cache.put(req, r.clone()); trim(cache); }
        return r;
      } catch (err) { return hit || Response.error(); }
    }));
  }
  // everything else (the Apps Script server) goes straight to the network
});
