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
import shutil
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
    return wrap_editable_cfg(body, EDITABLE[out])


def wrap_editable_cfg(body: str, cfg: dict) -> str:
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


# --- этапы маршрута (пошаговый путеводитель) ---------------------------------

# dateStart/dateEnd — ISO-даты (None = без границы); after/until — HH:MM,
# уточняют границу первого/последнего дня (текущий этап = последний подходящий).
STEPS: list[dict] = [
    {"id": "prep", "num": 0, "icon": "🧳", "title": "Подготовка к поездке",
     "dateStart": None, "dateEnd": "2026-10-29", "dateLabel": "до 29 октября",
     "place": "Киров", "summary": "Документы, билеты, сборы, дела, деньги, связь, аптечка и чек-листы — всё, что делаем до отъезда."},
    {"id": "train-msk", "num": 1, "icon": "🚆", "title": "Поезд Киров → Москва",
     "dateStart": "2026-10-30", "dateEnd": "2026-10-30", "dateLabel": "30 октября",
     "place": "№131 · посадка 07:27", "summary": "13 ч 22 мин в пути: один приём пищи в билете, еда с собой, прибытие на Восточный 20:49 и переезд во Внуково."},
    {"id": "ist-flight", "num": 2, "icon": "✈️", "title": "Москва → Стамбул",
     "dateStart": "2026-10-31", "dateEnd": "2026-10-31", "dateLabel": "31 октября",
     "place": "TK 422", "summary": "Ночной вылет 02:40, прилёт в Стамбул 06:55, пересадка 6 ч 55 мин."},
    {"id": "ist-layover", "num": 3, "icon": "🔄", "title": "Стамбул: пересадка 6ч 55м",
     "dateStart": "2026-10-31", "after": "06:55", "dateEnd": "2026-10-31", "until": "13:50",
     "dateLabel": "31 октября", "place": "IST, пересадка",
     "summary": "Лаунж, душ, завтрак, выход в город (если время). Багаж до Панамы, но в Панаме его забирать."},
    {"id": "ist-panama", "num": 4, "icon": "✈️", "title": "Стамбул → Панама",
     "dateStart": "2026-10-31", "after": "13:50", "dateEnd": "2026-10-31", "dateLabel": "31 октября",
     "place": "TK 903", "summary": "Длинный перелёт ~15ч, прилёт в Панаму 20:05. Ночь в отеле рядом с аэропортом."},
    {"id": "panama-night", "num": 5, "icon": "🌃", "title": "Ночь в Панаме",
     "dateStart": "2026-10-31", "after": "20:05", "dateEnd": "2026-11-01", "until": "13:28",
     "dateLabel": "31.10 ночью – 01.11 до обеда", "place": "Отель рядом с PTY",
     "summary": "Только ночь: ужин у отеля, пограничный контроль Панамы, вылет в Сан-Хосе 13:28."},
    {"id": "arrival-cr", "num": 6, "icon": "🛬", "title": "Прилёт в Коста-Рику",
     "dateStart": "2026-11-01", "after": "13:28", "dateEnd": "2026-11-01", "dateLabel": "1 ноября",
     "place": "SJO → LIR → Тамариндо", "summary": "CM 342, два часа в SJO (сдача багажа на Sansa, разведка цен), рейс в Либерию 16:00 и трансфер в отель ~18:30."},
    {"id": "tamarindo", "num": 7, "icon": "🏖️", "title": "Тамариндо: 5 дней",
     "dateStart": "2026-11-01", "after": "18:30", "dateEnd": "2026-11-06", "until": "05:00",
     "dateLabel": "1 – 6 ноября", "place": "Occidental 4★ · All Inclusive",
     "summary": "Пляжи, командировка, туры и закаты — главная база поездки. Питание включено, правила Коста-Рики и разговорник под рукой."},
    {"id": "sjo-window", "num": 8, "icon": "🔁", "title": "Вылет и окно в SJO",
     "dateStart": "2026-11-06", "after": "05:00", "dateEnd": "2026-11-06", "until": "17:12",
     "dateLabel": "6 ноября", "place": "LIR → SJO → Панама",
     "summary": "Выезд 05:00 с breakfast box, Sansa в 07:30, шесть часов в Сан-Хосе (покупки!), Copa в Панаму 14:46."},
    {"id": "panama-days", "num": 9, "icon": "🇵🇦", "title": "Панама: полные сутки",
     "dateStart": "2026-11-06", "after": "17:12", "dateEnd": "2026-11-07", "until": "22:00",
     "dateLabel": "6 – 7 ноября", "place": "Casco Viejo · Панамский канал",
     "summary": "Ужин в Casco Viejo, ночью шлюзы, днём канал и город, покупки и дьюти-фри PTY."},
    {"id": "home", "num": 10, "icon": "🏠", "title": "Обратно: Панама → Стамбул → Москва",
     "dateStart": "2026-11-07", "after": "22:00", "dateEnd": "2026-11-09", "dateLabel": "7 – 9 ноября",
     "place": "TK 904 + TK 407",
     "summary": "Ночной перелёт, стыковка в Стамбуле, Внуково 05:20, восемь часов в Москве и поезд домой."},
]

