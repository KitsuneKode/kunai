// =============================================================================
// download-path-naming.ts — where a downloaded file goes, on any OS.
//
// Extracted from DownloadService because naming is the part of downloading that
// is least about downloading and most about the three filesystems we target.
// Buried as a private helper it had no test seam, so the Windows-only rules
// below could not be verified from a Linux CI runner — which is exactly where
// they need to be verified, because almost nobody developing this runs Windows.
// =============================================================================

import type { CanonicalMediaPosition } from "@/domain/media/media-presentation";
import { joinerForNodePlatform } from "@kunai/storage";

/**
 * Characters Windows forbids anywhere in a path component. POSIX only forbids
 * `/` and NUL, but a library written on Linux and copied to a Windows machine
 * (or a synced download folder) has to survive the stricter rule, so the
 * strictest set is applied everywhere. Replacing rather than deleting keeps
 * `Title: Subtitle` reading as two words instead of `TitleSubtitle`.
 */
const ILLEGAL_PATH_CHARS = /[<>:"/\\|?*]+/g;

/**
 * MS-DOS device names. Windows resolves these as devices in *every* directory
 * and with *any* extension, so `NUL.mp4` is not a file — the open succeeds and
 * writes vanish into the void. There are real titles that sanitize down to one
 * of these, and the failure is silent, which makes it worth guarding rather
 * than waiting for a bug report nobody can reproduce on Linux.
 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Practical per-component limit. ext4, APFS and NTFS all cap a single name at
 * 255 — bytes on ext4, UTF-16 code units on NTFS — so 255 *bytes* of UTF-8 is
 * the conservative reading that satisfies all three.
 */
const MAX_COMPONENT_BYTES = 255;

/**
 * Windows' classic `MAX_PATH`. Long-path support exists but is opt-in per
 * machine (registry) and per binary (manifest), so a downloader that assumes it
 * will fail on default installs. Long anime titles reach this easily: the title
 * appears twice in a series path (folder and filename), so a 100-character
 * title spends over 200 characters before the base directory is counted.
 */
const WINDOWS_MAX_PATH = 260;

/** Reserve for the trailing NUL and a little headroom Windows APIs want. */
const WINDOWS_PATH_RESERVE = 12;

const utf8 = new TextEncoder();

function utf8Length(value: string): number {
  return utf8.encode(value).length;
}

/**
 * Truncate to a UTF-8 byte budget without splitting a character.
 *
 * Iterating by code point rather than by `string.length` matters here: titles
 * are routinely CJK (3 bytes per character) and may contain emoji (surrogate
 * pairs), and slicing those by UTF-16 index produces a lone surrogate that some
 * filesystems reject and others store as a name the user cannot delete.
 */
function truncateToBytes(value: string, maxBytes: number): string {
  if (utf8Length(value) <= maxBytes) return value;

  let out = "";
  let used = 0;
  for (const char of value) {
    const size = utf8Length(char);
    if (used + size > maxBytes) break;
    out += char;
    used += size;
  }
  return out;
}

/** Windows rejects a trailing dot or space on any component. */
function stripTrailingDotsAndSpaces(value: string): string {
  return value.replace(/[. ]+$/g, "");
}

/**
 * Make one path component safe on every target OS.
 *
 * Returns an empty string when nothing usable survives; callers supply their
 * own fallback, because a good fallback is context-specific ("Untitled" for a
 * title is meaningful, for a season folder it is not).
 */
export function sanitizePathPart(value: string): string {
  const cleaned = stripTrailingDotsAndSpaces(
    [...value.trim().replaceAll(ILLEGAL_PATH_CHARS, " ")]
      // Control characters are illegal on NTFS and merely awful elsewhere.
      .filter((char) => (char.codePointAt(0) ?? 0) >= 32)
      .join("")
      .replaceAll(/\s+/g, " "),
  );

  if (WINDOWS_RESERVED_NAMES.test(cleaned)) return `${cleaned}_`;
  return cleaned;
}

/**
 * Clamp a component to the filesystem limit, keeping its extension.
 *
 * The extension is what makes the file playable and what mpv and the library
 * scanner match on, so it is preserved and the stem absorbs the truncation.
 */
export function clampComponent(name: string, maxBytes: number = MAX_COMPONENT_BYTES): string {
  if (utf8Length(name) <= maxBytes) return name;

  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0 && dot > name.length - 12;
  const extension = hasExtension ? name.slice(dot) : "";
  const stem = hasExtension ? name.slice(0, dot) : name;

  const budget = Math.max(1, maxBytes - utf8Length(extension));
  return `${stripTrailingDotsAndSpaces(truncateToBytes(stem, budget)) || "file"}${extension}`;
}

export type DownloadPathInput = {
  readonly baseDir: string;
  readonly titleName: string;
  readonly year?: string | null;
  readonly extension: string;
  /**
   * Canonical position from `presentMedia()`. Naming encodes it for the
   * filesystem; it never reinterprets what content kind the item is. That
   * decision belongs to the media-presentation seam alone, so a movie stored
   * with a legacy synthetic season 1/episode 1 cannot reach a filename as
   * `S01E01`.
   */
  readonly position: CanonicalMediaPosition;
  readonly platform?: NodeJS.Platform;
};

/**
 * Where a download lands: `<base>/<Title (Year)>/Season NN/<Title - SxxEyy.ext>`
 * for an episode whose season is meaningful, `<base>/<Title (Year)>/<Title -
 * Exx.ext>` for an episode-only position, and
 * `<base>/<Title (Year)>/<Title (Year).ext>` for a title-level item.
 *
 * The platform is a parameter rather than read from `process.platform` so the
 * Windows rules are testable from Linux — `node:path` always follows the host,
 * which is how a path built "for Windows" ends up with POSIX separators.
 */
export function resolveDownloadOutputPath(input: DownloadPathInput): string {
  const platform = input.platform ?? process.platform;
  const join = joinerForNodePlatform(platform);

  const title = sanitizePathPart(input.titleName) || "Untitled";
  const year = input.year ? sanitizePathPart(input.year) : "";
  const titleWithYear = year ? `${title} (${year})` : title;

  const components: string[] = [titleWithYear];
  let fileStem = titleWithYear;

  if (input.position.kind === "episode") {
    // Clamp defensively. The seam already rejects non-positive values, but a
    // filename is the one artefact a user cannot repair by re-rendering.
    const episode = Math.max(1, Math.trunc(input.position.episode));
    const episodeLabel = String(episode).padStart(2, "0");

    if (input.position.seasonIsMeaningful && input.position.season !== undefined) {
      const seasonLabel = String(Math.max(1, Math.trunc(input.position.season))).padStart(2, "0");
      components.push(`Season ${seasonLabel}`);
      fileStem = `${title} - S${seasonLabel}E${episodeLabel}`;
    } else {
      fileStem = `${title} - E${episodeLabel}`;
    }
  }

  const budget = componentBudget({
    platform,
    baseDir: input.baseDir,
    components,
    fileStem,
    extension: input.extension,
    join,
  });

  const safeComponents = components.map((part) => clampComponent(part, budget));
  const safeFile = clampComponent(`${fileStem}${input.extension}`, budget);

  return join(input.baseDir, ...safeComponents, safeFile);
}

/**
 * How many bytes each variable-length component may spend.
 *
 * On POSIX this is just the per-component limit. On Windows the *total* path is
 * also capped, and the title appears in two components of a series path, so the
 * overrun has to be shared between them rather than charged to whichever
 * component happens to be clamped first.
 */
function componentBudget(input: {
  readonly platform: NodeJS.Platform;
  readonly baseDir: string;
  readonly components: readonly string[];
  readonly fileStem: string;
  readonly extension: string;
  readonly join: (...segments: string[]) => string;
}): number {
  if (input.platform !== "win32") return MAX_COMPONENT_BYTES;

  const full = input.join(
    input.baseDir,
    ...input.components,
    `${input.fileStem}${input.extension}`,
  );
  const overrun = full.length - (WINDOWS_MAX_PATH - WINDOWS_PATH_RESERVE);
  if (overrun <= 0) return MAX_COMPONENT_BYTES;

  // Only the title-derived components can shrink; separators, the season
  // folder and the SxxEyy suffix are structure the user needs to keep.
  const variableCount = Math.max(1, input.components.length);
  const longest = Math.max(
    ...input.components.map((part) => part.length),
    input.fileStem.length + input.extension.length,
  );
  return Math.max(16, longest - Math.ceil(overrun / variableCount));
}

export const __testing = {
  MAX_COMPONENT_BYTES,
  WINDOWS_MAX_PATH,
  WINDOWS_PATH_RESERVE,
  truncateToBytes,
};
