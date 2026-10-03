/* Коста-Рика 2026 — трекер трат поездки (мультивалютный).
 *
 * Состояние: localStorage cr:budget:v2 → {v:2, balances:{RUB,USD,CRC}, entries:[{id,date,note,cat,amount,cur}]}.
 * Миграция v1 (только USD-суммы) → v2: старые траты считаются в долларах.
 * Плановые ориентиры (еда, покупки) — статика из контента сайта.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-budget]");
  if (!root) return;

  var KEY = "cr:budget:v2";
  var CURS = ["RUB", "USD", "CRC"];
  var SYM = { RUB: "₽", USD: "$", CRC: "₡" };
  var CATS = ["Еда", "Транспорт", "Отель", "Покупки", "Экскурсии", "Здоровье", "Прочее"];
  var PLAN = { "Еда": "$250–400", "Покупки": "$165–370" };

  function emptyState() {
    return { v: 2, balances: { RUB: 0, USD: 0, CRC: 0 }, entries: [] };
  }
  function lsGet() {
    try {
      var st = JSON.parse(localStorage.getItem(KEY) || "null");
      if (st && st.v === 2 && Array.isArray(st.entries)) {
        if (!st.balances) st.balances = { RUB: 0, USD: 0, CRC: 0 };
        return st;
      }
      var old = JSON.parse(localStorage.getItem("cr:budget:v1") || "null");
      if (old && old.v === 1 && Array.isArray(old.entries)) {
        var migrated = emptyState();
        migrated.entries = old.entries.map(function (en) {
          en.cur = en.cur || "USD";
          return en;
        });
        localStorage.setItem(KEY, JSON.stringify(migrated));
        localStorage.removeItem("cr:budget:v1");
        return migrated;
      }
    } catch (e) {}
    return emptyState();
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
  function num2(n) {
    var s = (Math.round(Number(n) * 100) / 100).toFixed(2);
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
    return parts.join(".");
  }
  function fmtMoney(n, cur) { return (SYM[cur] || "$") + num2(n); }
  function sumBy(list, cur) {
    var s = 0;
    list.forEach(function (en) { if (en.cur === cur) s += en.amount; });
    return s;
  }

  var state = lsGet();

  function render() {
    root.innerHTML =
      '<form class="tx-form">' +
        '<input type="date" class="tx-date" value="' + todayISO() + '" aria-label="Дата">' +
        '<input type="text" class="tx-note" placeholder="Что потратили" required>' +
        '<select class="tx-cat" aria-label="Категория">' +
          CATS.map(function (c) { return "<option>" + c + "</option>"; }).join("") +
        "</select>" +
        '<input type="number" class="tx-amount" placeholder="Сумма" min="0" step="0.01" inputmode="decimal" required>' +
        '<select class="tx-cur" aria-label="Валюта">' +
          CURS.map(function (c) {
            return '<option value="' + c + '"' + (c === "USD" ? " selected" : "") + ">" +
              SYM[c] + " " + c + "</option>";
          }).join("") +
        "</select>" +
        '<button type="submit">+ Добавить</button>' +
      "</form>" +
      '<div class="tx-balances">' +
        '<span class="tx-bal-lbl">Баланс:</span>' +
        CURS.map(function (c) {
          return '<label class="tx-bal">' + SYM[c] +
            '<input type="number" data-bal="' + c + '" min="0" step="0.01" inputmode="decimal" ' +
            'placeholder="0" aria-label="Баланс ' + c + '"></label>';
        }).join("") +
        '<span class="tx-bal-hint">остаток = баланс − траты по валюте</span>' +
      "</div>" +
      '<div class="tx-stats"></div>' +
      '<div class="tx-list"></div>' +
      '<div class="tx-tools"><button type="button" class="tx-csv">Скачать CSV</button></div>';

    root.querySelector(".tx-form").addEventListener("submit", onAdd);
    root.querySelector(".tx-csv").addEventListener("click", onCsv);
    root.querySelector(".tx-balances").addEventListener("change", onBalance);
    CURS.forEach(function (c) {
      var input = root.querySelector('[data-bal="' + c + '"]');
      if (input && state.balances[c] > 0) input.value = state.balances[c];
    });
    renderStats();
    renderList();
  }

  function onBalance() {
    CURS.forEach(function (c) {
      var input = root.querySelector('[data-bal="' + c + '"]');
      var v = parseFloat(input ? input.value : "");
      state.balances[c] = v > 0 ? Math.round(v * 100) / 100 : 0;
    });
    lsSet(state);
    renderStats();
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
      amount: Math.round(amount * 100) / 100,
      cur: f.querySelector(".tx-cur").value || "USD"
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
    var html = '<div class="tx-cur-row">';
    CURS.forEach(function (c) {
      var spent = sumBy(state.entries, c);
      var bal = state.balances[c] || 0;
      var left = bal > 0 ? bal - spent : null;
      html += '<div class="tx-cur-card" data-cur="' + c + '">' +
        '<span class="tx-cur-sym">' + SYM[c] + "</span>" +
        '<div class="tx-cur-line"><span>потрачено</span><b>' + fmtMoney(spent, c) + "</b></div>" +
        '<div class="tx-cur-line"><span>баланс</span><b>' + fmtMoney(bal, c) + "</b></div>" +
        '<div class="tx-cur-line"><span>остаток</span><b class="' +
          (left == null ? "muted" : left < 0 ? "neg" : "") + '">' +
          (left == null ? "—" : fmtMoney(left, c)) + "</b></div>" +
        "</div>";
    });
    html += "</div>";
    if (state.entries.length) {
      html += '<div class="tx-total">' +
        "<span>записей " + state.entries.length + "</span></div>";
    }
    html += '<div class="tx-cats">';
    CATS.forEach(function (c) {
      var sums = CURS.filter(function (cur) { return sumByCat(state.entries, c, cur) > 0; });
      if (!sums.length) return;
      html += '<div class="tx-cat-chip"><span class="c">' + c + "</span><b>" +
        sums.map(function (cur) {
          return fmtMoney(sumByCat(state.entries, c, cur), cur);
        }).join(" · ") + "</b>" +
        (PLAN[c] ? '<i class="plan">план ' + PLAN[c] + "</i>" : "") +
        "</div>";
    });
    html += "</div>";
    el.innerHTML = html;
  }

  function sumByCat(list, cat, cur) {
    var s = 0;
    list.forEach(function (en) { if (en.cat === cat && en.cur === cur) s += en.amount; });
    return s;
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
        '<span class="tx-sum">' + fmtMoney(en.amount, en.cur) + "</span>" +
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
    var lines = ["Дата;Категория;Описание;Сумма;Валюта"];
    state.entries.forEach(function (en) {
      lines.push([fmtDate(en.date), en.cat, en.note.replace(/;/g, ","), en.amount, en.cur].join(";"));
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
