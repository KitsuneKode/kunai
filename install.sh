#!/usr/bin/env bash
# Kunai installer — binary-first, channel-aware, cross-platform.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
#   ./install.sh [--method binary|npm|bun|source] [--version X.Y.Z] [--yes] [--dry-run] [--skip-deps]
#
# Installs Kunai only. After install, use `kunai upgrade` and `kunai uninstall`
# for lifecycle — the install script does not remove or update an install.
#
# Native binary layout (keep in sync with apps/cli/src/services/update/native-installer/install-layout.ts):
#   {dataDir}/versions/{semver}/kunai     versioned binary
#   {binDir}/kunai                        launcher symlink -> versioned binary
#   {configDir}/install.json              channel manifest
set -euo pipefail

KUNAI_REPO="${KUNAI_REPO:-https://github.com/KitsuneKode/kunai.git}"
KUNAI_PACKAGE="${KUNAI_PACKAGE:-@kitsunekode/kunai}"
KUNAI_DL_BASE="${KUNAI_DL_BASE:-https://github.com/KitsuneKode/kunai/releases}"
KUNAI_RELEASES_API="${KUNAI_RELEASES_API:-https://api.github.com/repos/KitsuneKode/kunai/releases/latest}"
BIN_DIR="${KUNAI_BIN_DIR:-$HOME/.local/bin}"
SOURCE_DIR="${KUNAI_SOURCE_DIR:-${KUNAI_INSTALL_DIR:-$HOME/.local/src/kunai}}"

case "$(uname -s)" in
Darwin) HOST_OS="darwin" ;;
Linux) HOST_OS="linux" ;;
*) HOST_OS="unknown" ;;
esac

if [[ "$HOST_OS" == "darwin" ]]; then
	CONFIG_DIR="${KUNAI_CONFIG_DIR:-$HOME/Library/Application Support/kunai}"
	DATA_DIR="${KUNAI_DATA_DIR:-$HOME/Library/Application Support/kunai}"
	CACHE_DIR="${KUNAI_CACHE_DIR:-$HOME/Library/Caches/kunai}"
else
	CONFIG_DIR="${KUNAI_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kunai}"
	DATA_DIR="${KUNAI_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/kunai}"
	CACHE_DIR="${KUNAI_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/kunai}"
fi

METHOD="binary"
VERSION="latest"
DRY=0
YES=0
SKIP_DEPS=0

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

