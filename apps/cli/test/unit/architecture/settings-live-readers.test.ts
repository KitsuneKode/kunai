import { describe, expect, test } from "bun:test";

import { buildSettingsRegistry } from "@/app-shell/settings/registry";
import type { SettingRowDef } from "@/app-shell/settings/types";
import type { Container } from "@/container";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";

import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

type ConfigurableRegistryRow = Extract<
  SettingRowDef,
  { readonly kind: "boolean" | "enum" | "text" | "submenu" | "reorder" }
>;

function isConfigurableRow(row: SettingRowDef): row is ConfigurableRegistryRow {
  return (
    row.kind === "boolean" ||
    row.kind === "enum" ||
    row.kind === "text" ||
    row.kind === "submenu" ||
    row.kind === "reorder"
  );
}

function registryContext() {
  return {
    config: DEFAULT_CONFIG,
    presenceSnapshot: null,
    seriesProviderOptions: [{ value: "vidlink", label: "VidLink" }],
    animeProviderOptions: [{ value: "hianime", label: "HiAnime" }],
    youtubeProviderOptions: [
      { value: "youtube", label: "YouTube" },
      { value: "youtube-alt", label: "YouTube Alt" },
    ],
    sync: {
      adapters: [],
      authAvailability: {
        anilist: {
          available: true as const,
          redirectUri: SHIPPED_ANILIST_REDIRECT_URI,
          clientIdSource: "shipped-default" as const,
        },
        tmdb: { available: true as const, apiKeySource: "shipped-fallback" as const },
      },
      status: {
        connected: 0,
        pending: 0,
        needsReauth: 0,
        deadLettered: 0,
        health: "disconnected" as const,
      },
    },
    // SAFETY: registry construction only reads provider options and scalar config here;
    // no row builder dereferences the container without a sync adapter or action run.
    container: {} as Container,
  };
}

function configurableRows(): readonly ConfigurableRegistryRow[] {
  return buildSettingsRegistry(registryContext()).filter(isConfigurableRow);
}

/**
 * Compatibility inference for running this gate against the pre-contract
 * registry during red/green proof. New rows cannot use it: the type contract
 * requires `configKeys`, and the metadata test below fails before inference
 * can hide an omission.
 */
function inferredConfigKeys(row: ConfigurableRegistryRow): readonly string[] {
  if (row.configKeys?.length) return row.configKeys;
  if (/^anime(Audio|Subtitle|Quality)$/.test(row.id)) return ["animeLanguageProfile"];
  if (/^series(Audio|Subtitle|Quality)$/.test(row.id)) return ["seriesLanguageProfile"];
  if (/^movie(Audio|Subtitle|Quality)$/.test(row.id)) return ["movieLanguageProfile"];
  if (/^youtube(Audio|Subtitle|Quality)$/.test(row.id)) return ["youtubeLanguageProfile"];
  if (row.id.startsWith("provider:enabled:")) return ["disabledProviders"];
  if (row.id === "stremioAddonAdd" || row.id.startsWith("stremioAddon:")) {
    return ["stremioAddons"];
  }
  if (row.id.startsWith("providerRelay") && row.id !== "providerRelay") return ["providerRelay"];
  if (row.id.startsWith("youtubeMetadata")) return ["youtubeMetadata"];
  if (row.id.startsWith("sync:")) return ["sync"];
  if (row.id === "usageAnalytics") return ["analytics"];
  return row.id in DEFAULT_CONFIG ? [row.id] : [];
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts", trimUnusedImports: false, deadCodeElimination: false }),
  tsx: new Bun.Transpiler({ loader: "tsx", trimUnusedImports: false, deadCodeElimination: false }),
};

/**
 * Remove comments (and type-only syntax, which never reads a setting) by
 * letting Bun's TypeScript parser re-print the source. A real parser knows a
 * regular-expression literal from division and a string from a comment, which
 * a hand-written scanner kept getting wrong. Dead-code elimination is off so an
 * unused module-level read still counts as evidence.
 */
function stripTypeScriptComments(text: string, loader: "ts" | "tsx" = "ts"): string {
  return transpilers[loader].transformSync(text);
}

/**
 * Keys whose only production reader is constructed dynamically may be listed
 * here, one entry per reader as a source-relative `file.ts:line`, with a comment
 * naming the dynamic indirection. There are currently none: every registered
 * key below has a literal production reader.
 */
const DYNAMIC_READER_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {};

