/* Коста-Рика 2026 — погода: Open-Meteo (network-first).
 *
 * Данные кэшируются в localStorage (cr:weather:tamarindo), поэтому офлайн
 * показывается последний полученный прогноз; если кэша нет — типичная
 * погода для ноября в Тамариндо (встроенные нормы).
 * Внешний API минует service worker (sw.js пропускает чужие домены).
 */
(function () {
  "use strict";

  var mount = document.querySelector("[data-weather]");
  if (!mount) return;

  var KEY = "cr:weather:tamarindo";
  var API =
    "https://api.open-meteo.com/v1/forecast?latitude=10.2996&longitude=-85.7672" +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=America%2FCosta_Rica&forecast_days=7";

  var DAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var WMO = {
    0: ["Ясно", "☀️"], 1: ["Малооблачно", "🌤"], 2: ["Переменно", "⛅"], 3: ["Облачно", "☁️"],
    45: ["Туман", "🌫"], 48: ["Изморозь", "🌫"],
    51: ["Морось", "🌦"], 53: ["Морось", "🌧"], 55: ["Сильная морось", "🌧"],
    56: ["Ледяная морось", "🌧"], 57: ["Ледяная морось", "🌧"],
    61: ["Дождь", "🌧"], 63: ["Дождь", "🌧"], 65: ["Сильный дождь", "🌧"],
    66: ["Ледяной дождь", "🌧"], 67: ["Ледяной дождь", "🌧"],
    71: ["Снег", "🌨"], 73: ["Снег", "🌨"], 75: ["Сильный снег", "🌨"], 77: ["Град", "🌨"],
    80: ["Ливень", "🌦"], 81: ["Ливень", "🌧"], 82: ["Сильный ливень", "⛈"],
    85: ["Снегопад", "🌨"], 86: ["Снегопад", "🌨"],
    95: ["Гроза", "⛈"], 96: ["Гроза с градом", "⛈"], 99: ["Сильная гроза", "⛈"]
  };
  function wmo(code) { return WMO[code] || ["—", "🌡"]; }
  function rnd(v) { return Math.round(v); }

  function loadCache() {
    try {
      var r = JSON.parse(localStorage.getItem(KEY));
      return r && r.t && r.d ? r : null;
    } catch (e) { return null; }
  }
  function saveCache(d) {
    try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function updLabel(ts, live) {
    if (live) return "только что";
    try {
      return "обновлено " + new Date(ts).toLocaleString("ru-RU", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  function renderLive(d, ts, live) {
    var cur = d.current || {};
    var code = wmo(cur.weather_code);
    var html =
      '<div class="w-head"><span class="w-place">Тамариндо, сейчас</span>' +
      '<span class="w-upd">' + esc(updLabel(ts, live)) + "</span></div>" +
      '<div class="w-now">' +
      '<div class="w-icon">' + code[1] + "</div>" +
      '<div class="w-main"><div class="w-temp">' + rnd(cur.temperature_2m) + "°</div>" +
      '<div class="w-feel">ощущается ' + rnd(cur.apparent_temperature) + "°</div></div>" +
      '<div class="w-facts"><div>' + esc(code[0]) + "</div>" +
      "<div>ветер " + rnd(cur.wind_speed_10m) + " км/ч</div>" +
      "<div>влажность " + rnd(cur.relative_humidity_2m) + "%</div></div>" +
      "</div>";

    var daily = (d.daily && d.daily.time) ? d.daily : null;
    if (daily) {
      html += '<div class="w-days">';
      for (var i = 0; i < daily.time.length && i < 7; i++) {
        var dt = daily.time[i];
        var wd;
        try { wd = DAYS[new Date(dt + "T12:00:00").getDay()]; } catch (e) { wd = ""; }
        var pop = daily.precipitation_probability_max[i];
        html +=
          '<div class="w-day' + (i === 0 ? " today" : "") + '">' +
          "<b>" + (i === 0 ? "сег" : esc(wd)) + "</b>" +
          "<i>" + wmo(daily.weather_code[i])[1] + "</i>" +
          '<span class="w-max">' + rnd(daily.temperature_2m_max[i]) + "°</span>" +
          '<span class="w-min">' + rnd(daily.temperature_2m_min[i]) + "°</span>" +
          '<span class="w-pop">' + (pop == null ? "—" : rnd(pop) + "%") + "</span>" +
          "</div>";
      }
      html += "</div>";
    }
    mount.className = "weather w-live";
    mount.innerHTML = html;
  }

  function renderNorms() {
    mount.className = "weather w-norms";
    mount.innerHTML =
      '<div class="w-head"><span class="w-place">Тамариндо</span>' +
      '<span class="w-upd">нет сети</span></div>' +
      '<div class="w-now">' +
      '<div class="w-icon">🌡</div>' +
      '<div class="w-main"><div class="w-temp">25–30°</div>' +
      '<div class="w-feel">типичная погода для ноября</div></div>' +
      '<div class="w-facts"><div>утро и вечер — солнце</div>' +
      "<div>дождь после 14:00, 1–2 часа</div>" +
      "<div>океан ~28°</div></div>" +
      "</div>" +
      '<div class="w-note">Прогноз недоступен офлайн — это климатическая норма ' +
      "для Guanacaste в ноябре. При появлении сети обновится автоматически.</div>";
  }

  /* мгновенно: кэш или нормы, затем фоновое обновление из сети */
  var cached = loadCache();
  if (cached) renderLive(cached.d, cached.t, false);
  else renderNorms();

  if (typeof fetch !== "function") return;
  fetch(API)
    .then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.current) throw new Error("bad payload");
      saveCache(data);
      renderLive(data, Date.now(), true);
    })
    .catch(function () {
      if (!cached) renderNorms();
    });
})();