canonical_path() {
	local path="$1" component
	local -a suffix=()

	[[ "$path" == /* ]] || path="$PWD/$path"
	while [[ ! -d "$path" ]]; do
		suffix=("$(basename "$path")" "${suffix[@]}")
		path="$(dirname "$path")"
	done
	path="$(cd -P "$path" && pwd -P)" || return 1

	for component in "${suffix[@]}"; do
		case "$component" in
		"" | .) ;;
		..) path="$(dirname "$path")" ;;
		*) path="$path/$component" ;;
		esac
	done
	printf '%s\n' "$path"
}

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

resolve_published_version() {
	if [[ "$DRY" == 1 ]]; then
		if [[ "$VERSION" != latest ]]; then
			printf '%s\n' "$VERSION"
		else
			printf '%s\n' "dry-run"
		fi
		return
	fi
	if [[ "$VERSION" != latest ]]; then
		printf '%s\n' "$VERSION"
		return
	fi
	local tag
	tag="$(curl -fsSL -H "user-agent: kunai-installer" "$KUNAI_RELEASES_API" |
		sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
		head -1)"
	tag="${tag#v}"
	if [[ -z "$tag" ]]; then
		err "Could not resolve the latest release version. Try --version X.Y.Z or --method npm."
		exit 1
	fi
	printf '%s\n' "$tag"
}

download_failed_hint() {
	local asset="$1"
	err "Download failed for $asset."
	err "Try: --method npm | --method bun | --method source"
	err "Or pin a version: --version X.Y.Z"
	err "Override mirror: KUNAI_DL_BASE=https://github.com/KitsuneKode/kunai/releases"
}

sha256_of() {
	if have sha256sum; then
		sha256sum "$1" | awk '{print $1}'
	else
		shasum -a 256 "$1" | awk '{print $1}'
	fi
}

write_manifest() {
	local channel="$1" version="$2" binpath="$3" versionpath="${4:-}" layout="${5:-}"
	if [[ "$DRY" == 1 ]]; then
		info "[dry-run] would write manifest ($channel) to $CONFIG_DIR/install.json"
		return
	fi
	mkdir -p "$CONFIG_DIR"
	if [[ -n "$versionpath" && -n "$layout" ]]; then
		cat >"$CONFIG_DIR/install.json" <<JSON
{
  "channel": "$channel",
  "version": "$version",
  "binPath": "$binpath",
  "versionPath": "$versionpath",
  "dlBase": "$KUNAI_DL_BASE",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "layout": "$layout"
}
JSON
	else
		cat >"$CONFIG_DIR/install.json" <<JSON
{
  "channel": "$channel",
  "version": "$version",
  "binPath": "$binpath",
  "dlBase": "$KUNAI_DL_BASE",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
	fi
	info "Recorded install method ($channel) in $CONFIG_DIR/install.json"
}

detect_musl() {
	[[ "$(uname -s)" == Linux ]] || return 1
	if ldd --version 2>&1 | grep -qi musl; then return 0; fi
	if [[ -r /proc/self/maps ]] && grep -q musl /proc/self/maps 2>/dev/null; then return 0; fi
	return 1
}

path_hint() {
	local dir="$1"
	case ":$PATH:" in
	*":$dir:"*) info "kunai is on PATH ($dir)." ;;
	*) warn "Add to PATH: export PATH=\"$dir:\$PATH\"" ;;
	esac
}

install_binary() {
	local os arch asset base url sums tmp want got resolved_version version_path versions_dir
	os="$(detect_os)"
	arch="$(detect_arch)"
	if [[ "$os" == unknown || "$arch" == unknown ]]; then
		err "No prebuilt binary for this OS/arch ($(uname -s)/$(uname -m))."
		err "Supported: linux|darwin x x64|arm64. Try --method npm or --method source."
		exit 1
	fi
	if [[ "$os" == linux ]] && detect_musl; then
		asset="kunai-linux-${arch}-musl"
	else
		asset="kunai-${os}-${arch}"
	fi
	resolved_version="$(resolve_published_version)"

	if [[ "$VERSION" == latest ]]; then
		base="$KUNAI_DL_BASE/latest/download"
	else
		base="$KUNAI_DL_BASE/download/v$VERSION"
	fi
	url="$base/$asset"
	sums="$base/SHA256SUMS"

	versions_dir="$DATA_DIR/versions"
	version_path="$versions_dir/$resolved_version/kunai"

	if [[ "$DRY" == 1 ]]; then
		info "Downloading $asset (v$resolved_version) ..."
		info "[dry-run] curl -fsSL $url -o <temporary>/$asset"
		info "[dry-run] curl -fsSL $sums -o <temporary>/SHA256SUMS"
		write_manifest binary "$resolved_version" "$BIN_DIR/kunai" "$version_path" "versioned"
		info "Installed kunai → $BIN_DIR/kunai (v$resolved_version at $version_path)"
		path_hint "$BIN_DIR"
		return
	fi

	require curl
	mkdir -p "$BIN_DIR"
	tmp="$(mktemp -d)"
	trap '[[ -n "${tmp:-}" ]] && rm -rf "$tmp"' RETURN

	info "Downloading $asset (v$resolved_version) ..."
	if ! curl -fsSL "$url" -o "$tmp/$asset"; then
		download_failed_hint "$asset"
		exit 1
	fi
	if ! curl -fsSL "$sums" -o "$tmp/SHA256SUMS"; then
		download_failed_hint "SHA256SUMS"
		exit 1
	fi

	if [[ ! -s "$tmp/$asset" ]]; then
		err "Downloaded asset $asset is empty; the release is incomplete."
		download_failed_hint "$asset"
		exit 1
	fi

	want="$(awk -v a="$asset" '$2==a {print $1}' "$tmp/SHA256SUMS")"
	got="$(sha256_of "$tmp/$asset")"

	if [[ -z "$want" ]]; then
		err "SHA256SUMS has no entry for $asset; the release is incomplete."
		download_failed_hint "$asset"
		exit 1
	fi

	if [[ "$want" != "$got" ]]; then
		err "Checksum mismatch for $asset (expected $want, got $got)."
		exit 1
	fi

	mkdir -p "$(dirname "$version_path")"
	install -m 0755 "$tmp/$asset" "$version_path"
	ln -sfn "$version_path" "$BIN_DIR/kunai"
	if [[ "$os" == darwin ]]; then
		xattr -d com.apple.quarantine "$version_path" 2>/dev/null || true
		info "Cleared macOS quarantine when present (Gatekeeper may still prompt on first launch)."
	fi

	write_manifest binary "$resolved_version" "$BIN_DIR/kunai" "$version_path" "versioned"
	info "Installed kunai → $BIN_DIR/kunai (v$resolved_version at $version_path)"
	report_path_winner
	path_hint "$BIN_DIR"
}

# Every kunai on PATH, in lookup order. `command -v` reports only the winner,
# which is precisely what hides this problem: a stale shim earlier in PATH
# shadows the build we just installed.
list_path_kunai() {
	local dir
	while IFS= read -r -d ':' dir || [[ -n "$dir" ]]; do
		[[ -n "$dir" && -x "$dir/kunai" ]] && printf '%s\n' "$dir/kunai"
	done <<<"$PATH:"
}

# A native install leaves any older npm/bun global install in place, and those
# usually sit earlier in PATH — so `kunai` would keep running the old build
# while the installer claims success.
#
# We report this rather than removing it. Another package manager's global tree
# is that package manager's to own: uninstalling behind its back desyncs its
# bookkeeping, and silently deleting software a user installed deliberately is
# a surprise no installer should spring. Naming the conflict and the exact
# remediation leaves them in control.
report_path_winner() {
	local launcher="$BIN_DIR/kunai" found others=() entry winner
	[[ "$DRY" == 1 ]] && return 0

	winner="$(command -v kunai 2>/dev/null || true)"
	info "PATH winner: $winner"
	[[ "$winner" == "$launcher" ]] && return 0

	while IFS= read -r found; do
		[[ "$found" == "$launcher" ]] && continue
		others+=("$found")
	done < <(list_path_kunai)

	[[ "${#others[@]}" -eq 0 ]] && return 0

	printf '\n'
	warn "Another kunai comes earlier on your PATH and will keep running instead:"
	for entry in "${others[@]}"; do
		printf '    %s\n' "$entry"
	done
	printf '\n'
	warn "This install is at $launcher, but 'kunai' currently resolves to $winner."
	printf '  Fix it either way:\n'
	if [[ "$winner" == *node_modules* || "$winner" == *npm* ]]; then
		printf '    npm uninstall -g %s      # remove the old npm install\n' "$KUNAI_PACKAGE"
	fi
	if [[ "$winner" == *".bun"* ]]; then
		printf '    bun remove --global %s   # remove the old bun install\n' "$KUNAI_PACKAGE"
	fi
	printf '    # …or put %s earlier in your PATH\n' "$BIN_DIR"
	printf '\n'
	printf '  Then open a new shell and confirm with: command -v kunai\n'
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
	local source_path data_path config_path cache_path
	source_path="$(canonical_path "$SOURCE_DIR")" || {
		err "Unable to resolve source checkout path: $SOURCE_DIR"
		exit 1
	}
	data_path="$(canonical_path "$DATA_DIR")" || exit 1
	config_path="$(canonical_path "$CONFIG_DIR")" || exit 1
	cache_path="$(canonical_path "$CACHE_DIR")" || exit 1
	if [[ "$source_path" == "$data_path" || "$source_path" == "$config_path" || "$source_path" == "$cache_path" ]]; then
		err "Source checkout path must not equal Kunai data, config, or cache paths."
		exit 1
	fi

	require git
	ensure_bun
	info "Cloning Kunai into $SOURCE_DIR..."

	if [[ -d "$SOURCE_DIR/.git" ]]; then
		run git -C "$SOURCE_DIR" pull --ff-only
	elif [[ -e "$SOURCE_DIR" ]]; then
		err "Refusing to replace existing non-checkout path: $SOURCE_DIR"
		exit 1
	else
		run mkdir -p "$(dirname "$SOURCE_DIR")"
		run git clone --depth 1 "$KUNAI_REPO" "$SOURCE_DIR"
	fi
	if [[ "$DRY" == 1 ]]; then
		info "[dry-run] would run in $SOURCE_DIR: bun install && bun run build && bun run link:global"
	else
		(cd "$SOURCE_DIR" && bun install && bun run build && bun run link:global)
	fi
	write_manifest source "$VERSION" "$(command -v kunai || echo kunai)"
}

install_optional_deps() {
	[[ "$SKIP_DEPS" == 1 || "$DRY" == 1 ]] && return
	local pkgs=()
	ask "Install mpv (required for playback)?" y && pkgs+=(mpv)
	ask "Install yt-dlp (YouTube playback and downloads)?" y && pkgs+=(yt-dlp)
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
		--yes)
			YES=1
			shift
			;;
		--dry-run)
			DRY=1
			shift
			;;
		--skip-deps)
			SKIP_DEPS=1
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
Remove:           kunai uninstall
EOF
}

main "$@"
