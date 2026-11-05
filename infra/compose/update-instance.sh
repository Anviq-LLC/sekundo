#!/usr/bin/env bash
# Update one published-image instance to an image tag, with a database backup first and a rollback
# to the previous images when the new ones do not start.
#
# Run from the instance directory (default /opt/anviq), the one with docker-compose.images.yml:
#   ./update-instance.sh sha-<commit> [--dry-run]
#
# --dry-run checks the tag, the Compose file and free disk, prints what would change, and stops
# before touching .env, the database or the running containers.
#
# ANVIQ_COMPOSE_FILE names a docker-compose.images.yml that matches the tag (fleet.sh sends one). It
# is checked first and replaces the instance's copy only once the update starts; the old copy is
# kept next to it and restored if the update rolls back.
#
# Migrations are not reversed by a rollback. They only add tables and columns, so the previous
# images keep working against the migrated database; the backup is for anything else.
set -Eeuo pipefail

TAG="${1:-}"
DRY_RUN=0
[[ "${2:-}" == --dry-run ]] && DRY_RUN=1
[[ "${TAG}" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || {
  echo "Usage: $0 <image tag, for example sha-1a2b3c4 or edge> [--dry-run]" >&2
  exit 1
}

cd "${ANVIQ_DIR:-/opt/anviq}"
BACKUP_DIR="${ANVIQ_BACKUP_DIR:-/var/backups/anviq}"
MIN_FREE_GB="${ANVIQ_MIN_FREE_GB:-5}"
UP_TIMEOUT="${ANVIQ_UP_TIMEOUT:-10m}"
STAMP="$(date +%Y%m%d-%H%M%S)"

COMPOSE_BASE=docker-compose.images.yml
trap 'rm -f "${COMPOSE_BASE}.next"' EXIT
new_compose="${ANVIQ_COMPOSE_FILE:-}"
if [[ -n "${new_compose}" ]]; then
  [[ -f "${new_compose}" ]] || { echo "No Compose file at ${new_compose}" >&2; exit 1; }
  cmp -s "${new_compose}" "${COMPOSE_BASE}" || { cp "${new_compose}" "${COMPOSE_BASE}.next"; new_compose="${COMPOSE_BASE}.next"; }
  [[ "${new_compose}" == "${COMPOSE_BASE}.next" ]] || new_compose=""
fi
files=(-f "${new_compose:-${COMPOSE_BASE}}")
[[ -f docker-compose.traefik.yml ]] && files+=(-f docker-compose.traefik.yml)
compose() { docker compose --env-file .env "${files[@]}" "$@"; }
trap 'echo "Failed at line ${LINENO}: ${BASH_COMMAND}" >&2' ERR

set_env() {
  local key="$1" value="$2"
  sed -i "/^${key}=/d" .env
  printf '%s=%s\n' "${key}" "${value}" >>.env
}

if (( DRY_RUN )); then
  [[ -f .env || -f secrets.enc.yaml ]] || { echo "No .env and no secrets.enc.yaml in $(pwd)" >&2; exit 1; }
  if [[ -f .env ]]; then
    docker compose --env-file .env "${files[@]}" config --quiet
    echo "Now running: $(sed -n 's/^ANVIQ_IMAGE_TAG=//p' .env | tail -n 1)"
    # The images this update would pull, from the registry path .env and the compose file resolve to.
    while read -r image; do
      [[ "${image}" == *":${TAG}" ]] || continue
      docker manifest inspect "${image}" >/dev/null 2>&1 || {
        echo "Cannot reach ${image}; check the image path in .env and the registry login" >&2
        exit 1
      }
      echo "Found ${image}"
    done < <(ANVIQ_IMAGE_TAG="${TAG}" ANVIQ_COMPUTER_IMAGE_TAG="${TAG}" docker compose --env-file .env "${files[@]}" config --images | sort -u)
  fi
  free_gb="$(df -BG --output=avail . | tail -n 1 | tr -dc '0-9')"
  (( free_gb >= MIN_FREE_GB )) || { echo "Only ${free_gb} GB free; need ${MIN_FREE_GB}" >&2; exit 1; }
  [[ -z "${new_compose}" ]] || echo "Would replace ${COMPOSE_BASE} with the one for ${TAG}"
  echo "Dry run ok: would update to ${TAG} with ${free_gb} GB free"
  exit 0
fi

# .env is the decrypted secrets file; a host that keeps only the encrypted copy gets it rebuilt.
if [[ ! -f .env ]]; then
  [[ -f secrets.enc.yaml ]] || { echo "No .env and no secrets.enc.yaml in $(pwd)" >&2; exit 1; }
  (umask 077 && sops --decrypt --output-type dotenv secrets.enc.yaml >.env)
fi
chmod 600 .env
grep -q '^POSTGRES_APP_PASSWORD=' .env || set_env POSTGRES_APP_PASSWORD "$(openssl rand -hex 16)"

compose config --quiet
free_gb="$(df -BG --output=avail . | tail -n 1 | tr -dc '0-9')"
(( free_gb >= MIN_FREE_GB )) || { echo "Only ${free_gb} GB free; need ${MIN_FREE_GB}" >&2; exit 1; }

previous_image="$(docker inspect --format '{{.Image}}' "$(compose ps -q api)" 2>/dev/null || true)"
previous_tag="$(sed -n 's/^ANVIQ_IMAGE_TAG=//p' .env | tail -n 1)"
previous_computer_tag="$(sed -n 's/^ANVIQ_COMPUTER_IMAGE_TAG=//p' .env | tail -n 1)"

if [[ "${previous_tag}" == "${TAG}" && -z "${new_compose}" ]]; then
  echo "Already on ${TAG}"
  exit 0
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
dump="${BACKUP_DIR}/anviq-pre-update-${STAMP}.dump"
if [[ -n "$(compose ps -q postgres)" ]]; then
  (umask 077 && compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' >"${dump}")
  entries="$(compose exec -T postgres pg_restore -l <"${dump}" | wc -l)"
  (( entries > 0 )) || { echo "Backup ${dump} is empty" >&2; exit 1; }
  echo "Backup ${dump} (${entries} lines)"
else
  echo "Postgres is not running here; skipping the backup" >&2
fi
[[ -n "${previous_image}" ]] && docker tag "${previous_image}" "anviq-app:rollback-${STAMP}"

saved_compose=""
if [[ -n "${new_compose}" ]]; then
  saved_compose="${COMPOSE_BASE}.pre-update-${STAMP}"
  cp -p "${COMPOSE_BASE}" "${saved_compose}"
  mv "${new_compose}" "${COMPOSE_BASE}"
  files=(-f "${COMPOSE_BASE}")
  [[ -f docker-compose.traefik.yml ]] && files+=(-f docker-compose.traefik.yml)
fi

rollback() {
  echo "Update failed; going back to ${previous_tag:-the previous images}" >&2
  [[ -z "${saved_compose}" ]] || cp -p "${saved_compose}" "${COMPOSE_BASE}"
  if [[ -n "${previous_tag}" ]]; then
    set_env ANVIQ_IMAGE_TAG "${previous_tag}"
    set_env ANVIQ_COMPUTER_IMAGE_TAG "${previous_computer_tag:-${previous_tag}}"
    timeout "${UP_TIMEOUT}" docker compose --env-file .env "${files[@]}" up -d --wait --pull never || true
  fi
  echo "Database backup: ${dump}" >&2
  exit 1
}

set_env ANVIQ_IMAGE_TAG "${TAG}"
set_env ANVIQ_COMPUTER_IMAGE_TAG "${TAG}"
trap 'echo "Failed at line ${LINENO}: ${BASH_COMMAND}" >&2; rollback' ERR
compose pull --quiet
timeout "${UP_TIMEOUT}" docker compose --env-file .env "${files[@]}" up -d --wait --pull never
trap - ERR

revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(compose ps -q api)")"
echo "Updated to ${TAG} (revision ${revision:0:9}). Previous: ${previous_tag:-unknown}. Backup: ${dump}"
