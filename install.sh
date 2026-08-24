#!/usr/bin/env bash
# Kunai installer — binary-first, channel-aware, cross-platform.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
#   ./install.sh [--method binary|npm|bun|source] [--version X.Y.Z] [--yes] [--dry-run]
#                [--skip-deps] [--skip-path-update]
#
# PATH is persisted to your shell rc file unless --skip-path-update (or
# KUNAI_SKIP_PATH_UPDATE=1) is set. The block is delimited and written once.
#
# Installs Kunai only. After install, use `kunai upgrade` and `kunai uninstall`
# for lifecycle — the install script does not remove or update an install.
#
# Native binary layout (keep in sync with apps/cli/src/services/update/native-installer/install-layout.ts):
#   {dataDir}/versions/{semver}/kunai     versioned binary
#   {dataDir}/versions/{semver}/version.json  per-version metadata
#   {dataDir}/locks/{semver}.lock         install lock
#   {dataDir}/locks/activation.lock       shared launcher/manifest lock
#   {dataDir}.lifecycle.lock              purge-safe uninstall guard
#   {dataDir}/transactions/{id}.json     install transaction
#   {cacheDir}/staging/{semver}/txn-…    unique download staging
#   {binDir}/kunai                       launcher symlink -> versioned binary
#   {configDir}/install.json             schema-2 ownership/provenance manifest
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
DOWNLOAD_ARCHIVE_MAX_BYTES="${KUNAI_DOWNLOAD_ARCHIVE_MAX_BYTES:-67108864}"
EXTRACTED_BINARY_MAX_BYTES="${KUNAI_EXTRACTED_BINARY_MAX_BYTES:-134217728}"
ARCHIVE_TAR_COMMAND="${KUNAI_ARCHIVE_TAR_COMMAND:-tar}"
DOWNLOAD_CHECKSUM_MAX_BYTES="${KUNAI_DOWNLOAD_CHECKSUM_MAX_BYTES:-1048576}"
DOWNLOAD_MAX_ATTEMPTS="${KUNAI_DOWNLOAD_MAX_ATTEMPTS:-3}"
DOWNLOAD_RETRY_BASE_MS="${KUNAI_DOWNLOAD_RETRY_BASE_MS:-1000}"
ACTIVATION_LOCK_TIMEOUT_MS="${KUNAI_ACTIVATION_LOCK_TIMEOUT_MS:-10000}"
ACTIVATION_LOCK_POLL_MS="${KUNAI_ACTIVATION_LOCK_POLL_MS:-50}"
ACTIVATION_LOCK_CORRUPT_GRACE_MS="${KUNAI_ACTIVATION_LOCK_CORRUPT_GRACE_MS:-250}"
ACTIVATION_LOCK_OWNER_ID=""
INSTALL_TXN_PATH=""
INSTALL_VERSION_LOCK_PATH=""
INSTALL_STAGING_PATH=""
INSTALL_ACTIVATION_LOCK_PATH=""
INSTALL_ACTIVATION_LOCK_HELD=0
INSTALL_LAUNCHER_ACTIVATED=0
INSTALL_PRESERVE_LAUNCHER_SNAPSHOT=0
LAUNCHER_SNAPSHOT_KIND="missing"
LAUNCHER_SNAPSHOT_TARGET=""
LAUNCHER_SNAPSHOT_BACKUP=""
BOUNDED_DOWNLOAD_HTTP_STATUS=""

case "$(uname -s)" in
Darwin) HOST_OS="darwin" ;;
Linux) HOST_OS="linux" ;;
*) HOST_OS="unknown" ;;
esac

[[ "$ACTIVATION_LOCK_TIMEOUT_MS" =~ ^[0-9]+$ ]] || ACTIVATION_LOCK_TIMEOUT_MS=10000
[[ "$ACTIVATION_LOCK_POLL_MS" =~ ^[0-9]+$ ]] || ACTIVATION_LOCK_POLL_MS=50
[[ "$ACTIVATION_LOCK_CORRUPT_GRACE_MS" =~ ^[0-9]+$ ]] || ACTIVATION_LOCK_CORRUPT_GRACE_MS=250
((ACTIVATION_LOCK_POLL_MS > 0)) || ACTIVATION_LOCK_POLL_MS=1

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
# Parity with install.ps1's -SkipPathUpdate: managed and sandboxed environments
# own PATH themselves and must not have their shell rc files written to.
SKIP_PATH_UPDATE="${KUNAI_SKIP_PATH_UPDATE:-0}"
case "$SKIP_PATH_UPDATE" in 1 | true | TRUE | yes | YES | y | Y) SKIP_PATH_UPDATE=1 ;; *) SKIP_PATH_UPDATE=0 ;; esac

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '→ %s\n' "$*"; }
warn() { printf '! \033[33m%s\033[0m\n' "$*"; }
err() { printf '✗ %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# Prompt the user via the controlling terminal, so it still works under
# `curl … | bash` (where stdin is the script pipe, not the keyboard).
ask() {
	local question="$1" default="${2:-y}" reply
	# An explicit --yes is consent. Nothing else is.
	if [[ "$YES" == 1 ]]; then
		[[ "$default" == y ]]
		return
	fi
	# `-r /dev/tty` tests permission bits, not whether this process has a
	# controlling terminal: the node is crw-rw-rw- and passes `-r` even under
	# `curl … | bash` in CI, a container, or a sandbox, where opening it fails
	# with ENXIO. Opening it is the only honest test.
	# Redirections apply left to right, so stderr must be silenced *before* the
	# failing open or bash prints its own "No such device or address" first.
	if ! : 2>/dev/null </dev/tty; then
		warn "No terminal for: $question — skipping (pass --yes to accept, --skip-deps to silence)"
		return 1
	fi
	# A failed read must decline. The previous `|| true` swallowed the failure
	# and fell through to `${reply:-$default}`, which is how a prompt nobody
	# could answer turned into a yes and ran `sudo apt-get install` unattended.
	if ! read -r -p "$question [$default] " reply </dev/tty; then
		warn "No reply for: $question — skipping (pass --yes to accept)"
		return 1
	fi
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

# Read and validate Kunai's version from package-manager-owned metadata.
read_owned_package_version() {
	local pkg_json="$1" name ver
	[[ -f "$pkg_json" ]] || return 1
	name="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg_json" | head -1)"
	[[ "$name" == "$KUNAI_PACKAGE" ]] || return 1
	ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg_json" | head -1)"
	[[ -n "$ver" ]] && normalize_requested_version "$ver"
}

# Resolve canonical activeVersion from the selected owner's metadata only.
resolve_installed_package_version() {
	local owner="$1" root global_dir
	case "$owner" in
	npm)
		root="$(npm root -g 2>/dev/null)" || return 1
		[[ -n "$root" ]] || return 1
		read_owned_package_version "$root/$KUNAI_PACKAGE/package.json"
		;;
	bun)
		global_dir="${BUN_INSTALL_GLOBAL_DIR:-${BUN_INSTALL:-$HOME/.bun}/install/global}"
		read_owned_package_version "$global_dir/node_modules/$KUNAI_PACKAGE/package.json"
		;;
	source) read_owned_package_version "$SOURCE_DIR/package.json" ;;
	*) return 1 ;;
	esac
}

resolve_owned_package_launcher() {
	local owner="$1" prefix bin_dir
	case "$owner" in
	npm)
		prefix="$(npm prefix -g 2>/dev/null)" || return 1
		[[ -n "$prefix" ]] || return 1
		printf '%s\n' "$prefix/bin/kunai"
		;;
	bun)
		bin_dir="${BUN_INSTALL_BIN:-${BUN_INSTALL:-$HOME/.bun}/bin}"
		printf '%s\n' "$bin_dir/kunai"
		;;
	source) command -v kunai || return 1 ;;
	*) return 1 ;;
	esac
}

