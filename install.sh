#!/usr/bin/env bash
# Kunai installer — binary-first, channel-aware, cross-platform.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
#   ./install.sh [--method binary|npm|bun|source] [--version X.Y.Z]
#                [--upgrade] [--uninstall] [--yes] [--dry-run]
#
# The default method downloads a self-contained binary (no Bun/Node required).
# npm/bun/source remain available for developers and Bun users.
set -euo pipefail

KUNAI_REPO="${KUNAI_REPO:-https://github.com/KitsuneKode/kunai.git}"
KUNAI_PACKAGE="${KUNAI_PACKAGE:-@kitsunekode/kunai}"
KUNAI_DL_BASE="${KUNAI_DL_BASE:-https://github.com/KitsuneKode/kunai/releases}"
BIN_DIR="${KUNAI_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${KUNAI_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kunai}"
INSTALL_DIR="${KUNAI_INSTALL_DIR:-$HOME/.local/share/kunai}"

METHOD="binary"
VERSION="latest"
DRY=0
YES=0
ACTION="install"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '→ %s\n' "$*"; }
warn() { printf '! \033[33m%s\033[0m\n' "$*"; }
err() { printf '✗ %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# Prompt the user via the controlling terminal, so it still works under
# `curl … | bash` (where stdin is the script pipe, not the keyboard).
ask() {
  local question="$1" default="${2:-y}" reply
  if [[ "$YES" == 1 || ! -r /dev/tty ]]; then
    [[ "$default" == y ]]
    return
  fi
  read -r -p "$question [$default] " reply </dev/tty || true
  reply="${reply:-$default}"
  [[ "$reply" =~ ^([yY]|[yY][eE][sS])$ ]]
}

run() {
  if [[ "$DRY" == 1 ]]; then
    printf '→ [dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

require() { have "$1" || {
  err "$1 is required for this step. Install it or choose another --method."
  exit 1
}; }

detect_os() {
  case "$(uname -s)" in
    Linux) echo linux ;;
    Darwin) echo darwin ;;
    *) echo unknown ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo x64 ;;
    aarch64 | arm64) echo arm64 ;;
    *) echo unknown ;;
  esac
}

sha256_of() {
  if have sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

write_manifest() {
  local channel="$1" version="$2" binpath="$3"
  if [[ "$DRY" == 1 ]]; then
    info "[dry-run] would write manifest ($channel) to $CONFIG_DIR/install.json"
    return
  fi
  mkdir -p "$CONFIG_DIR"
  cat >"$CONFIG_DIR/install.json" <<JSON
{
  "channel": "$channel",
  "version": "$version",
  "binPath": "$binpath",
  "dlBase": "$KUNAI_DL_BASE",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  info "Recorded install method ($channel) in $CONFIG_DIR/install.json"
}

path_hint() {
  local dir="$1"
  case ":$PATH:" in
    *":$dir:"*) info "kunai is on PATH ($dir)." ;;
    *) warn "Add to PATH: export PATH=\"$dir:\$PATH\"" ;;
  esac
}

install_binary() {
  local os arch asset base url sums tmp want got
  os="$(detect_os)"
  arch="$(detect_arch)"
  if [[ "$os" == unknown || "$arch" == unknown ]]; then
    err "No prebuilt binary for this OS/arch. Try --method npm or --method source."
    exit 1
  fi
  asset="kunai-${os}-${arch}"

  if [[ "$VERSION" == latest ]]; then
    base="$KUNAI_DL_BASE/latest/download"
  else
    base="$KUNAI_DL_BASE/download/v$VERSION"
  fi
  url="$base/$asset"
  sums="$base/SHA256SUMS"

  require curl
  mkdir -p "$BIN_DIR"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  info "Downloading $asset ..."
  run curl -fsSL "$url" -o "$tmp/$asset"
  run curl -fsSL "$sums" -o "$tmp/SHA256SUMS"

  if [[ "$DRY" != 1 ]]; then
    want="$(awk -v a="$asset" '$2==a {print $1}' "$tmp/SHA256SUMS")"
    got="$(sha256_of "$tmp/$asset")"
    if [[ -z "$want" || "$want" != "$got" ]]; then
      err "Checksum mismatch for $asset (expected ${want:-<none>}, got $got)."
      exit 1
    fi
    install -m 0755 "$tmp/$asset" "$BIN_DIR/kunai"
    if [[ "$os" == darwin ]]; then
      xattr -d com.apple.quarantine "$BIN_DIR/kunai" 2>/dev/null || true
    fi
  fi

  write_manifest binary "$VERSION" "$BIN_DIR/kunai"
  info "Installed kunai → $BIN_DIR/kunai"
  path_hint "$BIN_DIR"
}

