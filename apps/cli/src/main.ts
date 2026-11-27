#!/usr/bin/env bun
import { existsSync } from "node:fs";
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
// This file owns the current fullscreen session runtime, and is the only
// entrypoint. Keep new architecture work here.
// =============================================================================

import type { KunaiHandoffLaunch } from "@/app/bootstrap/handoff-url";
import { launchNeedsYtDlp } from "@/app/bootstrap/launch-dependencies";
import type { SessionController } from "@/app/session/SessionController";
import {
  createShutdownCoordinator,
  type ShutdownCoordinator,
  type ShutdownRuntime,
} from "@/app/session/shutdown-coordinator";
import { bindShutdownRequestHandler } from "@/app/session/shutdown-request";
import {
  buildCliHelpText,
  CLI_SUBCOMMANDS,
  CliUsageError,
  parseCliArgs,
  type CliArgs,
} from "@/cli-args";
import type { createContainer } from "@/container";
import type { KunaiShareAction, PlaybackTargetRef } from "@/domain/share/playback-target-ref";
import type { EpisodeInfo, SearchResult, TitleInfo } from "@/domain/types";
import { isProcessEntrypoint } from "@/infra/build/entrypoint";
import { prepareCliProfile } from "@/infra/storage/desktop-profile-startup";
import type { HistoryProgress } from "@kunai/storage";

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
let fatalExitError: Error | string | null = null;

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
    disposeContainer: async () => {
      if (!globalContainer) return;
      const { disposeContainer } = await import("@/container");
      await disposeContainer(globalContainer);
    },
    exit: (code) => {
      if (fatalExitError) {
        console.error("Fatal error:", fatalExitError);
      }
      process.exit(code);
    },
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
        import("@/services/persistence/search-history").then(({ flushSearchHistory }) =>
          flushSearchHistory(),
        ),
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

/**
 * `--offline` opens the library and then plays on: offline is a starting
 * surface, not a mode that owns the process. This deliberately does not end the
 * run, which is why it reports nothing — it used to return `false`
 * unconditionally while its caller branched on the result, so the exit path
 * behind that branch had never run.
 */
