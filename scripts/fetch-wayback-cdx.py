#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
import sys
import time
from http.client import RemoteDisconnected
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse, urlsplit, urlunsplit
from urllib.request import Request, urlopen


CDX_ENDPOINT = "https://web.archive.org/cdx"
SOURCE_HOST = "www.echecs92.fr"
SOURCE_PATTERN = f"{SOURCE_HOST}/*"
KEEP_MIMETYPES = {"text/html"}
SKIP_QUERY_PREFIXES = ("fbclid=", "utm_")
SKIP_PATH_PREFIXES = ("/app/common/captcha/",)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def usage() -> None:
    print("Usage: fetch-wayback-cdx.py <archive_root> [delay_seconds]", file=sys.stderr)


def normalize_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return path.replace(":", "%3A")


def build_target_path(root: Path, path: str, mimetype: str) -> Path:
    base = Path(normalize_path(path).lstrip("/"))
    if path == "/":
        return root / "index.html"
    if mimetype == "text/html" and (path.endswith("/") or not base.suffix):
        return root / base / "index.html"
    return root / base


def normalize_url(url: str) -> str:
    parts = urlsplit(url)
    path = quote(parts.path, safe="/:%")
    query = quote(parts.query, safe="=&")
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def fetch_cdx_rows(mimetype: str, retries: int = 3) -> list[list[str]]:
    query = urlencode(
        [
            ("url", SOURCE_PATTERN),
            ("output", "json"),
            ("fl", "timestamp,original,mimetype,statuscode"),
            ("filter", "statuscode:200"),
            ("filter", f"mimetype:{mimetype}"),
            ("collapse", "urlkey"),
            ("sort", "reverse"),
        ]
    )

    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            print(f"Querying CDX for {mimetype} (attempt {attempt}/{retries})...", flush=True)
            req = Request(f"{CDX_ENDPOINT}?{query}", headers={"User-Agent": UA})
            with urlopen(req, timeout=90) as resp:
                return json.load(resp)
        except (HTTPError, URLError, TimeoutError, RemoteDisconnected) as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(2 * attempt)
                continue
    if last_exc:
        print(f"Warning: CDX query failed for {mimetype}: {last_exc}", file=sys.stderr)
    return []


def cdx_query() -> list[dict[str, str]]:
    rows: list[list[str]] = []
    for mimetype in sorted(KEEP_MIMETYPES):
        mimetype_rows = fetch_cdx_rows(mimetype)
        if not mimetype_rows:
            continue
        if not rows:
            rows.extend(mimetype_rows)
        else:
            rows.extend(mimetype_rows[1:])

    if not rows:
        return []

    header = rows[0]
    records: list[dict[str, str]] = []
    for row in rows[1:]:
        record = {key: str(value) for key, value in zip(header, row)}
        if should_keep(record):
            records.append(record)
    return records


def should_keep(record: dict[str, str]) -> bool:
    mimetype = record.get("mimetype", "")
    if mimetype not in KEEP_MIMETYPES:
        return False

    parsed = urlparse(record.get("original", ""))
    if parsed.netloc != SOURCE_HOST:
        return False

    if parsed.query and parsed.query.startswith(SKIP_QUERY_PREFIXES):
        return False
    if any(parsed.path.startswith(prefix) for prefix in SKIP_PATH_PREFIXES):
        return False

    return True


def download(url: str, target: Path, delay: float, retries: int = 3) -> bool:
    normalized_url = normalize_url(url)
    if normalized_url.startswith("https://web.archive.org/"):
        normalized_url = "http://web.archive.org/" + normalized_url[len("https://web.archive.org/") :]

    for attempt in range(1, retries + 1):
        try:
            req = Request(normalized_url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
            with urlopen(req, timeout=90) as resp:
                if resp.status >= 400:
                    return False
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_name(target.name + ".tmp")
                with open(tmp, "wb") as f:
                    stream = resp
                    if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                        stream = gzip.GzipFile(fileobj=resp)
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
        except (URLError, ConnectionResetError, TimeoutError, RemoteDisconnected):
            if attempt < retries:
                time.sleep(delay + attempt)
                continue
            return False
    return False


def records_by_target(root: Path, records: Iterable[dict[str, str]]) -> list[tuple[dict[str, str], Path]]:
    seen_targets: set[Path] = set()
    selected: list[tuple[dict[str, str], Path]] = []

    for record in records:
        parsed = urlparse(record["original"])
        target = build_target_path(root, parsed.path or "/", record["mimetype"])
        if target in seen_targets:
            continue
        seen_targets.add(target)
        selected.append((record, target))
    return selected


def main() -> int:
    if len(sys.argv) < 2:
        usage()
        return 1

    root = Path(sys.argv[1]).resolve()
    delay = float(sys.argv[2]) if len(sys.argv) > 2 else 0.2
    root.mkdir(parents=True, exist_ok=True)

    records = records_by_target(root, cdx_query())
    if not records:
        print("No CDX records found.", file=sys.stderr)
        return 1

    ok = 0
    failed = 0
    total = len(records)
    for idx, (record, target) in enumerate(records, start=1):
        wayback_url = f"https://web.archive.org/web/{record['timestamp']}id_/{record['original']}"
        if download(wayback_url, target, delay):
            ok += 1
        else:
            failed += 1

        if idx == 1 or idx == total or idx % 10 == 0:
            print(f"[{idx}/{total}] CDX pages: {ok}, failed: {failed}", flush=True)

    print(f"CDX pages: {ok}, failed: {failed}", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
