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
#   {dataDir}/versions/{semver}/version.json  per-version metadata
#   {dataDir}/locks/{semver}.lock         install lock
#   {dataDir}/transactions/{id}.json     install transaction
#   {cacheDir}/staging/{semver}/txn-…    unique download staging
#   {binDir}/kunai                       launcher symlink -> versioned binary
#   {configDir}/install.json             schema-1 ownership manifest
set -euo pipefail

KUNAI_REPO="${KUNAI_REPO:-https://github.com/KitsuneKode/kunai.git}"
KUNAI_PACKAGE="${KUNAI_PACKAGE:-@kitsunekode/kunai}"
KUNAI_DL_BASE="${KUNAI_DL_BASE:-https://github.com/KitsuneKode/kunai/releases}"
KUNAI_RELEASES_API="${KUNAI_RELEASES_API:-https://api.github.com/repos/KitsuneKode/kunai/releases/latest}"
BIN_DIR="${KUNAI_BIN_DIR:-$HOME/.local/bin}"
SOURCE_DIR="${KUNAI_SOURCE_DIR:-${KUNAI_INSTALL_DIR:-$HOME/.local/src/kunai}}"

# Bounded download policy (mirrors DEFAULT_BINARY_DOWNLOAD_POLICY).
DOWNLOAD_CONNECT_TIMEOUT="${KUNAI_DOWNLOAD_CONNECT_TIMEOUT:-15}"
DOWNLOAD_TOTAL_SECONDS="${KUNAI_DOWNLOAD_TOTAL_SECONDS:-300}"
DOWNLOAD_SPEED_TIME="${KUNAI_DOWNLOAD_SPEED_TIME:-30}"
DOWNLOAD_SPEED_LIMIT="${KUNAI_DOWNLOAD_SPEED_LIMIT:-1}"
DOWNLOAD_MAX_BYTES="${KUNAI_DOWNLOAD_MAX_BYTES:-268435456}"
DOWNLOAD_CHECKSUM_MAX_BYTES="${KUNAI_DOWNLOAD_CHECKSUM_MAX_BYTES:-1048576}"
DOWNLOAD_MAX_ATTEMPTS="${KUNAI_DOWNLOAD_MAX_ATTEMPTS:-3}"
DOWNLOAD_RETRY_BASE_MS="${KUNAI_DOWNLOAD_RETRY_BASE_MS:-1000}"

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

