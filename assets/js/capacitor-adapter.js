/* Коста-Рика 2026 — Capacitor адаптеры (Фаза 6)
 *
 * Адаптеры для:
 * 1. Android Keystore — хранение ключей шифрования
 * 2. Biometric unlock — разблокировка отпечатком/лицом
 * 3. Filesystem — backup/restore в app-private storage
 * 4. Network — определение offline/online
 * 5. Storage — sync localStorage с Capacitor Storage API
 */
(function () {
  "use strict";

  var Capacitor = window.Capacitor;
  var isNative = Capacitor && Capacitor.getPlatform() === "android";

  // --- 1. Storage Adapter (sync localStorage с Capacitor Storage) ---
  var StorageAdapter = {
    isNative: isNative,

    get: function (key) {
      if (isNative && Capacitor.Plugins.Storage) {
        return Capacitor.Plugins.Storage.get({ key: key }).then(function (r) {
          try { return JSON.parse(r.value); } catch (e) { return r.value; }
        }).catch(function () { return null; });
      }
      var val = localStorage.getItem("cr:" + key);
      return Promise.resolve(safeParse(val));
    },

    set: function (key, value) {
      var serialized = safeStringify(value);
      if (serialized === null) return Promise.reject(new Error("Serialization failed"));

      if (isNative && Capacitor.Plugins.Storage) {
        return Capacitor.Plugins.Storage.set({ key: key, value: serialized });
      }
      localStorage.setItem("cr:" + key, serialized);
      return Promise.resolve();
    },

    remove: function (key) {
      if (isNative && Capacitor.Plugins.Storage) {
        return Capacitor.Plugins.Storage.remove({ key: key });
      }
      localStorage.removeItem("cr:" + key);
      return Promise.resolve();
    }
  };

  // --- 2. Keystore Adapter (Android Keystore) ---
  var KeystoreAdapter = {
    isAvailable: false,

    init: function () {
      if (isNative && Capacitor.Plugins.Keychain) {
        this.isAvailable = true;
        return Promise.resolve();
      }
      // Fallback: localStorage (менее безопасно)
      this.isAvailable = false;
      return Promise.resolve();
    },

    store: function (key, value) {
      if (this.isAvailable && Capacitor.Plugins.Keychain) {
        return Capacitor.Plugins.Keychain.set({
          service: "kosta-rica-2026",
          key: key,
          value: value
        }).catch(function (e) {
          console.warn("Keystore store failed, fallback to localStorage", e);
          localStorage.setItem("cr:secure:" + key, value);
        });
      }
      localStorage.setItem("cr:secure:" + key, value);
      return Promise.resolve();
    },

    retrieve: function (key) {
      if (this.isAvailable && Capacitor.Plugins.Keychain) {
        return Capacitor.Plugins.Keychain.get({
          service: "kosta-rica-2026",
          key: key
        }).then(function (r) { return r.value; }).catch(function () { return null; });
      }
      return Promise.resolve(localStorage.getItem("cr:secure:" + key));
    },

    delete: function (key) {
      if (this.isAvailable && Capacitor.Plugins.Keychain) {
        return Capacitor.Plugins.Keychain.delete({
          service: "kosta-rica-2026",
          key: key
        }).catch(function () {
          localStorage.removeItem("cr:secure:" + key);
        });
      }
      localStorage.removeItem("cr:secure:" + key);
      return Promise.resolve();
    }
  };

  // --- 3. Biometric Adapter (отпечаток/лицо) ---
  var BiometricAdapter = {
    isAvailable: false,
    _lockTimeout: null,
    _isLocked: false,

    init: function () {
      if (isNative && Capacitor.Plugins.Biometrics) {
        return Capacitor.Plugins.Biometrics.isAvailable().then(function (r) {
          this.isAvailable = r.available;
        }.bind(this)).catch(function () {
          this.isAvailable = false;
        }.bind(this));
      }
      this.isAvailable = false;
      return Promise.resolve();
    },

    unlock: function (reason) {
      reason = reason || "Разблокируйте для доступа к документам";

      if (this.isAvailable && Capacitor.Plugins.Biometrics) {
        return Capacitor.Plugins.Biometrics.verifyIdentity({
          title: "Разблокировка",
          subtitle: "Коста-Рика 2026",
          description: reason,
          cancelTitle: "Отмена",
          fallbackTitle: "Использовать PIN"
        }).then(function () {
          this._isLocked = false;
          this._clearTimeout();
          this._onUnlocked();
          return true;
        }.bind(this)).catch(function (e) {
          if (e.message === "user_cancel") {
            return false;
          }
          // Fallback: простой PIN
          return this.fallbackPin();
        }.bind(this));
      }

      // Fallback: простой PIN
      return this.fallbackPin();
    },

    lock: function () {
      this._isLocked = true;
      this._showLockScreen();
    },

    isLocked: function () {
      return this._isLocked;
    },

    setAutoLock: function (minutes) {
      this._clearTimeout();
      if (minutes && minutes > 0) {
        this._lockTimeout = setTimeout(function () {
          this.lock();
        }.bind(this), minutes * 60 * 1000);
      }
    },

    _clearTimeout: function () {
      if (this._lockTimeout) {
        clearTimeout(this._lockTimeout);
        this._lockTimeout = null;
      }
    },

    _showLockScreen: function () {
      // Показываем модальное окно блокировки
      var overlay = document.getElementById("lock-overlay");
      if (overlay) {
        overlay.style.display = "flex";
      }
    },

    _onUnlocked: function () {
      var overlay = document.getElementById("lock-overlay");
      if (overlay) {
        overlay.style.display = "none";
      }
      if (typeof window.onBiometricUnlock === "function") {
        window.onBiometricUnlock();
      }
    },

    fallbackPin: function () {
      var pin = prompt("Введите PIN-код для разблокировки:");
      if (pin === null) return false; // Отмена

      // Простая проверка (в продакшене — PBKDF2 хеш)
      var stored = localStorage.getItem("cr:pin-hash");
      if (!stored) {
        // Первый раз — устанавливаем PIN
        var newPin = prompt("Создайте PIN-код (4 цифры):");
        if (!newPin || newPin.length !== 4 || isNaN(newPin)) {
          alert("Неверный PIN");
          return false;
        }
        localStorage.setItem("cr:pin", newPin);
        this._isLocked = false;
        return true;
      }

      if (pin === stored) {
        this._isLocked = false;
        return true;
      }
      alert("Неверный PIN");
      return false;
    }
  };

  // --- 4. Filesystem Adapter (backup/restore) ---
  var FilesystemAdapter = {
    isAvailable: false,

    init: function () {
      if (isNative && Capacitor.Plugins.Filesystem) {
        this.isAvailable = true;
        return Promise.resolve();
      }
      this.isAvailable = false;
      return Promise.resolve();
    },

    backup: function (namespace) {
      var data = window.CRStorage ? window.CRStorage.getAll(namespace) : {};
      var json = safeStringify(data);
      if (!json) return Promise.reject(new Error("Serialization failed"));

      if (this.isAvailable && Capacitor.Plugins.Filesystem) {
        var filename = namespace + "-backup-" + new Date().toISOString().split("T")[0] + ".json";
        return Capacitor.Plugins.Filesystem.writeFile({
          path: filename,
          data: json,
          directory: Capacitor.Plugins.Filesystem.Directory.Documents
        }).then(function () {
          // Share file
          return Capacitor.Plugins.Share.share({
            title: "Backup: " + namespace,
            url: filename,
            dialogTitle: "Сохранить backup"
          }).catch(function () {
            // Share cancelled
          });
        });
      }

      // Fallback: download
      return Promise.resolve().then(function () {
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = namespace + "-backup-" + new Date().toISOString().split("T")[0] + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    },

    restore: function (namespace) {
      return new Promise(function (resolve, reject) {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = function (e) {
          var file = e.target.files[0];
          if (!file) { reject(new Error("No file selected")); return; }

          var reader = new FileReader();
          reader.onload = function (ev) {
            var data = safeParse(ev.target.result);
            if (!data) { reject(new Error("Invalid JSON")); return; }

            if (window.CRStorage) {
              for (var key in data) {
                if (data.hasOwnProperty(key)) {
                  localStorage.setItem(key, data[key]);
                }
              }
            }
            resolve();
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }
  };

  // --- 5. Network Adapter ---
  var NetworkAdapter = {
    isOnline: true,

    init: function () {
      this.isOnline = navigator.onLine;

      if (isNative && Capacitor.Plugins.Network) {
        Capacitor.Plugins.Network.addListener("networkStatusChange", function (status) {
          this.isOnline = status.connected;
          this._onChange(this.isOnline);
        }.bind(this));
      } else {
        window.addEventListener("online", function () {
          this.isOnline = true;
          this._onChange(true);
        }.bind(this));
        window.addEventListener("offline", function () {
          this.isOnline = false;
          this._onChange(false);
        }.bind(this));
      }

      return Promise.resolve();
    },

    _onChange: function (online) {
      if (typeof window.onNetworkChange === "function") {
        window.onNetworkChange(online);
      }
    }
  };

  // --- Утилиты ---
  function safeParse(val) {
    try { return JSON.parse(val); } catch (e) { return null; }
  }

  function safeStringify(obj) {
    try { return JSON.stringify(obj); } catch (e) { return null; }
  }

  // --- Инициализация ---
  function init() {
    return Promise.all([
      StorageAdapter.isNative ? StorageAdapter.init() : Promise.resolve(),
      KeystoreAdapter.init(),
      BiometricAdapter.init(),
      FilesystemAdapter.init(),
      NetworkAdapter.init()
    ]).then(function () {
      // Устанавливаем auto-lock 30 минут
      BiometricAdapter.setAutoLock(30);

      // Экспорт в глобальную область
      window.CapacitorAdapters = {
        storage: StorageAdapter,
        keystore: KeystoreAdapter,
        biometric: BiometricAdapter,
        filesystem: FilesystemAdapter,
        network: NetworkAdapter
      };

      console.log("Capacitor adapters initialized (native:", isNative, ")");
    });
  }

  // Экспорт
  window.CapacitorAdapters = {
    init: init,
    storage: StorageAdapter,
    keystore: KeystoreAdapter,
    biometric: BiometricAdapter,
    filesystem: FilesystemAdapter,
    network: NetworkAdapter
  };

  // Auto-init если Capacitor доступен
  if (isNative) {
    init().catch(function (e) {
      console.error("Capacitor adapters init failed:", e);
    });
  }
})();
