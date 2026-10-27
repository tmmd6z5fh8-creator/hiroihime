/* ひろい姫 service worker: 自分のファイルはキャッシュ優先、CDN（pdf.js・フォント）は一度取れたら保存して次回オフラインでも使える */
var VERSION = 'hiroihime-v1';
var LOCAL = ['./', './index.html', './app.js', './calc.js', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(LOCAL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url), local = url.origin === self.location.origin;
  if (local) {
    e.respondWith(caches.match(req).then(function (r) { return r || fetch(req).then(function (res) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); return res; }); }));
  } else {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (cached) {
        var net = fetch(req).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(function () { return cached; });
        return cached || net;
      });
    }));
  }
});
