#!/usr/bin/env python3
"""Собирает дерево для публикации и проверяет, что в нём нет секретов.

Зачем отдельный шаг. GitHub Pages публиковал корень репозитория, а в корне
лежат исходники: `kosta-rica/*.md` с номерами билетов, PNR и паспортными
данными, и `.tmp-secret/` — те же данные открытым текстом, из которых
шифруются `docs/*.bin`. То есть страница «под паролем» отдавалась рядом в
незашифрованном виде. Публикуем только то, что перечислено здесь.

Запуск:  python3 tools/make_site.py _site
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Всё, что реально нужно сайту. Любой новый артефакт сборки придётся добавить
# сюда осознанно — это и есть смысл белого списка.
COPY_DIRS = ["assets", "docs"]
COPY_FILES = ["manifest.json", "sw.js", "calendar.ics", "trip.json", ".nojekyll"]
HTML_EXCLUDE = {"template.html"}

SECRET_OPEN = "<!-- secret -->"
SECRET_CLOSE = "<!-- /secret -->"


def secret_tokens() -> set[str]:
    """Токены из <!-- secret --> блоков: номера билетов, PNR, паспорта.

    Берём из самих исходников, а не из списка в коде: список рассинхронизируется
    на первом же новом секрете, а исходники — нет.
    """
    tokens: set[str] = set()
    for md in sorted((ROOT / "kosta-rica").glob("*.md")):
        text = md.read_text(encoding="utf-8")
        for block in re.findall(
            re.escape(SECRET_OPEN) + "(.*?)" + re.escape(SECRET_CLOSE), text, re.S
        ):
            for tok in re.findall(r"[A-Z0-9]{6,}", block):
                if tok.isdigit() and len(tok) < 6:
                    continue
                tokens.add(tok)
            # Номера с пробелами («77 565 032 712 882») ищем и в слитном виде.
            for tok in re.findall(r"(?:\d[\d ]{6,}\d)", block):
                tokens.add(tok.replace(" ", ""))
    return {t for t in tokens if len(t) >= 6}


def build(dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    for name in sorted(p.name for p in ROOT.glob("*.html")):
        if name in HTML_EXCLUDE:
            continue
        shutil.copy2(ROOT / name, dest / name)
    for name in COPY_FILES:
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, dest / name)
    for name in COPY_DIRS:
        src = ROOT / name
        if src.exists():
            shutil.copytree(src, dest / name)


def audit(dest: Path) -> list[str]:
    """Ищет секреты в опубликованном дереве. .bin — шифротекст, их пропускаем."""
    tokens = secret_tokens()
    if not tokens:
        sys.exit("make_site: не нашёл ни одного секретного токена — проверь маркеры")
    hits: list[str] = []
    for path in sorted(dest.rglob("*")):
        if not path.is_file() or path.suffix in {".bin", ".pmtiles", ".png", ".jpg", ".webp"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        flat = text.replace(" ", "")
        for tok in tokens:
            if tok in text or tok in flat:
                hits.append(f"{path.relative_to(dest)}: {tok}")
    return hits


def main() -> None:
    dest = Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
    if not dest.is_absolute():
        dest = ROOT / dest
    build(dest)
    files = sum(1 for p in dest.rglob("*") if p.is_file())
    hits = audit(dest)
    if hits:
        print("make_site: СЕКРЕТЫ В ПУБЛИКУЕМОМ ДЕРЕВЕ", file=sys.stderr)
        for h in hits:
            print("  " + h, file=sys.stderr)
        sys.exit(1)
    print(f"make_site: {dest.name}/ — {files} файлов, секретов не найдено "
          f"({len(secret_tokens())} токенов проверено)")


if __name__ == "__main__":
    main()
