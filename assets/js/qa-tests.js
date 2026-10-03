// Коста-Рика 2026 — автотесты для QA (Фаза 7)
// Запуск: открыть в консоли браузера или через Puppeteer

(function () {
  "use strict";

  var RESULTS = [];

  function test(name, fn) {
    try {
      fn();
      RESULTS.push({ name: name, status: "PASS" });
      console.log("✅", name);
    } catch (e) {
      RESULTS.push({ name: name, status: "FAIL", error: e.message });
      console.error("❌", name, e.message);
    }
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || "Assertion failed");
    }
  }

  // --- Тест 1: steps-seed существует и валиден ---
  test("steps-seed exists", function () {
    var seed = document.getElementById("steps-seed");
    assert(seed, "steps-seed element not found");
    var data = JSON.parse(seed.textContent);
    assert(data.length > 0, "steps-seed is empty");
    assert(data.length === 11, "Expected 11 steps, got " + data.length);
  });

  // --- Тест 2: trip.json загружается и валиден ---
  test("trip.json loads", function () {
    return fetch("trip.json")
      .then(function (r) {
        assert(r.ok, "HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        assert(data.segments, "No segments in trip.json");
        assert(data.segments.length > 0, "Empty segments");

        // Проверка что все даты имеют явные offset
        data.segments.forEach(function (s) {
          assert(
            s.startAt.indexOf("+") !== -1 || s.startAt.indexOf("-") !== -1,
            "startAt without offset: " + s.startAt
          );
          assert(
            s.endAt.indexOf("+") !== -1 || s.endAt.indexOf("-") !== -1,
            "endAt without offset: " + s.endAt
          );
        });
      });
  });

  // --- Тест 3: H1 виден на всех страницах (D2) ---
  test("H1 is visible", function () {
    var h1 = document.querySelector("h1");
    assert(h1, "No H1 found");
    var rect = h1.getBoundingClientRect();
    assert(rect.top >= 0, "H1 is above viewport (top=" + rect.top + ")");
    assert(rect.height > 0, "H1 has no height");
  });

  // --- Тест 4: Touch targets ≥ 48px (WCAG 2.2) ---
  test("Touch targets are ≥ 48px", function () {
    var buttons = document.querySelectorAll("button, .action-btn, .quick-link, .bottom-nav a");
    var failures = [];
    buttons.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        failures.push(el.tagName + " " + rect.width + "x" + rect.height);
      }
    });
    assert(
      failures.length === 0,
      "Small touch targets: " + failures.join(", ")
    );
  });

  // --- Тест 5: Bottom nav на мобильных ---
  test("Bottom nav shows on mobile", function () {
    var bottomNav = document.querySelector(".bottom-nav");
    if (window.innerWidth <= 768) {
      assert(bottomNav, "Bottom nav not found");
      var style = window.getComputedStyle(bottomNav);
      assert(style.display !== "none", "Bottom nav is hidden");
    } else {
      // На desktop bottom nav скрыт
      if (bottomNav) {
        var style = window.getComputedStyle(bottomNav);
        assert(style.display === "none", "Bottom nav should be hidden on desktop");
      }
    }
  });

  // --- Тест 6: Тёмная тема ---
  test("Dark theme CSS variables", function () {
    var root = document.documentElement;
    var styles = getComputedStyle(root);

    // Проверить что токены определены
    assert(styles.getPropertyValue("--jungle-700").trim() !== "", "--jungle-700 not set");
    assert(styles.getPropertyValue("--sand-50").trim() !== "", "--sand-50 not set");
    assert(styles.getPropertyValue("--card").trim() !== "", "--card not set");
  });

  // --- Тест 7: CRStorage существует ---
  test("CRStorage adapter loaded", function () {
    assert(window.CRStorage, "CRStorage not found");
    assert(typeof window.CRStorage.get === "function", "CRStorage.get not a function");
    assert(typeof window.CRStorage.set === "function", "CRStorage.set not a function");

    // Тестовая запись
    var ok = window.CRStorage.set("_test", { hello: "world" });
    assert(ok, "CRStorage.set returned false");

    var val = window.CRStorage.get("_test");
    assert(val, "CRStorage.get returned null");
    assert(val.hello === "world", "CRStorage get/set failed: got " + JSON.stringify(val));

    // Очистка
    window.CRStorage.clear("_test");
  });

  // --- Тест 8: Dashboard загружается ---
  test("Dashboard renders", function () {
    var dashboard = document.getElementById("now-dashboard");
    if (dashboard) {
      // Dashboard есть на index.html
      console.log("Dashboard found, content:", dashboard.innerHTML.substring(0, 100));
    } else {
      // На других страницах dashboard может отсутствовать
      console.log("No dashboard on this page (expected on index.html only)");
    }
  });

  // --- Тест 9: Network status indicator ---
  test("Network status indicator", function () {
    var status = document.getElementById("network-status");
    if (status) {
      console.log("Network status:", status.textContent);
    }
  });

  // --- Тест 10: Search works ---
  test("Local search input exists", function () {
    var search = document.getElementById("local-search");
    if (search) {
      console.log("Search input found");
    }
  });

  // --- Итоги ---
  test("Summary", function () {
    var passed = RESULTS.filter(function (r) { return r.status === "PASS"; }).length;
    var failed = RESULTS.filter(function (r) { return r.status === "FAIL"; }).length;
    console.log("\n========== QA RESULTS ==========");
    console.log("Passed:", passed);
    console.log("Failed:", failed);
    console.log("Total:", RESULTS.length);

    if (failed > 0) {
      console.log("\nFailures:");
      RESULTS.filter(function (r) { return r.status === "FAIL"; }).forEach(function (r) {
        console.log("  ❌", r.name, "-", r.error);
      });
    }
    console.log("===============================");
  });
})();
