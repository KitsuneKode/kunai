#!/usr/bin/env bash
# Kunai interactive installer — curl-friendly, platform-aware, non-npm-only.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
#   ./install.sh
#   ./install.sh --dry-run
set -euo pipefail

KUNAI_REPO="${KUNAI_REPO:-https://github.com/KitsuneKode/kunai.git}"
KUNAI_REF="${KUNAI_REF:-main}"
KUNAI_PACKAGE="${KUNAI_PACKAGE:-@kitsunekode/kunai}"
INSTALL_DIR="${KUNAI_INSTALL_DIR:-$HOME/.local/share/kunai}"
BIN_DIR="${KUNAI_BIN_DIR:-$HOME/.local/bin}"
KUNAI_DRY_RUN="${KUNAI_DRY_RUN:-0}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '→ %s\n' "$*"; }
warn() { printf '!\033[33m %s\033[0m\n' "$*"; }
err() { printf '✗ %s\n' "$*" >&2; }

have() { command -v "$1" >/dev/null 2>&1; }

require_tool() {
  local name="$1"
  local message="$2"
  if [[ "$KUNAI_DRY_RUN" == "1" ]]; then
    return 0
  fi
  have "$name" || {
    err "$message"
    exit 1
  }
}

usage() {
  cat <<'EOF'
Kunai installer

Usage:
  ./install.sh [--dry-run]

Environment:
  KUNAI_INSTALL_METHOD=npm-global|bun-global|source
  KUNAI_NONINTERACTIVE=1
  KUNAI_DRY_RUN=1
  KUNAI_REF=main
EOF
}

run_cmd() {
  if [[ "$KUNAI_DRY_RUN" == "1" ]]; then
    printf '→ [dry-run] %q' "$1"
    shift
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

detect_os() {
  case "$(uname -s)" in
    Linux) echo linux ;;
    Darwin) echo macos ;;
    *) echo unknown ;;
  esac
}

detect_pm() {
  if have brew; then echo brew; return; fi
  if have pacman; then echo pacman; return; fi
  if have apt-get; then echo apt; return; fi
  if have dnf; then echo dnf; return; fi
  echo none
}

prompt_yes_no() {
  local question="$1"
  local default="${2:-y}"
  local reply
  if [[ "${KUNAI_NONINTERACTIVE:-}" == "1" ]]; then
    [[ "$default" == "y" ]]
    return
  fi
  read -r -p "$question [$default] " reply || true
  reply="${reply:-$default}"
  case "$reply" in
    y | Y | yes | Yes) return 0 ;;
    *) return 1 ;;
  esac
}

choose_install_method() {
  if [[ -n "${KUNAI_INSTALL_METHOD:-}" ]]; then
    echo "$KUNAI_INSTALL_METHOD"
    return
  fi
  if [[ "${KUNAI_NONINTERACTIVE:-}" == "1" ]]; then
    echo npm-global
    return
  fi
  bold "How should Kunai be installed?" >&2
  echo "  1) npm global (recommended when Node is available)" >&2
  echo "  2) bun global (fast when Bun is available)" >&2
  echo "  3) source checkout (developer / latest main)" >&2
  local choice="1"
  read -r -p "Choice [1]: " choice || true
  choice="${choice:-1}"
  case "$choice" in
    2) echo bun-global ;;
    3) echo source ;;
    *) echo npm-global ;;
  esac
}

