#!/usr/bin/env bash
set -euo pipefail

# Sync wp-content/uploads to the server without storing files in git.

FTP_SERVER="${FTP_SERVER:-}"
FTP_USERNAME="${FTP_USERNAME:-}"
FTP_PASSWORD="${FTP_PASSWORD:-}"
FTP_PROTOCOL="${FTP_PROTOCOL:-ftps}"
FTP_PORT="${FTP_PORT:-21}"
LOCAL_DIR="${LOCAL_DIR:-wp-content/uploads}"
REMOTE_DIR="${REMOTE_DIR:-/www/wp-content/uploads/}"

if [[ -z "$FTP_SERVER" || -z "$FTP_USERNAME" || -z "$FTP_PASSWORD" ]]; then
  echo "Missing FTP credentials. Set FTP_SERVER, FTP_USERNAME, FTP_PASSWORD." >&2
  exit 1
fi

if ! command -v lftp >/dev/null 2>&1; then
  echo "lftp is required. Install with: brew install lftp" >&2
  exit 1
fi

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "Local uploads folder not found: $LOCAL_DIR" >&2
  exit 1
fi

lftp -u "$FTP_USERNAME","$FTP_PASSWORD" "$FTP_PROTOCOL://$FTP_SERVER:$FTP_PORT" <<EOF
set ssl:verify-certificate yes
set ftp:ssl-force true
set ftp:passive-mode true
mirror --reverse --only-newer --verbose --exclude-glob .DS_Store "$LOCAL_DIR" "$REMOTE_DIR"
bye
EOF
