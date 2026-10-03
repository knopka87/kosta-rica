/* Генерируется build.py — не редактировать вручную.
   Версия кэша (sha1 содержимого): 468516f0b8ca */
"use strict";
var CACHE = "cr-468516f0b8ca";
var ASSETS = [
  "credits.html",
  "dela.html",
  "dokumenty.html",
  "eda.html",
  "hotel.html",
  "index.html",
  "lifehacks.html",
  "marshrut.html",
  "pokupki.html",
  "pravila.html",
  "sbory.html",
  "calendar.ics",
  "assets/css/style.css",
  "assets/img/arenal.jpg",
  "assets/img/casco-viejo.jpg",
  "assets/img/conchal.jpg",
  "assets/img/credits.json",
  "assets/img/favicon.svg",
  "assets/img/map-hotel.svg",
  "assets/img/panama-canal.jpg",
  "assets/img/route-map.svg",
  "assets/img/tamarindo-beach.jpg",
  "assets/img/tamarindo-street.jpg",
  "assets/js/docs.js",
  "assets/js/editable-list.js",
  "assets/js/main.js",
  "assets/js/weather.js",
  "docs/doc-01.bin",
  "docs/doc-02.bin",
  "docs/doc-03.bin",
  "docs/doc-04.bin",
  "docs/doc-05.bin",
  "docs/doc-06.bin",
  "docs/doc-07.bin",
  "docs/manifest.bin",
  "docs/meta.json",
  "docs/secret-marshrut.html.bin",
  "manifest.json"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // чужие домены (погода, статусы рейсов) — всегда напрямую в сеть
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) {
          // stale-while-revalidate: отдаём кэш, фоново обновляем
          if (!url.search) {
            fetch(req).then(function (resp) {
              if (resp.ok) c.put(req, resp.clone());
            }).catch(function () {});
          }
          return hit;
        }
        return fetch(req).then(function (resp) {
          if (resp.ok && !url.search) c.put(req, resp.clone());
          return resp;
        }).catch(function (err) {
          if (req.mode === "navigate") {
            return c.match("index.html", { ignoreSearch: true }).then(function (fb) {
              return fb || Promise.reject(err);
            });
          }
          throw err;
        });
      });
    })
  );
});
