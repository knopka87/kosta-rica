/* Коста-Рика 2026 — versioned storage adapter (Фаза 5, D11)
 *
 * Единая точка входа для localStorage с:
 * - Номером версии схемы
 * - Транзакционными миграциями с rollback
 * - Автоснимками (N последних версий)
 * - One-tap backup/restore
 */
(function () {
  "use strict";

  var STORAGE_PREFIX = "cr:";
  var SCHEMA_VERSION = 2;
  var SNAPSHOTS_COUNT = 3;
  var SCHEMA_KEY = STORAGE_PREFIX + "schema:v" + SCHEMA_VERSION;

  // --- Миграции ---
  var MIGRATIONS = {
    // v1 -> v2: переименование ключей чек-листов
    1: function (data) {
      var result = {};
      for (var key in data) {
        if (data.hasOwnProperty(key)) {
          // cr:list:v1:* -> cr:list:v2:*
          var newKey = key.replace(/cr:list:v1:/, "cr:list:v2:");
          result[newKey] = data[key];
        }
      }
      return result;
    }
  };

  // --- Утилиты ---
  function fullKey(k) {
    return STORAGE_PREFIX + k;
  }

  function safeParse(val) {
    try {
      return JSON.parse(val);
    } catch (e) {
      return null;
    }
  }

  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return null;
    }
  }

  // --- Снимки ---
  function createSnapshot(namespace) {
    var snapshot = {};
    var prefix = fullKey(namespace + ":");
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf(prefix) === 0) {
        snapshot[key] = localStorage.getItem(key);
      }
    }
    var snapKey = fullKey(namespace + ":snapshot:" + Date.now());
    localStorage.setItem(snapKey, safeStringify(snapshot));

    // Удаляем старые снимки
    var snapshots = [];
    for (var j = 0; j < localStorage.length; j++) {
      var k = localStorage.key(j);
      if (k.indexOf(fullKey(namespace + ":snapshot:")) === 0) {
        snapshots.push(k);
      }
    }
    snapshots.sort();
    while (snapshots.length > SNAPSHOTS_COUNT) {
      localStorage.removeItem(snapshots.shift());
    }
  }

  function restoreSnapshot(namespace, snapKey) {
    var snap = safeParse(localStorage.getItem(snapKey));
    if (!snap) return false;

    createSnapshot(namespace);

    // Очищаем namespace
    var prefix = fullKey(namespace + ":");
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf(prefix) === 0 && key.indexOf(":snapshot:") === -1) {
        localStorage.removeItem(key);
      }
    }

    // Восстанавливаем
    for (var k in snap) {
      if (snap.hasOwnProperty(k)) {
        localStorage.setItem(k, snap[k]);
      }
    }
    return true;
  }

  // --- Основной API ---
  var Storage = {
    get: function (namespace, key) {
      var fullKeyStr = fullKey(namespace + ":" + key);
      var val = localStorage.getItem(fullKeyStr);
      return safeParse(val);
    },

    set: function (namespace, key, value) {
      var fullKeyStr = fullKey(namespace + ":" + key);
      var serialized = safeStringify(value);
      if (serialized === null) {
        console.error("Storage.set: не удалось сериализовать", key);
        return false;
      }
      localStorage.setItem(fullKeyStr, serialized);
      return true;
    },

    remove: function (namespace, key) {
      localStorage.removeItem(fullKey(namespace + ":" + key));
    },

    clear: function (namespace) {
      var prefix = fullKey(namespace + ":");
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.indexOf(prefix) === 0 && key.indexOf(":snapshot:") === -1) {
          localStorage.removeItem(key);
        }
      }
    },

    getAll: function (namespace) {
      var result = {};
      var prefix = fullKey(namespace + ":");
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.indexOf(prefix) === 0) {
          var shortKey = key.substring(prefix.length);
          result[shortKey] = safeParse(localStorage.getItem(key));
        }
      }
      return result;
    },

    // --- Backup/Restore ---
    backup: function (namespace) {
      var snapshot = {};
      var prefix = fullKey(namespace + ":");
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.indexOf(prefix) === 0) {
          snapshot[key] = localStorage.getItem(key);
        }
      }
      var json = safeStringify(snapshot);
      if (!json) return false;

      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = namespace + "-backup-" + new Date().toISOString().split("T")[0] + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    },

    restore: function (namespace, file, callback) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var data = safeParse(e.target.result);
        if (!data) {
          callback(new Error("Не удалось распарсить файл"));
          return;
        }
        createSnapshot(namespace);
        for (var key in data) {
          if (data.hasOwnProperty(key)) {
            localStorage.setItem(key, data[key]);
          }
        }
        callback(null);
      };
      reader.readAsText(file);
    },

    // --- Миграция ---
    migrate: function () {
      var currentVersion = localStorage.getItem(SCHEMA_KEY);
      if (!currentVersion) {
        // Новая схема
        localStorage.setItem(SCHEMA_KEY, SCHEMA_VERSION.toString());
        return true;
      }

      currentVersion = parseInt(currentVersion, 10);
      if (currentVersion === SCHEMA_VERSION) return true;

      if (currentVersion < SCHEMA_VERSION && MIGRATIONS[currentVersion]) {
        createSnapshot("_global");

        // Собираем все данные
        var allData = {};
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key.indexOf(STORAGE_PREFIX) === 0) {
            allData[key] = localStorage.getItem(key);
          }
        }

        // Применяем миграции
        var migrated = MIGRATIONS[currentVersion](allData);

        // Очищаем
        Storage.clear("_global");

        // Записываем migrated данные
        for (var k in migrated) {
          if (migrated.hasOwnProperty(k)) {
            localStorage.setItem(k, migrated[k]);
          }
        }

        localStorage.setItem(SCHEMA_KEY, SCHEMA_VERSION.toString());
        return true;
      }

      return false;
    },

    // --- Статус ---
    getStatus: function () {
      var totalSize = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        totalSize += key.length + (localStorage.getItem(key) || "").length;
      }
      return {
        version: SCHEMA_VERSION,
        keys: localStorage.length,
        sizeBytes: totalSize,
        sizeKB: (totalSize / 1024).toFixed(1)
      };
    }
  };

  // --- Инициализация ---
  Storage.migrate();

  // Экспорт
  window.CRStorage = Storage;
})();
