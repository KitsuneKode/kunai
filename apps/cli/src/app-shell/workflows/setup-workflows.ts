import { dirname, join } from "node:path";

import { chooseFromListShell } from "@/app-shell/pickers";
import { describeKunaiHandoffLaunch, type KunaiHandoffLaunch } from "@/app/bootstrap/handoff-url";
import {
  ONBOARDING_VERSION,
  shouldRunSetupWizard,
  type SetupWizardResult,
} from "@/app/bootstrap/startup-setup";
import type { Container } from "@/container";
import {
  setupPatchIsRestorable,
  writePreSetupSnapshot,
} from "@/services/persistence/pre-setup-snapshot";
import { getKunaiPaths } from "@/services/storage/storage-read-models";
import { probeCapabilities } from "@/ui";
import type { KitsuneConfig } from "@kunai/config";

import { runSetupFlow, type SetupInitialState } from "../setup-shell";
import { openTrackerConnectShell, type TrackerConnectOutcome } from "../tracker-connect-shell";

export type { SetupWizardResult } from "@/app/bootstrap/startup-setup";

/**
 * What the wizard's controls start from, read out of the config they will write
 * back to.
 *
 * Without this a rerun showed factory defaults in every control while claiming
 * to be *your* settings — completing it then rewrote `sync.*.enabled` to false
 * and severed linked trackers nobody asked to disconnect (#228). Each language
 * profile hydrates independently so changing one media lane never rewrites the
 * other three; the component clamps values that have drifted out of its catalog.
 */
export function wizardInitialStateFromConfig(
  current: Pick<
    KitsuneConfig,
    | "defaultMode"
    | "animeLanguageProfile"
    | "seriesLanguageProfile"
    | "movieLanguageProfile"
    | "youtubeLanguageProfile"
    | "autoNext"
    | "skipIntro"
    | "skipCredits"
    | "downloadsEnabled"
    | "defaultDownloadQuality"
    | "sync"
    | "presenceProvider"
  >,
  ytDlpReady: boolean,
): SetupInitialState {
  return {
    mode: current.defaultMode,
    languageProfiles: {
      series: {
        audio: current.seriesLanguageProfile.audio,
        subtitle: current.seriesLanguageProfile.subtitle,
      },
      movie: {
        audio: current.movieLanguageProfile.audio,
        subtitle: current.movieLanguageProfile.subtitle,
      },
      anime: {
        audio: current.animeLanguageProfile.audio,
        subtitle: current.animeLanguageProfile.subtitle,
      },
      youtube: {
        audio: current.youtubeLanguageProfile.audio,
        subtitle: current.youtubeLanguageProfile.subtitle,
      },
    },
    autoNext: current.autoNext,
    skipIntro: current.skipIntro,
    skipCredits: current.skipCredits,
    // A saved preference pointing at a queue that cannot run gets clamped the
    // same way `[r]` recheck clamps: follow what is installed.
    downloadsEnabled: current.downloadsEnabled && ytDlpReady,
    downloadQuality: current.defaultDownloadQuality,
    anilistSync: current.sync.anilist.enabled,
    tmdbSync: current.sync.tmdb.enabled,
    presenceDiscord: current.presenceProvider === "discord",
  };
}

