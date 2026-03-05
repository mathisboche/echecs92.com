#!/usr/bin/env bash
set -euo pipefail

: "${FTP_SERVER:?Missing FTP_SERVER}"
: "${FTP_USERNAME:?Missing FTP_USERNAME}"
: "${FTP_PASSWORD:?Missing FTP_PASSWORD}"

LOCAL_DIR="${1:-wp-content/themes/echecs92-child/assets/data}"
REMOTE_ASSETS_DIR="${2:-/www/wp-content/themes/echecs92-child/assets}"
LIVE_DIR_NAME="${3:-data}"
STAGING_DIR_NAME="${LIVE_DIR_NAME}.__staging"
RUN_TAG="${GITHUB_RUN_ID:-manual}_${GITHUB_RUN_ATTEMPT:-1}_$(date +%s)"
LOCK_DIR_NAME="${LIVE_DIR_NAME}.__deploy_lock"
# Multiple data-sync workflows can queue on the same FTP lock; keep enough room for bursts.
LOCK_WAIT_SECONDS="${DEPLOY_LOCK_WAIT_SECONDS:-3600}"
LOCK_RETRY_SECONDS="${DEPLOY_LOCK_RETRY_SECONDS:-10}"
MAX_DEPLOY_ATTEMPTS="${DEPLOY_MAX_ATTEMPTS:-3}"
DEPLOY_RETRY_SECONDS="${DEPLOY_RETRY_SECONDS:-20}"

if [[ ! -d "${LOCAL_DIR}" ]]; then
  echo "Local directory not found: ${LOCAL_DIR}" >&2
  exit 1
fi

if [[ -z "$(find "${LOCAL_DIR}" -mindepth 1 -print -quit)" ]]; then
  echo "Local directory is empty: ${LOCAL_DIR}" >&2
  exit 1
fi

if [[ ! -f "${LOCAL_DIR}/clubs-france.json" ]]; then
  echo "Missing expected file: ${LOCAL_DIR}/clubs-france.json" >&2
  exit 1
fi

REQUIRED_FILES=(
  "clubs-france-ffe.json"
  "ffe-players/manifest.json"
  "ffe-players/search-index.json"
  "ffe-players/search-index-92.json"
  "ffe-players/top-elo.json"
  "ffe-players/top-elo-92.json"
)

for rel_path in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "${LOCAL_DIR}/${rel_path}" ]]; then
    echo "Missing expected file: ${LOCAL_DIR}/${rel_path}" >&2
    exit 1
  fi
done

if [[ -z "$(find "${LOCAL_DIR}/ffe-players/by-id" -maxdepth 1 -type f -name '*.json' -print -quit 2>/dev/null)" ]]; then
  echo "Missing expected player shards in: ${LOCAL_DIR}/ffe-players/by-id" >&2
  exit 1
fi

if ! [[ "${LOCK_WAIT_SECONDS}" =~ ^[0-9]+$ ]] || (( LOCK_WAIT_SECONDS < 1 )); then
  echo "Invalid DEPLOY_LOCK_WAIT_SECONDS: ${LOCK_WAIT_SECONDS}" >&2
  exit 1
fi

if ! [[ "${LOCK_RETRY_SECONDS}" =~ ^[0-9]+$ ]] || (( LOCK_RETRY_SECONDS < 1 )); then
  echo "Invalid DEPLOY_LOCK_RETRY_SECONDS: ${LOCK_RETRY_SECONDS}" >&2
  exit 1
fi

if ! [[ "${MAX_DEPLOY_ATTEMPTS}" =~ ^[0-9]+$ ]] || (( MAX_DEPLOY_ATTEMPTS < 1 )); then
  echo "Invalid DEPLOY_MAX_ATTEMPTS: ${MAX_DEPLOY_ATTEMPTS}" >&2
  exit 1
fi

if ! [[ "${DEPLOY_RETRY_SECONDS}" =~ ^[0-9]+$ ]] || (( DEPLOY_RETRY_SECONDS < 1 )); then
  echo "Invalid DEPLOY_RETRY_SECONDS: ${DEPLOY_RETRY_SECONDS}" >&2
  exit 1
fi

