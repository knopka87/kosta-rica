/**
 * app.js — SPA-рендеринг главной страницы.
 *
 * Показывает:
 *  1. Текущий этап (по дате из steps-seed)
 *  2. Быстрые ссылки на контент этого этапа
 *  3. Навигацию по всем этапам (горизонтальная полоса)
 *  4. Обратный отсчёт до отправления
 */
(function () {
  "use strict";

  // --- Контентные ссылки для каждого этапа -------------------------------
  // Какие разделы показывать на каждом этапе.
  // Ключ = step.id, значение = массив {icon, text, href}.
  var STEP_CONTENT = {
    "prep": [
      { icon: "🎫", text: "Билеты — сводная таблица", href: "step-prep.html#ticket-все-билеты--сводная-таблица" },
      { icon: "📋", text: "Общая информация и час. пояса", href: "step-prep.html#общая-информация" },
      { icon: "🧳", text: "Сборы — чек-лист", href: "step-prep.html#sbory" },
      { icon: "✅", text: "Дела до отъезда", href: "step-prep.html#dela" },
      { icon: "💰", text: "Деньги и платежи", href: "step-prep.html#деньги-и-платежи" },
      { icon: "📱", text: "Связь и интернет", href: "step-prep.html#связь-и-интернет" },
      { icon: "🥗", text: "Еда в поезд", href: "step-prep.html#eda-v-poezd" },
      { icon: "⚠️", text: "Что нужно доделать", href: "step-prep.html#что-нужно-доделать" }
    ],
    "train-msk": [
      { icon: "🚆", text: "Поезд 131: расписание и купе", href: "step-train-msk.html#30-октября-2026-пятница--поезд-киров--москва" },
      { icon: "🥗", text: "Еда: поезд + Москва", href: "step-train-msk.html#3010--поезд-прибытие-в-москву-2049" },
      { icon: "📅", text: "Календарь маршрута", href: "calendar.ics" }
    ],
    "ist-panama": [
      { icon: "✈️", text: "Рейсы: Москва → Стамбул → Панама", href: "step-ist-panama.html#31-октября-2026-суббота--москва--стамбул--панама" },
      { icon: "📖", text: "Стыковка в IST", href: "step-ist-panama.html#стыковка-в-аэропорту-ist-sjo" },
      { icon: "🍽️", text: "Питание по участкам", href: "step-ist-panama.html#питanie-po-markшруту" },
      { icon: "🛂", text: "Правила Турции (транзит)", href: "step-ist-panama.html#турция-транзит-в-стамбуле-ist" }
    ],
    "panama-night": [
      { icon: "🌃", text: "Ночь в Панаме: тайминг", href: "step-panama-night.html#3110-2005--0111-1328--ночь-в-панаме" },
      { icon: "🛂", text: "Пограничный контроль Панамы", href: "step-panama-night.html#инструкция-d--пограничный-контроль" },
      { icon: "🏨", text: "Отель и правила Панамы", href: "step-panama-night.html#панама" }
    ],
    "arrival-cr": [
      { icon: "🛬", text: "Прилёт: SJO → LIR → Тамариндо", href: "step-arrival-cr.html#1-ноября-2026-воскресенье--панама--сан-хосе--либерия" },
      { icon: "📖", text: "Стыковка в аэропорту", href: "step-arrival-cr.html#стыковка-в-аэропорту-ist-sjo" },
      { icon: "🛒", text: "Разведка цен в SJO", href: "step-arrival-cr.html#разведка-0111--прилёт-в-sjo--снять-цены--чтобы-потом-купить-правильно" },
      { icon: "🍽️", text: "Питание на участке", href: "step-arrival-cr.html#питanie-po-markшруту" }
    ],
    "tamarindo": [
      { icon: "🏨", text: "Отель: Occidental 4★ AI", href: "step-tamarindo.html#тамариндо-0111--0611" },
      { icon: "🍽️", text: "Где поесть в КР", href: "step-tamarindo.html#коста-рика--где-поесть" },
      { icon: "🛡️", text: "Безопасность", href: "step-tamarindo.html#безопасность-в-тамариндо" },
      { icon: "🚐", text: "Транспорт", href: "step-tamarindo.html#транспорт" },
      { icon: "🏖️", text: "Пляжи и природа", href: "step-tamarindo.html#пляжи-и-природа" },
      { icon: "🛒", text: "Шопинг и сувениры", href: "step-tamarindo.html#шопинг-и-сувениры" },
      { icon: "📅", text: "Ноябрь (1–6): рекомендации", href: "step-tamarindo.html#ноябрь-16--конкретные-рекомендации" }
    ],
    "sjo-window": [
      { icon: "🔁", text: "Тайминг: Tamarindo → SJO → Панама", href: "step-sjo-window.html#6-ноября-2026-пятница--тамариндо--либерия--сан-хосе" },
      { icon: "🛒", text: "Окно покупок в SJO (6 ч)", href: "step-sjo-window.html#sjo-сан-хосе-0611-6-часов--основное-окно-покупок" },
      { icon: "🍽️", text: "Питание на участке", href: "step-sjo-window.html#питanie-po-markшруту" }
    ],
    "panama-days": [
      { icon: "🇵🇦", text: "Полные сутки в Панаме", href: "step-panama-days.html#2-я-0611-1712--0711-2200--полnye-сутки" },
      { icon: "🌙", text: "Шлюзы Панамского канала (ночь)", href: "step-panama-days.html#пограничный-контроль" },
      { icon: "🛒", text: "Что привезти из Панамы", href: "step-panama-days.html#панама--где-и-что-покупать" },
      { icon: "🍽️", text: "Где поесть в Панаме", href: "step-panama-days.html#панама--где-поесть-060711" }
    ],
    "home": [
      { icon: "🚀", text: "Панама → Стамбул → Москва", href: "step-home.html#7-ноября-2026-суббота--панама--стамбул" },
      { icon: "🚂", text: "Поезд Москва → Киров", href: "step-home.html#9-ноября-2026-понедельник--поезд-москва--киров" },
      { icon: "🛒", text: "Лучшие места для покупок", href: "step-home.html#pty-панама-0711--лучшее-место-для-алкоголя" },
      { icon: "🍽️", text: "Питание на обратном пути", href: "step-home.html#питanie-po-markшруту" }
    ]
  };

  // --- Утилиты ----------------------------------------------------------
  function getStepsSeed() {
    var el = document.getElementById("steps-seed");
    if (!el) return [];
    try { return JSON.parse(el.textContent); } catch (e) { return []; }
  }

  function getCurrentStep(steps) {
    var now = new Date();
    var current = null;
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var start = s.dateStart ? new Date(s.dateStart + "T00:00:00+03:00") : null;
      var end = s.dateEnd ? new Date(s.dateEnd + "T23:59:59+03:00") : null;

      // Проверяем after/until
      var afterMs = 0;
      var untilMs = Infinity;
      if (s.after) {
        var parts = s.after.split(":");
        afterMs = new Date(now);
        afterMs.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
      }
      if (s.until) {
        var parts = s.until.split(":");
        untilMs = new Date(now);
        untilMs.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
      }

      var match = true;
      if (start && now < start) match = false;
      if (end && now > end) match = false;
      if (s.after && now < afterMs) match = false;
      if (s.until && now > untilMs) match = false;

      if (match) current = s;
    }
    return current;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Рендеринг --------------------------------------------------------
  function renderApp() {
    var steps = getStepsSeed();
    if (!steps.length) {
      document.getElementById("app").innerHTML =
        '<div class="loading">Нет данных маршрута</div>';
      return;
    }

    var current = getCurrentStep(steps);
    var container = document.getElementById("app");

    // --- Обратный отсчёт ---
    var countdownHtml = '';
    var targetDate = "2026-10-30T07:27:00+03:00";
    countdownHtml = '<div class="countdown" id="countdown" data-target="' + targetDate + '">' +
      '<div class="cell"><div class="num">–</div><div class="lbl">дней</div></div>' +
      '<div class="cell"><div class="num">–</div><div class="lbl">часов</div></div>' +
      '<div class="cell"><div class="num">–</div><div class="lbl">минут</div></div>' +
      '<div class="cell"><div class="num">–</div><div class="lbl">секунд</div></div>' +
      '</div>' +
      '<p style="margin:-14px 0 22px;color:var(--ink-mute);font-size:13.5px;text-align:center">' +
      'до отправления поезда №131 Киров-Пасс → Москва, 30 октября 2026, 07:27' +
      '</p>';

    // --- Текущий этап ---
    var heroHtml = "";
    var quickLinksHtml = "";
    var factsHtml = "";

    if (current) {
      // Hero-блок
      heroHtml = '<section class="current-hero">' +
        '<div class="step-icon">' + escapeHtml(current.icon) + '</div>' +
        '<h2>Сейчас: ' + escapeHtml(current.title) + '</h2>' +
        '<div class="step-meta">' +
          '<span>📅 ' + escapeHtml(current.dateLabel) + '</span>' +
          (current.place ? ' · <span>📍 ' + escapeHtml(current.place) + '</span>' : '') +
        '</div>' +
        '<p class="step-summary">' + escapeHtml(current.summary) + '</p>' +
        '</section>';

      // Быстрые ссылки
      var links = STEP_CONTENT[current.id];
      if (links && links.length) {
        var linksHtml = [];
        for (var i = 0; i < links.length; i++) {
          var l = links[i];
          linksHtml.push(
            '<a class="quick-link" href="' + l.href + '">' +
              '<span class="ql-icon">' + escapeHtml(l.icon) + '</span>' +
              '<span class="ql-text">' + escapeHtml(l.text) + '</span>' +
              '<span class="ql-arrow">→</span>' +
            '</a>'
          );
        }
        quickLinksHtml = '<section class="quick-links">' +
          '<h3>📌 Быстрый доступ</h3>' +
          '<div class="quick-link-list">' + linksHtml.join("\n") + '</div>' +
          '</section>';
      }

      // Факты-карточки
      factsHtml = '<div class="facts">' +
        '<div class="fact"><div class="k">Этап</div><div class="v">' + escapeHtml(current.num + " из " + (steps.length - 1)) + ' — ' + escapeHtml(current.title) + '</div></div>' +
        '<div class="fact"><div class="k">Даты</div><div class="v">' + escapeHtml(current.dateLabel) + '</div></div>' +
        '<div class="fact"><div class="k">Место</div><div class="v">' + escapeHtml(current.place) + '</div></div>' +
        '<div class="fact"><div class="k">База</div><div class="v">Тамариндо, Guanacaste</div></div>' +
        '</div>';
    } else {
      // Нет текущего этапа (до поездки или после)
      heroHtml = '<section class="current-hero">' +
        '<div class="step-icon">📋</div>' +
        '<h2>Поездка ещё не началась</h2>' +
        '<div class="step-meta">30 октября – 9 ноября 2026</div>' +
        '<p class="step-summary">Подготовка впереди. Перейди к этапу «Подготовка» или посмотри весь маршрут.</p>' +
        '</section>';
    }

    // --- Навигация по этапам ---
    var dotsHtml = [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var isActive = current && s.id === current.id;
      var activeClass = isActive ? ' active' : '';
      dotsHtml.push(
        '<a class="step-dot' + activeClass + '" href="step-' + s.id + '.html">' +
          '<span class="dot-icon">' + escapeHtml(s.icon) + '</span>' +
          '<span class="dot-num">' + s.num + '</span>' +
        '</a>'
      );
    }
    var navHtml = '<section class="steps-nav">' +
      '<h3>🗺️ Все этапы</h3>' +
      '<div class="steps-strip">' + dotsHtml.join("\n") + '</div>' +
      '<div style="text-align:center;margin-top:10px">' +
        '<a href="steps.html" style="color:#0f766e;font-size:14px">Полное оглавление →</a>' +
      '</div>' +
      '</section>';

    // --- Погода ---
    var weatherHtml = '<div class="weather" data-weather></div>';

    // --- Собираем всё ---
    container.innerHTML =
      countdownHtml +
      heroHtml +
      quickLinksHtml +
      factsHtml +
      navHtml +
      weatherHtml;

    // Показываем
    container.classList.add("loaded");

    // Запускаем обратный отсчёт
    initCountdown();
  }

  // --- Обратный отсчёт (лёгкая версия) -----------------------------------
  function initCountdown() {
    var el = document.getElementById("countdown");
    if (!el) return;

    var target = new Date(el.getAttribute("data-target"));
    if (isNaN(target.getTime())) return;

    function update() {
      var now = new Date();
      var diff = target - now;
      if (diff <= 0) {
        el.innerHTML = '<div style="text-align:center;color:#0f766e;font-size:18px;font-weight:600">🎉 Поездка началась!</div>';
        return;
      }
      var days = Math.floor(diff / 86400000);
      diff -= days * 86400000;
      var hours = Math.floor(diff / 3600000);
      diff -= hours * 3600000;
      var mins = Math.floor(diff / 60000);
      diff -= mins * 60000;
      var secs = Math.floor(diff / 1000);

      var cells = el.querySelectorAll(".cell");
      if (cells[0]) cells[0].querySelector(".num").textContent = days;
      if (cells[1]) cells[1].querySelector(".num").textContent = hours;
      if (cells[2]) cells[2].querySelector(".num").textContent = mins;
      if (cells[3]) cells[3].querySelector(".num").textContent = secs;
    }

    update();
    setInterval(update, 1000);
  }

  // --- Запуск -----------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderApp);
  } else {
    renderApp();
  }
})();
