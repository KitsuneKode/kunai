import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function findRepoRoot(start: string): string {
  let directory = start;
  while (directory !== dirname(directory)) {
    try {
      const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        workspaces?: unknown;
      };
      if (packageJson.workspaces !== undefined) {
        return directory;
      }
    } catch {
      // Keep walking toward the filesystem root.
    }
    directory = dirname(directory);
  }
  return start;
}

const REPO_ROOT = findRepoRoot(process.cwd());
const ACTIVE_ROOTS = [
  "apps/cli/src",
  "packages/core/src",
  "packages/storage/src",
  "packages/types/src",
];
const SKIP_DIRS = new Set(["legacy", "node_modules", "dist"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const IMPORT_SPECIFIER_REGEX = /(?:from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\))/g;
const ACTIVE_FORBIDDEN_IMPORT =
  /(^|\/)(legacy|experiments)(\/|$)|apps\/legacy-reference|archive\/legacy/;
const APP_SHELL_FORBIDDEN_IMPORT =
  /^@\/services\/providers(?:\/|$)|^@\/(infra\/mpv|infra\/player|mpv|scraper)(?:\/|$)|^@kunai\/providers(?:\/|$)/;
const APP_SHELL_IMPORT = /^(?:@\/app-shell|(?:\.\.\/)+app-shell|\.\/app-shell)(?:\/|$)/;
const INK_IMPORT = /^ink(?:\/|$)/;
const PROVIDER_PACKAGE_IMPORT = /^@kunai\/providers(?:\/|$)|packages\/providers/;
const HISTORY_STORE_ADAPTER_IMPORT =
  /^@\/services\/persistence\/(?:HistoryStore|SqliteHistoryStoreImpl)$/;

const ALLOWED_APP_SHELL_IMPORTS_BY_FILE = new Map<string, readonly string[]>([
  [
    "apps/cli/src/app/DownloadOnlyPhase.ts",
    ["@/app-shell/pickers/choose-from-list-shell", "@/app-shell/workflows"],
  ],
  [
    "apps/cli/src/app/PlaybackPhase.ts",
    [
      "@/app-shell/command-router",
      "@/app-shell/commands",
      "@/app-shell/playback-shell-error-capture",
      "@/app-shell/workflows",
      "../app-shell/ink-shell",
    ],
  ],
  [
    "apps/cli/src/app/SearchPhase.ts",
    [
      "@/app-shell/browse-idle-context",
      "@/app-shell/calendar-ui.model",
      "@/app-shell/command-router",
      "@/app-shell/commands",
      "@/app-shell/ink-shell",
      "@/app-shell/pickers",
      "@/app-shell/search-browse-command-ids",
      "@/app-shell/types",
      "../app-shell/workflows",
    ],
  ],
  ["apps/cli/src/app/calendar-continue-launch.ts", ["@/app-shell/root-history-bridge"]],
  ["apps/cli/src/app/browse-option-mappers.ts", ["@/app-shell/types"]],
  [
    "apps/cli/src/app/download-episode-checklist.ts",
    ["@/app-shell/checklist-shell", "@/app-shell/pickers", "@/app-shell/workflows"],
  ],
  ["apps/cli/src/app/playback-bootstrap-presenter.ts", ["@/app-shell/types"]],
  ["apps/cli/src/app/playback-episode-picker.ts", ["@/app-shell/types"]],
  [
    "apps/cli/src/app/playback-recommendation-actions.ts",
    ["@/app-shell/types", "@/app-shell/workflows", "../app-shell/ink-shell"],
  ],
]);

const ALLOWED_WORKSPACE_DEPS_BY_PACKAGE = new Map<string, readonly string[]>([
  ["@kunai/types", []],
  ["@kunai/schemas", ["@kunai/types"]],
  ["@kunai/core", ["@kunai/types"]],
  ["@kunai/providers", ["@kunai/core", "@kunai/types"]],
  ["@kunai/storage", ["@kunai/core", "@kunai/schemas", "@kunai/types"]],
  ["@kunai/design", []],
]);

function collectImports(file: string): string[] {
  const source = readFileSync(join(REPO_ROOT, file), "utf8");
  return Array.from(source.matchAll(IMPORT_SPECIFIER_REGEX), (match) => match[1] ?? match[2] ?? "");
}

function collectSourceFiles(root: string): string[] {
  const absoluteRoot = join(REPO_ROOT, root);
  const files: string[] = [];

  function walk(directory: string) {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      const relativePath = relative(REPO_ROOT, absolute);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        if (SKIP_DIRS.has(entry) || relativePath.startsWith("apps/experiments")) {
          continue;
        }
        walk(absolute);
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        files.push(relativePath);
      }
    }
  }

  walk(absoluteRoot);
  return files;
}

