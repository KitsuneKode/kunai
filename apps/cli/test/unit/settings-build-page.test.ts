import { expect, test } from "bun:test";

import {
  buildSettingsPage,
  listSettingsSectionLabels,
  resolveSettingsInitialLocation,
} from "@/app-shell/settings/build-page";
import { isSettingVisible } from "@/app-shell/settings/gates";
import { buildSettingsRegistry } from "@/app-shell/settings/registry";
import type { SettingsRegistryContext } from "@/app-shell/settings/types";
import type { Container } from "@/container";
import { CONFIG_METADATA } from "@/services/persistence/config-metadata";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";

function mockCtx(over?: Partial<SettingsRegistryContext>): SettingsRegistryContext {
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
    // SAFETY: test exercises page-building only; container is never dereferenced by buildSettingsPage.
    container: {} as Container,
    ...over,
  };
}

test("buildSettingsRegistry includes relay text rows without keep/clear submenu", () => {
  const config = {
    ...DEFAULT_CONFIG,
    providerRelay: { ...DEFAULT_CONFIG.providerRelay, enabled: true, baseUrl: "", token: "" },
  } satisfies KitsuneConfig;
  const ctx = mockCtx({ config });
  const rows = buildSettingsRegistry(ctx);
  const relayUrl = rows.find((row) => row.id === "providerRelayBaseUrl");
  const relayToken = rows.find((row) => row.id === "providerRelayToken");
  expect(relayUrl?.kind).toBe("text");
  expect(relayToken?.kind).toBe("text");
});

test("buildSettingsPage filters rows by search query", () => {
  const ctx = mockCtx();
  const page = buildSettingsPage(ctx, { searchQuery: "relay" });
  expect(page.rows.some((row) => row.def.id === "providerRelayBaseUrl")).toBe(true);
  expect(page.rows.some((row) => row.def.id === "footerHints")).toBe(false);
});

test("editable config metadata is represented by registry rows", () => {
  const ctx = mockCtx();
  const rows = buildSettingsRegistry(ctx);

  const coveredKeys = new Set<string>();
  for (const row of rows) {
    coveredKeys.add(row.id);
    for (const key of row.configKeys ?? []) {
      coveredKeys.add(key);
    }
  }

  // presenceDiscordOpenUrl remains readable for config compatibility but is
  // deliberately hidden because no production payload consumes it.
  const intentionallyHidden = new Set(["presenceDiscordOpenUrl"]);
  const missing = CONFIG_METADATA.filter((entry) => entry.editable).flatMap((entry) =>
    coveredKeys.has(entry.key) || intentionallyHidden.has(entry.key) ? [] : [entry.key],
  );

  expect(missing).toEqual([]);
});

test("compound-write rows declare every config key they write", () => {
  const rows = buildSettingsRegistry(mockCtx());
  const byId = new Map(rows.map((row) => [row.id, row]));

  expect(byId.get("usageAnalytics")?.configKeys).toEqual([
    "analytics",
    "installId",
    "analyticsCohort",
  ]);
  expect(byId.get("providerPriority")?.configKeys).toEqual(["provider", "providerPriority"]);
  expect(byId.get("animeProviderPriority")?.configKeys).toEqual([
    "animeProvider",
    "animeProviderPriority",
  ]);
  expect(byId.get("youtubeProviderPriority")?.configKeys).toEqual([
    "youtubeProvider",
    "youtubeProviderPriority",
  ]);
});

