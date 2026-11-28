import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { forceCloseRootContent } from "@/app-shell/root-content-state";
import { FACTORY_INITIAL_STATE, type SetupFlowPayload } from "@/app-shell/setup-shell";
import { runSetupWizard } from "@/app-shell/workflows/setup-workflows";
import type { Container } from "@/container";
import { getKunaiPaths } from "@/services/storage/storage-read-models";
import type { CapabilitySnapshot, probeCapabilities } from "@/ui";
import { DEFAULT_CONFIG } from "@kunai/config";

import { applyStorageRootEnv } from "../../helpers/storage-env";
import { UNSET_PAYLOAD_FIXTURE } from "../../support/analytics-fixtures";

// A completing run now writes a restore point beside the real config, so this
// file owns a throwaway storage root rather than touching the developer's
// profile to assert something about analytics.
let storageRoot = "";
let restoreEnv: () => void = () => undefined;

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "kunai-setup-consent-"));
  restoreEnv = applyStorageRootEnv(storageRoot);
  mkdirSync(getKunaiPaths().configDir, { recursive: true });
});

afterAll(() => {
  restoreEnv();
  rmSync(storageRoot, { recursive: true, force: true });
});

/**
 * The analytics contract's guardrails, driven through the real wizard: only a
 * keystroke on the consent screen moves the value, so an abort or an
 * accept-all that never reached it must leave an existing choice standing.
 */

function fakeContainer(overrides: Partial<Parameters<typeof runSetupWizard>[0]["container"]> = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    analytics: "enabled" as const,
    installId: "existing-install-id",
  };
  const notes: string[] = [];
  const container = {
    config: {
      get mpvHwdec() {
        return config.mpvHwdec;
      },
      getRaw: () => ({ ...config }),
      update: async (patch: Partial<typeof config>) => {
        Object.assign(config, patch);
      },
      save: async () => undefined,
    },
    capabilitySnapshot: {
      mpv: true,
      mpvRequired: true,
      vlc: true,
      vlcRequired: false,
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
          ? {
              analytics: "enabled" as const,
              installId: config.installId,
              analyticsCohort: "2026-11",
            }
          : { analytics: "disabled" as const, installId: "", analyticsCohort: "" },
      describePayload: () => UNSET_PAYLOAD_FIXTURE,
      settleLocalPingLog: async () => undefined,
    },
    diagnosticsService: { record: () => undefined },
    stateManager: {
      dispatch: (action: { type: string; note?: string }) => {
        if (action.type === "SET_PLAYBACK_FEEDBACK" && action.note) notes.push(action.note);
      },
      getState: () => ({ activeModals: [] as unknown[], mode: config.defaultMode }),
    },
    // What setup's runtime apply touches; inert here.
    providerRegistry: { setPriority: () => undefined },
    presence: { disconnect: async () => undefined },
    connectivity: { notifyIntentChanged: () => undefined },
    downloadService: { kickQueue: () => undefined },
    syncService: {
      adapters: [],
      resumeAfterReauth: () => 0,
      deliverSoon: () => undefined,
    },
    analyticsDisclosurePending: false,
    ...overrides,
  } as unknown as Container;
  return { container, config, notes };
}

const UNTOUCHED_PREFS = {
  mode: "series",
  languageProfiles: FACTORY_INITIAL_STATE.languageProfiles,
  autoNext: true,
  skipIntro: true,
  skipCredits: true,
  downloadsEnabled: false,
  downloadQuality: "1080p",
  connectAniList: false,
  connectTmdb: false,
  presenceDiscord: false,
} as const;

test("setup probes the selected player mode on first paint and on dependency recheck", async () => {
  const probeCalls: Array<Parameters<typeof probeCapabilities>[0] | undefined> = [];
  let recheck: (() => Promise<CapabilitySnapshot>) | undefined;
  const snapshot = {
    mpv: false,
    vlc: true,
    mpvRequired: false,
    vlcRequired: true,
    ffprobe: true,
    ytDlp: true,
    curl: { present: true, impersonates: true, profile: "chrome150" },
    mpvHardwareAccel: {
      probed: false,
      drivers: [],
      autoSafeOk: false,
      autoSafeDriver: "",
      status: "mpv-not-found",
      probedAt: null,
      fromCache: false,
    },
    image: {
      terminal: "unknown",
      protocol: "none",
      renderer: "none",
      available: false,
      reason: "test fixture",
    },
    issues: [],
  } as const;
  const { container } = fakeContainer({
    capabilitySnapshot: null,
    playerMode: { kind: "managed-vlc" },
  });

  const outcome = await runSetupWizard({
    container,
    force: true,
    probeCapabilities: async (options) => {
      probeCalls.push(options);
      return snapshot;
    },
    runSetupFlow: (_probedSnapshot, options) => {
      recheck = options.onRecheck;
      return {
        result: Promise.resolve({
          flow: options.flow ?? "full",
          outcome: "aborted",
          prefs: { ...UNTOUCHED_PREFS, analyticsChoice: "unchanged" },
          answeredScreens: 0,
        }),
      };
    },
  });

  expect(outcome).toBe("cancelled");
  expect(probeCalls[0]?.playerMode).toEqual({ kind: "managed-vlc" });
  await recheck?.();
  expect(probeCalls.map((call) => call?.playerMode)).toEqual([
    { kind: "managed-vlc" },
    { kind: "managed-vlc" },
  ]);
});

