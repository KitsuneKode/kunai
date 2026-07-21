/**
 * Strict stable release versions for Kunai install/update paths.
 * Exact `major.minor.patch` only — no leading zeros, prerelease, build, or path-like input.
 */

export type CanonicalVersion = string & { readonly __canonicalVersion: unique symbol };

const CANONICAL_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Accept only an exact stable `major.minor.patch` string. */
export function parseCanonicalVersion(value: string): CanonicalVersion | null {
  if (!CANONICAL_VERSION_RE.test(value)) return null;
  return value as CanonicalVersion;
}

/** Normalize a user/CLI request (`v1.2.3` → `1.2.3`); reject non-stable forms. */
export function normalizeRequestedVersion(value: string): CanonicalVersion | null {
  const trimmed = value.trim().replace(/^v/i, "");
  return parseCanonicalVersion(trimmed);
}

/**
 * Extract a strict stable version from a published tag
 * (`v1.2.3`, `@kitsunekode/kunai@0.3.0`, `kunai-0.4.1`).
 * Rejects leading zeros, prerelease, and build suffixes.
 */
export function parsePublishedVersionTag(value: string | undefined): CanonicalVersion | null {
  if (!value) return null;

  const re = /(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = value.charAt(start - 1);
    const after = value.charAt(end);

    // Prerelease/build on this X.Y.Z — never harvest a later numeric fragment.
    if (after === "-" || after === "+") {
      return null;
    }

    // Allow a single leading `v`/`V`; reject digits/letters glued on either side.
    // Alphanumeric glue may precede a later clean tag (e.g. fragments before `@pkg@1.2.3`).
    if (before && before !== "v" && before !== "V" && /[0-9A-Za-z]/.test(before)) {
      continue;
    }
    // Reject continuation (`.4`, trailing digit/letter glued).
    if (after && /[0-9A-Za-z.]/.test(after)) {
      continue;
    }

    return parseCanonicalVersion(match[0]);
  }

  return null;
}

/** Compare two canonical versions: negative if left < right, 0 if equal, positive if left > right. */
export function compareCanonicalVersions(left: CanonicalVersion, right: CanonicalVersion): number {
  const [lMajor, lMinor, lPatch] = left.split(".").map((part) => Number.parseInt(part, 10));
  const [rMajor, rMinor, rPatch] = right.split(".").map((part) => Number.parseInt(part, 10));
  if (lMajor !== rMajor) return (lMajor ?? 0) - (rMajor ?? 0);
  if (lMinor !== rMinor) return (lMinor ?? 0) - (rMinor ?? 0);
  return (lPatch ?? 0) - (rPatch ?? 0);
}
