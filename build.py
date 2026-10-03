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
# Путь к markdown: сначала пробуем ROOT.parent/kosta-rica (локально), потом ROOT/kosta-rica (GitHub Actions)
_sibling_md = ROOT.parent / "kosta-rica"
_in_repo_md = ROOT / "kosta-rica"
if _sibling_md.exists():
    SRC_MD = _sibling_md
elif _in_repo_md.exists():
    SRC_MD = _in_repo_md
else:
    sys.exit("SRC_MD not found: tried ../kosta-rica and ./kosta-rica")
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
#
# Единственный источник правды по маршруту — trip.json (генерируется
# tools/gen_trip.py). Здесь он только читается: раньше рядом жили ещё два
# ручных списка (STEPS и CALENDAR_EVENTS) с теми же рейсами, и они разошлись.

TRIP = json.loads((ROOT / "trip.json").read_text(encoding="utf-8"))
SEGMENTS: list[dict] = TRIP["segments"]


def _page_groups() -> list[dict]:
    """Сегменты → страницы этапов. Микро-сегменты (переезд во Внуково,
    стыковка в SJO, перелёт на Либерию) своей страницы не получают: они
    показываются внутри страницы того этапа, частью которого являются."""
    order: list[str] = []
    by_page: dict[str, list[dict]] = {}
    for seg in SEGMENTS:
        pid = seg.get("page", seg["id"])
        if pid not in by_page:
            by_page[pid] = []
            order.append(pid)
        by_page[pid].append(seg)

    groups = []
    for num, pid in enumerate(order):
        segs = by_page[pid]
        groups.append({
            "id": pid,
            "num": num,
            "segments": segs,
            "lead": segs[0],
            # Заголовок ведущего сегмента описывает только его: страница
            # arrival-cr это не «Панама → Сан-Хосе», а весь прилёт в страну.
            "title": segs[0].get("pageTitle", segs[0]["title"]),
            "summary": segs[0].get("pageSummary", segs[0].get("summary", "")),
            "startAt": segs[0]["startAt"],
            "endAt": segs[-1]["endAt"],
        })
    return groups


STEP_PAGES: list[dict] = _page_groups()

MONTHS_GEN = ("января", "февраля", "марта", "апреля", "мая", "июня", "июля",
              "августа", "сентября", "октября", "ноября", "декабря")


def _dt(iso: str) -> "datetime.datetime":
    import datetime as _d
    return _d.datetime.fromisoformat(iso)


def date_label(group: dict) -> str:
    """«30 октября», «1–6 ноября», «до 30 октября» — для шапки и оглавления."""
    a, b = _dt(group["startAt"]), _dt(group["endAt"])
    if group["lead"]["kind"] == "preparation":
        return f"до {b.day} {MONTHS_GEN[b.month - 1]}"
    if (a.year, a.month, a.day) == (b.year, b.month, b.day):
        return f"{a.day} {MONTHS_GEN[a.month - 1]}"
    if a.month == b.month:
        return f"{a.day}–{b.day} {MONTHS_GEN[a.month - 1]}"
    return f"{a.day} {MONTHS_GEN[a.month - 1]} – {b.day} {MONTHS_GEN[b.month - 1]}"


def page_place(group: dict) -> str:
    lead = group["lead"]
    if lead.get("place"):
        return lead["place"]
    frm, to = lead.get("from", {}), group["segments"][-1].get("to", {})
    a = frm.get("code") or frm.get("name") or ""
    b = to.get("code") or to.get("name") or ""
    return f"{a} → {b}".strip(" →") or "—"


def tz_offset(tz: str) -> int:
    return {"Europe/Kirov": 3, "Europe/Moscow": 3, "Europe/Istanbul": 3,
            "America/Panama": -5, "America/Costa_Rica": -6}[tz]


def dual_time(iso: str, tz: str) -> str:
    """Местное время + кировское, когда они расходятся. При разнице в 9 часов
    «вылет в 13:50» без второй цифры читается неверно."""
    import datetime as _d
    dt = _dt(iso)
    local = dt.astimezone(_d.timezone(_d.timedelta(hours=tz_offset(tz))))
    home = dt.astimezone(_d.timezone(_d.timedelta(hours=3)))
    out = local.strftime("%H:%M")
    if local.utcoffset() != home.utcoffset():
        out += f' <span class="t-home">({home.strftime("%H:%M")} Киров)</span>'
    return out


