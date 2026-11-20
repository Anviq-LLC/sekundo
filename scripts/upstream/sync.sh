#!/usr/bin/env bash
# Copyright 2026 Anviq LLC. All rights reserved.
# Rebuilds the renamed mirror of an upstream ref and tells you how to merge it.
# Usage: scripts/upstream/sync.sh [upstream-ref]   (default: upstream/main)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
ref=${1:-upstream/main}
mirror=anviq-upstream

git fetch --quiet --force upstream --tags
commit=$(git rev-parse --verify "$ref^{commit}")

tmp="$(cd "$(git rev-parse --git-dir)" && pwd)/sync-tmp"
cleanup() { git worktree remove --force "$tmp" 2>/dev/null || true; }
trap cleanup EXIT
cleanup
git worktree add --quiet --detach "$tmp" "$commit"
git -C "$tmp" config core.longpaths true

node "$here/rebrand.mjs" "$tmp"
(cd "$tmp" && corepack pnpm install --lockfile-only >/dev/null)
# The rename changes import order, so let Biome (from this checkout) tidy the mirror.
root=$(git rev-parse --show-toplevel)
(cd "$tmp" && node "$root/node_modules/@biomejs/biome/bin/biome" check --write . >/dev/null 2>&1 || true)
git -C "$tmp" add -A
tree=$(git -C "$tmp" write-tree)

# The mirror chains only to its previous commit, so upstream authors never enter this history.
parents=()
if git rev-parse --verify --quiet "refs/heads/$mirror" >/dev/null; then
  parents=(-p "$mirror")
fi
new=$(git commit-tree "$tree" "${parents[@]}" \
  -m "Sync upstream $ref" \
  -m "Anviq rename applied to upstream $(git rev-parse --short "$commit").")
git update-ref "refs/heads/$mirror" "$new"

echo "$mirror is now $(git rev-parse --short "$new"). Merge it with: git merge $mirror"
