/**
 * Value-level validation for telemetry payload dimensions.
 *
 * `version`, `os`, and `arch` are aggregation keys, not display strings — a
 * polluted value corrupts a whole dimension rather than one rendered label.
 * Validation is an allowlist by design; a denylist would leak.
 *
 * Shared by every ingest endpoint so the accepted value space cannot drift
 * between them.
 */

/** Official semver, anchored, no leading `v`, no leading zeros. */
export const SEMVER_RE =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** `process.platform` values Kunai builds for. */
export const ALLOWED_OS = ["linux", "darwin", "win32"] as const;

/** `process.arch` values Kunai builds for. */
export const ALLOWED_ARCH = ["x64", "arm64"] as const;

/** Guards against pathological regex input before the pattern ever runs. */
const MAX_VERSION_LEN = 64;

export function isValidVersion(value: string): boolean {
  if (!value || value.length > MAX_VERSION_LEN) return false;
  return SEMVER_RE.test(value);
}

export function isAllowedOs(value: string): boolean {
  return (ALLOWED_OS as readonly string[]).includes(value);
}

export function isAllowedArch(value: string): boolean {
  return (ALLOWED_ARCH as readonly string[]).includes(value);
}
