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

import {
  applyHistorySelectionProvider,
  recordLocalHistorySourceDecision,
  selectContinueHistoryEntry,
  titleFromHistorySelection,
} from "@/app/launch-entry";
import { SessionController } from "@/app/SessionController";
import { createContainer, type ShellChrome } from "@/container";
import type { TitleInfo } from "@/domain/types";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
import { selectDownloadCleanupCandidates } from "@/services/download/download-cleanup-policy";
import { checkDeps } from "@/ui";

const KUNAI_VERSION = "0.1.0";

// Simple CLI arg parser
export function parseArgs(argv: string[]): {
  search?: string;
  id?: string;
  type?: string;
  anime: boolean;
  debug: boolean;
  debugJson: boolean;
  zen: boolean;
  mpv: MpvRuntimeOptions;
  minimal: boolean;
  quick: boolean;
  jump?: number;
  setup: boolean;
  offline: boolean;
  history: boolean;
  continuePlayback: boolean;
  download: boolean;
  downloadPath?: string;
  initialRoute?: "recommendation" | "calendar" | "random";
  shellChrome: ShellChrome;
} {
  const args: {
    search?: string;
    id?: string;
    type?: string;
    anime: boolean;
    debug: boolean;
    debugJson: boolean;
    zen: boolean;
    mpv: MpvRuntimeOptions;
    minimal: boolean;
    quick: boolean;
    jump?: number;
    setup: boolean;
    offline: boolean;
    history: boolean;
    continuePlayback: boolean;
    download: boolean;
    downloadPath?: string;
    initialRoute?: "recommendation" | "calendar" | "random";
  } = {
    anime: false,
    debug: false,
    debugJson: false,
    zen: false,
    mpv: {},
    minimal: false,
    quick: false,
    setup: false,
    offline: false,
    history: false,
    continuePlayback: false,
    download: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-S" || arg === "--search") {
      args.search = argv[++i];
    } else if (arg === "-i" || arg === "--id") {
      args.id = argv[++i];
    } else if (arg === "-t" || arg === "--type") {
      args.type = argv[++i];
    } else if (arg === "-a" || arg === "--anime") {
      args.anime = true;
    } else if (arg === "-m" || arg === "--minimal") {
      args.minimal = true;
    } else if (arg === "-z" || arg === "--zen") {
      args.zen = true;
      args.minimal = true;
      args.quick = true;
    } else if (arg === "-q" || arg === "--quick") {
      args.quick = true;
    } else if (arg === "--jump") {
      const raw = argv[++i];
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      if (Number.isFinite(parsed) && parsed >= 1) {
        args.jump = parsed;
      }
    } else if (arg === "--debug") {
      args.debug = true;
    } else if (arg === "--debug-json") {
      args.debug = true;
      args.debugJson = true;
    } else if (arg === "--setup") {
      args.setup = true;
    } else if (arg === "--offline") {
      args.offline = true;
    } else if (arg === "--discover") {
      args.initialRoute = "recommendation";
    } else if (arg === "--calendar") {
      args.initialRoute = "calendar";
    } else if (arg === "--random") {
      args.initialRoute = "random";
    } else if (arg === "--history") {
      args.history = true;
    } else if (arg === "--continue" || arg === "--resume") {
      args.continuePlayback = true;
    } else if (arg === "--download") {
      args.download = true;
    } else if (arg === "--download-path") {
      args.downloadPath = argv[++i];
    } else if (arg === "--mpv-debug") {
      args.mpv = { ...args.mpv, debug: true };
    } else if (arg === "--mpv-clean") {
      args.mpv = { ...args.mpv, clean: true };
    } else if (arg === "--no-user-mpv-config") {
      args.mpv = { ...args.mpv, noUserConfig: true };
    } else if (arg === "--mpv-log-file") {
      const value = argv[++i];
      if (value) args.mpv = { ...args.mpv, logFile: value };
    }
  }
  const shellChrome: ShellChrome =
    args.minimal || args.zen ? "minimal" : args.quick ? "quick" : "default";
  return { ...args, shellChrome };
}

let globalController: SessionController | null = null;
let globalContainer: Awaited<ReturnType<typeof createContainer>> | null = null;
let processHandlersInitialized = false;
let shutdownInProgress = false;

