import { describe, expect, test } from "bun:test";

import { buildSettingsRegistry } from "@/app-shell/settings/registry";
import type { SettingEffectTiming, SettingRowDef } from "@/app-shell/settings/types";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";

import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

type RuntimeRegistryRow = {
  readonly kind: SettingRowDef["kind"];
  readonly id: string;
  readonly effectTiming?: SettingEffectTiming;
  readonly configKeys?: readonly (keyof KitsuneConfig)[];
};

const CONFIGURABLE_KINDS = new Set(["boolean", "enum", "text", "submenu", "reorder"]);

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

function configurableRows(): RuntimeRegistryRow[] {
  return (buildSettingsRegistry(registryContext()) as unknown as RuntimeRegistryRow[]).filter(
    (row) => CONFIGURABLE_KINDS.has(row.kind),
  );
}

/**
 * Compatibility inference for running this gate against the pre-contract
 * registry during red/green proof. New rows cannot use it: the type contract
 * requires `configKeys`, and the metadata test below fails before inference
 * can hide an omission.
 */
function inferredConfigKeys(row: RuntimeRegistryRow): readonly string[] {
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

function stripCommentOnlyLines(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/**
 * Keys whose only production reader is constructed dynamically may be listed
 * here, one entry per reader as `apps/cli/src/path.ts:line`, with a comment
 * naming the dynamic indirection. There are currently none: every registered
 * key below has a literal production reader.
 */
const DYNAMIC_READER_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {};

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
    .map((file) => ({ file, text: stripCommentOnlyLines(readRepoFile(file)) }));
}

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
      const pattern = new RegExp(`\\b${key}\\b`, "u");
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
      const [, file, lineText] = match;
      const line = readRepoFile(file).split("\n")[Number(lineText) - 1] ?? "";
      expect(line, `${key}: ${location} must contain the dynamic key`).toContain(key);
    }
  });
});
