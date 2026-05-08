import { expect, test } from "bun:test";

import {
  buildSettingsChoiceOverlay,
  buildSettingsOptions,
  formatPickerDisplayRow,
  formatPickerOptionRow,
} from "@/app-shell/overlay-panel";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

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

  expect(row.prefix).toBe("> ");
  expect(row.prefix.length + row.text.length + row.badgeSuffix.length).toBeLessThanOrEqual(64);
});

test("settings expose Discord presence onboarding actions", () => {
  const config = {
    ...DEFAULT_CONFIG,
    presenceProvider: "discord" as const,
    presenceDiscordClientId: "123456789012345678",
  };
  const options = buildSettingsOptions(config);

  expect(options.map((option) => option.value)).toContain("presenceDiscordClientId");
  expect(options.map((option) => option.value)).toContain("presenceConnection");
  expect(options.find((option) => option.value === "presenceDiscordClientId")?.label).toContain(
    "configured",
  );
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
