import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  collectSourceFiles as collectRepoSourceFiles,
  REPO_ROOT,
  readRepoFile,
} from "../../support/repo-scan";

const ACTIVE_ROOTS = [
  "apps/cli/src",
  "packages/core/src",
  "packages/storage/src",
  "packages/types/src",
];
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
const APP_SHELL_STORAGE_IMPORT = /^@kunai\/storage(?:\/|$)/;
const EXISTING_LOWER_LAYER_UPWARD_IMPORTS = new Set([
  "apps/cli/src/domain/continuation/history-reconciliation.ts -> @/services/catalog/CatalogScheduleService",
  "apps/cli/src/domain/continuation/history-reconciliation.ts -> @/services/continuation/history-progress",
  "apps/cli/src/domain/continuation/history-bucket.ts -> @/services/continuation/history-progress",
  "apps/cli/src/domain/lists/WatchGenreStats.ts -> @/services/catalog/tmdb-proxy",
  "apps/cli/src/domain/media/content-kind.ts -> @/services/persistence/ConfigService",
  "apps/cli/src/domain/media/media-item-adapters.ts -> @/services/continuation/history-progress",
  "apps/cli/src/domain/offline/OfflineLibraryEngine.ts -> @/services/offline/offline-library",
  "apps/cli/src/domain/playback/playback-policy.ts -> @/services/catalog/tmdb-release",
  "apps/cli/src/domain/playback/playback-problem.ts -> @/services/network/NetworkStatus",
  "apps/cli/src/domain/playback/track-capabilities.ts -> @/services/playback/PlaybackSourceInventoryView",
  "apps/cli/src/domain/provider-relay-settings.ts -> @/services/persistence/ConfigService",
  "apps/cli/src/services/diagnostics/diagnostics-insight.ts -> @/app/playback/subtitle-status",
  "apps/cli/src/services/media-actions/create-container-media-action-router.ts -> @/app-shell/workflows/playlist-add-workflow",
  "apps/cli/src/services/offline/offline-library-action-router.ts -> @/app-shell/pickers",
  "apps/cli/src/services/offline/offline-library-action-router.ts -> @/app-shell/workflows",
]);

const ALLOWED_APP_SHELL_IMPORTS_BY_FILE = new Map<string, readonly string[]>([
  [
    "apps/cli/src/app/playback/DownloadOnlyPhase.ts",
    [
      // Same shape as the choose-from-list entry: an interactive phase opens a
      // shell to collect one decision. The inversion that would retire all
      // three belongs to a dedicated phase/shell seam, not to this change.
      "@/app-shell/download-confirmation-shell",
      "@/app-shell/pickers/choose-from-list-shell",
      "@/app-shell/workflows",
    ],
  ],
  [
    "apps/cli/src/app/playback/run-post-playback-menu.ts",
    [
      "@/app-shell/commands",
      // DEBT (2026-07-21): queue-launch handoff lives in app-shell; the bridge
      // belongs below app-shell so app/ can claim a launch without inverting.
      "@/app-shell/root-queue-bridge",
      "@/app-shell/title-control/title-control-post-play",
      "@/app-shell/types",
      "@/app-shell/workflows",
    ],
  ],
  [
    "apps/cli/src/app/playback/playback-post-play-entry.ts",
    [
      "@/app-shell/command-router",
      "@/app-shell/commands",
      "@/app-shell/title-control/open-title-control-menu",
      "@/app-shell/types",
      "@/app-shell/workflows",
    ],
  ],
  [
    "apps/cli/src/app/playback/PlaybackPhase.ts",
    [
      "@/app-shell/playback-shell-error-capture",
      "@/app-shell/workflows",
      "@/app-shell/title-control/smart-auto-launch",
      "@/app/playback/playback-post-play-entry",
      "../../app-shell/ink-shell",
    ],
  ],
  [
    "apps/cli/src/app/search/SearchPhase.ts",
    [
      "@/app-shell/browse-idle-context",
      "@/app-shell/calendar-ui.model",
      "@/app-shell/command-router",
      // The mounted calendar route's request type. SearchPhase owns the request
      // identity and the acceptance commit; the shell owns its state machine.
      "@/app-shell/hooks/use-calendar-route",
      "@/app-shell/commands",
      // DEBT (2026-07-21): both are shell-owned helpers that app/ reaches up for.
      // `external-open-fallback` is presentation copy; `root-queue-bridge` is the
      // queue-launch handoff. Both should move below app-shell.
      "@/app-shell/external-open-fallback",
      "@/app-shell/root-queue-bridge",
      "@/app-shell/ink-shell",
      "@/app-shell/pickers",
      "@/app-shell/search-browse-command-ids",
      "@/app-shell/types",
      "../../app-shell/workflows",
    ],
  ],
  ["apps/cli/src/app/search/calendar-continue-launch.ts", ["@/app-shell/root-history-bridge"]],
  ["apps/cli/src/app/search/browse-option-mappers.ts", ["@/app-shell/types"]],
  // DEBT (2026-07-21): browse filtering/projection helpers and their types are
  // shell-owned but consumed by app/search. Type-only for the two `types` edges.
  ["apps/cli/src/app/search/browse-local-filter-facts.ts", ["@/app-shell/types"]],
  [
    "apps/cli/src/app/search/browse-initial-results.ts",
    ["@/app-shell/browse-filters", "@/app-shell/types"],
  ],
  [
    "apps/cli/src/app/bootstrap/download-episode-checklist.ts",
    ["@/app-shell/checklist-shell", "@/app-shell/pickers", "@/app-shell/workflows"],
  ],
  ["apps/cli/src/app/playback/playback-bootstrap-presenter.ts", ["@/app-shell/types"]],
  ["apps/cli/src/app/playback/playback-episode-picker.ts", ["@/app-shell/types"]],
  [
    "apps/cli/src/app/playback/playback-recommendation-actions.ts",
    ["@/app-shell/types", "@/app-shell/workflows", "../../app-shell/ink-shell"],
  ],
  [
    "apps/cli/src/services/media-actions/create-container-media-action-router.ts",
    ["@/app-shell/workflows/playlist-add-workflow"],
  ],
  [
    "apps/cli/src/services/offline/offline-library-action-router.ts",
    ["@/app-shell/pickers", "@/app-shell/workflows"],
  ],
  [
    "apps/cli/src/app/offline/offline-playback-launch.ts",
    ["@/app-shell/root-content-state", "@/app-shell/types"],
  ],
]);

