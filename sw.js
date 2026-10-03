/* Генерируется build.py — не редактировать вручную.
   Версия кэша (sha1 содержимого): 3f58d7035254 */
"use strict";
var CACHE = "cr-3f58d7035254";
var ASSETS = [
  "budget.html",
  "credits.html",
  "dela.html",
  "dokumenty.html",
  "eda.html",
  "hotel.html",
  "index.html",
  "journal.html",
  "lifehacks.html",
  "marshrut.html",
  "phrasebook.html",
  "pokupki.html",
  "pravila.html",
  "sbory.html",
  "step-arrival-cr.html",
  "step-home.html",
  "step-ist-flight.html",
  "step-ist-layover.html",
  "step-ist-panama.html",
  "step-panama-days.html",
  "step-panama-night.html",
  "step-prep.html",
  "step-sjo-window.html",
  "step-tamarindo.html",
  "step-train-msk.html",
  "steps.html",
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
  "assets/js/budget.js",
  "assets/js/dashboard.js",
  "assets/js/docs.js",
  "assets/js/editable-list.js",
  "assets/js/journal.js",
  "assets/js/local-search.js",
  "assets/js/main.js",
  "assets/js/maps.js",
  "assets/js/steps.js",
  "assets/js/versioned-storage.js",
  "assets/js/weather.js",
  "assets/vendor/leaflet/images/layers-2x.png",
  "assets/vendor/leaflet/images/layers.png",
  "assets/vendor/leaflet/images/marker-icon-2x.png",
  "assets/vendor/leaflet/images/marker-icon.png",
  "assets/vendor/leaflet/images/marker-shadow.png",
  "assets/vendor/leaflet/leaflet.css",
  "assets/vendor/leaflet/leaflet.js",
  "assets/vendor/leaflet/leaflet.js.map",
  "assets/vendor/protomaps-leaflet.js",
  "assets/vendor/protomaps-leaflet.js.map",
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
  "docs/secret-step-prep.html.bin",
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

// PMTiles читается через Range-запросы — нарезаем тело из кэша сами
function pmtilesRange(req, url) {
  return caches.open(CACHE).then(function (c) {
    return c.match(url.pathname, { ignoreSearch: true });
  }).then(function (hit) {
    if (!hit) return fetch(req);
    return hit.arrayBuffer().then(function (buf) {
      var total = buf.byteLength;
      var range = req.headers.get("range");
      var m = range && /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m) {
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "application/x-protobuf",
            "Content-Length": String(total),
            "Accept-Ranges": "bytes"
          }
        });
      }
      var start = parseInt(m[1], 10);
      var end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (end > total - 1) end = total - 1;
      if (start > end || start > total - 1) {
        return new Response(null, {
          status: 416,
          headers: {"Content-Range": "bytes */" + total}
        });
      }
      var chunk = buf.slice(start, end + 1);
      return new Response(chunk, {
        status: 206,
        headers: {
          "Content-Type": "application/x-protobuf",
          "Content-Range": "bytes " + start + "-" + end + "/" + total,
          "Content-Length": String(chunk.byteLength),
          "Accept-Ranges": "bytes"
        }
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // чужие домены (погода, статусы рейсов) — всегда напрямую в сеть
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith(".pmtiles")) {
    e.respondWith(pmtilesRange(req, url));
    return;
  }

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
