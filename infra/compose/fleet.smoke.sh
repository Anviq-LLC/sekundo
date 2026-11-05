#!/usr/bin/env bash
# Exercise the fleet script with stub ssh and scp, without hosts or Docker.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p "$scratch/bin"
cat > "$scratch/bin/scp" <<'FAKE'
#!/usr/bin/env bash
echo "scp $*" >> "$CALLS"
FAKE
cat > "$scratch/bin/ssh" <<'FAKE'
#!/usr/bin/env bash
echo "ssh $*" >> "$CALLS"
[[ "$2" != *broken* ]] || exit 1
echo "sha-abc123 0123456789abcdef"
FAKE
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH" CALLS="$scratch/calls"
export ANVIQ_FLEET_FILE="$scratch/fleet"
cat > "$ANVIQ_FLEET_FILE" <<'LIST'
# comment
one deploy@one.example.test
two deploy@two.example.test /srv/two
LIST

out="$(bash "$root/fleet.sh" update sha-1 --dry-run 2>&1)" || fail "dry run failed: $out"
[[ "$out" == *"Done: 2 of 2"* ]] || fail "missing summary: $out"
grep -q 'ANVIQ_DIR=/srv/two ANVIQ_COMPOSE_FILE=.*\.yml  *bash .* sha-1 --dry-run' "$CALLS" || fail "dry run flag, directory or Compose file not passed"
grep -qE '^scp .*\.yml' "$CALLS" || fail "Compose file not copied"
if out="$(bash "$root/fleet.sh" update sha-deadbeef 2>&1)"; then fail "accepted a tag whose commit is not here"; fi
[[ "$out" == *"not in this checkout"* && "$out" == *"Failed: one"* && "$out" == *"Not started: two"* ]] || fail "unknown commit not reported: $out"

out="$(bash "$root/fleet.sh" versions 2>&1)" || fail "versions failed: $out"
[[ "$out" == *"sha-abc123 0123456789abcdef"* ]] || fail "missing version: $out"

# A failing first instance stops the run before the others are touched.
printf 'one deploy@broken.example.test\ntwo deploy@two.example.test\n' > "$ANVIQ_FLEET_FILE"
: > "$CALLS"
if out="$(bash "$root/fleet.sh" update sha-1 2>&1)"; then fail "a failing instance did not fail the run"; fi
[[ "$out" == *"Failed: one"* && "$out" == *"Not started: two"* ]] || fail "missing failure summary: $out"
! grep -q 'two.example.test' "$CALLS" || fail "kept going after a failure"

# The canary goes first and gates the rest, even when it is not first in the list.
printf 'a deploy@a.example.test\nb deploy@b.example.test\nc deploy@broken-c.example.test\n' > "$ANVIQ_FLEET_FILE"
: > "$CALLS"
if out="$(bash "$root/fleet.sh" update sha-1 --canary c 2>&1)"; then fail "a failing canary did not fail the run"; fi
[[ "$out" == *"Failed: c"* && "$out" == *"Not started: a b"* ]] || fail "canary failure not reported: $out"
! grep -qE '(a|b)\.example\.test' "$CALLS" || fail "touched instances after the canary failed"
! bash "$root/fleet.sh" update sha-1 --canary nope 2>/dev/null || fail "accepted an unknown canary"

# Parallel batches: every instance not yet started is skipped after a failure, the rest finish.
printf 'a deploy@a.example.test\nb deploy@b.example.test\nc deploy@broken-c.example.test\nd deploy@d.example.test\ne deploy@e.example.test\n' > "$ANVIQ_FLEET_FILE"
: > "$CALLS"
if out="$(bash "$root/fleet.sh" update sha-1 --parallel 2 2>&1)"; then fail "a failure in a parallel run did not fail it"; fi
[[ "$out" == *"ok     b"* && "$out" == *"FAILED c"* ]] || fail "parallel run lost results: $out"
[[ "$out" == *"Failed: c"* ]] || fail "parallel failure not summarised: $out"
printf 'a deploy@a.example.test\nb deploy@b.example.test\nc deploy@c.example.test\nd deploy@d.example.test\n' > "$ANVIQ_FLEET_FILE"
: > "$CALLS"
out="$(bash "$root/fleet.sh" update sha-1 --parallel 3 2>&1)" || fail "parallel update failed: $out"
[[ "$out" == *"Done: 4 of 4"* ]] || fail "parallel run did not finish everything: $out"
for host in a b c d; do grep -q "$host.example.test" "$CALLS" || fail "$host was not updated"; done

# A registry path is handed to each instance.
printf 'a deploy@a.example.test
' > "$ANVIQ_FLEET_FILE"
: > "$CALLS"
out="$(bash "$root/fleet.sh" update sha-1 --dry-run --registry ghcr.io/example/sekundo 2>&1)" || fail "registry run failed: $out"
grep -q 'ANVIQ_REGISTRY=ghcr.io/example/sekundo bash' "$CALLS" || fail "registry not passed to the host"
! bash "$root/fleet.sh" update sha-1 --registry 2>/dev/null || fail "accepted --registry without a value"
printf 'a deploy@a.example.test
b deploy@b.example.test
c deploy@c.example.test
d deploy@d.example.test
' > "$ANVIQ_FLEET_FILE"

# A subset can be named, and versions reports an unreachable instance without stopping.
: > "$CALLS"
out="$(bash "$root/fleet.sh" update sha-1 --only b,d 2>&1)" || fail "subset failed: $out"
[[ "$out" == *"Done: 2 of 2"* ]] || fail "subset summary: $out"
! grep -qE '(a|c)\.example\.test' "$CALLS" || fail "touched instances outside the subset"
printf 'a deploy@a.example.test\nb deploy@broken-b.example.test\nc deploy@c.example.test\n' > "$ANVIQ_FLEET_FILE"
if out="$(bash "$root/fleet.sh" versions --parallel 2 2>&1)"; then fail "versions hid an unreachable instance"; fi
[[ "$out" == *"b "*unreachable* && "$out" == *"c "*sha-abc123* ]] || fail "versions stopped at a failure: $out"

! bash "$root/fleet.sh" update 2>/dev/null || fail "accepted a missing tag"
! bash "$root/fleet.sh" update sha-1 --parallel 0 2>/dev/null || fail "accepted a zero width"
echo "fleet smoke ok"