# Краткие редакторские вступления на странице шага (HTML).
STEP_INTRO: dict[str, str] = {
    "prep": """<div class="note info"><h4>🧭 С чего начать</h4>
<p>Этот шаг — всё, что делается <strong>до 30 октября</strong>: билеты и брони в «Документах», чек-листы сборов и дел (галочки сохраняются), деньги, связь и аптечка. Отмечай выполненное прямо здесь.</p></div>""",
    "train-msk": """<div class="note info"><h4>🚆 На этом шаге</h4>
<p>Посадка 07:27, в купе <strong>один приём пищи</strong> — вагон-ресторан платный, поэтому еда с собой (чек-лист магазина — в «Подготовке»). На Восточный прибываем 20:49 — дальше метро/такси во Внуково, вылет в 02:40.</p></div>""",
    "ist-flight": """<div class="note info"><h4>✈️ На этом шаге</h4>
<p>Ночной рейс <strong>TK 422</strong> Внуково → Стамбул. Вылет 02:40, прилёт 06:55. Спим в самолёте, завтрак на борту. Багаж идёт до Панамы, но в Панаме его надо забрать и пройти таможню (билеты разные — "Золотое правило" из "Подготовки").</p></div>""",
    "ist-layover": """<div class="note info"><h4>🔄 На этом шаге</h4>
<p><strong>6 ч 55 мин</strong> пересадки в Стамбуле (IST): лаунж, душ, завтрак. Если время позволит — краткая экскурсия (но лучше остаться в аэропорту, запас времени!). Дальше рейс TK 903 в Панаму.</p></div>""",
    "ist-panama": """<div class="note info"><h4>✈️ На этом шаге</h4>
<p>Длинный перелёт <strong>TK 903</strong> Стамбул → Панама (~15ч). Вылет 13:50, прилёт 20:05. Обед/ужин на борту. Ночь в отеле рядом с аэропортом PTY.</p></div>""", 
    "panama-night": """<div class="note info"><h4>🌃 На этом шаге</h4>
<p>Только ночь: ужин у отеля, ранний завтрак (выезд до 13:28). Проходите <strong>пограничный контроль Панамы</strong> — правила и что проверяют — ниже. Номер отеля и ваучер — в «Документах».</p></div>""",
    "arrival-cr": """<div class="note info"><h4>🛬 На этом шаге</h4>
<p>Прилёт 13:51, <strong>два часа окна в SJO</strong>: забрать багаж → выход в общий зал → сдача на Sansa к 15:15 (13 кг!) → успеть duty free с ценами. Рейс в Либерию 16:00, дальше ~60 км до Тамариндо — вези воду и перекус. К заселению ~18:30.</p></div>""",
    "tamarindo": """<div class="note info"><h4>🏖️ На этом шаге</h4>
<p>Главная база: All Inclusive (завтрак/обед/ужин/напитки), пляж с территории, командировка и туры. Здесь пригодятся <a href="phrasebook.html">разговорник</a>, <a href="hotel.html">карта отеля</a> и правила Коста-Рики ниже. Вода/снеки включены в отель.</p></div>""",
    "sjo-window": """<div class="note info"><h4>🔁 На этом шаге</h4>
<p>Самый насыщенный транзитный день: выезд 05:00 (накануне заказать <strong>breakfast box</strong> на ресепшене), Sansa только со стойки, в SJO <strong>6 ч 26 мин</strong> — основное окно покупок. Багаж: забрать → общий зал → регистрация на Copa заново.</p></div>""",
    "panama-days": """<div class="note info"><h4>🇵🇦 На этом шаге</h4>
<p><strong>Полные сутки</strong>, а не транзит: ужин в Casco Viejo, ночной выезд на расписание шлюзов, днём Панамский канал и город, покупки (mola, tagua) и дьюти-фри PTY перед вылетом 22:00.</p></div>""",
    "home": """<div class="note info"><h4>🚂 На этом шаге</h4>
<p>TK 904 22:00 (12 ч 45) → Стамбул, лаунж и дьюти-фри IST → TK 407 → Внуково 05:20. Восемь часов в Москве: чемодан в камеру хранения на Ярославском, к поезду 070 к 12:20. Последний шанс — покупки на вынос.</p></div>""",
}