# Strict stable major.minor.patch — matches parseCanonicalVersion in version.ts.
parse_canonical_version() {
	local value="$1"
	[[ "$value" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || return 1
	printf '%s\n' "$value"
}

# Strip optional leading v/V then require canonical form.
normalize_requested_version() {
	local value="${1#"${1%%[![:space:]]*}"}"
	value="${value%"${value##*[![:space:]]}"}"
	value="${value#v}"
	value="${value#V}"
	parse_canonical_version "$value"
}

iso_now() {
	date -u +%Y-%m-%dT%H:%M:%SZ
}

json_escape() {
	local s="$1"
	s="${s//\\/\\\\}"
	s="${s//\"/\\\"}"
	s="${s//$'\n'/\\n}"
	s="${s//$'\r'/\\r}"
	s="${s//$'\t'/\\t}"
	printf '%s' "$s"
}

resolve_published_version() {
	if [[ "$DRY" == 1 ]]; then
		if [[ "$VERSION" != latest ]]; then
			normalize_requested_version "$VERSION" || {
				err "Invalid version: $VERSION (expected exact major.minor.patch)."
				exit 1
			}
		else
			printf '%s\n' "dry-run"
		fi
		return
	fi
	if [[ "$VERSION" != latest ]]; then
		normalize_requested_version "$VERSION" || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
		return
	fi
	local tag canonical
	tag="$(curl -fsSL -H "user-agent: kunai-installer" "$KUNAI_RELEASES_API" |
		sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
		head -1)"
	canonical="$(normalize_requested_version "$tag" 2>/dev/null)" || {
		err "Could not resolve a stable latest release version from '$tag'."
		err "Try --version X.Y.Z or --method npm."
		exit 1
	}
	printf '%s\n' "$canonical"
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

is_retryable_http_status() {
	local status="$1"
	[[ "$status" == 408 || "$status" == 429 || "$status" -ge 500 ]]
}

# Bounded curl download with retries for transient HTTP errors.
# Uses --connect-timeout, remaining --max-time, --speed-time/--speed-limit, --max-filesize.
bounded_download() {
	local url="$1" dest="$2" max_bytes="$3" label="${4:-download}"
	local attempt=1 code remaining started elapsed delay_ms
	started="$(date +%s)"

	while [[ "$attempt" -le "$DOWNLOAD_MAX_ATTEMPTS" ]]; do
		elapsed=$(($(date +%s) - started))
		remaining=$((DOWNLOAD_TOTAL_SECONDS - elapsed))
		if [[ "$remaining" -le 0 ]]; then
			err "Download total deadline exceeded."
			return 1
		fi
		rm -f "$dest"
		code="$(
			curl -sS -L \
				--connect-timeout "$DOWNLOAD_CONNECT_TIMEOUT" \
				--max-time "$remaining" \
				--speed-time "$DOWNLOAD_SPEED_TIME" \
				--speed-limit "$DOWNLOAD_SPEED_LIMIT" \
				--max-filesize "$max_bytes" \
				-A "kunai-installer" \
				-o "$dest" \
				-w "%{http_code}" \
				"$url" || true
		)"
		# curl may leave empty/partial on failure; treat 2xx with non-empty as success.
		if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
			if [[ -s "$dest" ]]; then
				return 0
			fi
			err "Downloaded asset $label is empty; the release is incomplete."
			rm -f "$dest"
			return 1
		fi
		if [[ "$code" == "000" ]]; then
			# Transport / stall / size / timeout — retry if attempts remain.
			if [[ "$attempt" -ge "$DOWNLOAD_MAX_ATTEMPTS" ]]; then
				err "Download failed for $label (network, stall, size limit, or timeout)."
				rm -f "$dest"
				return 1
			fi
		elif is_retryable_http_status "$code"; then
			if [[ "$attempt" -ge "$DOWNLOAD_MAX_ATTEMPTS" ]]; then
				err "Download failed for $label with HTTP $code after $attempt attempts."
				rm -f "$dest"
				return 1
			fi
		else
			err "Download failed for $label with HTTP $code."
			rm -f "$dest"
			return 1
		fi
		delay_ms=$((DOWNLOAD_RETRY_BASE_MS * attempt))
		info "Retrying $label (attempt $((attempt + 1))/$DOWNLOAD_MAX_ATTEMPTS) after HTTP ${code:-error}..."
		# Portable sleep for fractional seconds when possible.
		if have python3; then
			python3 -c "import time; time.sleep(${delay_ms}/1000.0)" 2>/dev/null || sleep 1
		else
			sleep 1
		fi
		attempt=$((attempt + 1))
	done
	rm -f "$dest"
	return 1
}

write_manifest() {
	local method="$1" version="$2" launcher="$3" versionpath="${4:-}" target="${5:-}" sha256="${6:-}"
	local previous="${7:-}" now installed_at managed_json tmp manifest_path
	if [[ "$DRY" == 1 ]]; then
		info "[dry-run] would write schema-1 manifest ($method) to $CONFIG_DIR/install.json"
		return
	fi
	mkdir -p "$CONFIG_DIR"
	manifest_path="$CONFIG_DIR/install.json"
	now="$(iso_now)"
	installed_at="$now"
	if [[ -f "$manifest_path" ]]; then
		installed_at="$(
			sed -n 's/.*"installedAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_path" | head -1
		)"
		[[ -n "$installed_at" ]] || installed_at="$now"
	fi

	if [[ "$method" == "binary" ]]; then
		managed_json="$(printf '[\n    "%s",\n    "%s"\n  ]' "$(json_escape "$DATA_DIR")" "$(json_escape "$CACHE_DIR")")"
	else
		managed_json='[]'
	fi

	tmp="${manifest_path}.tmp-$$"
	{
		printf '{\n'
		printf '  "schemaVersion": 1,\n'
		printf '  "method": "%s",\n' "$(json_escape "$method")"
		printf '  "activeVersion": "%s",\n' "$(json_escape "$version")"
		printf '  "preferredChannel": "stable",\n'
		printf '  "launcherPath": "%s",\n' "$(json_escape "$launcher")"
		if [[ -n "$versionpath" ]]; then
			printf '  "versionedPath": "%s",\n' "$(json_escape "$versionpath")"
		fi
		if [[ -n "$previous" ]]; then
			printf '  "previousVersion": "%s",\n' "$(json_escape "$previous")"
		fi
		printf '  "managedPaths": %s,\n' "$managed_json"
		if [[ -n "$target" ]]; then
			printf '  "target": "%s",\n' "$(json_escape "$target")"
		fi
		if [[ -n "$sha256" ]]; then
			printf '  "artifactSha256": "%s",\n' "$(json_escape "$sha256")"
		fi
		printf '  "downloadBaseUrl": "%s",\n' "$(json_escape "$KUNAI_DL_BASE")"
		printf '  "installedAt": "%s",\n' "$(json_escape "$installed_at")"
		printf '  "updatedAt": "%s"\n' "$(json_escape "$now")"
		printf '}\n'
	} >"$tmp"
	mv -f "$tmp" "$manifest_path"
	info "Recorded install method ($method) in $manifest_path"
}

write_version_metadata() {
	local version="$1" target="$2" artifact="$3" sha256="$4" size="$5" source_url="$6" path="$7"
	local tmp
	tmp="${path}.tmp-$$"
	cat >"$tmp" <<JSON
{
  "schemaVersion": 1,
  "version": "$(json_escape "$version")",
  "target": "$(json_escape "$target")",
  "artifactName": "$(json_escape "$artifact")",
  "artifactSha256": "$(json_escape "$sha256")",
  "sizeBytes": $size,
  "sourceUrl": "$(json_escape "$source_url")",
  "verification": "release-checksum",
  "installedAt": "$(iso_now)"
}
JSON
	mv -f "$tmp" "$path"
}

acquire_version_lock() {
	local version="$1" lock_path="$2"
	mkdir -p "$(dirname "$lock_path")"
	if [[ -f "$lock_path" ]]; then
		local holder
		holder="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$lock_path" | head -1)"
		if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
			err "Install lock held by pid $holder for version $version"
			return 1
		fi
		rm -f "$lock_path"
	fi
	cat >"$lock_path" <<JSON
{"pid":$$,"version":"$(json_escape "$version")","execPath":"install.sh","acquiredAt":"$(iso_now)"}
JSON
}

