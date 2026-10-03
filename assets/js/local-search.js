/* Коста-Рика 2026 — локальный поиск (Фаза 4, D15)
 *
 * Поиск по заголовкам и секциям текущей страницы.
 * Работает офлайн, без сервера.
 */
(function () {
  "use strict";

  var SEARCH_INPUT = document.getElementById("local-search");
  if (!SEARCH_INPUT) return;

  // Индекс: { id, title, section, text, href }
  var INDEX = [];
  var RESULTS_EL = document.getElementById("search-results");
  var HIGHLIGHT_COLOR = "#fef08a";

  // Сбор индекса из текущей страницы
  function buildIndex() {
    var headings = document.querySelectorAll("h2, h3");
    for (var i = 0; i < headings.length; i++) {
      var h = headings[i];
      var id = h.id || "section-" + i;
      h.id = id;

      // Собираем текст до следующего заголовка того же уровня
      var text = "";
      var next = h.nextElementSibling;
      while (next && !/^H[2-3]$/i.test(next.tagName)) {
        text += " " + next.textContent;
        next = next.nextElementSibling;
      }

      INDEX.push({
        id: id,
        title: h.textContent.trim(),
        level: h.tagName,
        text: text.replace(/\s+/g, " ").trim(),
        href: "#" + id
      });
    }

    // Добавляем чекбоксы
    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (var j = 0; j < checkboxes.length; j++) {
      var cb = checkboxes[j];
      var label = cb.closest("label") || cb.parentElement;
      if (label) {
        var labelText = label.textContent.replace(/\s+/g, " ").trim().substring(0, 100);
        INDEX.push({
          id: "cb-" + j,
          title: "Чекбокс: " + labelText.substring(0, 50),
          level: "H4",
          text: labelText,
          href: "#cb-" + j,
          isCheckbox: true
        });
      }
    }
  }

  // Поиск
  function search(query) {
    if (!query || query.length < 2) {
      RESULTS_EL.innerHTML = "";
      return;
    }

    var q = query.toLowerCase();
    var results = [];

    for (var i = 0; i < INDEX.length; i++) {
      var item = INDEX[i];
      var titleLower = item.title.toLowerCase();
      var textLower = item.text.toLowerCase();

      if (titleLower.indexOf(q) !== -1 || textLower.indexOf(q) !== -1) {
        results.push({
          score: (titleLower.indexOf(q) !== -1 ? 10 : 0) + textLower.indexOf(q) === -1 ? 0 : 5,
          item: item
        });
      }
    }

    // Сортировка по релевантности
    results.sort(function (a, b) { return b.score - a.score; });

    // Рендеринг результатов
    if (results.length === 0) {
      RESULTS_EL.innerHTML = '<div class="search-empty">Ничего не найдено по запросу "' + escapeHtml(query) + '"</div>';
      return;
    }

    var html = '<div class="search-count">Найдено: ' + results.length + '</div><ul>';
    for (var j = 0; j < Math.min(results.length, 20); j++) {
      var r = results[j].item;
      var icon = r.level === "H2" ? "📄" : r.level === "H3" ? "📑" : "✅";
      html += '<li class="search-result">' +
        '<a href="' + r.href + '" class="search-result-link">' +
        '<span class="search-result-icon">' + icon + '</span>' +
        '<span class="search-result-title">' + escapeHtml(r.title) + '</span>' +
        '<span class="search-result-preview">' + escapeHtml(r.text.substring(0, 80)) + '...</span>' +
        '</a></li>';
    }
    html += '</ul>';
    RESULTS_EL.innerHTML = html;
  }

  // Подсветка найденного текста
  function highlightText(el, query) {
    if (!query || query.length < 2) return;
    var textNodes = getTextNodes(el);
    for (var i = 0; i < textNodes.length; i++) {
      var node = textNodes[i];
      var text = node.textContent;
      var lower = text.toLowerCase();
      var q = query.toLowerCase();
      var idx = lower.indexOf(q);
      if (idx !== -1) {
        var span = document.createElement("mark");
        span.style.background = HIGHLIGHT_COLOR;
        span.style.padding = "1px 2px";
        span.style.borderRadius = "2px";
        var before = text.substring(0, idx);
        var match = text.substring(idx, idx + query.length);
        var after = text.substring(idx + query.length);
        node.parentNode.replaceChild(createFragment([
          before.length ? document.createTextNode(before) : null,
          document.createTextNode(match),
          after.length ? document.createTextNode(after) : null
        ].filter(Boolean)), node);
      }
    }
  }

  function getTextNodes(el) {
    var nodes = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while (node = walker.nextNode()) nodes.push(node);
    return nodes;
  }

  function createFragment(nodes) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i]) frag.appendChild(nodes[i]);
    }
    return frag;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Event listeners
  SEARCH_INPUT.addEventListener("input", function (e) {
    search(e.target.value);
  });

  SEARCH_INPUT.addEventListener("focus", function () {
    if (SEARCH_INPUT.value.length >= 2) {
      search(SEARCH_INPUT.value);
    }
  });

  // Keyboard shortcut: / для поиска
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== SEARCH_INPUT) {
      e.preventDefault();
      SEARCH_INPUT.focus();
    }
    if (e.key === "Escape" && document.activeElement === SEARCH_INPUT) {
      SEARCH_INPUT.blur();
      RESULTS_EL.innerHTML = "";
    }
  });

  buildIndex();
})();
