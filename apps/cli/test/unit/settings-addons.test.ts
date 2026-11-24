import { describe, expect, test } from "bun:test";

import { buildSettingsSubmenuView } from "@/app-shell/settings/build-submenu";
import { addonSettingsRows } from "@/app-shell/settings/registry/addons";
import type { SettingRowDef, SettingsRegistryContext } from "@/app-shell/settings/types";
import type { Container } from "@/container";
import { readInstalledStremioAddons } from "@/domain/provider/stremio-addons";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";

const A = "https://a.example.com/SECRETTOKEN/manifest.json";
const ACK = "2026-01-01T00:00:00.000Z";
/** A config where the experimental addon feature has been opted into. */
const ENABLED_CONFIG: KitsuneConfig = {
  ...DEFAULT_CONFIG,
  experimentalStremioAddons: true,
  stremioAddonsRiskAcknowledgedAt: ACK,
};
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
  // SAFETY: `found.kind === kind` was checked on the line above; TypeScript does
  // not narrow a union by a generic `K`.
  return found as Extract<SettingRowDef, { kind: K }>;
}

describe("Stremio addon settings", () => {
  test("with none installed there is only the toggle, the heading and the add row", () => {
    const rows = addonSettingsRows(ctxFor(DEFAULT_CONFIG));

    expect(rows.map((candidate) => candidate.id)).toEqual([
      "experimentalStremioAddons",
      "subheading:stremio-addons",
      "stremioAddonAdd",
    ]);
    expect(row(rows, "stremioAddonAdd", "text").summarize?.(DEFAULT_CONFIG)).toBe("none installed");
  });

  test("the add row stores a valid URL and holds no value of its own", () => {
    const add = row(addonSettingsRows(ctxFor(ENABLED_CONFIG)), "stremioAddonAdd", "text");

    const next = add.apply(ENABLED_CONFIG, ` ${A} `);

    expect(add.validate(A)).toBeNull();
    expect(next.stremioAddons).toEqual([{ url: A }]);
    expect(add.read(next)).toBe("");
    expect(add.sensitive).toBe(true);
    expect(add.summarize?.(next)).toBe("1 installed");
  });

  test("an empty entry, as sent when the input is cancelled, changes nothing", () => {
    const add = row(addonSettingsRows(ctxFor(ENABLED_CONFIG)), "stremioAddonAdd", "text");

    expect(add.validate("")).toBeNull();
    expect(add.apply(ENABLED_CONFIG, "")).toBe(ENABLED_CONFIG);
  });

  test("a bad URL or a duplicate is refused with a reason before anything is stored", () => {
    const config = { ...ENABLED_CONFIG, stremioAddons: [{ url: B }] };
    const add = row(addonSettingsRows(ctxFor(config)), "stremioAddonAdd", "text");

    expect(add.validate("http://a.example.com/manifest.json")).toContain("https://");
    expect(add.validate("https://a.example.com/")).toContain("/manifest.json");
    expect(add.validate(B)).toBe("That addon is already installed.");
  });

  test("each installed addon has a switch that removes it and puts it back", () => {
    const a = idOf(A);
    const config: KitsuneConfig = {
      ...ENABLED_CONFIG,
      stremioAddons: [{ url: A, name: "Alpha" }],
      provider: a,
      providerPriority: [a, ...DEFAULT_CONFIG.providerPriority],
    };
    const keep = row(addonSettingsRows(ctxFor(config)), `stremioAddon:${a}`, "boolean");

    const removed = keep.write(config, false);
    const restored = keep.write(removed, true);

    expect(keep.label).toBe("Keep addon @ a.example.com");
    expect(keep.detail).toContain("a.example.com");
    expect(keep.detail).not.toContain("SECRETTOKEN");
    expect(keep.read(config)).toBe(true);
    expect(removed.stremioAddons).toEqual([]);
    expect(removed.provider).toBe(DEFAULT_CONFIG.providerPriority[0] ?? DEFAULT_CONFIG.provider);
    expect(removed.providerPriority).toEqual(DEFAULT_CONFIG.providerPriority);
    expect(keep.read(removed)).toBe(false);
    expect(restored.stremioAddons).toEqual([{ url: A }]);
  });

  test("an addon removed in the unsaved draft keeps its row, so it can be put back", () => {
    const saved = { ...ENABLED_CONFIG, stremioAddons: [{ url: B }] };
    const draft = { ...saved, stremioAddons: [] };

    const rows = addonSettingsRows(ctxFor(draft, { persistedConfig: saved }));

    expect(rows.some((candidate) => candidate.id === `stremioAddon:${idOf(B)}`)).toBe(true);
  });

  test("an installed addon this session does not run yet is called out as waiting", () => {
    const config = { ...ENABLED_CONFIG, stremioAddons: [{ url: B, name: "Beta" }] };

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

describe("experimental Stremio addons toggle", () => {
  function submenu(config: KitsuneConfig, over: Partial<SettingsRegistryContext> = {}) {
    const ctx = ctxFor(config, over);
    const rows = addonSettingsRows(ctx);
    const def = row(rows, "experimentalStremioAddons", "submenu");
    const view = buildSettingsSubmenuView(
      "experimentalStremioAddons",
      ctx,
      new Map(rows.map((candidate) => [candidate.id, candidate])),
    );
    if (!view) throw new Error("expected a submenu view");
    return { def, view };
  }

  test("the default first choice keeps the current state — Enter repetition cannot opt in", () => {
    const { def, view } = submenu(DEFAULT_CONFIG);

    expect(view.choices.map((choice) => choice.value)).toEqual(["keep-off", "enable"]);
    expect(def.summarize(DEFAULT_CONFIG)).toBe("Off");
    // Enter on the selection the controller starts on (index 0) changes nothing.
    expect(def.onPick(DEFAULT_CONFIG, "keep-off", ctxFor(DEFAULT_CONFIG))).toBe(DEFAULT_CONFIG);

    const on = submenu(ENABLED_CONFIG);
    expect(on.view.choices.map((choice) => choice.value)).toEqual(["keep-on", "disable"]);
    expect(on.def.summarize(ENABLED_CONFIG)).toBe("On");
    expect(on.def.onPick(ENABLED_CONFIG, "keep-on", ctxFor(ENABLED_CONFIG))).toBe(ENABLED_CONFIG);
  });

  test("choosing Enable patches flag plus a fresh acknowledgement immutably", () => {
    const { def } = submenu(DEFAULT_CONFIG);

    const next = def.onPick(DEFAULT_CONFIG, "enable", ctxFor(DEFAULT_CONFIG));

    expect(next).not.toBe(DEFAULT_CONFIG);
    if (!("stremioAddons" in next)) throw new Error("expected a config result");
    expect(next.experimentalStremioAddons).toBe(true);
    expect(next.stremioAddonsRiskAcknowledgedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(DEFAULT_CONFIG.experimentalStremioAddons).toBe(false);
  });

  test("the warning shows while off with no acknowledgement — and never again", () => {
    const fresh = submenu(DEFAULT_CONFIG);
    expect(fresh.view.subtitle).toContain("third-party servers you choose");

    // Off but already acknowledged (a past disable): guidance, not the warning.
    const disabled = submenu({ ...DEFAULT_CONFIG, stremioAddonsRiskAcknowledgedAt: ACK });
    expect(disabled.view.subtitle).not.toContain("third-party servers you choose");
    expect(disabled.view.subtitle).toContain("next resolve");

    expect(submenu(ENABLED_CONFIG).view.subtitle).not.toContain("third-party servers you choose");
  });

  test("re-enabling reuses the stored acknowledgement", () => {
    const config = { ...DEFAULT_CONFIG, stremioAddonsRiskAcknowledgedAt: ACK };
    const { def } = submenu(config);

    const next = def.onPick(config, "enable", ctxFor(config));

    if (!("stremioAddons" in next)) throw new Error("expected a config result");
    expect(next.stremioAddonsRiskAcknowledgedAt).toBe(ACK);
  });

  test("Disable patches only the flag — acknowledgement and installed list stay", () => {
    const config: KitsuneConfig = {
      ...ENABLED_CONFIG,
      stremioAddons: [{ url: A, name: "Alpha" }],
    };
    const { def } = submenu(config);

    const next = def.onPick(config, "disable", ctxFor(config));

    if (!("stremioAddons" in next)) throw new Error("expected a config result");
    expect(next.experimentalStremioAddons).toBe(false);
    expect(next.stremioAddonsRiskAcknowledgedAt).toBe(ACK);
    expect(next.stremioAddons).toEqual([{ url: A, name: "Alpha" }]);
  });

  test("the add row is guarded while off and says why", () => {
    const add = row(addonSettingsRows(ctxFor(DEFAULT_CONFIG)), "stremioAddonAdd", "text");

    expect(add.validate(A)).toContain("off");
    expect(add.apply(DEFAULT_CONFIG, A)).toBe(DEFAULT_CONFIG);
  });

  test("installed rows stay visible while off, marked disabled, and the restart note is suppressed", () => {
    const config = { ...DEFAULT_CONFIG, stremioAddons: [{ url: B, name: "Beta" }] };

    const rows = addonSettingsRows(ctxFor(config));
    const keep = row(rows, `stremioAddon:${idOf(B)}`, "boolean");

    expect(keep.detail).toContain("disabled (experimental addons are off)");
    expect(rows.some((candidate) => candidate.id === "stremioAddonsRestart")).toBe(false);
  });
});
