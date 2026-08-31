import generated from "./generated-release-notes.json";

export type ReleasePublicationStatus = "staged" | "published" | "withdrawn";

export type ReleaseNotesSection = {
  readonly title: string;
  readonly body: string;
  readonly items: readonly string[];
};

export type ReleaseNotesArtifact = {
  readonly schemaVersion: 2;
  readonly status: ReleasePublicationStatus;
  readonly publishedAt: string | null;
  readonly packageName: string;
  readonly version: string;
  readonly tag: string;
  readonly title: string;
  readonly date: string | null;
  readonly summary: string;
  readonly sections: readonly ReleaseNotesSection[];
  readonly changelogBody?: string;
  readonly install: {
    readonly npm: string;
    readonly bunx: string;
    readonly binaryLatest: string;
  };
  readonly assets?: readonly { readonly name: string; readonly sha256: string }[];
};

/**
 * Every release artifact the site renders, newest first.
 *
 * Baked from `.release/*.json` at build time by `apps/docs/scripts/sync-repo-content.ts`.
 * This module used to `readdirSync` that directory at request time, which
 * static tracing cannot follow — see that script's header.
 */
export const releaseNotesArtifacts = generated as readonly ReleaseNotesArtifact[];

export function publishedReleaseNotesArtifacts(): readonly ReleaseNotesArtifact[] {
  return releaseNotesArtifacts.filter((artifact) => artifact.status === "published");
}

/**
 * Releases that were pulled after shipping.
 *
 * `withdrawn` is the status the withdraw runbook sets
 * (`.docs/release-reliability-gate.md` § "Withdrawing a Released Version").
 * Step 4 of that runbook makes the docs site one of the three places a
 * withdrawal has to become visible, because "a withdrawn version that is
 * withdrawn silently gets reinstalled from a cached tarball, a pinned CI file,
 * or a blog post". These artifacts must therefore stay reachable and be marked
 * — never quietly dropped.
 */
export function withdrawnReleaseNotesArtifacts(): readonly ReleaseNotesArtifact[] {
  return releaseNotesArtifacts.filter((artifact) => artifact.status === "withdrawn");
}

/**
 * Releases the sitemap may advertise to search engines.
 *
 * A withdrawn release keeps its page — an old link must land on the warning
 * rather than a 404 — but asking crawlers to keep it in the index works
 * against the withdrawal. The page itself also carries `robots: noindex`.
 */
export function indexableReleaseNotesArtifacts(): readonly ReleaseNotesArtifact[] {
  return releaseNotesArtifacts.filter((artifact) => artifact.status !== "withdrawn");
}

export function latestReleaseNotesArtifact(): ReleaseNotesArtifact | null {
  return publishedReleaseNotesArtifacts()[0] ?? null;
}

/** Normalize tags like `v0.3.0` or `0.3.0` for lookup. */
export function normalizeReleaseTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function releasePath(tag: string): string {
  return `/releases/${normalizeReleaseTag(tag)}`;
}

export function getReleaseByTag(tag: string): ReleaseNotesArtifact | null {
  const normalized = normalizeReleaseTag(tag);
  return (
    releaseNotesArtifacts.find((release) => normalizeReleaseTag(release.tag) === normalized) ?? null
  );
}

export function githubReleaseTagUrl(tag: string): string {
  return `https://github.com/KitsuneKode/kunai/releases/tag/${normalizeReleaseTag(tag)}`;
}

/** Public GitHub release URL — only for published artifacts. */
export function githubReleaseUrl(release: ReleaseNotesArtifact): string | null {
  if (release.status !== "published") return null;
  return githubReleaseTagUrl(release.tag);
}

/** Checksums visible only for published releases. */
export function releaseAssetsForDisplay(
  release: ReleaseNotesArtifact,
): readonly { readonly name: string; readonly sha256: string }[] {
  if (release.status !== "published") return [];
  return release.assets ?? [];
}

function sectionItemsFromMarkdownBody(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

/**
 * Prefer explicit `sections`. An artifact can carry none, so derive display
 * sections from `changelogBody` markdown headings, falling back to summary
 * paragraphs.
 */
export function displaySectionsForRelease(
  release: ReleaseNotesArtifact,
): readonly ReleaseNotesSection[] {
  if (release.sections.length > 0) {
    // Explicit sections only cover text under a `###` heading. A body whose only
    // heading is trailing -- 0.3.0 carries one `### Privacy` at the end -- puts the
    // whole release above it into `summary`, and returning sections alone dropped it.
    const summary = release.summary?.trim();
    const summaryAlreadyShown =
      !summary ||
      release.sections.some(
        (section) => section.title === "Overview" || section.body.trim() === summary,
      );
    if (summaryAlreadyShown) return release.sections;
    const items = sectionItemsFromMarkdownBody(summary);
    return [
      {
        title: "Overview",
        body: summary,
        items: items.length > 0 ? items : [summary.split(/\n{2,}/)[0]?.trim() ?? summary],
      },
      ...release.sections,
    ];
  }

  const source = (release.changelogBody ?? release.summary).trim();
  if (!source) return [];

  const headingSplit = source.split(/\n(?=###\s+)/);
  if (headingSplit.length > 1 || source.startsWith("### ")) {
    const sections: ReleaseNotesSection[] = [];
    for (const chunk of headingSplit) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^###\s+(.+?)\n([\s\S]*)$/);
      if (match?.[1] && match[2] !== undefined) {
        const title = match[1].trim();
        const body = match[2].trim();
        sections.push({
          title,
          body,
          items: sectionItemsFromMarkdownBody(body),
        });
      } else if (!trimmed.startsWith("### ")) {
        // Leading prose before first ### — treat as Overview
        const items = sectionItemsFromMarkdownBody(trimmed);
        sections.push({
          title: "Overview",
          body: trimmed,
          items: items.length > 0 ? items : [trimmed.split(/\n{2,}/)[0]?.trim() ?? trimmed],
        });
      }
    }
    if (sections.length > 0) return sections;
  }

  const paragraphs = source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  return [
    {
      title: "Overview",
      body: source,
      items: paragraphs,
    },
  ];
}

export function releaseOneLineSummary(release: ReleaseNotesArtifact): string {
  const first = release.summary
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find(Boolean);
  if (!first) return release.title;
  const compact = first.replace(/\s+/g, " ").trim();
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177).trimEnd()}…`;
}