test("setup overlays the current decoder mode onto a reused startup snapshot", async () => {
  const reusedSnapshot = {
    mpv: true,
    mpvRequired: true,
    vlc: true,
    vlcRequired: false,
    ffprobe: true,
    ytDlp: true,
    curl: { present: true, impersonates: true, profile: "chrome150" },
    mpvHardwareAccel: {
      probed: true,
      drivers: ["vaapi", "nvdec"],
      autoSafeOk: true,
      autoSafeDriver: "nvdec-copy",
      status: "hardware",
      probedAt: 123,
      fromCache: true,
    },
    mpvHwdecMode: "mpv-default",
    image: {
      terminal: "unknown",
      protocol: "none",
      renderer: "none",
      available: false,
      reason: "test fixture",
    },
    issues: [],
  } as const;
  const { container, config } = fakeContainer({ capabilitySnapshot: reusedSnapshot });
  config.mpvHwdec = "auto";
  let flowSnapshot: CapabilitySnapshot | undefined;

  const outcome = await runSetupWizard({
    container,
    force: true,
    probeCapabilities: async () => {
      throw new Error("a reused startup snapshot must not probe again on setup paint");
    },
    runSetupFlow: (snapshot, options) => {
      flowSnapshot = snapshot;
      return {
        result: Promise.resolve({
          flow: options.flow ?? "full",
          outcome: "aborted",
          prefs: { ...UNTOUCHED_PREFS, analyticsChoice: "unchanged" },
          answeredScreens: 0,
        }),
      };
    },
  });

  expect(outcome).toBe("cancelled");
  expect(flowSnapshot?.mpvHwdecMode).toBe("auto");
  expect(flowSnapshot?.mpvHardwareAccel).toEqual(reusedSnapshot.mpvHardwareAccel);
});

test("aborting a forced setup rerun preserves an existing analytics opt-in", async () => {
  const { container, config } = fakeContainer();

  const pending = runSetupWizard({ container, force: true });
  const payload: SetupFlowPayload = {
    flow: "full",
    outcome: "aborted",
    prefs: { ...UNTOUCHED_PREFS, analyticsChoice: "unchanged" },
    answeredScreens: 0,
  };
  expect(forceCloseRootContent(payload)).toBe(true);

  await expect(pending).resolves.toBe("cancelled");
  expect(config.analytics).toBe("enabled");
  expect(config.installId).toBe("existing-install-id");
});

test("accepting recommended defaults without reaching consent leaves an opt-in alone", async () => {
  // `S` on an early slide finishes setup without the consent slide ever being
  // shown. That is not a decision about analytics, so an existing opt-in must
  // survive it — the mirror of the rule that a skip may never opt someone IN.
  const { container, config } = fakeContainer();

  const pending = runSetupWizard({ container, force: true });
  const payload: SetupFlowPayload = {
    flow: "full",
    outcome: "defaults",
    prefs: { ...UNTOUCHED_PREFS, downloadsEnabled: true, analyticsChoice: "unchanged" },
    answeredScreens: 0,
  };
  expect(forceCloseRootContent(payload)).toBe(true);

  await expect(pending).resolves.toBe("completed");
  expect(config.analytics).toBe("enabled");
  expect(config.installId).toBe("existing-install-id");
  // The rest of the recommended configuration still lands.
  expect(config.downloadsEnabled).toBe(true);
  expect(config.seriesLanguageProfile.audio).toBe("original");
  expect(config.movieLanguageProfile.audio).toBe("original");
});

test("a fresh install that never reaches consent stays unset, with no install id", async () => {
  // The primary direction of the opt-in contract: nothing but a keystroke on
  // the consent screen may enable analytics, and that screen pre-selects nothing.
  // A fresh install that accepts defaults before reaching the slide must come
  // out `unset` with no `installId` -- `unset` is not `disabled`, and a config
  // Kunai never wrote is the only honest record of a decision never made.
  const patches: Record<string, unknown>[] = [];
  const { container, config } = fakeContainer();
  Object.assign(config, {
    analytics: DEFAULT_CONFIG.analytics,
    installId: DEFAULT_CONFIG.installId,
  });
  const realUpdate = container.config.update.bind(container.config);
  container.config.update = async (patch: Record<string, unknown>) => {
    patches.push(patch);
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    return realUpdate(patch as never);
  };

  const pending = runSetupWizard({ container, force: true });
  expect(
    forceCloseRootContent({
      flow: "full",
      outcome: "defaults",
      prefs: { ...UNTOUCHED_PREFS, analyticsChoice: "unchanged" },
      answeredScreens: 0,
    } satisfies SetupFlowPayload),
  ).toBe(true);

  await expect(pending).resolves.toBe("completed");
  // Widened: the fixture types these as the literals it was built with, and the
  // assertion is precisely that they never moved off the factory values.
  const written = config as { analytics: string; installId: string };
  expect(written.analytics).toBe(DEFAULT_CONFIG.analytics);
  expect(written.installId).toBe(DEFAULT_CONFIG.installId);
  // Stronger than comparing values: no write may even mention analytics, so a
  // later change cannot satisfy this by writing `unset` back over itself.
  expect(
    patches.some(
      (patch) => "analytics" in patch || "installId" in patch || "analyticsCohort" in patch,
    ),
  ).toBe(false);
});
