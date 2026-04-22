#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


ARCHIVE_HOSTS = {
    "www.echecs92.fr",
    "assets.jimstatic.com",
    "u.jimcdn.com",
    "image.jimcdn.com",
    "api.dmp.jimdo-server.com",
    "fonts.jimstatic.com",
}

WAYBACK_MARKERS = (
    "BEGIN WAYBACK TOOLBAR INSERT",
    "wm-ipp-base",
    "archive.org/includes/donate",
    "web-static.archive.org",
)
WAYBACK_RE = re.compile(r"(?:https?:)?//web\.archive\.org/web/|/web/\d{6,}", re.IGNORECASE)
BINARY_EXTS = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".zip",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".ico",
}

RESOURCE_ATTRS = {
    "href",
    "src",
    "poster",
    "data-src",
    "data-href",
    "content",
}


class LinkCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {name.lower(): value or "" for name, value in attrs}

        # These are only performance hints to the original CDN, not required
        # resources. postprocess removes them, but ignoring keeps the validator
        # focused on links that affect browsing/rendering.
        rel = attrs_dict.get("rel", "")
        if tag == "link" and ("dns-prefetch" in rel or "preconnect" in rel):
            return

        for name, value in attrs_dict.items():
            if name in RESOURCE_ATTRS:
                self.links.append((tag, name, value))
            elif name == "srcset":
                for part in value.split(","):
                    url = part.strip().split(" ", 1)[0]
                    if url:
                        self.links.append((tag, name, url))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate the static legacy archive.")
    parser.add_argument("archive_root", type=Path)
    parser.add_argument("--min-html-pages", type=int, default=40)
    return parser.parse_args()


def is_internal_absolute_url(value: str) -> bool:
    value = value.strip()
    if value.startswith("//"):
        value = "https:" + value
    parsed = urlparse(value)
    return parsed.netloc in ARCHIVE_HOSTS


def main() -> int:
    args = parse_args()
    root = args.archive_root.resolve()
    if not root.is_dir():
        print(f"Archive root not found: {root}", file=sys.stderr)
        return 1

    html_files = sorted(root.rglob("*.html"))
    all_files = [path for path in root.rglob("*") if path.is_file()]

    errors: list[str] = []
    warnings: list[str] = []

    if len(html_files) < args.min_html_pages:
        errors.append(f"Only {len(html_files)} HTML pages found; expected at least {args.min_html_pages}.")

    missing_file = root / "missing-wayback-urls.txt"
    if missing_file.is_file():
        missing = [line for line in missing_file.read_text(encoding="utf-8").splitlines() if line.strip()]
        if missing:
            errors.append(f"{len(missing)} internal Wayback/Jimdo URLs are still missing.")

    for html_path in html_files:
        text = html_path.read_text(encoding="utf-8", errors="ignore")
        rel = html_path.relative_to(root)
        for marker in WAYBACK_MARKERS:
            if marker in text:
                errors.append(f"{rel}: leftover Wayback marker: {marker}")
                break
        if WAYBACK_RE.search(text):
            errors.append(f"{rel}: leftover Wayback replay URL.")

        collector = LinkCollector()
        try:
            collector.feed(text)
        except Exception as exc:
            warnings.append(f"{rel}: HTML parser warning: {exc}")
            continue

        for _tag, attr, value in collector.links:
            if is_internal_absolute_url(value):
                errors.append(f"{rel}: unresolved {attr} URL: {value[:180]}")
                break

    for path in all_files:
        if path.suffix.lower() not in BINARY_EXTS:
            continue
        try:
            head = path.read_bytes()[:512].lstrip().lower()
        except OSError:
            continue
        if head.startswith(b"<!doctype html") or head.startswith(b"<html"):
            errors.append(f"{path.relative_to(root)}: binary/resource file still contains HTML.")

    print(
        f"Archive validation: {len(html_files)} HTML pages, {len(all_files)} files.",
        flush=True,
    )
    for warning in warnings[:20]:
        print(f"Warning: {warning}", file=sys.stderr)
    if len(warnings) > 20:
        print(f"Warning: {len(warnings) - 20} more warnings omitted.", file=sys.stderr)

    if errors:
        for error in errors[:50]:
            print(f"Error: {error}", file=sys.stderr)
        if len(errors) > 50:
            print(f"Error: {len(errors) - 50} more errors omitted.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
