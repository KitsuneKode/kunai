import { dirname, join } from "node:path";

import { chooseFromListShell } from "@/app-shell/pickers";
import { describeKunaiHandoffLaunch, type KunaiHandoffLaunch } from "@/app/bootstrap/handoff-url";
import {
  ONBOARDING_VERSION,
  shouldRunSetupWizard,
  type SetupWizardResult,
} from "@/app/bootstrap/startup-setup";
import type { Container } from "@/container";
import { getKunaiPaths } from "@/services/storage/storage-read-models";
import { probeCapabilities } from "@/ui";

import { runSetupFlow } from "../setup-shell";
import { connectNamedTracker } from "./shell-workflows";

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
  const { result } = runSetupFlow(snapshot, {
    downloadPath: current.downloadPath || defaultDownloadPath,
    // `[r]` re-probes rather than making the user quit and relaunch after
    // installing something in another pane.
    onRecheck: () => probeCapabilities(),
  });
  const { outcome, prefs } = await result;
  // One writer: the service owns what a consent choice means in config, and
  // `consentPatch` is pure so it folds into the single batched update below.
  //
  // Two ways to reach "leave it alone": aborting, and finishing without ever
  // reaching the consent screen. Neither is a consent decision, and writing
  // `disabled` for either would silently opt out a user who had opted in and
  // then reran setup.
  const analyticsPatch =
    outcome === "aborted" || prefs.analyticsChoice === "unchanged"
      ? {}
      : container.usageAnalytics.consentPatch(prefs.analyticsChoice);

  if (outcome === "aborted") {
    // esc, `q`, or an Ink teardown. Record that onboarding was offered so the
    // wizard does not ambush the next launch, and touch nothing else.
    await container.config.update({
      onboardingVersion: ONBOARDING_VERSION,
      downloadOnboardingDismissed: true,
    });
    await container.config.save();
  } else {
    // `completed` and `defaults` write the same shape. That is the point:
    // skipping used to build prefs and discard them here, leaving the install
    // unconfigured while telling the user setup was done.
    const downloadsEnabled = prefs.downloadsEnabled;
    const downloadPath = downloadsEnabled
      ? current.downloadPath || defaultDownloadPath
      : current.downloadPath;

    await container.config.update({
      onboardingVersion: ONBOARDING_VERSION,
      downloadOnboardingDismissed: true,
      downloadsEnabled,
      downloadPath,
      defaultMode: prefs.mode,
      defaultDownloadQuality: prefs.downloadQuality,
      autoNext: prefs.autoNext,
      skipIntro: prefs.skipIntro,
      skipCredits: prefs.skipCredits,
      // Presence is a local IPC connection, so it can be switched on here.
      // AniList and TMDB are not: both need a browser round-trip, which runs
      // after this commit so a failed handoff never costs the whole wizard.
      presenceProvider: prefs.presenceDiscord ? "discord" : current.presenceProvider,
      sync: {
        ...current.sync,
        anilist: { ...current.sync.anilist, enabled: prefs.connectAniList },
        tmdb: { ...current.sync.tmdb, enabled: prefs.connectTmdb },
      },
      ...analyticsPatch,
      // Audio reaches all three lanes. It previously landed on anime only,
      // while the slide asked which audio Kunai should prefer generally — so a
      // user who chose English still got original audio for films and shows.
      animeLanguageProfile: {
        ...current.animeLanguageProfile,
        audio: prefs.audio,
        subtitle: prefs.subtitle,
      },
      seriesLanguageProfile: {
        ...current.seriesLanguageProfile,
        audio: prefs.audio,
        subtitle: prefs.subtitle,
      },
      movieLanguageProfile: {
        ...current.movieLanguageProfile,
        audio: prefs.audio,
        subtitle: prefs.subtitle,
      },
    });
    await container.config.save();
  }

  // The wizard IS the disclosure for this user. Clear the pending flag the
  // startup task may have raised, or the shell would also show the upgrader
  // banner and they would be told twice in one session.
  container.analyticsDisclosurePending = false;

  // Actually link the accounts the user asked for.
  //
  // This runs *after* config commits and outside the wizard's own lifetime, so
  // a browser that never opens costs an account link and not the whole setup.
  // Without it the screen-5 toggles were cosmetic: they wrote
  // `sync.<tracker>.enabled` and nothing ever opened, which is the silent
  // no-op this plan exists to remove rather than reproduce.
  if (outcome !== "aborted") {
    for (const [tracker, wanted] of [
      ["anilist", prefs.connectAniList],
      ["tmdb", prefs.connectTmdb],
    ] as const) {
      if (!wanted) continue;
      try {
        await connectNamedTracker(container, tracker);
      } catch (error) {
        container.diagnosticsService.record({
          category: "session",
          message: `Setup could not finish linking ${tracker}`,
          context: { error: String(error) },
        });
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `${tracker} not linked — run /sync-connect-${tracker} to try again.`,
        });
      }
    }
  }

  container.diagnosticsService.record({
    category: "session",
    message:
      outcome === "completed"
        ? "Setup wizard completed"
        : outcome === "defaults"
          ? "Setup wizard accepted recommended defaults"
          : "Setup wizard aborted",
    context: {
      outcome,
      force,
      analytics: analyticsPatch.analytics ?? current.analytics,
    },
  });

  // `defaults` reports as completed to the caller: a recommended configuration
  // was written, which is what "completed" means to everything downstream.
  return outcome === "aborted" ? "cancelled" : "completed";
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
