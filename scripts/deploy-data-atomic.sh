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
LOCK_WAIT_SECONDS="${DEPLOY_LOCK_WAIT_SECONDS:-1200}"
LOCK_RETRY_SECONDS="${DEPLOY_LOCK_RETRY_SECONDS:-10}"
LOCK_STALE_SECONDS="${DEPLOY_LOCK_STALE_SECONDS:-900}"
LOCK_HEARTBEAT_SECONDS="${DEPLOY_LOCK_HEARTBEAT_SECONDS:-60}"
MAX_DEPLOY_ATTEMPTS="${DEPLOY_MAX_ATTEMPTS:-3}"
DEPLOY_RETRY_SECONDS="${DEPLOY_RETRY_SECONDS:-20}"
LFTP_SMALL_TIMEOUT_SECONDS="${LFTP_SMALL_TIMEOUT_SECONDS:-45}"
LFTP_DEPLOY_TIMEOUT_SECONDS="${LFTP_DEPLOY_TIMEOUT_SECONDS:-1800}"
LOCK_HEARTBEAT_FILE="${LOCK_DIR_NAME}/heartbeat.epoch"
LOCK_ACQUIRED_FILE="${LOCK_DIR_NAME}/acquired.epoch"
LOCK_OWNER_FILE="${LOCK_DIR_NAME}/owner.txt"

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

if ! [[ "${LOCK_STALE_SECONDS}" =~ ^[0-9]+$ ]] || (( LOCK_STALE_SECONDS < 1 )); then
  echo "Invalid DEPLOY_LOCK_STALE_SECONDS: ${LOCK_STALE_SECONDS}" >&2
  exit 1
fi

if ! [[ "${LOCK_HEARTBEAT_SECONDS}" =~ ^[0-9]+$ ]] || (( LOCK_HEARTBEAT_SECONDS < 1 )); then
  echo "Invalid DEPLOY_LOCK_HEARTBEAT_SECONDS: ${LOCK_HEARTBEAT_SECONDS}" >&2
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