async function shutdownShell(): Promise<void> {
  const { shutdownSessionApp } = await import("./app-shell/ink-shell");
  await shutdownSessionApp();
}

async function maybeRunSetupWizard(
  args: { setup: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
) {
  const { runSetupWizard } = await import("./app-shell/workflows");
  await runSetupWizard({
    container,
    force: args.setup,
  });
}

async function maybeRunOfflineMode(
  args: { offline: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<boolean> {
  if (!args.offline) {
    return false;
  }

  const { openCompletedDownloadsPicker, buildPickerActionContext } =
    await import("./app-shell/workflows");
  await openCompletedDownloadsPicker(
    container,
    buildPickerActionContext({ container, taskLabel: "Offline library" }),
  );
  return true;
}

async function maybeOpenStartupHistory(
  args: { history: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<TitleInfo | null> {
  if (!args.history) return null;

  const { waitForRootHistorySelection } = await import("./app-shell/root-history-bridge");
  const selectionPromise = waitForRootHistorySelection();
  container.stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "history" } });
  const selection = await selectionPromise;
  container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
  if (!selection) return null;

  applyHistorySelectionProvider(container, selection);
  return titleFromHistorySelection(selection);
}

async function maybeResolveContinueTitle(
  args: { continuePlayback: boolean },
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<TitleInfo | null> {
  if (!args.continuePlayback) return null;
  const selection = selectContinueHistoryEntry(await container.historyStore.getAll());
  if (!selection) {
    container.diagnosticsStore.record({
      category: "session",
      message: "Continue requested but no unfinished history entry was available",
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No unfinished history entry to continue yet.",
    });
    return null;
  }
  applyHistorySelectionProvider(container, selection);
  await recordLocalHistorySourceDecision(container, selection, "continue");
  return titleFromHistorySelection(selection);
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
        await import("@/app/SearchPhase")
      ).SearchPhase().execute(
        {
          initialQuery: args.search,
          autoPickSearchResultIndex: args.jump ?? (args.quick && args.search ? 1 : undefined),
        },
        { container, signal: new AbortController().signal },
      );

  if (searchResult.status !== "success") {
    console.log("Download cancelled before a title was selected.");
    return true;
  }

  const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
  const result = await new DownloadOnlyPhase().execute(
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

async function maybeRunAutoCleanupDownloads(
  container: Awaited<ReturnType<typeof createContainer>>,
): Promise<void> {
  const { config, downloadService, diagnosticsService, historyStore, logger } = container;
  if (!config.autoCleanupWatched) return;

  const graceDays = Math.max(0, config.autoCleanupGraceDays);
  const nowMs = Date.now();
  const jobs = downloadService.listCompleted(500);
  const historyEntries = await Promise.all(
    [...new Set(jobs.map((job) => job.titleId))].map(async (titleId) => {
      const entries = await historyStore.listByTitle(titleId).catch(() => []);
      return [titleId, entries] as const;
    }),
  );
  const historyByTitle = new Map(historyEntries);
  const candidates = selectDownloadCleanupCandidates({
    jobs,
    historyByTitle,
    nowMs,
    graceDays,
    pinnedJobIds: new Set(config.protectedDownloadJobIds),
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

  // Parse CLI arguments
  const args = parseArgs(argv);

  // Guard: verify required system dependencies before touching the shell
  const capabilitySnapshot = await checkDeps(KUNAI_VERSION);

  // Bootstrap the DI container
  const container = await createContainer({
    debug: args.debug,
    debugJson: args.debugJson,
    mpv: args.mpv,
    shellChrome: args.shellChrome,
    capabilitySnapshot,
    appVersion: KUNAI_VERSION,
  });
  globalContainer = container;
  const { logger, config, stateManager, cacheStore } = container;
  await maybeRunAutoCleanupDownloads(container);

  // Initialize session state with CLI overrides
  stateManager.initialize(config.provider, config.animeProvider, {
    anime: config.animeLanguageProfile,
    series: config.seriesLanguageProfile,
    movie: config.movieLanguageProfile,
  });

  const initialMode = args.anime ? "anime" : config.defaultMode;
  if (initialMode === "anime") {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: "anime",
      provider: config.animeProvider,
    });
  }

  let bootstrapQuery: string | undefined;
  let bootstrapTitle: TitleInfo | null = null;

  if (args.search?.trim()) {
    bootstrapQuery = args.search.trim();
    logger.info("Bootstrap search requested", { query: bootstrapQuery });
  }

  if (args.id) {
    if (args.anime) {
      logger.warn("Direct ID bootstrap is not supported for anime mode yet", { id: args.id });
    } else if (args.type === "movie" || args.type === "series") {
      bootstrapTitle = {
        id: args.id,
        type: args.type,
        name: `TMDB ${args.id}`,
      };
      logger.info("Bootstrap title requested", {
        id: args.id,
        type: args.type,
      });
    } else {
      logger.warn("Ignoring direct ID without a supported --type", {
        id: args.id,
        type: args.type,
      });
    }
  }

  void container.downloadService.processQueue();
  container.updateService.checkInBackground();
  if (capabilitySnapshot.issues.length > 0) {
    container.diagnosticsStore.record({
      category: "session",
      message: "Startup capability checks",
      context: {
        issues: capabilitySnapshot.issues,
      },
    });
  }

  // Prune expired cache entries at startup to prevent indefinite bloat
  await cacheStore.prune();

  if (args.debug) {
    logger.info("Kunai started", {
      version: KUNAI_VERSION,
      mode: initialMode,
      provider: initialMode === "anime" ? config.animeProvider : config.provider,
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
    });
  }

  // Launch the persistent state-driven UI
  const { launchSessionApp } = await import("./app-shell/ink-shell");
  launchSessionApp(container);
  await maybeRunSetupWizard(args, container);
  if (await maybeRunOfflineMode(args, container)) {
    await shutdownShell();
    if (process.stdin.isTTY) process.stdin.unref();
    return;
  }
  if (await maybeRunDownloadMode(args, container, bootstrapTitle)) {
    await shutdownShell();
    if (process.stdin.isTTY) process.stdin.unref();
    return;
  }
  if (!capabilitySnapshot.mpv) {
    console.error("\nmpv is required for playback. Install mpv and rerun Kunai.");
    await shutdownShell();
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(1);
  }

  // Run the main session loop
  try {
    globalController = new SessionController(container);
    if (!bootstrapTitle && args.history) {
      bootstrapTitle = await maybeOpenStartupHistory(args, container);
    }
    if (!bootstrapTitle && args.continuePlayback) {
      bootstrapTitle = await maybeResolveContinueTitle(args, container);
    }
    let autoPickSearchResultIndex: number | undefined = args.jump;
    if (autoPickSearchResultIndex === undefined && args.quick && bootstrapQuery) {
      autoPickSearchResultIndex = 1;
    }

    await globalController.run({
      initialQuery: bootstrapQuery,
      initialTitle: bootstrapTitle,
      initialRoute: args.initialRoute,
      autoPickSearchResultIndex,
    });

    logger.info("Kunai exited normally");
    await globalController.shutdown();
    await shutdownShell();
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(0);
  } catch (e) {
    logger.error("Kunai crashed", { error: String(e) });
    await globalController?.shutdown().catch(() => {});
    await shutdownShell();
    console.error("Fatal error:", e);
    process.exit(1);
  }
}

// Signal handling for clean shutdown
function setupSignalHandlers(): void {
  if (processHandlersInitialized) {
    return;
  }
  processHandlersInitialized = true;

  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`\nReceived ${signal}, shutting down cleanly...`);
    // Force exit after 4 s so stuck cleanup never stalls Ctrl+C.
    const forceExit = setTimeout(() => {
      process.exit(0);
    }, 4000);
    if (forceExit.unref) forceExit.unref();
    try {
      await globalContainer?.downloadService.pauseActiveJobsForShutdown(
        `download paused by ${signal}`,
      );
      if (globalController) {
        await globalController.shutdown();
      }
      await shutdownShell();
    } finally {
      clearTimeout(forceExit);
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  process.on("uncaughtException", (e) => {
    console.error("Uncaught exception:", e);
    void shutdownShell();
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(1);
  });

  process.on("unhandledRejection", (e) => {
    console.error("Unhandled rejection:", e);
    void shutdownShell();
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(1);
  });
}

export async function startCli(argv = process.argv.slice(2)): Promise<void> {
  setupSignalHandlers();
  await runCli(argv);
}

if (import.meta.main) {
  void startCli();
}
