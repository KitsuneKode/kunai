import { expect, test } from "bun:test";

import { generalSettingsRows } from "@/app-shell/settings/registry/general";
import { privacySettingsRows } from "@/app-shell/settings/registry/privacy";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

function baseConfig(): KitsuneConfig {
  return {
    ...DEFAULT_CONFIG,
    defaultMode: "series",
    seenTips: [],
  };
}

function generalRows() {
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  return generalSettingsRows({ config: baseConfig() } as never);
}

function privacyRowsFor(config: Partial<KitsuneConfig>) {
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  return privacySettingsRows({ config: { ...baseConfig(), ...config } } as never);
}

test("defaultMode write preserves youtube startup mode", () => {
  const row = generalRows().find((entry) => entry.id === "defaultMode");
  expect(row?.kind).toBe("enum");

  if (row?.kind !== "enum") {
    throw new Error("expected defaultMode enum row");
  }

  const next = row.write(baseConfig(), "youtube");
  expect(next.defaultMode).toBe("youtube");
});

test("companionPet is labeled Mascot & tips and toggles auto/off", () => {
  const row = generalRows().find((entry) => entry.id === "companionPet");
  expect(row?.kind).toBe("boolean");
  expect(row?.label).toBe("Mascot & tips");
  if (row?.kind !== "boolean") throw new Error("expected companionPet boolean row");

  expect(row.read({ ...baseConfig(), companionPet: "auto" })).toBe(true);
  expect(row.read({ ...baseConfig(), companionPet: "off" })).toBe(false);
  expect(row.write(baseConfig(), false).companionPet).toBe("off");
  expect(row.write(baseConfig(), true).companionPet).toBe("auto");
});

test("resetTips clears seenTips via config.update and save", async () => {
  const row = generalRows().find((entry) => entry.id === "resetTips");
  expect(row?.kind).toBe("action");
  expect(row?.label).toBe("Reset tips");
  if (row?.kind !== "action") throw new Error("expected resetTips action row");

  let patch: Partial<KitsuneConfig> | undefined;
  let saved = 0;
  const message = await row.run(
    // SAFETY: deliberately partial test stub — resetTips only reads/writes config.
    {
      container: {
        config: {
          seenTips: ["tip-up-next-key", "tip-help-key"],
          update: async (next: Partial<KitsuneConfig>) => {
            patch = next;
          },
          save: async () => {
            saved += 1;
          },
        },
      },
    } as never,
  );

  expect(patch).toEqual({ seenTips: [] });
  expect(saved).toBe(1);
  expect(String(message)).toContain("Reset 2 shortcut tips");
});

test("usage analytics is a visible opt-in setting that clears the id when disabled", () => {
  const row = privacyRowsFor({}).find((entry) => entry.id === "usageAnalytics");
  expect(row?.kind).toBe("boolean");

  if (row?.kind !== "boolean") {
    throw new Error("expected usageAnalytics boolean row");
  }

  const enabled = { ...baseConfig(), analytics: "enabled" as const, installId: "stable-id" };
  expect(row.read(baseConfig())).toBe(false);
  expect(row.write(enabled, false)).toMatchObject({ analytics: "disabled", installId: "" });
});

test("rotate is offered only while analytics is enabled", () => {
  // Disabling already clears the id, so offering rotation beside an off switch
  // would imply an identifier still exists.
  const off = privacyRowsFor({ analytics: "disabled" }).find(
    (entry) => entry.id === "rotateInstallId",
  );
  if (off?.kind !== "action") throw new Error("expected rotateInstallId action row");
  const predicate = off.gate?.predicate;
  if (!predicate) throw new Error("rotateInstallId must be gated on consent");
  expect(predicate({ ...baseConfig(), analytics: "disabled" })).toBe(false);
  expect(predicate({ ...baseConfig(), analytics: "enabled" })).toBe(true);
});

test("rotate hands the rotation to the analytics service and names the new id", async () => {
  // The service owns what a rotation writes (new id, new cohort, cadence reset,
  // ping log removed); `usage-analytics-service.test.ts` pins that patch.
  const row = privacyRowsFor({
    analytics: "enabled",
    installId: "11111111-2222-4333-8444-555555555555",
  }).find((entry) => entry.id === "rotateInstallId");
  if (row?.kind !== "action") throw new Error("expected rotateInstallId action row");

  let rotations = 0;
  const message = await row.run(
    // SAFETY: deliberately partial test stub — the row only calls rotateIdentity.
    {
      container: {
        usageAnalytics: {
          rotateIdentity: async () => {
            rotations += 1;
            return { installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
          },
        },
      },
    } as never,
  );

  expect(rotations).toBe(1);
  expect(String(message)).toContain("aaaaaaaa");
  expect(String(message)).toContain("cannot be linked");
});

test("the id line survives a config that never wrote installId", () => {
  const row = privacyRowsFor({ analytics: "enabled" }).find(
    (entry) => entry.id === "rotateInstallId",
  );
  expect(row?.detail).toBe("No identifier exists yet");
});
