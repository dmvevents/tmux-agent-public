#!/usr/bin/env bash
# temp-home-meter.sh — `bash test/helpers/temp-home-meter.sh <test-file>...`: run each test file ALONE under a private,
# empty temp directory and count what it leaves there. One line per file:
#   DELTA=<n> <file> (before=0 after=<n> rc=<test rc> tests=<tests the child ran>)   then, when n > 0:   left: <names>
# Exit 0 only when every file read DELTA=0, exited 0 AND ran at least one test — a red test file is not a measured file,
# an empty run is not a measurement, and a file that leaks reds the meter with its name and its count, never an aggregate.
#
# Why a private directory rather than counting /tmp: the unit runner executes every test file concurrently, so a count
# of /tmp's `ta-*` entries before and after ONE file is perturbed by every sibling's mkdtemp/rmSync churn, and the file
# under test may itself be running twice (once as a sibling, once as this meter's child). os.tmpdir() honours TMPDIR
# (and TMP/TEMP) on Linux and macOS, so a child started with all three pointed at a fresh directory puts every
# mkdtempSync(join(tmpdir(), …)) there and nowhere else — before is 0 by construction, and every `ta-*` entry present
# after is that file's own leftover. tmux is unaffected: its sockets follow TMUX_TMPDIR, which this script does not touch.
#
# Counted: entries named `ta-*`, the suite's own fixture convention (the card's criterion). Anything else left in the
# directory is printed as `other:` and NOT counted — measured on this host, a real pane's login shell writes
# `kiro-clilog` and `kirorun` under whatever TMPDIR it inherits (the kiro-cli-term shell-init perturbation the
# *-tmux-down suites already work around), and that is the host's leftover, not the test file's.
#
# The node binary is $TA_NODE when set (test/temp-home-leak.test.js passes process.execPath, so the child runs on the
# node that runs the suite), else `node` from PATH. NODE_TEST_CONTEXT is scrubbed from the child's environment: a
# `node --test` that inherits it from a test runner above (the suite driving this meter) prints "run() is being called
# recursively within a test file. skipping running files" and exits 0 having run NOTHING — measured here on node 22.21.1
# with all seven files reading DELTA=0 in 434 ms — so every child's TAP summary is read back and a file that ran zero
# tests reds the meter (`tests=0`) rather than passing on an empty run. The reporter is PINNED to tap: node 24 made
# `spec` the default on every destination, so its summary reads `ℹ tests N` where 20 and 22 wrote `# tests N` to a
# file — the first CI run of this meter (36218630831, 7f4a4c5) read tests=0 on all seven files in both node-24 cells
# while 20 and 22 passed. The pin makes the line the same on every version; the read accepts both spellings anyway.
# Portable to macOS CI's bash 3.2: no arrays beyond "$@", no mapfile.
set -u
node_bin="${TA_NODE:-node}"
if [ "$#" -eq 0 ]; then echo "usage: temp-home-meter.sh <test-file>..." >&2; exit 2; fi
root=$(mktemp -d "${TMPDIR:-/tmp}/ta-homemeter-XXXXXX") || { echo "temp-home-meter: mktemp failed" >&2; exit 2; }
status=0
for f in "$@"; do
  # each file gets its own empty directory, so one file's leftover cannot be charged to the next
  sub="$root/$(basename "$f" .test.js)"
  mkdir "$sub" || { echo "temp-home-meter: mkdir $sub failed" >&2; exit 2; }
  log="$root/$(basename "$f" .test.js).log"   # the child's TAP, kept OUTSIDE $sub so it is never counted
  before=$(ls -A "$sub" | grep -c '^ta-')
  env -u NODE_TEST_CONTEXT TMPDIR="$sub" TMP="$sub" TEMP="$sub" "$node_bin" --test --test-reporter=tap "$f" >"$log" 2>&1; rc=$?
  after=$(ls -A "$sub" | grep -c '^ta-')
  tests=$(grep -m1 -E '^(# tests|ℹ tests) ' "$log" | awk '{print $3}')
  [ -n "$tests" ] || tests=0
  echo "DELTA=$((after - before)) $f (before=$before after=$after rc=$rc tests=$tests)"
  if [ "$after" -ne "$before" ]; then
    echo "  left: $(ls -A "$sub" | grep '^ta-' | tr '\n' ' ')"
    status=1
  fi
  if [ "$tests" -eq 0 ]; then
    echo "  tests=0: the file ran nothing — not a measured file"
    status=1
  fi
  other=$(ls -A "$sub" | grep -v '^ta-' | tr '\n' ' ')
  if [ -n "$other" ]; then echo "  other: $other(not counted — not the suite's fixtures)"; fi
  if [ "$rc" -ne 0 ]; then status=1; fi
done
rm -rf "$root"
exit "$status"
