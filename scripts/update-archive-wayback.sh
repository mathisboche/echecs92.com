#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-archive-wayback}"
ARCHIVE_DOMAIN="${2:-archive.echecs92.com}"
SNAPSHOT="${3:-latest}"

./scripts/mirror-jimdo-archive.sh "$SNAPSHOT" "$OUT_DIR" "$ARCHIVE_DOMAIN"

missing_count="0"
if [[ -f "$OUT_DIR/missing-wayback-urls.txt" ]]; then
  missing_count="$(wc -l < "$OUT_DIR/missing-wayback-urls.txt" | tr -d ' ')"
fi

html_count="$(find "$OUT_DIR" -type f -name '*.html' | wc -l | tr -d ' ')"
file_count="$(find "$OUT_DIR" -type f | wc -l | tr -d ' ')"
size_human="$(du -sh "$OUT_DIR" | awk '{print $1}')"
build_utc="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
resolved_snapshot="$(cat "$OUT_DIR/wayback-snapshot.txt" 2>/dev/null || true)"

cat > "$OUT_DIR/archive-build.txt" <<EOF
Archive build (Jimdo -> static)

Built at (UTC): $build_utc
Wayback snapshot: ${resolved_snapshot:-$SNAPSHOT}
Archive domain: $ARCHIVE_DOMAIN

Files: $file_count
HTML pages: $html_count
Disk usage: $size_human
Remaining missing Wayback URLs: $missing_count
EOF

if [[ "${ARCHIVE_VALIDATE:-1}" != "0" ]]; then
  python3 scripts/validate-archive.py "$OUT_DIR" --min-html-pages "${ARCHIVE_MIN_HTML_PAGES:-40}"
fi

# Keep a single zip next to the folder for deployment/backups.
ZIP_PATH="${OUT_DIR}.zip"
rm -f "$ZIP_PATH"
zip -rq "$ZIP_PATH" "$OUT_DIR" -x '*.DS_Store'
echo "Wrote $ZIP_PATH"