release_version_lock() {
	local lock_path="$1"
	[[ -f "$lock_path" ]] || return 0
	local holder
	holder="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$lock_path" | head -1)"
	if [[ "$holder" == "$$" ]]; then
		rm -f "$lock_path"
	fi
}

begin_transaction() {
	local id="$1" kind="$2" version="$3" staging="$4" path="$5"
	mkdir -p "$(dirname "$path")"
	cat >"$path" <<JSON
{
  "schemaVersion": 1,
  "id": "$(json_escape "$id")",
  "kind": "$(json_escape "$kind")",
  "pid": $$,
  "version": "$(json_escape "$version")",
  "stagingDir": "$(json_escape "$staging")",
  "startedAt": "$(iso_now)"
}
JSON
}

finish_transaction() {
	local path="$1"
	rm -f "$path"
}

activate_launcher() {
	local version_path="$1" launcher="$2"
	local tmp_link
	mkdir -p "$(dirname "$launcher")"
	tmp_link="${launcher}.tmp.$$"
	rm -f "$tmp_link"
	ln -sfn "$version_path" "$tmp_link"
	mv -f "$tmp_link" "$launcher"
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

read_previous_active_version() {
	local manifest_path="$CONFIG_DIR/install.json"
	[[ -f "$manifest_path" ]] || return 0
	local ver
	ver="$(sed -n 's/.*"activeVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_path" | head -1)"
	if [[ -z "$ver" ]]; then
		ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_path" | head -1)"
	fi
	[[ -n "$ver" ]] && parse_canonical_version "$ver" >/dev/null && printf '%s\n' "$ver"
}

install_binary() {
	local os arch asset base url sums resolved_version version_path versions_dir
	local staging txn_id txn_path lock_path staged_bin staged_sums want got size_bytes
	local target previous kind metadata_path cleanup_done=0

	os="$(detect_os)"
	arch="$(detect_arch)"
	if [[ "$os" == unknown || "$arch" == unknown ]]; then
		err "No prebuilt binary for this OS/arch ($(uname -s)/$(uname -m))."
		err "Supported: linux|darwin x x64|arm64. Try --method npm or --method source."
		exit 1
	fi
	if [[ "$os" == linux ]] && detect_musl; then
		asset="kunai-linux-${arch}-musl"
		target="linux-${arch}-musl"
	else
		asset="kunai-${os}-${arch}"
		target="${os}-${arch}"
		[[ "$os" == linux ]] && target="linux-${arch}-gnu"
	fi

	# Validate pinned versions before any filesystem mutation or network I/O.
	if [[ "$VERSION" != latest ]]; then
		resolved_version="$(normalize_requested_version "$VERSION")" || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
	elif [[ "$DRY" == 1 ]]; then
		resolved_version="dry-run"
	else
		resolved_version="$(resolve_published_version)"
	fi

	if [[ "$VERSION" == latest && "$DRY" != 1 ]]; then
		base="$KUNAI_DL_BASE/latest/download"
	else
		base="$KUNAI_DL_BASE/download/v$resolved_version"
	fi
	url="$base/$asset"
	sums="$base/SHA256SUMS"

	versions_dir="$DATA_DIR/versions"
	version_path="$versions_dir/$resolved_version/kunai"

	if [[ "$DRY" == 1 ]]; then
		info "Downloading $asset (v$resolved_version) ..."
		info "[dry-run] curl (bounded) $url -o <staging>/$asset"
		info "[dry-run] curl (bounded) $sums -o <staging>/SHA256SUMS"
		write_manifest binary "$resolved_version" "$BIN_DIR/kunai" "$version_path" "$target"
		info "Installed kunai → $BIN_DIR/kunai (v$resolved_version at $version_path)"
		path_hint "$BIN_DIR"
		return
	fi

	require curl

	previous="$(read_previous_active_version || true)"
	if [[ -n "$previous" && "$previous" != "$resolved_version" ]]; then
		kind="upgrade"
	else
		kind="install"
	fi

	staging="$CACHE_DIR/staging/$resolved_version/txn-$$-$(date +%s)"
	txn_id="$(date +%s)-$$"
	txn_path="$DATA_DIR/transactions/${txn_id}.json"
	lock_path="$DATA_DIR/locks/${resolved_version}.lock"
	staged_bin="$staging/$asset"
	staged_sums="$staging/SHA256SUMS"
	metadata_path="$versions_dir/$resolved_version/version.json"

	cleanup_install_state() {
		[[ "$cleanup_done" == 1 ]] && return
		cleanup_done=1
		finish_transaction "$txn_path" 2>/dev/null || true
		release_version_lock "$lock_path" 2>/dev/null || true
		rm -rf "$staging" 2>/dev/null || true
	}
	trap cleanup_install_state EXIT

	acquire_version_lock "$resolved_version" "$lock_path" || exit 1
	mkdir -p "$staging"
	begin_transaction "$txn_id" "$kind" "$resolved_version" "$staging" "$txn_path"

	info "Downloading $asset (v$resolved_version) ..."
	if ! bounded_download "$sums" "$staged_sums" "$DOWNLOAD_CHECKSUM_MAX_BYTES" "SHA256SUMS"; then
		download_failed_hint "SHA256SUMS"
		exit 1
	fi
	if ! bounded_download "$url" "$staged_bin" "$DOWNLOAD_MAX_BYTES" "$asset"; then
		download_failed_hint "$asset"
		exit 1
	fi

	if [[ ! -s "$staged_bin" ]]; then
		err "Downloaded asset $asset is empty; the release is incomplete."
		download_failed_hint "$asset"
		exit 1
	fi

	want="$(awk -v a="$asset" '$2==a {print $1}' "$staged_sums")"
	got="$(sha256_of "$staged_bin")"
	size_bytes="$(wc -c <"$staged_bin" | tr -d ' ')"

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
	# Atomic install into version store: same-dir temp + rename.
	local version_tmp="${version_path}.tmp.$$"
	install -m 0755 "$staged_bin" "$version_tmp"
	mv -f "$version_tmp" "$version_path"

	write_version_metadata "$resolved_version" "$target" "$asset" "$got" "$size_bytes" "$url" "$metadata_path"
	activate_launcher "$version_path" "$BIN_DIR/kunai"

	if [[ "$os" == darwin ]]; then
		xattr -d com.apple.quarantine "$version_path" 2>/dev/null || true
		info "Cleared macOS quarantine when present (Gatekeeper may still prompt on first launch)."
	fi

	local prev_arg=""
	if [[ -n "$previous" && "$previous" != "$resolved_version" ]]; then
		prev_arg="$previous"
	fi
	write_manifest binary "$resolved_version" "$BIN_DIR/kunai" "$version_path" "$target" "$got" "$prev_arg"

	finish_transaction "$txn_path"
	release_version_lock "$lock_path"
	rm -rf "$staging"
	cleanup_done=1
	trap - EXIT

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
	local resolved
	require npm
	ensure_bun
	if [[ "$VERSION" != latest ]]; then
		resolved="$(normalize_requested_version "$VERSION")" || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
	else
		resolved="latest"
	fi
	info "Installing $KUNAI_PACKAGE with npm..."
	if [[ "$resolved" == latest ]]; then
		run npm install -g "$KUNAI_PACKAGE"
	else
		run npm install -g "${KUNAI_PACKAGE}@${resolved}"
	fi
	write_manifest npm-global "${resolved}" "$(command -v kunai || echo kunai)"
	have kunai && path_hint "$(dirname "$(command -v kunai)")"
}

install_bun() {
	local resolved
	ensure_bun
	if [[ "$VERSION" != latest ]]; then
		resolved="$(normalize_requested_version "$VERSION")" || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
	else
		resolved="latest"
	fi
	info "Installing $KUNAI_PACKAGE with bun..."
	if [[ "$resolved" == latest ]]; then
		run bun install -g "$KUNAI_PACKAGE"
	else
		run bun install -g "${KUNAI_PACKAGE}@${resolved}"
	fi
	write_manifest bun-global "${resolved}" "$(command -v kunai || echo kunai)"
	have kunai && path_hint "$(dirname "$(command -v kunai)")"
}

install_source() {
	local source_path data_path config_path cache_path resolved
	if [[ "$VERSION" != latest ]]; then
		resolved="$(normalize_requested_version "$VERSION")" || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
	else
		resolved="latest"
	fi
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
	write_manifest source "$resolved" "$(command -v kunai || echo kunai)"
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

	# Reject non-canonical pinned versions before any install side effects.
	if [[ "$VERSION" != latest ]]; then
		normalize_requested_version "$VERSION" >/dev/null || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
	fi

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
