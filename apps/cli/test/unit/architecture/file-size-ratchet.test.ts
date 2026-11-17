import { describe, expect, test } from "bun:test";

import { readRepoFile } from "../../support/repo-scan";

/**
 * Line-count ratchet for the oversized CLI modules scheduled for splitting.
 *
 * Lowering a cap after extracting code is always fine (and encouraged).
 * Raising a cap needs an explicit reason in the PR description explaining why
 * the new code could not live in an extracted sibling module instead.
 */
const LINE_COUNT_CAPS: ReadonlyArray<{
  readonly file: string;
  readonly maxLines: number;
  readonly splitPlan: string;
}> = [
  {
    file: "apps/cli/src/app/playback/PlaybackPhase.ts",
    maxLines: 5026,
    splitPlan: ".plans/012-decompose-playback-phase.md",
  },
  {
    file: "apps/cli/src/app-shell/workflows/shell-workflows.ts",
    maxLines: 3549,
    splitPlan: ".plans/011-split-shell-workflows.md",
  },
  {
    file: "apps/cli/src/services/download/DownloadService.ts",
    maxLines: 3087,
    splitPlan: ".plans/2026-11-17-split-download-service.md",
  },
  {
    file: "apps/cli/src/app-shell/browse-shell.tsx",
    maxLines: 2906,
    splitPlan: ".plans/cli-structure-and-naming.md",
  },
  {
    file: "apps/cli/src/app-shell/root-overlay-shell.tsx",
    maxLines: 2794,
    splitPlan: ".plans/013-split-ink-shell-host-surface.md",
  },
  {
    file: "apps/cli/src/app-shell/ink-shell.tsx",
    maxLines: 2502,
    splitPlan: ".plans/013-split-ink-shell-host-surface.md",
  },
];

function countLines(source: string): number {
  const normalized = source.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  return normalized.endsWith("\n") ? lines.length - 1 : lines.length;
}

describe("file size ratchet", () => {
  test("oversized modules stay at or below their pinned line counts", () => {
    const violations: string[] = [];

    for (const entry of LINE_COUNT_CAPS) {
      const actualLines = countLines(readRepoFile(entry.file));
      if (actualLines > entry.maxLines) {
        const over = actualLines - entry.maxLines;
        violations.push(
          `${entry.file}: ${actualLines} lines (+${over} lines over cap of ${entry.maxLines}). ` +
            `Extract into sibling modules per ${entry.splitPlan} (indexed in .plans/roadmap.md) ` +
            `instead of growing this file.`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
