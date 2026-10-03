/* Коста-Рика 2026 — движок редактируемых чек-листов.
 *
 * Режимы:
 *  - overlay (.editable-list): база в DOM + оверлей в localStorage (cr:list:v1:<key>);
 *  - summary (.editable-summary): рендер из seed-JSON (<script id="<key>-seed">).
 *
 * Модель состояния (v:1):
 *  {
 *    v: 1,
 *    items:            { id: {text?, checked?, weight?} },  // правки базовых пунктов
 *    deleted:          ["id", ...],                         // удалённые базовые пункты
 *    deletedSections:  ["sid", ...],                        // удалённые базовые разделы
 *    order:            { sid: ["id" | "custom:uid", ...] }, // порядок в разделе
 *    customs:          { sid: [{uid, text, checked, weight?}] },
 *    newSections:      [{uid, title}],
 *    sectionTitles:    { sid: "..." }                       // переименования
 *  }
 *
 * Старые отметки cr:checks:<key> (а для «Дел» — cr:checks:index)
 * мигрируют в items[id].checked один раз, затем удаляются.
 */
(function () {
  "use strict";

  var PREFIX = "cr:list:v1:";

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function fmtKg(g) { return (g / 1000).toFixed(1).replace(".", ",") + " кг"; }
  function selId(id) { return 'li[data-id="' + String(id).replace(/["\\]/g, "") + '"]'; }

  function emptyState() {
    return {
      v: 1,
      items: {},
      deleted: [],
      deletedSections: [],
      order: {},
      customs: {},
      newSections: [],
      sectionTitles: {}
    };
  }

  function normalizeState(st) {
    var d = emptyState();
    Object.keys(d).forEach(function (k) {
      if (k === "v") return;
      var same = Object.prototype.toString.call(st[k]) === Object.prototype.toString.call(d[k]);
      st[k] = same ? st[k] : d[k];
    });
    st.v = 1;
    return st;
  }

  function ListCtl(root) {
    this.root = root;
    this.key = root.getAttribute("data-list-key");
    this.label = root.getAttribute("data-label") || "отмечено";
    this.limit = parseInt(root.getAttribute("data-weight-limit"), 10) || 0;
    this.summary = root.classList.contains("editable-summary");
    this.baseIds = [];
    this.baseSections = [];
    this.baseText = {};
    this.baseChecked = {};
    this.baseWeight = {};
    this.baseHead = {};
    this.editing = false;
    this.state = null;
  }

  /* ---------- поиск элементов ---------- */

  ListCtl.prototype.byId = function (id) {
    return this.root.querySelector(selId(id));
  };

  ListCtl.prototype.headEl = function (sid) {
    if (!sid) return null;
    var els = this.root.querySelectorAll("h2[id], h3[id]");
    for (var i = 0; i < els.length; i++) if (els[i].id === sid) return els[i];
    return null;
  };

  ListCtl.prototype.lisOf = function (sid) {
    var out = [];
    Array.prototype.forEach.call(this.root.querySelectorAll("li[data-section]"), function (li) {
      if (li.getAttribute("data-section") === sid) out.push(li);
    });
    return out;
  };

  ListCtl.prototype.collectSids = function () {
    var seen = {}, out = [];
    Array.prototype.forEach.call(this.root.querySelectorAll("li[data-section]"), function (li) {
      var sid = li.getAttribute("data-section");
      if (sid && !seen[sid]) { seen[sid] = 1; out.push(sid); }
    });
    Array.prototype.forEach.call(this.root.querySelectorAll("h2[id], h3[id]"), function (h) {
      if (!seen[h.id]) { seen[h.id] = 1; out.push(h.id); }
    });
    return out;
  };

  ListCtl.prototype.sampleUlClass = function () {
    var u = this.root.querySelector("ul");
    return u ? u.className : "task-list";
  };

  ListCtl.prototype.listOf = function (sid) {
    var lis = this.lisOf(sid);
    if (lis.length) return lis[0].parentNode;
    var h = this.headEl(sid);
    if (!h) return null;
    var el = h.nextElementSibling;
    while (el && el.tagName !== "UL" && el.tagName !== "OL" && !/^H[1-6]$/.test(el.tagName)) {
      el = el.nextElementSibling;
    }
    if (el && (el.tagName === "UL" || el.tagName === "OL")) return el;
    var ul = document.createElement("ul");
    ul.className = this.sampleUlClass();
    h.parentNode.insertBefore(ul, h.nextSibling);
    return ul;
  };

  /* ---------- нормализация разметки ---------- */

  ListCtl.prototype.textOf = function (li) {
    var span = li.querySelector(".li-text");
    if (span) return span;
    span = document.createElement("span");
    span.className = "li-text";
    var input = li.querySelector("input[type=checkbox]");
    if (input) {
      var host = input.parentNode;
      var node = input.nextSibling;
      while (node) {
        var next = node.nextSibling;
        if (node.nodeType === 1 && (node.classList.contains("li-ctl") || node.classList.contains("li-weight"))) {
          node = next;
          continue;
        }
        span.appendChild(node);
        node = next;
      }
      host.appendChild(span);
    } else {
      span.textContent = norm(li.textContent);
      li.textContent = "";
      li.appendChild(span);
    }
    return span;
  };

  ListCtl.prototype.headText = function (h) {
    var s = h.querySelector(".h-text");
    return s || h;
  };

  ListCtl.prototype.ensureHeadText = function (h) {
    if (h.querySelector(".h-text")) return;
    var span = document.createElement("span");
    span.className = "h-text";
    var node = h.firstChild;
    while (node) {
      var next = node.nextSibling;
      if (node.nodeType === 1 && node.classList.contains("h-ctl")) { node = next; continue; }
      span.appendChild(node);
      node = next;
    }
    h.appendChild(span);
  };

  ListCtl.prototype.renderWeight = function (li) {
    var w = li.getAttribute("data-weight");
    var chip = li.querySelector(".li-weight");
    if (w === null) {
      if (chip) chip.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "li-weight";
      li.appendChild(chip);
    }
    chip.textContent = w + " г";
  };

  /* ---------- состояние ---------- */

  ListCtl.prototype.load = function () {
    var raw = lsGet(PREFIX + this.key);
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (s && s.v === 1) return normalizeState(s);
      } catch (e) {}
    }
    return this.migrate();
  };

  ListCtl.prototype.migrate = function () {
    var oldKeys = this.key === "dela" ? ["cr:checks:index"] : ["cr:checks:" + this.key];
    for (var i = 0; i < oldKeys.length; i++) {
      var raw = lsGet(oldKeys[i]);
      if (raw === null) continue;
      var idx = null;
      try { idx = JSON.parse(raw); } catch (e) {}
      lsRemove(oldKeys[i]);
      if (Object.prototype.toString.call(idx) !== "[object Array]") continue;
      if (!idx.length || !this.baseIds.length) continue;
      var st = emptyState();
      var self = this;
      idx.forEach(function (n) {
        var id = self.baseIds[n];
        if (id) st.items[id] = { checked: true };
      });
      lsSet(PREFIX + this.key, JSON.stringify(st));
      return st;
    }
    return null;
  };

  ListCtl.prototype.save = function () {
    lsSet(PREFIX + this.key, JSON.stringify(this.state));
  };

  /* ---------- применение оверлея к DOM ---------- */

  ListCtl.prototype.applyState = function () {
    if (!this.state) this.state = emptyState();
    var st = this.state;
    var self = this;

    st.deletedSections.forEach(function (sid) {
      var h = self.headEl(sid);
      if (h) h.remove();
      self.lisOf(sid).forEach(function (li) { li.remove(); });
      self.findAddRow(sid).remove();
    });

    st.deleted.forEach(function (id) {
      var li = self.byId(id);
      if (li) li.remove();
    });

    Object.keys(st.sectionTitles).forEach(function (sid) {
      var h = self.headEl(sid);
      if (h) self.headText(h).textContent = st.sectionTitles[sid];
    });

    st.newSections.forEach(function (s) {
      if (!self.headEl(s.uid)) self.createSection(s);
    });

    Object.keys(st.items).forEach(function (id) {
      var li = self.byId(id);
      if (!li || li.hasAttribute("data-custom")) return;
      var o = st.items[id];
      if (o.text != null) self.textOf(li).textContent = o.text;
      if (o.checked != null) {
        var cb = li.querySelector("input[type=checkbox]");
        if (cb) cb.checked = !!o.checked;
      }
      if (o.weight !== undefined) {
        if (o.weight === null) li.removeAttribute("data-weight");
        else li.setAttribute("data-weight", String(o.weight));
      }
      self.renderWeight(li);
    });

    Object.keys(st.customs).forEach(function (sid) {
      st.customs[sid].forEach(function (c) {
        if (self.root.querySelector(selId("custom:" + c.uid))) return;
        var ul = self.listOf(sid);
        if (!ul) return;
        var li = self.createCustom(c, sid);
        ul.appendChild(li);
        self.renderWeight(li);
      });
    });

    Object.keys(st.order).forEach(function (sid) { self.applyOrder(sid); });
  };

  ListCtl.prototype.applyOrder = function (sid) {
    var order = this.state.order[sid];
    if (!order || order.length < 2) return;
    var lis = this.lisOf(sid);
    if (lis.length < 2) return;
    var byKey = {};
    lis.forEach(function (li) { byKey[li.getAttribute("data-id")] = li; });
    var ul = lis[0].parentNode;
    var seq = order.slice();
    Object.keys(byKey).forEach(function (k) { if (seq.indexOf(k) === -1) seq.push(k); });
    seq.forEach(function (k) { if (byKey[k]) ul.appendChild(byKey[k]); });
  };

  ListCtl.prototype.createSection = function (s) {
    var h = document.createElement("h2");
    h.id = s.uid;
    h.setAttribute("data-new-section", "1");
    h.textContent = s.title;
    this.ensureHeadText(h);
    var ul = document.createElement("ul");
    ul.className = this.sampleUlClass();
    var anchor = this.root.querySelector(".add-section");
    if (anchor) {
      this.root.insertBefore(h, anchor);
      this.root.insertBefore(ul, anchor);
    } else {
      this.root.appendChild(h);
      this.root.appendChild(ul);
    }
    return h;
  };

  ListCtl.prototype.createCustom = function (c, sid) {
    var li = document.createElement("li");
    li.setAttribute("data-id", "custom:" + c.uid);
    li.setAttribute("data-custom", "1");
    li.setAttribute("data-section", sid);
    if (c.weight != null) li.setAttribute("data-weight", String(c.weight));
    var label = document.createElement("label");
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!c.checked;
    label.appendChild(input);
    label.appendChild(document.createTextNode(" "));
    var span = document.createElement("span");
    span.className = "li-text";
    span.textContent = c.text || "…";
    label.appendChild(span);
    li.appendChild(label);
    return li;
  };

  /* ---------- синхронизация DOM → состояние ---------- */

  ListCtl.prototype.resync = function () {
    var self = this;
    var st = this.state;

    st.deleted = this.baseIds.filter(function (id) { return !self.byId(id); });
    st.deletedSections = this.baseSections.filter(function (sid) { return !self.headEl(sid); });

    var items = {};
    this.baseIds.forEach(function (id) {
      var li = self.byId(id);
      if (!li || li.hasAttribute("data-custom")) return;
      var o = {};
      if (norm(self.textOf(li).textContent) !== self.baseText[id]) o.text = norm(self.textOf(li).textContent);
      var w = li.getAttribute("data-weight");
      var wn = w === null ? null : parseInt(w, 10);
      if (wn !== self.baseWeight[id]) o.weight = wn;
      var cb = li.querySelector("input[type=checkbox]");
      var checked = cb ? cb.checked : false;
      if (checked !== self.baseChecked[id]) o.checked = checked;
      if (o.text !== undefined || o.weight !== undefined || o.checked !== undefined) items[id] = o;
    });
    st.items = items;

    var titles = {};
    Object.keys(this.baseHead).forEach(function (sid) {
      var h = self.headEl(sid);
      if (!h) return;
      var t = norm(self.headText(h).textContent);
      if (t !== self.baseHead[sid]) titles[sid] = t;
    });
    st.sectionTitles = titles;

    var order = {}, customs = {};
    this.collectSids().forEach(function (sid) {
      var lis = self.lisOf(sid);
      if (lis.length) {
        order[sid] = lis.map(function (li) { return li.getAttribute("data-id"); });
      }
      var cs = [];
      lis.forEach(function (li) {
        if (!li.hasAttribute("data-custom")) return;
        var cb = li.querySelector("input[type=checkbox]");
        var c = {
          uid: li.getAttribute("data-id").slice(7),
          text: norm(self.textOf(li).textContent),
          checked: cb ? cb.checked : false
        };
        var w = li.getAttribute("data-weight");
        if (w !== null) c.weight = parseInt(w, 10);
        cs.push(c);
      });
      if (cs.length) customs[sid] = cs;
    });
    st.order = order;
    st.customs = customs;

    var news = [];
    Array.prototype.forEach.call(this.root.querySelectorAll("h2[data-new-section], h3[data-new-section]"), function (h) {
      news.push({ uid: h.id, title: norm(self.headText(h).textContent) });
    });
    st.newSections = news;
  };

  ListCtl.prototype.resyncSummary = function () {
    var self = this;
    var st = this.state;
    var items = st.items;

    Array.prototype.forEach.call(this.root.querySelectorAll("li[data-id]"), function (li) {
      if (li.hasAttribute("data-custom")) return;
      var id = li.getAttribute("data-id");
      var cb = li.querySelector("input[type=checkbox]");
      var checked = cb ? cb.checked : false;
      var o = items[id];
      if (checked !== self.baseChecked[id]) {
        if (!o) o = items[id] = {};
        o.checked = checked;
      } else if (o) {
        delete o.checked;
        if (!Object.keys(o).length) delete items[id];
      }
    });

    Array.prototype.forEach.call(this.root.querySelectorAll("li[data-custom]"), function (li) {
      var uid = li.getAttribute("data-id").slice(7);
      var arr = st.customs[li.getAttribute("data-section")];
      if (!arr) return;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].uid === uid) {
          var cb = li.querySelector("input[type=checkbox]");
          arr[i].checked = cb ? cb.checked : false;
        }
      }
    });
  };

  /* ---------- commit / прогресс ---------- */

  ListCtl.prototype.commit = function (structural) {
    if (this.summary) this.resyncSummary();
    else this.resync();
    this.save();
    this.paint();
    if (structural && this.editing) this.setEditUI(true);
  };

  ListCtl.prototype.paint = function () {
    var total = 0, done = 0, grams = 0, hasW = false;
    Array.prototype.forEach.call(this.root.querySelectorAll("li[data-id]"), function (li) {
      total++;
      var w = li.getAttribute("data-weight");
      if (w !== null) hasW = true;
      var cb = li.querySelector("input[type=checkbox]");
      if (cb && cb.checked) {
        done++;
        if (w !== null) grams += parseInt(w, 10) || 0;
      }
    });
    this.$label.textContent = (total > 0 && done === total)
      ? "Всё готово! 🎉"
      : this.label + ": " + done + " из " + total;
    this.$fill.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    if (hasW) {
      this.$weight.textContent = this.limit
        ? fmtKg(grams) + " / " + fmtKg(this.limit)
        : fmtKg(grams);
      this.$weight.classList.toggle("over", grams > this.limit);
    } else {
      this.$weight.textContent = "";
      this.$weight.classList.remove("over");
    }
  };

  /* ---------- интерфейс ---------- */

  ListCtl.prototype.buildProgress = function () {
    var prog = document.createElement("div");
    prog.className = "check-progress list-progress";

    var label = document.createElement("span");
    var track = document.createElement("span");
    track.className = "bar";
    var fill = document.createElement("i");
    track.appendChild(fill);
    var weight = document.createElement("span");
    weight.className = "prog-weight";
    var reset = document.createElement("button");
    reset.type = "button";
    reset.className = "prog-reset";
    reset.textContent = "Сбросить";

    prog.appendChild(label);
    prog.appendChild(track);
    prog.appendChild(weight);
    prog.appendChild(reset);
    this.root.insertBefore(prog, this.root.firstChild);

    this.$prog = prog;
    this.$label = label;
    this.$fill = fill;
    this.$weight = weight;
  };

  ListCtl.prototype.buildToolbar = function () {
    if (this.summary) return;
    var bar = document.createElement("div");
    bar.className = "list-toolbar";
    [["edit", "✎ Редактировать"], ["export", "Экспорт JSON"],
     ["import", "Импорт"], ["original", "Исходный список"]].forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-act", a[0]);
      b.textContent = a[1];
      bar.appendChild(b);
    });
    var file = document.createElement("input");
    file.type = "file";
    file.accept = "application/json,.json";
    file.className = "import-file";
    bar.appendChild(file);
    this.root.insertBefore(bar, this.$prog.nextSibling);

    this.$editBtn = bar.querySelector('[data-act="edit"]');
    this.$file = file;
  };

  ListCtl.prototype.setEditUI = function (on) {
    this.editing = on;
    this.root.classList.toggle("editing", on);
    this.removeEditUI();
    if (on) this.injectEditUI();
  };

  ListCtl.prototype.removeEditUI = function () {
    Array.prototype.forEach.call(
      this.root.querySelectorAll(".li-ctl, .h-ctl, .editing-only"),
      function (el) { el.remove(); }
    );
  };

  ListCtl.prototype.injectEditUI = function () {
    var self = this;

    Array.prototype.forEach.call(this.root.querySelectorAll("li[data-id]"), function (li) {
      if (li.querySelector(".li-ctl")) return;
      var ctl = document.createElement("span");
      ctl.className = "li-ctl";
      [["up", "↑", "Выше"], ["down", "↓", "Ниже"], ["edit", "✎", "Переименовать"], ["del", "✕", "Удалить"]]
        .forEach(function (p) {
          var b = document.createElement("button");
          b.type = "button";
          b.setAttribute("data-a", p[0]);
          b.textContent = p[1];
          b.title = p[2];
          ctl.appendChild(b);
        });
      var label = li.querySelector("label");
      (label || li).appendChild(ctl);
    });

    Array.prototype.forEach.call(this.root.querySelectorAll("h2[id], h3[id]"), function (h) {
      if (h.querySelector(".h-ctl")) return;
      var ctl = document.createElement("span");
      ctl.className = "h-ctl";
      [["rename", "✎", "Переименовать"], ["delsection", "✕", "Удалить раздел"]].forEach(function (p) {
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("data-a", p[0]);
        b.textContent = p[1];
        b.title = p[2];
        ctl.appendChild(b);
      });
      h.appendChild(ctl);
    });

    this.collectSids().forEach(function (sid) {
      if (!self.headEl(sid)) return;
      var ul = self.listOf(sid);
      if (!ul) return;
      var row = document.createElement("div");
      row.className = "add-row editing-only";
      row.setAttribute("data-sid", sid);
      var input = document.createElement("input");
      input.type = "text";
      input.className = "add-row-input";
      input.placeholder = "Новый пункт…";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-a", "additem");
      btn.textContent = "+ Добавить";
      row.appendChild(input);
      row.appendChild(btn);
      ul.parentNode.insertBefore(row, ul.nextSibling);
    });

    var sec = document.createElement("div");
    sec.className = "add-section editing-only";
    var sInput = document.createElement("input");
    sInput.type = "text";
    sInput.className = "add-section-input";
    sInput.placeholder = "Новый раздел…";
    var sBtn = document.createElement("button");
    sBtn.type = "button";
    sBtn.setAttribute("data-a", "addsection");
    sBtn.textContent = "+ Раздел";
    sec.appendChild(sInput);
    sec.appendChild(sBtn);
    this.root.appendChild(sec);
  };

  /* ---------- операции ---------- */

  ListCtl.prototype.genUid = function () {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  };

  ListCtl.prototype.findAddRow = function (sid) {
    var rows = this.root.querySelectorAll(".add-row");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-sid") === sid) return rows[i];
    }
    return { remove: function () {} };
  };

  ListCtl.prototype.addItem = function (row) {
    var input = row.querySelector("input.add-row-input");
    var v = norm(input && input.value);
    if (!v) {
      if (input) input.focus();
      return;
    }
    var sid = row.getAttribute("data-sid");
    var ul = this.listOf(sid);
    if (!ul) return;
    var li = this.createCustom({ uid: this.genUid(), text: v, checked: false }, sid);
    ul.appendChild(li);
    this.commit(true);
    var again = this.findAddRow(sid);
    var next = again.querySelector && again.querySelector("input");
    if (next) next.focus();
  };

  ListCtl.prototype.addSection = function (row) {
    var input = row.querySelector("input.add-section-input");
    var v = norm(input && input.value);
    if (!v) {
      if (input) input.focus();
      return;
    }
    this.createSection({ uid: "s" + this.genUid(), title: v });
    this.commit(true);
    var sec = null;
    var all = this.root.querySelectorAll(".add-section");
    if (all.length) sec = all[all.length - 1];
    var next = sec && sec.querySelector("input");
    if (next) next.focus();
  };

  ListCtl.prototype.move = function (li, dir) {
    var lis = this.lisOf(li.getAttribute("data-section"));
    var i = lis.indexOf(li);
    var j = i + dir;
    if (i === -1 || j < 0 || j >= lis.length) return;
    var other = lis[j];
    if (dir < 0) other.parentNode.insertBefore(li, other);
    else other.parentNode.insertBefore(li, other.nextSibling);
    this.commit();
  };

  ListCtl.prototype.delItem = function (li) {
    if (!confirm("Удалить пункт?")) return;
    li.remove();
    this.commit();
  };

  ListCtl.prototype.editItem = function (li) {
    if (li.querySelector("input.li-edit")) return;
    var span = this.textOf(li);
    var input = document.createElement("input");
    input.type = "text";
    input.className = "li-edit";
    input.value = norm(span.textContent);
    span.style.display = "none";
    span.parentNode.insertBefore(input, span);
    input.focus();
    input.select();
  };

  ListCtl.prototype.commitEdit = function (input) {
    if (!input.parentNode) return;
    var li = input.closest("li[data-id]");
    if (!li) return;
    var span = this.textOf(li);
    var v = norm(input.value);
    if (v) span.textContent = v;
    input.remove();
    span.style.display = "";
    this.commit();
  };

  ListCtl.prototype.cancelEdit = function (input) {
    if (!input.parentNode) return;
    var li = input.closest("li[data-id]");
    input.remove();
    if (li) {
      var span = this.textOf(li);
      span.style.display = "";
    }
  };

  ListCtl.prototype.renameSection = function (h) {
    if (h.querySelector("input.h-edit")) return;
    var span = this.headText(h);
    var input = document.createElement("input");
    input.type = "text";
    input.className = "h-edit";
    input.value = norm(span.textContent);
    input.setAttribute("data-old", norm(span.textContent));
    span.style.display = "none";
    h.insertBefore(input, span);
    input.focus();
    input.select();
  };

  ListCtl.prototype.commitRename = function (input) {
    if (!input.parentNode) return;
    var h = input.closest("h2[id], h3[id]");
    if (!h) return;
    var span = this.headText(h);
    var v = norm(input.value) || input.getAttribute("data-old");
    input.remove();
    span.style.display = "";
    span.textContent = v;
    this.commit();
  };

  ListCtl.prototype.cancelRename = function (input) {
    if (!input.parentNode) return;
    var h = input.closest("h2[id], h3[id]");
    input.remove();
    if (h) {
      var span = this.headText(h);
      span.style.display = "";
    }
  };

  ListCtl.prototype.delSection = function (h) {
    if (!confirm("Удалить раздел вместе со всеми пунктами?")) return;
    var sid = h.id;
    this.lisOf(sid).forEach(function (li) { li.remove(); });
    var row = this.findAddRow(sid);
    if (row.remove) row.remove();
    h.remove();
    this.commit();
  };

  ListCtl.prototype.toolbar = function (act) {
    var self = this;
    if (act === "edit") {
      this.setEditUI(!this.editing);
      this.$editBtn.textContent = this.editing ? "✓ Готово" : "✎ Редактировать";
      this.$editBtn.classList.toggle("on", this.editing);
    } else if (act === "export") {
      var blob = new Blob([JSON.stringify(this.state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = this.key + "-spisok.json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    } else if (act === "import") {
      this.$file.click();
    } else if (act === "original") {
      if (!confirm("Вернуть исходный список? Отметки и правки будут потеряны.")) return;
      lsRemove(PREFIX + this.key);
      lsRemove("cr:checks:" + this.key);
      if (this.key === "dela") lsRemove("cr:checks:index");
      location.reload();
    }
  };

  /* ---------- события ---------- */

  ListCtl.prototype.bind = function () {
    var self = this;
    var root = this.root;

    root.addEventListener("change", function (e) {
      if (e.target.tagName === "INPUT" && e.target.type === "checkbox") self.commit();
    });

    root.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t || !root.contains(t)) return;

      var act = t.getAttribute("data-act");
      if (act) {
        self.toolbar(act);
        return;
      }
      if (t.classList.contains("prog-reset")) {
        Array.prototype.forEach.call(root.querySelectorAll("li input[type=checkbox]"), function (cb) {
          cb.checked = false;
        });
        self.commit();
        return;
      }

      var a = t.getAttribute("data-a");
      if (!a) return;
      if (a === "additem") {
        var row = t.closest(".add-row");
        if (row) self.addItem(row);
        return;
      }
      if (a === "addsection") {
        var sec = t.closest(".add-section");
        if (sec) self.addSection(sec);
        return;
      }
      var li = t.closest("li[data-id]");
      if (li) {
        if (a === "up") self.move(li, -1);
        else if (a === "down") self.move(li, 1);
        else if (a === "edit") self.editItem(li);
        else if (a === "del") self.delItem(li);
        return;
      }
      var h = t.closest("h2[id], h3[id]");
      if (h) {
        if (a === "rename") self.renameSection(h);
        else if (a === "delsection") self.delSection(h);
      }
    });

    root.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t.tagName !== "INPUT" || t.type === "checkbox") return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (t.classList.contains("add-row-input")) {
          var row = t.closest(".add-row");
          if (row) self.addItem(row);
        } else if (t.classList.contains("add-section-input")) {
          var sec = t.closest(".add-section");
          if (sec) self.addSection(sec);
        } else if (t.classList.contains("li-edit")) {
          self.commitEdit(t);
        } else if (t.classList.contains("h-edit")) {
          self.commitRename(t);
        }
      } else if (e.key === "Escape") {
        if (t.classList.contains("li-edit")) self.cancelEdit(t);
        else if (t.classList.contains("h-edit")) self.cancelRename(t);
        else t.value = "";
      }
    });

    if (this.$file) {
      this.$file.addEventListener("change", function () {
        var f = self.$file.files && self.$file.files[0];
        self.$file.value = "";
        if (!f) return;
        f.text().then(function (txt) {
          var st = null;
          try { st = JSON.parse(txt); } catch (e) {}
          if (!st || st.v !== 1) {
            alert("Не тот файл: нужен JSON-экспорт этого списка (v:1).");
            return;
          }
          lsSet(PREFIX + self.key, JSON.stringify(normalizeState(st)));
          location.reload();
        });
      });
    }
  };

  /* ---------- инициализация ---------- */

  ListCtl.prototype.initOverlay = function () {
    var self = this;

    Array.prototype.forEach.call(this.root.querySelectorAll("li[data-id]"), function (li) {
      var id = li.getAttribute("data-id");
      if (self.baseIds.indexOf(id) !== -1) return;
      self.baseIds.push(id);
      self.baseText[id] = norm(self.textOf(li).textContent);
      var cb = li.querySelector("input[type=checkbox]");
      self.baseChecked[id] = cb ? cb.checked : false;
      var w = li.getAttribute("data-weight");
      self.baseWeight[id] = w === null ? null : parseInt(w, 10);
      self.renderWeight(li);
    });

    Array.prototype.forEach.call(this.root.querySelectorAll("h2[id], h3[id]"), function (h) {
      self.ensureHeadText(h);
      self.baseHead[h.id] = norm(self.headText(h).textContent);
      if (self.baseSections.indexOf(h.id) === -1) self.baseSections.push(h.id);
    });

    this.state = this.load();
    this.applyState();
    this.buildProgress();
    this.buildToolbar();
    this.bind();
    this.paint();
  };

  ListCtl.prototype.initSummary = function () {
    var seedEl = document.getElementById(this.key + "-seed");
    this.seed = { sections: [] };
    if (seedEl) {
      try { this.seed = JSON.parse(seedEl.textContent); } catch (e) {}
    }

    var self = this;
    (this.seed.sections || []).forEach(function (s) {
      if (self.baseSections.indexOf(s.id) === -1) self.baseSections.push(s.id);
      self.baseHead[s.id] = norm(s.title);
      (s.items || []).forEach(function (it) {
        if (self.baseIds.indexOf(it.id) !== -1) return;
        self.baseIds.push(it.id);
        self.baseText[it.id] = norm(it.text);
        self.baseChecked[it.id] = !!it.checked;
      });
    });

    this.state = this.load();
    if (!this.state) this.state = emptyState();
    this.renderSummary();
    this.buildProgress();
    this.bind();
    this.paint();
  };

  ListCtl.prototype.renderSummary = function () {
    var self = this;
    var st = this.state;
    var root = this.root;
    while (root.firstChild) root.removeChild(root.firstChild);

    var sections = [];
    (this.seed.sections || []).forEach(function (s) {
      if (st.deletedSections.indexOf(s.id) !== -1) return;
      sections.push({ id: s.id, title: st.sectionTitles[s.id] || s.title, base: s });
    });
    (st.newSections || []).forEach(function (s) {
      sections.push({ id: s.uid, title: s.title, base: null });
    });

    sections.forEach(function (sec) {
      var map = {};
      if (sec.base) {
        (sec.base.items || []).forEach(function (it) {
          if (st.deleted.indexOf(it.id) !== -1) return;
          var o = st.items[it.id] || {};
          map[it.id] = {
            key: it.id,
            uid: null,
            text: o.text != null ? o.text : it.text,
            checked: o.checked != null ? !!o.checked : !!it.checked
          };
        });
      }
      (st.customs[sec.id] || []).forEach(function (c) {
        map["custom:" + c.uid] = {
          key: "custom:" + c.uid,
          uid: c.uid,
          text: c.text,
          checked: !!c.checked
        };
      });

      var order = st.order[sec.id];
      var keys = Object.keys(map);
      var seq = order ? order.filter(function (k) { return map[k]; }) : keys.slice();
      keys.forEach(function (k) { if (seq.indexOf(k) === -1) seq.push(k); });

      var h = document.createElement("h3");
      h.id = sec.id;
      h.textContent = sec.title;
      root.appendChild(h);
      if (!seq.length) return;

      var ul = document.createElement("ul");
      ul.className = "todo-list summary-todo";
      seq.forEach(function (k) {
        var it = map[k];
        var li = document.createElement("li");
        li.setAttribute("data-id", it.key);
        li.setAttribute("data-section", sec.id);
        if (it.uid) li.setAttribute("data-custom", "1");
        var label = document.createElement("label");
        var input = document.createElement("input");
        input.type = "checkbox";
        input.checked = it.checked;
        label.appendChild(input);
        label.appendChild(document.createTextNode(" "));
        var span = document.createElement("span");
        span.className = "li-text";
        span.textContent = it.text;
        label.appendChild(span);
        li.appendChild(label);
        ul.appendChild(li);
      });
      root.appendChild(ul);
    });
  };

  /* ---------- запуск на странице ---------- */

  var roots = document.querySelectorAll(".editable-list, .editable-summary");
  Array.prototype.forEach.call(roots, function (root) {
    var ctl = new ListCtl(root);
    try {
      if (ctl.summary) ctl.initSummary();
      else ctl.initOverlay();
    } catch (e) {
      if (window.console) console.error("editable-list:", e);
    }
  });
})();
