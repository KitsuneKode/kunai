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
      curl: true,
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
      outcome: "skipped",
      prefs: {
        audio: "original",
        subtitle: "en",
        downloadsEnabled: false,
        analyticsChoice: "disabled",
      },
    }),
  ).toBe(true);

  await expect(pending).resolves.toBe("skipped");
  expect(config.analytics).toBe("enabled");
  expect(config.installId).toBe("existing-install-id");
});