// Generic English names need a config-shaped access pattern; a bare word scan
// for `player`, `provider`, `sync`, or `theme` would pass on unrelated runtime
// objects even after the real setting reader disappeared.
function genericReaderPattern(key: string): RegExp | null {
  switch (key) {
    case "player":
      return /\b(?:config|rawConfig)\.player\b|\bplayerChoice\b/u;
    case "provider":
      return /\b(?:config|rawConfig)\.provider\b|\bproviderForLane\(/u;
    case "sync":
      return /\bconfig\.sync\b/u;
    case "theme":
      return /\b(?:config|rawConfig|next|before)\.theme\b/u;
    default:
      return null;
  }
}

function productionSources(): readonly { file: string; text: string }[] {
  return collectSourceFiles("apps/cli/src")
    .filter((file) => {
      // The registry and its UI write or display settings; they are never
      // evidence that a feature consumes one. Persistence owns load/save/
      // defaults/schema and credential storage, and apply-settings-to-runtime
      // is the settings commit pipeline rather than a downstream behavior.
      return (
        !file.startsWith("apps/cli/src/app-shell/settings/") &&
        !file.startsWith("apps/cli/src/services/persistence/") &&
        file !== "apps/cli/src/app/bootstrap/apply-settings-to-runtime.ts"
      );
    })
    .map((file) => ({
      file,
      text: stripTypeScriptComments(readRepoFile(file), file.endsWith(".tsx") ? "tsx" : "ts"),
    }));
}

describe("stripTypeScriptComments", () => {
  test("removes inline comment tails without treating URL schemes as comments", () => {
    const stripped = stripTypeScriptComments(
      'const url = "https://relay.example"; // providerDns\nconst ready = true;',
    );

    expect(stripped).toContain('"https://relay.example"');
    expect(stripped).toContain("const ready = true;");
    expect(stripped).not.toContain("providerDns");
  });

  test("removes comments inside template interpolation but keeps template text", () => {
    const stripped = stripTypeScriptComments(
      "const label = `relay ${enabled /* analyticsCohort */ ? 'on' : 'off'}`;",
    );

    expect(stripped).toContain("relay ${enabled");
    expect(stripped).not.toContain("analyticsCohort");
  });

  test("a regular-expression literal containing a quote does not keep a later comment", () => {
    const stripped = stripTypeScriptComments(
      "const punctuation = /'/; // providerDns\nconst label = 'ready';",
    );

    expect(stripped).toContain("const label");
    expect(stripped).not.toContain("providerDns");
  });

  test("division is not mistaken for a regular expression", () => {
    const stripped = stripTypeScriptComments(
      "const half = total / 2; // providerDns\nconst next = 1;",
    );

    expect(stripped).toContain("const next");
    expect(stripped).not.toContain("providerDns");
  });

  test("keeps nested object code inside template interpolation", () => {
    const stripped = stripTypeScriptComments(
      "const label = `${({ enabled /* providerDns */ }).enabled ? 'on' : 'off'}`;",
    );

    expect(stripped).toContain("enabled }.enabled");
    expect(stripped).not.toContain("providerDns");
  });
});

describe("settings live-reader audit", () => {
  test("every configurable row declares effect timing and owned config keys", () => {
    const missing = configurableRows().flatMap((row) => {
      const problems: string[] = [];
      if (!row.effectTiming) problems.push("effectTiming");
      if (!row.configKeys?.length) problems.push("configKeys");
      return problems.length ? [`${row.id}: ${problems.join(", ")}`] : [];
    });

    expect(missing).toEqual([]);
  });

  test("every registered config key has a production reader outside settings persistence", () => {
    const rows = configurableRows();
    const rowsByKey = new Map<string, string[]>();
    for (const row of rows) {
      for (const key of inferredConfigKeys(row)) {
        rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row.id]);
      }
    }

    const sources = productionSources();
    const missing = [...rowsByKey.entries()].flatMap(([key, rowIds]) => {
      const pattern = genericReaderPattern(key) ?? new RegExp(`\\b${key}\\b`, "u");
      const readers = sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
      if (readers.length > 0) return [];
      const allowlisted = DYNAMIC_READER_ALLOWLIST[key] ?? [];
      if (allowlisted.length > 0) return [];
      return [`${key} (rows: ${[...new Set(rowIds)].join(", ")})`];
    });

    expect(missing).toEqual([]);
  });

  test("dynamic-reader allowlist entries stay precise and evidenced", () => {
    const entries = Object.entries(DYNAMIC_READER_ALLOWLIST).flatMap(([key, locations]) =>
      locations.map((location) => ({ key, location })),
    );
    for (const { key, location } of entries) {
      const match = /^(apps\/cli\/src\/.+):(\d+)$/.exec(location);
      expect(match, `${key}: allowlist location must be file:line`).not.toBeNull();
      if (!match) continue;
      const file = match[1];
      const lineText = match[2];
      if (!file || !lineText) continue;
      const line = readRepoFile(file).split("\n")[Number(lineText) - 1] ?? "";
      expect(line, `${key}: ${location} must contain the dynamic key`).toContain(key);
    }
  });
});
