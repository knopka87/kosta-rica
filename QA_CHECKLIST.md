# Коста-Рика 2026 — QA Checklist (Фаза 7)

## 1. Airplane mode (офлайн)

### 1.1 Precache
- [ ] Отключить интернет
- [ ] Открыть index.html — должен загрузиться из кэша
- [ ] Открыть steps.html — должен загрузиться из кэша
- [ ] Открыть step-prep.html — должен загрузиться из кэша
- [ ] Проверить что steps-seed работает офлайн (текущий этап определяется)
- [ ] Проверить что дашборд работает офлайн

### 1.2 PMTiles
- [ ] Убедиться что map.pmtiles НЕ загружен при первом открытии
- [ ] Нажать "Скачать офлайн-карту" (если есть кнопка)
- [ ] Проверить прогресс загрузки
- [ ] После загрузки карта должна работать офлайн

### 1.3 Storage
- [ ] Отметить чекбоксы в step-prep.html
- [ ] Обновить страницу — галочки должны сохраниться
- [ ] Отключить интернет, обновить — галочки должны сохраниться
- [ ] Проверить что CRStorage.getStatus() возвращает данные

## 2. Часовые пояса (timezone)

### 2.1 Тестовые сценарии
- [ ] **Киров (UTC+3):** сейчас этап prep (до 29 октября)
- [ ] **Москва (UTC+3):** то же что Киров
- [ ] **Стамбул (UTC+3):** 31 октября — должен быть ist-flight или ist-layover
- [ ] **Панама (UTC-5):** 31 октября 20:05 — должен быть ist-panama или panama-night
- [ ] **Сан-Хосе (UTC-6):** 1 ноября — должен быть arrival-cr или tamarindo

### 2.2 Как тестировать
```javascript
// В консоли браузера:
// 1. Проверить текущий этап
console.log(document.getElementById('steps-seed'));

// 2. Симулировать другую дату
// (требуется модификация steps.js для приёма fake Date)

// 3. Проверить что все даты в trip.json имеют явные offset
fetch('trip.json').then(r => r.json()).then(data => {
  data.segments.forEach(s => {
    console.log(s.id, s.startAt, s.endAt);
    // Все должны содержать +HH:MM или -HH:MM
  });
});
```

## 3. Пароль и приватность

### 3.1 AES-256-GCM
- [ ] Открыть dokumenty.html
- [ ] Ввести пароль — зашифрованный контент должен расшифроваться
- [ ] Ввести неверный пароль — должна быть ошибка
- [ ] Проверить что docs/meta.json удалён (или его использование безопасно)

### 3.2 Biometric lock
- [ ] На Android: разблокировка отпечатком
- [ ] На Android: fallback PIN
- [ ] Проверить auto-lock через 30 минут
- [ ] Проверить lock-overlay

### 3.3 Secure storage
- [ ] Проверить что ключи хранятся в Android Keychain (на устройстве)
- [ ] Проверить fallback к localStorage в браузере

## 4. Одна рука на солнце

### 4.1 Touch targets
- [ ] Все кнопки ≥ 48×48px (проверить в DevTools)
- [ ] Нижняя навигация доступна большим пальцем
- [ ] Quick links кликабельны одной рукой

### 4.2 Читаемость
- [ ] H1 виден на всех страницах (D2 исправлен)
- [ ] Контраст текста ≥ AA (4.5:1)
- [ ] Критические алерты видны на солнце (высокий контраст)

### 4.3 Mobile layout
- [ ] Bottom nav показывается на <768px
- [ ] Topbar скрывается на мобильных
- [ ] Таблицы в прокрутке (table-wrap)
- [ ] Cards в одну колонку на мобильных

## 5. Кросс-браузер

### 5.1 Desktop
- [ ] Chrome 120+ — все функции работают
- [ ] Firefox 120+ — все функции работают
- [ ] Safari 17+ — все функции работают
- [ ] Edge 120+ — все функции работают

### 5.2 Mobile
- [ ] Chrome Android — все функции работают
- [ ] Safari iOS — все функции работают
- [ ] Samsung Internet — все функции работают

## 6. Performance

### 6.1 PageSpeed
- [ ] Lighthouse score > 90 на desktop
- [ ] Lighthouse score > 70 на mobile
- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3.5s

### 6.2 Кэш
- [ ] SW кэширует все HTML страницы
- [ ] SW кэширует JS/CSS
- [ ] PMTiles НЕ кэшируется автоматически (D10)

## 7. Edge cases

### 7.1 Даты
- [ ] Поездка ещё не началась — режим "Before trip"
- [ ] Поездка идёт — режим "In transit" / "At destination"
- [ ] Поездка закончилась — режим "After trip"
- [ ] Пересечение границы этапов (after/until)

### 7.2 Данные
- [ ] Первый запуск (localStorage пуст)
- [ ] Миграция с v1 на v2 (CRStorage.migrate)
- [ ] Backup/restore работает
- [ ] Quota exceeded — graceful degradation

## 8. Capacitor build

### 8.1 Android
- [ ] `npx cap sync` проходит без ошибок
- [ ] `npx cap open android` открывает проект
- [ ] Build в Android Studio проходит
- [ ] APK устанавливается на устройство
- [ ] Biometric работает на устройстве
- [ ] Keystore работает на устройстве

### 8.2 Иконки и splash
- [ ] Иконки приложения отображаются
- [ ] Splash screen показывается при запуске
- [ ] StatusBar стилизован

---

## Known issues (требуют внимания)

1. **D9 — Password oracle:** docs/meta.json ещё не удалён, требуется изменение в encryptdocs
2. **D13 — Duplicate content:** ist-flight, ist-layover, ist-panama тянут одинаковые секции — требует рерайта контента
3. **D14 — Unverified drafts:** step-01..11.md не используются в сборке, помечены как черновики

---

## Sign-off

| Tester | Date | Status | Notes |
|--------|------|--------|-------|
| Alex | TBD | ⏳ | Pending |
| QA Bot | TBD | ⏳ | Pending |
