#!/usr/bin/env bash
# The additive migration check: plain drops fail, annotated and deferred ones pass.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
cd "$scratch"
git init -q
git config user.email test@example.test
git config user.name test
mkdir -p packages/db/prisma/migrations
echo placeholder > packages/db/prisma/migrations/.keep
git add -A
git commit -q -m base
base="$(git rev-parse HEAD)"

add() {
  mkdir -p "packages/db/prisma/migrations/$1"
  printf '%s\n' "${@:2}" > "packages/db/prisma/migrations/$1/migration.sql"
  git add -A
  git commit -q -m "$1"
}

add 001_add 'ALTER TABLE "t" ADD COLUMN "c" TEXT;'
bash "$root/check-migrations-additive.sh" "$base" || fail "rejected an additive migration"

add 002_drop 'ALTER TABLE "t" DROP COLUMN "c";'
if bash "$root/check-migrations-additive.sh" "$base" 2>/dev/null; then fail "accepted a plain drop"; fi
git reset -q --hard HEAD~1

add 003_allowed 'ALTER TABLE "t" DROP COLUMN "c"; -- allow-destructive: unused since the first release'
bash "$root/check-migrations-additive.sh" "$base" || fail "rejected an annotated drop"
git reset -q --hard HEAD~1

add 004_deferred '-- deferred' 'ALTER TABLE "t" DROP COLUMN "c";'
bash "$root/check-migrations-additive.sh" "$base" || fail "rejected a deferred drop"

add 005_late '-- not first' 'ALTER TABLE "t" DROP COLUMN "d";'
git reset -q --hard HEAD~1
printf '%s\n' 'ALTER TABLE "t" DROP COLUMN "e";' '-- deferred' > packages/db/prisma/migrations/004_deferred/migration.sql
git add -A
git commit -q -m late
if bash "$root/check-migrations-additive.sh" "$base" 2>/dev/null; then fail "honored -- deferred that was not the first line"; fi
echo "check-migrations-additive smoke ok"
