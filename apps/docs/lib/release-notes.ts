import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseNotesSection = {
  readonly title: string;
  readonly body: string;
  readonly items: readonly string[];
};

export type ReleaseNotesArtifact = {
  readonly schemaVersion: 1;
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

function thisDir(): string {
  // Bun exposes import.meta.dir; Next/Turbopack does not — use import.meta.url there.
  if (typeof import.meta.dir === "string" && import.meta.dir.length > 0) {
    return import.meta.dir;
  }
  if (typeof import.meta.url === "string" && import.meta.url.startsWith("file:")) {
    return fileURLToPath(new URL(".", import.meta.url));
  }
  return process.cwd();
}

function repoRoot(): string {
  // Prefer path relative to this module (apps/docs/lib → monorepo root).
  // Fall back to Next's usual cwd (apps/docs) or an already-at-root cwd.
  const candidates = [
    resolve(thisDir(), "../../.."),
    resolve(process.cwd(), "../.."),
    process.cwd(),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, ".release"))) return candidate;
  }
  return candidates[0] ?? process.cwd();
}

function releaseDir(): string {
  return join(repoRoot(), ".release");
}

export function readReleaseNotesArtifacts(): readonly ReleaseNotesArtifact[] {
  const dir = releaseDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as ReleaseNotesArtifact)
    .filter(
      (artifact) => artifact.schemaVersion === 1 && artifact.packageName === "@kitsunekode/kunai",
    );
}

export function latestReleaseNotesArtifact(): ReleaseNotesArtifact | null {
  return readReleaseNotesArtifacts()[0] ?? null;
}

/** Normalize tags like `v0.2.6` or `0.2.6` for lookup. */
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
    readReleaseNotesArtifacts().find(
      (release) => normalizeReleaseTag(release.tag) === normalized,
    ) ?? null
  );
}

export function githubReleaseTagUrl(tag: string): string {
  return `https://github.com/KitsuneKode/kunai/releases/tag/${normalizeReleaseTag(tag)}`;
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
 * Prefer explicit `sections`. When empty (e.g. 0.2.6), derive display sections
 * from `changelogBody` markdown headings or fall back to summary paragraphs.
 */
export function displaySectionsForRelease(
  release: ReleaseNotesArtifact,
): readonly ReleaseNotesSection[] {
  if (release.sections.length > 0) {
    return release.sections;
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