acquire_remote_lock() {
  local waited=0
  while true; do
    if lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftps://${FTP_SERVER}:21" <<EOF
set ftp:passive-mode true
set ftp:ssl-force true
set ssl:verify-certificate yes
set net:max-retries 2
set net:reconnect-interval-base 2
set net:timeout 20
set xfer:use-temp-file false
set cmd:fail-exit false
mkdir "${REMOTE_ASSETS_DIR}"
set cmd:fail-exit true
mkdir "${REMOTE_ASSETS_DIR}/${LOCK_DIR_NAME}"
bye
EOF
    then
      echo "→ Remote deploy lock acquired (${LOCK_DIR_NAME}) after ${waited}s wait."
      return 0
    fi

    if (( waited >= LOCK_WAIT_SECONDS )); then
      echo "ERROR: Could not acquire remote deploy lock (${LOCK_DIR_NAME}) after ${LOCK_WAIT_SECONDS}s." >&2
      return 1
    fi

    local sleep_for="${LOCK_RETRY_SECONDS}"
    local remaining=$((LOCK_WAIT_SECONDS - waited))
    if (( remaining < sleep_for )); then
      sleep_for="${remaining}"
    fi
    echo "→ Deploy lock busy; waited ${waited}s/${LOCK_WAIT_SECONDS}s. Retrying in ${sleep_for}s..."
    sleep "${sleep_for}"
    waited=$((waited + sleep_for))
  done
}

release_remote_lock() {
  lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftps://${FTP_SERVER}:21" <<EOF || true
set ftp:passive-mode true
set ftp:ssl-force true
set ssl:verify-certificate yes
set net:max-retries 1
set net:reconnect-interval-base 1
set net:timeout 15
set cmd:fail-exit false
rm -rf "${REMOTE_ASSETS_DIR}/${LOCK_DIR_NAME}"
bye
EOF
}

cleanup_attempt_upload_dir() {
  local upload_dir_name="$1"

  lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftps://${FTP_SERVER}:21" <<EOF || true
set ftp:passive-mode true
set ftp:ssl-force true
set ssl:verify-certificate yes
set net:max-retries 2
set net:reconnect-interval-base 2
set net:timeout 20
set cmd:fail-exit false
rm -rf "${REMOTE_ASSETS_DIR}/${upload_dir_name}"
bye
EOF
}

deploy_once() {
  local attempt="$1"
  local upload_dir_name="${LIVE_DIR_NAME}.__upload_${RUN_TAG}_a${attempt}"
  local backup_dir_name="${LIVE_DIR_NAME}.__backup_${RUN_TAG}_a${attempt}"

  echo "→ Uploading generated data to remote staging (${upload_dir_name})..."

  if lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftps://${FTP_SERVER}:21" <<EOF
set ftp:passive-mode true
set ftp:ssl-force true
set ssl:verify-certificate yes
set net:max-retries 8
set net:reconnect-interval-base 5
set net:reconnect-interval-max 30
set net:timeout 45
set xfer:use-temp-file false
set cmd:fail-exit false
mkdir "${REMOTE_ASSETS_DIR}"
set cmd:fail-exit true
cd "${REMOTE_ASSETS_DIR}"
set cmd:fail-exit false
rm -rf "${upload_dir_name}"
rm -rf "${backup_dir_name}"
set cmd:fail-exit true
mkdir "${upload_dir_name}"
# FTP target does not support chmod/site-perm operations reliably in parallel mode.
mirror --reverse --verbose --only-newer --parallel=2 --no-perms "${LOCAL_DIR}/" "${upload_dir_name}/"
cls "${upload_dir_name}"
set cmd:fail-exit false
mv "${LIVE_DIR_NAME}" "${backup_dir_name}"
set cmd:fail-exit true
mv "${upload_dir_name}" "${LIVE_DIR_NAME}"
set cmd:fail-exit false
rm -rf "${STAGING_DIR_NAME}"
mv "${backup_dir_name}" "${STAGING_DIR_NAME}"
rm -rf "${upload_dir_name}"
set cmd:fail-exit true
bye
EOF
  then
    return 0
  fi

  echo "WARN: deploy attempt ${attempt}/${MAX_DEPLOY_ATTEMPTS} failed. Cleaning remote temp directories..." >&2
  cleanup_attempt_upload_dir "${upload_dir_name}"
  return 1
}

LOCK_ACQUIRED=0
if acquire_remote_lock; then
  LOCK_ACQUIRED=1
else
  exit 1
fi
trap 'if [[ "${LOCK_ACQUIRED}" -eq 1 ]]; then release_remote_lock; fi' EXIT

deploy_ok=0
for attempt in $(seq 1 "${MAX_DEPLOY_ATTEMPTS}"); do
  if deploy_once "${attempt}"; then
    deploy_ok=1
    break
  fi

  if (( attempt < MAX_DEPLOY_ATTEMPTS )); then
    echo "→ Retrying deploy in ${DEPLOY_RETRY_SECONDS}s..."
    sleep "${DEPLOY_RETRY_SECONDS}"
  fi
done

if [[ "${deploy_ok}" -ne 1 ]]; then
  echo "ERROR: Deploy failed after ${MAX_DEPLOY_ATTEMPTS} attempts." >&2
  exit 1
fi

echo "→ Atomic swap completed."
