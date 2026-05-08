import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PROVIDER_DEFINITIONS } from "@/services/providers/definitions";

function findRepoRoot(start: string): string {
  let directory = start;
  while (directory !== dirname(directory)) {
    try {
      const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (Array.isArray(packageJson.workspaces)) {
        return directory;
      }
    } catch {
      // Keep walking toward the filesystem root.
    }
    directory = dirname(directory);
  }
  return start;
}

function parseActiveProviderIdsFromDocs(markdown: string): string[] {
  const sectionHeader = "## Active Beta Providers";
  const sectionStart = markdown.indexOf(sectionHeader);
  if (sectionStart < 0) return [];

  const nextHeaderIdx = markdown.indexOf("\n## ", sectionStart + sectionHeader.length);
  const section =
    nextHeaderIdx >= 0 ? markdown.slice(sectionStart, nextHeaderIdx) : markdown.slice(sectionStart);

  return Array.from(section.matchAll(/`([a-z0-9-]+)`/g), (match) => match[1] ?? "");
}

describe("provider docs sync", () => {
  test("active provider table matches runtime provider registry", () => {
    const repoRoot = findRepoRoot(process.cwd());
    const providersDoc = readFileSync(join(repoRoot, ".docs/providers.md"), "utf8");

    const docProviderIds = parseActiveProviderIdsFromDocs(providersDoc);
    const runtimeProviderIds = PROVIDER_DEFINITIONS.map((definition) => definition.id);

    expect(docProviderIds).toEqual(runtimeProviderIds);
  });
});