function openOfflineLibrary(
  args: { offline: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): void {
  if (!args.offline) return;

  container.stateManager.dispatch({
    type: "OPEN_OVERLAY",
    overlay: { type: "library", view: "library" },
  });
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

  const [{ resolveHistorySelectionLaunch }, { prepareReplayTitleForProvider }] = await Promise.all([
    import("@/app-shell/history-selection-launch"),
    import("@/app/bootstrap/launch-entry"),
  ]);
  const launch = await resolveHistorySelectionLaunch(container, selection, "history");
  if (!launch) return null;
  return {
    title: await prepareReplayTitleForProvider(container, launch.title, selection.entry),
    ...(launch.episode ? { episode: launch.episode } : null),
  };
}

async function maybeResolveContinueTitle(
  args: { continuePlayback: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<StartupHistoryTarget | null> {
  if (!args.continuePlayback) return null;
  const { cachedContinuationSignals, offlineContinuationSignal } =
    await import("@/services/continuation/history-continuation-signals");
  // Only the head of the recency scan feeds startup: the batch reads below are
  // keyed by its titles, and the candidate is the newest of them with
  // something to play.
  const recentEntries = container.historyRepository.listRecent(100);
  const titleIds = [...new Set(recentEntries.map((entry) => entry.titleId))];
  const releaseProgress = container.releaseProgressCache.getByTitleIds(titleIds);
  const offlinePolicies = new Map(
    container.offlineTitlePolicies
      .listByTitleIds(titleIds)
      .map((policy) => [policy.titleId, policy]),
  );
  const nextReadyByTitle = readNextReadyOfflineEpisodes(recentEntries, container);
  const decision = container.continueWatchingService.startupCandidate({
    // The same 100 rows the signals above were read for: the newest title with
    // something to play, which is not always the newest title.
    scanLimit: 100,
    signalsByTitle: (titleId, anchor) =>
      cachedContinuationSignals({
        entry: anchor,
        releaseProgress: releaseProgress.get(titleId),
        offline: offlineContinuationSignal(
          offlinePolicies.get(titleId)?.enrolled === true,
          nextReadyByTitle.get(titleId),
        ),
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
  const [
    {
      applyHistorySelectionProvider,
      episodeFromHistorySelection,
      prepareReplayTitleForProvider,
      recordLocalHistorySourceDecision,
      continueTitleFromHistorySelection,
    },
    { recordContinuationProjectDecision, recordContinuationSourceResolution },
    { historyLaunchSelectionFromContinuation },
  ] = await Promise.all([
    import("@/app/bootstrap/launch-entry"),
    import("@/services/continuation/continuation-diagnostics"),
    import("@/services/continuation/continuation-launch-selection"),
  ]);
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
      continueTitleFromHistorySelection(selection),
      selection.entry,
    ),
    episode: episodeFromHistorySelection(selection),
  };
}

function readNextReadyOfflineEpisodes(
  entries: readonly HistoryProgress[],
  container: Awaited<ReturnType<typeof createContainer>>,
): ReadonlyMap<string, { season: number; episode: number; jobId?: string }> {
  // Entries arrive newest-first, so the first cursor per title is the latest
  // position — later duplicates only repeat the same asset lookup.
  const seenTitles = new Set<string>();
  const cursors = entries
    .filter((entry) => entry.mediaKind !== "movie")
    .filter((entry) => {
      if (seenTitles.has(entry.titleId)) return false;
      seenTitles.add(entry.titleId);
      return true;
    })
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

async function maybeRunDownloadMode(
  args: {
    download: boolean;
    search?: string;
    id?: string;
    type?: string;
    anime: boolean;
    quick: boolean;
    jump?: number;
    episode?: number;
    season?: number;
    downloadPath?: string;
  },
  container: Awaited<ReturnType<typeof createContainer>>,
  bootstrapTitle: TitleInfo | null,
): Promise<boolean> {
  if (!args.download) return false;

  const { resolveAutoPickIndex } = await import("@/app/bootstrap/bootstrap-intent");
  const searchResult = bootstrapTitle
    ? ({ status: "success", value: bootstrapTitle } as const)
    : await new (await import("@/app/search/SearchPhase")).SearchPhase().execute(
        {
          initialQuery: args.search,
          autoPickSearchResultIndex: resolveAutoPickIndex(args),
          deferAnimeProviderMapping: true,
        },
        { container, signal: new AbortController().signal },
      );

  if (searchResult.status !== "success") {
    console.log("Download cancelled before a title was selected.");
    return true;
  }

  // `-e/--episode` means "download this episode" — arm the same one-shot
  // request the playback path reads so DownloadOnlyPhase skips the checklist.
  if (args.episode !== undefined) {
    container.stateManager.dispatch({
      type: "SET_EPISODE_REQUEST",
      episode: { season: args.season ?? 1, episode: args.episode },
    });
  }

  // Download mode never reaches PlaybackPhase, so nothing here would otherwise
  // resolve the catalog: a `-i/--id` launch wrote its placeholder into the job,
  // the offline library, and the file name on disk. Only a placeholder pays for
  // the lookup, and a failure leaves the title as it was.
  const { fetchTitleDetail } = await import("@/services/catalog/TitleDetailService");
  const { resolvePlaceholderTitle } = await import("@/app/bootstrap/resolve-placeholder-title");
  const downloadTitle = await resolvePlaceholderTitle(searchResult.value, {
    fetchDetail: fetchTitleDetail,
  });

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
    { title: downloadTitle, outputDirectory: args.downloadPath },
    { container, signal: new AbortController().signal },
  );
  if (result.status === "error") {
    console.error(`Download queue failed: ${result.error.message}`);
    process.exitCode = 1;
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
  const { config, downloadService, diagnosticsService, logger } = container;
  if (!config.autoCleanupWatched) return;

  const graceDays = Math.max(0, config.autoCleanupGraceDays);
  const nowMs = Date.now();
  const jobs = downloadService.listCompleted(500);
  const titleIds = new Set(jobs.map((job) => job.titleId));
  const historyByTitle = new Map<string, import("@kunai/storage").HistoryProgress[]>();
  // Targeted read: only completed-download titles need history, so push the
  // predicate into SQLite instead of scanning 1000 recency rows in memory.
  const recentHistory = (() => {
    try {
      return container.historyRepository.listByTitleIds([...titleIds]);
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
  const { parseOfflineTitleCleanupPreference, selectDownloadCleanupCandidates } =
    await import("@/services/download/download-cleanup-policy");
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

  // `kunai upgrade` / `kunai uninstall` / `kunai doctor` / `kunai rollback` —
  // channel-aware maintenance. Handled before the shell boots so they can run
  // standalone (binary self-replace).
  if (argv[0] === "doctor") {
    const { runDoctor } = await import("./services/update/run-doctor");
    process.exit(
      await runDoctor({
        argv,
        json: argv.includes("--json"),
        strict: argv.includes("--strict"),
        runningExecutable: { path: process.execPath, version: KUNAI_VERSION },
      }),
    );
  }
  if (argv[0] === "capabilities") {
    const { runCapabilities } = await import("./services/agent/run-capabilities");
    process.exit(
      await runCapabilities({
        version: KUNAI_VERSION,
        json: argv.includes("--json"),
      }),
    );
  }
  if (argv[0] === "providers") {
    const { runProvidersCommand } = await import("./services/providers/run-providers-command");
    const sub = argv[1] && !argv[1].startsWith("-") ? argv[1] : "status";
    const urlIdx = argv.indexOf("--url");
    const urlArg = urlIdx >= 0 ? argv[urlIdx + 1] : undefined;
    process.exit(
      await runProvidersCommand({
        subcommand: sub,
        json: argv.includes("--json"),
        dryRun: argv.includes("--dry-run"),
        force: argv.includes("--force"),
        ...(urlArg ? { url: urlArg } : {}),
      }),
    );
  }
  if (argv[0] === "addons") {
    const json = argv.includes("--json");
    if (
      argv
        .slice(1)
        .some(
          (arg) =>
            arg.startsWith("-") && arg !== "--json" && arg !== "--stdin" && arg !== "--accept-risk",
        )
    ) {
      const error =
        "unsupported flag. Use --json, --stdin (add only), or --accept-risk (enable only).";
      process.stdout.write(
        json
          ? `${JSON.stringify({ schemaVersion: 1, ok: false, error }, null, 2)}\n`
          : `kunai addons: ${error}\n`,
      );
      process.exit(2);
    }
    // An unresolved operation must not exit successfully before reporting an outcome.
    process.exitCode = 1;
    const { runAddonsCommand } = await import("./services/providers/run-addons-command");
    // Positionals only: `kunai addons add <url> --json` and `--json add <url>` both work.
    const words = argv.slice(1).filter((word) => !word.startsWith("-"));
    process.exit(
      await runAddonsCommand({
        subcommand: words[0],
        target: words[1],
        stdin: argv.includes("--stdin"),
        acceptRisk: argv.includes("--accept-risk"),
        json,
      }),
    );
  }
  if (argv[0] === "rollback") {
    const { runRollback } = await import("./services/update/run-rollback");
    const toIdx = argv.indexOf("--to");
    const toArg = toIdx >= 0 ? argv[toIdx + 1] : undefined;
    process.exit(
      await runRollback({
        list: argv.includes("--list"),
        dryRun: argv.includes("--dry-run"),
        ...(toArg !== undefined ? { to: toArg } : {}),
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
  if (argv[0] === "completion") {
    const { isCompletionShell, renderCompletionScript, COMPLETION_SHELLS } =
      await import("./services/completion/completion-script");
    const requested = argv[1];
    if (requested === undefined || !isCompletionShell(requested)) {
      process.stderr.write(
        `kunai completion <${COMPLETION_SHELLS.join("|")}>\n` +
          (requested === undefined ? "Missing shell name.\n" : `Unsupported shell: ${requested}\n`),
      );
      process.exit(2);
    }
    process.stdout.write(renderCompletionScript(requested));
    process.exit(0);
  }
  if (argv[0] === "analytics") {
    const { runAnalyticsCommand } = await import("./services/analytics/run-analytics-command");
    process.exit(await runAnalyticsCommand(argv.slice(1), { version: KUNAI_VERSION }));
  }
  if (argv[0] === "diagnostics") {
    const { runDiagnosticsRecentCommand } =
      await import("./services/diagnostics/diagnostics-export");
    process.exit(
      await runDiagnosticsRecentCommand(argv.slice(1), {
        isTty: Boolean(process.stdout.isTTY),
        noColor: Boolean(process.env.NO_COLOR),
      }),
    );
  }

  // Best-effort: clear the running Kunai binary's own Windows self-replace backup.
  void import("./services/update/self-replace").then(({ cleanupOldBinary }) =>
    cleanupOldBinary(process.execPath, import.meta.path).catch(() => {}),
  );

  // Parse CLI arguments before acquiring the versioned lifetime lock so short
  // paths (--help / --version / protocol install) never leave lock residue.
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    // Usage errors exit 2 — the code `kunai completion` already uses — so a
    // wrapper script can tell "I typo'd a flag" apart from a real failure.
    if (error instanceof CliUsageError) {
      process.stderr.write(`kunai: ${error.message}\nRun "kunai --help" for usage.\n`);
      process.exit(2);
    }
    throw error;
  }
  if (args.help) {
    process.stdout.write(buildHelpText());
    return;
  }
  if (args.version) {
    const { formatVersionLine } = await import("./services/update/version-display");
    process.stdout.write(`${await formatVersionLine(KUNAI_VERSION)}\n`);
    return;
  }
  // Asking for the wizard where nothing can drive it is a mistake worth naming.
  // Silently continuing would leave the user believing setup ran; mounting it
  // anyway would block on a keystroke that can never arrive.
  if (args.setup && !(process.stdin.isTTY && process.stdout.isTTY)) {
    console.error(
      "kunai --onboarding (or --setup) needs an interactive terminal. Run it directly rather than through a pipe, and unset CI if it is set.",
    );
    process.exitCode = 1;
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

  // Share/handoff URLs are parsed before the version lock below. Parsing is
  // pure and rejects invalid input, so doing it first means a bad URL exits
  // without having taken a lock or pruned anything — and it lets `--dry-run`
  // report the share action while still returning before any state changes.
  let pendingShareLaunch: PendingShareLaunch | null = null;
  if (args.openUrl) {
    const { parseKunaiShareUrl } = await import("@/domain/share/playback-target-ref");
    const parsed = parseKunaiShareUrl(args.openUrl);
    if (!parsed) {
      console.error("Invalid kunai:// share URL passed to --open.");
      process.exitCode = 1;
      return;
    }
    pendingShareLaunch = { ...parsed, trusted: true };
  } else if (args.handoffUrl) {
    const { parseKunaiHandoffUrl } = await import("@/app/bootstrap/handoff-url");
    const handoff = parseKunaiHandoffUrl(args.handoffUrl);
    if (!handoff) {
      console.error("Invalid kunai:// handoff URL. Refusing to run external action.");
      process.exitCode = 1;
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

  // `--dry-run` on the launch path. Placed here deliberately: the share URL is
  // parsed and validated above, so the plan is accurate, but nothing has been
  // created or mutated yet — no version lock, no version pruning, no container,
  // no database, no terminal probe, no dependency check. That is what
  // "without changing state" has to mean.
  if (args.dryRun) {
    const { formatLaunchDryRunPlan } = await import("@/app/bootstrap/dry-run-plan");
    const plan = await formatLaunchDryRunPlan(args, pendingShareLaunch);
    process.stdout.write(`${plan.join("\n")}\n`);
    return;
  }

  // A piped launch can never mount the shell, so reject before the lifetime
  // lock, terminal probe, dependency check, container, and every queued or
  // background task that only exists for an interactive session. Two routes do
  // real work headless past this point and are exempt: `--support-bundle` and
  // the env-gated compiled-smoke harness — both need the container, which is
  // why the guard lives here rather than at arg parse. A new headless route
  // that mounts nothing must add its own exemption.
  const setupIsInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const compiledSmokeRequested =
    process.env.KUNAI_COMPILED_SMOKE === "1" && Boolean(process.env.KUNAI_COMPILED_SMOKE_SCENARIO);
  const headlessSearchRequested = Boolean(args.json && args.search);
  if (args.json && !args.search) {
    process.stderr.write(
      "kunai: --json requires a headless search query or JSON subcommand.\n" +
        "Supported JSON routes:\n" +
        "  kunai capabilities --json\n" +
        "  kunai providers status --json\n" +
        "  kunai providers verify --json\n" +
        "  kunai addons list --json\n" +
        "  kunai doctor --json\n" +
        "  kunai -S <query> --json\n" +
        "  kunai -a -S <query> --json\n" +
        "  kunai -y -S <query> --json\n",
    );
    process.exitCode = 2;
    return;
  }
  if (
    !setupIsInteractive &&
    !args.supportBundle &&
    !compiledSmokeRequested &&
    !headlessSearchRequested
  ) {
    process.stderr.write(
      "kunai: this command needs an interactive terminal.\n" +
        "Nothing was started. Pipe-aware routes that do work without a TTY:\n" +
        "  kunai --help | --version | --dry-run\n" +
        "  kunai capabilities --json | kunai -S <query> --json\n" +
        "  kunai doctor | kunai diagnostics | kunai completion | kunai upgrade --check\n" +
        "  kunai --support-bundle\n",
    );
    process.exitCode = 1;
    return;
  }

  if (headlessSearchRequested && args.search) {
    if (args.offline) {
      const payload = {
        ok: false,
        schemaVersion: 1 as const,
        error: "--offline cannot be combined with headless search (-S --json)",
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const [
      { runHeadlessSearchJson },
      { createContainer, disposeContainer },
      { activateCachedProviderHotfixManifest },
    ] = await Promise.all([
      import("./services/agent/run-headless-search"),
      import("@/container"),
      import("@/app/providers/provider-definitions-actions"),
    ]);
    const container = await createContainer();
    try {
      // Same provider state as the interactive shell: a cached mirror fix must
      // reach headless search too, or it queries the broken bundled host.
      activateCachedProviderHotfixManifest(container);
      const mode = args.youtube ? "youtube" : args.anime ? "anime" : "series";
      process.exitCode = await runHeadlessSearchJson({
        container,
        query: args.search,
        mode,
      });
    } finally {
      await disposeContainer(container);
    }
    return;
  }

  // Versioned binary: hold lifetime lock and prune old versions (binary channel).
  // The acquisition promise is tracked so coordinated shutdown can await it
  // before releasing — a late lock must never survive the process.
  lifetimeLockReady = (async () => {
    const { lockCurrentVersion, cleanupOldVersions } =
      await import("./services/update/native-installer");
    const { migrateInstallManifestAtStartup, readInstallManifest } =
      await import("./services/update/install-manifest");
    await migrateInstallManifestAtStartup();
    const manifest = await readInstallManifest();
    if (manifest?.method === "binary" || manifest?.versionedPath) {
      await lockCurrentVersion().catch(() => {});
      void cleanupOldVersions().catch(() => {});
    }
  })().catch(() => {});

  // The terminal graphics probe round-trips a query through the TTY (100 ms,
  // 400 ms on Windows conhost) — start it now so it overlaps the version-lock,
  // manifest, and config work instead of serializing in front of checkDeps.
  // It is still awaited below before anything writes to stdout, so the escape
  // query can never interleave into the dependency report.
  const graphicsProbeReady = (async () => {
    const { initTerminalGraphicsProbe } = await import("./image/probe");
    await initTerminalGraphicsProbe();
  })().catch(() => {});

  // Guard: verify required system dependencies before touching the shell.
  // Silence pre-TUI console output when onboarding will run — the system
  // check slide shows the same information visually inside the TUI.
  const [
    { getKunaiPaths },
    { isBelowOnboardedFloor, launchHasDestination, maybeRunStartupSetup, shouldRunSetupWizard },
    { effectivePlayerChoice },
    { resolveMachinePlayerMode },
    { checkDeps },
    { createContainer, disposeContainer },
    { resolveSessionConfigOverrides },
    {
      hasExplicitStartupTarget,
      resolveBootstrapIntent,
      resolveLaunchMode,
      resolveStartupInitialRoute,
    },
    { recordStartupPlayerDiagnostic },
  ] = await Promise.all([
    import("@kunai/storage"),
    import("@/app/bootstrap/startup-setup"),
    import("@/domain/playback/player-choice"),
    import("@/infra/player/installed-players"),
    import("@/ui"),
    import("@/container"),
    import("@/app/session/session-overrides"),
    import("@/app/bootstrap/bootstrap-intent"),
    import("@/app/bootstrap/startup-player-diagnostic"),
  ]);
  type ConfigPeek = {
    onboardingVersion?: number;
    downloadOnboardingDismissed?: boolean;
    defaultMode?: string;
    player?: string;
  };
  const configJson = await (async (): Promise<ConfigPeek> => {
    try {
      return (await Bun.file(getKunaiPaths().configPath).json()) as ConfigPeek;
    } catch {
      return {};
    }
  })();
  // Interactivity is part of the question: this decides whether `checkDeps`
  // stays silent because the wizard will show the same information visually.
  const hasDestination = launchHasDestination(args);
  const onboardingWillRun = shouldRunSetupWizard({
    force: args.setup,
    interactive: setupIsInteractive,
    hasDestination,
    config: {
      onboardingVersion: configJson.onboardingVersion ?? 0,
      downloadOnboardingDismissed: configJson.downloadOnboardingDismissed ?? false,
    },
  });
  // A never-onboarded install lands on the discover tray, not an empty search
  // box. Captured before the wizard runs so a completed setup still gets that
  // landing on its first launch. Explicit routes (-S, -i, --history) win.
  const freshInstall = isBelowOnboardedFloor(configJson.onboardingVersion ?? 0);
  // Must precede checkDeps: that snapshot records the chosen image protocol, and
  // it is what diagnostics and `/report-issue` carry into a bug report. Probing
  // afterwards would have every report claim the pre-probe fallback.
  await graphicsProbeReady;

  args.player = effectivePlayerChoice(args.player, configJson.player);
  const startupPlayerMode = resolveMachinePlayerMode(args.player);
  const capabilitySnapshot = await checkDeps(KUNAI_VERSION, {
    silent: onboardingWillRun,
    playerMode: startupPlayerMode,
    requireYtDlp: launchNeedsYtDlp(args, configJson.defaultMode, pendingShareLaunch?.ref.kind),
  });

  const { loadCompiledSmokeProviderOverride, loadCompiledSmokeSearchDefinitions } =
    await import("./container/compiled-smoke-provider-override");
  const [providerModulesOverride, searchServiceDefinitions] = await Promise.all([
    loadCompiledSmokeProviderOverride(),
    loadCompiledSmokeSearchDefinitions(),
  ]);

  // Bootstrap the DI container
  const container = await createContainer({
    debug: args.debug,
    debugJson: args.debugJson,
    debugSession: args.debugSession,
    mpv: args.mpv,
    playerChoice: args.player,
    playerMode: startupPlayerMode,
    shellChrome: args.shellChrome,
    capabilitySnapshot,
    appVersion: KUNAI_VERSION,
    providerModulesOverride,
    searchServiceDefinitions,
  });
  globalContainer = container;
  const { logger, config, stateManager } = container;

  // Compiled-binary smoke runner: deterministic fake-provider / fake-mpv scenarios.
  // Opt-in only — requires KUNAI_COMPILED_SMOKE=1 + absolute fixture path (above) and a scenario id.
  if (process.env.KUNAI_COMPILED_SMOKE === "1" && process.env.KUNAI_COMPILED_SMOKE_SCENARIO) {
    const { runCompiledSmoke } = await import("./app/compiled-smoke/run-compiled-smoke");
    const code = await runCompiledSmoke(container);
    await disposeContainer(container);
    globalContainer = null;
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(code);
  }
  // `--zen` / `-m,--minimal` are transient session overrides: the minimal/single-
  // column layout renders for this run without touching the user's config file.
  // They go through applySessionOverrides, NOT update() — update() writes into the
  // persisted object, and save() persists that whole object, so the unconditional
  // background saves from UpdateService/UsageAnalyticsService below would otherwise
  // make a one-run flag permanent.
  // `--zen` implies minimal (cli-args sets args.minimal), so a zen launch collapses
  // the companion pane and dims chrome too — matching what each flag's name claims.
  const sessionOverrides = resolveSessionConfigOverrides(args, config);
  if (Object.keys(sessionOverrides).length > 0) {
    config.applySessionOverrides(sessionOverrides);
  }
  // A verified, unexpired hotfix manifest cached by an earlier `providers update`
  // must be live from the first resolve — not only in the process that fetched it.
  {
    const { activateCachedProviderHotfixManifest } =
      await import("@/app/providers/provider-definitions-actions");
    activateCachedProviderHotfixManifest(container);
  }
  if (args.supportBundle) {
    await maybeRunAutoCleanupDownloads(container);
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

  const initialMode = resolveLaunchMode(args) ?? config.defaultMode;
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
  if (bootstrapTitle?.isAnime) {
    // `-i anilist:`/`mal:` ids are catalog-keyed, but the anime provider still
    // needs the provider-native id — the same mapping a share link runs.
    const { mapAnimeTitleToProviderNative } = await import("@/app/bootstrap/resolve-share-target");
    const mapped = await mapAnimeTitleToProviderNative(bootstrapTitle, container, "anime");
    bootstrapTitle = mapped.title;
  }
  let bootstrapEpisode: EpisodeInfo | null = null;
  let shareRequestedEpisode: { season: number; episode: number } | undefined;
  let autoPickSearchResultIndex = bootstrapIntent.autoPickSearchResultIndex;

  // Untrusted handoffs confirm before any share resolution: mapping an anime
  // catalog anchor makes provider network calls, and applying the resolved
  // target dispatches session state — neither may run on external input alone.
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
      await disposeContainer(container);
      if (process.stdin.isTTY) process.stdin.unref();
      return;
    }
  }

  if (pendingShareLaunch) {
    const { applyShareRefLaunch } = await import("@/app/bootstrap/apply-resolved-share-target");
    const shareBootstrap = await applyShareRefLaunch(container, pendingShareLaunch);
    if (shareBootstrap.query) {
      bootstrapQuery = shareBootstrap.query;
      bootstrapTitle = null;
      bootstrapEpisode = null;
      shareRequestedEpisode = shareBootstrap.requestedEpisode;
      autoPickSearchResultIndex = shareBootstrap.autoPickSearchResultIndex ?? 1;
    } else if (shareBootstrap.title) {
      bootstrapTitle = shareBootstrap.title;
      bootstrapEpisode = shareBootstrap.episode ?? null;
      bootstrapQuery = undefined;
    }
    if (shareBootstrap.download) args.download = true;
  }

  for (const entry of bootstrapIntent.logs) {
    switch (entry.kind) {
      case "search":
        logger.info("Bootstrap search requested", { query: entry.query });
        break;
      case "direct-title":
        logger.info("Bootstrap title requested", { id: entry.id, type: entry.type });
        break;
      // These two drop the flag entirely. `logger.warn` writes nowhere without
      // `--debug`, so the run looked like a normal launch and the id vanished --
      // the "flag parsed and dropped" failure this codebase treats as a bug.
      // Say so on stderr, then continue into the shell rather than exiting: the
      // session is still usable, only the shortcut is not.
      case "anime-id-unsupported":
        logger.warn("Direct ID bootstrap is not supported for anime mode yet", { id: entry.id });
        process.stderr.write(
          `kunai: -i/--id is not supported in anime mode yet, so ${entry.id} was ignored.\n` +
            `Search by name instead, or drop -a to open the id as a TMDB title.\n`,
        );
        break;
      case "id-without-type":
        logger.warn("Ignoring direct ID without a supported --type", {
          id: entry.id,
          type: entry.type,
        });
        process.stderr.write(
          `kunai: -i/--id ${entry.id} needs -t movie or -t series` +
            `${entry.type ? ` (got: ${entry.type})` : ""}, so it was ignored.\n` +
            `Try: kunai -i ${entry.id} -t movie\n`,
        );
        break;
      case "id-unknown-namespace":
        logger.warn("Ignoring direct ID with an unknown namespace", { id: entry.id });
        process.stderr.write(
          `kunai: -i/--id ${entry.id} uses an unknown namespace, so it was ignored.\n` +
            `Supported: anilist:<id>, mal:<id>, tmdb:<id>, youtube:<id> — or a bare TMDB id.\n`,
        );
        break;
      case "id-lane-conflict":
        logger.warn("Direct ID namespace conflicts with the requested lane", {
          id: entry.id,
          namespace: entry.namespace,
          lane: entry.lane,
        });
        process.stderr.write(
          `kunai: -i/--id ${entry.id} is a ${entry.namespace}: id but ` +
            `${entry.lane === "youtube" ? "-y/--youtube" : "-a/--anime"} selected the ${entry.lane} lane, so it was ignored.\n`,
        );
        break;
    }
  }

  if (!config.offlineMode) {
    container.downloadService.kickQueue("startup");
  }
  // Background update: binary channel auto-applies; others notify-only.
  if (!config.offlineMode)
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
                pendingRestart: result.status === "pending-restart",
              },
            ]);
          }
          // The startup check above already ran and produced the user-facing
          // notification. Arm only the interval here so startup never performs
          // the same ownership/network checks twice.
          container.binaryAutoUpdater.startBackground({ runImmediately: false });
          return;
        }

        const { updateSignalFromCheck } =
          await import("@/services/notifications/notification-update-signal");
        const result = await container.updateService.checkForUpdate();
        const signal = updateSignalFromCheck(result);
        if (signal) container.notificationService.recordSignals([signal]);
      } catch {
        // checkForUpdate records its own failures; keep startup fire-and-forget.
      }
    })();

  // Provider-health notice: if a lane's configured default provider is
  // measured `down`, surface a one-row suggestion for a healthier alternative.
  // Runs even in offline mode — the health rows are local SQLite, not a
  // network probe — and deletes the stale row when the provider heals.
  try {
    const { providerHealthNotice } = await import("./services/playback/provider-health-notice");
    const { providerPriorityForLane } = await import("./domain/provider-lane");
    const { resolveProviderLaneFromModule } = await import("@kunai/core");
    const laneDefaults: ReadonlyArray<{ id: string; lane: "series" | "anime" | "youtube" }> = [
      { id: config.provider, lane: "series" },
      { id: config.animeProvider, lane: "anime" },
      { id: config.youtubeProvider, lane: "youtube" },
    ];
    const healthRows = container.providerHealth.list();
    // Suggestions must stay inside the lane — a movie provider can't resolve
    // anime, so recommending rivestream when the anime default is down would
    // be a notice that points at a provider the lane will reject.
    const loadedByLane = new Map<string, string[]>();
    for (const module of container.engine.modules) {
      const lane = resolveProviderLaneFromModule(module);
      const list = loadedByLane.get(lane) ?? [];
      list.push(module.providerId);
      loadedByLane.set(lane, list);
    }
    const seen = new Set<string>();
    for (const { id: laneDefault, lane } of laneDefaults) {
      if (seen.has(laneDefault)) continue;
      seen.add(laneDefault);
      const notice = providerHealthNotice({
        configuredProvider: laneDefault,
        providerPriority: providerPriorityForLane(config, lane),
        loadedProviders: loadedByLane.get(lane) ?? [],
        healthRows,
      });
      if (notice) {
        container.notificationService.recordSignals([
          {
            type: "provider-health",
            providerId: notice.downProviderId,
            suggestedProviderId: notice.suggestedProviderId ?? undefined,
          },
        ]);
      } else {
        // Not delete() — that tombstones the key and a later relapse would
        // never surface again. remove() clears the healed row only.
        container.notificationService.remove(`provider-health:${laneDefault}`);
      }
    }
  } catch {
    // The notice is advisory; a broken health row must never block startup.
  }
  if (!config.offlineMode) {
    try {
      // Awaited, not fire-and-forget: the shell reads
      // `analyticsDisclosurePending` during render with no subscription, so the
      // decision has to be settled before the first paint rather than racing
      // it. `onSessionStart` awaits no network — the ping is backgrounded.
      const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      const outcome = await container.usageAnalytics.onSessionStart({ isInteractive });
      // The setup wizard carries its own consent slide, so raising the banner
      // too would disclose twice — also true of a fresh launch that deferred
      // setup. The banner only records that it was shown; it never answers.
      if (outcome.kind === "needs-disclosure" && !onboardingWillRun && !freshInstall) {
        container.analyticsDisclosurePending = true;
      }
    } catch {
      // Analytics must never affect startup.
    }
  }
  if (capabilitySnapshot.issues.length > 0) {
    container.diagnosticsService.record({
      category: "session",
      message: "Startup capability checks",
      context: {
        issues: capabilitySnapshot.issues,
      },
    });
  }

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

  recordStartupPlayerDiagnostic({
    diagnostics: container.diagnosticsService,
    playerMode: startupPlayerMode,
    capabilitySnapshot,
  });

  const shellLoadStartedAt = args.debug ? performance.now() : 0;
  const [
    { launchSessionApp },
    { recordCliStartupMilestone },
    { runBackgroundTask },
    { launchShellWithPostPaintStartupWork },
    { SessionController },
  ] = await Promise.all([
    import("./app-shell/ink-shell"),
    import("@/services/diagnostics/cli-startup-milestone"),
    import("@/services/diagnostics/background-task"),
    import("@/app/bootstrap/post-paint-startup-work"),
    import("@/app/session/SessionController"),
  ]);
  recordCliStartupMilestone(container.diagnosticsService, "shell-module-loaded");
  if (args.debug) {
    logger.info("Ink shell loaded", {
      lazyImportMs: Math.round(performance.now() - shellLoadStartedAt),
    });
  }
  runBackgroundTask({
    task: "startup.post-paint-maintenance",
    category: "cache",
    diagnostics: container.diagnosticsService,
    logger,
    run: launchShellWithPostPaintStartupWork({
      scheduler: container.backgroundWorkScheduler,
      launchShell: () => {
        void launchSessionApp(container);
      },
      recordShellMounted: () =>
        recordCliStartupMilestone(container.diagnosticsService, "shell-mounted"),
      tasks: [
        {
          id: "storage-maintenance",
          run: () => container.storageMaintenance.runStartupMaintenance().then(() => undefined),
        },
        {
          id: "download-cleanup-scan",
          run: () => maybeRunAutoCleanupDownloads(container),
        },
        ...(!config.offlineMode
          ? [
              {
                id: "provider-manifest-refresh",
                run: async () => {
                  const { groupProvidersByLane, maybeBackgroundRefreshProviderManifest } =
                    await import("./services/providers/provider-hotfix-manifest");
                  const outcome = await maybeBackgroundRefreshProviderManifest({
                    knownProvidersByLane: groupProvidersByLane(container.engine.modules),
                  });
                  if (outcome === "updated") {
                    const { getActiveProviderHotfixManifest } = await import("@kunai/providers");
                    const { reloadProviderRegistryPriority } =
                      await import("@/app/providers/provider-definitions-actions");
                    const activeManifest = getActiveProviderHotfixManifest();
                    reloadProviderRegistryPriority(container);
                    if (activeManifest) {
                      container.notificationService.recordSignals([
                        {
                          type: "provider-manifest-updated",
                          revision: activeManifest.revision,
                          updatedProviders: Object.keys(activeManifest.providers),
                        },
                      ]);
                    }
                  }
                },
              },
            ]
          : []),
      ],
    }),
  });
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
  if (!config.offlineMode) {
    // One task, not one per adapter: identity refresh and delivery share a
    // cancellation scope, and a single drain means startup cannot race a
    // scheduler tick or a manual sync for the same outbox rows. Work queued by
    // a previous session — or left behind by a crash — is redelivered here.
    runBackgroundTask({
      task: "sync.startup",
      category: "sync",
      diagnostics: container.diagnosticsService,
      logger,
      run: async (signal?: AbortSignal) => {
        await container.syncService.refreshIdentities(signal ? { signal } : undefined);
        const { reconcileSyncMutations } = await import("./services/sync/reconcile-sync-mutations");
        await reconcileSyncMutations(container, signal ? { signal } : undefined);
        await container.syncService.drain(25, signal ? { signal } : undefined);
      },
    });
  }
  await maybeRunStartupSetup({
    force: args.setup,
    config: {
      onboardingVersion: config.onboardingVersion,
      downloadOnboardingDismissed: config.downloadOnboardingDismissed,
    },
    container,
    hasDestination,
    loadSetupWorkflow: () => import("./app-shell/workflows/setup-workflows"),
  });
  openOfflineLibrary(args, container);
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
      // `-e/--episode` is a raw request, not resolved metadata: the session loop
      // shapes it into an EpisodeInfo once the picked title's lane is known.
      requestedEpisode:
        args.episode !== undefined
          ? { season: args.season ?? 1, episode: args.episode }
          : shareRequestedEpisode,
      initialRoute: resolveStartupInitialRoute({
        explicitRoute: args.initialRoute,
        discoverShowOnStartup: config.discoverShowOnStartup,
        freshInstall,
        hasExplicitTarget: hasExplicitStartupTarget({
          hasBootstrapTarget: Boolean(bootstrapTitle || bootstrapQuery),
          offline: args.offline,
          history: args.history,
          continuePlayback: args.continuePlayback,
          download: args.download,
          shareLaunch: pendingShareLaunch !== null,
        }),
      }),
      autoPickSearchResultIndex: autoPick,
    });

    logger.info("Kunai exited normally");
    await getShutdownCoordinator().request({ reason: "normal exit", exitCode: 0 });
  } catch (e) {
    logger.error("Kunai crashed", { error: String(e) });
    fatalExitError = e instanceof Error ? e : String(e);
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
  // SIGBREAK (Ctrl+Break) is the only console event Windows delivers beyond
  // SIGINT — TerminateProcess and window-close get no catchable signal there.
  process.on("SIGBREAK", () => requestSignalShutdown("SIGBREAK", 128 + 21));

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
    fatalExitError = e instanceof Error ? e : String(e);
    void getShutdownCoordinator().request({
      reason: "uncaught exception",
      exitCode: 1,
      fatal: true,
    });
  });

  process.on("unhandledRejection", (e) => {
    fatalExitError = e instanceof Error ? e : String(e);
    void getShutdownCoordinator().request({
      reason: "unhandled rejection",
      exitCode: 1,
      fatal: true,
    });
  });
}

// Every maintenance subcommand runs before the shell boots; one list feeds both.
const FAST_PATH_SUBCOMMANDS = new Set(CLI_SUBCOMMANDS);

function isFastPathInvocation(argv: readonly string[]): boolean {
  const first = argv[0];
  if (!first) return false;
  if (FAST_PATH_SUBCOMMANDS.has(first)) return true;
  return (
    argv.includes("--help") ||
    argv.includes("-h") ||
    argv.includes("--version") ||
    argv.includes("-v")
  );
}

export async function startCli(argv = process.argv.slice(2)): Promise<void> {
  const fastPath = isFastPathInvocation(argv);
  if (!(await prepareCliProfile(argv, FAST_PATH_SUBCOMMANDS, fastPath))) return;
  if (fastPath) return runCli(argv);
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

if (isProcessEntrypoint(import.meta)) {
  void startCli();
}
