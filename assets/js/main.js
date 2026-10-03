/* Коста-Рика 2026 — общие скрипты сайта */
(function () {
  "use strict";

  /* ---------- Активный пункт навигации ---------- */
  var path = location.pathname.split("/").pop() || "index.html";
  var page = path.replace(/\.html$/, "");
  var exact = false;
  document.querySelectorAll(".nav a").forEach(function (a) {
    if (a.dataset.page === page) { a.classList.add("active"); exact = true; }
  });
  if (!exact && page.indexOf("step-") === 0) {
    document.querySelectorAll('.nav a[data-page="steps"]').forEach(function (a) {
      a.classList.add("active");
    });
  }

  /* ---------- Мобильное меню ---------- */
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav");
  if (burger && nav) {
    burger.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") nav.classList.remove("open");
    });
  }

  /* ---------- Кнопка «наверх» ---------- */
  var totop = document.getElementById("totop");
  if (totop) {
    window.addEventListener("scroll", function () {
      totop.classList.toggle("show", window.scrollY > 500);
    }, { passive: true });
    totop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- Чек-листы: отметки сохраняются в localStorage ----------
     Редактируемые списки (.editable-list / .editable-summary) обслуживает
     свой движок — assets/js/editable-list.js, их здесь не трогаем. */
  var prose = document.querySelector(".prose");
  var boxes = prose
    ? Array.prototype.slice
        .call(prose.querySelectorAll('input[type="checkbox"]'))
        .filter(function (b) {
          return !b.closest(".editable-list") && !b.closest(".editable-summary");
        })
    : [];
  var storeKey = "cr:checks:" + page;

  function loadState() {
    try { return JSON.parse(localStorage.getItem(storeKey) || "[]"); } catch (e) { return []; }
  }
  function saveState() {
    var done = [];
    boxes.forEach(function (b, i) { if (b.checked) done.push(i); });
    try { localStorage.setItem(storeKey, JSON.stringify(done)); } catch (e) {}
    paintProgress();
  }

  var saved = loadState();
  boxes.forEach(function (b, i) {
    b.id = b.id || "chk-" + page + "-" + i;
    if (saved.indexOf(i) !== -1) b.checked = true;
    b.addEventListener("change", saveState);
  });

  /* ---------- Прогресс по чек-листу ---------- */
  var bar = null, label = null, fill = null;

  function paintProgress() {
    if (!label) return;
    var total = boxes.length;
    var done = boxes.filter(function (b) { return b.checked; }).length;
    label.textContent = "Отмечено " + done + " из " + total;
    fill.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    if (done === total && total > 0) label.textContent = "Всё готово! 🎉";
  }

  if (boxes.length && prose) {
    var wrap = document.createElement("div");
    wrap.className = "check-progress";
    label = document.createElement("span");
    fill = document.createElement("i");
    var track = document.createElement("span");
    track.className = "bar";
    track.appendChild(fill);
    var reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Сбросить";
    reset.style.cssText = "font:inherit;font-size:12.5px;border:1px solid var(--line);background:#fff;color:var(--ink-mute);border-radius:999px;padding:2px 10px;cursor:pointer";
    reset.addEventListener("click", function () {
      boxes.forEach(function (b) { b.checked = false; });
      saveState();
    });
    wrap.appendChild(label);
    wrap.appendChild(track);
    wrap.appendChild(reset);
    /* Список может лежать сколь угодно глубоко — например, внутри
       <details> на странице этапа. insertBefore принимает только прямого
       потомка, поэтому поднимаемся до него. */
    var anchor = boxes[0] && boxes[0].closest("ul, ol");
    while (anchor && anchor.parentNode !== prose) anchor = anchor.parentNode;
    prose.insertBefore(wrap, anchor || prose.firstChild);
    paintProgress();
  }

  /* ---------- Service worker: офлайн-кэш (только в браузере) ---------- */
  if ("serviceWorker" in navigator &&
      location.protocol.indexOf("http") === 0 &&
      !window.Capacitor) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  /* ---------- Тост ---------- */
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  /* ---------- Внешние ссылки без сети: тост вместо ошибки браузера ---------- */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target === "_blank") return;
    var url;
    try { url = new URL(a.getAttribute("href"), location.href); } catch (err) { return; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.origin !== location.origin && !navigator.onLine) {
      e.preventDefault();
      toast("Нет сети — ссылка откроется при подключении");
    }
  });

  /* ---------- Обратный отсчёт ---------- */
  var cd = document.getElementById("countdown");
  if (cd) {
    var target = new Date(cd.dataset.target).getTime();
    var cells = cd.querySelectorAll(".num");
    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) {
        cells[0].textContent = cells[1].textContent = cells[2].textContent = "0";
        cells[3].textContent = "—";
        cd.querySelectorAll(".lbl")[3].textContent = "выехали!";
        return;
      }
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      cells[0].textContent = d;
      cells[1].textContent = ("0" + h).slice(-2);
      cells[2].textContent = ("0" + m).slice(-2);
      cells[3].textContent = ("0" + s).slice(-2);
    }
    tick();
    setInterval(tick, 1000);
  }
})();
