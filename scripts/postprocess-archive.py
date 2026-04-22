#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path
import shutil
from urllib.parse import quote, unquote, urlparse


WAYBACK_BLOCK_RE = re.compile(
    r"<script[^>]+bundle-playback\.js[^>]*></script>.*?<!-- End Wayback Rewrite JS Include -->",
    re.IGNORECASE | re.DOTALL,
)
WAYBACK_TOOLBAR_RE = re.compile(
    r"<!-- BEGIN WAYBACK TOOLBAR INSERT -->.*?<!-- END WAYBACK TOOLBAR INSERT -->",
    re.IGNORECASE | re.DOTALL,
)

ADMIN_LINKS_RE = re.compile(
    r"<div[^>]+class=[\"'][^\"']*j-admin-links[^\"']*[\"'][^>]*>.*?</div>",
    re.IGNORECASE | re.DOTALL,
)

WAYBACK_URL_RE = re.compile(
    r"https?://web\.archive\.org/web/\d+(?:[a-z_]+)?/(https?://[^\"'\s<>]+)",
    re.IGNORECASE,
)
WAYBACK_MAILTO_RE = re.compile(
    r"https?://web\.archive\.org/web/\d+(?:[a-z_]+)?/(mailto:[^\"'\s<>]+)",
    re.IGNORECASE,
)
WAYBACK_TEL_RE = re.compile(
    r"https?://web\.archive\.org/web/\d+(?:[a-z_]+)?/(tel:[^\"'\s<>]+)",
    re.IGNORECASE,
)
ROOT_WAYBACK_URL_RE = re.compile(
    r"/web/\d+(?:[a-z_]+)?/(https?://[^\"'\s<>]+)",
    re.IGNORECASE,
)
ROOT_WAYBACK_SITE_PATH_RE = re.compile(
    r"/web/\d+(?:[a-z_]+)?//([^\"'\s<>]+)",
    re.IGNORECASE,
)

DIRECT_ASSET_URL_RE = re.compile(
    r"(?:https?:)?//(?:www\.echecs92\.fr|assets\.jimstatic\.com|u\.jimcdn\.com|image\.jimcdn\.com|api\.dmp\.jimdo-server\.com|fonts\.jimstatic\.com)(?:/[^\"'\s<>]*)?",
    re.IGNORECASE,
)
ARCHIVE_PREFETCH_RE = re.compile(
    r"<link\s+rel=[\"'][^\"']*(?:dns-prefetch|preconnect)[^\"']*[\"'][^>]+href=[\"'](?:https?:)?//(?:www\.echecs92\.fr|assets\.jimstatic\.com|u\.jimcdn\.com|image\.jimcdn\.com|api\.dmp\.jimdo-server\.com|fonts\.jimstatic\.com)[^\"']*[\"'][^>]*>\s*",
    re.IGNORECASE,
)

ROBOTS_META_RE = re.compile(
    r"<meta\s+name=[\"']robots[\"'][^>]*>",
    re.IGNORECASE,
)
GOOGLEBOT_META_RE = re.compile(
    r"<meta\s+name=[\"']googlebot[\"'][^>]*>",
    re.IGNORECASE,
)
CANONICAL_RE = re.compile(
    r"<link\s+rel=[\"']canonical[\"'][^>]*>",
    re.IGNORECASE,
)
OG_URL_RE = re.compile(
    r"<meta\s+property=[\"']og:url[\"'][^>]*>",
    re.IGNORECASE,
)

ARCHIVE_HOSTS = {
    # Original site + Jimdo assets used by the site.
    "www.echecs92.fr",
    "assets.jimstatic.com",
    "u.jimcdn.com",
    "image.jimcdn.com",
    "api.dmp.jimdo-server.com",
    "fonts.jimstatic.com",
}


def usage() -> None:
    print("Usage: postprocess-archive.py <archive_root> <archive_domain>", file=sys.stderr)


def promote_site_root(root: Path) -> Path:
    site_dir = root / "www.echecs92.fr"
    if not site_dir.is_dir():
        return root

    def merge_move(src: Path, dst: Path) -> None:
        # Move a directory tree into dst, overwriting files. This keeps the archive
        # flat (root-level site) while allowing repeated runs to refresh content.
        dst.mkdir(parents=True, exist_ok=True)
        for entry in src.iterdir():
            target = dst / entry.name
            if entry.is_dir():
                if target.exists() and not target.is_dir():
                    target.unlink()
                merge_move(entry, target)
                try:
                    entry.rmdir()
                except OSError:
                    pass
                continue

            if target.exists() and target.is_dir():
                shutil.rmtree(target)
            entry.replace(target)

    merge_move(site_dir, root)

    try:
        site_dir.rmdir()
    except OSError:
        pass

    return root


