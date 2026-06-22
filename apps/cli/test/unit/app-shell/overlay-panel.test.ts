import { expect, test } from "bun:test";

import { getOverlayHostChromeRows, getOverlayListMaxVisible } from "@/app-shell/layout-policy";
import {
  applySeriesProviderOrder,
  buildSettingsChoiceOverlay,
  buildSettingsOptions,
  describeProviderOrder,
  formatPickerDisplayRow,
  formatPickerOptionRow,
  getOverlayPickerPreviewImageUrl,
  moveProviderInOrder,
  resolveSeriesProviderOrder,
} from "@/app-shell/overlay-panel";
import { getConfigMetadata } from "@/services/persistence/config-metadata";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

test("overlay picker list budget uses inner viewport rows, not full terminal height", () => {
  const hostChrome = getOverlayHostChromeRows({ commandMode: false, dedicatedShell: false });
  const shortTerminal = getOverlayListMaxVisible({
    terminalRows: 24,
    terminalCols: 80,
    overlayChromeRows: hostChrome,
    panelKind: "picker",
  });
  const fullTerminalPicker = Math.max(5, 24 - 10);
  expect(shortTerminal).toBeLessThan(fullTerminalPicker);
  expect(shortTerminal).toBeGreaterThanOrEqual(1);
});

test("formatPickerOptionRow keeps settings rows within the available width", () => {
  const row = formatPickerOptionRow({
    label: "Resume/start prompt before playback",
    detail: "Ask before continuing long-running episode history",
    badge: "current",
    width: 32,
  });

  expect(row.text).not.toContain("\n");
  expect(row.text.length + row.badgeSuffix.length).toBeLessThanOrEqual(32);
  expect(row.text.endsWith("…")).toBe(true);
});

test("formatPickerOptionRow reserves badge width before truncating text", () => {
  const row = formatPickerOptionRow({
    label: "Auto next episode",
    detail: "Play the next available item",
    badge: "on",
    width: 24,
  });

  expect(row.badgeSuffix).toBe("  on");
  expect(row.text.length + row.badgeSuffix.length).toBeLessThanOrEqual(24);
});

test("formatPickerDisplayRow reserves prefix width before truncating episode rows", () => {
  const row = formatPickerDisplayRow({
    label: "Episode 5  ·  Shotgun",
    detail:
      "2011-08-14  ·  When Jesse goes missing, Walt fears the worst. Skyler has an unlikely reunion.",
    badge: "watched",
    width: 64,
    selected: true,
  });

  expect(row.prefix).toBe("▌ ");
  expect(row.prefix.length + row.text.length + row.badgeSuffix.length).toBeLessThanOrEqual(64);
});

test("episode picker overlay resolves selected preview artwork", () => {
  expect(
    getOverlayPickerPreviewImageUrl({
      type: "episode-picker",
      title: "Choose episode",
      subtitle: "Season 1",
      filterQuery: "",
      selectedIndex: 1,
      options: [
        { value: "1", label: "Episode 1", previewImageUrl: "/still-1.jpg" },
        { value: "2", label: "Episode 2", previewImageUrl: "/still-2.jpg" },
      ],
    }),
  ).toBe("/still-2.jpg");
});

test("settings expose Discord presence onboarding actions", () => {
  const config = {
    ...DEFAULT_CONFIG,
    presenceProvider: "discord" as const,
    presenceDiscordClientId: "123456789012345678",
    presenceDiscordOpenUrl: "kunai://play?search=Dune",
  };
  const options = buildSettingsOptions(config);

  expect(options.map((option) => option.value)).toContain("presenceDiscordClientId");
  expect(options.map((option) => option.value)).toContain("presenceDiscordOpenUrl");
  expect(options.map((option) => option.value)).toContain("presenceConnection");
  expect(options.find((option) => option.value === "presenceDiscordClientId")?.label).toContain(
    "configured",
  );
  expect(options.find((option) => option.value === "presenceDiscordOpenUrl")?.label).toContain(
    "configured",
  );
});

