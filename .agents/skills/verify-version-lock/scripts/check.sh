#!/bin/sh
# Model-check the native installer's version lock, and prove the check can fail.
#
#   .agents/skills/verify-version-lock/scripts/check.sh
#
# Runs in a temp copy of model/: re-translates the PlusCal (and fails if the
# committed translation is stale), checks the real model, then checks three
# deliberately broken variants that must each be caught. Exit 0 only when the
# real model passes AND every break is caught.
#
# Tools: TLA2TOOLS (path to tla2tools.jar) and JAVA, or mise installs the same
# pinned versions pstack's /statechart uses (needs the network once).
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/verify-version-lock.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp "$here"/model/* "$work"/

TLC_TOOL='http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4'
JAVA_TOOL='java@temurin-25'
if [ -z "${TLA2TOOLS:-}" ] || [ -z "${JAVA:-}" ]; then
  command -v mise >/dev/null || { echo "need TLA2TOOLS and JAVA, or mise" >&2; exit 2; }
  ( cd "$work" && MISE_CEILING_PATHS="$work" mise install "$JAVA_TOOL" "$TLC_TOOL" >/dev/null 2>&1 ) || true
  TLA2TOOLS="$(cd "$work" && MISE_CEILING_PATHS="$work" mise where "$TLC_TOOL")/tla2tools.jar"
  JAVA="$(cd "$work" && MISE_CEILING_PATHS="$work" mise which java --tool "$JAVA_TOOL")"
fi

cd "$work"
translate() { "$JAVA" -cp "$TLA2TOOLS" pcal.trans -nocfg "$1" >/dev/null 2>&1; }
# TLC exits nonzero on a violation; the callers read its output instead.
tlc() { "$JAVA" -XX:+UseParallelGC -cp "$TLA2TOOLS" tlc2.TLC -workers auto -config "$1" "$2" 2>&1 || true; }

failed=0

# 1. The committed translation must match its PlusCal.
cp VersionLock.tla committed.tla
translate VersionLock.tla
if ! diff -q committed.tla VersionLock.tla >/dev/null; then
  echo "FAIL  translation is stale: re-run pcal.trans on model/VersionLock.tla and commit it"
  failed=1
fi

# 2. The real model must pass.
out=$(tlc VersionLock.cfg VersionLock.tla)
if echo "$out" | grep -q "No error has been found"; then
  echo "PASS  model: $(echo "$out" | grep -o '[0-9]* distinct states found')"
else
  echo "FAIL  model:"; echo "$out" | grep -E 'violated|Error' | head -5
  echo "      Replay the trace against version-lock.ts before calling it a bug (see SKILL.md)."
  failed=1
fi

# 3. Each break must be caught.
expect_violation() {
  name=$1; cfg=$2; tla=$3
  out=$(tlc "$cfg" "$tla")
  if echo "$out" | grep -q "is violated"; then
    echo "PASS  break caught: $name ($(echo "$out" | grep -o 'Invariant [A-Za-z]* is violated'))"
  else
    echo "FAIL  break NOT caught: $name — the model has lost the ability to fail"
    failed=1
  fi
}

expect_violation "empty lock judged corrupt at once (pre-#697)" NoGrace.cfg VersionLock.tla

sed -e 's/MODULE VersionLock/MODULE NoRecheck/' \
    -e 's/  if recheckG = 0 \\\/ judgedG = 0 \\\/ recheckG \/= judgedG \\\/ Content(lock) \/= judgedC then/  if FALSE then/' \
    VersionLock.tla > NoRecheck.tla
grep -q '  if FALSE then' NoRecheck.tla || { echo "FAIL  could not build NoRecheck break"; failed=1; }
translate NoRecheck.tla
expect_violation "identity recheck removed" VersionLock.cfg NoRecheck.tla

sed -e 's/MODULE VersionLock/MODULE NoClaimGrace/' \
    -e 's/      if ~(PastGrace(claim) \/\\ (claim.kind = "none" \\\/ b)) then goto Fail; end if;/      skip;/' \
    VersionLock.tla > NoClaimGrace.tla
grep -q '      skip;' NoClaimGrace.tla || { echo "FAIL  could not build NoClaimGrace break"; failed=1; }
translate NoClaimGrace.tla
expect_violation "empty claim treated as abandoned" VersionLock.cfg NoClaimGrace.tla

exit $failed
