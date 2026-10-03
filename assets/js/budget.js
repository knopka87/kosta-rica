/* Коста-Рика 2026 — трекер трат поездки.
 *
 * Состояние: localStorage cr:budget:v1 → {v:1, entries:[{id,date,note,cat,amount}]}.
 * Плановые ориентиры (еда, покупки) — статика из контента сайта.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-budget]");
  if (!root) return;

  var KEY = "cr:budget:v1";
  var CATS = ["Еда", "Транспорт", "Отель", "Покупки", "Экскурсии", "Здоровье", "Прочее"];
  var PLAN = { "Еда": "$250–400", "Покупки": "$165–370" };

  function lsGet() {
    try {
      var st = JSON.parse(localStorage.getItem(KEY) || "null");
      if (st && st.v === 1 && Array.isArray(st.entries)) return st;
    } catch (e) {}
    return { v: 1, entries: [] };
  }
  function lsSet(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtDate(iso) {
    var p = String(iso || "").split("-");
    return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : iso;
  }
  function fmtMoney(n) { return "$" + (Math.round(Number(n) * 100) / 100).toFixed(2); }

  var state = lsGet();

  function render() {
    root.innerHTML =
      '<form class="tx-form">' +
        '<input type="date" class="tx-date" value="' + todayISO() + '" aria-label="Дата">' +
        '<input type="text" class="tx-note" placeholder="Что потратили" required>' +
        '<select class="tx-cat" aria-label="Категория">' +
          CATS.map(function (c) { return '<option>' + c + "</option>"; }).join("") +
        "</select>" +
        '<input type="number" class="tx-amount" placeholder="Сумма, $" min="0" step="0.01" inputmode="decimal" required>' +
        '<button type="submit">+ Добавить</button>' +
      "</form>" +
      '<div class="tx-stats"></div>' +
      '<div class="tx-list"></div>' +
      '<div class="tx-tools"><button type="button" class="tx-csv">Скачать CSV</button></div>';

    root.querySelector(".tx-form").addEventListener("submit", onAdd);
    root.querySelector(".tx-csv").addEventListener("click", onCsv);
    renderStats();
    renderList();
  }

  function onAdd(e) {
    e.preventDefault();
    var f = e.target;
    var note = f.querySelector(".tx-note").value.replace(/\s+/g, " ").trim();
    var amount = parseFloat(f.querySelector(".tx-amount").value);
    if (!note || !(amount > 0)) return;
    state.entries.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: f.querySelector(".tx-date").value || todayISO(),
      note: note,
      cat: f.querySelector(".tx-cat").value,
      amount: Math.round(amount * 100) / 100
    });
    lsSet(state);
    f.querySelector(".tx-note").value = "";
    f.querySelector(".tx-amount").value = "";
    renderStats();
    renderList();
  }

  function renderStats() {
    var el = root.querySelector(".tx-stats");
    if (!el) return;
    var total = 0;
    var byCat = {};
    state.entries.forEach(function (en) {
      total += en.amount;
      byCat[en.cat] = (byCat[en.cat] || 0) + en.amount;
    });
    var html = '<div class="tx-total">Итого <b>' + fmtMoney(total) + "</b>" +
      (state.entries.length ? " <span>· " + state.entries.length + " записей</span>" : "") + "</div>";
    html += '<div class="tx-cats">';
    CATS.forEach(function (c) {
      var sum = byCat[c];
      if (!sum) return;
      html += '<div class="tx-cat-chip"><span class="c">' + c + "</span><b>" + fmtMoney(sum) + "</b>" +
        (PLAN[c] ? '<i class="plan">план ' + PLAN[c] + "</i>" : "") + "</div>";
    });
    html += "</div>";
    el.innerHTML = html;
  }

  function renderList() {
    var el = root.querySelector(".tx-list");
    if (!el) return;
    if (!state.entries.length) {
      el.innerHTML = '<div class="tx-empty">Пока пусто — первая трата появится здесь.</div>';
      return;
    }
    var idx = {};
    state.entries.forEach(function (en, i) { idx[en.id] = i; });
    var rows = state.entries.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (idx[b.id] || 0) - (idx[a.id] || 0);
    });
    el.innerHTML = rows.map(function (en) {
      return '<div class="tx-item" data-id="' + esc(en.id) + '">' +
        '<span class="tx-when">' + fmtDate(en.date) + "</span>" +
        '<span class="tx-what">' + esc(en.note) + "</span>" +
        '<span class="tx-kind">' + esc(en.cat) + "</span>" +
        '<span class="tx-sum">' + fmtMoney(en.amount) + "</span>" +
        '<button type="button" class="tx-del" aria-label="Удалить">✕</button>' +
        "</div>";
    }).join("");
  }

  function onDelete(id) {
    state.entries = state.entries.filter(function (en) { return en.id !== id; });
    lsSet(state);
    renderStats();
    renderList();
  }

  function onCsv() {
    var lines = ["Дата;Категория;Описание;Сумма, $"];
    state.entries.forEach(function (en) {
      lines.push([fmtDate(en.date), en.cat, en.note.replace(/;/g, ","), en.amount].join(";"));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kosta-rica-budget.csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  root.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".tx-del") : null;
    if (btn && btn.parentNode) onDelete(btn.parentNode.getAttribute("data-id"));
  });

  render();
})();