# After package install (or dry-run), produce a canonical activeVersion for the manifest.
finalize_package_active_version() {
	local owner="$1" resolved="$2" observed
	if [[ "$DRY" == 1 ]]; then
		if [[ "$resolved" == latest ]]; then
			printf '%s\n' "dry-run"
		else
			printf '%s\n' "$resolved"
		fi
		return 0
	fi
	observed="$(resolve_installed_package_version "$owner")" || {
		err "Could not resolve installed Kunai version from $owner-owned package metadata."
		return 1
	}
	if [[ "$resolved" != latest && "$observed" != "$resolved" ]]; then
		err "Installed Kunai version $observed does not match requested $resolved."
		return 1
	fi
	printf '%s\n' "$observed"
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
	local attempt=1 code curl_rc remaining started elapsed delay_ms
	started="$(date +%s)"
	BOUNDED_DOWNLOAD_HTTP_STATUS=""

	while [[ "$attempt" -le "$DOWNLOAD_MAX_ATTEMPTS" ]]; do
		elapsed=$(($(date +%s) - started))
		remaining=$((DOWNLOAD_TOTAL_SECONDS - elapsed))
		if [[ "$remaining" -le 0 ]]; then
			err "Download total deadline exceeded."
			return 1
		fi
		rm -f "$dest"
		code="000"
		curl_rc=0
		# Capture curl exit: --max-filesize (63) can leave a partial with HTTP 200
		# when Transfer-Encoding is chunked / Content-Length is absent.
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
				"$url"
		)" || curl_rc=$?
		BOUNDED_DOWNLOAD_HTTP_STATUS="$code"
		if [[ "$curl_rc" -ne 0 ]]; then
			rm -f "$dest"
			if [[ "$attempt" -ge "$DOWNLOAD_MAX_ATTEMPTS" ]]; then
				err "Download failed for $label (network, stall, size limit, or timeout)."
				return 1
			fi
			delay_ms=$((DOWNLOAD_RETRY_BASE_MS * attempt))
			info "Retrying $label (attempt $((attempt + 1))/$DOWNLOAD_MAX_ATTEMPTS) after curl exit $curl_rc..."
			if have python3; then
				python3 -c "import time; time.sleep(${delay_ms}/1000.0)" 2>/dev/null || sleep 1
			else
				sleep 1
			fi
			attempt=$((attempt + 1))
			continue
		fi
		# curl exited 0 — trust HTTP status + non-empty body.
		if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
			if [[ -s "$dest" ]]; then
				return 0
			fi
			err "Downloaded asset $label is empty; the release is incomplete."
			rm -f "$dest"
			return 1
		fi
		# file:// and some local transports report http_code 000 on success.
		if [[ "$code" == "000" && -s "$dest" ]]; then
			return 0
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

checksum_for_asset() {
	local manifest="$1" asset="$2"
	awk -v asset="$asset" '
		$2 == asset {
			found++
			if (NF != 2 || length($1) != 64 || $1 !~ /^[0-9A-Fa-f]+$/) invalid = 1
			digest = tolower($1)
		}
		END {
			if (found != 1 || invalid) exit 1
			print digest
		}
	' "$manifest"
}

