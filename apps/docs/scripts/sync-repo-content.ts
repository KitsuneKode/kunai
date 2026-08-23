/**
 * Bake the monorepo files the docs runtime used to read on demand.
 *
 * `lib/repo-root.ts` (removed) located the monorepo root by probing candidate
 * paths with `existsSync`. Turbopack's file tracer cannot follow a computed
 * path, so it assumed the whole workspace was reachable from every route and
 * pulled it into each NFT list — "Encountered unexpected file in NFT list".
 * Excluding directories in `next.config.mjs` only trimmed the symptom.
 *
 * Reading these at build time removes the cause: nothing under `app/`,
 * `components/`, or `lib/` touches the filesystem any more. All three sources
 * are tracked files that change only with a commit, and every route that reads
 * them is `force-static`, so there was never request-time data to lose.
 *
 * Outputs are committed, like `lib/generated-metadata.json`, and
 * `scripts/check-codegen-freshness.ts` fails CI when they drift from source.
 */
import fs from "node:fs";
import path from "node:path";

import type { ReleaseNotesArtifact } from "../lib/release-notes";
import type { TroubleshootingFaqEntry } from "../lib/troubleshooting-faq";
import { formatGeneratedFile } from "./format-generated-file";

const ROOT_DIR = path.resolve(import.meta.dir, "../../..");
const DOCS_LIB_DIR = path.join(ROOT_DIR, "apps/docs/lib");
const RELEASE_DIR = path.join(ROOT_DIR, ".release");
const DOCS_CONTENT_DIR = path.join(ROOT_DIR, "docs");
const MASCOT_PATH = path.join(ROOT_DIR, ".reference/design/brand/kunai-mascot-og.png");

/** The npm package these docs publish notes for. Other artifacts are ignored. */
const RELEASE_PACKAGE = "@kitsunekode/kunai";

export type GeneratedRepoContent = {
  /** `lib/generated-release-notes.json` */
  readonly releaseNotes: readonly ReleaseNotesArtifact[];
  /** `lib/generated-troubleshooting-faq.json` */
  readonly troubleshootingFaq: readonly TroubleshootingFaqEntry[];
  /** `lib/generated-mascot.json` */
  readonly mascot: { readonly mascotDataUrl: string };
};

