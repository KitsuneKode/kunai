import { dirname, join } from "node:path";

import { chooseFromListShell } from "@/app-shell/pickers";
import { describeKunaiHandoffLaunch, type KunaiHandoffLaunch } from "@/app/bootstrap/handoff-url";
import { shouldRunSetupWizard, type SetupWizardResult } from "@/app/bootstrap/startup-setup";
import type { Container } from "@/container";
import { resolveTelemetryConsent } from "@/services/analytics/consent";
import { ensureInstallId } from "@/services/analytics/install-id";
import { getKunaiPaths } from "@/services/storage/storage-read-models";
import { probeCapabilities } from "@/ui";

import { runSetupFlow } from "../setup-shell";

export type { SetupWizardResult } from "@/app/bootstrap/startup-setup";

export async function confirmProtocolHandoff(handoff: KunaiHandoffLaunch): Promise<boolean> {
  const choice = await chooseFromListShell({
    title: "Open Kunai Link",
    subtitle: describeKunaiHandoffLaunch(handoff),
    options: [
      {
        value: "continue" as const,
        label: "Continue",
        detail: "Run this local Kunai action",
      },
      {
        value: "cancel" as const,
        label: "Cancel",
        detail: "Ignore the external link and close",
      },
    ],
  });

  return choice === "continue";
}

function resolveSetupTelemetry(
  prefsChoice: "enabled" | "disabled",
  outcome: "completed" | "skipped",
): "enabled" | "disabled" {
  return resolveTelemetryConsent({
    env: {
      DO_NOT_TRACK: process.env.DO_NOT_TRACK,
      CI: process.env.CI,
    },
    isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    choice: outcome === "skipped" ? "timeout" : prefsChoice,
  });
}

export async function runSetupWizard({
  container,
  force = false,
}: {
  container: Container;
  force?: boolean;
}): Promise<SetupWizardResult> {
  const current = container.config.getRaw();
  if (
    !shouldRunSetupWizard({
      force,
      config: {
        onboardingVersion: current.onboardingVersion,
        downloadOnboardingDismissed: current.downloadOnboardingDismissed,
      },
    })
  ) {
    return "skipped";
  }

  // Probe rather than hand-roll a snapshot. This literal duplicated
  // probeCapabilities and drifted from it: it was still reporting `chafa` and
  // `magick` after both were retired, and TypeScript missed it because the `??`
  // widened the type instead of checking the literal. Probing is also the only
  // option now — app-shell may not import the provider package, so it cannot ask
  // AniDB which curl builds it can drive.
  const snapshot = container.capabilitySnapshot ?? (await probeCapabilities());

  const defaultDownloadPath = join(dirname(getKunaiPaths().dataDbPath), "downloads");
  const { result } = runSetupFlow(snapshot);
  const { outcome, prefs } = await result;
  const analytics = resolveSetupTelemetry(prefs.telemetryChoice, outcome);
  const installId = ensureInstallId(current);

  if (outcome === "skipped") {
    await container.config.update({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
      analytics,
      installId,
    });
    await container.config.save();
  } else {
    const downloadsEnabled = prefs.downloadsEnabled;
    const downloadPath = downloadsEnabled
      ? current.downloadPath || defaultDownloadPath
      : current.downloadPath;

    await container.config.update({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
      downloadsEnabled,
      downloadPath,
      analytics,
      installId,
      animeLanguageProfile: {
        ...current.animeLanguageProfile,
        audio: prefs.audio,
        subtitle: prefs.subtitle,
      },
      seriesLanguageProfile: {
        ...current.seriesLanguageProfile,
        subtitle: prefs.subtitle,
      },
      movieLanguageProfile: {
        ...current.movieLanguageProfile,
        subtitle: prefs.subtitle,
      },
    });
    await container.config.save();
  }

  container.diagnosticsService.record({
    category: "session",
    message: outcome === "completed" ? "Setup wizard completed" : "Setup wizard skipped",
    context: { outcome, force, analytics },
  });

  return outcome === "completed" ? "completed" : "skipped";
}

function closeActiveOverlays(container: Container): void {
  let guard = 0;
  while (container.stateManager.getState().activeModals.length > 0 && guard < 32) {
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    guard += 1;
  }
}

/** Run setup from a shell command and block until the wizard finishes. */
export async function openSetupWizardFromShell(
  container: Container,
  options: { readonly force?: boolean; readonly closeOverlays?: boolean } = {},
): Promise<SetupWizardResult> {
  if (options.closeOverlays ?? true) {
    closeActiveOverlays(container);
  }

  const result = await runSetupWizard({ container, force: options.force ?? true });
  const note =
    result === "completed" ? "Setup complete." : result === "skipped" ? "Setup skipped." : null;
  if (note) {
    container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
  }
  return result;
}
