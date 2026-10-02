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
    return body


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

self.addEventListener("fetch", function (e) {{
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // чужие домены (погода, статусы рейсов) — всегда напрямую в сеть
  if (url.origin !== self.location.origin) return;

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
        toc = md_toc(text, out)
        (ROOT / out).write_text(render(title, body, toc), encoding="utf-8")
        print(f"  {out:16} ← {md_name}")

    for src_name, (out, title) in PAGES_HTML.items():
        src = SRC_HTML / src_name
        if not src.exists():
            print(f"  skip {src_name} (нет файла)")
            continue
        body = src.read_text(encoding="utf-8")
        (ROOT / out).write_text(render(title, body), encoding="utf-8")
        print(f"  {out:16} ← src/{src_name}")

    write_sw()
    print("done")


if __name__ == "__main__":
    main()