# Контент шага: (md-файл, "## заголовок" | "### заголовок" | "*" = весь файл)
# или ("@meal", маркеры) — строки таблицы «Питание по маршруту» по шагам.
STEP_INCLUDES: dict[str, list] = {
    "prep": [
        ("plan-poezdki.md", "## 📋 Общая информация"),
        ("plan-poezdki.md", "## 🎫 Все билеты — сводная таблица"),
        ("plan-poezdki.md", "## 🕐 Часовые пояса"),
        ("plan-poezdki.md", "### Сводная таблица"),
        ("plan-poezdki.md", "### 📖 Инструкция C — Когда билеты разные (самое важное)"),
        ("plan-poezdki.md", "## 🍽️ Питание и вода"),
        ("plan-poezdki.md", "## 📝 Важные даты"),
        ("plan-poezdki.md", "## 🛂 Документы на каждом участке"),
        ("plan-poezdki.md", "## 💡 Общие лайфхаки по перелётам"),
        ("plan-poezdki.md", "## ⚠️ Что нужно доделать"),
        ("packing-list.md", "*"),
        ("eda.md", "## 🚆 Поезда — что с едой"),
        ("eda.md", "## 🚆 Еда в поезд — что купить с собой"),
        ("eda.md", "## ✈️ Самолёты — что дают на борту"),
        ("eda.md", "## 🛒 Перекусы — чем устроить"),
        ("eda.md", "## 💧 Вода"),
        ("eda.md", "## ☕ Кофе"),
        ("eda.md", "## 💰 Бюджет на еду"),
        ("eda.md", "## ✅ Чек-лист по еде"),
        ("pravila-zakony.md", "## Въезд и пребывание"),
        ("pravila-zakony.md", "## Лекарства и здоровье"),
        ("pravila-zakony.md", "## Экстренные контакты"),
        ("pravila-zakony.md", "## Валюта и платежи"),
        ("lifehacks.md", "## 💰 Деньги и платежи"),
        ("lifehacks.md", "## 📱 Связь и интернет"),
        ("lifehacks.md", "## 🎒 Паковка — что реально нужно"),
        ("lifehacks.md", "## 🗣️ Коммуникация"),
        ("lifehacks.md", "## 🌿 Здоровье и медицина"),
        ("lifehacks.md", "## 🎯 Чек-лист перед поездкой"),
        ("chto-kupit.md", "## 🧳 Когда и где покупать — с учётом билетов"),
        ("chto-kupit.md", "## 🚫 Что НЕ покупать"),
        ("chto-kupit.md", "## 📦 Ограничения"),
        ("chto-kupit.md", "## 💰 Бюджет"),
        ("dela.html", "*"),
    ],
    "train-msk": [
        ("plan-poezdki.md", "### 30 октября 2026, Пятница — Поезд Киров → Москва"),
        ("lifehacks.md", "### 30.10 — Поезд, прибытие в Москву 20:49"),
        ("@meal", ["Поезд Киров", "Москва, Восточный"]),
    ],
    "ist-flight": [
        ("plan-poezdki.md", "### 31 октября 2026, Суббота — Москва → Стамбул → Панама"),
        ("plan-poezdki.md", "### 📖 Инструкция A — Стыковка в аэропорту (IST, SJO)"),
        ("pravila-zakony.md", "### Турция (транзит в Стамбуле IST)"),
        ("lifehacks.md", "### 31.10 — Ночной перелёт Москва → Панама со стыковкой в Стамбуле"),
        ("@meal", ["TK 422"]),
    ],
    "ist-layover": [
        ("plan-poezdki.md", "### 31 октября 2026, Суббота — Москва → Стамбул → Панама"),
        ("pravila-zakony.md", "### Турция (транзит в Стамбуле IST)"),
        ("lifehacks.md", "### 31.10 — Ночной перелёт Москва → Панама со стыковкой в Стамбуле"),
        ("@meal", ["Стамбул, пересадка 6 ч 55"]),
    ],
    "ist-panama": [
        ("plan-poezdki.md", "### 31 октября 2026, Суббота — Москва → Стамбул → Панама"),
        ("pravila-zakony.md", "### 31.10 — Ночной перелёт Москва → Стамбул → Панама"),
        ("lifehacks.md", "### 31.10 — Ночной перелёт Москва → Панама со стыковкой в Стамбуле"),
        ("@meal", ["TK 903"]),
    ],
    "panama-night": [
        ("plan-poezdki.md", "### 31.10 (20:05) – 01.11 (13:28) — Ночь в Панаме"),
        ("plan-poezdki.md", "### 1-я: 31.10 (20:05) → 01.11 (13:28) — только ночь"),
        ("plan-poezdki.md", "### 📖 Инструкция D — Пограничный контроль"),
        ("pravila-zakony.md", "### Панама"),
        ("pravila-zakony.md", "### 31.10–01.11 — Пограничный контроль в Панаме (1-я остановка)"),
        ("@meal", ["Панама 20:05", "Завтрак в Панаме"]),
    ],
    "arrival-cr": [
        ("plan-poezdki.md", "### 1 ноября 2026, Воскресенье — Панама → Сан-Хосе → Либерия"),
        ("plan-poezdki.md", "### 📖 Инструкция A — Стыковка в аэропорту (IST, SJO)"),
        ("pravila-zakony.md", "### 01.11 — Прилёт в Сан-Хосе 13:51"),
        ("lifehacks.md", "### 01.11 — Прилёт в Сан-Хосе 13:51, вылет в Либерию 16:00"),
        ("chto-kupit.md", "## 📍 Разведка 01.11 — прилёт в SJO: снять цены, чтобы потом купить правильно"),
        ("@meal", ["CM 342", "SJO, окно 2 ч", "RZ 1076", "Трансфер LIR"]),
    ],
    "tamarindo": [
        ("plan-poezdki.md", "## 🏨 Тамариндо (01.11 – 06.11)"),
        ("eda.md", "## 🌴 Коста-Рика — где поесть"),
        ("eda.md", "## 🥃 Алкоголь — где дешевле"),
        ("eda.md", "## 🍽️ Питание на турах"),
        ("pravila-zakony.md", "## Поведение и этикет"),
        ("pravila-zakony.md", "## Безопасность на водах"),
        ("pravila-zakony.md", "## Вождение"),
        ("pravila-zakony.md", "## Национальные парки и природа"),
        ("pravila-zakony.md", "## Камуфляжная одежда"),
        ("pravila-zakony.md", "## Фото и приватность"),
        ("pravila-zakony.md", "## Наркотики"),
        ("pravila-zakony.md", "## Таможня (вывоз)"),
        ("pravila-zakony.md", "## Полиция и правовая система"),
        ("pravila-zakony.md", "## Пикантные моменты и табу"),
        ("pravila-zakony.md", "## Культурные нормы и табу"),
        ("pravila-zakony.md", "## Частые ошибки туристов"),
        ("pravila-zakony.md", "## 📅 Ноябрь (1–6) — сезонные особенности"),
        ("lifehacks.md", "## 🚐 Транспорт"),
        ("lifehacks.md", "## 🍽️ Еда и напитки"),
        ("lifehacks.md", "## 🏖️ Пляжи и природа"),
        ("lifehacks.md", "## 🛡️ Безопасность в Тамариндо"),
        ("lifehacks.md", "## 🛡️ Общая безопасность"),
        ("lifehacks.md", "## 🗓️ Тайминг — когда ехать"),
        ("lifehacks.md", "## 🛒 Шопинг и сувениры"),
        ("lifehacks.md", "## 🤫 Секретные места (менее туристические)"),
        ("lifehacks.md", "## 🏨 Occidental Tamarindo — максимум деталей"),
        ("lifehacks.md", "## 🏖️ Тамариндо — навигация"),
        ("lifehacks.md", "## 📅 Ноябрь (1–6) — конкретные рекомендации"),
        ("chto-kupit.md", "### Из Коста-Рики"),
        ("chto-kupit.md", "## ☕ Коста-Рика — подробно"),
        ("@meal", ["Occidental, All Inclusive"]),
    ],
    "sjo-window": [
        ("plan-poezdki.md", "### 6 ноября 2026, Пятница — Тамариндо → Либерия → Сан-Хосе"),
        ("plan-poezdki.md", "### 6 ноября 2026, Пятница — Сан-Хосе → Панама (запас по времени)"),
        ("plan-poezdki.md", "### 📖 Инструкция A — Стыковка в аэропорту (IST, SJO)"),
        ("pravila-zakony.md", "### 06.11 — Ранний вылет из LIR + 6 часов в SJO + вылет в Панаму"),
        ("lifehacks.md", "### 06.11 — Ранний вылет из LIR в 07:30"),
        ("chto-kupit.md", "### 🥉 SJO (Сан-Хосе, 06.11, 6 часов) — **основное окно покупок**"),
        ("chto-kupit.md", "### LIR (Либерия, 06.11, 06:00–07:30) — почти нет времени"),
        ("@meal", ["Завтрак в отеле", "RZ 1073", "SJO, пересадка 6 ч 26", "CM 343"]),
    ],
    "panama-days": [
        ("plan-poezdki.md", "### 2-я: 06.11 (17:12) → 07.11 (22:00) — **полные сутки!**"),
        ("plan-poezdki.md", "### 📖 Инструкция D — Пограничный контроль"),
        ("pravila-zakony.md", "### Панама"),
        ("pravila-zakony.md", "### 06–07.11 — Пограничный контроль в Панаме (2-я остановка, сутки!)"),
        ("lifehacks.md", "### 06–07.11 — Полные сутки в Панаме (а не одна ночь!)"),
        ("eda.md", "## 🌆 Панама — где поесть (06–07.11)"),
        ("chto-kupit.md", "## 🇵🇦 Панама — где и что покупать"),
        ("chto-kupit.md", "### Из Панамы"),
        ("@meal", ["Панама, сутки"]),
    ],
    "home": [
        ("plan-poezdki.md", "### 7 ноября 2026, Суббота — Панама → Стамбул"),
        ("plan-poezdki.md", "### 9 ноября 2026, Понедельник — Поезд Москва → Киров"),
        ("pravila-zakony.md", "### 09.11 — Прибытие в Москву, поезд в Киров"),
        ("lifehacks.md", "### 09.11 — Прибытие в Москву 05:20, поезд в 13:20"),
        ("chto-kupit.md", "### 🥇 PTY (Панама, 07.11) — лучшее место для алкоголя"),
        ("chto-kupit.md", "### 🥈 IST (Стамбул, 08.11, пересадка 6 ч 35 мин) — **только ручная кладь**"),
        ("chto-kupit.md", "### Внуково (09.11, 05:20–13:20)"),
        ("chto-kupit.md", "### Из Стамбула (дьюти-фри IST, пересадка 6 ч 35 мин)"),
        ("@meal", ["TK 904", "Стамбул, пересадка 6 ч 35", "TK 407", "Внуково 05:20", "Поезд Москва → Киров"]),
    ],
}


