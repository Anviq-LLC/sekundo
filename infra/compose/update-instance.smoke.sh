#!/usr/bin/env bash
# The update script's dry run must leave .env and the containers alone.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p "$scratch/bin" "$scratch/inst"
cat > "$scratch/bin/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$*" in
  *"config --images"*)
    printf '%s
' "${ANVIQ_IMAGE:-registry.example.test/app}:${ANVIQ_IMAGE_TAG:-edge}"       "${ANVIQ_COMPUTER_IMAGE:-registry.example.test/computer}:${ANVIQ_COMPUTER_IMAGE_TAG:-edge}" "postgres:16"
    ;;
  *"manifest inspect"*) [[ "${FAKE_MISSING:-0}" != 1 ]] || exit 1 ;;
  *" up "*) [[ "${FAKE_UP_FAIL:-0}" != 1 ]] || exit 1 ;;
esac
FAKE
chmod +x "$scratch/bin/docker"
export PATH="$scratch/bin:$PATH" CALLS="$scratch/calls" ANVIQ_DIR="$scratch/inst" ANVIQ_MIN_FREE_GB=0 ANVIQ_BACKUP_DIR="$scratch/backups"
printf 'ANVIQ_IMAGE_TAG=sha-old\n' > "$scratch/inst/.env"
cp "$scratch/inst/.env" "$scratch/before"

out="$(bash "$root/update-instance.sh" sha-new --dry-run 2>&1)" || fail "dry run failed: $out"
[[ "$out" == *"Now running: sha-old"* && "$out" == *"Dry run ok: would update to sha-new"* ]] || fail "unexpected output: $out"
cmp -s "$scratch/before" "$scratch/inst/.env" || fail "dry run changed .env"
! grep -qE ' (up|pull|exec) ' "$CALLS" || fail "dry run touched containers"
[[ "$out" == *"Found registry.example.test/app:sha-new"* && "$out" == *"Found registry.example.test/computer:sha-new"* ]] || fail "did not check the target images: $out"
[[ "$out" != *"postgres"* ]] || fail "checked an image this update does not move"
if out="$(FAKE_MISSING=1 bash "$root/update-instance.sh" sha-new --dry-run 2>&1)"; then fail "passed with an unreachable image"; fi
[[ "$out" == *"Cannot reach registry.example.test/app:sha-new"* ]] || fail "missing image not named: $out"
! bash "$root/update-instance.sh" 'bad tag' --dry-run 2>/dev/null || fail "accepted a bad tag"

echo "services: new" > "$scratch/new.yml"
echo "services: old" > "$scratch/inst/docker-compose.images.yml"
out="$(ANVIQ_COMPOSE_FILE="$scratch/new.yml" bash "$root/update-instance.sh" sha-new --dry-run 2>&1)" || fail "dry run with a new Compose file failed: $out"
[[ "$out" == *"Would replace docker-compose.images.yml"* ]] || fail "did not mention the Compose file: $out"
[[ "$(cat "$scratch/inst/docker-compose.images.yml")" == "services: old" ]] || fail "dry run replaced the Compose file"
[[ ! -e "$scratch/inst/docker-compose.images.yml.next" ]] || fail "dry run left a staged Compose file"

if FAKE_UP_FAIL=1 ANVIQ_COMPOSE_FILE="$scratch/new.yml" bash "$root/update-instance.sh" sha-new >/dev/null 2>&1; then fail "a failed start did not fail the update"; fi
[[ "$(cat "$scratch/inst/docker-compose.images.yml")" == "services: old" ]] || fail "rollback kept the new Compose file"
[[ "$(sed -n 's/^ANVIQ_IMAGE_TAG=//p' "$scratch/inst/.env")" == "sha-old" ]] || fail "rollback kept the new tag"

out="$(ANVIQ_COMPOSE_FILE="$scratch/new.yml" bash "$root/update-instance.sh" sha-new 2>&1)" || fail "update failed: $out"
[[ "$(cat "$scratch/inst/docker-compose.images.yml")" == "services: new" ]] || fail "update did not install the new Compose file"
ls "$scratch"/inst/docker-compose.images.yml.pre-update-* >/dev/null 2>&1 || fail "no copy of the old Compose file"

: > "$CALLS"
out="$(ANVIQ_COMPOSE_FILE="$scratch/new.yml" bash "$root/update-instance.sh" sha-new 2>&1)" || fail "second run failed: $out"
[[ "$out" == *"Already on sha-new"* ]] || fail "re-running the same release was not skipped: $out"
! grep -qE ' (up|pull|exec) ' "$CALLS" || fail "a skipped update touched containers"
# Moving to another registry path: checked in the dry run, applied with the update, undone on rollback.
printf 'ANVIQ_IMAGE_TAG=sha-r
ANVIQ_IMAGE=old.example.test/anviq/app
ANVIQ_COMPUTER_IMAGE=old.example.test/anviq/computer
' > "$scratch/inst/.env"
! ANVIQ_REGISTRY='bad path' bash "$root/update-instance.sh" sha-r2 --dry-run >/dev/null 2>&1 || fail "accepted a bad registry path"
out="$(ANVIQ_REGISTRY=new.example.test/sekundo bash "$root/update-instance.sh" sha-r2 --dry-run 2>&1)" || fail "registry dry run failed: $out"
[[ "$out" == *"Found new.example.test/sekundo/app:sha-r2"* && "$out" == *"Would move the images to new.example.test/sekundo"* ]] || fail "registry dry run did not check the new path: $out"
grep -q 'old.example.test/anviq/app' "$scratch/inst/.env" || fail "dry run changed the image path"
if FAKE_UP_FAIL=1 ANVIQ_REGISTRY=new.example.test/sekundo bash "$root/update-instance.sh" sha-r2 >/dev/null 2>&1; then fail "a failed registry move did not fail"; fi
[[ "$(sed -n 's/^ANVIQ_IMAGE=//p' "$scratch/inst/.env")" == "old.example.test/anviq/app" ]] || fail "rollback kept the new image path"
[[ "$(sed -n 's/^ANVIQ_COMPUTER_IMAGE=//p' "$scratch/inst/.env")" == "old.example.test/anviq/computer" ]] || fail "rollback kept the new computer image path"
out="$(ANVIQ_REGISTRY=new.example.test/sekundo bash "$root/update-instance.sh" sha-r 2>&1)" || fail "moving registry on the same tag failed: $out"
[[ "$out" != *"Already on"* ]] || fail "skipped a registry move because the tag matched"
[[ "$(sed -n 's/^ANVIQ_IMAGE=//p' "$scratch/inst/.env")" == "new.example.test/sekundo/app" ]] || fail "registry move not applied"
out="$(ANVIQ_REGISTRY=new.example.test/sekundo bash "$root/update-instance.sh" sha-r 2>&1)" || fail "second run failed: $out"
[[ "$out" == *"Already on sha-r"* ]] || fail "repeat registry move not skipped: $out"
echo "update-instance smoke ok"
