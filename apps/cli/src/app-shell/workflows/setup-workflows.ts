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

import { announceShellLine } from "../contextual-tips";
import { runSetupFlow as runSetupFlowShell, type SetupInitialState } from "../setup-shell";
import { openTrackerConnectShell, type TrackerConnectOutcome } from "../tracker-connect-shell";
import { turnOnTrackerSync } from "./tracker-connect";

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

/** The player the verdict line names, when this session does not drive mpv. */
export function setupPlayerName(mode: Container["playerMode"] | undefined): string | undefined {
  if (!mode) return undefined;
  if (mode.kind === "managed-vlc") return "VLC";
  if (mode.kind === "android-handoff") {
    return mode.target === "vlc" ? "VLC" : mode.target === "mpv" ? "mpv" : "your video player";
  }
  return undefined;
}

function note(container: Container, message: string): void {
  container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note: message });
}

export const SETUP_SAVED_LINE = "Setup saved · /setup for language and more";

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
  probeCapabilities: probe = probeCapabilities,
  runSetupFlow: runFlow = runSetupFlowShell,
}: {
  container: Container;
  force?: boolean;
  /** Test seam; production uses the real machine probe. */
  probeCapabilities?: typeof probeCapabilities;
  /** Test seam; production mounts the real wizard. */
  runSetupFlow?: typeof runSetupFlowShell;
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
  // The container's mode is the same one playback will use for this session.
  // Recheck deliberately reuses it rather than rediscovering a different auto
  // answer halfway through setup: installing mpv in another pane must not make
  // the deps screen contradict the VLC service this session already selected.
  const probeForSelectedPlayer = () =>
    probe({ playerMode: container.playerMode, mpvHwdecMode: container.config.mpvHwdec });
  const snapshot = container.capabilitySnapshot ?? (await probeForSelectedPlayer());

  const defaultDownloadPath = join(dirname(getKunaiPaths().dataDbPath), "downloads");
  const playerName = setupPlayerName(container.playerMode);
  const { result } = runFlow(snapshot, {
    downloadPath: current.downloadPath || defaultDownloadPath,
    // `[r]` re-probes rather than making the user quit and relaunch after
    // installing something in another pane.
    onRecheck: () =>
      probe({
        playerMode: container.playerMode,
        probeMpvHwaccel: true,
        mpvHwdecMode: container.config.mpvHwdec,
      }),
    // The controls start from what is actually configured, so completing the
    // wizard rewrites only what the screens showed (#228).
    initial: wizardInitialStateFromConfig(current, snapshot.ytDlp),
    analyticsPayload: container.usageAnalytics.describePayload(),
    // A first launch asks two things; asking for setup gets all six screens.
    flow: force ? "full" : "quick",
    playerName,
  });
  const { outcome, prefs, answeredScreens, flow } = await result;
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
    const patch: Partial<KitsuneConfig> = {
      onboardingVersion: ONBOARDING_VERSION,
      downloadOnboardingDismissed: true,
      defaultMode: prefs.mode,
      ...analyticsPatch,
    };
    if (flow === "full") {
      Object.assign(patch, {
        downloadsEnabled: prefs.downloadsEnabled,
        downloadPath: prefs.downloadsEnabled
          ? current.downloadPath || defaultDownloadPath
          : current.downloadPath,
        defaultDownloadQuality: prefs.downloadQuality,
        autoNext: prefs.autoNext,
        skipIntro: prefs.skipIntro,
        skipCredits: prefs.skipCredits,
        // Presence is a local IPC connection, so it can be switched on here.
        // AniList and TMDB are not: both need a browser round-trip, which runs
        // after this commit so a failed handoff never costs the whole wizard.
        // The toggle hydrates from config, so unticked means off: writing the
        // current value back made turning Discord off here impossible.
        presenceProvider: prefs.presenceDiscord ? "discord" : "off",
        // An explicit turn-off commits here. Turning one ON does NOT commit
        // `enabled: true` up front — that flag is a standing decision, and
        // committing it before OAuth succeeds leaves config claiming a link it
        // does not have (#232). The post-connect step below flips it on success.
        sync: {
          ...current.sync,
          anilist: {
            ...current.sync.anilist,
            ...(prefs.connectAniList ? null : { enabled: false }),
          },
          tmdb: { ...current.sync.tmdb, ...(prefs.connectTmdb ? null : { enabled: false }) },
        },
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
      } satisfies Partial<KitsuneConfig>);
    }

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

    // Through the same path as Settings, so the chosen mode, language
    // profiles and presence take effect in this session. A bare config write
    // left a first-run user who picked Anime in Movies & Series, on the old
    // languages, until they restarted. Analytics goes through it too: the
    // consent service turns the explicit choice into config, as in Settings.
    const { applySettingsToRuntime } = await import("@/app/bootstrap/apply-settings-to-runtime");
    await applySettingsToRuntime({ container, next: patch });
    // A "don't share" answer removes the local ping log with the id.
    await container.usageAnalytics.settleLocalPingLog();
    // A restore point nobody knows about is not a feature.
    if (snapshotted) {
      note(container, "Your previous settings were saved — restore them from /settings.");
    }
    // The quick flow has no review screen, so Browse says it once instead.
    if (flow === "quick") announceShellLine(SETUP_SAVED_LINE);
  }

  // The wizard IS the disclosure for this user. Clear the pending flag the
  // startup task may have raised, or the shell would also show the upgrader
  // banner and they would be told twice in one session.
  container.analyticsDisclosurePending = false;

  // Actually link the accounts the user asked for.
  //
  // This runs *after* config commits and outside the wizard's own lifetime, so
  // a browser that never opens costs an account link and not the whole setup.
  // Sync turns on only on a successful connect: a standing "yes" in config
  // with no token behind it is the silent lie this ordering exists to prevent
  // (#232). A fresh link turns it on inside `connectNamedTracker`; an account
  // that was already linked is turned on here, because the tick asked for it.
  if (outcome !== "aborted" && flow === "full") {
    for (const [tracker, wanted] of [
      ["anilist", prefs.connectAniList],
      ["tmdb", prefs.connectTmdb],
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
        note(container, `${tracker} not linked — connect it from Settings → Accounts & Sync.`);
        continue;
      }
      if (connectOutcome.status === "connected") {
        if (connectOutcome.alreadyConnected) await turnOnTrackerSync(container, tracker);
      } else {
        container.diagnosticsService.record({
          category: "session",
          message: `Setup could not finish linking ${tracker}`,
          context: { reason: connectOutcome.status },
        });
        if (connectOutcome.status !== "cancelled") {
          note(container, `${tracker} not linked — connect it from Settings → Accounts & Sync.`);
        }
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
  // `cancelled` deliberately says nothing here: the abort path inside
  // `runSetupWizard` has already told the user how to come back.
  const outcomeNote =
    result === "completed" ? "Setup complete." : result === "skipped" ? "Setup skipped." : null;
  if (outcomeNote) note(container, outcomeNote);
  return result;
}