def canonical_url(domain: str, html_path: Path, root: Path) -> str:
    rel = html_path.relative_to(root).as_posix()
    if rel.endswith("index.html"):
        rel_dir = rel[: -len("index.html")].rstrip("/")
        if rel_dir:
            return f"https://{domain}/{rel_dir}/"
        return f"https://{domain}/"
    return f"https://{domain}/{rel}"


def inject_meta(html: str, domain: str, html_path: Path, root: Path) -> str:
    html = ROBOTS_META_RE.sub("", html)
    html = GOOGLEBOT_META_RE.sub("", html)
    html = CANONICAL_RE.sub("", html)
    html = OG_URL_RE.sub("", html)

    canonical = canonical_url(domain, html_path, root)
    injection = (
        '<meta name="robots" content="noindex, nofollow">\n'
        '<meta name="googlebot" content="noindex, nofollow">\n'
        f'<link rel="canonical" href="{canonical}">\n'
        f'<meta property="og:url" content="{canonical}">\n'
    )

    return re.sub(r"(<head[^>]*>)", r"\1\n" + injection, html, count=1, flags=re.IGNORECASE)


def normalize_path(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return path.replace(":", "%3A")


def normalize_path_variants(path: str) -> list[str]:
    # `wget --restrict-file-names=windows` is inconsistent depending on the page:
    # sometimes it keeps UTF-8 characters, sometimes it stores %-escaped segments.
    # Try multiple equivalents so we can resolve local files reliably.
    raw = normalize_path(path)
    decoded = normalize_path(unquote(path))
    encoded = normalize_path(quote(unquote(path), safe="/"))

    variants: list[str] = []
    for candidate in (raw, decoded, encoded):
        if candidate not in variants:
            variants.append(candidate)
    return variants


def jimcdn_image_fallback_paths(path: str) -> list[str]:
    # Some pages reference a 4096px transform, but Wayback doesn't always capture it.
    # Try a smaller (more common) transform if we have it locally.
    if "dimension=4096x4096:format=" in path:
        return [path.replace("dimension=4096x4096:format=", "dimension=2048x2048:format=", 1)]
    return []


def normalized_original_url(url: str) -> str:
    url = url.replace("&amp;", "&")
    # Social share widgets embed the original page URL in another URL and then
    # append a title with `&t=...`. That suffix is not part of the page URL.
    if "&t=" in url and "?" not in url.split("&t=", 1)[0]:
        url = url.split("&t=", 1)[0]
    if url.startswith("//"):
        return "https:" + url
    return url


def wayback_missing_url(original_url: str) -> str:
    return f"https://web.archive.org/web/0id_/{normalized_original_url(original_url)}"


def resolve_local_url(root: Path, host: str, path: str, query: str) -> str | None:
    if host == "www.echecs92.fr":
        base_prefix = Path()
    else:
        host_dir = root / host
        if not host_dir.is_dir():
            return None
        base_prefix = Path(host)

    candidates: list[Path] = []
    query_suffix = ""
    if query:
        query_suffix = "@" + query.replace("&", "%26")
        # Query suffix rules depend on what was downloaded. We'll apply the suffix
        # after generating each base variant.

    for path_variant in normalize_path_variants(path):
        base = base_prefix / path_variant.lstrip("/")
        candidates.append(base)

        if query_suffix:
            candidates.append(base.parent / (base.name + query_suffix))
            if base.suffix:
                candidates.append(base.parent / (base.name + query_suffix + base.suffix))

        if path_variant.endswith("/"):
            candidates.append(base / "index.html")
        elif not base.suffix:
            candidates.append(base / "index.html")

    for candidate in candidates:
        # `candidate` is already rooted at `root` via `base_prefix`.
        if (root / candidate).is_file():
            return "/" + candidate.as_posix()

    # Social share URLs sometimes append title/query parameters to an otherwise
    # normal page URL. The archived page exists without that query string.
    if host == "www.echecs92.fr" and query and not path.startswith("/app/download/"):
        return resolve_local_url(root, host, path, "")

    return None


def replace_wayback_urls(
    html: str,
    root: Path,
    missing_urls: set[str],
) -> str:
    def repl(match: re.Match) -> str:
        original = normalized_original_url(match.group(1))
        parsed = urlparse(original)
        host = parsed.netloc
        path = parsed.path or "/"
        local_url = resolve_local_url(root, host, path, parsed.query)
        if local_url:
            return local_url

        if host == "image.jimcdn.com":
            for alt_path in jimcdn_image_fallback_paths(path):
                alt_local = resolve_local_url(root, host, alt_path, parsed.query)
                if alt_local:
                    return alt_local

        # Only report as "missing" when it's something we intend to serve locally
        # (the Jimdo site itself, or its asset hosts).
        if host in ARCHIVE_HOSTS:
            missing_urls.add(normalized_original_url(match.group(0)))
            return match.group(0)

        # External links: unwrap the Wayback wrapper so navigation stays natural.
        return original

    html = WAYBACK_URL_RE.sub(repl, html)
    html = WAYBACK_MAILTO_RE.sub(lambda m: m.group(1), html)
    html = WAYBACK_TEL_RE.sub(lambda m: m.group(1), html)
    return html


def replace_root_wayback_urls(html: str, root: Path, missing_urls: set[str]) -> str:
    def repl_absolute(match: re.Match) -> str:
        original = normalized_original_url(match.group(1))
        parsed = urlparse(original)
        host = parsed.netloc
        local_url = resolve_local_url(root, host, parsed.path or "/", parsed.query)
        if local_url:
            return local_url
        if host in ARCHIVE_HOSTS:
            missing_urls.add("https://web.archive.org" + normalized_original_url(match.group(0)))
        return match.group(0)

    def repl_site_path(match: re.Match) -> str:
        path_and_query = normalized_original_url(match.group(1))
        parsed = urlparse("https://www.echecs92.fr/" + path_and_query.lstrip("/"))
        local_url = resolve_local_url(root, "www.echecs92.fr", parsed.path or "/", parsed.query)
        if local_url:
            return local_url
        return "/" + path_and_query.lstrip("/")

    html = ROOT_WAYBACK_URL_RE.sub(repl_absolute, html)
    html = ROOT_WAYBACK_SITE_PATH_RE.sub(repl_site_path, html)
    return html


def replace_direct_asset_urls(html: str, root: Path, missing_urls: set[str]) -> str:
    def repl(match: re.Match) -> str:
        original = normalized_original_url(match.group(0))
        parsed = urlparse(original)
        host = parsed.netloc
        if host not in ARCHIVE_HOSTS:
            return original
        path = parsed.path or "/"
        local_url = resolve_local_url(root, host, path, parsed.query)
        if local_url:
            return local_url
        if host == "image.jimcdn.com":
            for alt_path in jimcdn_image_fallback_paths(path):
                alt_local = resolve_local_url(root, host, alt_path, parsed.query)
                if alt_local:
                    return alt_local
        missing_urls.add(wayback_missing_url(original))
        return original

    return DIRECT_ASSET_URL_RE.sub(repl, html)


def process_html(html_path: Path, root: Path, domain: str, missing_urls: set[str]) -> None:
    text = html_path.read_text(encoding="utf-8", errors="ignore")
    text = WAYBACK_BLOCK_RE.sub("", text)
    text = WAYBACK_TOOLBAR_RE.sub("", text)
    text = ARCHIVE_PREFETCH_RE.sub("", text)
    text = ADMIN_LINKS_RE.sub("", text)
    text = replace_wayback_urls(text, root, missing_urls)
    text = replace_root_wayback_urls(text, root, missing_urls)
    text = replace_direct_asset_urls(text, root, missing_urls)
    text = inject_meta(text, domain, html_path, root)
    html_path.write_text(text, encoding="utf-8")


def write_robots(root: Path) -> None:
    robots_path = root / "robots.txt"
    robots_path.write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")


def write_htaccess(root: Path) -> None:
    htaccess_path = root / ".htaccess"
    htaccess_path.write_text(
        '<IfModule mod_headers.c>\n'
        '  Header set X-Robots-Tag "noindex, nofollow" always\n'
        '</IfModule>\n'
        'Options -Indexes\n',
        encoding="utf-8",
    )


def main() -> int:
    if len(sys.argv) != 3:
        usage()
        return 1

    root = Path(sys.argv[1]).resolve()
    domain = sys.argv[2].strip()
    if not domain:
        print("Archive domain must not be empty.", file=sys.stderr)
        return 1

    target_root = promote_site_root(root)
    if not target_root.exists():
        print(f"Archive root not found: {target_root}", file=sys.stderr)
        return 1

    missing_urls: set[str] = set()
    for html_path in target_root.rglob("*.html"):
        process_html(html_path, target_root, domain, missing_urls)

    write_robots(target_root)
    write_htaccess(target_root)

    report_path = target_root / "missing-wayback-urls.txt"
    if missing_urls:
        report_path.write_text("\n".join(sorted(missing_urls)) + "\n", encoding="utf-8")
    else:
        report_path.write_text("", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
