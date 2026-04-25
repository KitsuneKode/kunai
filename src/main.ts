#!/usr/bin/env bun
// =============================================================================
// KitsuneSnipe - New Architecture Entry Point
//
// Usage:
//   bun run src/main.ts                    # Interactive mode
//   bun run src/main.ts -S "Breaking Bad"  # Search directly
//   bun run src/main.ts -i 438631 -t movie # By ID
//   bun run src/main.ts -a                 # Anime mode
// =============================================================================

import { createContainer } from "@/container";
import { SessionController } from "@/app/SessionController";

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

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = parseArgs(process.argv.slice(2));

  // Bootstrap the DI container
  const container = await createContainer({ debug: args.debug });
  const { logger, config, stateManager } = container;

  if (args.debug) {
    logger.info("KitsuneSnipe started", {
      version: "2.0.0-beta",
      mode: args.anime ? "anime" : "series",
      provider: args.anime ? config.animeProvider : config.provider,
    });
  }

  // Initialize session state with CLI overrides
  stateManager.initialize(config.provider, config.animeProvider);

  if (args.anime) {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: "anime",
      provider: config.animeProvider,
    });
  }

  // Handle direct search or ID-based entry
  if (args.search) {
    // TODO: Direct search flow - skip initial search prompt
    logger.info("Direct search requested", { query: args.search });
  }

  if (args.id) {
    // TODO: Direct ID flow - skip search entirely
    logger.info("Direct ID requested", { id: args.id, type: args.type });
  }

  // Run the main session loop
  try {
    const controller = new SessionController(container);
    await controller.run();

    logger.info("KitsuneSnipe exited normally");
    process.exit(0);
  } catch (e) {
    logger.error("KitsuneSnipe crashed", { error: String(e) });
    console.error("Fatal error:", e);
    process.exit(1);
  }
}

// Signal handling for clean shutdown
function setupSignalHandlers(): void {
  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    // Unref stdin to allow clean exit (counteracts ink-shell .ref() calls)
    if (process.stdin.isTTY) process.stdin.unref();
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
