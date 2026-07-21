#!/usr/bin/env bun
// =============================================================================
// Kunai - Canonical Runtime Entry Point
//
// Usage:
//   bun run dev                            # Interactive mode
//   bun run dev -- -S "Breaking Bad"       # Search directly
//   bun run dev -- -i 438631 -t movie      # By ID
//   bun run dev -- -a                      # Anime mode
//   bun run dev -- -S "Dune" --jump 1      # Pick first search result without browse UI
//   bun run dev -- -S "Dune" -q            # Quick: same as --jump 1 when searching
//   bun run dev -- --continue              # Continue newest unfinished local history entry
//   bun run dev -- --history               # Open watch history first
//   bun run dev -- --offline               # Open completed offline library first
//   bun run dev -- --discover              # Open recommendations first
//   bun run dev -- --calendar              # Open releases airing today first
//   bun run dev -- --random                # Open a rerollable random recommendation tray first
//   bun run dev -- -m                      # Minimal footer for this session
//
// This file owns the current fullscreen session runtime.
// Keep new architecture work here. apps/cli/index.ts is only a temporary
// compatibility shim while migration residue is retired.
// =============================================================================

import { existsSync } from "node:fs";

import { applyShareRefLaunch } from "@/app/bootstrap/apply-resolved-share-target";
import { resolveBootstrapIntent } from "@/app/bootstrap/bootstrap-intent";
import { parseKunaiHandoffUrl, type KunaiHandoffLaunch } from "@/app/bootstrap/handoff-url";
import {
  applyHistorySelectionProvider,
  episodeFromHistorySelection,
  historyLaunchSelectionFromContinuation,
  recordLocalHistorySourceDecision,
  prepareReplayTitleForProvider,
  titleFromHistorySelection,
} from "@/app/bootstrap/launch-entry";
import { maybeRunStartupSetup, shouldRunSetupWizard } from "@/app/bootstrap/startup-setup";
import { resolveSessionConfigOverrides } from "@/app/session/session-overrides";
import { SessionController } from "@/app/session/SessionController";
import {
  createShutdownCoordinator,
  type ShutdownCoordinator,
  type ShutdownRuntime,
} from "@/app/session/shutdown-coordinator";
import { bindShutdownRequestHandler } from "@/app/session/shutdown-request";
import { buildCliHelpText, parseCliArgs, type CliArgs } from "@/cli-args";
import { createContainer, disposeContainer } from "@/container";
import {
  parseKunaiShareUrl,
  type KunaiShareAction,
  type PlaybackTargetRef,
} from "@/domain/share/playback-target-ref";
import type { EpisodeInfo, SearchResult, TitleInfo } from "@/domain/types";
import {
  recordContinuationProjectDecision,
  recordContinuationSourceResolution,
} from "@/services/continuation/continuation-diagnostics";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import { recordCliStartupMilestone } from "@/services/diagnostics/cli-startup-milestone";
import {
  parseOfflineTitleCleanupPreference,
  selectDownloadCleanupCandidates,
} from "@/services/download/download-cleanup-policy";
import { updateSignalFromCheck } from "@/services/notifications/notification-update-signal";
import { checkDeps } from "@/ui";
import type { HistoryProgress, ReleaseProgressProjection } from "@kunai/storage";

import packageJson from "../package.json" with { type: "json" };

// Single source of truth for the runtime version. Derived from package.json so
// the published CLI can never drift from `@kitsunekode/kunai`'s npm version.
// Bun's bundler inlines the JSON at build time (see apps/cli/scripts/build.ts).
const KUNAI_VERSION: string = packageJson.version;

// Compatibility exports for older tests/imports. The implementation lives in
// cli-args.ts so main.ts stays focused on launch orchestration.
export function buildHelpText(): string {
  return buildCliHelpText(KUNAI_VERSION);
}

export function parseArgs(argv: readonly string[]): CliArgs {
  return parseCliArgs(argv);
}

type PendingShareLaunch = {
  readonly action: KunaiShareAction;
  readonly ref: PlaybackTargetRef;
  readonly trusted: boolean;
};

let globalController: SessionController | null = null;
let globalContainer: Awaited<ReturnType<typeof createContainer>> | null = null;
let processHandlersInitialized = false;
/** Resolves once startup lifetime-lock acquisition settled (versioned binary). */
let lifetimeLockReady: Promise<void> = Promise.resolve();

async function shutdownShell(): Promise<void> {
  const { shutdownSessionApp } = await import("./app-shell/ink-shell");
  await shutdownSessionApp();
}

/**
 * Everything the shutdown coordinator needs from the live process, injectable
 * so the phase ordering is testable without booting a real container.
 */
export type MainShutdownDeps = {
  getController(): Pick<SessionController, "beginShutdown" | "releaseExternalResources"> | null;
  getContainer(): Awaited<ReturnType<typeof createContainer>> | null;
  shutdownShell(): Promise<void>;
  awaitLifetimeLock(): Promise<void>;
  releaseVersionLock(): Promise<void>;
  disposeContainer(): Promise<void>;
  exit(code: number): void;
};

