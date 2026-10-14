#!/usr/bin/env bash
# Changelog-drift gate: a commit that changes what a user installs must also touch
# CHANGELOG.md, or say [no-changelog] in its subject.
#
# Why this exists: KR5 carried "CHANGELOG current ✅" for two weeks by inheritance while the
# shipped tree changed four times with no [Unreleased] entry — 15afe63 (lexicon multiline-flag
# fix, user-visible classification behaviour), the qs/hono lock-only security bumps
# and the npm-audit CI job. Nothing went red. This script is that red: it walks every
# commit since the newest one that touched CHANGELOG.md and fails, naming SHAs and subjects, if
# any of them changed src/**, package.json or package-lock.json without the changelog moving.
# The lock file is watched on purpose — lock-only bumps were exactly the unrecorded class, and
# while the repo is private the git-clone path is the only install path, so the lock IS what a
# user installs.
#
# Escape hatch: a subject containing [no-changelog] (comment-only edits, refactors, dev-dep
# lock bumps). It is a visible, greppable decision in history rather than a silent omission.
#
# Vacuity guards (BANLIST: an empty scan is never a pass):
#  - a shallow clone cannot find the anchor — the graft root claims every file as added — so
#    refuse to run (exit 2). CI checks out with fetch-depth: 0.
#  - no commit touching CHANGELOG.md reachable from HEAD → hard error (exit 2), not a pass.
#  - the number of commits scanned is always printed; a silent pass does not exist.
#
# Uncommitted edits to CHANGELOG.md count as the pending changelog commit (printed as such).
# That is how entries and code land in ONE commit with `npm test` green beforehand, and it
# grants nothing a one-line CHANGELOG commit would not: this gate checks that the changelog
# moved with the code, never what it says. CI trees are never dirty, so the gate there is the
# committed history alone.
#
# Exit codes: 0 pass · 1 drift (offenders listed) · 2 cannot evaluate (shallow / no anchor).
# Optional first argument: repository to check (defaults to this checkout) — used by the
# planted-failure regression in test/changelog-current.test.js, which watches this script FAIL
# on a fixture with an unrecorded src change before trusting it to pass on a healthy one.
set -euo pipefail
cd "${1:-$(dirname "$0")/..}"

WATCH_RE='^(src/|package\.json$|package-lock\.json$)'
ESCAPE='[no-changelog]'

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "CHANGELOG-CHECK ERROR: shallow clone — the newest CHANGELOG.md commit is unreachable, so the scan would be vacuous." >&2
  echo "Check out with fetch-depth: 0 (CI) or run: git fetch --unshallow" >&2
  exit 2
fi

anchor="$(git log -1 --format=%H -- CHANGELOG.md)"
if [ -z "$anchor" ]; then
  echo "CHANGELOG-CHECK ERROR: no commit touching CHANGELOG.md is reachable from HEAD — refusing to pass on an empty scan." >&2
  exit 2
fi
anchor_short="$(git log -1 --format='%h %s' "$anchor")"

# A staged or unstaged edit to CHANGELOG.md is the pending changelog commit (see header).
pending=""
[ -n "$(git status --porcelain --untracked-files=no -- CHANGELOG.md)" ] && pending=1

# No mapfile/associative arrays: macOS CI runs /bin/bash 3.2 (test/smoke.sh has the same rule).
commits="$(git rev-list --reverse "$anchor..HEAD")"
count="$(git rev-list --count "$anchor..HEAD")"
echo "changelog-check: anchor  $anchor_short"
echo "changelog-check: scanning $count commit(s) in ${anchor:0:7}..HEAD"

offenders=()
excused=0
for sha in $commits; do
  files="$(git diff-tree --no-commit-id --name-only -r "$sha")"
  shipped="$(grep -E "$WATCH_RE" <<<"$files" || true)"
  [ -z "$shipped" ] && continue                    # docs/tests/CI only — nothing a user installs
  line="$(git log -1 --format='%h %s' "$sha")"
  if [[ "$line" == *"$ESCAPE"* ]]; then
    excused=$((excused + 1))
    echo "  excused   $line"
    continue
  fi
  offenders+=("$line  <$(tr '\n' ' ' <<<"$shipped" | sed 's/ $//')>")
done

if [ ${#offenders[@]} -eq 0 ]; then
  echo "CHANGELOG-CHECK PASS: no unrecorded shipped-tree change since CHANGELOG.md last moved (scanned $count, excused $excused)"
  exit 0
fi

if [ -n "$pending" ]; then
  echo "changelog-check: CHANGELOG.md has uncommitted edits — treating them as the pending changelog commit for:"
  printf '  %s\n' "${offenders[@]}"
  echo "CHANGELOG-CHECK PASS (pending): commit CHANGELOG.md together with these, or the committed tree fails this check."
  exit 0
fi

echo "CHANGELOG-CHECK FAIL: ${#offenders[@]} commit(s) changed the shipped tree since CHANGELOG.md last moved ($anchor_short) with no changelog entry:" >&2
printf '  %s\n' "${offenders[@]}" >&2
echo "Add an [Unreleased] entry to CHANGELOG.md, or put [no-changelog] in the subject of a commit that changes nothing a user can observe." >&2
exit 1
