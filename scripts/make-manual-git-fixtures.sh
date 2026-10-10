#!/bin/sh
# Builds throwaway Git projects for the Phase 6 manual check (docs/testing.md §26).
# Run inside the dev container: `docker compose exec -T dev sh scripts/make-manual-git-fixtures.sh`.
# The output lives in the container home, outside the repository, so Biome and Git never see
# it; it is lost when the container is recreated (run the script again).
set -eu
BASE="${MANUAL_GIT_BASE:-$HOME/manual-git}"
SRC=/workspace/fixtures/projects/basic
rm -rf "$BASE"
mkdir -p "$BASE"

gc() { repo=$1; shift; git -C "$repo" -c user.name="Manual Tester" -c user.email="tester@example.invalid" "$@"; }

# 1. Not a repository
cp -r "$SRC" "$BASE/not-git"

# 2. Nested: the project is a sub-folder of a repository -> unsupportedRepositoryLayout
mkdir -p "$BASE/nested"
cp -r "$SRC" "$BASE/nested/project"
git -C "$BASE/nested" init -q
gc "$BASE/nested" add -A
gc "$BASE/nested" commit -qm "nested root"

# 3. Clean repository (no changes)
cp -r "$SRC" "$BASE/clean"
git -C "$BASE/clean" init -q
gc "$BASE/clean" add -A
gc "$BASE/clean" commit -qm "initial"

# 4. Main scenario repository
R="$BASE/changes"
cp -r "$SRC" "$R"
git -C "$R" init -q
mkdir -p "$R/notes"
printf 'line one\nline two\nline three\n' > "$R/notes/partial.txt"
printf 'to be modified\n' > "$R/notes/modified.txt"
printf 'to be deleted\n' > "$R/notes/deleted.txt"
printf 'to be renamed\n' > "$R/notes/old-name.txt"
printf 'staged then nothing\n' > "$R/notes/staged-only.txt"
head -c 64 /dev/urandom > "$R/notes/image.bin"
printf 'small\n' > "$R/notes/large.txt"
printf 'caf\351\n' > "$R/notes/latin1.txt"
gc "$R" add -A
gc "$R" commit -qm "initial"
# 60 more commits so the history has a second page (page size 50).
i=1
while [ "$i" -le 60 ]; do
  printf 'entry %s\n' "$i" >> "$R/notes/log.txt"
  gc "$R" add notes/log.txt
  gc "$R" commit -qm "history entry $i"
  i=$((i + 1))
done
# A summary with markup-like text (must show literally).
printf 'markup\n' >> "$R/notes/log.txt"
gc "$R" add notes/log.txt
gc "$R" commit -qm '<b>not bold</b> & <script>alert(1)</script>'
# Working tree changes
printf 'line one CHANGED\nline two\nline three\n' > "$R/notes/partial.txt"
gc "$R" add notes/partial.txt
printf 'line one CHANGED\nline two\nline three CHANGED AGAIN\n' > "$R/notes/partial.txt"
printf 'modified now\n' >> "$R/notes/modified.txt"
rm "$R/notes/deleted.txt"
gc "$R" mv notes/old-name.txt notes/new-name.txt
printf 'staged change\n' >> "$R/notes/staged-only.txt"
gc "$R" add notes/staged-only.txt
head -c 64 /dev/urandom > "$R/notes/image.bin"
# > 1 MiB diff
yes 'a long line of text to make the diff larger than the limit' | head -n 30000 > "$R/notes/large.txt"
printf 'caf\351 au lait\n' > "$R/notes/latin1.txt"
printf 'brand new file\n' > "$R/notes/untracked.txt"
# Long diff for scrolling: 400 lines
seq 1 400 | sed 's/^/scroll line /' > "$R/notes/long.txt"
gc "$R" add notes/long.txt
gc "$R" commit -qm "add long file" -- notes/long.txt
seq 1 400 | sed 's/^/scroll line changed /' > "$R/notes/long.txt"

# 5. Conflict repository
C="$BASE/conflict"
cp -r "$SRC" "$C"
git -C "$C" init -q -b main
printf 'base\n' > "$C/conflict.txt"
gc "$C" add -A
gc "$C" commit -qm "base"
gc "$C" checkout -qb other
printf 'other side\n' > "$C/conflict.txt"
gc "$C" commit -qam "other"
gc "$C" checkout -q main
printf 'main side\n' > "$C/conflict.txt"
gc "$C" commit -qam "main"
gc "$C" merge other >/dev/null 2>&1 || true
printf 'unrelated change\n' > "$C/free.txt"

# A local identity so commits from the app work without touching the global config.
for repo in "$BASE/clean" "$R" "$C"; do
  git -C "$repo" config user.name "Manual Tester"
  git -C "$repo" config user.email "tester@example.invalid"
done

echo "created in $BASE:"
ls "$BASE"
git -C "$R" status --short
git -C "$C" status --short