const ALLOWED_WORKSPACE_DEPS_BY_PACKAGE = new Map<string, readonly string[]>([
  ["@kunai/types", []],
  ["@kunai/schemas", ["@kunai/types"]],
  ["@kunai/core", ["@kunai/types"]],
  ["@kunai/config", ["@kunai/schemas", "@kunai/types"]],
  ["@kunai/providers", ["@kunai/core", "@kunai/types"]],
  ["@kunai/relay", ["@kunai/core", "@kunai/types"]],
  ["@kunai/storage", ["@kunai/core", "@kunai/schemas", "@kunai/types"]],
  ["@kunai/design", []],
]);

function collectImports(file: string): string[] {
  const source = readRepoFile(file);
  return Array.from(source.matchAll(IMPORT_SPECIFIER_REGEX), (match) => match[1] ?? match[2] ?? "");
}

function collectSourceFiles(root: string): string[] {
  return collectRepoSourceFiles(root, { skipPrefixes: [".reference/experiments"] });
}

describe("runtime boundary imports", () => {
  /**
   * Every allowlist, baseline and skip prefix in this file is written with
   * forward slashes, so a backslashed scan result silently misses all of them
   * at once -- the Windows failure mode this sweep had. Pin the invariant here
   * rather than trusting each comparison site.
   */
  test("scan results are POSIX-separated on every platform", () => {
    const scanned = ACTIVE_ROOTS.flatMap(collectSourceFiles);
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.filter((file) => file.includes("\\"))).toEqual([]);
  });

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

  test("lower runtime layers add no new upward imports", () => {
    const layerRules = [
      {
        root: "apps/cli/src/domain",
        forbidden: /^@\/(?:app|app-shell|services)(?:\/|$)/,
      },
      {
        root: "apps/cli/src/infra",
        forbidden: /^@\/(?:app|app-shell)(?:\/|$)/,
      },
      {
        root: "apps/cli/src/services",
        forbidden: /^@\/(?:app|app-shell)(?:\/|$)/,
      },
    ];
    const offenders = layerRules.flatMap(({ root, forbidden }) =>
      collectSourceFiles(root).flatMap((file) =>
        collectImports(file)
          .filter((specifier) => forbidden.test(specifier))
          .map((specifier) => `${file} -> ${specifier}`)
          .filter((edge) => !EXISTING_LOWER_LAYER_UPWARD_IMPORTS.has(edge)),
      ),
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

  test("app-shell avoids direct @kunai/storage imports", () => {
    const appShellRoot = "apps/cli/src/app-shell";
    const offenders = collectSourceFiles(appShellRoot).flatMap((file) =>
      collectImports(file)
        .filter((specifier) => APP_SHELL_STORAGE_IMPORT.test(specifier))
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
      "packages/config/package.json",
      "packages/providers/package.json",
      "packages/relay/package.json",
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
