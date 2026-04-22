#!/usr/bin/env bash
set -euo pipefail

snapshot="${1:-latest}"
out_dir="${2:-archive-wayback}"
archive_domain="${3:-archive.echecs92.com}"

if [[ "$snapshot" == "latest" ]]; then
  snapshot="$(python3 - <<'PY'
import json
import urllib.request

api = "https://archive.org/wayback/available?url=https://www.echecs92.fr/"
try:
    with urllib.request.urlopen(api, timeout=20) as resp:
        data = json.load(resp)
    ts = (
        data.get("archived_snapshots", {})
        .get("closest", {})
        .get("timestamp", "")
    )
    print(ts)
except Exception:
    print("")
PY
)"
  if [[ -z "$snapshot" ]]; then
    snapshot="20251009182304"
    echo "Warning: could not determine latest Wayback snapshot. Using fallback: $snapshot" >&2
  else
    echo "Using latest Wayback snapshot: $snapshot" >&2
  fi
fi

base_url="http://web.archive.org/web/${snapshot}/https://www.echecs92.fr/"

mkdir -p "$out_dir"
echo "$snapshot" > "$out_dir/wayback-snapshot.txt"
if [[ -n "$(ls -A "$out_dir" 2>/dev/null)" ]]; then
  echo "Using existing output directory (resume): $out_dir" >&2
fi

set +e
wget \
  --mirror \
  --page-requisites \
  --adjust-extension \
  --convert-links \
  --continue \
  --max-redirect=4 \
  --timeout=20 \
  --restrict-file-names=windows \
  --span-hosts \
  --domains web.archive.org,web-static.archive.org \
  --no-host-directories \
  --cut-dirs=3 \
  --no-parent \
  --wait=1 \
  --random-wait \
  --waitretry=10 \
  --tries=3 \
  --retry-connrefused \
  --retry-on-host-error \
  --retry-on-http-error=429,500,502,503,504 \
  --reject-regex '/save/_embed/' \
  --directory-prefix "$out_dir" \
  "$base_url"
status=$?
set -e

if [[ $status -ne 0 ]]; then
  echo "Warning: wget exited with status $status; continuing with post-processing." >&2
fi

# Wget gets a useful first pass for assets, but normal Wayback replay can inject
# toolbar markup and can miss unlinked pages. CDX gives us one latest raw capture
# for every archived HTML page of the old site.
python3 scripts/fetch-wayback-cdx.py "$out_dir" 0.2 || true

python3 scripts/postprocess-archive.py "$out_dir" "$archive_domain"

missing_file="$out_dir/missing-wayback-urls.txt"
if [[ -s "$missing_file" ]]; then
  echo "Fetching missing resources (see $missing_file)..." >&2
  # Fetch from Wayback when possible; fall back to direct Jimdo assets/downloads when needed.
  python3 scripts/fetch-missing-wayback.py "$out_dir" "$missing_file" 0.2 || true
  python3 scripts/postprocess-archive.py "$out_dir" "$archive_domain"
fi

# Some assets (e.g. .jpg/.css) occasionally get saved as Wayback HTML wrapper pages.
# Replace those wrappers with the real resource payloads.
python3 scripts/fix-wayback-wrappers.py "$out_dir" 0.2 || true
python3 scripts/postprocess-archive.py "$out_dir" "$archive_domain"
