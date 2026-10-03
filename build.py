#!/usr/bin/env python3
"""Сборка статического сайта: markdown -> HTML через pandoc + шаблон.

Использование:  python3 build.py
Источники:      ../kosta-rica/*.md  и  src/*.html  (готовый контент страниц)
Результат:      *.html в корне kosta-rica-site/
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC_MD = ROOT.parent / "kosta-rica"
SRC_HTML = ROOT / "src"
TEMPLATE = (ROOT / "template.html").read_text(encoding="utf-8")
SECRET_DIR = ROOT / ".tmp-secret"  # plaintext-секреты перед шифрованием, не коммитится

# маркеры секретного участка в markdown-источниках
SECRET_OPEN = "<!-- secret -->"
SECRET_CLOSE = "<!-- /secret -->"

# имя md-файла -> (выходной html, заголовок)
PAGES_MD = {
    "plan-poezdki.md": ("marshrut.html", "Маршрут и план поездки"),
    "eda.md": ("eda.html", "Еда и питание"),
    "packing-list.md": ("sbory.html", "Сборы — чек-лист"),
    "chto-kupit.md": ("pokupki.html", "Что привезти и купить"),
    "pravila-zakony.md": ("pravila.html", "Правила и законы"),
    "lifehacks.md": ("lifehacks.html", "Лайфхаки"),
}

# видимый текст ссылки вместо имени md-файла
LINK_TEXT = {
    "plan-poezdki.md": "план поездки",
    "eda.md": "еда",
    "packing-list.md": "сборы",
    "chto-kupit.md": "покупки",
    "pravila-zakony.md": "правила",
    "lifehacks.md": "лайфхаки",
}

# имя src-файла -> (выходной html, заголовок)
PAGES_HTML = {
    "index.html": ("index.html", "Главная"),
    "hotel.html": ("hotel.html", "Отель и карта"),
    "dokumenty.html": ("dokumenty.html", "Документы"),
    "credits.html": ("credits.html", "Фото и источники"),
    "dela.html": ("dela.html", "Дела до отъезда"),
    "phrasebook.html": ("phrasebook.html", "Разговорник"),
    "budget.html": ("budget.html", "Бюджет поездки"),
    "journal.html": ("journal.html", "Журнал поездки"),
}


def pandoc(text: str, *args: str) -> str:
    cmd = ["pandoc", *args]
    res = subprocess.run(cmd, input=text, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"pandoc failed:\n{res.stderr}")
    return res.stdout


def split_secret(md_text: str, page: str) -> tuple[str, str | None]:
    """Вырезает <!-- secret -->…<!-- /secret --> из markdown.

    Возвращает (публичный_md, секретный_md | None).
    Секретный участок пишется plaintext-фрагментом в .tmp-secret/
    (шифруется отдельно tools/encryptdocs), публичный получает заглушку-слот.
    """
    if SECRET_OPEN not in md_text:
        return md_text, None
    if SECRET_CLOSE not in md_text:
        sys.exit(f"secret: нет закрывающего маркера в {page}")
    start = md_text.index(SECRET_OPEN)
    end = md_text.index(SECRET_CLOSE) + len(SECRET_CLOSE)
    secret_md = md_text[start + len(SECRET_OPEN):end - len(SECRET_CLOSE)].strip()
    if not secret_md:
        sys.exit(f"secret: пустой участок в {page}")

    page_key = page.removesuffix(".html")
    enc_name = f"secret-{page_key}.html.bin"
    placeholder = (
        "\n<div class=\"note secret-slot\" data-secret-enc=\"docs/"
        + enc_name
        + "\">\n"
        "  <h4>🔒 Защищено паролем</h4>\n"
        "  <p>Сводная таблица билетов (номера, PNR, суммы) и паспортные данные "
        "спрятаны под паролем — как и файлы в разделе «Документы». "
        "<button type=\"button\" class=\"secret-open\">Показать по паролю</button></p>\n"
        "</div>\n"
    )
    public_md = md_text[:start] + placeholder + md_text[end:]

    SECRET_DIR.mkdir(exist_ok=True)
    frag = pandoc(secret_md, "-f", "gfm+task_lists", "-t", "html5", "--wrap=none")
    (SECRET_DIR / f"secret-{page_key}.html").write_text(frag, encoding="utf-8")
    print(f"  secret {page_key}: фрагмент → .tmp-secret/secret-{page_key}.html")
    return public_md, secret_md


def md_to_body(src_text: str, page: str) -> str:
    public_md, _ = split_secret(src_text, page)
    body = pandoc(public_md, "-f", "gfm+task_lists", "-t", "html5", "--wrap=none")

    # внутренние ссылки: eda.md -> eda.html (с учётом переименованных страниц)
    def rewrite(m: re.Match) -> str:
        target = m.group(1)
        frag = m.group(2) or ""
        directory, _, base = target.rpartition("/")
        full = (directory + "/" if directory else "") + base + ".md"
        if full in PAGES_MD:
            target = (directory + "/" if directory else "") + PAGES_MD[full][0]
        else:
            target = target + ".html"
        return f'href="{target}{frag}"'

    body = re.sub(r'href="([^"]+?)\.md(#[^"]*)?"', rewrite, body)

    # видимый текст ссылок: "chto-kupit.md" -> "покупки"
    def humanize(m: re.Match) -> str:
        base = m.group(2).rsplit("/", 1)[-1]
        if base in LINK_TEXT:
            return f'<a href="{m.group(1)}">{LINK_TEXT[base]}</a>'
        return m.group(0)

    body = re.sub(r'<a href="([^"]+)">([^<]*\.md)</a>', humanize, body)

    # широкие таблицы — в прокручиваемый контейнер
    body = re.sub(r"(<table>.*?</table>)", r'<div class="table-wrap">\1</div>', body, flags=re.S)

    # редактируемый чек-лист: стабильные id пунктов и обёртка
    if page in EDITABLE:
        body = wrap_editable(body, page)
    return body


# --- редактируемые списки ---------------------------------------------------

LI_RE = re.compile(
    r"<li>(?:(?!</li>).)*?<input type=\"checkbox\"(?:(?!</li>).)*?</li>", re.S
)
HEADING_RE = re.compile(r"<h([1-4]) id=\"([^\"]+)\"")
WEIGHT_RE = re.compile(r"<!--\s*w:\s*(\d+)\s*-->")

# страницы с редактируемым чек-листом (движок assets/js/editable-list.js)
EDITABLE = {
    "sbory.html": {"key": "sbory", "label": "взято", "limit": "13000"},
    "dela.html": {"key": "dela", "label": "сделано"},
}


def wrap_editable(body: str, out: str) -> str:
    """Стабильные id пунктов/разделов + обёртка .editable-list."""
    cfg = EDITABLE[out]
    body = add_list_ids(body)
    attrs = f' data-list-key="{cfg["key"]}" data-label="{cfg["label"]}"'
    if "limit" in cfg:
        attrs += f' data-weight-limit="{cfg["limit"]}"'
    return f'<div class="editable-list"{attrs}>\n{body}\n</div>'


def add_list_ids(body: str) -> str:
    """Чекбокс-пунктам: data-id (sha1 текста, дедуп по порядку), data-section
    (id ближайшего заголовка выше), <!--w:350--> → data-weight."""
    import hashlib

    headings = [(m.start(), m.group(2)) for m in HEADING_RE.finditer(body)]
    seen: dict[str, int] = {}

    def prep(m: re.Match) -> str:
        li = m.group(0)
        weight = None
        wm = WEIGHT_RE.search(li)
        if wm:
            weight = wm.group(1)
            li = li.replace(wm.group(0), "")

        text = re.sub(r"<[^>]+>", " ", li)
        text = " ".join(html.unescape(text).split()).lower()
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
        seen[digest] = seen.get(digest, 0) + 1
        if seen[digest] > 1:
            digest = f"{digest}-{seen[digest]}"

        section = ""
        for pos, hid in reversed(headings):
            if pos < m.start():
                section = hid
                break

        attrs = f' data-id="{digest}" data-section="{section}"'
        if weight:
            attrs += f' data-weight="{weight}"'
        return "<li" + attrs + li[len("<li"):]

    return LI_RE.sub(prep, body)


def md_toc(src_text: str, page: str) -> str:
    public_md, _ = split_secret(src_text, page)
    return pandoc(
        public_md,
        "-f", "gfm",
        "-t", "html5",
        "--standalone",
        f"--template={ROOT / 'templates' / 'toc.html'}",
        "--toc",
        "--toc-depth=2",
        "--wrap=none",
    )


def render(title: str, body: str, toc: str = "") -> str:
    page = TEMPLATE.replace("$title$", html.escape(title))
    if toc:
        page = page.replace("$toc$", toc)
        page = page.replace("$if(toc)$", "").replace("$endif$", "")
    else:
        page = re.sub(r"\$if\(toc\)\$.*?\$endif\$", "", page, flags=re.S)
    return page.replace("$body$", body)


def write_dela_seed() -> None:
    """Сид сводки «Дела» на главной: читает собранный dela.html
    (пункты уже с data-id/data-section после wrap_editable) и встраивает
    JSON в index.html — офлайн работает без fetch."""
    from html.parser import HTMLParser

    class SeedParser(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.headings: dict[str, str] = {}
            self.sections: dict[str, dict] = {}
            self.order: list[str] = []
            self._heading_id: str | None = None
            self._heading_text: list[str] = []
            self._item: dict | None = None
            self._in_item = False

        def handle_starttag(self, tag: str, attrs: list) -> None:
            a = dict(attrs)
            if tag in ("h2", "h3") and a.get("id"):
                self._heading_id = a["id"]
                self._heading_text = []
            elif tag == "li" and a.get("data-id") and a.get("data-section") is not None:
                self._item = {
                    "id": a["data-id"],
                    "section": a["data-section"],
                    "text": [],
                    "checked": "checked" in a,
                }
                self._in_item = True
            elif tag == "input" and self._item is not None and a.get("type") == "checkbox":
                if "checked" in a:
                    self._item["checked"] = True

        def handle_endtag(self, tag: str) -> None:
            if tag in ("h2", "h3") and self._heading_id is not None:
                self.headings[self._heading_id] = " ".join("".join(self._heading_text).split())
                self._heading_id = None
            elif tag == "li" and self._item is not None:
                sid = self._item.pop("section")
                self._item["text"] = " ".join("".join(self._item.pop("text")).split())
                if sid not in self.sections:
                    self.sections[sid] = {"id": sid, "title": "", "items": []}
                    self.order.append(sid)
                self.sections[sid]["items"].append(self._item)
                self._item = None
                self._in_item = False

        def handle_data(self, data: str) -> None:
            if self._heading_id is not None:
                self._heading_text.append(data)
            elif self._in_item and self._item is not None:
                self._item["text"].append(data)

    src = ROOT / "dela.html"
    idx = ROOT / "index.html"
    marker = "<!--dela-seed-->"
    if not src.exists() or not idx.exists():
        if idx.exists() and marker in idx.read_text(encoding="utf-8"):
            sys.exit("dela-seed: нет dela.html, но маркер есть в index.html")
        return

    parser = SeedParser()
    parser.feed(src.read_text(encoding="utf-8"))
    if not parser.sections:
        sys.exit("dela-seed: в dela.html не найдено ни одного пункта")
    for sid, sec in parser.sections.items():
        sec["title"] = parser.headings.get(sid, "")

    seed = {
        "sections": [parser.sections[sid] for sid in parser.order],
    }
    blob = json.dumps(seed, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    text = idx.read_text(encoding="utf-8")
    if marker not in text:
        sys.exit("dela-seed: нет маркера <!--dela-seed--> в index.html")
    idx.write_text(
        text.replace(marker, f'<script type="application/json" id="dela-seed">{blob}</script>'),
        encoding="utf-8",
    )
    n = sum(len(s["items"]) for s in seed["sections"])
    print(f"  dela-seed        {len(seed['sections'])} раздела, {n} пунктов → index.html")


# --- календарь (.ics) ---------------------------------------------------------

# Все времена в UTC (DTSTART/DTEND ...Z) — без VTIMEZONE, принимается всеми
# календарями. Смещения: Москва/Стамбул +3, Панама −5, Коста-Рика −6.
# Все-day события — чистые даты, DTEND включительно (RFC 5545).
CALENDAR_EVENTS: list[tuple[str, str, str, str, str]] = [
    ("20261030T042700Z", "20261030T174900Z",
     "🚂 Поезд 131 Киров → Москва-Восточный",
     "07:27–20:49 по Москве. Вагон 06, нижнее.",
     "Киров-Пасс → Москва-Восточный"),
    ("20261030T234000Z", "20261031T035500Z",
     "✈️ TK 422 Внуково → Стамбул",
     "Вылет 31.10 02:40, прилёт 06:55. Быть во Внуково к 01:00.",
     "Внуково (SVO) → Стамбул (IST)"),
    ("20261031T105000Z", "20261101T010500Z",
     "✈️ TK 903 Стамбул → Панама",
     "Пересадка 6 ч 55 в Стамбуле. Вылет 13:50, прилёт в Панаму 20:05.",
     "Стамбул (IST) → Панама (PTY)"),
    ("20261031", "20261101",
     "🏨 Ночь в Панаме",
     "Прилёт 20:05. Завтра 13:28 вылет в Сан-Хосе.",
     "Панама"),
    ("20261101T182800Z", "20261101T195100Z",
     "✈️ CM 342 Панама → Сан-Хосе",
     "13:28–13:51 по местному. 2 часа в аэропорту: duty free, сдача багажа на Sansa.",
     "Панама (PTY) → Сан-Хосе (SJO)"),
    ("20261101T220000Z", "20261101T225000Z",
     "✈️ RZ 1076 Сан-Хосе → Либерия",
     "16:00–16:50 по местному. На Sansa строго 13 кг! Далее трансфер ~1 ч в Тамариндо.",
     "Сан-Хосе (SJO) → Либерия (LIR)"),
    ("20261102T003000Z", "20261102T010000Z",
     "🏨 Заселение Occidental Tamarindo",
     "~18:30 по местному (01.11). All Inclusive, прямой выход на пляж.",
     "Occidental Tamarindo, Playa Tamarindo, Guanacaste"),
    ("20261102", "20261106",
     "💼 Командировка в Тамариндо",
     "02–05 ноября. All Inclusive, туры, закаты на пляже.",
     "Occidental Tamarindo, Guanacaste"),
    ("20261106T110000Z", "20261106T120000Z",
     "🚕 Выезд из отеля → аэропорт LIR",
     "05:00–06:00 по местному. Строго к 05:00, в аэропорту к 06:00. Такси заказать накануне, breakfast box!",
     "Occidental Tamarindo → LIR"),
    ("20261106T133000Z", "20261106T142000Z",
     "✈️ RZ 1073 Либерия → Сан-Хосе",
     "07:30–08:20 по местному. Багаж 13 кг. В SJO — 6 часов ожидания.",
     "Либерия (LIR) → Сан-Хосе (SJO)"),
    ("20261106T204600Z", "20261106T221200Z",
     "✈️ CM 343 Сан-Хосе → Панама",
     "14:46–17:12 по местному. Прилёт — полные сутки в Панаме!",
     "Сан-Хосе (SJO) → Панама (PTY)"),
    ("20261106", "20261107",
     "🏨 Панама — полные сутки",
     "Ужин в Casco Viejo, ночью расписание шлюзов Панамского канала.",
     "Панама"),
    ("20261107", "20261108",
     "🌎 Панамский канал и Casco Viejo",
     "Днём канал и старый город, вечером дьюти-фри → аэропорт.",
     "Панама"),
    ("20261108T030000Z", "20261108T154500Z",
     "✈️ TK 904 Панама → Стамбул",
     "Вылет 07.11 22:00, прилёт 08.11 18:45. 12 ч 45 в воздухе.",
     "Панама (PTY) → Стамбул (IST)"),
    ("20261108T222000Z", "20261109T022000Z",
     "✈️ TK 407 Стамбул → Внуково",
     "Вылет 09.11 01:20, прилёт 05:20. 8 часов в Москве.",
     "Стамбул (IST) → Внуково (SVO)"),
    ("20261109T102000Z", "20261110T020700Z",
     "🚂 Поезд 070 Москва → Киров",
     "Ярославский вокзал 13:20, прибытие Киров-Пасс 10.11 в 05:07.",
     "Москва-Ярославская → Киров-Пасс"),
]

ICS_BAR = (
    '\n<div class="ics-bar">\n'
    '  <a class="btn-ics" href="calendar.ics" download="kosta-rica-2026.ics">'
    "📅 Скачать календарь — весь маршрут</a>\n"
    '  <span class="ics-hint">поезда, рейсы, отели · .ics для Apple/Google/Outlook</span>\n'
    "</div>\n"
)


def ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
    )


def ics_fold(line: str) -> str:
    """Складывает строку по RFC 5545: ≤75 октетов, продолжение с пробелом."""
    data = line.encode("utf-8")
    if len(data) <= 74:
        return line
    parts: list[str] = []
    i, limit = 0, 74
    while i < len(data):
        j = min(i + limit, len(data))
        while j < len(data) and (data[j] & 0xC0) == 0x80:  # не рвём UTF-8-символ
            j -= 1
        parts.append(data[i:j].decode("utf-8"))
        i, limit = j, 73
    return "\r\n ".join(parts)


def write_calendar() -> None:
    """Генерирует calendar.ics — весь маршрут одним файлом (UTC, CRLF, fold)."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Kosta-Rika 2026//Pura Vida//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Коста-Рика 2026 · 30.10–10.11",
    ]
    for n, (start, end, summary, desc, loc) in enumerate(CALENDAR_EVENTS, 1):
        lines += [
            "BEGIN:VEVENT",
            f"UID:kr2026-{n:02d}@kosta-rica",
            "DTSTAMP:20261003T000000Z",
            f"DTSTART:{start}",
            f"DTEND:{end}",
            f"SUMMARY:{ics_escape(summary)}",
        ]
        if desc:
            lines.append(f"DESCRIPTION:{ics_escape(desc)}")
        if loc:
            lines.append(f"LOCATION:{ics_escape(loc)}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    text = "\r\n".join(ics_fold(line) for line in lines) + "\r\n"
    with open(ROOT / "calendar.ics", "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print(f"  calendar.ics     {len(CALENDAR_EVENTS)} событий")


def write_sw() -> None:
    """Генерирует sw.js: precache всех страниц/ассетов/документов.

    Имя кэша = хэш содержимого — любая правка (включая перегенерацию
    зашифрованных docs/) даёт новый кэш и удаление старого на activate.
    """
    import hashlib

    files: list[str] = []
    for p in sorted(ROOT.glob("*.html")):
        if p.name != "template.html":
            files.append(p.name)
    for p in sorted(ROOT.glob("*.ics")):
        files.append(p.name)
    for sub in ("assets", "docs"):
        for p in sorted((ROOT / sub).rglob("*")):
            if p.is_file():
                files.append(p.relative_to(ROOT).as_posix())
    if (ROOT / "manifest.json").exists():
        files.append("manifest.json")

    h = hashlib.sha1()
    for rel in files:
        h.update(rel.encode())
        h.update((ROOT / rel).read_bytes())
    ver = h.hexdigest()[:12]

    assets_js = ",\n  ".join(json.dumps(f, ensure_ascii=False) for f in files)
    sw = f"""/* Генерируется build.py — не редактировать вручную.
   Версия кэша (sha1 содержимого): {ver} */
"use strict";
var CACHE = "cr-{ver}";
var ASSETS = [
  {assets_js}
];

self.addEventListener("install", function (e) {{
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {{ return c.addAll(ASSETS); }})
      .then(function () {{ return self.skipWaiting(); }})
  );
}});

self.addEventListener("activate", function (e) {{
  e.waitUntil(
    caches.keys().then(function (keys) {{
      return Promise.all(keys.filter(function (k) {{ return k !== CACHE; }})
        .map(function (k) {{ return caches.delete(k); }}));
    }}).then(function () {{ return self.clients.claim(); }})
  );
}});

// PMTiles читается через Range-запросы — нарезаем тело из кэша сами
function pmtilesRange(req, url) {{
  return caches.open(CACHE).then(function (c) {{
    return c.match(url.pathname, {{ ignoreSearch: true }});
  }}).then(function (hit) {{
    if (!hit) return fetch(req);
    return hit.arrayBuffer().then(function (buf) {{
      var total = buf.byteLength;
      var range = req.headers.get("range");
      var m = range && /^bytes=(\\d+)-(\\d*)$/.exec(range);
      if (!m) {{
        return new Response(buf, {{
          status: 200,
          headers: {{
            "Content-Type": "application/x-protobuf",
            "Content-Length": String(total),
            "Accept-Ranges": "bytes"
          }}
        }});
      }}
      var start = parseInt(m[1], 10);
      var end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (end > total - 1) end = total - 1;
      if (start > end || start > total - 1) {{
        return new Response(null, {{
          status: 416,
          headers: {{"Content-Range": "bytes */" + total}}
        }});
      }}
      var chunk = buf.slice(start, end + 1);
      return new Response(chunk, {{
        status: 206,
        headers: {{
          "Content-Type": "application/x-protobuf",
          "Content-Range": "bytes " + start + "-" + end + "/" + total,
          "Content-Length": String(chunk.byteLength),
          "Accept-Ranges": "bytes"
        }}
      }});
    }});
  }});
}}

self.addEventListener("fetch", function (e) {{
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // чужие домены (погода, статусы рейсов) — всегда напрямую в сеть
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith(".pmtiles")) {{
    e.respondWith(pmtilesRange(req, url));
    return;
  }}

  e.respondWith(
    caches.open(CACHE).then(function (c) {{
      return c.match(req, {{ ignoreSearch: true }}).then(function (hit) {{
        if (hit) {{
          // stale-while-revalidate: отдаём кэш, фоново обновляем
          if (!url.search) {{
            fetch(req).then(function (resp) {{
              if (resp.ok) c.put(req, resp.clone());
            }}).catch(function () {{}});
          }}
          return hit;
        }}
        return fetch(req).then(function (resp) {{
          if (resp.ok && !url.search) c.put(req, resp.clone());
          return resp;
        }}).catch(function (err) {{
          if (req.mode === "navigate") {{
            return c.match("index.html", {{ ignoreSearch: true }}).then(function (fb) {{
              return fb || Promise.reject(err);
            }});
          }}
          throw err;
        }});
      }});
    }})
  );
}});
"""
    (ROOT / "sw.js").write_text(sw, encoding="utf-8")
    print(f"  sw.js            {len(files)} файлов, кэш cr-{ver}")


def main() -> None:
    for md_name, (out, title) in PAGES_MD.items():
        src = SRC_MD / md_name
        if not src.exists():
            print(f"  skip {md_name} (нет файла)")
            continue
        text = src.read_text(encoding="utf-8")
        body = md_to_body(text, out)
        if out == "marshrut.html" and "</h1>" in body:
            body = body.replace("</h1>", "</h1>" + ICS_BAR, 1)
        toc = md_toc(text, out)
        (ROOT / out).write_text(render(title, body, toc), encoding="utf-8")
        print(f"  {out:16} ← {md_name}")

    for src_name, (out, title) in PAGES_HTML.items():
        src = SRC_HTML / src_name
        if not src.exists():
            print(f"  skip {src_name} (нет файла)")
            continue
        body = src.read_text(encoding="utf-8")
        if out in EDITABLE:
            body = wrap_editable(body, out)
        (ROOT / out).write_text(render(title, body), encoding="utf-8")
        print(f"  {out:16} ← src/{src_name}")

    write_dela_seed()
    write_calendar()
    write_sw()
    print("done")


if __name__ == "__main__":
    main()