extract_release_tar_gz() {
	local archive="$1" tar_path="$2" expected="$3" output="$4"
	local tar_budget gzip_status head_status tar_size name prefix type size_field size
	local checksum_field stored_checksum header_sum checksum_sum actual_checksum expected_tar_size
	local -a pipeline_status

	require gzip
	require "$ARCHIVE_TAR_COMMAND"
	require od

	tar_budget=$((512 + ((EXTRACTED_BINARY_MAX_BYTES + 511) / 512) * 512 + 1024))
	set +o pipefail
	gzip -dc "$archive" 2>/dev/null | head -c "$((tar_budget + 1))" >"$tar_path"
	pipeline_status=("${PIPESTATUS[@]}")
	gzip_status="${pipeline_status[0]}"
	head_status="${pipeline_status[1]}"
	set -o pipefail
	tar_size="$(wc -c <"$tar_path" | tr -d ' ')"
	if [[ "$tar_size" -gt "$tar_budget" ]]; then
		err "Archive decompressed size exceeds the $tar_budget byte budget."
		return 1
	fi
	if [[ "$gzip_status" -ne 0 || "$head_status" -ne 0 ]]; then
		err "Archive is not a valid gzip stream."
		return 1
	fi
	if [[ "$tar_size" -lt 1536 || $((tar_size % 512)) -ne 0 ]]; then
		err "Archive is not a valid one-member tar container."
		return 1
	fi

	name="$(dd if="$tar_path" bs=1 count=100 2>/dev/null | tr -d '\000')"
	prefix="$(dd if="$tar_path" bs=1 skip=345 count=155 2>/dev/null | tr -d '\000')"
	type="$(od -An -tu1 -j 156 -N 1 "$tar_path" | tr -d '[:space:]')"
	if [[ -n "$prefix" || "$name" == /* || "$name" == *"/"* || "$name" == *"\\"* || "$name" == . || "$name" == .. ]]; then
		err "Archive contains an unsafe traversal or absolute-path entry."
		return 1
	fi
	if [[ "$name" != "$expected" ]]; then
		err "Archive contains unexpected entry '$name'; expected '$expected'."
		return 1
	fi
	if [[ "$type" != 0 && "$type" != 48 ]]; then
		err "Archive entry must be a regular file; links are forbidden."
		return 1
	fi

	size_field="$(dd if="$tar_path" bs=1 skip=124 count=12 2>/dev/null | tr -d '\000 ')"
	if [[ -z "$size_field" || "$size_field" == *[!0-7]* ]]; then
		err "Archive has an invalid tar entry size."
		return 1
	fi
	size=$((8#$size_field))
	if [[ "$size" -le 0 || "$size" -gt "$EXTRACTED_BINARY_MAX_BYTES" ]]; then
		err "Extracted binary size $size exceeds the $EXTRACTED_BINARY_MAX_BYTES byte budget."
		return 1
	fi

	checksum_field="$(dd if="$tar_path" bs=1 skip=148 count=8 2>/dev/null | tr -d '\000 ')"
	if [[ -z "$checksum_field" || "$checksum_field" == *[!0-7]* ]]; then
		err "Archive has an invalid tar header checksum."
		return 1
	fi
	stored_checksum=$((8#$checksum_field))
	header_sum="$(od -An -tu1 -N 512 "$tar_path" | awk '{ for (i = 1; i <= NF; i++) sum += $i } END { print sum + 0 }')"
	checksum_sum="$(od -An -tu1 -j 148 -N 8 "$tar_path" | awk '{ for (i = 1; i <= NF; i++) sum += $i } END { print sum + 0 }')"
	actual_checksum=$((header_sum - checksum_sum + 256))
	if [[ "$stored_checksum" -ne "$actual_checksum" ]]; then
		err "Archive has an invalid tar header checksum."
		return 1
	fi

	expected_tar_size=$((512 + ((size + 511) / 512) * 512 + 1024))
	if [[ "$tar_size" -ne "$expected_tar_size" ]]; then
		err "Release archive must contain exactly one regular file."
		return 1
	fi
	if od -An -v -tu1 -j "$((512 + size))" "$tar_path" |
		awk '{ for (i = 1; i <= NF; i++) if ($i != 0) found = 1 } END { exit found ? 0 : 1 }'; then
		err "Archive contains non-zero padding, extra entries, or trailing data."
		return 1
	fi
	if ! "$ARCHIVE_TAR_COMMAND" -xOf "$tar_path" "$expected" >"$output" 2>/dev/null; then
		err "Could not extract the verified archive member."
		return 1
	fi
	if [[ "$(wc -c <"$output" | tr -d ' ')" -ne "$size" ]]; then
		err "Extracted binary size does not match the tar header."
		return 1
	fi
}

write_manifest() {
	local method="$1" version="$2" launcher="$3" versionpath="${4:-}" target="${5:-}" sha256="${6:-}"
	local previous="${7:-}" artifact_name="${8:-}" artifact_size="${9:-}"
	local archive_name="${10:-}" archive_sha256="${11:-}" archive_size="${12:-}" archive_source_url="${13:-}"
	local now installed_at managed_json tmp manifest_path
	if [[ "$DRY" == 1 ]]; then
		info "[dry-run] would write schema-2 manifest ($method) to $CONFIG_DIR/install.json"
		return
	fi
	mkdir -p "$CONFIG_DIR" || return 1
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
		printf '  "schemaVersion": 2,\n'
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
		if [[ -n "$artifact_name" ]]; then
			printf '  "artifactName": "%s",\n' "$(json_escape "$artifact_name")"
		fi
		if [[ -n "$artifact_size" ]]; then
			printf '  "artifactSizeBytes": %s,\n' "$artifact_size"
		fi
		if [[ -n "$archive_name" ]]; then
			printf '  "archiveName": "%s",\n' "$(json_escape "$archive_name")"
			printf '  "archiveSha256": "%s",\n' "$(json_escape "$archive_sha256")"
			printf '  "archiveSizeBytes": %s,\n' "$archive_size"
			printf '  "archiveSourceUrl": "%s",\n' "$(json_escape "$archive_source_url")"
		fi
		printf '  "downloadBaseUrl": "%s",\n' "$(json_escape "$KUNAI_DL_BASE")"
		printf '  "installedAt": "%s",\n' "$(json_escape "$installed_at")"
		printf '  "updatedAt": "%s"\n' "$(json_escape "$now")"
		printf '}\n'
	} >"$tmp" || {
		rm -f "$tmp"
		return 1
	}
	if ! mv -f "$tmp" "$manifest_path"; then
		rm -f "$tmp"
		return 1
	fi
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

read_lifecycle_lock() {
	local raw="$1" process_start_raw
	LIFECYCLE_READ_SCHEMA="$(printf '%s\n' "$raw" | sed -n 's/.*"schemaVersion"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
	LIFECYCLE_READ_SCOPE="$(printf '%s\n' "$raw" | sed -n 's/.*"scope"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	LIFECYCLE_READ_PID="$(printf '%s\n' "$raw" | sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
	LIFECYCLE_READ_VERSION="$(printf '%s\n' "$raw" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	LIFECYCLE_READ_EXEC_PATH="$(printf '%s\n' "$raw" | sed -n 's/.*"execPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	LIFECYCLE_READ_OWNER="$(printf '%s\n' "$raw" | sed -n 's/.*"ownerId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	LIFECYCLE_READ_ACQUIRED_AT="$(printf '%s\n' "$raw" | sed -n 's/.*"acquiredAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	LIFECYCLE_READ_HOSTNAME="$(printf '%s\n' "$raw" | sed -n 's/.*"hostname"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | tr '[:upper:]' '[:lower:]')"
	LIFECYCLE_READ_PROCESS_START="$(printf '%s\n' "$raw" | sed -n 's/.*"processStartId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	process_start_raw="$(printf '%s\n' "$raw" | sed -n 's/.*"processStartId"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p' | head -1)"
	[[ "$LIFECYCLE_READ_PID" =~ ^[1-9][0-9]*$ ]] || return 2
	if [[ -z "$LIFECYCLE_READ_SCHEMA$LIFECYCLE_READ_SCOPE$LIFECYCLE_READ_HOSTNAME$process_start_raw" ]]; then
		LIFECYCLE_READ_MODERN=0
		return 0
	fi
	LIFECYCLE_READ_MODERN=1
	[[ "$LIFECYCLE_READ_SCHEMA" == 1 && "$LIFECYCLE_READ_SCOPE" == lifecycle ]] || return 2
	[[ "$LIFECYCLE_READ_VERSION" == 0.0.0 ]] || return 2
	[[ -n "$LIFECYCLE_READ_EXEC_PATH" && -n "$LIFECYCLE_READ_OWNER" ]] || return 2
	[[ "$LIFECYCLE_READ_ACQUIRED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] || return 2
	[[ -n "$LIFECYCLE_READ_HOSTNAME" ]] || return 2
	[[ "$process_start_raw" == null || -n "$LIFECYCLE_READ_PROCESS_START" ]] || return 2
}

lifecycle_lock_blocks() {
	local lock_path="$1" raw reread status local_hostname current_start
	raw="$(cat "$lock_path" 2>/dev/null || true)"
	if read_lifecycle_lock "$raw"; then
		status=0
	else
		status=$?
	fi
	if ((status == 2)); then
		activation_lock_sleep 250
		reread="$(cat "$lock_path" 2>/dev/null || true)"
		[[ "$reread" == "$raw" ]] || return 0
		if ! read_lifecycle_lock "$reread"; then
			return 1
		fi
	fi
	if [[ "$LIFECYCLE_READ_MODERN" == 1 ]]; then
		local_hostname="$(activation_lock_hostname)"
		[[ "$LIFECYCLE_READ_HOSTNAME" == "$local_hostname" ]] || return 0
		if kill -0 "$LIFECYCLE_READ_PID" 2>/dev/null || ps -p "$LIFECYCLE_READ_PID" >/dev/null 2>&1; then
			if [[ -n "$LIFECYCLE_READ_PROCESS_START" ]]; then
				current_start="$(activation_lock_process_start_id "$LIFECYCLE_READ_PID")"
				[[ -n "$current_start" && "$current_start" != "$LIFECYCLE_READ_PROCESS_START" ]] && return 1
			fi
			return 0
		fi
		return 1
	fi
	if kill -0 "$LIFECYCLE_READ_PID" 2>/dev/null || ps -p "$LIFECYCLE_READ_PID" >/dev/null 2>&1; then
		return 0
	fi
	return 1
}

acquire_version_lock() {
	local version="$1" lock_path="$2"
	local lifecycle_path lifecycle_guard_path lifecycle_candidate holder
	mkdir -p "$(dirname "$lock_path")"
	lifecycle_path="$(dirname "$lock_path")/lifecycle.lock"
	lifecycle_guard_path="${DATA_DIR}.lifecycle.lock"
	for lifecycle_candidate in "$lifecycle_guard_path" "$lifecycle_path"; do
		if [[ -f "$lifecycle_candidate" ]]; then
			if lifecycle_lock_blocks "$lifecycle_candidate"; then
				holder="$LIFECYCLE_READ_PID"
				err "Install lifecycle lock held by pid $holder; uninstall is in progress"
				return 1
			fi
		fi
	done
	if [[ -f "$lock_path" ]]; then
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
	# Close the race with lifecycle acquisition. If uninstall won after the
	# first check, relinquish our version lock before any download or mutation.
	for lifecycle_candidate in "$lifecycle_guard_path" "$lifecycle_path"; do
		if [[ -f "$lifecycle_candidate" ]]; then
			if lifecycle_lock_blocks "$lifecycle_candidate"; then
				holder="$LIFECYCLE_READ_PID"
				release_version_lock "$lock_path"
				err "Install lifecycle lock held by pid $holder; uninstall is in progress"
				return 1
			fi
		fi
	done
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

activation_lock_sleep() {
	local milliseconds="$1" seconds
	seconds="$(awk -v ms="$milliseconds" 'BEGIN { printf "%.3f", ms / 1000 }')"
	sleep "$seconds"
}

activation_lock_now_ms() {
	local value seconds
	value="$(date +%s%3N 2>/dev/null || true)"
	if [[ "$value" =~ ^[0-9]+$ ]]; then
		printf '%s' "$value"
		return
	fi
	if have perl; then
		perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000'
		return
	fi
	seconds="$(date +%s)"
	printf '%s000' "$seconds"
}

activation_lock_poll_until() {
	local deadline="$1" now remaining delay
	now="$(activation_lock_now_ms)"
	remaining=$((deadline - now))
	((remaining > 0)) || return 1
	delay="$ACTIVATION_LOCK_POLL_MS"
	((delay <= remaining)) || delay="$remaining"
	((delay > 0)) || delay=1
	activation_lock_sleep "$delay"
}

activation_lock_hostname() {
	local value
	value="$(hostname 2>/dev/null || uname -n 2>/dev/null || true)"
	printf '%s' "$value" | awk '{$1=$1; print}' | tr '[:upper:]' '[:lower:]'
}

activation_lock_process_start_id() {
	local pid="$1" raw rest value
	if [[ -r "/proc/$pid/stat" ]]; then
		raw="$(cat "/proc/$pid/stat" 2>/dev/null || true)"
		if [[ "$raw" == *") "* ]]; then
			rest="${raw##*) }"
			# Fields after comm begin with field 3; starttime is field 22.
			# shellcheck disable=SC2086
			set -- $rest
			value="${20:-}"
			[[ -n "$value" ]] && printf 'linux-proc:%s' "$value"
		fi
		return
	fi
	if [[ "$HOST_OS" == darwin ]]; then
		value="$(ps -o lstart= -p "$pid" 2>/dev/null | awk '{$1=$1; print}' || true)"
		[[ -n "$value" ]] && printf 'darwin-ps:%s' "$value"
	fi
}

read_activation_lock() {
	local raw="$1" process_start_raw
	ACTIVATION_READ_SCHEMA="$(printf '%s\n' "$raw" | sed -n 's/.*"schemaVersion"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
	ACTIVATION_READ_SCOPE="$(printf '%s\n' "$raw" | sed -n 's/.*"scope"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	ACTIVATION_READ_PID="$(printf '%s\n' "$raw" | sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
	ACTIVATION_READ_VERSION="$(printf '%s\n' "$raw" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	ACTIVATION_READ_EXEC_PATH="$(printf '%s\n' "$raw" | sed -n 's/.*"execPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	ACTIVATION_READ_OWNER="$(printf '%s\n' "$raw" | sed -n 's/.*"ownerId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	ACTIVATION_READ_ACQUIRED_AT="$(printf '%s\n' "$raw" | sed -n 's/.*"acquiredAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	ACTIVATION_READ_HOSTNAME="$(printf '%s\n' "$raw" | sed -n 's/.*"hostname"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | tr '[:upper:]' '[:lower:]')"
	ACTIVATION_READ_PROCESS_START="$(printf '%s\n' "$raw" | sed -n 's/.*"processStartId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
	process_start_raw="$(printf '%s\n' "$raw" | sed -n 's/.*"processStartId"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p' | head -1)"

	[[ "$ACTIVATION_READ_SCHEMA" == 1 ]] || return 1
	[[ "$ACTIVATION_READ_SCOPE" == activation ]] || return 1
	[[ "$ACTIVATION_READ_PID" =~ ^[1-9][0-9]*$ ]] || return 1
	parse_canonical_version "$ACTIVATION_READ_VERSION" >/dev/null 2>&1 || return 1
	[[ -n "$ACTIVATION_READ_EXEC_PATH" && -n "$ACTIVATION_READ_OWNER" ]] || return 1
	[[ "$ACTIVATION_READ_ACQUIRED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] || return 1
	[[ -n "$ACTIVATION_READ_HOSTNAME" ]] || return 1
	[[ "$process_start_raw" == null || -n "$ACTIVATION_READ_PROCESS_START" ]] || return 1
}

activation_lock_owner_is_stale() {
	local local_hostname current_start
	local_hostname="$(activation_lock_hostname)"
	# A foreign-host PID has no meaning locally. Preserve it until the bounded
	# acquisition timeout instead of reclaiming a possibly-live remote owner.
	[[ "$ACTIVATION_READ_HOSTNAME" == "$local_hostname" ]] || return 1
	if kill -0 "$ACTIVATION_READ_PID" 2>/dev/null || ps -p "$ACTIVATION_READ_PID" >/dev/null 2>&1; then
		if [[ -n "$ACTIVATION_READ_PROCESS_START" ]]; then
			current_start="$(activation_lock_process_start_id "$ACTIVATION_READ_PID")"
			[[ -n "$current_start" && "$current_start" != "$ACTIVATION_READ_PROCESS_START" ]] && return 0
		fi
		return 1
	fi
	return 0
}

activation_reclaim_temp_is_stale() {
	local temp_path="$1" raw modified now
	raw="$(cat "$temp_path" 2>/dev/null || true)"
	if read_activation_lock "$raw"; then
		activation_lock_owner_is_stale
		return
	fi
	# Invalid partial writes have no usable owner identity. Give an active writer
	# at least the corrupt grace before treating the uniquely named temp as
	# abandoned. Preserve it when this platform cannot report modification time.
	modified="$(stat -c %Y "$temp_path" 2>/dev/null || stat -f %m "$temp_path" 2>/dev/null || true)"
	[[ "$modified" =~ ^[0-9]+$ ]] || return 1
	now="$(date +%s)"
	((now * 1000 - modified * 1000 >= ACTIVATION_LOCK_CORRUPT_GRACE_MS))
}

first_activation_reclaim_claim() {
	local lock_path="$1" claim temp raw
	# Temp publications are never election claims. Clean both the current
	# out-of-namespace form and the legacy in-prefix form whose crash residue
	# otherwise blocked every future activation.
	for temp in "${lock_path}.reclaim-tmp."* "${lock_path}.reclaim."*.tmp.*; do
		[[ -f "$temp" ]] || continue
		activation_reclaim_temp_is_stale "$temp" && rm -f "$temp"
	done
	for claim in "${lock_path}.reclaim."*; do
		[[ -f "$claim" ]] || continue
		raw="$(cat "$claim" 2>/dev/null || true)"
		if read_activation_lock "$raw" && activation_lock_owner_is_stale; then
			# Claim names contain a random owner token and are never reused.
			rm -f "$claim"
			continue
		fi
		printf '%s\n' "$claim"
	done | sort | head -1
}

create_activation_reclaim_claim() {
	local lock_path="$1" owner_id="$2" record="$3" claim_path temp_path
	claim_path="${lock_path}.reclaim.${owner_id}"
	temp_path="${lock_path}.reclaim-tmp.${owner_id}.$$.$RANDOM"
	(
		umask 077
		printf '%s\n' "$record" >"$temp_path"
	) || return 1
	if ! mv "$temp_path" "$claim_path" 2>/dev/null; then
		rm -f "$temp_path"
		return 1
	fi
	printf '%s' "$claim_path"
}

restore_activation_quarantine() {
	local quarantine_path="$1" lock_path="$2"
	# A hard link is an exclusive restore: it can never overwrite a canonical
	# path created by a newer owner while reclamation was being validated.
	if ln "$quarantine_path" "$lock_path" 2>/dev/null; then
		rm -f "$quarantine_path"
		return 0
	fi
	# EEXIST means a newer canonical owner won and must be preserved. Any
	# hard-link failure while canonical is absent is fail-closed: the observed
	# owner remains in quarantine and this contender must not activate.
	[[ -e "$lock_path" ]] && return 0
	return 1
}

reclaim_activation_lock() {
	local lock_path="$1" observed_raw="$2" allow_corrupt="$3" owner_id="$4" successor_raw="$5" deadline="$6"
	local quarantine_path quarantined_raw
	quarantine_path="${lock_path}.quarantine.${owner_id}.${RANDOM}"
	while [[ -e "$quarantine_path" ]]; do
		quarantine_path="${lock_path}.quarantine.${owner_id}.${RANDOM}"
	done
	if ! mv "$lock_path" "$quarantine_path" 2>/dev/null; then
		return 1
	fi
	quarantined_raw="$(cat "$quarantine_path" 2>/dev/null || true)"
	if [[ "$quarantined_raw" != "$observed_raw" ]]; then
		restore_activation_quarantine "$quarantine_path" "$lock_path" || return 2
		return 1
	fi
	if read_activation_lock "$quarantined_raw"; then
		if ! activation_lock_owner_is_stale; then
			restore_activation_quarantine "$quarantine_path" "$lock_path" || return 2
			return 1
		fi
	elif [[ "$allow_corrupt" != 1 ]]; then
		restore_activation_quarantine "$quarantine_path" "$lock_path" || return 2
		return 1
	fi
	rm -f "$quarantine_path"
	local attempt=0
	while ((attempt < 20)); do
		(($(activation_lock_now_ms) < deadline)) || return 1
		if (
			set -o noclobber
			umask 077
			printf '%s\n' "$successor_raw" >"$lock_path"
		) 2>/dev/null; then
			return 0
		fi
		activation_lock_sleep 1
		attempt=$((attempt + 1))
	done
	return 1
}

claim_and_reclaim_activation_lock() {
	local lock_path="$1" observed_raw="$2" allow_corrupt="$3" owner_id="$4" successor_raw="$5" deadline="$6"
	local claim_path first_claim current_raw result=1
	claim_path="$(create_activation_reclaim_claim "$lock_path" "$owner_id" "$successor_raw")" || return 1
	first_claim="$(first_activation_reclaim_claim "$lock_path")"
	if [[ "$first_claim" == "$claim_path" ]]; then
		current_raw="$(cat "$lock_path" 2>/dev/null || true)"
		if [[ "$current_raw" == "$observed_raw" ]]; then
			if reclaim_activation_lock "$lock_path" "$current_raw" "$allow_corrupt" "$owner_id" "$successor_raw" "$deadline"; then
				result=0
			else
				result=$?
			fi
		fi
	fi
	rm -f "$claim_path"
	return "$result"
}

# Cross-language activation lock shared by install.sh, install.ps1, and the
# in-process native updater. Bash noclobber makes creation atomic (O_EXCL);
# every implementation uses the same JSON fields and token-checked release.
acquire_activation_lock() {
	local version="$1" lock_path="$2"
	local deadline corrupt_since=0 holder="" raw local_hostname process_start process_start_json activation_record reclaim_result attempted=0

	deadline=$(($(activation_lock_now_ms) + ACTIVATION_LOCK_TIMEOUT_MS))
	mkdir -p "$(dirname "$lock_path")"
	ACTIVATION_LOCK_OWNER_ID="$$-$(date +%s)-$RANDOM"
	local_hostname="$(activation_lock_hostname)"
	process_start="$(activation_lock_process_start_id "$$")"
	if [[ -n "$process_start" ]]; then
		process_start_json="\"$(json_escape "$process_start")\""
	else
		process_start_json=null
	fi
	activation_record="$(printf '{"schemaVersion":1,"scope":"activation","pid":%s,"version":"%s","execPath":"install.sh","ownerId":"%s","acquiredAt":"%s","hostname":"%s","processStartId":%s}' \
		"$$" "$(json_escape "$version")" "$(json_escape "$ACTIVATION_LOCK_OWNER_ID")" "$(iso_now)" "$(json_escape "$local_hostname")" "$process_start_json")"

	while :; do
		if ((attempted == 1 && $(activation_lock_now_ms) >= deadline)); then
			if [[ -n "$holder" ]]; then
				err "Activation lock held by pid $holder while activating version $version"
			else
				err "Activation lock held while activating version $version"
			fi
			return 1
		fi
		attempted=1
		if [[ -n "$(first_activation_reclaim_claim "$lock_path")" ]]; then
			if (($(activation_lock_now_ms) >= deadline)); then
				err "Activation reclamation is already in progress for version $version"
				return 1
			fi
			activation_lock_poll_until "$deadline" || continue
			continue
		fi
		if (
			set -o noclobber
			umask 077
			printf '%s\n' "$activation_record" >"$lock_path"
		) 2>/dev/null; then
			if [[ -z "$(first_activation_reclaim_claim "$lock_path")" ]]; then
				return 0
			fi
			release_activation_lock "$lock_path" "$ACTIVATION_LOCK_OWNER_ID"
			continue
		fi
		if [[ ! -e "$lock_path" ]]; then
			if (($(activation_lock_now_ms) >= deadline)); then
				err "Could not create activation lock at $lock_path"
				return 1
			fi
			mkdir -p "$(dirname "$lock_path")" || return 1
			activation_lock_poll_until "$deadline" || continue
			continue
		fi

		raw="$(cat "$lock_path" 2>/dev/null || true)"

		if read_activation_lock "$raw"; then
			corrupt_since=0
			holder="$ACTIVATION_READ_PID"
			if activation_lock_owner_is_stale; then
				if claim_and_reclaim_activation_lock "$lock_path" "$raw" 0 "$ACTIVATION_LOCK_OWNER_ID" "$activation_record" "$deadline"; then
					return 0
				else
					reclaim_result=$?
					if ((reclaim_result == 2)); then
						err "Could not restore activation lock quarantine at $lock_path; refusing activation"
						return 1
					fi
				fi
			fi
		else
			holder=""
			if ((corrupt_since == 0)); then
				corrupt_since="$(activation_lock_now_ms)"
			elif (($(activation_lock_now_ms) - corrupt_since >= ACTIVATION_LOCK_CORRUPT_GRACE_MS)); then
				if claim_and_reclaim_activation_lock "$lock_path" "$raw" 1 "$ACTIVATION_LOCK_OWNER_ID" "$activation_record" "$deadline"; then
					return 0
				else
					reclaim_result=$?
					if ((reclaim_result == 2)); then
						err "Could not restore activation lock quarantine at $lock_path; refusing activation"
						return 1
					fi
				fi
				corrupt_since=0
			fi
		fi

		if (($(activation_lock_now_ms) >= deadline)); then
			if [[ -n "$holder" ]]; then
				err "Activation lock held by pid $holder while activating version $version"
			else
				err "Activation lock held while activating version $version"
			fi
			return 1
		fi
		activation_lock_poll_until "$deadline" || true
	done
}

release_activation_lock() {
	local lock_path="$1" owner_id="$2" current_owner quarantine_path
	[[ -f "$lock_path" ]] || return 0
	[[ -n "$owner_id" ]] || return 0
	quarantine_path="${lock_path}.quarantine.${owner_id}.release.${RANDOM}"
	while [[ -e "$quarantine_path" ]]; do
		quarantine_path="${lock_path}.quarantine.${owner_id}.release.${RANDOM}"
	done
	if ! mv "$lock_path" "$quarantine_path" 2>/dev/null; then
		return 0
	fi
	current_owner="$(sed -n 's/.*"ownerId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$quarantine_path" 2>/dev/null | head -1)"
	if [[ "$current_owner" == "$owner_id" ]]; then
		rm -f "$quarantine_path"
	else
		if ! restore_activation_quarantine "$quarantine_path" "$lock_path"; then
			err "Could not restore activation lock quarantine at $lock_path; ownership remains quarantined"
			return 1
		fi
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

# Remove transaction records whose owning PID is dead, and delete any staging
# directories those records still point at. Safe to call under a version lock.
cleanup_abandoned_transactions() {
	local txn_dir="$DATA_DIR/transactions"
	[[ -d "$txn_dir" ]] || return 0
	local path holder staging_dir
	for path in "$txn_dir"/*.json; do
		[[ -f "$path" ]] || continue
		holder="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$path" | head -1)"
		if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
			continue
		fi
		staging_dir="$(sed -n 's/.*"stagingDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$path" | head -1)"
		if [[ -n "$staging_dir" && "$staging_dir" == "$CACHE_DIR/staging"* ]]; then
			rm -rf "$staging_dir" 2>/dev/null || true
			rmdir "$(dirname "$staging_dir")" 2>/dev/null || true
		fi
		rm -f "$path"
	done
	rmdir "$CACHE_DIR/staging" 2>/dev/null || true
	rmdir "$txn_dir" 2>/dev/null || true
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

snapshot_launcher() {
	local launcher="$1"
	LAUNCHER_SNAPSHOT_KIND="missing"
	LAUNCHER_SNAPSHOT_TARGET=""
	LAUNCHER_SNAPSHOT_BACKUP="${launcher}.activation-backup.$$"
	rm -f "$LAUNCHER_SNAPSHOT_BACKUP"
	if [[ -L "$launcher" ]]; then
		LAUNCHER_SNAPSHOT_KIND="symlink"
		LAUNCHER_SNAPSHOT_TARGET="$(readlink "$launcher")" || return 1
	elif [[ -e "$launcher" ]]; then
		LAUNCHER_SNAPSHOT_KIND="file"
		cp -p "$launcher" "$LAUNCHER_SNAPSHOT_BACKUP" || return 1
	fi
}

restore_launcher_snapshot() {
	local launcher="$1" tmp_link
	case "$LAUNCHER_SNAPSHOT_KIND" in
	symlink)
		tmp_link="${launcher}.restore.$$"
		rm -f "$tmp_link"
		ln -s "$LAUNCHER_SNAPSHOT_TARGET" "$tmp_link" || return 1
		mv -f "$tmp_link" "$launcher" || return 1
		;;
	file)
		[[ -f "$LAUNCHER_SNAPSHOT_BACKUP" ]] || return 1
		mv -f "$LAUNCHER_SNAPSHOT_BACKUP" "$launcher" || return 1
		;;
	missing) rm -f "$launcher" ;;
	*) return 1 ;;
	esac
}

discard_launcher_snapshot() {
	[[ -n "$LAUNCHER_SNAPSHOT_BACKUP" ]] && rm -f "$LAUNCHER_SNAPSHOT_BACKUP"
	LAUNCHER_SNAPSHOT_KIND="missing"
	LAUNCHER_SNAPSHOT_TARGET=""
	LAUNCHER_SNAPSHOT_BACKUP=""
}

detect_musl() {
	[[ "$(uname -s)" == Linux ]] || return 1
	if ldd --version 2>&1 | grep -qi musl; then return 0; fi
	if [[ -r /proc/self/maps ]] && grep -q musl /proc/self/maps 2>/dev/null; then return 0; fi
	return 1
}

# Delimited so the block can be found again — to avoid writing it twice, and so
# `kunai uninstall` (or a human) can remove exactly what was added.
KUNAI_PATH_BLOCK_BEGIN="# >>> kunai installer >>>"
KUNAI_PATH_BLOCK_END="# <<< kunai installer <<<"

# Every file that must carry the PATH line for this shell, newline separated.
#
# One file is not always enough, because bash splits its startup by shell kind:
# .bashrc is read by interactive *non-login* shells (a Linux terminal emulator)
# and .bash_profile/.profile by *login* shells (macOS Terminal, `bash -l`, and
# an `su -` session). Debian happens to source .bashrc from .profile, which
# hides the split; Alpine and macOS do not, and writing only .bashrc there
# leaves `kunai` missing from exactly the shell the user opens. Write both.
#
# zsh needs only .zshrc: unlike bash, zsh reads it for every interactive shell,
# login or not. .zprofile would cover macOS Terminal but not a Linux terminal
# emulator, so it is the weaker choice, not the safer one.
path_rc_files() {
	case "$(basename "${SHELL:-sh}")" in
	zsh) printf '%s\n' "$HOME/.zshrc" ;;
	bash)
		printf '%s\n' "$HOME/.bashrc"
		# Only one login file, or the line is applied twice on a login shell.
		if [[ -f "$HOME/.bash_profile" ]]; then
			printf '%s\n' "$HOME/.bash_profile"
		elif [[ -f "$HOME/.bash_login" ]]; then
			printf '%s\n' "$HOME/.bash_login"
		else
			printf '%s\n' "$HOME/.profile"
		fi
		;;
	fish) printf '%s\n' "$HOME/.config/fish/conf.d/kunai.fish" ;;
	*) printf '%s\n' "$HOME/.profile" ;;
	esac
}

# Append the PATH line to the user's shell rc file.
#
# A script cannot change its parent shell's environment, so printing advice was
# the same as doing nothing for anyone who did not already have the directory on
# PATH — the install "succeeded" and `kunai` was not found. Writing the rc file
# is what rustup, bun, and Homebrew all do, and it is what makes this one-click.
# Skipped entirely under --skip-path-update / KUNAI_SKIP_PATH_UPDATE.
persist_path() {
	local dir="$1" line rc_file wrote=0 activate=""

	if [[ "$(basename "${SHELL:-sh}")" == "fish" ]]; then
		line="fish_add_path $dir"
	else
		line="export PATH=\"$dir:\$PATH\""
	fi

	while IFS= read -r rc_file; do
		[[ -n "$rc_file" ]] || continue

		if [[ -f "$rc_file" ]] && grep -Fq "$KUNAI_PATH_BLOCK_BEGIN" "$rc_file"; then
			info "PATH already persisted in $rc_file."
			wrote=1
			[[ -n "$activate" ]] || activate="$rc_file"
			continue
		fi

		if [[ "$DRY" == 1 ]]; then
			info "[dry-run] would add $dir to PATH in $rc_file"
			wrote=1
			continue
		fi

		mkdir -p "$(dirname "$rc_file")" 2>/dev/null || {
			warn "Could not create $(dirname "$rc_file")."
			continue
		}
		{
			printf '\n%s\n' "$KUNAI_PATH_BLOCK_BEGIN"
			printf '%s\n' "$line"
			printf '%s\n' "$KUNAI_PATH_BLOCK_END"
		} >>"$rc_file" 2>/dev/null || {
			warn "Could not write $rc_file."
			continue
		}

		info "Added $dir to PATH in $rc_file."
		wrote=1
		[[ -n "$activate" ]] || activate="$rc_file"
	done <<<"$(path_rc_files)"

	if [[ "$wrote" == 0 ]]; then
		warn "Could not persist PATH; add '$line' to your shell profile yourself."
		return 1
	fi
	# One copy-pasteable line, so the user need not open a new terminal.
	[[ -n "$activate" ]] && info "Run this to use kunai now: source $activate"
	return 0
}

path_hint() {
	local dir="$1" rc_file
	case ":$PATH:" in
	*":$dir:"*)
		info "kunai is on PATH ($dir)."
		return 0
		;;
	esac

	if [[ "$SKIP_PATH_UPDATE" == 1 ]]; then
		warn "$dir is not on PATH, and PATH updates are disabled."
		info "Add it yourself: export PATH=\"$dir:\$PATH\""
		return 0
	fi

	# persist_path already explains itself on failure; it is not fatal, since
	# the binary is installed either way.
	persist_path "$dir" || return 0
	# Make the just-installed binary usable for the rest of THIS script too
	# (verification steps, `kunai --version`), not only in the next shell.
	export PATH="$dir:$PATH"
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
	local os arch translated asset archive base url sums archive_url archive_sums resolved_version version_path versions_dir
	local staging txn_id txn_path lock_path staged_bin staged_sums staged_archive staged_archive_sums staged_tar
	local want got size_bytes archive_want archive_got archive_size archive_source_url artifact_source_url archive_available archive_name_used
	local target previous activation_previous kind metadata_path
	local activation_lock_path

	os="$(detect_os)"
	arch="$(detect_arch)"
	# Rosetta reports its translated process as x86_64; only Apple's exact
	# translated marker is enough evidence to select the native arm64 build.
	if [[ "$os" == darwin && "$arch" == x64 ]]; then
		translated="$(sysctl -n sysctl.proc_translated 2>/dev/null || true)"
		[[ "$translated" == 1 ]] && arch="arm64"
	fi
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
	[[ "$DRY" == 1 ]] && info "Detected native target: $target"

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

	base="$KUNAI_DL_BASE/download/v$resolved_version"
	url="$base/$asset"
	sums="$base/SHA256SUMS"
	archive="${asset}.tar.gz"
	archive_url="$base/$archive"
	archive_sums="$base/SHA256SUMS.archives"

	versions_dir="$DATA_DIR/versions"
	version_path="$versions_dir/$resolved_version/kunai"

	if [[ "$DRY" == 1 ]]; then
		info "Downloading $asset (v$resolved_version) ..."
		info "[dry-run] curl (bounded) $archive_sums -o <staging>/SHA256SUMS.archives"
		info "[dry-run] curl (bounded) $archive_url -o <staging>/$archive"
		info "[dry-run] verify archive, safely extract $asset, then verify against $sums"
		info "[dry-run] raw compatibility fallback is allowed only for archive HTTP 404/410"
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
	activation_lock_path="$DATA_DIR/locks/activation.lock"
	staged_bin="$staging/$asset"
	staged_sums="$staging/SHA256SUMS"
	staged_archive="$staging/$archive"
	staged_archive_sums="$staging/SHA256SUMS.archives"
	staged_tar="$staging/$asset.tar"
	metadata_path="$versions_dir/$resolved_version/version.json"
	INSTALL_TXN_PATH="$txn_path"
	INSTALL_VERSION_LOCK_PATH="$lock_path"
	INSTALL_STAGING_PATH="$staging"
	INSTALL_ACTIVATION_LOCK_PATH="$activation_lock_path"
	INSTALL_ACTIVATION_LOCK_HELD=0
	INSTALL_LAUNCHER_ACTIVATED=0
	INSTALL_PRESERVE_LAUNCHER_SNAPSHOT=0

	cleanup_install_state() {
		if [[ "$INSTALL_ACTIVATION_LOCK_HELD" == 1 ]]; then
			if [[ "$INSTALL_LAUNCHER_ACTIVATED" == 1 ]]; then
				if ! restore_launcher_snapshot "$BIN_DIR/kunai" 2>/dev/null; then
					INSTALL_PRESERVE_LAUNCHER_SNAPSHOT=1
				fi
			fi
			release_activation_lock "$INSTALL_ACTIVATION_LOCK_PATH" "$ACTIVATION_LOCK_OWNER_ID" 2>/dev/null || true
			INSTALL_ACTIVATION_LOCK_HELD=0
		fi
		if [[ "$INSTALL_PRESERVE_LAUNCHER_SNAPSHOT" != 1 ]]; then
			discard_launcher_snapshot 2>/dev/null || true
		fi
		finish_transaction "$INSTALL_TXN_PATH" 2>/dev/null || true
		release_version_lock "$INSTALL_VERSION_LOCK_PATH" 2>/dev/null || true
		rm -rf "$INSTALL_STAGING_PATH" 2>/dev/null || true
		# Prune empty version/staging parents left by mkdir -p.
		rmdir "$(dirname "$INSTALL_STAGING_PATH")" 2>/dev/null || true
		rmdir "$CACHE_DIR/staging" 2>/dev/null || true
	}
	trap cleanup_install_state EXIT

	acquire_version_lock "$resolved_version" "$lock_path" || exit 1
	# Under the version lock: reclaim abandoned txn/staging residue for this
	# version so a crashed prior attempt cannot leave operational leftovers.
	cleanup_abandoned_transactions
	rm -rf "$CACHE_DIR/staging/$resolved_version"
	mkdir -p "$staging"
	begin_transaction "$txn_id" "$kind" "$resolved_version" "$staging" "$txn_path"

	info "Downloading $asset (v$resolved_version) ..."
	archive_available=1
	archive_got=""
	archive_size=""
	archive_source_url=""
	archive_name_used=""
	artifact_source_url="$url"
	if ! bounded_download "$archive_sums" "$staged_archive_sums" "$DOWNLOAD_CHECKSUM_MAX_BYTES" "SHA256SUMS.archives"; then
		if [[ "$BOUNDED_DOWNLOAD_HTTP_STATUS" == 404 || "$BOUNDED_DOWNLOAD_HTTP_STATUS" == 410 ]]; then
			archive_available=0
			info "Archive checksums are unavailable for v$resolved_version; using the legacy raw asset."
		else
			download_failed_hint "SHA256SUMS.archives"
			exit 1
		fi
	fi

	if [[ "$archive_available" == 1 ]]; then
		if ! archive_want="$(checksum_for_asset "$staged_archive_sums" "$archive")"; then
			err "SHA256SUMS.archives must contain exactly one valid entry for $archive."
			exit 1
		fi
		if ! bounded_download "$archive_url" "$staged_archive" "$DOWNLOAD_ARCHIVE_MAX_BYTES" "$archive"; then
			if [[ "$BOUNDED_DOWNLOAD_HTTP_STATUS" == 404 || "$BOUNDED_DOWNLOAD_HTTP_STATUS" == 410 ]]; then
				archive_available=0
				info "Archive asset is unavailable for v$resolved_version; using the legacy raw asset."
			else
				download_failed_hint "$archive"
				exit 1
			fi
		fi
	fi

	if [[ "$archive_available" == 1 ]]; then
		archive_got="$(sha256_of "$staged_archive")"
		if [[ "$archive_want" != "$archive_got" ]]; then
			err "Checksum mismatch for $archive (expected $archive_want, got $archive_got)."
			exit 1
		fi
		archive_name_used="$archive"
	fi

	if ! bounded_download "$sums" "$staged_sums" "$DOWNLOAD_CHECKSUM_MAX_BYTES" "SHA256SUMS"; then
		download_failed_hint "SHA256SUMS"
		exit 1
	fi
	if ! want="$(checksum_for_asset "$staged_sums" "$asset")"; then
		err "SHA256SUMS has no entry for $asset, or has duplicate/malformed entries; the release is incomplete."
		exit 1
	fi

	if [[ "$archive_available" == 1 ]]; then
		if ! extract_release_tar_gz "$staged_archive" "$staged_tar" "$asset" "$staged_bin"; then
			exit 1
		fi
		archive_size="$(wc -c <"$staged_archive" | tr -d ' ')"
		archive_source_url="$archive_url"
		artifact_source_url="$archive_url"
	else
		if ! bounded_download "$url" "$staged_bin" "$DOWNLOAD_MAX_BYTES" "$asset"; then
			download_failed_hint "$asset"
			exit 1
		fi
	fi
	if [[ ! -s "$staged_bin" ]]; then
		err "Downloaded or extracted asset $asset is empty; the release is incomplete."
		exit 1
	fi
	got="$(sha256_of "$staged_bin")"
	size_bytes="$(wc -c <"$staged_bin" | tr -d ' ')"
	if [[ "$size_bytes" -gt "$EXTRACTED_BINARY_MAX_BYTES" ]]; then
		err "Binary size $size_bytes exceeds the $EXTRACTED_BINARY_MAX_BYTES byte budget."
		exit 1
	fi
	if [[ "$want" != "$got" ]]; then
		err "Checksum mismatch for extracted $asset (expected $want, got $got)."
		exit 1
	fi

	mkdir -p "$(dirname "$version_path")"
	# Atomic install into version store: same-dir temp + rename.
	local version_tmp="${version_path}.tmp.$$"
	install -m 0755 "$staged_bin" "$version_tmp"
	mv -f "$version_tmp" "$version_path"

	write_version_metadata "$resolved_version" "$target" "$asset" "$got" "$size_bytes" "$artifact_source_url" "$metadata_path"

	if [[ "$os" == darwin ]]; then
		xattr -d com.apple.quarantine "$version_path" 2>/dev/null || true

		# Ad-hoc sign on the user's own Mac.
		#
		# Release binaries are cross-compiled on Linux, where `codesign` does not
		# exist, so they arrive unsigned. Intel macOS tolerates that; Apple
		# Silicon does not — the kernel refuses to exec an unsigned arm64 binary
		# and the shell reports only "killed: 9", with nothing pointing at the
		# signature as the cause. `codesign --sign -` is a local, identity-free
		# signature that satisfies the loader; it is not notarization and makes
		# no claim about provenance, which the checksum verified above already
		# covers.
		if [[ "$arch" == arm64 ]] && have codesign; then
			if codesign --force --sign - "$version_path" 2>/dev/null; then
				info "Ad-hoc signed the binary for Apple Silicon."
			else
				warn "Could not ad-hoc sign $version_path; if macOS reports 'killed',"
				warn "run: codesign --force --sign - \"$version_path\""
			fi
		fi
		info "Cleared macOS quarantine when present (Gatekeeper may still prompt on first launch)."
	fi

	acquire_activation_lock "$resolved_version" "$activation_lock_path" || exit 1
	INSTALL_ACTIVATION_LOCK_HELD=1
	# Another version may have activated during this download. Read shared state
	# under the cross-version lock before publishing the launcher and manifest.
	activation_previous="$(read_previous_active_version || true)"
	if ! snapshot_launcher "$BIN_DIR/kunai"; then
		err "Could not snapshot the current launcher before activation."
		exit 1
	fi
	if ! activate_launcher "$version_path" "$BIN_DIR/kunai"; then
		err "Could not activate the launcher for version $resolved_version."
		exit 1
	fi
	INSTALL_LAUNCHER_ACTIVATED=1

	local prev_arg=""
	if [[ -n "$activation_previous" && "$activation_previous" != "$resolved_version" ]]; then
		prev_arg="$activation_previous"
	fi
	if ! write_manifest binary "$resolved_version" "$BIN_DIR/kunai" "$version_path" "$target" "$got" "$prev_arg" \
		"$asset" "$size_bytes" "$archive_name_used" "$archive_got" "$archive_size" "$archive_source_url"; then
		err "Could not publish install.json; restoring the previous launcher."
		if ! restore_launcher_snapshot "$BIN_DIR/kunai"; then
			err "Launcher restoration failed; inspect $LAUNCHER_SNAPSHOT_BACKUP before retrying."
			INSTALL_PRESERVE_LAUNCHER_SNAPSHOT=1
		fi
		INSTALL_LAUNCHER_ACTIVATED=0
		exit 1
	fi
	INSTALL_LAUNCHER_ACTIVATED=0
	discard_launcher_snapshot
	release_activation_lock "$activation_lock_path" "$ACTIVATION_LOCK_OWNER_ID"
	INSTALL_ACTIVATION_LOCK_HELD=0

	finish_transaction "$txn_path"
	release_version_lock "$lock_path"
	rm -rf "$staging"
	rmdir "$(dirname "$staging")" 2>/dev/null || true
	rmdir "$CACHE_DIR/staging" 2>/dev/null || true
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
	local resolved launcher publication_lock="$DATA_DIR/locks/activation.lock" publication_owner publication_version
	require node
	require npm
	if [[ "$VERSION" != latest ]]; then
		resolved="$(normalize_requested_version "$VERSION")" || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
	else
		resolved="latest"
	fi
	if [[ "$DRY" == 0 ]]; then
		publication_version="$resolved"
		[[ "$publication_version" == latest ]] && publication_version="0.0.0"
		mkdir -p "$DATA_DIR/locks" || exit 1
		acquire_activation_lock "$publication_version" "$publication_lock" || exit 1
		publication_owner="$ACTIVATION_LOCK_OWNER_ID"
		trap 'release_activation_lock "$publication_lock" "$publication_owner" 2>/dev/null || true' EXIT
	fi
	info "Installing $KUNAI_PACKAGE with npm..."
	if [[ "$resolved" == latest ]]; then
		run npm install -g "$KUNAI_PACKAGE"
	else
		run npm install -g "${KUNAI_PACKAGE}@${resolved}"
	fi
	resolved="$(finalize_package_active_version npm "$resolved")" || exit 1
	if [[ "$DRY" == 1 ]]; then launcher="kunai"; else launcher="$(resolve_owned_package_launcher npm)" || exit 1; fi
	write_manifest npm-global "${resolved}" "$launcher"
	[[ "$DRY" == 1 ]] || release_activation_lock "$publication_lock" "$publication_owner"
	[[ "$DRY" == 1 ]] || trap - EXIT
	[[ "$DRY" == 1 ]] || path_hint "$(dirname "$launcher")"
}

install_bun() {
	local resolved launcher publication_lock="$DATA_DIR/locks/activation.lock" publication_owner publication_version
	ensure_bun
	if [[ "$VERSION" != latest ]]; then
		resolved="$(normalize_requested_version "$VERSION")" || {
			err "Invalid version: $VERSION (expected exact major.minor.patch)."
			exit 1
		}
	else
		resolved="latest"
	fi
	if [[ "$DRY" == 0 ]]; then
		publication_version="$resolved"
		[[ "$publication_version" == latest ]] && publication_version="0.0.0"
		mkdir -p "$DATA_DIR/locks" || exit 1
		acquire_activation_lock "$publication_version" "$publication_lock" || exit 1
		publication_owner="$ACTIVATION_LOCK_OWNER_ID"
		trap 'release_activation_lock "$publication_lock" "$publication_owner" 2>/dev/null || true' EXIT
	fi
	info "Installing $KUNAI_PACKAGE with bun..."
	if [[ "$resolved" == latest ]]; then
		run bun install -g "$KUNAI_PACKAGE"
	else
		run bun install -g "${KUNAI_PACKAGE}@${resolved}"
	fi
	resolved="$(finalize_package_active_version bun "$resolved")" || exit 1
	if [[ "$DRY" == 1 ]]; then launcher="kunai"; else launcher="$(resolve_owned_package_launcher bun)" || exit 1; fi
	write_manifest bun-global "${resolved}" "$launcher"
	[[ "$DRY" == 1 ]] || release_activation_lock "$publication_lock" "$publication_owner"
	[[ "$DRY" == 1 ]] || trap - EXIT
	[[ "$DRY" == 1 ]] || path_hint "$(dirname "$launcher")"
}

install_source() {
	local source_path data_path config_path cache_path resolved publication_lock="$DATA_DIR/locks/activation.lock" publication_owner publication_version
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
	if [[ "$DRY" == 0 ]]; then
		publication_version="$resolved"
		[[ "$publication_version" == latest ]] && publication_version="0.0.0"
		mkdir -p "$DATA_DIR/locks" || exit 1
		acquire_activation_lock "$publication_version" "$publication_lock" || exit 1
		publication_owner="$ACTIVATION_LOCK_OWNER_ID"
		trap 'release_activation_lock "$publication_lock" "$publication_owner" 2>/dev/null || true' EXIT
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
	resolved="$(finalize_package_active_version source "$resolved")" || exit 1
	write_manifest source "$resolved" "$(command -v kunai || echo kunai)"
	[[ "$DRY" == 1 ]] || release_activation_lock "$publication_lock" "$publication_owner"
	[[ "$DRY" == 1 ]] || trap - EXIT
}

install_optional_deps() {
	[[ "$SKIP_DEPS" == 1 || "$DRY" == 1 ]] && return
	local pkgs=()
	ask "Install mpv (required for playback)?" y && pkgs+=(mpv)
	ask "Install yt-dlp (YouTube playback and downloads)?" y && pkgs+=(yt-dlp)
	# No poster dependency to offer: every renderer consumes one natively
	# prepared image, and half-block is the universal in-process floor.
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
	# Print the leading comment block by content, not by line number: a
	# hardcoded range silently truncates the help text the moment a line is
	# added above it.
	sed -n '2,/^$/p' "$0" | sed 's/^#\s\{0,1\}//'
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
		--skip-path-update)
			SKIP_PATH_UPDATE=1
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
