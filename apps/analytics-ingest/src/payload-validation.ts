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

/**
 * `process.platform` values Kunai builds for, plus `android`.
 *
 * Bun on Android reports `linux`, so an Android build only shows up as itself
 * once the client sends `android` deliberately. Accepting it here first is the
 * deployment order: a client that sent it before this deployed would get a 400
 * and back off for 24 hours.
 */
export const ALLOWED_OS = ["linux", "darwin", "win32", "android"] as const;

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

/** A `YYYY-MM-DD` label that names a real calendar day. */
const DAY_LABEL_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Validates the shape of a label the client derived. It never derives one: the
 * ingest's own label comes from `analytics-day.ts` and nowhere else.
 */
export function isValidDayLabel(value: string): boolean {
  const match = DAY_LABEL_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Pure arithmetic, so this cannot become a second day clock: `2026-02-31` fails here.
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= daysInMonth;
}

/**
 * The earliest cohort month the ingest accepts. Kunai's analytics did not
 * exist before it, so an older cohort is a fabricated one.
 */
export const EARLIEST_COHORT = "2024-01";

const MONTH_LABEL_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A `YYYY-MM` label no earlier than {@link EARLIEST_COHORT}. */
export function isValidCohort(value: string): boolean {
  return MONTH_LABEL_RE.test(value) && value >= EARLIEST_COHORT;
}
