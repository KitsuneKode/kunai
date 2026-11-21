import { describe, expect, test } from "bun:test";

import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

const APP_SHELL_ROOT = "apps/cli/src/app-shell";
const SHELL_INK_WRAPPER = "apps/cli/src/app-shell/ShellInk.tsx";

/** Files that may import Ink `Box` or `Text` directly — bypasses colour stripping. */
const INK_BOX_TEXT_ALLOWLIST = new Map<string, string>([
  [SHELL_INK_WRAPPER, "sole ShellInk wrapper"],
]);

const IMPORT_LINE =
  /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']ink["']|import\s+(?:type\s+)?(\w+)\s+from\s+["']ink["']/g;
const BOX_OR_TEXT = /\b(?:type\s+)?(?:Box|Text)\b(?:\s+as\s+\w+)?/;

function inkBoxTextImportEdges(file: string): string[] {
  const source = readRepoFile(file);
  const edges: string[] = [];
  for (const match of source.matchAll(IMPORT_LINE)) {
    const specBlock = match[1] ?? match[2] ?? "";
    if (!BOX_OR_TEXT.test(specBlock)) continue;
    edges.push(file);
    break;
  }
  return edges;
}

describe("app-shell colour stripping", () => {
  test("app-shell imports Box/Text from ink only through ShellInk", () => {
    const offenders = collectSourceFiles(APP_SHELL_ROOT).flatMap((file) => {
      if (INK_BOX_TEXT_ALLOWLIST.has(file)) return [];
      return inkBoxTextImportEdges(file);
    });

    expect(offenders).toEqual([]);
  });
});
