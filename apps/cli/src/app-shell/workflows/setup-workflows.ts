import { dirname, join } from "node:path";

import { chooseFromListShell } from "@/app-shell/pickers";
import { describeKunaiHandoffLaunch, type KunaiHandoffLaunch } from "@/app/bootstrap/handoff-url";
import { shouldRunSetupWizard, type SetupWizardResult } from "@/app/bootstrap/startup-setup";
import type { Container } from "@/container";
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
  // One writer: the service owns what a consent choice means in config, and
  // `consentPatch` is pure so it folds into the single batched update below.
  // Aborting the wizard is not disclosure, so a skip stays off.
  const analyticsPatch =
    outcome === "skipped"
      ? container.usageAnalytics.consentPatch("disabled")
      : container.usageAnalytics.consentPatch(prefs.analyticsChoice);

  if (outcome === "skipped") {
    await container.config.update({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
      ...analyticsPatch,
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
      ...analyticsPatch,
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

  // The wizard IS the disclosure for this user. Clear the pending flag the
  // startup task may have raised, or the shell would also show the upgrader
  // banner and they would be told twice in one session.
  container.analyticsDisclosurePending = false;

  container.diagnosticsService.record({
    category: "session",
    message: outcome === "completed" ? "Setup wizard completed" : "Setup wizard skipped",
    context: { outcome, force, analytics: analyticsPatch.analytics },
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