if ! [[ "${LFTP_SMALL_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]] || (( LFTP_SMALL_TIMEOUT_SECONDS < 5 )); then
  echo "Invalid LFTP_SMALL_TIMEOUT_SECONDS: ${LFTP_SMALL_TIMEOUT_SECONDS}" >&2
  exit 1
fi

if ! [[ "${LFTP_DEPLOY_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]] || (( LFTP_DEPLOY_TIMEOUT_SECONDS < 60 )); then
  echo "Invalid LFTP_DEPLOY_TIMEOUT_SECONDS: ${LFTP_DEPLOY_TIMEOUT_SECONDS}" >&2
  exit 1
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "Missing required command: timeout" >&2
  exit 1
fi

write_remote_lock_metadata() {
  local epoch_now="$1"
  local tmp_epoch
  local tmp_owner
  tmp_epoch="$(mktemp)"
  tmp_owner="$(mktemp)"
  printf '%s\n' "${epoch_now}" > "${tmp_epoch}"
  {
    printf 'run_tag=%s\n' "${RUN_TAG}"
    printf 'pid=%s\n' "$$"
    printf 'host=%s\n' "$(hostname 2>/dev/null || echo unknown)"
    printf 'acquired_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "${tmp_owner}"

  timeout --signal=TERM --kill-after=5 "${LFTP_SMALL_TIMEOUT_SECONDS}" \
    lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF >/dev/null 2>&1 || true
set ftp:passive-mode true
set ssl:verify-certificate no
set net:max-retries 2
set net:reconnect-interval-base 2
set net:timeout 20
set cmd:fail-exit false
put "${tmp_epoch}" -o "${REMOTE_ASSETS_DIR}/${LOCK_ACQUIRED_FILE}"
put "${tmp_epoch}" -o "${REMOTE_ASSETS_DIR}/${LOCK_HEARTBEAT_FILE}"
put "${tmp_owner}" -o "${REMOTE_ASSETS_DIR}/${LOCK_OWNER_FILE}"
bye
EOF

  rm -f "${tmp_epoch}" "${tmp_owner}"
}

read_remote_lock_epoch() {
  local content
  local remote_file
  for remote_file in "${LOCK_HEARTBEAT_FILE}" "${LOCK_ACQUIRED_FILE}"; do
    content="$(
      timeout --signal=TERM --kill-after=5 "${LFTP_SMALL_TIMEOUT_SECONDS}" \
        lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF 2>/dev/null || true
set ftp:passive-mode true
set ssl:verify-certificate no
set net:max-retries 1
set net:reconnect-interval-base 1
set net:timeout 10
set cmd:fail-exit true
get -O - "${REMOTE_ASSETS_DIR}/${remote_file}"
bye
EOF
    )"
    content="$(printf '%s' "${content}" | tr -cd '0-9')"
    if [[ "${content}" =~ ^[0-9]{9,}$ ]]; then
      echo "${content}"
      return 0
    fi
  done
  return 1
}

force_release_remote_lock() {
  timeout --signal=TERM --kill-after=5 "${LFTP_SMALL_TIMEOUT_SECONDS}" \
    lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF >/dev/null 2>&1 || true
set ftp:passive-mode true
set ssl:verify-certificate no
set net:max-retries 2
set net:reconnect-interval-base 2
set net:timeout 20
set cmd:fail-exit false
rm -rf "${REMOTE_ASSETS_DIR}/${LOCK_DIR_NAME}"
bye
EOF
}

LOCK_HEARTBEAT_PID=""

start_lock_heartbeat() {
  (
    local epoch_now
    local tmp_epoch
    while true; do
      sleep "${LOCK_HEARTBEAT_SECONDS}"
      epoch_now="$(date +%s)"
      tmp_epoch="$(mktemp)"
      printf '%s\n' "${epoch_now}" > "${tmp_epoch}"
      timeout --signal=TERM --kill-after=5 "${LFTP_SMALL_TIMEOUT_SECONDS}" \
        lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF >/dev/null 2>&1 || true
set ftp:passive-mode true
set ssl:verify-certificate no
set net:max-retries 1
set net:reconnect-interval-base 1
set net:timeout 10
set cmd:fail-exit false
put "${tmp_epoch}" -o "${REMOTE_ASSETS_DIR}/${LOCK_HEARTBEAT_FILE}"
bye
EOF
      rm -f "${tmp_epoch}"
    done
  ) &
  LOCK_HEARTBEAT_PID=$!
}

stop_lock_heartbeat() {
  if [[ -n "${LOCK_HEARTBEAT_PID}" ]] && kill -0 "${LOCK_HEARTBEAT_PID}" >/dev/null 2>&1; then
    kill "${LOCK_HEARTBEAT_PID}" >/dev/null 2>&1 || true
    wait "${LOCK_HEARTBEAT_PID}" 2>/dev/null || true
  fi
  LOCK_HEARTBEAT_PID=""
}

acquire_remote_lock() {
  local started_at
  local waited=0
  local epoch_now
  local lock_epoch
  local lock_age
  local force_cleanup=0
  local last_forced_cleanup_at=0
  local sleep_for
  local remaining

  started_at="$(date +%s)"

  while true; do
    epoch_now="$(date +%s)"
    waited=$((epoch_now - started_at))
    if timeout --signal=TERM --kill-after=5 "${LFTP_SMALL_TIMEOUT_SECONDS}" \
      lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF
set ftp:passive-mode true
set ssl:verify-certificate no
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
      write_remote_lock_metadata "${epoch_now}"
      echo "→ Remote deploy lock acquired (${LOCK_DIR_NAME}) after ${waited}s wait."
      return 0
    fi

    force_cleanup=0
    if lock_epoch="$(read_remote_lock_epoch)"; then
      epoch_now="$(date +%s)"
      waited=$((epoch_now - started_at))
      lock_age=$((epoch_now - lock_epoch))
      if (( lock_age < 0 )); then
        lock_age=0
      fi
      if (( lock_age >= LOCK_STALE_SECONDS )); then
        force_cleanup=1
      fi
    else
      epoch_now="$(date +%s)"
      waited=$((epoch_now - started_at))
      if (( waited >= LOCK_STALE_SECONDS )); then
        force_cleanup=1
      fi
    fi

    if (( force_cleanup == 1 )) && (( last_forced_cleanup_at == 0 || epoch_now - last_forced_cleanup_at >= LOCK_RETRY_SECONDS )); then
      echo "WARN: stale remote deploy lock detected. Forcing cleanup of ${LOCK_DIR_NAME}." >&2
      force_release_remote_lock
      last_forced_cleanup_at="${epoch_now}"
    fi

    epoch_now="$(date +%s)"
    waited=$((epoch_now - started_at))
    if (( waited >= LOCK_WAIT_SECONDS )); then
      echo "ERROR: Could not acquire remote deploy lock (${LOCK_DIR_NAME}) after ${LOCK_WAIT_SECONDS}s." >&2
      return 1
    fi

    sleep_for="${LOCK_RETRY_SECONDS}"
    remaining=$((LOCK_WAIT_SECONDS - waited))
    if (( remaining < sleep_for )); then
      sleep_for="${remaining}"
    fi
    if (( sleep_for < 1 )); then
      sleep_for=1
    fi
    echo "→ Deploy lock busy; waited ${waited}s/${LOCK_WAIT_SECONDS}s. Retrying in ${sleep_for}s..."
    sleep "${sleep_for}"
  done
}

release_remote_lock() {
  stop_lock_heartbeat
  timeout --signal=TERM --kill-after=5 "${LFTP_SMALL_TIMEOUT_SECONDS}" \
    lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF || true
set ftp:passive-mode true
set ssl:verify-certificate no
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

  timeout --signal=TERM --kill-after=5 "${LFTP_SMALL_TIMEOUT_SECONDS}" \
    lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF || true
set ftp:passive-mode true
set ssl:verify-certificate no
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

  if timeout --signal=TERM --kill-after=10 "${LFTP_DEPLOY_TIMEOUT_SECONDS}" \
    lftp -u "${FTP_USERNAME}","${FTP_PASSWORD}" "ftp://${FTP_SERVER}:21" <<EOF
set ftp:passive-mode true
set ssl:verify-certificate no
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
  start_lock_heartbeat
else
  exit 1
fi
trap 'if [[ "${LOCK_ACQUIRED}" -eq 1 ]]; then release_remote_lock; fi' EXIT INT TERM

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
