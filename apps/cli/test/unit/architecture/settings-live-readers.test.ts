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

/**
 * Remove TypeScript comments with a small lexical scanner. Strings and
 * template literals are tokenized so `//` inside a URL or template never
 * starts a comment; interpolation is scanned as normal TypeScript so comments
 * there cannot smuggle reader evidence into the audit either.
 */
function stripTypeScriptComments(text: string): string {
  let output = "";

  function scanQuoted(index: number, quote: "'" | '"'): number {
    let cursor = index + 1;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "\\") cursor += 2;
      else if (char === quote) return cursor + 1;
      else cursor += 1;
    }
    return cursor;
  }

  function scanTemplate(index: number): number {
    output += "`";
    let cursor = index + 1;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "\\") {
        output += text.slice(cursor, cursor + 2);
        cursor += 2;
      } else if (char === "`") {
        output += "`";
        return cursor + 1;
      } else if (char === "$" && text[cursor + 1] === "{") {
        output += "${";
        cursor = scanNormal(cursor + 2, true);
        if (text[cursor] === "}") {
          output += "}";
          cursor += 1;
        }
      } else {
        output += char;
        cursor += 1;
      }
    }
    return cursor;
  }

  function scanNormal(start: number, stopAtCloseBrace: boolean): number {
    let cursor = start;
    let nestedBraces = 0;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "}") {
        if (stopAtCloseBrace && nestedBraces === 0) return cursor;
        if (nestedBraces > 0) nestedBraces -= 1;
      } else if (char === "{") {
        nestedBraces += 1;
      }
      if (char === "/" && text[cursor + 1] === "/") {
        cursor += 2;
        while (cursor < text.length && text[cursor] !== "\n") cursor += 1;
        continue;
      }
      if (char === "/" && text[cursor + 1] === "*") {
        cursor += 2;
        while (cursor < text.length) {
          if (text[cursor] === "*" && text[cursor + 1] === "/") {
            cursor += 2;
            break;
          }
          if (text[cursor] === "\n") output += "\n";
          cursor += 1;
        }
        continue;
      }
      if (char === "'" || char === '"') {
        const end = scanQuoted(cursor, char);
        output += text.slice(cursor, end);
        cursor = end;
        continue;
      }
      if (char === "`") {
        cursor = scanTemplate(cursor);
        continue;
      }
      output += char;
      cursor += 1;
    }
    return cursor;
  }

  scanNormal(0, false);
  return output;
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
    .map((file) => ({ file, text: stripTypeScriptComments(readRepoFile(file)) }));
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

  test("tracks nested object braces while scanning template interpolation", () => {
    const stripped = stripTypeScriptComments(
      "const label = `${({ enabled /* providerDns */ }).enabled ? 'on' : 'off'}`;",
    );

    expect(stripped).toContain("({ enabled");
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
