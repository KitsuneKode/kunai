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
//   bun run dev -- -m                      # Minimal footer for this session
//
// This file owns the current fullscreen session runtime.
// Keep new architecture work here. apps/cli/index.ts is only a temporary
// compatibility shim while migration residue is retired.
// =============================================================================

import { SessionController } from "@/app/SessionController";
import { createContainer, type ShellChrome } from "@/container";
import type { TitleInfo } from "@/domain/types";
import type { MpvRuntimeOptions } from "@/infra/player/mpv-runtime-options";
import { checkDeps } from "@/ui";

// Simple CLI arg parser
export function parseArgs(argv: string[]): {
  search?: string;
  id?: string;
  type?: string;
  anime: boolean;
  debug: boolean;
  mpv: MpvRuntimeOptions;
  minimal: boolean;
  quick: boolean;
  jump?: number;
  shellChrome: ShellChrome;
} {
  const args: {
    search?: string;
    id?: string;
    type?: string;
    anime: boolean;
    debug: boolean;
    mpv: MpvRuntimeOptions;
    minimal: boolean;
    quick: boolean;
    jump?: number;
  } = { anime: false, debug: false, mpv: {}, minimal: false, quick: false };
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
  const shellChrome: ShellChrome = args.minimal ? "minimal" : args.quick ? "quick" : "default";
  return { ...args, shellChrome };
}

let globalController: SessionController | null = null;
let processHandlersInitialized = false;
let shutdownInProgress = false;

async function shutdownShell(): Promise<void> {
  const { shutdownSessionApp } = await import("./app-shell/ink-shell");
  await shutdownSessionApp();
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  process.title = "kunai";

  // Parse CLI arguments
  const args = parseArgs(argv);

  // Guard: verify required system dependencies before touching the shell
  await checkDeps();

  // Bootstrap the DI container
  const container = await createContainer({
    debug: args.debug,
    mpv: args.mpv,
    shellChrome: args.shellChrome,
  });
  const { logger, config, stateManager, cacheStore } = container;

  // Prune expired cache entries at startup to prevent indefinite bloat
  await cacheStore.prune();

  if (args.debug) {
    const initialMode = args.anime ? "anime" : config.defaultMode;
    logger.info("Kunai started", {
      version: "2.0.0-beta",
      mode: initialMode,
      provider: initialMode === "anime" ? config.animeProvider : config.provider,
    });
  }

  // Initialize session state with CLI overrides
  stateManager.initialize(config.provider, config.animeProvider);
  stateManager.dispatch({ type: "SET_SUB_LANG", subLang: config.subLang });
  stateManager.dispatch({ type: "SET_ANIME_LANG", animeLang: config.animeLang });

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

  // Launch the persistent state-driven UI
  const { launchSessionApp } = await import("./app-shell/ink-shell");
  launchSessionApp(container);

  // Run the main session loop
  try {
    globalController = new SessionController(container);
    let autoPickSearchResultIndex: number | undefined = args.jump;
    if (autoPickSearchResultIndex === undefined && args.quick && bootstrapQuery) {
      autoPickSearchResultIndex = 1;
    }

    await globalController.run({
      initialQuery: bootstrapQuery,
      initialTitle: bootstrapTitle,
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
    if (globalController) {
      await globalController.shutdown();
    }
    await shutdownShell();
    if (process.stdin.isTTY) process.stdin.unref();

    process.exit(0);
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