install_kunai_package() {
  local method="$1"
  case "$method" in
    npm-global)
      require_tool npm "npm not found. Install Node.js or choose another method."
      info "Installing $KUNAI_PACKAGE with npm..."
      run_cmd npm install -g "$KUNAI_PACKAGE"
      ;;
    bun-global)
      require_tool bun "bun not found. Install Bun from https://bun.sh or choose npm/source."
      info "Installing $KUNAI_PACKAGE with bun..."
      run_cmd bun install -g "$KUNAI_PACKAGE"
      ;;
    source)
      require_tool git "git is required for source installs."
      require_tool bun "bun is required for source installs."
      info "Cloning Kunai into $INSTALL_DIR..."
      run_cmd mkdir -p "$(dirname "$INSTALL_DIR")"
      if [[ -d "$INSTALL_DIR/.git" ]]; then
        run_cmd git -C "$INSTALL_DIR" fetch --depth 1 origin "$KUNAI_REF"
        run_cmd git -C "$INSTALL_DIR" checkout "$KUNAI_REF"
        run_cmd git -C "$INSTALL_DIR" pull --ff-only origin "$KUNAI_REF" || true
      else
        run_cmd rm -rf "$INSTALL_DIR"
        run_cmd git clone --depth 1 --branch "$KUNAI_REF" "$KUNAI_REPO" "$INSTALL_DIR"
      fi
      info "Installing dependencies and linking global kunai..."
      if [[ "$KUNAI_DRY_RUN" == "1" ]]; then
        info "[dry-run] would run in $INSTALL_DIR: bun install"
        info "[dry-run] would run in $INSTALL_DIR: bun run link:global"
      else
        (
          cd "$INSTALL_DIR"
          bun install
          bun run link:global
        )
      fi
      ;;
    *)
      err "Unknown install method: $method"
      exit 1
      ;;
  esac
}

install_optional_deps() {
  local pm="$1"
  local packages=()
  prompt_yes_no "Install mpv (required for playback)?" y && packages+=(mpv)
  prompt_yes_no "Install yt-dlp (offline downloads)?" n && packages+=(yt-dlp)
  prompt_yes_no "Install chafa (terminal poster previews)?" n && packages+=(chafa)

  if ((${#packages[@]} == 0)); then
    return
  fi

  case "$pm" in
    pacman)
      info "Installing ${packages[*]} with pacman..."
      run_cmd sudo pacman -S --needed --noconfirm "${packages[@]}"
      ;;
    apt)
      info "Installing ${packages[*]} with apt..."
      run_cmd sudo apt-get update
      run_cmd sudo apt-get install -y "${packages[@]}"
      ;;
    brew)
      info "Installing ${packages[*]} with brew..."
      run_cmd brew install "${packages[@]}"
      ;;
    dnf)
      info "Installing ${packages[*]} with dnf..."
      run_cmd sudo dnf install -y "${packages[@]}"
      ;;
    none)
      warn "No supported package manager found. Install manually: ${packages[*]}"
      ;;
  esac
}

configure_discord_presence() {
  if ! prompt_yes_no "Enable Discord Rich Presence tips in docs output?" n; then
    return
  fi
  cat <<'EOF'

Discord Rich Presence setup:
  1. Install and run Discord desktop.
  2. In Kunai run /presence and set provider to Discord.
  3. Inspect optional local links:
       kunai --install-protocol-handler
  4. Playback cards can include a catalog button such as:
       • View episode on TMDB
       • View on AniList / IMDb / TMDB

EOF
}

ensure_path_hint() {
  if have kunai; then
    info "kunai is on PATH: $(command -v kunai)"
    kunai --version 2>/dev/null || true
    return
  fi
  warn "kunai is not on PATH yet."
  echo "Add this to your shell profile if needed:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
}

main() {
  for arg in "$@"; do
    case "$arg" in
      --dry-run)
        KUNAI_DRY_RUN=1
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        err "Unknown option: $arg"
        usage
        exit 1
        ;;
    esac
  done

  bold "Kunai installer"
  if [[ "$KUNAI_DRY_RUN" == "1" ]]; then
    info "Dry run enabled; no install commands will be executed."
  fi

  local os
  os="$(detect_os)"
  if [[ "$os" == unknown ]]; then
    err "Unsupported OS. Use npm install -g $KUNAI_PACKAGE instead."
    exit 1
  fi
  info "Detected OS: $os"

  local method
  method="$(choose_install_method)"
  install_kunai_package "$method"

  local pm
  pm="$(detect_pm)"
  if [[ "$os" != unknown ]]; then
    install_optional_deps "$pm"
  fi

  configure_discord_presence
  ensure_path_hint

  bold "Done."
  cat <<EOF
Try:
  kunai -S "Frieren" -a
  kunai --setup

Install script (re-run anytime):
  curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
EOF
}

main "$@"
