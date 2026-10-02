/* Документы и секретные фрагменты: разблокировка паролем и расшифровка в браузере.
   Совместимо с tools/encryptdocs (AES-256-GCM, PBKDF2-HMAC-SHA256, 210k).

   Два режима:
   - страница «Документы» (form#lockForm): список PDF → открытие в новой вкладке;
   - слоты .secret-slot[data-secret-enc] на других страницах: инлайн-пароль →
     расшифрованный HTML-фрагмент вставляется прямо на странице.
   Пароль живёт в sessionStorage (одна вкладка), поэтому, открыв его однажды,
   пользователь видит и таблицу на «Маршруте», и PDF в «Документах». */
(function () {
  "use strict";

  var ITER = 210000;
  var ENC = new TextEncoder();
  var STORE = "cr:docs:pw";

  var lockScreen = document.getElementById("lockScreen");
  var docList = document.getElementById("docList");
  var rows = document.getElementById("docRows");
  var errBox = document.getElementById("lockErr");
  var form = document.getElementById("lockForm");
  var input = document.getElementById("lockPassword");

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }

  function sha256(str) {
    return crypto.subtle.digest("SHA-256", ENC.encode(str));
  }

  function derive(password, salt) {
    return crypto.subtle.importKey("raw", ENC.encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: ITER },
          key,
          256
        );
      });
  }

  function parse(buf) {
    var view = new DataView(buf);
    var magic = "CRDOC1\0";
    for (var i = 0; i < magic.length; i++) {
      if (String.fromCharCode(view.getUint8(i)) !== magic[i]) throw new Error("bad magic");
    }
    var off = magic.length;
    var salt = new Uint8Array(buf, off, 16); off += 16;
    var nonce = new Uint8Array(buf, off, 12); off += 12;
    var ct = new Uint8Array(buf, off);
    return { salt: salt, nonce: nonce, ct: ct };
  }

  function decrypt(password, buf) {
    var p = parse(buf);
    return derive(password, p.salt).then(function (bits) {
      return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["decrypt"])
        .then(function (key) {
          return crypto.subtle.decrypt({ name: "AES-GCM", iv: p.nonce }, key, p.ct);
        });
    });
  }

  function fetchBuf(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    });
  }

  /* Проверка пароля: только хэш в meta.json, содержимого он не даёт. */
  function verify(pw) {
    return fetch("docs/meta.json")
      .then(function (r) { return r.json(); })
      .then(function (meta) {
        return sha256("crdocs|" + pw).then(function (h) {
          if (hex(h) !== meta.verifier) throw new Error("wrong");
        });
      });
  }

  function netErr() {
    return "Не удалось загрузить — проверь соединение";
  }

  /* ---------- Список PDF на странице «Документы» ---------- */

  function renderList(manifest) {
    rows.innerHTML = "";
    var pdfCount = 0;
    manifest.forEach(function (item) {
      if (/\.html$/i.test(item.name)) return; // фрагменты вставляются слотами, в список не входят
      pdfCount++;
      var row = document.createElement("div");
      row.className = "doc-row";
      var kb = Math.round(item.size / 1024);
      row.innerHTML =
        '<span class="ico">📄</span>' +
        '<span class="meta"><span class="name"></span><span class="sub">PDF · ' + kb + ' КБ · зашифрован</span></span>';
      row.querySelector(".name").textContent = item.name;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Открыть";
      btn.addEventListener("click", function () {
        var pw = sessionStorage.getItem(STORE);
        btn.disabled = true;
        btn.textContent = "Открываю…";
        fetchBuf("docs/" + item.enc)
          .then(function (buf) { return decrypt(pw, buf); })
          .then(function (plain) {
            var blob = new Blob([plain], { type: "application/pdf" });
            var url = URL.createObjectURL(blob);
            var w = window.open("", "_blank");
            if (w) {
              w.location = url;
            } else {
              var a = document.createElement("a");
              a.href = url;
              a.download = item.name;
              document.body.appendChild(a);
              a.click();
              a.remove();
            }
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
          })
          .catch(function () {
            btn.textContent = "Ошибка";
          })
          .then(function () {
            btn.disabled = false;
            if (btn.textContent === "Открываю…") btn.textContent = "Открыть";
          });
      });
      row.appendChild(btn);
      rows.appendChild(row);
    });

    var chip = document.getElementById("docCount");
    if (chip) chip.textContent = pdfCount + " файлов";
  }

  function unlock(pw) {
    errBox.textContent = "";
    return verify(pw)
      .then(function () { return fetchBuf("docs/manifest.bin"); })
      .then(function (buf) { return decrypt(pw, buf); })
      .then(function (plain) {
        renderList(JSON.parse(new TextDecoder().decode(plain)));
        sessionStorage.setItem(STORE, pw);
        lockScreen.style.display = "none";
        docList.classList.add("show");
      });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      unlock(input.value.trim()).catch(function (err) {
        errBox.textContent = err && err.message === "wrong"
          ? "Неверный пароль"
          : netErr();
        input.select();
      });
    });

    var closeBtn = document.getElementById("lockBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        sessionStorage.removeItem(STORE);
        docList.classList.remove("show");
        lockScreen.style.display = "";
        input.value = "";
      });
    }

    var saved = sessionStorage.getItem(STORE);
    if (saved) {
      unlock(saved).catch(function () { sessionStorage.removeItem(STORE); });
    }
  }

  /* ---------- Секретные слоты (.secret-slot) на других страницах ---------- */

  var slots = Array.prototype.slice.call(
    document.querySelectorAll(".secret-slot[data-secret-enc]")
  );

  function renderSlot(slot, pw) {
    return fetchBuf(slot.getAttribute("data-secret-enc"))
      .then(function (buf) { return decrypt(pw, buf); })
      .then(function (plain) {
        var body = document.createElement("div");
        body.className = "secret-body";
        body.innerHTML = new TextDecoder().decode(plain);
        slot.innerHTML = "";
        slot.appendChild(body);

        var hide = document.createElement("button");
        hide.type = "button";
        hide.className = "secret-hide";
        hide.textContent = "🔒 Скрыть";
        hide.addEventListener("click", function () {
          slot.classList.remove("unlocked");
          slot.innerHTML = slot._lockHtml;
          wireSlot(slot);
        });
        slot.appendChild(hide);
        slot.classList.add("unlocked");
      });
  }

  function unlockSlots(pw) {
    return verify(pw).then(function () {
      sessionStorage.setItem(STORE, pw);
      return Promise.all(slots.map(function (s) { return renderSlot(s, pw); }));
    });
  }

  function wireSlot(slot) {
    var openBtn = slot.querySelector(".secret-open");
    if (!openBtn) return;
    openBtn.addEventListener("click", function () {
      var holder = openBtn.parentNode;
      if (holder.querySelector(".secret-form")) return;
      var f = document.createElement("form");
      f.className = "secret-form";
      f.innerHTML =
        '<input type="password" placeholder="Пароль" autocomplete="current-password" required>' +
        '<button type="submit">Открыть</button>' +
        '<span class="secret-err"></span>';
      holder.appendChild(f);
      f.querySelector("input").focus();
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var pw = f.querySelector("input").value.trim();
        f.querySelector(".secret-err").textContent = "";
        unlockSlots(pw)
          .then(function () {
            // на странице «Документы» пароль теперь тоже активен
            if (form && lockScreen && lockScreen.style.display !== "none") {
              unlock(pw).catch(function () {});
            }
          })
          .catch(function (err) {
            f.querySelector(".secret-err").textContent =
              err && err.message === "wrong" ? "Неверный пароль" : netErr();
          });
      });
    });
  }

  if (slots.length) {
    slots.forEach(function (slot) {
      slot._lockHtml = slot.innerHTML;
      wireSlot(slot);
    });
    var savedPw = sessionStorage.getItem(STORE);
    if (savedPw) {
      unlockSlots(savedPw).catch(function () {
        sessionStorage.removeItem(STORE);
        slots.forEach(function (slot) {
          slot.classList.remove("unlocked");
          slot.innerHTML = slot._lockHtml;
          wireSlot(slot);
        });
      });
    }
  }
})();