function liveMainShutdownDeps(): MainShutdownDeps {
  return {
    getController: () => globalController,
    getContainer: () => globalContainer,
    shutdownShell,
    awaitLifetimeLock: () => lifetimeLockReady,
    releaseVersionLock: async () => {
      const { releaseCurrentVersionLock } =
        await import("./services/update/native-installer/version-lock");
      await releaseCurrentVersionLock();
    },
    disposeContainer: () => disposeContainer(globalContainer),
    exit: (code) => process.exit(code),
  };
}

export function createMainShutdownRuntime(deps: MainShutdownDeps): ShutdownRuntime {
  const shutdownWaitBudgetMs = 500;
  return {
    quiesce: async () => {
      deps.getController()?.beginShutdown();
      const container = deps.getContainer();
      container?.downloadService.beginShutdown("download paused by shutdown");
      container?.backgroundWorkScheduler.beginShutdown("app-exit");
      container?.binaryAutoUpdater.stopBackground();
    },
    restoreTerminal: async () => {
      await deps.shutdownShell();
    },
    preserveCriticalState: async () => {
      const container = deps.getContainer();
      if (!container) return;
      await Promise.allSettled([
        Promise.resolve().then(() => container.activePlaybackCheckpoint.flush()),
        container.config.flushPending(),
        container.downloadService.pauseActiveJobsForShutdown("download paused by shutdown", {
          gracefulWaitMs: shutdownWaitBudgetMs,
          forceWaitMs: shutdownWaitBudgetMs,
          inactiveWaitMs: shutdownWaitBudgetMs,
        }),
        Promise.resolve().then(() => container.queueService.prepareForShutdown()),
        Promise.resolve().then(() => container.diagnosticsService.flush()),
      ]);
    },
    releaseExternalResources: async (_intent, signal) => {
      await Promise.allSettled([
        deps.getController()?.releaseExternalResources(),
        deps.awaitLifetimeLock().then(() => deps.releaseVersionLock()),
      ]);
      signal.throwIfAborted();
    },
    dispose: async () => {
      await deps.disposeContainer();
    },
    recordFailure: (phase, error) => {
      try {
        deps.getContainer()?.diagnosticsService.record({
          category: "session",
          operation: `session.shutdown.phase.${phase}`,
          message: "Shutdown phase failed",
          context: { error: String(error) },
        });
      } catch {
        console.error(`Shutdown phase ${phase} failed:`, error);
      }
    },
    unrefStdin: () => {
      if (process.stdin.isTTY) process.stdin.unref();
    },
    exit: deps.exit,
  };
}

let shutdownCoordinator: ShutdownCoordinator | null = null;

function getShutdownCoordinator(): ShutdownCoordinator {
  shutdownCoordinator ??= createShutdownCoordinator(
    createMainShutdownRuntime(liveMainShutdownDeps()),
  );
  return shutdownCoordinator;
}

async function maybeRunOfflineMode(
  args: { offline: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<boolean> {
  if (!args.offline) {
    return false;
  }

  container.stateManager.dispatch({
    type: "OPEN_OVERLAY",
    overlay: { type: "library", view: "library" },
  });
  return false;
}

type StartupHistoryTarget = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
};

async function maybeOpenStartupHistory(
  args: { history: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<StartupHistoryTarget | null> {
  if (!args.history) return null;

  const { waitForRootHistorySelection } = await import("./app-shell/root-history-bridge");
  const selectionPromise = waitForRootHistorySelection();
  container.stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "history" } });
  const selection = await selectionPromise;
  container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
  if (!selection) return null;
  if (selection.localJobId) {
    const { prepareOfflinePlaybackLaunch } = await import("./app/offline/offline-playback-launch");
    const launch = await prepareOfflinePlaybackLaunch(container, selection.localJobId);
    if (!launch) return null;
    return { title: launch.title, episode: launch.episode };
  }

  applyHistorySelectionProvider(container, selection);
  return {
    title: await prepareReplayTitleForProvider(
      container,
      titleFromHistorySelection(selection),
      selection.entry,
    ),
    episode: episodeFromHistorySelection(selection),
  };
}

