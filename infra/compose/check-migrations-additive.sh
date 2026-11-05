#!/usr/bin/env bash
# Fail when a migration added since <base> drops or renames something, or tightens a column.
# The previous and the new API run side by side right after migrations apply, so a migration must
# keep working with the previous release: add first, drop or rename in a later release.
# A line ending in "-- allow-destructive: <reason>" accepts one statement on purpose.
# A migration whose first line is "-- deferred" is held back by the migrate command until the
# next deploy, so it may drop or rename: nothing running reads what it removes by then.
set -euo pipefail

base="${1:-origin/main}"
pattern='DROP (TABLE|COLUMN|TYPE|DEFAULT)|RENAME|SET NOT NULL|ALTER COLUMN .* TYPE'
status=0
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue
  [[ "$(head -n 1 "${file}" | tr -d '\r')" == "-- deferred" ]] && continue
  hits="$(grep -niE "${pattern}" "${file}" | grep -vi -- '-- allow-destructive:' || true)"
  if [[ -n "${hits}" ]]; then
    echo "${file} is not additive:" >&2
    echo "${hits}" >&2
    status=1
  fi
done < <(git diff --name-only --diff-filter=A "${base}...HEAD" -- 'packages/db/prisma/migrations/*/migration.sql')
exit "${status}"