# --- блоки страницы этапа ----------------------------------------------------

ALERT_META = {
    "critical": ("alert-critical", "Критично"),
    "warning": ("alert-warning", "Внимание"),
    "info": ("alert-info", "Имей в виду"),
}


def render_alerts(segs: list[dict]) -> str:
    rows = []
    for seg in segs:
        for a in seg.get("alerts", []):
            cls, label = ALERT_META.get(a.get("level", "info"), ALERT_META["info"])
            rows.append(
                f'<div class="alert {cls}"><strong>{label}.</strong> '
                f'{html.escape(a["text"])}</div>'
            )
    return "\n".join(rows)


def render_do_now(group: dict) -> str:
    """«Что сделать» — чекбоксы с устойчивыми id, состояние переживает пересборку."""
    items = []
    for seg in group["segments"]:
        for act in seg.get("doNow", []):
            when = f'<span class="act-at">{html.escape(act["at"])}</span>' if act.get("at") else ""
            cls = " critical" if act.get("critical") else ""
            items.append(
                f'<li class="act{cls}">{when}'
                f'<span class="act-text">{html.escape(act["text"])}</span></li>'
            )
    if not items:
        return ""
    body = f'<ul class="acts">{"".join(items)}</ul>'
    return (
        '<section class="step-block" id="do-now">'
        "<h2>✅ Что сделать на этом этапе</h2>"
        + wrap_editable_cfg(body, {"key": f'step-{group["id"]}-do', "label": "сделано"})
        + "</section>"
    )


def render_need(group: dict) -> str:
    rows = []
    for seg in group["segments"]:
        for n in seg.get("need", []):
            rows.append(
                f'<div class="need-row"><dt>{html.escape(n["label"])}</dt>'
                f'<dd>{html.escape(n["value"])}</dd></div>'
            )
    if not rows:
        return ""
    return (
        '<section class="step-block" id="need">'
        "<h2>📌 Что может понадобиться</h2>"
        f'<dl class="need-list">{"".join(rows)}</dl>'
        "</section>"
    )


def render_prepare_next(group: dict, next_group: dict | None) -> str:
    seg_title = {s["id"]: s["title"] for s in SEGMENTS}
    items = []
    for seg in group["segments"]:
        for p in seg.get("prepareNext", []):
            target = seg_title.get(p.get("for", ""), "")
            tag = f'<span class="pn-for">к этапу «{html.escape(target)}»</span>' if target else ""
            cls = " critical" if p.get("critical") else ""
            items.append(
                f'<li class="act{cls}"><span class="act-text">{html.escape(p["text"])}</span>{tag}</li>'
            )
    if not items:
        return ""
    hint = ""
    if next_group:
        hint = (
            f'<p class="step-block-hint">Дальше: '
            f'<a href="step-{next_group["id"]}.html">{next_group["lead"]["icon"]} '
            f'{html.escape(next_group["title"])}</a>, '
            f'{html.escape(date_label(next_group))}.</p>'
        )
    body = f'<ul class="acts">{"".join(items)}</ul>'
    return (
        '<section class="step-block" id="prepare-next">'
        "<h2>🔜 Подготовить к следующему этапу</h2>" + hint
        + wrap_editable_cfg(body, {"key": f'step-{group["id"]}-next', "label": "готово"})
        + "</section>"
    )


def render_timeline(group: dict) -> str:
    """Таймлайн нужен там, где этап склеен из нескольких сегментов."""
    segs = group["segments"]
    if len(segs) < 2:
        return ""
    rows = []
    for seg in segs:
        route = ""
        if seg.get("from") and seg.get("to"):
            a = seg["from"].get("code") or seg["from"].get("name", "")
            b = seg["to"].get("code") or seg["to"].get("name", "")
            route = f'<span class="tl-route">{html.escape(a)} → {html.escape(b)}</span>'
        num = f'<span class="tl-num">{html.escape(seg["number"])}</span>' if seg.get("number") else ""
        rows.append(
            '<li class="tl-row">'
            f'<span class="tl-time">{dual_time(seg["startAt"], seg["startTz"])}</span>'
            f'<span class="tl-main"><span class="tl-title">{seg["icon"]} '
            f'{html.escape(seg["title"])}</span>{route}{num}</span>'
            "</li>"
        )
    return (
        '<section class="step-block" id="timeline">'
        "<h2>🕐 Как проходит этап</h2>"
        f'<ol class="timeline">{"".join(rows)}</ol>'
        "</section>"
    )


