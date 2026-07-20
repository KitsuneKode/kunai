#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  RELEASE_ARTIFACT_SCHEMA_VERSION,
  publicationStateFromUnknown,
  type ReleaseBinaryChecksum,
  type ReleaseNotesArtifact,
  type ReleaseNotesSection,
} from "./release-artifact.ts";
import { artifactWithoutBinaryChecksums } from "./release-binary-checksums.ts";
import { parseRootChangelogEntry, parseTopCliChangelogEntry } from "./release-changelog.ts";

export type { ReleaseBinaryChecksum, ReleaseNotesArtifact, ReleaseNotesSection };
export { RELEASE_ARTIFACT_SCHEMA_VERSION } from "./release-artifact.ts";

export type BuildReleaseNotesArtifactInput = {
  readonly packageName: string;
  readonly version: string;
  readonly body: string;
  readonly date?: string | null;
};

type ReleaseBodyParts = {
  readonly summary: string;
  readonly sections: readonly ReleaseNotesSection[];
};

const REPO_ROOT = join(import.meta.dirname, "..");
const CLI_PKG = join(REPO_ROOT, "apps/cli/package.json");
const CLI_CHANGELOG = join(REPO_ROOT, "apps/cli/CHANGELOG.md");
const ROOT_CHANGELOG = join(REPO_ROOT, "CHANGELOG.md");
const RELEASE_DIR = join(REPO_ROOT, ".release");