test("registry organizes into five sections and every registered setting appears in exactly one section", () => {
  const ctx = mockCtx({
    config: {
      ...DEFAULT_CONFIG,
      analytics: "enabled",
      updateChecksEnabled: true,
    },
  });

  const sections = listSettingsSectionLabels(ctx);
  expect(sections).toEqual([
    "General",
    "Sources",
    "Playback & Offline",
    "Accounts & Sync",
    "Privacy & System",
  ]);

  const allDefs = buildSettingsRegistry(ctx);
  // No row may appear before the first top-level section.
  expect(allDefs[0]?.kind).toBe("section");

  // Every row id in the registry is unique.
  const allIds = allDefs.map((def) => def.id);
  expect(new Set(allIds).size).toBe(allIds.length);

  // Every visible non-section, non-subheading setting appears in exactly one of
  // the five sections. Gated rows (e.g. "Undo the last setup run" without a
  // snapshot) are correctly absent from every page.
  const expectedSettingIds = allDefs
    .filter((def) => def.kind !== "section" && def.kind !== "subheading")
    .filter((def) => isSettingVisible(def, ctx))
    .map((def) => def.id);

  const seenPerSection = new Map<string, number>();
  const sectionOfSetting = new Map<string, string>();
  for (let i = 0; i < sections.length; i += 1) {
    const page = buildSettingsPage(ctx, { activeSectionIndex: i });
    const sectionLabel = sections[i]!;
    for (const row of page.rows) {
      if (row.def.kind === "section" || row.def.kind === "subheading") continue;
      seenPerSection.set(row.def.id, (seenPerSection.get(row.def.id) ?? 0) + 1);
      sectionOfSetting.set(row.def.id, sectionLabel);
    }
  }

  for (const id of expectedSettingIds) {
    expect({ id, seen: seenPerSection.get(id) }).toEqual({ id, seen: 1 });
  }
  expect(seenPerSection.size).toBe(expectedSettingIds.length);

  // Verify key structural invariants of the 5-section reorganization.
  expect(sectionOfSetting.get("showMemory")).toBe("Privacy & System");
  expect(sectionOfSetting.get("companionPet")).toBe("General");
  expect(sectionOfSetting.get("resetTips")).toBe("General");
  expect(allIds).not.toContain("seeAllTips");
  expect(sectionOfSetting.get("usageAnalytics")).toBe("Privacy & System");
  expect(sectionOfSetting.get("presenceProvider")).toBe("Accounts & Sync");
  expect(sectionOfSetting.get("sync:pause")).toBe("Accounts & Sync");
  expect(sectionOfSetting.get("providerRelayBaseUrl")).toBe("Sources");
  expect(sectionOfSetting.get("youtubeMetadataInstanceUrl")).toBe("Sources");
  expect(sectionOfSetting.get("downloadsEnabled")).toBe("Playback & Offline");
  expect(sectionOfSetting.get("autoNext")).toBe("Playback & Offline");
  expect(sectionOfSetting.get("clearHistory")).toBe("Privacy & System");

  // Memory panel lives under Advanced in Privacy & System, before Reset & Danger Zone.
  const privacyPage = buildSettingsPage(ctx, { activeSectionIndex: 4 });
  const advancedIdx = privacyPage.rows.findIndex((r) => r.def.id === "subheading:advanced");
  const memoryIdx = privacyPage.rows.findIndex((r) => r.def.id === "showMemory");
  const dangerIdx = privacyPage.rows.findIndex((r) => r.def.id === "subheading:storage");
  expect(advancedIdx).toBeGreaterThan(-1);
  expect(memoryIdx).toBeGreaterThan(advancedIdx);
  expect(dangerIdx).toBeGreaterThan(memoryIdx);
});

test("resolveSettingsInitialLocation keeps deep links and legacy tab IDs working", () => {
  const ctx = mockCtx({
    config: {
      ...DEFAULT_CONFIG,
      analytics: "enabled",
      updateChecksEnabled: true,
    },
  });
  const sections = listSettingsSectionLabels(ctx);

  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["section:general", "General", "defaultMode"],
    ["section:appearance", "General", "theme"],
    ["section:language", "General", "animeAudio"],
    ["section:discover", "General", "discoverShowOnStartup"],
    ["section:sources", "Sources", "provider"],
    ["section:providers", "Sources", "provider"],
    ["section:provider-toggles", "Sources", "provider:enabled:vidlink"],
    ["section:relay", "Sources", "providerRelayEnabled"],
    ["section:youtube", "Sources", "youtubeMetadataInstanceUrl"],
    ["section:playback", "Playback & Offline", "recoveryMode"],
    ["section:offline-continuation", "Playback & Offline", "downloadsEnabled"],
    ["section:accounts", "Accounts & Sync", "sync:pause"],
    ["section:sync", "Accounts & Sync", "sync:pause"],
    ["section:presence", "Accounts & Sync", "presenceProvider"],
    ["subheading:presence", "Accounts & Sync", "presenceProvider"],
    ["section:privacy", "Privacy & System", "usageAnalytics"],
    ["section:updates", "Privacy & System", "updateChecksEnabled"],
    ["subheading:advanced", "Privacy & System", "showMemory"],
    ["section:storage", "Privacy & System", "clearCache"],
  ];

  for (const [targetId, expectedSection, expectedRowId] of cases) {
    const loc = resolveSettingsInitialLocation(ctx, targetId);
    expect(sections[loc.activeSectionIndex]).toBe(expectedSection);
    const page = buildSettingsPage(ctx, { activeSectionIndex: loc.activeSectionIndex });
    expect(page.rows[loc.selectedIndex]?.def.id).toBe(expectedRowId);
  }
});