def render_plan_b(group: dict) -> str:
    rows = [s["planB"] for s in group["segments"] if s.get("planB")]
    if not rows:
        return ""
    body = "".join(f"<li>{html.escape(t)}</li>" for t in rows)
    return (
        '<section class="step-block" id="plan-b">'
        "<h2>🛟 Если что-то пошло не так</h2>"
        f"<ul class=\"plan-b-list\">{body}</ul>"
        "</section>"
    )


def render_prep_tasks() -> str:
    """Задачи подготовки с дедлайнами: без дат «оформить страховку» висит вечно."""
    import datetime as _d
    rows = []
    for t in TRIP.get("prepTasks", []):
        due = _d.date.fromisoformat(t["due"])
        cls = " critical" if t.get("critical") else ""
        why = f'<span class="task-why">{html.escape(t["why"])}</span>' if t.get("why") else ""
        rows.append(
            f'<li class="task{cls}">'
            f'<span class="task-due">до {due.day} {MONTHS_GEN[due.month - 1]}</span>'
            f'<span class="task-main"><span class="task-title">{html.escape(t["title"])}</span>'
            f'<span class="task-note">{html.escape(t["note"])}</span>{why}</span>'
            "</li>"
        )
    if not rows:
        return ""
    body = f'<ul class="tasks">{"".join(rows)}</ul>'
    return (
        '<section class="step-block" id="do-now">'
        "<h2>✅ Что сделать до отъезда</h2>"
        '<p class="step-block-hint">По дедлайнам, а не списком: часть пунктов '
        "нельзя закрыть за день до вылета.</p>"
        + wrap_editable_cfg(body, {"key": "prep-tasks", "label": "сделано"})
        + "</section>"
    )


def render_cash_plan() -> str:
    """Сколько наличных брать. Билеты и гостиницы оплачивает компания —
    здесь только то, что Alex платит сам."""
    plan = TRIP.get("cashPlan")
    if not plan:
        return ""
    rows = "".join(
        f'<tr><td>{html.escape(i["label"])}</td>'
        f'<td class="num">${html.escape(i["amount"])}</td>'
        f'<td class="cash-note">{html.escape(i.get("note", ""))}</td></tr>'
        for i in plan["items"]
    )
    return (
        '<section class="step-block" id="cash">'
        "<h2>💵 Сколько наличных брать</h2>"
        f'<p class="step-block-hint">{html.escape(plan["note"])}</p>'
        '<div class="table-wrap"><table class="cash-table">'
        "<thead><tr><th>На что</th><th>Сколько</th><th>Пояснение</th></tr></thead>"
        f"<tbody>{rows}</tbody>"
        f'<tfoot><tr><th>Итого</th><th class="num">${html.escape(plan["total"])}</th>'
        "<th></th></tr></tfoot>"
        "</table></div>"
        f'<div class="alert alert-info"><strong>Допущение.</strong> '
        f'{html.escape(plan["assumption"])}</div>'
        "</section>"
    )


