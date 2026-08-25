import { expect, test } from "bun:test";

import { forceCloseRootContent } from "@/app-shell/root-content-state";
import { runSetupWizard } from "@/app-shell/workflows/setup-workflows";
import type { Container } from "@/container";
import { DEFAULT_CONFIG } from "@kunai/config";

test("skipping a forced setup rerun preserves an existing analytics opt-in", async () => {
  let config = {
    ...DEFAULT_CONFIG,
    analytics: "enabled" as const,
    installId: "existing-install-id",
  };
  const container = {
    config: {
      getRaw: () => config,
      update: async (patch: Partial<typeof config>) => {
        config = { ...config, ...patch };
      },
      save: async () => undefined,
    },
    capabilitySnapshot: {
      mpv: true,
      ffprobe: true,
      ytDlp: true,
      curl: { present: true, impersonates: true, profile: "chrome150" },
      image: {
        terminal: "unknown",
        protocol: "none",
        renderer: "none",
        available: false,
        reason: "test fixture",
      },
      issues: [],
    },
    usageAnalytics: {
      consentPatch: (choice: "enabled" | "disabled") =>
        choice === "enabled"
          ? { analytics: "enabled" as const, installId: config.installId }
          : { analytics: "disabled" as const, installId: "" },
    },
    diagnosticsService: { record: () => undefined },
    analyticsDisclosurePending: false,
  } as unknown as Container;

  const pending = runSetupWizard({ container, force: true });
  expect(
    forceCloseRootContent({
      outcome: "aborted",
      prefs: {
        audio: "original",
        subtitle: "en",
        downloadsEnabled: false,
        analyticsChoice: "unchanged",
      },
    }),
  ).toBe(true);

  await expect(pending).resolves.toBe("cancelled");
  expect(config.analytics).toBe("enabled");
  expect(config.installId).toBe("existing-install-id");
});

test("accepting recommended defaults without reaching consent leaves an opt-in alone", async () => {
  // `S` on an early slide finishes setup without the consent slide ever being
  // shown. That is not a decision about analytics, so an existing opt-in must
  // survive it — the mirror of the rule that a skip may never opt someone IN.
  let config = {
    ...DEFAULT_CONFIG,
    analytics: "enabled" as const,
    installId: "existing-install-id",
  };
  const container = {
    config: {
      getRaw: () => config,
      update: async (patch: Partial<typeof config>) => {
        config = { ...config, ...patch };
      },
      save: async () => undefined,
    },
    capabilitySnapshot: {
      mpv: true,
      ffprobe: true,
      ytDlp: true,
      curl: { present: true, impersonates: true, profile: "chrome150" },
      image: {
        terminal: "unknown",
        protocol: "none",
        renderer: "none",
        available: false,
        reason: "test fixture",
      },
      issues: [],
    },
    usageAnalytics: {
      consentPatch: (choice: "enabled" | "disabled") =>
        choice === "enabled"
          ? { analytics: "enabled" as const, installId: config.installId }
          : { analytics: "disabled" as const, installId: "" },
    },
    diagnosticsService: { record: () => undefined },
    analyticsDisclosurePending: false,
  } as unknown as Container;

  const pending = runSetupWizard({ container, force: true });
  expect(
    forceCloseRootContent({
      outcome: "defaults",
      prefs: {
        audio: "original",
        subtitle: "en",
        downloadsEnabled: true,
        analyticsChoice: "unchanged",
      },
    }),
  ).toBe(true);

  await expect(pending).resolves.toBe("completed");
  expect(config.analytics).toBe("enabled");
  expect(config.installId).toBe("existing-install-id");
  // The rest of the recommended configuration still lands.
  expect(config.downloadsEnabled).toBe(true);
  expect(config.seriesLanguageProfile.audio).toBe("original");
  expect(config.movieLanguageProfile.audio).toBe("original");
});

test("a fresh install that never reaches consent stays unset, with no install id", async () => {
  // The primary direction of the opt-in contract, and the one the recommended-
  // first consent slide makes worth pinning: analytics leads and is marked
  // recommended, so nothing but a keystroke on that slide may enable it. A
  // fresh install that skips setup, or accepts defaults before the slide is
  // reached, must come out `unset` with no `installId` written at all —
  // `unset` is not `disabled`, and a config Kunai never wrote is the only
  // honest record of a decision the user never made.
  let config = { ...DEFAULT_CONFIG };
  const patches: Partial<typeof config>[] = [];
  const container = {
    config: {
      getRaw: () => config,
      update: async (patch: Partial<typeof config>) => {
        patches.push(patch);
        config = { ...config, ...patch };
      },
      save: async () => undefined,
    },
    capabilitySnapshot: {
      mpv: true,
      ffprobe: true,
      ytDlp: true,
      curl: { present: true, impersonates: true, profile: "chrome150" },
      image: {
        terminal: "unknown",
        protocol: "none",
        renderer: "none",
        available: false,
        reason: "test fixture",
      },
      issues: [],
    },
    usageAnalytics: {
      consentPatch: (choice: "enabled" | "disabled") =>
        choice === "enabled"
          ? { analytics: "enabled" as const, installId: "generated-install-id" }
          : { analytics: "disabled" as const, installId: "" },
    },
    diagnosticsService: { record: () => undefined },
    analyticsDisclosurePending: false,
  } as unknown as Container;

  const pending = runSetupWizard({ container, force: true });
  expect(
    forceCloseRootContent({
      outcome: "defaults",
      prefs: {
        audio: "original",
        subtitle: "en",
        downloadsEnabled: true,
        analyticsChoice: "unchanged",
      },
    }),
  ).toBe(true);

  await expect(pending).resolves.toBe("completed");
  expect(config.analytics).toBe(DEFAULT_CONFIG.analytics);
  expect(config.installId).toBe(DEFAULT_CONFIG.installId);
  // Stronger than the values above: no write may even mention analytics, so a
  // future patch cannot satisfy this by writing `unset` back over itself.
  expect(patches.some((patch) => "analytics" in patch || "installId" in patch)).toBe(false);
});
