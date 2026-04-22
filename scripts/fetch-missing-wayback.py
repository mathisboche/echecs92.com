#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
import re
import sys
import time
from html import unescape
from http.client import RemoteDisconnected
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse, urlsplit, urlunsplit
from urllib.parse import urlencode
from urllib.request import Request, urlopen


WAYBACK_RE = re.compile(r"https?://web\.archive\.org/web/\d+(?:[a-z_]+)?/(.+)")

ALLOWED_HOSTS = {
    "www.echecs92.fr",
    "assets.jimstatic.com",
    "u.jimcdn.com",
    "image.jimcdn.com",
    "api.dmp.jimdo-server.com",
    "fonts.jimstatic.com",
    "www.billetweb.fr",
}

# If Wayback doesn't have a capture (or is flaky), these hosts are usually still
# downloadable directly and can make the archive more self-contained.
DIRECT_FALLBACK_HOSTS = {
    "assets.jimstatic.com",
    "u.jimcdn.com",
    "image.jimcdn.com",
}

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def usage() -> None:
    print("Usage: fetch-missing-wayback.py <archive_root> [missing_file] [delay_seconds]", file=sys.stderr)


def normalize_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return path.replace(":", "%3A")


def build_target_path(root: Path, host: str, path: str, query: str) -> Path:
    base = Path(normalize_path(path).lstrip("/"))

    if host != "www.echecs92.fr":
        base = Path(host) / base

    if query:
        suffix = "@" + query.replace("&", "%26")
        if base.suffix:
            return root / base.parent / (base.name + suffix + base.suffix)
        return root / base.parent / (base.name + suffix)

    if path.endswith("/") or not base.suffix:
        return root / base / "index.html"

    return root / base


def load_missing(path: Path) -> Iterable[str]:
    return [unescape(line.strip()) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def download(url: str, target: Path, delay: float, retries: int = 3) -> bool:
    normalized_url = normalize_url(url)
    # web.archive.org HTTPS is occasionally unavailable from some networks; HTTP works.
    if normalized_url.startswith("https://web.archive.org/"):
        normalized_url = "http://web.archive.org/" + normalized_url[len("https://web.archive.org/") :]
    for attempt in range(1, retries + 1):
        try:
            req = Request(
                normalized_url,
                headers={
                    "User-Agent": UA,
                    "Accept-Encoding": "gzip",
                },
            )
            with urlopen(req, timeout=30) as resp:
                if resp.status >= 400:
                    return False
                target.parent.mkdir(parents=True, exist_ok=True)
                with open(target, "wb") as f:
                    stream = resp
                    if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                        stream = gzip.GzipFile(fileobj=resp)
                    while True:
                        chunk = stream.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
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
        except (ConnectionResetError, TimeoutError, RemoteDisconnected):
            if attempt < retries:
                time.sleep(delay + attempt)
                continue
            return False
    return False


def normalize_url(url: str) -> str:
    parts = urlsplit(url)
    path = quote(parts.path, safe="/:%")
    query = quote(parts.query, safe="=&")
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def latest_wayback_capture(original_url: str) -> str | None:
    query = urlencode(
        [
            ("url", original_url),
            ("output", "json"),
            ("fl", "timestamp,original,statuscode"),
            ("filter", "statuscode:200"),
            ("sort", "reverse"),
            ("limit", "1"),
        ]
    )
    try:
        req = Request(f"https://web.archive.org/cdx?{query}", headers={"User-Agent": UA})
        with urlopen(req, timeout=60) as resp:
            rows = json.load(resp)
    except Exception:
        return None
    if len(rows) < 2:
        return None
    timestamp = str(rows[1][0])
    captured_url = str(rows[1][1])
    if not timestamp or not captured_url:
        return None
    return f"https://web.archive.org/web/{timestamp}id_/{captured_url}"


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1

    root = Path(sys.argv[1]).resolve()
    missing_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else root / "missing-wayback-urls.txt"
    delay = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5

    if not root.is_dir():
        print(f"Archive root not found: {root}", file=sys.stderr)
        return 1
    if not missing_path.is_file():
        print(f"Missing list not found: {missing_path}", file=sys.stderr)
        return 1

    missing = load_missing(missing_path)
    # Prioritize the stuff that matters for completeness/UX:
    # 1) downloads/documents, 2) HTML pages, 3) images, 4) other assets.
    def sort_key(url: str) -> tuple[int, str]:
        if "/app/download/" in url:
            return (0, url)
        if "https://www.echecs92.fr/" in url:
            return (1, url)
        if "image.jimcdn.com/" in url:
            return (2, url)
        if "assets.jimstatic.com/" in url or "u.jimcdn.com/" in url:
            return (3, url)
        return (4, url)

    missing = sorted(missing, key=sort_key)
    ok = 0
    skipped = 0
    failed = 0

    total = len(missing)
    for idx, line in enumerate(missing, start=1):
        match = WAYBACK_RE.match(line)
        if not match:
            skipped += 1
            continue

        original = unescape(match.group(1))
        parsed = urlparse(original)
        host = parsed.netloc
        if host not in ALLOWED_HOSTS:
            skipped += 1
            continue

        target = build_target_path(root, host, parsed.path or "/", parsed.query)
        if target.exists():
            skipped += 1
            continue

        downloaded = download(line, target, delay)
        if not downloaded:
            latest_capture = latest_wayback_capture(original)
            if latest_capture:
                downloaded = download(latest_capture, target, delay)
        if not downloaded:
            # For Jimdo file downloads, the live endpoint is often accessible even
            # when the site itself is behind bot protection.
            is_jimdo_download = host == "www.echecs92.fr" and "/app/download/" in (parsed.path or "")
            if is_jimdo_download or host in DIRECT_FALLBACK_HOSTS:
                downloaded = download(original, target, delay)

        if downloaded:
            ok += 1
        else:
            failed += 1

        if idx == 1 or idx == total or idx % 25 == 0:
            print(f"[{idx}/{total}] Downloaded: {ok}, skipped: {skipped}, failed: {failed}", flush=True)

    print(f"Downloaded: {ok}, skipped: {skipped}, failed: {failed}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