async function maybeResolveContinueTitle(
  args: { continuePlayback: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<StartupHistoryTarget | null> {
  if (!args.continuePlayback) return null;
  const recentEntries = container.historyRepository.listRecent(500);
  const titleIds = [...new Set(recentEntries.map((entry) => entry.titleId))];
  const releaseProgress = container.releaseProgressCache.getByTitleIds(titleIds);
  const offlinePolicies = new Map(
    container.offlineTitlePolicies
      .listByTitleIds(titleIds)
      .map((policy) => [policy.titleId, policy]),
  );
  const nextReadyByTitle = readNextReadyOfflineEpisodes(recentEntries, container);
  const decision = container.continueWatchingService.startupCandidate({
    scanLimit: 500,
    signalsByTitle: (titleId) =>
      buildStartupContinuationSignals({
        releaseProgress: releaseProgress.get(titleId),
        offlineEnrolled: offlinePolicies.get(titleId)?.enrolled === true,
        nextReady: nextReadyByTitle.get(titleId),
      }),
  });
  if (!decision?.target || !decision.primaryAction) {
    container.diagnosticsService.record({
      category: "session",
      message: "Continue requested but no playable continuation decision was available",
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No unfinished or ready continuation target yet.",
    });
    return null;
  }
  const selection = historyLaunchSelectionFromContinuation(decision);
  applyHistorySelectionProvider(container, selection);
  const preference = container.config.continueSourcePreference ?? "auto";
  recordContinuationProjectDecision(container, {
    surface: "startup",
    titleId: selection.titleId,
    state: decision.state,
    actionKind: decision.primaryAction.kind,
    season: decision.target.season,
    episode: decision.target.episode,
    freshness: decision.freshness,
  });
  recordContinuationSourceResolution(container, {
    surface: "startup",
    selection,
    preference,
    resolved: decision.primaryAction.kind === "play-local" ? "local" : "stream",
  });
  await recordLocalHistorySourceDecision(container, selection, "continue");
  return {
    title: await prepareReplayTitleForProvider(
      container,
      titleFromHistorySelection(selection),
      selection.entry,
    ),
    episode: episodeFromHistorySelection(selection),
  };
}

function readNextReadyOfflineEpisodes(
  entries: readonly HistoryProgress[],
  container: Awaited<ReturnType<typeof createContainer>>,
): ReadonlyMap<string, { season: number; episode: number; jobId?: string }> {
  const cursors = entries
    .filter((entry) => entry.mediaKind !== "movie")
    .map((entry) => ({
      titleId: entry.titleId,
      season: entry.season ?? 1,
      episode: entry.episode ?? entry.absoluteEpisode ?? 1,
    }));
  const readyAssets = container.offlineAssetService.listNextReadyByTitleCursors(cursors);
  const readyByTitle = new Map<string, { season: number; episode: number; jobId?: string }>();
  for (const asset of readyAssets) {
    if (asset.season === undefined || asset.episode === undefined) continue;
    readyByTitle.set(asset.titleId, {
      season: asset.season,
      episode: asset.episode,
      jobId: asset.originJobId,
    });
  }
  return readyByTitle;
}

function buildStartupContinuationSignals(input: {
  readonly releaseProgress?: ReleaseProgressProjection;
  readonly offlineEnrolled: boolean;
  readonly nextReady?: {
    readonly season: number;
    readonly episode: number;
    readonly jobId?: string;
  };
}) {
  const releaseProgress = input.releaseProgress;
  return {
    nextRelease: releaseProgressToContinuationNextRelease(releaseProgress),
    newSeason: releaseProgress?.newSeason?.season
      ? {
          season: releaseProgress.newSeason.season,
          availableAt: releaseProgress.newSeason.nextAiringAt,
        }
      : null,
    releaseProgress: releaseProgress
      ? {
          newEpisodeCount: releaseProgress.newEpisodeCount,
          stale: Date.parse(releaseProgress.staleAfterAt) <= Date.now(),
        }
      : null,
    offline:
      input.offlineEnrolled || input.nextReady
        ? {
            enrolled: input.offlineEnrolled,
            readyNextEpisodes: input.nextReady ? [input.nextReady] : [],
          }
        : null,
  };
}

function releaseProgressToContinuationNextRelease(
  projection: ReleaseProgressProjection | undefined,
) {
  if (!projection) return null;
  if (projection.status === "new-episodes" && projection.newEpisodeCount > 0) {
    const season = projection.anchorSeason ?? projection.latestAiredSeason;
    if (season === undefined) return null;
    return {
      season,
      episode: projection.anchorEpisode + 1,
      released: true,
      availableAt: projection.latestKnownReleaseAt,
    };
  }
  if (projection.nextAiringSeason === undefined || projection.nextAiringEpisode === undefined) {
    return null;
  }
  return {
    season: projection.nextAiringSeason,
    episode: projection.nextAiringEpisode,
    released: projection.status === "new-episodes",
    availableAt: projection.nextAiringAt,
  };
}

async function maybeRunDownloadMode(
  args: {
    download: boolean;
    search?: string;
    id?: string;
    type?: string;
    anime: boolean;
    quick: boolean;
    jump?: number;
    downloadPath?: string;
  },
  container: Awaited<ReturnType<typeof createContainer>>,
  bootstrapTitle: TitleInfo | null,
): Promise<boolean> {
  if (!args.download) {
    return false;
  }

  const searchResult = bootstrapTitle
    ? ({ status: "success", value: bootstrapTitle } as const)
    : await new (
        await import("@/app/search/SearchPhase")
      ).SearchPhase().execute(
        {
          initialQuery: args.search,
          autoPickSearchResultIndex: args.jump ?? (args.quick && args.search ? 1 : undefined),
          deferAnimeProviderMapping: true,
        },
        { container, signal: new AbortController().signal },
      );

  if (searchResult.status !== "success") {
    console.log("Download cancelled before a title was selected.");
    return true;
  }

  const { DownloadOnlyPhase } = await import("@/app/playback/DownloadOnlyPhase");
  const result = await new DownloadOnlyPhase({
    prepareConfirmedTitle: async (title, context) => {
      const state = context.container.stateManager.getState();
      if (state.mode !== "anime") return title;
      const selected =
        state.searchResults.find((candidate) => candidate.id === title.id) ??
        searchResultFromTitle(title);
      const { mapAnimeDiscoveryResultToProviderNative } =
        await import("@/app/discover/anime-provider-mapping");
      const { chooseSearchResultTitle } = await import("@/app/search/browse-option-mappers");
      const { titleInfoFromSearchResult } = await import("@/app/bootstrap/title-info");
      const mapped = await mapAnimeDiscoveryResultToProviderNative(selected, {
        mode: state.mode,
        providerId: state.provider,
        animeLanguageProfile: context.container.config.animeLanguageProfile,
        providerRegistry: context.container.providerRegistry,
        signal: context.signal,
      });
      return titleInfoFromSearchResult(
        mapped,
        chooseSearchResultTitle(mapped, context.container.config.animeTitlePreference),
      );
    },
  }).execute(
    { title: searchResult.value, outputDirectory: args.downloadPath },
    { container, signal: new AbortController().signal },
  );
  if (result.status === "error") {
    console.log(`Download queue failed: ${result.error.message}`);
  } else if (result.status === "success" && result.value === "queued") {
    await container.downloadService.drainQueue(24 * 60 * 60 * 1000);
  }
  return true;
}

function searchResultFromTitle(title: TitleInfo): SearchResult {
  return {
    id: title.id,
    type: title.type,
    title: title.name,
    titleAliases: title.titleAliases,
    year: title.year ?? "",
    overview: title.overview ?? "",
    posterPath: title.posterUrl ?? null,
    episodeCount: title.episodeCount,
    externalIds: title.externalIds,
    release: title.release,
    artwork: title.artwork,
    languageEvidence: title.languageEvidence,
  };
}

async function maybeRunAutoCleanupDownloads(
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<void> {
  const { config, downloadService, diagnosticsService, historyRepository, logger } = container;
  if (!config.autoCleanupWatched) return;

  const graceDays = Math.max(0, config.autoCleanupGraceDays);
  const nowMs = Date.now();
  const jobs = downloadService.listCompleted(500);
  const titleIds = new Set(jobs.map((job) => job.titleId));
  const historyByTitle = new Map<string, import("@kunai/storage").HistoryProgress[]>();
  const recentHistory = (() => {
    try {
      return historyRepository.listRecent(1_000);
    } catch {
      return [];
    }
  })();
  for (const entry of recentHistory) {
    if (!titleIds.has(entry.titleId)) continue;
    const entries = historyByTitle.get(entry.titleId) ?? [];
    entries.push(entry);
    historyByTitle.set(entry.titleId, entries);
  }
  const titlePolicies = new Map(
    container.offlineTitlePolicies
      .listByTitleIds([...titleIds])
      .map((policy) => [policy.titleId, parseOfflineTitleCleanupPreference(policy.cleanupJson)])
      .filter(
        (
          entry,
        ): entry is [string, NonNullable<ReturnType<typeof parseOfflineTitleCleanupPreference>>] =>
          Boolean(entry[1]),
      ),
  );
  const candidates = selectDownloadCleanupCandidates({
    jobs,
    historyByTitle,
    nowMs,
    graceDays,
    pinnedJobIds: new Set(config.protectedDownloadJobIds),
    titlePolicies,
  });
  for (const candidate of candidates) {
    logger.info("Watched download cleanup candidate", {
      jobId: candidate.job.id,
      titleId: candidate.job.titleId,
      outputPath: candidate.job.outputPath,
      watchedAt: candidate.watchedAt,
      graceDays,
    });
    diagnosticsService.record({
      category: "download",
      operation: "cleanup.candidate",
      message: "Watched download eligible for explicit cleanup",
      titleId: candidate.job.titleId,
      providerId: candidate.job.providerId,
      season: candidate.job.season,
      episode: candidate.job.episode,
      context: {
        jobId: candidate.job.id,
        outputPath: candidate.job.outputPath,
        watchedAt: candidate.watchedAt,
        graceDays,
      },
    });
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  process.title = "kunai";

  // `kunai upgrade` / `kunai uninstall` / `kunai doctor` — channel-aware maintenance.
  // Handled before the shell boots so they can run standalone (binary self-replace).
  if (argv[0] === "doctor") {
    const { runDoctor } = await import("./services/update/run-doctor");
    process.exit(
      await runDoctor({
        json: argv.includes("--json"),
        runningExecutable: { path: process.execPath, version: KUNAI_VERSION },
      }),
    );
  }
  if (argv[0] === "upgrade") {
    const { runUpgrade } = await import("./services/update/run-upgrade");
    const checkOnly = argv.includes("--check");
    process.exit(await runUpgrade({ checkOnly, currentVersion: KUNAI_VERSION }));
  }
  if (argv[0] === "uninstall") {
    const { runUninstall } = await import("./services/update/run-uninstall");
    process.exit(await runUninstall({ purge: argv.includes("--purge") }));
  }
  if (argv[0] === "install") {
    const { runInstall } = await import("./services/update/run-install");
    process.exit(await runInstall(argv.slice(1)));
  }
  if (argv[0] === "diagnostics") {
    const { runDiagnosticsRecentCommand } =
      await import("./services/diagnostics/diagnostics-export");
    process.exit(await runDiagnosticsRecentCommand(argv.slice(1)));
  }

  // Best-effort: clear any stale `*.old` left by a prior Windows self-replace.
  void import("./services/update/self-replace").then(({ cleanupOldBinary }) =>
    cleanupOldBinary(process.execPath).catch(() => {}),
  );

  // Versioned binary: hold lifetime lock and prune old versions (binary channel).
  // The acquisition promise is tracked so coordinated shutdown can await it
  // before releasing — a late lock must never survive the process.
  lifetimeLockReady = (async () => {
    const { lockCurrentVersion, cleanupOldVersions } =
      await import("./services/update/native-installer");
    const { readInstallManifest } = await import("./services/update/install-manifest");
    const manifest = await readInstallManifest();
    if (manifest?.method === "binary" || manifest?.versionedPath) {
      await lockCurrentVersion().catch(() => {});
      void cleanupOldVersions().catch(() => {});
    }
  })().catch(() => {});

  // Parse CLI arguments
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(buildHelpText());
    return;
  }
  if (args.version) {
    const { formatVersionLine } = await import("./services/update/version-display");
    process.stdout.write(`${await formatVersionLine(KUNAI_VERSION)}\n`);
    return;
  }
  if (args.installProtocolHandler) {
    const { buildProtocolHandlerInstallPlan, installKunaiProtocolHandler } =
      await import("./infra/os/protocol-handler");
    const plan = buildProtocolHandlerInstallPlan();
    if (args.dryRun) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    if (!plan.supported) {
      for (const note of plan.notes) {
        console.error(note);
      }
      process.exitCode = 1;
      return;
    }
    const paths = await installKunaiProtocolHandler();
    console.log(`Registered kunai:// protocol handler at ${paths.desktopPath}`);
    return;
  }
  let pendingShareLaunch: PendingShareLaunch | null = null;
  if (args.openUrl) {
    const parsed = parseKunaiShareUrl(args.openUrl);
    if (!parsed) {
      console.error("Invalid kunai:// share URL passed to --open.");
      process.exitCode = 1;
      return;
    }
    pendingShareLaunch = { ...parsed, trusted: true };
  } else if (args.handoffUrl) {
    const handoff = parseKunaiHandoffUrl(args.handoffUrl);
    if (!handoff) {
      console.error("Invalid kunai:// handoff URL. Refusing to run external action.");
      return;
    }
    pendingShareLaunch = { action: handoff.action, ref: handoff.ref, trusted: false };
  }
  const protocolHandoff: KunaiHandoffLaunch | null = pendingShareLaunch
    ? {
        action: pendingShareLaunch.action,
        ref: pendingShareLaunch.ref,
        requiresConfirmation: true,
      }
    : null;

  // Guard: verify required system dependencies before touching the shell.
  // Silence pre-TUI console output when onboarding will run — the system
  // check slide shows the same information visually inside the TUI.
  const { getKunaiPaths } = await import("@kunai/storage");
  const configJson = await (async () => {
    try {
      return (await Bun.file(getKunaiPaths().configPath).json()) as {
        onboardingVersion?: number;
        downloadOnboardingDismissed?: boolean;
        defaultMode?: string;
      };
    } catch {
      return {} as {
        onboardingVersion?: number;
        downloadOnboardingDismissed?: boolean;
        defaultMode?: string;
      };
    }
  })();
  const onboardingWillRun = shouldRunSetupWizard({
    force: args.setup,
    config: {
      onboardingVersion: configJson.onboardingVersion ?? 0,
      downloadOnboardingDismissed: configJson.downloadOnboardingDismissed ?? false,
    },
  });
  const capabilitySnapshot = await checkDeps(KUNAI_VERSION, {
    silent: onboardingWillRun,
    requireYtDlp: args.youtube || configJson.defaultMode === "youtube",
  });

  // Bootstrap the DI container
  const container = await createContainer({
    debug: args.debug,
    debugJson: args.debugJson,
    debugSession: args.debugSession,
    mpv: args.mpv,
    shellChrome: args.shellChrome,
    capabilitySnapshot,
    appVersion: KUNAI_VERSION,
  });
  globalContainer = container;
  const { logger, config, stateManager } = container;
  // `--zen` / `-m,--minimal` are transient session overrides: flip the in-memory
  // config so the minimal/single-column layout renders, without persisting to the
  // user's config file (update() mutates memory only; save() is never called here).
  // `--zen` implies minimal (cli-args sets args.minimal), so a zen launch collapses
  // the companion pane and dims chrome too — matching what each flag's name claims.
  const sessionOverrides = resolveSessionConfigOverrides(args, config);
  if (Object.keys(sessionOverrides).length > 0) {
    await config.update(sessionOverrides);
  }
  await maybeRunAutoCleanupDownloads(container);

  if (args.supportBundle) {
    const { exportLocalSupportBundle } = await import("./app-shell/export-local-support-bundle");
    const written = await exportLocalSupportBundle(container);
    process.stdout.write(`${written.path}\n`);
    await disposeContainer(container);
    if (process.stdin.isTTY) process.stdin.unref();
    return;
  }

  // Initialize session state with CLI overrides
  stateManager.initialize(
    config.provider,
    config.animeProvider,
    {
      anime: config.animeLanguageProfile,
      series: config.seriesLanguageProfile,
      movie: config.movieLanguageProfile,
    },
    config.youtubeProvider,
  );

  const initialMode = args.youtube ? "youtube" : args.anime ? "anime" : config.defaultMode;
  if (initialMode === "anime") {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: "anime",
      provider: config.animeProvider,
    });
  } else if (initialMode === "youtube") {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: "youtube",
      provider: config.youtubeProvider,
    });
  }

  const bootstrapIntent = resolveBootstrapIntent(args);
  let bootstrapQuery: string | undefined = bootstrapIntent.query;
  let bootstrapTitle: TitleInfo | null = bootstrapIntent.directTitle;
  let bootstrapEpisode: EpisodeInfo | null = null;
  let autoPickSearchResultIndex = bootstrapIntent.autoPickSearchResultIndex;

  if (pendingShareLaunch) {
    const shareBootstrap = await applyShareRefLaunch(container, pendingShareLaunch);
    if (shareBootstrap.query) {
      bootstrapQuery = shareBootstrap.query;
      bootstrapTitle = null;
      bootstrapEpisode = null;
      autoPickSearchResultIndex = shareBootstrap.autoPickSearchResultIndex ?? 1;
    } else if (shareBootstrap.title) {
      bootstrapTitle = shareBootstrap.title;
      bootstrapEpisode = shareBootstrap.episode ?? null;
      bootstrapQuery = undefined;
    }
    if (shareBootstrap.download) {
      args.download = true;
    }
  }

  for (const entry of bootstrapIntent.logs) {
    switch (entry.kind) {
      case "search":
        logger.info("Bootstrap search requested", { query: entry.query });
        break;
      case "direct-title":
        logger.info("Bootstrap title requested", { id: entry.id, type: entry.type });
        break;
      case "anime-id-unsupported":
        logger.warn("Direct ID bootstrap is not supported for anime mode yet", { id: entry.id });
        break;
      case "id-without-type":
        logger.warn("Ignoring direct ID without a supported --type", {
          id: entry.id,
          type: entry.type,
        });
        break;
    }
  }

  void container.downloadService.processQueue();
  // Background update: binary channel auto-applies; others notify-only.
  void (async () => {
    try {
      const { readInstallManifest } = await import("./services/update/install-manifest");
      const { detectInstallMethod } = await import("./services/update/install-method");
      const manifest = await readInstallManifest();
      const channel = manifest?.method ?? detectInstallMethod({ fileExists: existsSync }).kind;
      const rawConfig = container.config.getRaw();

      if (channel === "binary" && rawConfig.autoApplyBinaryUpdates) {
        const result = await container.binaryAutoUpdater.runOnce();
        if (
          (result.status === "installed" || result.status === "pending-restart") &&
          "version" in result
        ) {
          container.notificationService.recordSignals([
            {
              type: "app-update",
              currentVersion: KUNAI_VERSION,
              latestVersion: result.version,
            },
          ]);
        }
        container.binaryAutoUpdater.startBackground();
        return;
      }

      const result = await container.updateService.checkForUpdate();
      const signal = updateSignalFromCheck(result);
      if (signal) container.notificationService.recordSignals([signal]);
    } catch {
      // checkForUpdate records its own failures; keep startup fire-and-forget.
    }
  })();
  void (async () => {
    try {
      const raw = container.config.getRaw();
      if (raw.telemetry === "unset") {
        const { resolveTelemetryConsent } = await import("./services/telemetry/consent");
        const decision = resolveTelemetryConsent({
          env: { DO_NOT_TRACK: process.env.DO_NOT_TRACK, CI: process.env.CI },
          isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
          choice: "timeout",
        });
        // Interactive `unset` stays unset (zero network) until setup or `/telemetry`.
        // CI / DO_NOT_TRACK / non-TTY auto-decline to disabled.
        if (decision === "disabled" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
          await container.telemetryService.setStatus("disabled");
        } else if (decision === "disabled") {
          // DNT or CI with a TTY still auto-decline.
          const dntOrCi =
            Boolean(process.env.DO_NOT_TRACK?.trim()) || Boolean(process.env.CI?.trim());
          if (dntOrCi) {
            await container.telemetryService.setStatus("disabled");
          }
        }
      }
      container.telemetryService.pingInBackground();
    } catch {
      // Telemetry must never affect startup.
    }
  })();
  if (capabilitySnapshot.issues.length > 0) {
    container.diagnosticsService.record({
      category: "session",
      message: "Startup capability checks",
      context: {
        issues: capabilitySnapshot.issues,
      },
    });
  }

  runBackgroundTask({
    task: "storage.maintenance.startup",
    category: "cache",
    diagnostics: container.diagnosticsService,
    logger,
    run: () => container.storageMaintenance.runStartupMaintenance(),
  });

  if (args.debug) {
    logger.info("Kunai started", {
      version: KUNAI_VERSION,
      mode: initialMode,
      provider: initialMode === "anime" ? config.animeProvider : config.provider,
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
    });
  }

  if (args.debugSession) {
    container.diagnosticsService.record({
      category: "session",
      operation: "debug-session",
      message: "Developer debug session started",
      context: {
        tracePath: container.debugTracePath,
        shellChrome: args.shellChrome,
        mode: initialMode,
        provider: initialMode === "anime" ? config.animeProvider : config.provider,
        search: Boolean(bootstrapQuery),
        directTitle: Boolean(bootstrapTitle),
      },
    });
    for (const line of container.debugSessionInstructions ?? []) {
      console.error(line);
    }
  }

  // Missing mpv no longer aborts startup — setup and non-playback surfaces stay
  // usable. PlaybackPhase gates dynamically before provider/history work.
  if (!capabilitySnapshot.mpv) {
    container.diagnosticsService.record({
      category: "session",
      operation: "startup.capability.mpv-missing",
      message: "mpv missing at startup — shell will mount; playback remains gated",
      context: {
        issues: capabilitySnapshot.issues
          .filter((issue) => issue.id === "mpv-missing")
          .map((issue) => issue.message),
      },
    });
  }

  const shellLoadStartedAt = args.debug ? performance.now() : 0;
  const { launchSessionApp } = await import("./app-shell/ink-shell");
  recordCliStartupMilestone(container.diagnosticsService, "shell-module-loaded");
  if (args.debug) {
    logger.info("Ink shell loaded", {
      lazyImportMs: Math.round(performance.now() - shellLoadStartedAt),
    });
  }
  launchSessionApp(container);
  recordCliStartupMilestone(container.diagnosticsService, "shell-mounted");
  // Must stay after first paint: the enrich loop and the consolidator it can
  // trigger run synchronous SQLite work that would starve the awaited shell
  // import and delay the first render.
  runBackgroundTask({
    task: "history.identity.enrich-backfill",
    category: "cache",
    diagnostics: container.diagnosticsService,
    logger,
    run: async () => {
      const { runHistoryIdentityEnrichBackfill } =
        await import("./services/history-metadata/HistoryIdentityEnrichBackfill");
      const stats = await runHistoryIdentityEnrichBackfill({
        db: container.dataDb,
        identity: container.catalogIdentityService,
        log: args.debug ? (message) => logger.info(message) : undefined,
      });
      if (stats.enriched > 0) {
        logger.info("History identity backfill", { ...stats });
      }
    },
  });
  for (const adapter of container.syncService.adapters) {
    const ensureConnectedUsername = adapter.ensureConnectedUsername?.bind(adapter);
    if (!ensureConnectedUsername) continue;
    runBackgroundTask({
      task: `sync.${adapter.id}.identity`,
      category: "runtime",
      diagnostics: container.diagnosticsService,
      logger,
      run: ensureConnectedUsername,
    });
  }
  if (protocolHandoff && !pendingShareLaunch?.trusted) {
    const { confirmProtocolHandoff } = await import("./app-shell/workflows");
    const confirmed = await confirmProtocolHandoff(protocolHandoff);
    if (!confirmed) {
      container.diagnosticsService.record({
        category: "session",
        message: "Protocol handoff cancelled by local confirmation",
        context: {
          action: protocolHandoff.action,
          anchor: protocolHandoff.ref.anchor.by,
        },
      });
      await shutdownShell();
      await disposeContainer(container);
      if (process.stdin.isTTY) process.stdin.unref();
      return;
    }
  }
  await maybeRunStartupSetup({
    force: args.setup,
    config: {
      onboardingVersion: config.onboardingVersion,
      downloadOnboardingDismissed: config.downloadOnboardingDismissed,
    },
    container,
    loadSetupWorkflow: () => import("./app-shell/workflows/setup-workflows"),
  });
  if (await maybeRunOfflineMode(args, container)) {
    await shutdownShell();
    await disposeContainer(container);
    if (process.stdin.isTTY) process.stdin.unref();
    return;
  }
  if (await maybeRunDownloadMode(args, container, bootstrapTitle)) {
    await shutdownShell();
    await disposeContainer(container);
    if (process.stdin.isTTY) process.stdin.unref();
    return;
  }

  // Run the main session loop
  try {
    globalController = new SessionController(container);
    if (!bootstrapTitle && args.history) {
      const target = await maybeOpenStartupHistory(args, container);
      bootstrapTitle = target?.title ?? null;
      bootstrapEpisode = target?.episode ?? null;
    }
    if (!bootstrapTitle && args.continuePlayback) {
      const target = await maybeResolveContinueTitle(args, container);
      bootstrapTitle = target?.title ?? null;
      bootstrapEpisode = target?.episode ?? null;
    }
    const autoPick = autoPickSearchResultIndex;

    await globalController.run({
      initialQuery: bootstrapQuery,
      initialTitle: bootstrapTitle,
      initialEpisode: bootstrapEpisode,
      initialRoute: args.initialRoute,
      autoPickSearchResultIndex: autoPick,
    });

    logger.info("Kunai exited normally");
    await getShutdownCoordinator().request({ reason: "normal exit", exitCode: 0 });
  } catch (e) {
    logger.error("Kunai crashed", { error: String(e) });
    console.error("Fatal error:", e);
    await getShutdownCoordinator().request({ reason: "fatal error", exitCode: 1, fatal: true });
  }
}

