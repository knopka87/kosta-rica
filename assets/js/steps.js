/* Коста-Рика 2026 — текущий этап поездки по дате.
 *
 * Данные: <script id="steps-seed" type="application/json"> (генерирует build.py).
 * Блоки:
 *  - [data-steps-current]  — карточка «Сейчас» на главной;
 *  - [data-steps-index]    — оглавление шагов (текущий первым + подсветка);
 *  - [data-step-now]       — баннер на странице шага (я здесь / я в другом месте).
 *
 * Текущий этап = последний по порядку шаг, чей диапазон дат покрывает «сейчас»;
 * after/until (HH:MM) уточняют границы первого и последнего дня.
 */
(function () {
  "use strict";

  var seedEl = document.getElementById("steps-seed");
  if (!seedEl) return;
  var steps;
  try { steps = JSON.parse(seedEl.textContent); } catch (e) { return; }
  if (!steps || !steps.length) return;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  function currentStep(now) {
    var d = iso(now), t = hm(now), found = null;
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (s.dateStart && d < s.dateStart) continue;
      if (s.dateEnd && d > s.dateEnd) continue;
      if (s.after && d === s.dateStart && t < s.after) continue;
      if (s.until && d === s.dateEnd && t > s.until) continue;
      found = s;
    }
    return found || steps[steps.length - 1];
  }

  var current = currentStep(new Date());

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* --- карточка «Сейчас» на главной --- */
  var mount = document.querySelector("[data-steps-current]");
  if (mount) {
    mount.innerHTML =
      '<a class="now-card" href="step-' + current.id + '.html">' +
        '<span class="now-kicker">📍 Сейчас на маршруте</span>' +
        '<span class="now-title">' + current.icon + " " + esc(current.title) + "</span>" +
        '<span class="now-summary">' + esc(current.summary) + "</span>" +
        '<span class="now-when">' + esc(current.dateLabel) + " · " + esc(current.place) + "</span>" +
      "</a>";
  }

  /* --- оглавление: текущий шаг первым + подсветка --- */
  var index = document.querySelector("[data-steps-index]");
  if (index) {
    var cur = index.querySelector('[data-step-card="' + current.id + '"]');
    if (cur) {
      cur.classList.add("current");
      var badge = cur.querySelector(".step-badge");
      if (badge) badge.hidden = false;
      index.insertBefore(cur, index.firstChild);
    }
  }

  /* --- баннер на странице шага --- */
  var banner = document.querySelector("[data-step-now]");
  if (banner) {
    var mine = banner.getAttribute("data-step-id");
    if (mine && mine === current.id) {
      banner.className = "step-now here";
      banner.innerHTML =
        "<b>📍 Вы здесь</b> — текущий этап маршрута (" + esc(current.dateLabel) + ").";
    } else {
      banner.className = "step-now elsewhere";
      banner.innerHTML =
        "📍 Сейчас на маршруте: <a href=\"step-" + current.id + ".html\">" +
        current.icon + " " + esc(current.title) + "</a>" +
        " (" + esc(current.dateLabel) + ") — этот шаг пока не наступили/уже пройден.";
    }
    banner.hidden = false;
  }
})();