function note(container: Container, message: string): void {
  container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note: message });
}

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
    // The controls start from what is actually configured, so completing the
    // wizard rewrites only what the screens showed (#228).
    initial: wizardInitialStateFromConfig(current, snapshot.ytDlp),
  });
  const { outcome, prefs, answeredScreens } = await result;
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
    // esc, `q`, or an Ink teardown, confirmed once anything was decided.
    //
    // Leaving from the first screen means "not yet" — the gate stays below the
    // onboarded floor so the next launch offers again. Leaving deeper means a
    // deliberate double-confirm: record that onboarding was offered so the
    // wizard does not ambush the next launch, and touch nothing else (#230).
    if (answeredScreens > 0) {
      await container.config.update({
        onboardingVersion: ONBOARDING_VERSION,
        downloadOnboardingDismissed: true,
      });
      await container.config.save();
    }
    note(container, "Setup exited early — run /setup any time.");
  } else {
    // `completed` and `defaults` write the same shape. That is the point:
    // skipping used to build prefs and discard them here, leaving the install
    // unconfigured while telling the user setup was done.
    const downloadsEnabled = prefs.downloadsEnabled;
    const downloadPath = downloadsEnabled
      ? current.downloadPath || defaultDownloadPath
      : current.downloadPath;

    const patch = {
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
      // An explicit turn-off commits here. Turning one ON does NOT commit
      // `enabled: true` up front — that flag is a standing decision, and
      // committing it before OAuth succeeds leaves config claiming a link it
      // does not have (#232). The post-connect step below flips it on success.
      sync: {
        ...current.sync,
        anilist: { ...current.sync.anilist, ...(prefs.connectAniList ? {} : { enabled: false }) },
        tmdb: { ...current.sync.tmdb, ...(prefs.connectTmdb ? {} : { enabled: false }) },
      },
      ...analyticsPatch,
      // Every lane is written from its own answer. Two earlier shapes were both
      // wrong: writing anime only left films and shows on original audio for a
      // user who picked English, and skipped YouTube entirely (#229); writing
      // one answer to all four then flattened per-lane choices that Settings
      // lets you set independently, so rerunning setup silently discarded them.
      // The `...current` spread keeps each profile's other fields — `quality`
      // among them — which this screen does not ask about.
      animeLanguageProfile: {
        ...current.animeLanguageProfile,
        ...prefs.languageProfiles.anime,
      },
      seriesLanguageProfile: {
        ...current.seriesLanguageProfile,
        ...prefs.languageProfiles.series,
      },
      movieLanguageProfile: {
        ...current.movieLanguageProfile,
        ...prefs.languageProfiles.movie,
      },
      youtubeLanguageProfile: {
        ...current.youtubeLanguageProfile,
        ...prefs.languageProfiles.youtube,
      },
    } satisfies Partial<KitsuneConfig>;

    // One restore point, and only when this run actually changes something the
    // user would miss. Best effort throughout: a snapshot that cannot be
    // written must not stop setup from finishing, so the failure is recorded
    // and the run continues.
    const worthSaving = setupPatchIsRestorable(current, patch);
    const snapshotted = worthSaving && (await writePreSetupSnapshot(current));
    if (worthSaving && !snapshotted) {
      container.diagnosticsService.record({
        category: "session",
        message: "Setup could not save a pre-setup configuration snapshot",
      });
    }

    await container.config.update(patch);
    await container.config.save();
    // A restore point nobody knows about is not a feature.
    if (snapshotted) {
      note(container, "Your previous settings were saved — restore them from /settings.");
    }
  }

  // The wizard IS the disclosure for this user. Clear the pending flag the
  // startup task may have raised, or the shell would also show the upgrader
  // banner and they would be told twice in one session.
  container.analyticsDisclosurePending = false;

  // Actually link the accounts the user asked for.
  //
  // This runs *after* config commits and outside the wizard's own lifetime, so
  // a browser that never opens costs an account link and not the whole setup.
  // `enabled` flips only on a successful connect: a standing "yes" in config
  // with no token behind it is the silent lie this ordering exists to prevent
  // (#232).
  let anilistLinked = false;
  let tmdbLinked = false;
  if (outcome !== "aborted") {
    for (const [tracker, wanted, linkedFlag] of [
      ["anilist", prefs.connectAniList, () => (anilistLinked = true)],
      ["tmdb", prefs.connectTmdb, () => (tmdbLinked = true)],
    ] as const) {
      if (!wanted) continue;
      let connectOutcome: TrackerConnectOutcome;
      try {
        connectOutcome = await openTrackerConnectShell(container, tracker);
      } catch (error) {
        container.diagnosticsService.record({
          category: "session",
          message: `Setup could not finish linking ${tracker}`,
          context: { error: String(error) },
        });
        note(container, `${tracker} not linked — connect it from Settings → Sync.`);
        continue;
      }
      if (connectOutcome.status === "connected") {
        linkedFlag();
      } else {
        container.diagnosticsService.record({
          category: "session",
          message: `Setup could not finish linking ${tracker}`,
          context: { reason: connectOutcome.status },
        });
        if (connectOutcome.status !== "cancelled") {
          note(container, `${tracker} not linked — connect it from Settings → Sync.`);
        }
      }
    }

    if (anilistLinked || tmdbLinked) {
      await container.config.update({
        sync: {
          ...current.sync,
          ...(anilistLinked ? { anilist: { ...current.sync.anilist, enabled: true } } : {}),
          ...(tmdbLinked ? { tmdb: { ...current.sync.tmdb, enabled: true } } : {}),
        },
      });
      await container.config.save();
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
  // `cancelled` deliberately says nothing here: the abort path inside
  // `runSetupWizard` has already told the user how to come back.
  const outcomeNote =
    result === "completed" ? "Setup complete." : result === "skipped" ? "Setup skipped." : null;
  if (outcomeNote) note(container, outcomeNote);
  return result;
}
