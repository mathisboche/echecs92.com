#!/usr/bin/env python3
from __future__ import annotations

import gzip
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


WRAPPER_HEAD_RE = re.compile(br"<title>\s*Wayback Machine\s*</title>", re.IGNORECASE)
WMTB_URL_RE = re.compile(br'id="wmtbURL"[^>]*\svalue="([^"]+)"', re.IGNORECASE)
WMTB_DATE_RE = re.compile(br'name="date"\s+value="(\d{14})"', re.IGNORECASE)
DOCUMENT_LOCATION_RE = re.compile(br'document\.location\.href\s*=\s*"([^"]+)"', re.IGNORECASE)
WAYBACK_RE = re.compile(br"https?://web\.archive\.org/web/(\d+)(?:[a-z_]+)?/(https?://[^\"'\s<>]+)")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico"}
TEXT_EXTS = {".css", ".js"}
DOCUMENT_EXTS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip"}

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def usage() -> None:
    print("Usage: fix-wayback-wrappers.py <archive_root> [delay_seconds]", file=sys.stderr)


def is_wayback_wrapper(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(4096)
    except OSError:
        return False

    if WRAPPER_HEAD_RE.search(head):
        return True
    stripped = head.lstrip()
    return stripped.startswith(b"<!DOCTYPE html") or stripped.startswith(b"<html")


def extract_wayback_info(path: Path) -> tuple[str, str] | None:
    try:
        with open(path, "rb") as f:
            blob = f.read(256_000)
    except OSError:
        return None

    url_match = WMTB_URL_RE.search(blob)
    date_match = WMTB_DATE_RE.search(blob)
    original_url = ""
    timestamp = ""
    if url_match and date_match:
        original_url = url_match.group(1).decode("utf-8", errors="ignore").strip()
        timestamp = date_match.group(1).decode("ascii", errors="ignore").strip()

    if not original_url or not timestamp:
        location_match = DOCUMENT_LOCATION_RE.search(blob)
        if not location_match:
            return None
        wayback_match = WAYBACK_RE.match(location_match.group(1))
        if not wayback_match:
            return None
        timestamp = wayback_match.group(1).decode("ascii", errors="ignore").strip()
        original_url = wayback_match.group(2).decode("utf-8", errors="ignore").strip()
        if not original_url or not timestamp:
            return None
    return (timestamp, original_url)


def build_wayback_url(timestamp: str, mode: str, original_url: str) -> str:
    # Wayback flags are appended to the timestamp (e.g. 20250101im_).
    return f"http://web.archive.org/web/{timestamp}{mode}/{original_url}"


def download(url: str, target: Path, delay: float, retries: int = 3) -> bool:
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
            with urlopen(req, timeout=60) as resp:
                stream = resp
                if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                    stream = gzip.GzipFile(fileobj=resp)

                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_name(target.name + ".tmp")
                with open(tmp, "wb") as f:
                    while True:
                        chunk = stream.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
                tmp.replace(target)

            if delay:
                time.sleep(delay)
            return True
        except HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(delay + attempt)
                continue
            return False
        except URLError:
            if attempt < retries:
                time.sleep(delay + attempt)
                continue
            return False
        except (ConnectionResetError, TimeoutError):
            if attempt < retries:
                time.sleep(delay + attempt)
                continue
            return False
    return False


def looks_like_html(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(512)
    except OSError:
        return True
    stripped = head.lstrip()
    return WRAPPER_HEAD_RE.search(head) is not None or stripped.startswith(b"<!DOCTYPE html") or stripped.startswith(b"<html")


def fix_one(path: Path, delay: float) -> bool:
    info = extract_wayback_info(path)
    if not info:
        return False
    timestamp, original_url = info

    ext = path.suffix.lower()
    modes: list[str] = []
    if ext in IMAGE_EXTS:
        modes = ["im_", "id_"]
    elif ext in TEXT_EXTS:
        modes = ["id_"]
    elif ext in DOCUMENT_EXTS:
        modes = ["id_"]
    else:
        modes = ["id_"]

    for mode in modes:
        wayback_url = build_wayback_url(timestamp, mode, original_url)
        if not download(wayback_url, path, delay):
            continue
        if looks_like_html(path):
            continue
        return True

    return False


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1

    root = Path(sys.argv[1]).resolve()
    delay = float(sys.argv[2]) if len(sys.argv) > 2 else 0.2

    if not root.is_dir():
        print(f"Archive root not found: {root}", file=sys.stderr)
        return 1

    candidates: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in (IMAGE_EXTS | TEXT_EXTS | DOCUMENT_EXTS):
            continue
        if is_wayback_wrapper(path):
            candidates.append(path)

    fixed = 0
    failed = 0
    total = len(candidates)
    for idx, path in enumerate(sorted(candidates), start=1):
        ok = fix_one(path, delay)
        if ok:
            fixed += 1
        else:
            failed += 1
        if idx == 1 or idx == total or idx % 10 == 0:
            print(f"[{idx}/{total}] Fixed: {fixed}, failed: {failed}", flush=True)

    print(f"Fixed: {fixed}, failed: {failed}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
