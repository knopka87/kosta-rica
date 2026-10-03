/* Коста-Рика 2026 — контекстный дашборд (Фаза 3)
 *
 * 4 режима:
 *  1. Before trip — до начала поездки
 *  2. In transit — во время перелёта/поездки
 *  3. At destination — на месте (stay)
 *  4. After trip — после поездки
 *
 * Данные: trip.json (segments с ISO-датами)
 */
(function () {
  "use strict";

  var TRIP_JSON_URL = "trip.json";
  var NOW_EL = document.getElementById("now-dashboard");
  if (!NOW_EL) return;

  // --- Утилиты ---
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function fmtLocal(isoStr, tz) {
    // Форматирует ISO-строку в локальное время с учётом часового пояса
    try {
      var d = new Date(isoStr);
      var opts = {
        hour: "numeric", minute: "2-digit",
        timeZone: tz || "Europe/Kirov"
      };
      return d.toLocaleString("ru-RU", opts);
    } catch (e) {
      return isoStr;
    }
  }
  function fmtDiff(ms) {
    if (ms < 0) return "уже началось";
    var h = Math.floor(ms / 36e5);
    var m = Math.floor((ms % 36e5) / 6e4);
    if (h > 24) {
      var d = Math.floor(h / 24);
      return d + " дн. " + (h % 24) + " ч";
    }
    return h + " ч " + m + " мин";
  }

  // --- Загрузка trip.json ---
  function loadTrip(cb) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", TRIP_JSON_URL, true);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          cb(null, JSON.parse(xhr.responseText));
        } catch (e) {
          cb(e);
        }
      } else {
        cb(new Error("HTTP " + xhr.status));
      }
    };
    xhr.onerror = function () { cb(new Error("Network error")); };
    xhr.send();
  }

  // --- Определение текущего сегмента ---
  function findCurrentSegment(segments, now) {
    var epoch = now.getTime();
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var start = new Date(s.startAt).getTime();
      var end = new Date(s.endAt).getTime();
      if (epoch >= start && epoch < end) {
        return { seg: s, idx: i, progress: (epoch - start) / (end - start) };
      }
    }
    // До поездки
    if (segments.length > 0) {
      var firstStart = new Date(segments[0].startAt).getTime();
      if (epoch < firstStart) {
        return { seg: segments[0], idx: -1, before: true, nextStart: firstStart };
      }
    }
    // После поездки
    if (segments.length > 0) {
      var lastEnd = new Date(segments[segments.length - 1].endAt).getTime();
      if (epoch >= lastEnd) {
        return { seg: segments[segments.length - 1], idx: segments.length, after: true };
      }
    }
    return null;
  }

  // --- Следующее событие ---
  function findNextEvent(segments, currentIdx) {
    var now = new Date().getTime();
    for (var i = currentIdx + 1; i < segments.length; i++) {
      var s = segments[i];
      var start = new Date(s.startAt).getTime();
      if (start > now) {
        return { seg: s, diff: start - now };
      }
    }
    return null;
  }

  // --- Рендеринг режимов ---
  function renderBefore(data, nextSeg) {
    var trip = data.trip;
    var startMs = nextSeg ? nextSeg.nextStart - new Date().getTime() : 0;
    return '<div class="now-banner">' +
      '<h2>🧳 Подготовка к поездке</h2>' +
      '<p>' + trip.title + ' — ' + trip.startAt.split("T")[0] + ' – ' + trip.endAt.split("T")[0] + '</p>' +
      '<div class="now-time">До отправления: ' + fmtDiff(startMs) + '</div>' +
      '</div>' +
      '<div class="quick-links">' +
      '<a href="step-prep.html" class="quick-link"><span class="quick-link-icon">🎫</span> Билеты</a>' +
      '<a href="step-prep.html#sbory" class="quick-link"><span class="quick-link-icon">🧳</span> Сборы</a>' +
      '<a href="step-prep.html#dela" class="quick-link"><span class="quick-link-icon">✅</span> Дела</a>' +
      '<a href="dokumenty.html" class="quick-link"><span class="quick-link-icon">🔒</span> Документы</a>' +
      '</div>';
  }

  function renderInTransit(current, nextEvent, data) {
    var s = current.seg;
    var now = new Date();
    var start = new Date(s.startAt);
    var end = new Date(s.endAt);
    var remaining = end.getTime() - now.getTime();

    var html = '<div class="now-banner">' +
      '<h2>' + escapeHtml(s.icon) + ' ' + escapeHtml(s.title) + '</h2>' +
      '<p>' + escapeHtml(s.from ? (s.from.code || s.from.name) : '') + ' → ' + escapeHtml(s.to ? (s.to.code || s.to.name) : '') + '</p>' +
      '<div class="now-time">Осталось: ' + fmtDiff(remaining) + '</div>' +
      '</div>';

    // Алерты
    if (s.alerts && s.alerts.length) {
      for (var i = 0; i < s.alerts.length; i++) {
        var a = s.alerts[i];
        var cls = a.level === "critical" ? "alert-critical" :
                  a.level === "warning" ? "alert-warning" :
                  a.level === "info" ? "alert-info" : "alert-success";
        var label = a.level === "critical" ? "⚠️ Критично" :
                    a.level === "warning" ? "⚡ Внимание" :
                    a.level === "info" ? "ℹ️ Информация" : "✅";
        html += '<div class="alert ' + cls + '"><strong>' + label + '</strong>' + escapeHtml(a.text) + '</div>';
      }
    }

    // Действия
    if (s.actions && s.actions.length) {
      html += '<h3 style="margin:20px 0 12px;font-size:16px;">Сделать сейчас</h3>' +
        '<ul style="list-style:none;padding:0;margin:0 0 20px;">';
      for (var j = 0; j < s.actions.length; j++) {
        var act = s.actions[j];
        html += '<li class="now-action">' +
          '<label>' +
          '<input type="checkbox">' +
          '<span>' + escapeHtml(act.text) + '</span>' +
          '</label></li>';
      }
      html += '</ul>';
    }

    // Далее
    if (nextEvent) {
      html += '<div class="plan-b"><strong>🔜 Далее</strong>' +
        escapeHtml(nextEvent.seg.icon) + ' ' + escapeHtml(nextEvent.seg.title) +
        ' через ' + fmtDiff(nextEvent.diff) + '</div>';
    }

    // Быстрые кнопки
    html += '<div class="quick-links">' +
      '<a href="dokumenty.html" class="quick-link"><span class="quick-link-icon">🔒</span> Документы</a>' +
      '<a href="phrasebook.html" class="quick-link"><span class="quick-link-icon">💬</span> Фразы</a>' +
      '<a href="budget.html" class="quick-link"><span class="quick-link-icon">💰</span> Траты</a>' +
      '<a href="step-' + s.id + '.html" class="quick-link"><span class="quick-link-icon">📋</span> Подробности</a>' +
      '</div>';

    return html;
  }

  function renderAtDestination(current) {
    var s = current.seg;
    return '<div class="now-banner">' +
      '<h2>' + escapeHtml(s.icon) + ' ' + escapeHtml(s.title) + '</h2>' +
      '<p>📍 ' + escapeHtml(s.place || "") + '</p>' +
      '<div class="now-time">Находитесь в этом месте</div>' +
      '</div>' +
      '<div class="quick-links">' +
      '<a href="step-' + s.id + '.html" class="quick-link"><span class="quick-link-icon">📋</span> План дня</a>' +
      '<a href="hotel.html" class="quick-link"><span class="quick-link-icon">🗺️</span> Карта</a>' +
      '<a href="eda.html" class="quick-link"><span class="quick-link-icon">🍽️</span> Еда</a>' +
      '<a href="phrasebook.html" class="quick-link"><span class="quick-link-icon">💬</span> Фразы</a>' +
      '</div>';
  }

  function renderAfterTrip() {
    return '<div class="now-banner">' +
      '<h2>🏠 Поездка завершена</h2>' +
      '<p>Время вернуться к воспоминаниям</p>' +
      '</div>' +
      '<div class="quick-links">' +
      '<a href="journal.html" class="quick-link"><span class="quick-link-icon">📔</span> Журнал</a>' +
      '<a href="budget.html" class="quick-link"><span class="quick-link-icon">💰</span> Бюджет</a>' +
      '<a href="steps.html" class="quick-link"><span class="quick-link-icon">🗺️</span> Весь маршрут</a>' +
      '</div>';
  }

  // --- Главный рендер ---
  function render(data) {
    var segments = data.segments;
    var now = new Date();
    var current = findCurrentSegment(segments, now);
    if (!current) {
      NOW_EL.innerHTML = '<div class="alert alert-info">Не удалось определить этап</div>';
      return;
    }

    var nextEvent = findNextEvent(segments, current.idx >= 0 ? current.idx : 0);

    if (current.before) {
      NOW_EL.innerHTML = renderBefore(data, current);
    } else if (current.after) {
      NOW_EL.innerHTML = renderAfterTrip();
    } else if (current.seg.kind === "stay") {
      NOW_EL.innerHTML = renderAtDestination(current);
    } else {
      NOW_EL.innerHTML = renderInTransit(current, nextEvent, data);
    }

    bindActionState(current.seg.id);

    // Обновление статуса сети
    updateOnlineStatus();
  }

  function bindActionState(segmentID) {
    var boxes = NOW_EL.querySelectorAll(".now-action input[type=checkbox]");
    if (!boxes.length) return;
    var key = "cr:dashboard:actions:" + segmentID;
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) {}
    boxes.forEach(function (box, index) {
      box.checked = saved.indexOf(index) !== -1;
      box.addEventListener("change", function () {
        var done = [];
        boxes.forEach(function (item, itemIndex) {
          if (item.checked) done.push(itemIndex);
        });
        try { localStorage.setItem(key, JSON.stringify(done)); } catch (e) {}
      });
    });
  }

  // --- Статус сети ---
  function updateOnlineStatus() {
    var status = document.getElementById("network-status");
    if (!status) return;
    var dot = status.querySelector(".status-dot");
    var label = status.querySelector(".status-label");
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "status-dot";
      status.prepend(dot);
    }
    if (!label) {
      label = document.createElement("span");
      label.className = "status-label";
      status.appendChild(label);
    }
    if (navigator.onLine) {
      dot.classList.remove("offline");
      label.textContent = "Онлайн · данные актуальны";
    } else {
      dot.classList.add("offline");
      label.textContent = "Офлайн · работает кэш";
    }
  }

  // --- Инициализация ---
  loadTrip(function (err, data) {
    if (err) {
      NOW_EL.innerHTML = '<div class="alert alert-warning">⚠️ Не удалось загрузить trip.json: ' + err.message + '</div>';
      return;
    }
    render(data);
  });

  // Слушаем изменения сети
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
})();