function buildReleaseNotes(): readonly ReleaseNotesArtifact[] {
  if (!fs.existsSync(RELEASE_DIR)) return [];

  return fs
    .readdirSync(RELEASE_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map(
      (file) =>
        JSON.parse(fs.readFileSync(path.join(RELEASE_DIR, file), "utf-8")) as ReleaseNotesArtifact,
    )
    .filter((artifact) => artifact.schemaVersion === 2 && artifact.packageName === RELEASE_PACKAGE);
}

export type TroubleshootingSymptom = {
  readonly id: string;
  readonly question: string;
  readonly anchor: string;
};

export function parseTroubleshootingSymptoms(yaml: string): TroubleshootingSymptom[] {
  const symptoms: TroubleshootingSymptom[] = [];
  let current: { id?: string; question?: string; anchor?: string } | null = null;

  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const listMatch = line.match(/^- id:\s*(.+)$/);
    if (listMatch?.[1]) {
      if (current?.id && current.question && current.anchor) {
        symptoms.push(current as TroubleshootingSymptom);
      }
      current = { id: listMatch[1] };
      continue;
    }

    if (!current) continue;
    const questionMatch = line.match(/^question:\s*(.+)$/);
    if (questionMatch?.[1]) {
      current.question = questionMatch[1];
      continue;
    }
    const anchorMatch = line.match(/^anchor:\s*(.+)$/);
    if (anchorMatch?.[1]) {
      current.anchor = anchorMatch[1];
    }
  }

  if (current?.id && current.question && current.anchor) {
    symptoms.push(current as TroubleshootingSymptom);
  }

  return symptoms;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionForAnchor(mdx: string, anchor: string): string | null {
  const headingPattern = new RegExp(`^## ${escapeRegExp(anchor)}\\s*$`, "im");
  const match = headingPattern.exec(mdx);
  if (match === null) return null;

  const start = match.index + match[0].length;
  const rest = mdx.slice(start);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest.trim() : rest.slice(0, nextHeading).trim();
}

export function extractFaqAnswer(section: string): string {
  const symptomsMatch = section.match(/\*\*Symptoms:\*\*\s*(.+)/);
  const tryBlockMatch = section.match(/### What to try\s+([\s\S]*?)(?=###|More:|$)/);
  const trySteps = tryBlockMatch?.[1]
    ? [...tryBlockMatch[1].matchAll(/^\d+\.\s+(.+)$/gm)]
        .map((step) => (step[1] ?? "").replace(/\[[^\]]+\]\([^)]+\)/g, "").trim())
        .filter((step) => step.length > 0)
        .slice(0, 3)
    : [];

  const parts: string[] = [];
  if (symptomsMatch?.[1]) {
    parts.push(symptomsMatch[1].trim());
  }
  if (trySteps.length > 0) {
    parts.push(trySteps.join(" "));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Pure, so the shape can be tested without touching the filesystem. */
export function faqEntriesFrom(input: {
  readonly symptomsYaml: string;
  readonly troubleshootingMdx: string;
}): TroubleshootingFaqEntry[] {
  return parseTroubleshootingSymptoms(input.symptomsYaml).map((symptom) => {
    const section = sectionForAnchor(input.troubleshootingMdx, symptom.anchor);
    const answer = section ? extractFaqAnswer(section) : "";
    return {
      question: symptom.question,
      answer:
        answer.length > 0 ? answer : `See the ${symptom.anchor} section in Kunai troubleshooting.`,
    };
  });
}

function buildFaq(): readonly TroubleshootingFaqEntry[] {
  return faqEntriesFrom({
    symptomsYaml: fs.readFileSync(
      path.join(DOCS_CONTENT_DIR, "troubleshooting-symptoms.yaml"),
      "utf-8",
    ),
    troubleshootingMdx: fs.readFileSync(
      path.join(DOCS_CONTENT_DIR, "users/troubleshooting.mdx"),
      "utf-8",
    ),
  });
}

/**
 * The OG mascot as a data URL.
 *
 * `next/og` needs an inlineable source; the PNG is ~1.3 KB, so base64 costs
 * less than shipping the file and re-reading it. A missing source yields an
 * empty string and the card renders without the mascot.
 */
function buildMascot(): { readonly mascotDataUrl: string } {
  if (!fs.existsSync(MASCOT_PATH)) return { mascotDataUrl: "" };
  const png = fs.readFileSync(MASCOT_PATH);
  return { mascotDataUrl: `data:image/png;base64,${png.toString("base64")}` };
}

export function buildRepoContent(): GeneratedRepoContent {
  return {
    releaseNotes: buildReleaseNotes(),
    troubleshootingFaq: buildFaq(),
    mascot: buildMascot(),
  };
}

/** Generated file name → its payload. One entry per emitted file. */
export function repoContentOutputs(content = buildRepoContent()): Record<string, unknown> {
  return {
    "generated-release-notes.json": content.releaseNotes,
    "generated-troubleshooting-faq.json": content.troubleshootingFaq,
    "generated-mascot.json": content.mascot,
  };
}

export function repoContentPath(fileName: string): string {
  return path.join(DOCS_LIB_DIR, fileName);
}

/**
 * Content identity, not bytes.
 *
 * The writer emits `JSON.stringify(…, 2)` and then hands the file to `oxfmt`,
 * so the file on disk is never byte-identical to what the writer produced.
 * Comparing text would rewrite every file on every run; comparing parsed
 * content is the question both the writer and `check-codegen-freshness.ts`
 * actually mean to ask.
 */
export function repoContentIdentity(value: unknown): string {
  return JSON.stringify(value);
}

/** Parsed content of an emitted file, or `null` when missing or unreadable. */
export function readGeneratedRepoContent(fileName: string): unknown | null {
  const outputPath = repoContentPath(fileName);
  if (!fs.existsSync(outputPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outputPath, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

function main() {
  console.log("Baking repo content the docs runtime must not read at request time...");

  for (const [fileName, payload] of Object.entries(repoContentOutputs())) {
    const outputPath = repoContentPath(fileName);
    const existing = readGeneratedRepoContent(fileName);

    if (existing !== null && repoContentIdentity(existing) === repoContentIdentity(payload)) {
      formatGeneratedFile(outputPath);
      console.log(`Already up to date: ${outputPath}`);
      continue;
    }

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf-8");
    formatGeneratedFile(outputPath);
    console.log(`Generated: ${outputPath}`);
  }
}

if (import.meta.main) {
  main();
}