def extract_md_section(text: str, heading: str) -> str:
    """Заголовок (любого уровня) + тело до следующего заголовка того же/выше уровня."""
    lines = text.splitlines()
    start, level = None, 0
    for i, line in enumerate(lines):
        if line.strip() == heading:
            start = i
            level = len(line) - len(line.lstrip("#"))
            break
    if start is None:
        raise KeyError(f"заголовок не найден: {heading!r}")
    end = len(lines)
    for j in range(start + 1, len(lines)):
        m = re.match(r"^(#{1,6})\s+", lines[j])
        if m and len(m.group(1)) <= level:
            end = j
            break
    return "\n".join(lines[start:end]).strip()


def md_heading_level(heading: str) -> int:
    return len(heading) - len(heading.lstrip("#"))


def postprocess_links(body: str) -> str:
    """Переписывает ссылки .md → .html и оборачивает таблицы в .table-wrap."""

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

    def humanize(m: re.Match) -> str:
        base = m.group(2).rsplit("/", 1)[-1]
        if base in LINK_TEXT:
            return f'<a href="{m.group(1)}">{LINK_TEXT[base]}</a>'
        return m.group(0)

    body = re.sub(r'<a href="([^"]+)">([^<]*\.md)</a>', humanize, body)
    body = re.sub(r"(<table>.*?</table>)", r'<div class="table-wrap">\1</div>', body, flags=re.S)
    return body


