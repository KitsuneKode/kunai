import { describe, expect, test } from "bun:test";

import { addonSettingsRows } from "@/app-shell/settings/registry/addons";
import type { SettingRowDef, SettingsRegistryContext } from "@/app-shell/settings/types";
import type { Container } from "@/container";
import { readInstalledStremioAddons } from "@/domain/provider/stremio-addons";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";

const A = "https://a.example.com/SECRETTOKEN/manifest.json";
const B = "https://b.example.com/manifest.json";

function idOf(url: string): string {
  const [addon] = readInstalledStremioAddons([{ url }]);
  if (!addon) throw new Error(`fixture ${url} did not parse`);
  return addon.providerId;
}

function ctxFor(
  config: KitsuneConfig,
  over: Partial<SettingsRegistryContext> = {},
): SettingsRegistryContext {
  return {
    config,
    persistedConfig: config,
    presenceSnapshot: null,
    seriesProviderOptions: [{ value: "vidlink", label: "VidLink" }],
    animeProviderOptions: [{ value: "hianime", label: "HiAnime" }],
    youtubeProviderOptions: [{ value: "youtube", label: "YouTube" }],
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
    // SAFETY: these rows read config and provider options only.
    container: {} as Container,
    ...over,
  };
}

function row<K extends SettingRowDef["kind"]>(
  rows: readonly SettingRowDef[],
  id: string,
  kind: K,
): Extract<SettingRowDef, { kind: K }> {
  const found = rows.find((candidate) => candidate.id === id);
  if (!found || found.kind !== kind) throw new Error(`expected a ${kind} row with id ${id}`);
  return found as Extract<SettingRowDef, { kind: K }>;
}

describe("Stremio addon settings", () => {
  test("with none installed there is only the heading and the add row", () => {
    const rows = addonSettingsRows(ctxFor(DEFAULT_CONFIG));

    expect(rows.map((candidate) => candidate.id)).toEqual([
      "subheading:stremio-addons",
      "stremioAddonAdd",
    ]);
    expect(row(rows, "stremioAddonAdd", "text").summarize?.(DEFAULT_CONFIG)).toBe("none installed");
  });

  test("the add row stores a valid URL and holds no value of its own", () => {
    const add = row(addonSettingsRows(ctxFor(DEFAULT_CONFIG)), "stremioAddonAdd", "text");

    const next = add.apply(DEFAULT_CONFIG, ` ${A} `);

    expect(add.validate(A)).toBeNull();
    expect(next.stremioAddons).toEqual([{ url: A }]);
    expect(add.read(next)).toBe("");
    expect(add.sensitive).toBe(true);
    expect(add.summarize?.(next)).toBe("1 installed");
  });

  test("an empty entry, as sent when the input is cancelled, changes nothing", () => {
    const add = row(addonSettingsRows(ctxFor(DEFAULT_CONFIG)), "stremioAddonAdd", "text");

    expect(add.validate("")).toBeNull();
    expect(add.apply(DEFAULT_CONFIG, "")).toBe(DEFAULT_CONFIG);
  });

  test("a bad URL or a duplicate is refused with a reason before anything is stored", () => {
    const config = { ...DEFAULT_CONFIG, stremioAddons: [{ url: B }] };
    const add = row(addonSettingsRows(ctxFor(config)), "stremioAddonAdd", "text");

    expect(add.validate("http://a.example.com/manifest.json")).toContain("https://");
    expect(add.validate("https://a.example.com/")).toContain("/manifest.json");
    expect(add.validate(B)).toBe("That addon is already installed.");
  });

  test("each installed addon has a switch that removes it and puts it back", () => {
    const a = idOf(A);
    const config: KitsuneConfig = {
      ...DEFAULT_CONFIG,
      stremioAddons: [{ url: A, name: "Alpha" }],
      provider: a,
      providerPriority: [a, ...DEFAULT_CONFIG.providerPriority],
    };
    const keep = row(addonSettingsRows(ctxFor(config)), `stremioAddon:${a}`, "boolean");

    const removed = keep.write(config, false);
    const restored = keep.write(removed, true);

    expect(keep.label).toBe("Keep Alpha");
    expect(keep.detail).toContain("a.example.com");
    expect(keep.detail).not.toContain("SECRETTOKEN");
    expect(keep.read(config)).toBe(true);
    expect(removed.stremioAddons).toEqual([]);
    expect(removed.provider).toBe(DEFAULT_CONFIG.providerPriority[0] ?? DEFAULT_CONFIG.provider);
    expect(removed.providerPriority).toEqual(DEFAULT_CONFIG.providerPriority);
    expect(keep.read(removed)).toBe(false);
    expect(restored.stremioAddons).toEqual([{ url: A, name: "Alpha" }]);
  });

  test("an addon removed in the unsaved draft keeps its row, so it can be put back", () => {
    const saved = { ...DEFAULT_CONFIG, stremioAddons: [{ url: B }] };
    const draft = { ...saved, stremioAddons: [] };

    const rows = addonSettingsRows(ctxFor(draft, { persistedConfig: saved }));

    expect(rows.some((candidate) => candidate.id === `stremioAddon:${idOf(B)}`)).toBe(true);
  });

  test("an installed addon this session does not run yet is called out as waiting", () => {
    const config = { ...DEFAULT_CONFIG, stremioAddons: [{ url: B, name: "Beta" }] };

    const waiting = addonSettingsRows(ctxFor(config));
    const running = addonSettingsRows(
      ctxFor(config, {
        seriesProviderOptions: [
          { value: "vidlink", label: "VidLink" },
          { value: idOf(B), label: "Beta" },
        ],
      }),
    );

    expect(row(waiting, "stremioAddonsRestart", "status").detail).toContain("Beta");
    expect(running.some((candidate) => candidate.id === "stremioAddonsRestart")).toBe(false);
  });
});