# Контент шага: (md-файл, "## заголовок" | "### заголовок" | "*" = весь файл)
# или ("@meal", маркеры) — строки таблицы «Питание по маршруту» по шагам.
STEP_INCLUDES: dict[str, list] = {
    # Что остаётся в «Подробностях»: справка, к которой возвращаются, а не
    # действия — действия теперь в trip.json и печатаются выше по странице.
    # Общие своды правил живут на своих страницах (pravila.html, lifehacks.html,
    # eda.html) и дублировать их в каждый этап смысла нет.
    "prep": [
        ("plan-poezdki.md", "## 📋 Общая информация"),
        ("plan-poezdki.md", "## 🎫 Все билеты — сводная таблица"),
        ("plan-poezdki.md", "## 🕐 Часовые пояса"),
        ("plan-poezdki.md", "## 🛂 Документы на каждом участке"),
        ("plan-poezdki.md", "## ⚠️ Что нужно доделать"),
        ("pravila-zakony.md", "## Въезд и пребывание"),
        ("pravila-zakony.md", "## Лекарства и здоровье"),
        ("pravila-zakony.md", "## Экстренные контакты"),
        ("lifehacks.md", "## 💰 Деньги и платежи"),
        ("lifehacks.md", "## 📱 Связь и интернет"),
        ("packing-list.md", "*"),
        ("dela.html", "*"),
    ],
    "train-msk": [
        ("plan-poezdki.md", "### 30 октября 2026, Пятница — Поезд Киров → Москва"),
        ("eda.md", "## 🚆 Еда в поезд — что купить с собой"),
        ("@meal", ["Поезд Киров", "Москва, Восточный"]),
    ],
    "ist-flight": [
        ("plan-poezdki.md", "### 31 октября 2026, Суббота — Москва → Стамбул → Панама"),
        ("lifehacks.md", "### 31.10 — Ночной перелёт Москва → Панама со стыковкой в Стамбуле"),
        ("@meal", ["TK 422"]),
    ],
    "ist-layover": [
        ("plan-poezdki.md", "### 📖 Инструкция A — Стыковка в аэропорту (IST, SJO)"),
        ("pravila-zakony.md", "### Турция (транзит в Стамбуле IST)"),
        ("@meal", ["Стамбул, пересадка 6 ч 55"]),
    ],
    "ist-panama": [
        ("plan-poezdki.md", "### 📖 Инструкция C — Когда билеты разные (самое важное)"),
        ("plan-poezdki.md", "### 📖 Инструкция D — Пограничный контроль"),
        ("@meal", ["TK 903"]),
    ],
    "panama-night": [
        ("plan-poezdki.md", "### 1-я: 31.10 (20:05) → 01.11 (13:28) — только ночь"),
        ("pravila-zakony.md", "### Панама"),
        ("pravila-zakony.md", "### 31.10–01.11 — Пограничный контроль в Панаме (1-я остановка)"),
        ("@meal", ["Панама 20:05", "Завтрак в Панаме"]),
    ],
    "arrival-cr": [
        ("plan-poezdki.md", "### 1 ноября 2026, Воскресенье — Панама → Сан-Хосе → Либерия"),
        ("pravila-zakony.md", "### 01.11 — Прилёт в Сан-Хосе 13:51"),
        ("lifehacks.md", "### 01.11 — Прилёт в Сан-Хосе 13:51, вылет в Либерию 16:00"),
        ("chto-kupit.md", "## 📍 Разведка 01.11 — прилёт в SJO: снять цены, чтобы потом купить правильно"),
        ("@meal", ["CM 342", "SJO, окно 2 ч", "RZ 1076", "Трансфер LIR"]),
    ],
    "tamarindo": [
        ("plan-poezdki.md", "## 🏨 Тамариндо (01.11 – 06.11)"),
        ("lifehacks.md", "## 🏨 Occidental Tamarindo — максимум деталей"),
        ("lifehacks.md", "## 🏖️ Тамариндо — навигация"),
        ("lifehacks.md", "## 📅 Ноябрь (1–6) — конкретные рекомендации"),
        ("lifehacks.md", "## 🛡️ Безопасность в Тамариндо"),
        ("eda.md", "## 🌴 Коста-Рика — где поесть"),
        ("lifehacks.md", "## 🚐 Транспорт"),
        ("lifehacks.md", "## 🏖️ Пляжи и природа"),
        ("lifehacks.md", "## 🤫 Секретные места (менее туристические)"),
        ("pravila-zakony.md", "## Поведение и этикет"),
        ("pravila-zakony.md", "## Безопасность на водах"),
        ("pravila-zakony.md", "## Национальные парки и природа"),
        ("pravila-zakony.md", "## Частые ошибки туристов"),
        ("chto-kupit.md", "### Из Коста-Рики"),
        ("@meal", ["Occidental, All Inclusive"]),
    ],
    "sjo-window": [
        ("plan-poezdki.md", "### 6 ноября 2026, Пятница — Тамариндо → Либерия → Сан-Хосе"),
        ("plan-poezdki.md", "### 6 ноября 2026, Пятница — Сан-Хосе → Панама (запас по времени)"),
        ("chto-kupit.md", "### 🥉 SJO (Сан-Хосе, 06.11, 6 часов) — **основное окно покупок**"),
        ("chto-kupit.md", "### LIR (Либерия, 06.11, 06:00–07:30) — почти нет времени"),
        ("lifehacks.md", "### 06.11 — Ранний вылет из LIR в 07:30"),
        ("@meal", ["Завтрак в отеле", "RZ 1073", "SJO, пересадка 6 ч 26", "CM 343"]),
    ],
    "panama-days": [
        ("plan-poezdki.md", "### 2-я: 06.11 (17:12) → 07.11 (22:00) — **полные сутки!**"),
        ("lifehacks.md", "### 06–07.11 — Полные сутки в Панаме (а не одна ночь!)"),
        ("eda.md", "## 🌆 Панама — где поесть (06–07.11)"),
        ("chto-kupit.md", "## 🇵🇦 Панама — где и что покупать"),
        ("pravila-zakony.md", "### 06–07.11 — Пограничный контроль в Панаме (2-я остановка, сутки!)"),
        ("@meal", ["Панама, сутки"]),
    ],
    "home": [
        ("plan-poezdki.md", "### 7 ноября 2026, Суббота — Панама → Стамбул"),
        ("plan-poezdki.md", "### 9 ноября 2026, Понедельник — Поезд Москва → Киров"),
        ("lifehacks.md", "### 09.11 — Прибытие в Москву 05:20, поезд в 13:20"),
        ("chto-kupit.md", "### 🥇 PTY (Панама, 07.11) — лучшее место для алкоголя"),
        ("chto-kupit.md", "### 🥈 IST (Стамбул, 08.11, пересадка 6 ч 35 мин) — **только ручная кладь**"),
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
    """steps.html (оглавление) + step-*.html.

    Структура страницы этапа отвечает на три вопроса в том порядке, в каком
    они возникают в дороге: что сделать здесь → что держать под рукой → что
    подготовить к следующему. Справочные разделы из markdown уезжают под
    «Подробности»: раньше они шли сплошняком и давали 54 экрана на мобиле.
    """
    import json as _json

    texts: dict[str, str] = {}
    for md_name in {inc[0] for steps in STEP_INCLUDES.values() for inc in steps} - {"@meal"}:
        src = SRC_MD / md_name if md_name.endswith(".md") else SRC_HTML / md_name
        if not src.exists():
            raise FileNotFoundError(md_name)
        texts[md_name] = src.read_text(encoding="utf-8")

    # Сид для steps.js: тот же trip.json, только поля, нужные на клиенте.
    seed = _json.dumps(
        [
            {
                "id": g["id"],
                "num": g["num"],
                "icon": g["lead"]["icon"],
                "title": g["title"],
                "startAt": g["startAt"],
                "endAt": g["endAt"],
                "dateLabel": date_label(g),
                "place": page_place(g),
                "summary": g["summary"],
            }
            for g in STEP_PAGES
        ],
        ensure_ascii=False,
    )

    # --- оглавление steps.html ---
    cards = []
    for g in STEP_PAGES:
        lead = g["lead"]
        n_do = sum(len(s.get("doNow", [])) for s in g["segments"]) or len(TRIP.get("prepTasks", []))
        cards.append(
            f'<a class="step-card" href="step-{g["id"]}.html" data-step-card="{g["id"]}">'
            f'<span class="step-badge" hidden>Сейчас здесь</span>'
            f'<span class="step-num">{g["num"]}</span>'
            f'<span class="step-ic">{lead["icon"]}</span>'
            f'<span class="step-main"><span class="step-title">{html.escape(g["title"])}</span>'
            f'<span class="step-summary">{html.escape(g["summary"])}</span>'
            f'<span class="step-count">{n_do} действий</span></span>'
            f'<span class="step-when">{html.escape(date_label(g))}</span>'
            "</a>"
        )
    index_body = (
        '<section class="hero step-hero"><div class="hero-body">'
        "<h1>Маршрут по шагам</h1>"
        "<p>Одиннадцать этапов. На каждом — что сделать, что держать под рукой "
        "и что подготовить к следующему.</p>"
        '<div class="hero-tags"><span>30.10 – 10.11.2026</span>'
        "<span>Текущий этап подсвечивается автоматически</span></div>"
        "</div></section>\n"
        '<div class="step-now" data-step-now hidden></div>\n'
        '<div class="steps-index" data-steps-index>\n' + "\n".join(cards) + "\n</div>"
    )
    (ROOT / "steps.html").write_text(render("Маршрут по шагам", index_body), encoding="utf-8")

    # --- страницы этапов ---
    for idx, g in enumerate(STEP_PAGES):
        page = f"step-{g['id']}.html"
        lead = g["lead"]

        details: list[str] = []
        md_parts: list[str] = []
        for inc in STEP_INCLUDES[g["id"]]:
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
            # На странице этапа h1 только один — в шапке. Заголовок целиком
            # включённого файла снимаем, иначе на step-prep их два.
            frag = re.sub(r"<h1[^>]*>.*?</h1>\s*", "", frag, flags=re.S)
            if inc[0] == "packing-list.md":
                frag = wrap_editable(frag, "sbory.html")
            elif inc[0] == "dela.html":
                frag = wrap_editable_cfg(frag, {"key": "dela", "label": "сделано"})
            details.append(details_block(inc, frag))

        prev_g = STEP_PAGES[idx - 1] if idx > 0 else None
        next_g = STEP_PAGES[idx + 1] if idx < len(STEP_PAGES) - 1 else None

        nav_parts = []
        if prev_g:
            nav_parts.append(
                f'<a class="step-prev" href="step-{prev_g["id"]}.html">← '
                f'<span>{prev_g["lead"]["icon"]} {html.escape(prev_g["title"])}</span></a>'
            )
        nav_parts.append('<a class="step-all" href="steps.html">📋 Все этапы</a>')
        if next_g:
            nav_parts.append(
                f'<a class="step-next" href="step-{next_g["id"]}.html">'
                f'<span>{next_g["lead"]["icon"]} {html.escape(next_g["title"])}</span> →</a>'
            )

        if g["id"] == "prep":
            action_blocks = render_prep_tasks() + render_cash_plan()
        else:
            action_blocks = render_do_now(g)

        body = (
            '<section class="hero step-hero"><div class="hero-body">'
            f'<div class="step-kicker">Шаг {g["num"]} из {len(STEP_PAGES) - 1}</div>'
            f'<h1>{lead["icon"]} {html.escape(g["title"])}</h1>'
            f'<p>{html.escape(g["summary"])}</p>'
            f'<div class="hero-tags"><span>📅 {html.escape(date_label(g))}</span>'
            f'<span>📍 {html.escape(page_place(g))}</span></div>'
            "</div></section>\n"
            f'<div class="step-now" data-step-now data-step-id="{g["id"]}" hidden></div>\n'
            + render_alerts(g["segments"])
            + render_timeline(g)
            + action_blocks
            + render_need(g)
            + render_prepare_next(g, next_g)
            + render_plan_b(g)
            + (
                '<section class="step-block" id="details">'
                "<h2>📖 Подробности</h2>"
                '<p class="step-block-hint">Справочное — открывается по нажатию, '
                "чтобы не мешать на ходу.</p>" + "\n".join(details) + "</section>"
                if details else ""
            )
            + '<nav class="step-nav">' + "".join(nav_parts) + "</nav>"
        )

        toc = md_toc("\n\n".join(md_parts), page)
        (ROOT / page).write_text(render(f'Шаг {g["num"]}: {g["title"]}', body, toc), encoding="utf-8")

        html_text = (ROOT / page).read_text(encoding="utf-8")
        html_text = html_text.replace(
            '<script id="steps-seed" type="application/json"></script>',
            f'<script id="steps-seed" type="application/json">{seed}</script>',
        )
        (ROOT / page).write_text(html_text, encoding="utf-8")
        n_do = sum(len(s.get("doNow", [])) for s in g["segments"])
        print(f"  {page:26} шаг {g['num']} · {n_do} действий · {len(details)} справочных блоков")

    for name in ("index.html", "steps.html"):
        p = ROOT / name
        if not p.exists():
            continue
        t = p.read_text(encoding="utf-8")
        t = t.replace(
            '<script id="steps-seed" type="application/json"></script>',
            f'<script id="steps-seed" type="application/json">{seed}</script>',
        )
        p.write_text(t, encoding="utf-8")
    print(f"  steps:            {len(STEP_PAGES)} страниц из {len(SEGMENTS)} сегментов")


def details_block(inc: tuple, frag: str) -> str:
    """Справочный раздел в <details>. Заголовок берём из самого раздела —
    ручная карта названий рассинхронизировалась бы с markdown на первом же
    переименовании."""
    if inc[0] == "@meal":
        title = "Питание на этом этапе"
    elif inc[1] == "*":
        title = DETAILS_TITLES.get(inc[0], inc[0])
    else:
        title = inc[1].lstrip("# ").strip()
    source = LINK_TEXT.get(inc[0], "")
    tag = f'<span class="det-src">{html.escape(source)}</span>' if source else ""
    return (
        f"<details class=\"det\"><summary>{html.escape(title)}{tag}</summary>"
        f'<div class="det-body">{frag}</div></details>'
    )


DETAILS_TITLES = {
    "packing-list.md": "Полный чек-лист сборов",
    "dela.html": "Дела до отъезда",
}


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
ICS_BAR = (
    '\n<div class="ics-bar">\n'
    '  <a class="btn-ics" href="calendar.ics" download="kosta-rica-2026.ics">'
    "📅 Скачать календарь — весь маршрут</a>\n"
    '  <span class="ics-hint">рейсы, поезда, отели и дедлайны подготовки · .ics для Apple/Google/Outlook</span>\n'
    "</div>\n"
)


def calendar_events() -> list[tuple[str, str, str, str, str]]:
    """События календаря — из trip.json.

    Раньше это был отдельный ручной список тех же рейсов рядом со STEPS.
    Два списка одного расписания неизбежно расходятся: в прошлой версии
    у одного был «Внуково (SVO)», у другого — сдвиг на пять часов.
    """
    import datetime as _d

    def utc(iso: str) -> str:
        return _d.datetime.fromisoformat(iso).astimezone(_d.timezone.utc).strftime(
            "%Y%m%dT%H%M%SZ"
        )

    def place(seg: dict) -> str:
        if seg.get("place"):
            return seg["place"]
        frm, to = seg.get("from", {}), seg.get("to", {})
        a = frm.get("name", "") + (f' ({frm["code"]})' if frm.get("code") else "")
        b = to.get("name", "") + (f' ({to["code"]})' if to.get("code") else "")
        return f"{a} → {b}".strip(" →")

    events = []
    for seg in SEGMENTS:
        if seg["kind"] == "preparation":
            continue
        title = seg["icon"] + " "
        title += f'{seg["number"]} ' if seg.get("number") else ""
        title += seg["title"]

        parts = [
            f'{dual_plain(seg["startAt"], seg["startTz"])} → '
            f'{dual_plain(seg["endAt"], seg["endTz"])}'
        ]
        for a in seg.get("alerts", []):
            parts.append(("⚠️ " if a["level"] != "info" else "") + a["text"])
        parts += [x["text"] for x in seg.get("doNow", []) if x.get("critical")]
        parts += [x["text"] for x in seg.get("prepareNext", []) if x.get("critical")]
        events.append((utc(seg["startAt"]), utc(seg["endAt"]), title,
                       " · ".join(parts), place(seg)))

    # Задачи подготовки — всё-дневными событиями на дату дедлайна.
    for t in TRIP.get("prepTasks", []):
        due = t["due"].replace("-", "")
        nxt = (_d.date.fromisoformat(t["due"]) + _d.timedelta(days=1)).strftime("%Y%m%d")
        mark = "❗ " if t.get("critical") else ""
        events.append((due, nxt, mark + t["title"], t["note"], "Киров"))

    return events


def dual_plain(iso: str, tz: str) -> str:
    """«31.10 13:50 (13:50 Киров)» без разметки — для .ics и текста."""
    import datetime as _d
    dt = _d.datetime.fromisoformat(iso)
    local = dt.astimezone(_d.timezone(_d.timedelta(hours=tz_offset(tz))))
    home = dt.astimezone(_d.timezone(_d.timedelta(hours=3)))
    out = local.strftime("%d.%m %H:%M")
    if local.utcoffset() != home.utcoffset():
        out += f' ({home.strftime("%H:%M")} Киров)'
    return out


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
    events = calendar_events()
    for n, (start, end, summary, desc, loc) in enumerate(events, 1):
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
    print(f"  calendar.ics     {len(events)} событий (из trip.json)")


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
    validate_trip_json()
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
    print("done")


def validate_trip_json() -> None:
    """Проверка trip.json на сборке.

    Главное здесь — непрерывность. Прошлая версия допускала разрывы до 24 часов,
    и в дереве их накопилось шесть: суммарно ~34 часа поездки, когда дашборд
    показывал «не удалось определить этап». Допуск теперь нулевой.
    """
    import datetime as _d

    segments = TRIP.get("segments", [])
    if not segments:
        sys.exit("trip.json: нет segments")

    valid_kinds = {"preparation", "train", "flight", "stay", "transfer", "layover"}
    problems: list[str] = []

    ids = [s.get("id") for s in segments]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        problems.append(f"повторяющиеся id: {', '.join(sorted(dupes))}")

    for seg in segments:
        sid = seg.get("id", "?")
        for field in ("id", "num", "kind", "title", "icon", "startAt", "endAt",
                      "startTz", "endTz", "page"):
            if field not in seg:
                problems.append(f"{sid}: нет поля '{field}'")
        if seg.get("kind") not in valid_kinds:
            problems.append(f'{sid}: неизвестный kind {seg.get("kind")!r}')
        try:
            if _d.datetime.fromisoformat(seg["endAt"]) <= _d.datetime.fromisoformat(seg["startAt"]):
                problems.append(f"{sid}: endAt не позже startAt")
        except Exception as exc:
            problems.append(f"{sid}: даты не парсятся ({exc})")
        for key in ("startAt", "endAt"):
            if key in seg and not re.search(r"[+-]\d\d:\d\d$", seg[key]):
                problems.append(f"{sid}.{key}: нет явного UTC-offset")

    for a, b in zip(segments, segments[1:]):
        try:
            gap = _d.datetime.fromisoformat(b["startAt"]) - _d.datetime.fromisoformat(a["endAt"])
        except Exception:
            continue
        if gap.total_seconds():
            kind = "разрыв" if gap.total_seconds() > 0 else "нахлёст"
            problems.append(f'{kind} {gap} между {a["id"]} и {b["id"]}')

    # Каждая страница этапа должна существовать, иначе ссылка в оглавлении битая.
    for g in STEP_PAGES:
        if not (ROOT / f'step-{g["id"]}.html').exists():
            problems.append(f'нет страницы step-{g["id"]}.html для группы сегментов')

    # prepareNext ссылается на id сегмента — опечатка молча теряет подпись.
    known = set(ids)
    for seg in segments:
        for p in seg.get("prepareNext", []):
            if p.get("for") and p["for"] not in known:
                problems.append(f'{seg["id"]}: prepareNext → неизвестный сегмент {p["for"]!r}')

    trip_start = _d.datetime.fromisoformat(TRIP["trip"]["startAt"])
    for t in TRIP.get("prepTasks", []):
        due = _d.datetime.strptime(t["due"], "%Y-%m-%d").replace(
            tzinfo=_d.timezone(_d.timedelta(hours=3))
        )
        if due > trip_start:
            problems.append(f'подготовка {t["id"]}: дедлайн {t["due"]} позже отъезда')

    if problems:
        sys.exit("trip.json невалиден:\n  - " + "\n  - ".join(problems))

    print(f"  trip.json:        {len(segments)} сегментов, "
          f"{len(STEP_PAGES)} страниц, непрерывность ок")


if __name__ == "__main__":
    main()
