#!/usr/bin/env bash
set -uo pipefail

failures=0
pass() { printf '  PASS %s\n' "$1"; }
fail() { printf '  FAIL %s\n       %s\n' "$1" "${2:-}"; failures=$((failures + 1)); }

assert_runtime_alias_rejected() {
  local name="$1" candidate="$2" install_log
  export KUNAI_SOURCE_DIR="$candidate"
  if install_log="$(/harness/install.sh --method source --version 0.3.0 --yes --skip-deps 2>&1)"; then
    fail "$name source install accepted runtime alias" "$candidate"
  elif grep -q "Source checkout path must not equal Kunai data, config, or cache paths." <<<"$install_log"; then
    pass "$name source alias rejected by runtime path guard"
  else
    fail "$name source alias bypassed runtime path guard" "$install_log"
  fi
  [[ -f "$seed" && "$(cat "$seed")" == "preserve-me" ]] \
    && pass "$name alias preserved seeded runtime data" \
    || fail "$name alias changed seeded runtime data" "$seed"
}

export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export KUNAI_SOURCE_DIR="$HOME/.local/src/kunai"
export KUNAI_CONFIG_DIR="$XDG_CONFIG_HOME/kunai"

data_dir="$XDG_DATA_HOME/kunai"
cache_dir="$XDG_CACHE_HOME/kunai"
source_dir="$KUNAI_SOURCE_DIR"
seed="$data_dir/seeded-history.txt"
lexical_data_alias="$data_dir/."
symlink_data_alias="$HOME/kunai-runtime-data-link"
shim_dir="$HOME/test-bin"
mkdir -p "$data_dir" "$shim_dir"
printf 'preserve-me\n' >"$seed"

cat >"$shim_dir/git" <<'SHIM'
#!/bin/sh
target=""
for argument in "$@"; do target="$argument"; done
if [ "$1" = "clone" ]; then
  mkdir -p "$target/.git"
  printf 'source checkout\n' >"$target/README.fixture"
  exit 0
fi
[ "$1" = "-C" ] && exit 0
exit 1
SHIM
chmod 0755 "$shim_dir/git"
printf '#!/bin/sh\nexit 0\n' >"$shim_dir/bun"
chmod 0755 "$shim_dir/bun"
export PATH="$shim_dir:$PATH"

/harness/install.sh --method source --version 0.3.0 --yes --skip-deps

[[ -f "$seed" && "$(cat "$seed")" == "preserve-me" ]] \
  && pass "seeded runtime data survived" \
  || fail "source install deleted runtime data" "$seed"
[[ -d "$source_dir/.git" ]] \
  && pass "source checkout used KUNAI_SOURCE_DIR" \
  || fail "source checkout missing" "$source_dir"
[[ "$source_dir" != "$data_dir" ]] \
  && pass "source and data paths differ" \
  || fail "source and data paths overlap" "$source_dir"

export KUNAI_SOURCE_DIR="$cache_dir"
if /harness/install.sh --method source --version 0.3.0 --yes --skip-deps; then
  fail "source install accepted cache path" "$cache_dir"
else
  pass "source install rejected cache path"
fi
[[ ! -e "$cache_dir" ]] \
  && pass "source install did not create checkout in cache" \
  || fail "source install created checkout in cache" "$cache_dir"

assert_runtime_alias_rejected "lexical data" "$lexical_data_alias"
ln -s "$data_dir" "$symlink_data_alias"
assert_runtime_alias_rejected "symlinked data" "$symlink_data_alias"

(( failures == 0 ))
