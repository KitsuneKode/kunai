import { expect, test } from "bun:test";

import { generalSettingsRows } from "@/app-shell/settings/registry/general";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

function baseConfig(): KitsuneConfig {
  return {
    defaultMode: "series",
  } as KitsuneConfig;
}

/**
 * `{} as never` used to be enough here because the builder ignored its
 * context. It reads the config now — the analytics row reports when the last
 * ping left — so the fixture has to supply the one field the type always
 * promised was there.
 */
function rows() {
  return generalSettingsRows({ config: baseConfig() } as never);
}

test("defaultMode write preserves youtube startup mode", () => {
  const row = rows().find((entry) => entry.id === "defaultMode");
  expect(row?.kind).toBe("enum");

  if (row?.kind !== "enum") {
    throw new Error("expected defaultMode enum row");
  }

  const next = row.write(baseConfig(), "youtube");
  expect(next.defaultMode).toBe("youtube");
});

test("usage analytics is a visible opt-in setting that clears the id when disabled", () => {
  const row = rows().find((entry) => entry.id === "usageAnalytics");
  expect(row?.kind).toBe("boolean");

  if (row?.kind !== "boolean") {
    throw new Error("expected usageAnalytics boolean row");
  }

  const enabled = { ...baseConfig(), analytics: "enabled" as const, installId: "stable-id" };
  expect(row.read(baseConfig())).toBe(false);
  expect(row.write(enabled, false)).toMatchObject({ analytics: "disabled", installId: "" });
});

function rowsFor(config: Partial<KitsuneConfig>) {
  return generalSettingsRows({ config: { ...baseConfig(), ...config } } as never);
}

test("rotate is offered only while analytics is enabled", () => {
  // Disabling already clears the id, so offering rotation beside an off switch
  // would imply an identifier still exists.
  const off = rowsFor({ analytics: "disabled" }).find((entry) => entry.id === "rotateInstallId");
  if (off?.kind !== "action") throw new Error("expected rotateInstallId action row");
  const predicate = off.gate?.predicate;
  if (!predicate) throw new Error("rotateInstallId must be gated on consent");
  expect(predicate({ analytics: "disabled" } as KitsuneConfig)).toBe(false);
  expect(predicate({ analytics: "enabled" } as KitsuneConfig)).toBe(true);
});

test("rotate writes a new id and restarts the ping cadence", async () => {
  const row = rowsFor({
    analytics: "enabled",
    installId: "11111111-2222-4333-8444-555555555555",
  }).find((entry) => entry.id === "rotateInstallId");
  if (row?.kind !== "action") throw new Error("expected rotateInstallId action row");

  let patch: Partial<KitsuneConfig> | undefined;
  let saved = 0;
  const message = await row.run({
    container: {
      config: {
        update: async (next: Partial<KitsuneConfig>) => {
          patch = next;
        },
        save: async () => {
          saved += 1;
        },
      },
    },
  } as never);

  expect(patch?.installId).not.toBe("11111111-2222-4333-8444-555555555555");
  expect(patch?.installId).toMatch(/^[0-9a-f-]{36}$/i);
  // Carrying the old timestamps would suppress the first ping under the new id
  // for up to a day, making the rotation unobservable.
  expect(patch).toMatchObject({ lastAnalyticsPingAt: 0, analyticsRetryAfter: 0 });
  expect(saved).toBe(1);
  expect(String(message)).toContain("cannot be linked");
});

test("the id line survives a config that never wrote installId", () => {
  const row = rowsFor({ analytics: "enabled" }).find((entry) => entry.id === "rotateInstallId");
  expect(row?.detail).toBe("No identifier exists yet");
});