describe("runtime boundary imports", () => {
  test("active runtime code does not import legacy or experiments modules", () => {
    const offenders = ACTIVE_ROOTS.flatMap(collectSourceFiles).filter((file) => {
      return collectImports(file).some((specifier) => ACTIVE_FORBIDDEN_IMPORT.test(specifier));
    });

    expect(offenders).toEqual([]);
  });

  test("app-shell avoids direct provider and player-runtime imports", () => {
    const appShellRoot = "apps/cli/src/app-shell";
    const offenders = collectSourceFiles(appShellRoot).filter((file) => {
      return collectImports(file).some((specifier) => APP_SHELL_FORBIDDEN_IMPORT.test(specifier));
    });

    expect(offenders).toEqual([]);
  });

  test("app-shell imports outside app-shell stay on the architecture sweep allowlist", () => {
    const checkedRoots = [
      "apps/cli/src/app",
      "apps/cli/src/domain",
      "apps/cli/src/services",
      "apps/cli/src/infra",
    ];
    const offenders = checkedRoots.flatMap(collectSourceFiles).flatMap((file) => {
      const allowed = new Set(ALLOWED_APP_SHELL_IMPORTS_BY_FILE.get(file) ?? []);
      return collectImports(file)
        .filter((specifier) => APP_SHELL_IMPORT.test(specifier))
        .filter((specifier) => !allowed.has(specifier))
        .map((specifier) => `${file} -> ${specifier}`);
    });

    expect(offenders).toEqual([]);
  });

  test("non-shell runtime layers do not import Ink directly", () => {
    const checkedRoots = [
      "apps/cli/src/app",
      "apps/cli/src/domain",
      "apps/cli/src/services",
      "apps/cli/src/infra",
    ];
    const offenders = checkedRoots.flatMap(collectSourceFiles).flatMap((file) =>
      collectImports(file)
        .filter((specifier) => INK_IMPORT.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  test("app phases do not import provider implementation packages directly", () => {
    const phaseFiles = collectSourceFiles("apps/cli/src/app").filter((file) =>
      file.endsWith("Phase.ts"),
    );
    const offenders = phaseFiles.flatMap((file) =>
      collectImports(file)
        .filter((specifier) => PROVIDER_PACKAGE_IMPORT.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  test("infra does not import provider implementation packages directly", () => {
    const offenders = collectSourceFiles("apps/cli/src/infra").flatMap((file) =>
      collectImports(file)
        .filter((specifier) => PROVIDER_PACKAGE_IMPORT.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  test("active runtime code does not depend on the retired history store adapter", () => {
    const offenders = collectSourceFiles("apps/cli/src").flatMap((file) =>
      collectImports(file)
        .filter((specifier) => HISTORY_STORE_ADAPTER_IMPORT.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  test("workspace package dependencies follow the package direction map", () => {
    const packageJsonFiles = [
      "packages/types/package.json",
      "packages/schemas/package.json",
      "packages/core/package.json",
      "packages/providers/package.json",
      "packages/storage/package.json",
      "packages/design/package.json",
    ];
    const offenders = packageJsonFiles.flatMap((file) => {
      const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, file), "utf8")) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const packageName = packageJson.name ?? file;
      const allowed = new Set(ALLOWED_WORKSPACE_DEPS_BY_PACKAGE.get(packageName) ?? []);
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      return Object.keys(dependencies)
        .filter((dependency) => dependency.startsWith("@kunai/"))
        .filter((dependency) => !allowed.has(dependency))
        .map((dependency) => `${packageName} -> ${dependency}`);
    });

    expect(offenders).toEqual([]);
  });
});
