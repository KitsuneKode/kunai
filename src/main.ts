#!/usr/bin/env bun
// =============================================================================
// Kunai - New Architecture Entry Point
//
// Usage:
//   bun run src/main.ts                    # Interactive mode
//   bun run src/main.ts -S "Breaking Bad"  # Search directly
//   bun run src/main.ts -i 438631 -t movie # By ID
//   bun run src/main.ts -a                 # Anime mode
// =============================================================================

import { createContainer } from "@/container";
import { SessionController } from "@/app/SessionController";
import type { TitleInfo } from "@/domain/types";

// Simple CLI arg parser
function parseArgs(argv: string[]): {
  search?: string;
  id?: string;
  type?: string;
  anime: boolean;
  debug: boolean;
} {
  const args: {
    search?: string;
    id?: string;
    type?: string;
    anime: boolean;
    debug: boolean;
  } = { anime: false, debug: false };
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
    } else if (arg === "--debug") {
      args.debug = true;
    }
  }
  return args;
}

let globalController: SessionController | null = null;

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = parseArgs(process.argv.slice(2));

  // Bootstrap the DI container
  const container = await createContainer({ debug: args.debug });
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
  launchSessionApp(stateManager);

  // Run the main session loop
  try {
    globalController = new SessionController(container);
    await globalController.run({
      initialQuery: bootstrapQuery,
      initialTitle: bootstrapTitle,
    });

    logger.info("Kunai exited normally");
    // Ensure the shell is unmounted if the controller finishes
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(0);
  } catch (e) {
    logger.error("Kunai crashed", { error: String(e) });
    console.error("Fatal error:", e);
    process.exit(1);
  }
}

// Signal handling for clean shutdown
function setupSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down cleanly...`);
    if (process.stdin.isTTY) process.stdin.unref();

    if (globalController) {
      globalController.shutdown();
      // Wait a short tick for synchronous pending tasks to wind down
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Handle uncaught errors
process.on("uncaughtException", (e) => {
  console.error("Uncaught exception:", e);
  if (process.stdin.isTTY) process.stdin.unref();
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  console.error("Unhandled rejection:", e);
  if (process.stdin.isTTY) process.stdin.unref();
  process.exit(1);
});

// Setup handlers before starting
setupSignalHandlers();

// Start
main();