test("settings expose discover and offline controls that already exist in config", () => {
  const options = buildSettingsOptions({
    ...DEFAULT_CONFIG,
    discoverShowOnStartup: true,
    discoverMode: "anime-only",
    discoverItemLimit: 48,
    downloadsEnabled: true,
    autoDownload: "next",
    autoDownloadNextCount: 3,
    autoCleanupWatched: true,
    autoCleanupGraceDays: 14,
    downloadPath: "/tmp/kunai-downloads",
    recoveryMode: "manual",
  });
  const values = options.map((option) => option.value);

  expect(values).toContain("discoverShowOnStartup");
  expect(values).toContain("discoverMode");
  expect(values).toContain("discoverItemLimit");
  expect(values).toContain("downloadsEnabled");
  expect(values).toContain("powerSaverMode");
  expect(values).toContain("section:offline-continuation");
  expect(values).toContain("recoveryMode");
  expect(values).toContain("startupPriority");
  expect(values).toContain("autoCleanupGraceDays");
  expect(values).toContain("downloadPath");
  expect(options.find((option) => option.value === "discoverMode")?.label).toContain("anime-only");
  expect(
    options.find((option) => option.value === "section:offline-continuation")?.detail,
  ).toContain("per title");
  expect(options.find((option) => option.value === "downloadPath")?.label).toContain("configured");
  expect(options.find((option) => option.value === "recoveryMode")?.label).toContain("manual");
});

test("settings rows use metadata labels for key runtime controls", () => {
  const options = buildSettingsOptions(DEFAULT_CONFIG);

  expect(options.find((option) => option.value === "footerHints")?.label).toContain(
    getConfigMetadata("footerHints").label,
  );
  expect(options.find((option) => option.value === "recoveryMode")?.label).toContain(
    getConfigMetadata("recoveryMode").label,
  );
  expect(options.find((option) => option.value === "startupPriority")?.label).toContain(
    getConfigMetadata("startupPriority").label,
  );
  expect(options.find((option) => option.value === "discoverShowOnStartup")?.label).toContain(
    getConfigMetadata("discoverShowOnStartup").label,
  );
});

test("discover and offline settings provide bounded choice overlays", () => {
  const config = {
    ...DEFAULT_CONFIG,
    discoverMode: "series-only" as const,
    discoverItemLimit: 48,
    autoDownloadNextCount: 6,
    autoCleanupGraceDays: 14,
    downloadPath: "/tmp/kunai-downloads",
  };

  expect(
    buildSettingsChoiceOverlay({
      config,
      setting: "discoverMode",
      seriesProviderOptions: [],
      animeProviderOptions: [],
    }).options.map((option) => option.value),
  ).toEqual(["auto", "unified", "anime-only", "series-only"]);
  expect(
    buildSettingsChoiceOverlay({
      config,
      setting: "discoverItemLimit",
      seriesProviderOptions: [],
      animeProviderOptions: [],
    }).options.map((option) => option.value),
  ).toContain("48");
  expect(
    buildSettingsChoiceOverlay({
      config,
      setting: "recoveryMode",
      seriesProviderOptions: [],
      animeProviderOptions: [],
    }).options.map((option) => option.value),
  ).toEqual(["guided", "fallback-first", "manual"]);
  expect(
    buildSettingsChoiceOverlay({
      config: DEFAULT_CONFIG,
      setting: "startupPriority",
      seriesProviderOptions: [],
      animeProviderOptions: [],
    }).options.map((option) => option.value),
  ).toEqual(["balanced", "fast", "quality-first"]);
  expect(
    buildSettingsChoiceOverlay({
      config,
      setting: "autoDownloadNextCount",
      seriesProviderOptions: [],
      animeProviderOptions: [],
    }).options.map((option) => option.value),
  ).toContain("6");
  expect(
    buildSettingsChoiceOverlay({
      config,
      setting: "autoCleanupGraceDays",
      seriesProviderOptions: [],
      animeProviderOptions: [],
    }).options.map((option) => option.value),
  ).toContain("14");
  expect(
    buildSettingsChoiceOverlay({
      config,
      setting: "downloadPath",
      seriesProviderOptions: [],
      animeProviderOptions: [],
    }).options.map((option) => option.value),
  ).toEqual(["__keep__", "__clear__"]);
});

test("settings show bundled default client id source when no explicit id is set", () => {
  const options = buildSettingsOptions({
    ...DEFAULT_CONFIG,
    presenceProvider: "discord",
    presenceDiscordClientId: "",
  });

  expect(options.find((option) => option.value === "presenceDiscordClientId")?.label).toContain(
    "bundled default",
  );
});

