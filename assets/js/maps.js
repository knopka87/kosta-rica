/* Офлайн-карта: Leaflet + protomaps-leaflet + локальный PMTiles.
   Вендор грузится лениво — только на страницах с mount [data-map].
   Тайлы читаются из assets/map/*.pmtiles через Range-запросы;
   service worker отдаёт нарезку из кэша (см. sw.js, pmtilesRange). */
(function () {
  "use strict";

  var PMTILES = "assets/map/central-america.pmtiles";
  var VENDOR = [
    "assets/vendor/leaflet/leaflet.js",
    "assets/vendor/protomaps-leaflet.js"
  ];
  var VENDOR_CSS = "assets/vendor/leaflet/leaflet.css";
  var ATTRIBUTION =
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
    ' · <a href="https://openmaptiles.org/copyright">OpenMapTiles</a>';

  function loadCSS(href) {
    return new Promise(function (resolve) {
      if (document.querySelector('link[href="' + href + '"]')) return resolve();
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = link.onerror = resolve;
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("не загрузился " + src)); };
      document.body.appendChild(s);
    });
  }

  function setup(el) {
    if (typeof L === "undefined" || typeof protomapsL === "undefined") return;
    if (el._mapReady) return;
    el._mapReady = true;

    var parts = (el.getAttribute("data-map") || "").split(",");
    var lat = parseFloat(parts[0]);
    var lon = parseFloat(parts[1]);
    var zoom = parseInt(el.getAttribute("data-map-zoom") || "14", 10);
    var label = el.getAttribute("data-map-label") || "";
    var hasMarker = !isNaN(lat) && !isNaN(lon);

    var map = L.map(el, { attributionControl: true });
    protomapsL.leafletLayer({
      url: PMTILES,
      flavor: "light",
      lang: "ru",
      attribution: ATTRIBUTION
    }).addTo(map);

    if (hasMarker) {
      map.setView([lat, lon], zoom);
      if (label) {
        L.marker([lat, lon]).addTo(map).bindPopup(label);
      } else {
        L.marker([lat, lon]).addTo(map);
      }
    } else {
      map.setView([10.2868, -85.8502], 9);
    }

    setTimeout(function () { map.invalidateSize(); }, 200);
  }

  function init() {
    var mounts = document.querySelectorAll("[data-map]");
    if (!mounts.length) return;
    loadCSS(VENDOR_CSS)
      .then(function () { return loadScript(VENDOR[0]); })
      .then(function () { return loadScript(VENDOR[1]); })
      .then(function () {
        Array.prototype.forEach.call(mounts, setup);
      })
      .catch(function (err) {
        console.warn("карта недоступна:", err);
        Array.prototype.forEach.call(mounts, function (el) {
          el.innerHTML = '<div class="map-fallback">Карта не загрузилась. Обнови страницу или проверь память устройства.</div>';
        });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