def extract_meal_rows(md_text: str, markers: list[str]) -> str:
    """Строки таблицы «Питание по маршруту», попавшие под маркеры, — mini-таблица."""
    section = extract_md_section(md_text, "## 📅 Питание по маршруту")
    lines = [ln for ln in section.splitlines() if ln.strip().startswith("|")]
    if len(lines) < 3:
        return ""
    header, sep = lines[0], lines[1]
    rows = [ln for ln in lines[2:] if ln.strip() and ln.strip() != sep]
    picked = [r for r in rows if any(mk in r for mk in markers)]
    if not picked:
        raise KeyError(f"строки питания не найдены по маркерам: {markers}")
    return "\n".join([header, sep] + picked)


def write_steps() -> None:
    """Страница-оглавление steps.html + step-*.html + JSON-сид для steps.js."""
    import json as _json

    texts: dict[str, str] = {}
    for md_name in {inc[0] for steps in STEP_INCLUDES.values() for inc in steps} - {"@meal"}:
        if md_name.endswith(".md"):
            src = SRC_MD / md_name
        else:
            src = SRC_HTML / md_name
        if not src.exists():
            raise FileNotFoundError(md_name)
        texts[md_name] = src.read_text(encoding="utf-8")

    seed_steps = [
        {k: s[k] for k in ("id", "num", "icon", "title", "dateStart", "dateEnd",
                           "after", "until", "dateLabel", "place", "summary") if k in s}
        for s in STEPS
    ]
    seed = _json.dumps(seed_steps, ensure_ascii=False)

    # --- оглавление steps.html ---
    cards = []
    for s in STEPS:
        cards.append(
            f'<a class="step-card" href="step-{s["id"]}.html" data-step-card="{s["id"]}">'
            f'<span class="step-badge" hidden>Сейчас здесь</span>'
            f'<span class="step-num">{s["num"]}</span>'
            f'<span class="step-ic">{s["icon"]}</span>'
            f'<span class="step-main"><span class="step-title">{html.escape(s["title"])}</span>'
            f'<span class="step-summary">{html.escape(s["summary"])}</span></span>'
            f'<span class="step-when">{html.escape(s["dateLabel"])}</span>'
            f"</a>"
        )
    index_body = (
        '<section class="hero"><div class="hero-body">'
        "<h1>Маршрут по шагам</h1>"
        "<p>Девять этапов поездки: что делать, куда идти и к чему готовиться — на каждом шаге свой контент.</p>"
        '<div class="hero-tags"><span>30.10 – 09.11.2026</span><span>Текущий этап определяется по дате</span></div>'
        "</div></section>\n"
        '<div class="step-now" data-step-now hidden></div>\n'
        '<div class="steps-index" data-steps-index>\n' + "\n".join(cards) + "\n</div>"
    )
    (ROOT / "steps.html").write_text(render("Маршрут по шагам", index_body), encoding="utf-8")

    # --- страницы шагов ---
    for idx, s in enumerate(STEPS):
        page = f"step-{s['id']}.html"
        parts: list[str] = []
        md_parts: list[str] = []
        for inc in STEP_INCLUDES[s["id"]]:
            if inc[0] == "@meal":
                sec = extract_meal_rows(texts["eda.md"], inc[1])
            elif inc[1] == "*":
                sec = texts[inc[0]]
            else:
                sec = extract_md_section(texts[inc[0]], inc[1])
            md_parts.append(sec)

            public_md, _ = split_secret(sec, page)
            frag = pandoc(public_md, "-f", "gfm+task_lists", "-t", "html5", "--wrap=none")
            frag = postprocess_links(frag)
            if inc[0] == "packing-list.md":
                frag = wrap_editable(frag, "sbory.html")
            elif inc[0] == "dela.html":
                frag = re.sub(r"<h1>.*?</h1>\s*", "", frag, count=1, flags=re.S)
                frag = wrap_editable_cfg(frag, {"key": "dela", "label": "сделано"})
            parts.append(frag)

        prev_s = STEPS[idx - 1] if idx > 0 else None
        next_s = STEPS[idx + 1] if idx < len(STEPS) - 1 else None
        nav_parts = []
        if prev_s:
            nav_parts.append(
                f'<a class="step-prev" href="step-{prev_s["id"]}.html">← <span>{prev_s["icon"]} {html.escape(prev_s["title"])}</span></a>'
            )
        nav_parts.append('<a class="step-all" href="steps.html">📋 Все этапы</a>')
        if next_s:
            nav_parts.append(
                f'<a class="step-next" href="step-{next_s["id"]}.html"><span>{next_s["icon"]} {html.escape(next_s["title"])}</span> →</a>'
            )

        body = (
            f'<section class="hero step-hero"><div class="hero-body">'
            f'<div class="step-kicker">Шаг {s["num"]} из {len(STEPS) - 1}</div>'
            f"<h1>{s['icon']} {html.escape(s['title'])}</h1>"
            f"<p>{html.escape(s['summary'])}</p>"
            f'<div class="hero-tags"><span>📅 {html.escape(s["dateLabel"])}</span>'
            f'<span>📍 {html.escape(s["place"])}</span></div>'
            f"</div></section>\n"
            f'<div class="step-now" data-step-now data-step-id="{s["id"]}" hidden></div>\n'
            f'{STEP_INTRO.get(s["id"], "")}\n'
            + "\n".join(parts)
            + '\n<nav class="step-nav">' + "".join(nav_parts) + "</nav>"
        )

        md_for_toc = "\n\n".join(md_parts)
        try:
            toc = md_toc(md_for_toc, page)
        except SystemExit:
            raise
        (ROOT / page).write_text(render(f'Шаг {s["num"]}: {s["title"]}', body, toc), encoding="utf-8")

        html_text = (ROOT / page).read_text(encoding="utf-8")
        # Вставляем seed в существующий <script id="steps-seed"> из template.html
        html_text = html_text.replace(
            '<script id="steps-seed" type="application/json"></script>',
            f'<script id="steps-seed" type="application/json">{seed}</script>',
        )
        (ROOT / page).write_text(html_text, encoding="utf-8")
        print(f"  {page:26} шаг {s['num']} · {len(parts)} секций")

    # --- сид на главную и оглавление ---
    for name in ("index.html", "steps.html"):
        p = ROOT / name
        if not p.exists():
            continue
        t = p.read_text(encoding="utf-8")
        if "steps-seed" not in t:
            t = t.replace(
                "</body>",
                f'<script id="steps-seed" type="application/json">{seed}</script>\n</body>',
            )
            p.write_text(t, encoding="utf-8")
    print(f"  steps:            {len(STEPS)} шагов, steps.html + step-*.html")


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
                rel = p.relative_to(ROOT).as_posix()
                # D10: Не включаем PMTiles в precache — пользователь скачивает явно
                if rel.endswith(".pmtiles"):
                    continue
                files.append(rel)
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


