import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const CLI_SRC = join(import.meta.dir, "../../../src");

/** Existing PascalCase `.ts` files (migration allowlist — shrink when renaming). */
const PASCAL_CASE_TS_ALLOWLIST = new Set<string>();

/** Existing kebab-case `.tsx` files outside PascalCase / *-shell / *-ui naming (migration allowlist). */
const TSX_NAMING_ALLOWLIST = new Set([
  "app-shell/dot-matrix-loader.tsx",
  "app-shell/library-title-detail.tsx",
  "app-shell/offscreen-freeze.tsx",
  "app-shell/overlay-layout-context.tsx",
  "app-shell/overlay-panel.tsx",
  "app-shell/overlay-picker-row.tsx",
  "app-shell/picker-overlay.tsx",
  "app-shell/playback-playing-rail.tsx",
  "app-shell/poster-initial-block.tsx",
  "app-shell/root-status-shells.tsx",
  "app-shell/shell-command-mode.tsx",
  "app-shell/shell-frame.tsx",
  "app-shell/shell-primitives.tsx",
  "app-shell/skeleton.tsx",
]);

const ROOT_TS_ALLOWLIST = new Set([
  "main.ts",
  "container.ts",
  "cli-args.ts",
  "asset-modules.d.ts",
  "aniskip.ts",
  "introdb.ts",
  "logger.ts",
  "menu.ts",
  "mpv.ts",
  "search.ts",
  "session-flow.ts",
  "subtitle.ts",
  "tmdb.ts",
  "ui.ts",
]);

function walkTsFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkTsFiles(absolute, files);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(relative(CLI_SRC, absolute));
    }
  }
  return files;
}

for (const file of walkTsFiles(CLI_SRC)) {
  const name = basename(file, ".ts");
  if (/^[A-Z]/.test(name) && !name.endsWith(".model")) {
    PASCAL_CASE_TS_ALLOWLIST.add(file);
  }
}

describe("filename conventions", () => {
  test("PascalCase .ts files stay on the migration allowlist only", () => {
    const violations: string[] = [];
    for (const file of walkTsFiles(CLI_SRC)) {
      const name = basename(file, ".ts");
      if (!/^[A-Z]/.test(name) || name.endsWith(".model")) continue;
      if (!PASCAL_CASE_TS_ALLOWLIST.has(file)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  test("tsx files use PascalCase, *-shell.tsx, or *-ui.tsx", () => {
    const violations: string[] = [];
    function walkTsx(directory: string) {
      for (const entry of readdirSync(directory)) {
        const absolute = join(directory, entry);
        if (statSync(absolute).isDirectory()) {
          if (entry === "node_modules" || entry === "dist") continue;
          walkTsx(absolute);
          continue;
        }
        if (!entry.endsWith(".tsx")) continue;
        const rel = relative(CLI_SRC, absolute);
        const ok =
          /^[A-Z]/.test(entry) || entry.endsWith("-shell.tsx") || entry.endsWith("-ui.tsx");
        if (!ok && !TSX_NAMING_ALLOWLIST.has(rel)) violations.push(rel);
      }
    }
    walkTsx(CLI_SRC);
    expect(violations).toEqual([]);
  });

  test("apps/cli/src root has no unexpected new .ts files", () => {
    const rootFiles = readdirSync(CLI_SRC).filter(
      (entry) => entry.endsWith(".ts") && statSync(join(CLI_SRC, entry)).isFile(),
    );
    const unexpected = rootFiles.filter((file) => !ROOT_TS_ALLOWLIST.has(file));
    expect(unexpected).toEqual([]);
  });
});