export function parseReleaseBodySections(body: string): ReleaseBodyParts {
  const normalized = body.trim();
  const headingMatches = [...normalized.matchAll(/^### (.+)\s*$/gm)];
  if (headingMatches.length === 0) {
    return { summary: normalized, sections: [] };
  }

  const firstHeading = headingMatches[0];
  const summary = normalized.slice(0, firstHeading?.index ?? 0).trim();
  const sections = headingMatches.map((match, index) => {
    const title = (match[1] ?? "").trim();
    const bodyStart = (match.index ?? 0) + match[0].length;
    const next = headingMatches[index + 1];
    const bodyEnd = next?.index ?? normalized.length;
    const sectionBody = normalized.slice(bodyStart, bodyEnd).trim();
    return {
      title,
      body: sectionBody,
      items: extractTopLevelBullets(sectionBody),
    };
  });

  return { summary, sections };
}

export function buildReleaseNotesArtifact(
  input: BuildReleaseNotesArtifactInput,
): ReleaseNotesArtifact {
  const parts = parseReleaseBodySections(input.body);
  const tag = `v${input.version}`;
  return {
    schemaVersion: RELEASE_ARTIFACT_SCHEMA_VERSION,
    status: "staged",
    publishedAt: null,
    packageName: input.packageName,
    version: input.version,
    tag,
    title: `Kunai ${input.version}`,
    date: input.date ?? null,
    summary: parts.summary,
    sections: parts.sections,
    changelogBody: input.body.trim(),
    install: {
      npm: `npm install -g ${input.packageName}@${input.version}`,
      bunx: `bunx ${input.packageName}@${input.version}`,
      binaryLatest: "https://github.com/KitsuneKode/kunai/releases/latest",
    },
  };
}

export function renderReleaseNotesMarkdown(artifact: ReleaseNotesArtifact): string {
  const lines: string[] = [`# ${artifact.title}`, ""];
  if (artifact.date) {
    lines.push(`Released ${artifact.date}`, "");
  }
  if (artifact.summary) {
    lines.push(artifact.summary, "");
  }
  for (const section of artifact.sections) {
    lines.push(`### ${section.title}`, "", section.body, "");
  }
  return `${normalizeMarkdownEmphasis(lines.join("\n").trimEnd())}\n`;
}

function normalizeMarkdownEmphasis(markdown: string): string {
  return markdown.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "_$1_");
}

function extractTopLevelBullets(sectionBody: string): readonly string[] {
  const items: string[] = [];
  let current: string[] = [];

  for (const line of sectionBody.split("\n")) {
    if (line.startsWith("- ")) {
      if (current.length > 0) items.push(current.join(" ").trim());
      current = [line.slice(2).trim()];
      continue;
    }
    if (current.length > 0 && /^  \S/.test(line)) {
      current.push(line.trim());
    }
  }

  if (current.length > 0) items.push(current.join(" ").trim());
  return items.filter(Boolean);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readReleaseSource(): BuildReleaseNotesArtifactInput {
  const pkg = readJson(CLI_PKG) as { name?: string; version?: string };
  const packageName = pkg.name;
  const version = pkg.version;
  if (!packageName || !version) {
    throw new Error("apps/cli/package.json must include name and version.");
  }

  const rootKey = `v${version}`;
  if (existsSync(ROOT_CHANGELOG)) {
    const rootEntry = parseRootChangelogEntry(readFileSync(ROOT_CHANGELOG, "utf8"), rootKey);
    if (rootEntry) {
      return { packageName, version, body: rootEntry.body };
    }
  }

  const cliEntry = parseTopCliChangelogEntry(readFileSync(CLI_CHANGELOG, "utf8"));
  if (!cliEntry || cliEntry.version !== version) {
    throw new Error(
      `Could not find release notes for ${packageName}@${version}. Run bun run version:packages first.`,
    );
  }
  return { packageName, version, body: cliEntry.body };
}

function artifactPaths(version: string): { readonly json: string; readonly markdown: string } {
  const base = join(RELEASE_DIR, `kunai-v${version}`);
  return { json: `${base}.json`, markdown: `${base}.md` };
}

type PreservedDiskFields = {
  readonly assets?: readonly ReleaseBinaryChecksum[];
  readonly status?: ReleaseNotesArtifact["status"];
  readonly publishedAt?: string | null;
};

function serializeArtifact(
  artifact: ReleaseNotesArtifact,
  preserved?: PreservedDiskFields,
): string {
  const base = artifactWithoutBinaryChecksums(artifact);
  const withPublication =
    preserved?.status !== undefined
      ? {
          ...base,
          status: preserved.status,
          publishedAt: preserved.publishedAt ?? null,
        }
      : base;
  const merged = preserved?.assets
    ? { ...withPublication, assets: preserved.assets }
    : withPublication;
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Checksums and publication state already merged into the artifact on disk.
 *
 * Note generation deliberately does not author checksums — only the release
 * pipeline may (see `release-binary-checksums.ts`). Publication status is owned
 * by `set-release-status.ts`. Carrying both forward keeps regeneration
 * non-destructive.
 */
function readPreservedDiskFields(path: string): PreservedDiskFields | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const publication = publicationStateFromUnknown(onDisk);
    const assets =
      onDisk &&
      typeof onDisk === "object" &&
      "assets" in onDisk &&
      Array.isArray((onDisk as ReleaseNotesArtifact).assets) &&
      (onDisk as ReleaseNotesArtifact).assets!.length > 0
        ? (onDisk as ReleaseNotesArtifact).assets
        : undefined;
    if (!publication && !assets) return undefined;
    return {
      ...(assets ? { assets } : {}),
      ...(publication ? { status: publication.status, publishedAt: publication.publishedAt } : {}),
    };
  } catch {
    // A corrupt artifact is about to be overwritten anyway; nothing to preserve.
    return undefined;
  }
}

export async function writeArtifact({
  path,
  artifact,
}: {
  readonly path: string;
  readonly artifact: ReleaseNotesArtifact;
}): Promise<void> {
  const markdownPath = path.replace(/\.json$/, ".md");
  mkdirSync(dirname(path), { recursive: true });
  const preserved = readPreservedDiskFields(path);
  writeFileSync(path, serializeArtifact(artifact, preserved), "utf8");
  writeFileSync(markdownPath, renderReleaseNotesMarkdown(artifact), "utf8");
  console.log(`[release-notes] wrote ${path}`);
  console.log(`[release-notes] wrote ${markdownPath}`);
}

/** Compare note content only — assets and publication state are owned elsewhere. */
function artifactForNotesCheck(
  artifact: ReleaseNotesArtifact,
): Omit<ReleaseNotesArtifact, "assets" | "status" | "publishedAt"> {
  const {
    assets: _assets,
    status: _status,
    publishedAt: _publishedAt,
    ...rest
  } = artifactWithoutBinaryChecksums(artifact) as ReleaseNotesArtifact;
  return rest;
}

function checkArtifact(artifact: ReleaseNotesArtifact): void {
  const paths = artifactPaths(artifact.version);
  const expectedMarkdown = renderReleaseNotesMarkdown(artifact);
  const errors: string[] = [];

  if (!existsSync(paths.json)) {
    errors.push(`${paths.json} is missing.`);
  } else {
    const onDisk = JSON.parse(readFileSync(paths.json, "utf8")) as ReleaseNotesArtifact;
    const expected = artifactForNotesCheck(artifact);
    const actual = artifactForNotesCheck(onDisk);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`${paths.json} is out of date.`);
    }
  }

  if (!existsSync(paths.markdown)) {
    errors.push(`${paths.markdown} is missing.`);
  } else if (readFileSync(paths.markdown, "utf8") !== expectedMarkdown) {
    errors.push(`${paths.markdown} is out of date.`);
  }

  if (errors.length > 0) {
    console.error("[release-notes] FAILED:");
    for (const error of errors) console.error(`  - ${error}`);
    console.error("Run `bun run release:notes` to regenerate.");
    process.exit(1);
  }
  console.log(`[release-notes] OK — ${artifact.tag} artifacts are in sync.`);
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const artifact = buildReleaseNotesArtifact(readReleaseSource());
  if (check) {
    checkArtifact(artifact);
    return;
  }
  await writeArtifact({ path: artifactPaths(artifact.version).json, artifact });
}

if (import.meta.main) {
  await main();
}
