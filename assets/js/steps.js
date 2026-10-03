/* Коста-Рика 2026 — текущий этап поездки.
 *
 * Данные: <script id="steps-seed"> — срез trip.json, который кладёт build.py.
 * Блоки:
 *  - [data-steps-current]  — карточка «Сейчас» на главной;
 *  - [data-steps-index]    — оглавление шагов (текущий первым + подсветка);
 *  - [data-step-now]       — баннер на странице шага (я здесь / я в другом месте).
 *
 * Сравнение идёт по абсолютному моменту (epoch), а не по локальной дате
 * устройства: на маршруте через UTC−6 сравнение «сегодняшней даты» с датой
 * этапа давало неверный этап на границах суток. startAt/endAt в сиде всегда
 * с явным offset, поэтому часовой пояс телефона на результат не влияет.
 */
(function () {
  "use strict";

  var seedEl = document.getElementById("steps-seed");
  if (!seedEl) return;
  var steps;
  try { steps = JSON.parse(seedEl.textContent); } catch (e) { return; }
  if (!steps || !steps.length) return;

  function ms(iso) { return Date.parse(iso); }

  /* Интервал полуоткрытый: [startAt, endAt). Сегменты в trip.json идут
     встык, поэтому закрытый с двух сторон давал бы два «текущих» этапа
     ровно в момент стыка. */
  function currentStep(now) {
    var t = now.getTime();
    for (var i = 0; i < steps.length; i++) {
      if (t >= ms(steps[i].startAt) && t < ms(steps[i].endAt)) return steps[i];
    }
    return t < ms(steps[0].startAt) ? steps[0] : steps[steps.length - 1];
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
      var mineStep = null;
      for (var k = 0; k < steps.length; k++) {
        if (steps[k].id === mine) { mineStep = steps[k]; break; }
      }
      var passed = mineStep && ms(mineStep.endAt) <= Date.now();
      banner.className = "step-now elsewhere";
      banner.innerHTML =
        (passed ? "✅ Этот этап уже пройден." : "🕐 Этот этап ещё впереди.") +
        " Сейчас на маршруте: <a href=\"step-" + current.id + ".html\">" +
        current.icon + " " + esc(current.title) + "</a> (" +
        esc(current.dateLabel) + ").";
    }
    banner.hidden = false;
  }
})();
