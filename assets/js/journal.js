/* Коста-Рика 2026 — журнал поездки (дневник).
 *
 * Состояние: localStorage cr:journal:v1 → {v:1, entries:[{id,date,title,text}]}.
 * Записи: добавление, правка, удаление, экспорт в Markdown.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-journal]");
  if (!root) return;

  var KEY = "cr:journal:v1";
  var editing = null;

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

  var state = lsGet();

  function render() {
    root.innerHTML =
      '<form class="jr-form">' +
        '<div class="jr-form-row">' +
          '<input type="date" class="jr-date" value="' + todayISO() + '" aria-label="Дата">' +
          '<input type="text" class="jr-title" placeholder="Заголовок (необязательно)">' +
        "</div>" +
        '<textarea class="jr-text" rows="4" placeholder="Что произошло сегодня: места, люди, впечатления…" required></textarea>' +
        '<div class="jr-form-actions">' +
          '<button type="submit" class="jr-submit">Записать</button>' +
          '<button type="button" class="jr-cancel" hidden>Отмена</button>' +
        "</div>" +
      "</form>" +
      '<div class="jr-list"></div>' +
      '<div class="jr-tools"><button type="button" class="jr-md">Скачать .md</button></div>';

    root.querySelector(".jr-form").addEventListener("submit", onSubmit);
    root.querySelector(".jr-cancel").addEventListener("click", cancelEdit);
    root.querySelector(".jr-md").addEventListener("click", onExport);
    renderList();
  }

  function onSubmit(e) {
    e.preventDefault();
    var f = e.target;
    var date = f.querySelector(".jr-date").value || todayISO();
    var title = f.querySelector(".jr-title").value.replace(/\s+/g, " ").trim();
    var text = f.querySelector(".jr-text").value.trim();
    if (!text) return;

    if (editing) {
      state.entries.forEach(function (en) {
        if (en.id === editing) { en.date = date; en.title = title; en.text = text; }
      });
      cancelEdit();
    } else {
      state.entries.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        date: date, title: title, text: text
      });
      f.querySelector(".jr-text").value = "";
      f.querySelector(".jr-title").value = "";
    }
    lsSet(state);
    renderList();
  }

  function startEdit(id) {
    var en = null;
    state.entries.forEach(function (e) { if (e.id === id) en = e; });
    if (!en) return;
    editing = id;
    var f = root.querySelector(".jr-form");
    f.querySelector(".jr-date").value = en.date;
    f.querySelector(".jr-title").value = en.title || "";
    f.querySelector(".jr-text").value = en.text;
    f.querySelector(".jr-submit").textContent = "Сохранить";
    f.querySelector(".jr-cancel").hidden = false;
    f.querySelector(".jr-text").focus();
  }

  function cancelEdit() {
    editing = null;
    var f = root.querySelector(".jr-form");
    f.reset();
    f.querySelector(".jr-date").value = todayISO();
    f.querySelector(".jr-submit").textContent = "Записать";
    f.querySelector(".jr-cancel").hidden = true;
  }

  function onDelete(id) {
    if (window.confirm && !window.confirm("Удалить запись?")) return;
    state.entries = state.entries.filter(function (en) { return en.id !== id; });
    if (editing === id) cancelEdit();
    lsSet(state);
    renderList();
  }

  function sorted() {
    var idx = {};
    state.entries.forEach(function (en, i) { idx[en.id] = i; });
    return state.entries.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (idx[b.id] || 0) - (idx[a.id] || 0);
    });
  }

  function renderList() {
    var el = root.querySelector(".jr-list");
    if (!el) return;
    var list = sorted();
    if (!list.length) {
      el.innerHTML = '<div class="jr-empty">Пока пусто. Первая запись — самая ценная ✍️</div>';
      return;
    }
    el.innerHTML = list.map(function (en) {
      return '<article class="jr-entry" data-id="' + esc(en.id) + '">' +
        '<header class="jr-head">' +
          '<span class="jr-when">' + fmtDate(en.date) + "</span>" +
          (en.title ? '<h3 class="jr-h">' + esc(en.title) + "</h3>" : "") +
          '<span class="jr-btns">' +
            '<button type="button" class="jr-edit" aria-label="Править">✎</button>' +
            '<button type="button" class="jr-del" aria-label="Удалить">✕</button>' +
          "</span>" +
        "</header>" +
        '<div class="jr-body">' + esc(en.text).replace(/\n/g, "<br>") + "</div>" +
        "</article>";
    }).join("");
  }

  function onExport() {
    var lines = ["# Журнал поездки — Коста-Рика 2026", ""];
    sorted().forEach(function (en) {
      lines.push("## " + fmtDate(en.date) + (en.title ? " — " + en.title : ""));
      lines.push("");
      lines.push(en.text);
      lines.push("");
    });
    var blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kosta-rica-journal.md";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  root.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest(".jr-edit, .jr-del") : null;
    if (!t || !t.parentNode) return;
    var entry = t.closest(".jr-entry");
    if (!entry) return;
    var id = entry.getAttribute("data-id");
    if (t.classList.contains("jr-edit")) startEdit(id);
    else onDelete(id);
  });

  render();
})();
