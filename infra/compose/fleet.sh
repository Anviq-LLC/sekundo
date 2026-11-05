#!/usr/bin/env bash
# Update or inspect a list of published-image instances over SSH.
#
#   ./fleet.sh update <image tag> [--dry-run] [--canary a,b] [--parallel N] [--only a,b]
#                                 [--registry <path>]
#   ./fleet.sh versions [--parallel N] [--only a,b]
#
# An update goes in two stages. The canary instances (default: the first in the list) update one
# after another; if any fails, nothing else is touched. The rest then update N at a time (default
# 1). --registry moves the instances to the images under that path, for example
# ghcr.io/anviq-llc/sekundo. After any failure no new instance is started, the ones already running finish, and the exit
# status is 1. Run the same command again to carry on: an instance already on the tag is skipped.
#
# The list is a private file outside the repository (default ~/.config/anviq/fleet, or
# ANVIQ_FLEET_FILE). One instance per line: <name> <ssh target> [<instance directory>].
# See fleet.example for the format.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
list="${ANVIQ_FLEET_FILE:-${HOME}/.config/anviq/fleet}"
[[ -f "${list}" ]] || { echo "No instance list at ${list}" >&2; exit 1; }

usage() {
  echo "Usage: $0 update <image tag> [--dry-run] [--canary a,b] [--parallel N] [--only a,b] [--registry path] | versions [--parallel N] [--only a,b]" >&2
  exit 1
}

# The Compose file that ships with a release: the one at the commit a sha-<commit> tag names, or
# this checkout's copy for any other tag.
compose_for() {
  local tag="$1" out="$2"
  if [[ "${tag}" =~ ^sha-([0-9a-f]{7,40})$ ]]; then
    git -C "${here}" show "${BASH_REMATCH[1]}:infra/compose/docker-compose.images.yml" >"${out}" 2>/dev/null ||
      { echo "Commit ${BASH_REMATCH[1]} is not in this checkout; run git fetch" >&2; return 1; }
  else
    cp "${here}/docker-compose.images.yml" "${out}"
  fi
}

update() {
  local target="$1" dir="$2" tag="$3" flag="$4" remote compose
  remote="/tmp/anviq-update-instance.$$"
  compose="$(mktemp)"
  compose_for "${tag}" "${compose}" || { rm -f "${compose}"; return 1; }
  scp -q "${here}/update-instance.sh" "${target}:${remote}"
  scp -q "${compose}" "${target}:${remote}.yml"
  rm -f "${compose}"
  ssh -n "${target}" "ANVIQ_DIR=$(printf %q "${dir}") ANVIQ_COMPOSE_FILE=${remote}.yml ${registry:+ANVIQ_REGISTRY=$(printf %q "${registry}")} bash ${remote} ${tag} ${flag}; code=\$?; rm -f ${remote} ${remote}.yml; exit \$code"
}

versions() {
  local target="$1" dir="$2"
  ssh -n "${target}" "cd $(printf %q "${dir}") && printf '%s ' \"\$(sed -n 's/^ANVIQ_IMAGE_TAG=//p' .env | tail -n 1)\" && docker inspect --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}}' \"\$(docker compose --env-file .env -f docker-compose.images.yml ps -q api)\""
}

command="${1:-}"
[[ "${command}" == update || "${command}" == versions ]] || usage
shift
tag="" flag="" canary="" only="" parallel=1 registry=""
if [[ "${command}" == update ]]; then
  tag="${1:-}"
  [[ -n "${tag}" && "${tag}" != --* ]] || usage
  shift
fi
while (( $# )); do
  case "$1" in
    --dry-run) [[ "${command}" == update ]] || usage; flag="--dry-run" ;;
    --canary) [[ "${command}" == update && -n "${2:-}" ]] || usage; canary="$2"; shift ;;
    --registry) [[ "${command}" == update && -n "${2:-}" ]] || usage; registry="$2"; shift ;;
    --only) [[ -n "${2:-}" ]] || usage; only="$2"; shift ;;
    --parallel) [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || usage; parallel="$2"; shift ;;
    *) usage ;;
  esac
  shift
done

scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT

# name, ssh target and directory of the instances to act on, in list order.
sed -e 's/#.*//' "${list}" | awk -v only="${only}" '
  BEGIN { n = split(only, wanted, ","); for (i = 1; i <= n; i++) want[wanted[i]] = 1 }
  NF >= 2 && (only == "" || ($1 in want)) { print $1, $2, ($3 == "" ? "/opt/anviq" : $3) }' >"${scratch}/rows"
total="$(wc -l <"${scratch}/rows" | tr -d ' ')"
(( total > 0 )) || { echo "${list} lists no instances${only:+ named ${only}}" >&2; exit 1; }

names="$(awk '{ print $1 }' "${scratch}/rows" | tr '\n' ' ')"
for wanted in ${canary//,/ }; do
  [[ " ${names} " == *" ${wanted} "* ]] || { echo "No instance named ${wanted}" >&2; exit 1; }
done

ok="" failed="" skipped="" pending=""
stop_on_failure=1
[[ "${command}" == versions ]] && stop_on_failure=0

run_one() {
  local name="$1" target dir
  read -r target dir < <(awk -v n="${name}" '$1 == n { print $2, $3 }' "${scratch}/rows")
  if [[ "${command}" == update ]]; then update "${target}" "${dir}" "${tag}" "${flag}"; else versions "${target}" "${dir}"; fi
}

finish() {
  local name="$1" code="$2"
  if [[ "${command}" == versions ]]; then
    if (( code == 0 )); then printf '%-24s %s\n' "${name}" "$(head -n 1 "${scratch}/${name}.log")"
    else printf '%-24s unreachable\n' "${name}"; fi
  elif (( code == 0 )); then
    echo "ok     ${name}"
  else
    echo "FAILED ${name}" >&2
    tail -n 20 "${scratch}/${name}.log" >&2 || true
  fi
  if (( code == 0 )); then ok="${ok} ${name}"; else failed="${failed} ${name}"; fi
}

reap() {
  local name still=""
  for name in ${pending}; do
    if [[ -f "${scratch}/${name}.code" ]]; then finish "${name}" "$(cat "${scratch}/${name}.code")"; else still="${still} ${name}"; fi
  done
  pending="${still}"
}

# Run the named instances with at most $1 at a time; after a failure the rest are not started.
stage() {
  local width="$1" name code
  shift
  for name in "$@"; do
    reap
    if (( stop_on_failure )) && [[ -n "${failed}" ]]; then skipped="${skipped} ${name}"; continue; fi
    while (( $(wc -w <<<"${pending}") >= width )); do sleep 1; reap; done
    if (( stop_on_failure )) && [[ -n "${failed}" ]]; then skipped="${skipped} ${name}"; continue; fi
    if (( width == 1 )); then
      echo "== ${name}"
      set +e
      run_one "${name}" </dev/null 2>&1 | tee "${scratch}/${name}.log"
      code="${PIPESTATUS[0]}"
      set -e
      if (( code == 0 )); then ok="${ok} ${name}"; else failed="${failed} ${name}"; echo "FAILED ${name}" >&2; fi
    else
      (
        set +e
        run_one "${name}" </dev/null >"${scratch}/${name}.log" 2>&1
        echo "$?" >"${scratch}/${name}.code"
      ) &
      pending="${pending} ${name}"
    fi
  done
  while [[ -n "${pending// /}" ]]; do sleep 1; reap; done
}

if [[ "${command}" == update ]]; then
  first=""
  for name in ${canary//,/ }; do first="${first} ${name}"; done
  [[ -n "${first}" ]] || first=" $(head -n 1 "${scratch}/rows" | awk '{ print $1 }')"
  rest=""
  for name in ${names}; do [[ " ${first} " == *" ${name} "* ]] || rest="${rest} ${name}"; done
  # shellcheck disable=SC2086
  stage 1 ${first}
  # shellcheck disable=SC2086
  stage "${parallel}" ${rest}
else
  # shellcheck disable=SC2086
  stage "${parallel}" ${names}
fi

count() { [[ -n "${1// /}" ]] && wc -w <<<"$1" | tr -d ' ' || echo 0; }
if [[ "${command}" == update ]]; then
  echo "Done: $(count "${ok}") of ${total}"
  [[ -z "${failed// /}" ]] || echo "Failed:${failed}" >&2
  [[ -z "${skipped// /}" ]] || echo "Not started:${skipped}" >&2
fi
[[ -z "${failed// /}" ]] || exit 1