def write_www() -> None:
    """Веб-сборка для Capacitor: публичные файлы → www/ (не коммитится)."""
    www = ROOT / "www"
    if www.exists():
        shutil.rmtree(www)
    www.mkdir()
    n = 0
    for f in ROOT.iterdir():
        if f.is_file() and (f.suffix == ".html"
                            or f.name in ("calendar.ics", "manifest.json", "sw.js")):
            shutil.copy2(f, www / f.name)
            n += 1
    for d in ("assets", "docs"):
        shutil.copytree(ROOT / d, www / d)
    print(f"  www/             {n} файлов + assets/ docs/ (Capacitor)")


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

    write_steps()
    write_dela_seed()
    write_calendar()
    write_sw()
    write_www()
    validate_trip_json()
    print("done")


def validate_trip_json() -> None:
    """Валидация trip.json — падает если данные сломаны (лечит D8)."""
    import datetime

    trip_path = ROOT / "trip.json"
    if not trip_path.exists():
        print("  trip.json: не найден (пропуск)")
        return

    try:
        data = json.loads(trip_path.read_text(encoding="utf-8"))
    except Exception as e:
        sys.exit(f"trip.json: не удалось распарсить JSON: {e}")

    segments = data.get("segments", [])
    if not segments:
        sys.exit("trip.json: нет segments")

    # Проверка required fields
    required = ["id", "num", "kind", "title", "startAt"]
    valid_kinds = {"preparation", "train", "flight", "stay", "transfer", "layover", "window"}

    for seg in segments:
        for field in required:
            if field not in seg:
                sys.exit(f"trip.json: сегмент {seg.get('id', '?')} без поля '{field}'")
        if seg.get("kind") and seg["kind"] not in valid_kinds:
            sys.exit(f"trip.json: неверный kind '{seg['kind']}' в {seg['id']}")

        # Проверка startAt > 0
        try:
            start = datetime.datetime.fromisoformat(seg["startAt"])
            end = datetime.datetime.fromisoformat(seg["endAt"])
            if end <= start:
                sys.exit(f"trip.json: endAt <= startAt в {seg['id']}")
        except Exception as e:
            sys.exit(f"trip.json: ошибка парсинга дат в {seg['id']}: {e}")

    # Проверка пересечений и дыр (исключаем preparation)
    sorted_segs = sorted(
        [s for s in segments if s.get("kind") != "preparation"],
        key=lambda s: s["startAt"],
    )
    for i in range(len(sorted_segs) - 1):
        curr_end = datetime.datetime.fromisoformat(sorted_segs[i]["endAt"])
        next_start = datetime.datetime.fromisoformat(sorted_segs[i + 1]["startAt"])
        diff = (next_start - curr_end).total_seconds()
        if diff > 86400:  # >24 часов дыра
            sys.exit(f"trip.json: дыра >24ч между {sorted_segs[i]['id']} и {sorted_segs[i+1]['id']}")

    print(f"  trip.json:        {len(segments)} сегментов, валидация пройдена")


if __name__ == "__main__":
    main()