ensure_bun() {
  if have bun; then
    info "bun found: $(command -v bun)"
    return
  fi
  if ask "Bun is required for this method. Install it from bun.sh now?" y; then
    run bash -c 'curl -fsSL https://bun.sh/install | bash'
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    have bun || {
      err "Bun installed but not on PATH. Open a new shell and re-run."
      exit 1
    }
  else
    err "Bun is required for --method $METHOD."
    exit 1
  fi
}

install_npm() {
  require npm
  ensure_bun
  info "Installing $KUNAI_PACKAGE with npm..."
  run npm install -g "$KUNAI_PACKAGE"
  write_manifest npm-global "$VERSION" "$(command -v kunai || echo kunai)"
  have kunai && path_hint "$(dirname "$(command -v kunai)")"
}

install_bun() {
  ensure_bun
  info "Installing $KUNAI_PACKAGE with bun..."
  run bun install -g "$KUNAI_PACKAGE"
  write_manifest bun-global "$VERSION" "$(command -v kunai || echo kunai)"
  have kunai && path_hint "$(dirname "$(command -v kunai)")"
}

install_source() {
  require git
  ensure_bun
  info "Cloning Kunai into $INSTALL_DIR..."
  run mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    run git -C "$INSTALL_DIR" pull --ff-only
  else
    run rm -rf "$INSTALL_DIR"
    run git clone --depth 1 "$KUNAI_REPO" "$INSTALL_DIR"
  fi
  if [[ "$DRY" == 1 ]]; then
    info "[dry-run] would run in $INSTALL_DIR: bun install && bun run build && bun run link:global"
  else
    (cd "$INSTALL_DIR" && bun install && bun run build && bun run link:global)
  fi
  write_manifest source "$VERSION" "$(command -v kunai || echo kunai)"
}

install_optional_deps() {
  local pkgs=()
  ask "Install mpv (required for playback)?" y && pkgs+=(mpv)
  ask "Install yt-dlp (offline downloads)?" n && pkgs+=(yt-dlp)
  ask "Install chafa (terminal poster previews)?" n && pkgs+=(chafa)
  ((${#pkgs[@]} == 0)) && return

  if have brew; then
    run brew install "${pkgs[@]}"
  elif have pacman; then
    run sudo pacman -S --needed --noconfirm "${pkgs[@]}"
  elif have apt-get; then
    run sudo apt-get update
    run sudo apt-get install -y "${pkgs[@]}"
  elif have dnf; then
    run sudo dnf install -y "${pkgs[@]}"
  else
    warn "No supported package manager found. Install manually: ${pkgs[*]}"
  fi
}

do_upgrade() {
  if have kunai; then
    exec kunai upgrade
  fi
  err "kunai is not installed yet. Run the installer first."
  exit 1
}

do_uninstall() {
  if have kunai; then
    exec kunai --uninstall
  fi
  rm -f "$BIN_DIR/kunai" && info "Removed $BIN_DIR/kunai"
  info "Config/data left in place: $CONFIG_DIR"
}

usage() {
  sed -n '2,9p' "$0" | sed 's/^#\s\{0,1\}//'
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --method)
        METHOD="${2:-}"
        shift 2
        ;;
      --version)
        VERSION="${2:-}"
        shift 2
        ;;
      --upgrade)
        ACTION="upgrade"
        shift
        ;;
      --uninstall)
        ACTION="uninstall"
        shift
        ;;
      --yes)
        YES=1
        shift
        ;;
      --dry-run)
        DRY=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        err "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done

  case "$ACTION" in
    upgrade) do_upgrade ;;
    uninstall) do_uninstall ;;
  esac

  bold "Kunai installer"
  [[ "$DRY" == 1 ]] && info "Dry run: no install commands will be executed."

  case "$METHOD" in
    binary) install_binary ;;
    npm) install_npm ;;
    bun) install_bun ;;
    source) install_source ;;
    *)
      err "Unknown method: $METHOD (use binary|npm|bun|source)"
      exit 1
      ;;
  esac

  install_optional_deps

  bold "Done."
  cat <<EOF
Try:
  kunai -S "Frieren" -a
  kunai --setup

Update any time:  kunai upgrade
Remove:           kunai --uninstall
EOF
}

main "$@"