// Signal handling for clean shutdown
function setupSignalHandlers(): void {
  if (processHandlersInitialized) {
    return;
  }
  processHandlersInitialized = true;

  // Shell surfaces (Ctrl+C, /quit) request shutdown through the bridge; they
  // never call process.exit() themselves.
  bindShutdownRequestHandler((intent) => getShutdownCoordinator().request(intent));

  const requestSignalShutdown = (signal: string, exitCode: number): void => {
    console.log(`\nReceived ${signal}, shutting down cleanly...`);
    void getShutdownCoordinator().request({ reason: signal, exitCode });
  };

  process.on("SIGINT", () => requestSignalShutdown("SIGINT", 130));
  process.on("SIGTERM", () => requestSignalShutdown("SIGTERM", 143));
  process.on("SIGHUP", () => requestSignalShutdown("SIGHUP", 129));

  // Hard backstop: the async shutdown can lose its race with the 4s force-exit,
  // orphaning yt-dlp/ffmpeg children that then keep buffering GBs of RAM after
  // Kunai is gone. `exit` is synchronous and always runs — SIGKILL them here.
  process.on("exit", () => {
    try {
      globalContainer?.downloadService.killActiveProcessesSync();
      globalContainer?.player.killActiveMpvProcessesSync();
    } catch {
      // best effort during teardown
    }
  });

  process.on("uncaughtException", (e) => {
    console.error("Uncaught exception:", e);
    void getShutdownCoordinator().request({
      reason: "uncaught exception",
      exitCode: 1,
      fatal: true,
    });
  });

  process.on("unhandledRejection", (e) => {
    console.error("Unhandled rejection:", e);
    void getShutdownCoordinator().request({
      reason: "unhandled rejection",
      exitCode: 1,
      fatal: true,
    });
  });
}

export async function startCli(argv = process.argv.slice(2)): Promise<void> {
  setupSignalHandlers();
  // Always-on memory safety net: a separate-thread watchdog that SIGKILLs a
  // runaway even when the main event loop is jammed (the closed-terminal case).
  const { installMemoryWatchdog } = await import("./infra/diagnostics/memory-watchdog");
  installMemoryWatchdog();
  // Opt-in event-loop lag monitor for the input-stall hunt (inert unless
  // KUNAI_LOOP_MONITOR=1). Logs main-thread jams to ./loop-monitor.log.
  const { installEventLoopMonitor } = await import("./infra/diagnostics/event-loop-monitor");
  installEventLoopMonitor();
  // Opt-in heap profiler for the anime-mode memory-runaway hunt (inert otherwise).
  if (process.env.KUNAI_HEAP_PROFILE === "1") {
    const { installHeapProfiler } = await import("./infra/diagnostics/heap-profiler");
    installHeapProfiler();
  }
  await runCli(argv);
}

if (import.meta.main) {
  void startCli();
}