test("Discord client id setting can keep or clear the configured id", () => {
  const overlay = buildSettingsChoiceOverlay({
    config: {
      ...DEFAULT_CONFIG,
      presenceProvider: "discord",
      presenceDiscordClientId: "123456789012345678",
    },
    setting: "presenceDiscordClientId",
    seriesProviderOptions: [],
    animeProviderOptions: [],
  });

  expect(overlay.title).toBe("Discord client ID");
  expect(overlay.options.map((option) => option.value)).toContain("__keep__");
  expect(overlay.options.map((option) => option.value)).toContain("__clear__");
});

test("Discord open URL setting can keep or clear the configured handoff", () => {
  const overlay = buildSettingsChoiceOverlay({
    config: {
      ...DEFAULT_CONFIG,
      presenceDiscordOpenUrl: "kunai://play?search=Dune",
    },
    setting: "presenceDiscordOpenUrl",
    seriesProviderOptions: [],
    animeProviderOptions: [],
  });

  expect(overlay.title).toBe("Discord open URL");
  expect(overlay.subtitle).toContain("kunai://play?search=Dune");
  expect(overlay.options.map((option) => option.value)).toEqual(["__keep__", "__clear__"]);
});

test("buildSettingsOptions includes section separators for general and providers", () => {
  const options = buildSettingsOptions(DEFAULT_CONFIG);
  const sectionValues = options
    .map((option) => option.value)
    .filter((v) => typeof v === "string" && v.startsWith("section:"));

  expect(sectionValues.length).toBeGreaterThan(0);
  expect(sectionValues).toContain("section:general");
  expect(sectionValues).toContain("section:providers");
});

test("settings expose provider order editors", () => {
  const options = buildSettingsOptions(DEFAULT_CONFIG);
  expect(options.map((option) => option.value)).toContain("providerPriority");
  expect(options.map((option) => option.value)).toContain("animeProviderPriority");
});

test("resolveSeriesProviderOrder dedupes default and priority", () => {
  const order = resolveSeriesProviderOrder({
    ...DEFAULT_CONFIG,
    provider: "vidlink",
    providerPriority: ["vidking", "vidlink", "rivestream"],
  });
  expect(order).toEqual(["vidlink", "vidking", "rivestream"]);
});

test("applySeriesProviderOrder writes default plus fallback chain", () => {
  const next = applySeriesProviderOrder(DEFAULT_CONFIG, ["rivestream", "vidking", "vidlink"]);
  expect(next.provider).toBe("rivestream");
  expect(next.providerPriority).toEqual(["vidking", "vidlink"]);
  expect(describeProviderOrder(resolveSeriesProviderOrder(next))).toBe(
    "rivestream → vidking → vidlink",
  );
});

test("moveProviderInOrder swaps neighbors and clamps at ends", () => {
  const order = ["vidking", "vidlink", "rivestream"];
  expect(moveProviderInOrder(order, "vidlink", "up")).toEqual(["vidlink", "vidking", "rivestream"]);
  expect(moveProviderInOrder(order, "vidlink", "down")).toEqual([
    "vidking",
    "rivestream",
    "vidlink",
  ]);
  expect(moveProviderInOrder(order, "vidking", "up")).toEqual(order);
  expect(moveProviderInOrder(order, "rivestream", "down")).toEqual(order);
});

test("provider order settings screen lists numbered providers", () => {
  const overlay = buildSettingsChoiceOverlay({
    config: DEFAULT_CONFIG,
    setting: "providerPriority",
    seriesProviderOptions: [
      { value: "videasy", label: "Videasy" },
      { value: "vidlink", label: "VidLink" },
      { value: "rivestream", label: "Rivestream" },
    ],
    animeProviderOptions: [],
  });

  expect(overlay.title).toBe("Series provider order");
  expect(overlay.subtitle).toBe("Shift+↑/↓ or [ ] reorder  ·  S saves  ·  first = default");
  expect(overlay.options.map((option) => option.label)).toEqual([
    "1. Videasy",
    "2. VidLink",
    "3. Rivestream",
  ]);
});
