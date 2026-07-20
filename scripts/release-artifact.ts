/**
 * Schema v2 release-notes artifact types and publication-status transitions.
 *
 * Publication state is owned here; note generation defaults new artifacts to
 * staged / publishedAt null. Only `set-release-status.ts` should promote.
 */

export const RELEASE_ARTIFACT_SCHEMA_VERSION = 2 as const;

export type ReleasePublicationStatus = "staged" | "published" | "withdrawn";

export type ReleaseNotesSection = {
  readonly title: string;
  readonly body: string;
  readonly items: readonly string[];
};

export type ReleaseInstallCommands = {
  readonly npm: string;
  readonly bunx: string;
  readonly binaryLatest: string;
};

export type ReleaseBinaryChecksum = {
  readonly name: string;
  readonly sha256: string;
};

export interface ReleaseNotesArtifact {
  readonly schemaVersion: typeof RELEASE_ARTIFACT_SCHEMA_VERSION;
  readonly status: ReleasePublicationStatus;
  readonly publishedAt: string | null;
  readonly packageName: string;
  readonly version: string;
  readonly tag: string;
  readonly title: string;
  readonly date: string | null;
  readonly summary: string;
  readonly sections: readonly ReleaseNotesSection[];
  readonly changelogBody: string;
  readonly install: ReleaseInstallCommands;
  readonly assets?: readonly ReleaseBinaryChecksum[];
}

/**
 * Transition publication status. Assets and note body fields are retained.
 *
 * - staged → published requires an ISO `publishedAt`
 * - published → staged is forbidden (use withdrawn to retire)
 * - withdrawn keeps any existing `publishedAt`
 */
export function transitionReleaseStatus(
  artifact: ReleaseNotesArtifact,
  next: ReleasePublicationStatus,
  publishedAt?: string,
): ReleaseNotesArtifact {
  if (artifact.status === "published" && next === "staged") {
    throw new Error("published release cannot return to staged");
  }

  if (next === "published") {
    if (!publishedAt) {
      throw new Error("publishedAt is required when publishing a release");
    }
    return {
      ...artifact,
      status: "published",
      publishedAt,
    };
  }

  if (next === "staged") {
    return {
      ...artifact,
      status: "staged",
      publishedAt: null,
    };
  }

  // withdrawn — keep publishedAt so history of when it went public remains
  return {
    ...artifact,
    status: "withdrawn",
  };
}

export function isReleasePublicationStatus(value: unknown): value is ReleasePublicationStatus {
  return value === "staged" || value === "published" || value === "withdrawn";
}

/** Read status/publishedAt from an on-disk artifact when already schema v2. */
export function publicationStateFromUnknown(value: unknown): {
  readonly status: ReleasePublicationStatus;
  readonly publishedAt: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isReleasePublicationStatus(record.status)) return null;
  const publishedAt =
    record.publishedAt === null
      ? null
      : typeof record.publishedAt === "string"
        ? record.publishedAt
        : null;
  return { status: record.status, publishedAt };
}
