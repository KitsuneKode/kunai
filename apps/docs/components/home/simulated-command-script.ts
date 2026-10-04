import type { HomeCommandMetadata, HomeProviderMetadata } from "./types";

export interface ScriptStep {
  readonly at: number;
  readonly line: string;
}

export interface SimulatedScript {
  readonly steps: readonly ScriptStep[];
  /** When the run is finished and the input should re-enable. */
  readonly doneAt: number;
}

export function simulatedCommandScript(
  cmdText: string,
  providers: readonly HomeProviderMetadata[],
  paletteCommands: readonly HomeCommandMetadata[],
): SimulatedScript {
  const steps: ScriptStep[] = [];
  let at = 100;
  const log = (line: string) => {
    steps.push({ at, line });
  };
  const wait = (ms: number) => {
    at += ms;
  };

  if (cmdText.startsWith("/search ") || cmdText.startsWith("search ") || cmdText === "search") {
    const parts = cmdText.split(" ");
    const query = parts.slice(1).join(" ") || "Dune";

    log(`[QUERY] Querying metadata catalogs for "${query}"...`);
    wait(600);
    log(`[ OK ] Match found: "${query}" (Release verified, 2024)`);
    wait(400);
    log("[FETCH] Fetching active streams from verification cache...");
    wait(500);

    const isAnime = query.toLowerCase().match(/(naruto|piece|totoro|titan|frieren|re:zero|oshi)/);
    const eligibleProviders = providers.filter((p) => {
      const kindsSet = new Set(p.mediaKinds.map((k) => k.toLowerCase()));
      return isAnime ? kindsSet.has("anime") : kindsSet.has("movie") || kindsSet.has("series");
    });

    const primaryProvider =
      eligibleProviders.find((p) => p.recommended) || eligibleProviders[0] || providers[0];

    if (primaryProvider) {
      log(`[INFO] Selected provider: ${primaryProvider.displayName} (${primaryProvider.domain})`);
      wait(500);
      log(`[INFO] Resolving stream parameters...`);
      wait(700);
      if (primaryProvider.capabilities.includes("quality-ranked")) {
        log("[ OK ] Stream verified: 1080p selected (variants: 720p, 480p)");
      } else {
        log("[ OK ] Stream verified: direct-http source resolved");
      }
      wait(400);
    }

    log("[PLAY] Launching mpv player window...");
    wait(600);
    log(`[mpv] Playing "${query}" - supervisor handoff established.`);
    wait(500);
    log("[mpv] Press 'r' to recover stream, 'f' to try fallback, 'Esc' to return.");
  } else if (cmdText.startsWith("/discover") || cmdText === "discover") {
    log("[QUERY] Querying catalog recommendation engine...");
    wait(500);
    log("[INFO] Reading local SQLite continuation weights...");
    wait(400);
    log("\nTrending Today [Discover]:");
    wait(200);
    log("  1. Frieren: Beyond Journey's End (Series) [Anime]");
    wait(100);
    log("  2. Dune: Part Two (Movie) [Sci-Fi]");
    wait(100);
    log("  3. Erased (Series) [Mystery]");
    wait(400);
    log("\nUse arrow keys and press Enter to launch.");
  } else if (cmdText.startsWith("/calendar") || cmdText === "calendar") {
    log("[FETCH] Fetching release calendar schedule...");
    wait(600);
    log("Releasing Today (Source Sync):");
    wait(200);
    log("  [AIRING] Oshi no Ko S3 Ep 02 - Direct HTTP resolved");
    wait(150);
    log("  [AIRING] Re:Zero S3 Ep 14 - MAL synced (in 3h)");
    wait(150);
    log("  [AIRING] House of the Dragon S3 Ep 03 (Aired 12h ago)");
    wait(300);
    log("\nReady. Check commands bar for offline sync schedules.");
  } else if (cmdText.startsWith("/setup") || cmdText === "setup" || cmdText.includes("setup")) {
    log("[SETUP] Initializing Setup Wizard...");
    wait(400);
    log("Checking dependencies...");
    wait(300);
    log("  mpv: OK (0.38.0)");
    log("  posters (kitty graphics): OK");
    log("  sqlite3: OK");
    wait(400);
    log("Configure default media directories:");
    log("  Download path: ~/Downloads/kunai");
    log("  Cache DB limit: 512MB");
    wait(300);
    log("Configuration atomic-written to ~/.config/kunai/config.json");
  } else if (cmdText.startsWith("/recover") || cmdText === "recover") {
    log("[RECOVERY] Recovery sequence initiated.");
    wait(300);
    log("Requesting a fresh stream from the active provider...");
    wait(500);
    log("[ OK ] Resolved new stream segment (no playback drift). Resuming mpv...");
  } else if (cmdText.startsWith("/fallback") || cmdText === "fallback") {
    log("[WARN] Fallback sequence requested.");
    wait(300);
    log("Switching stream source from current provider...");
    wait(450);
    log("Connecting to fallback provider: Miruro (domain: miruro.tv)...");
    wait(500);
    log("[ OK ] Miruro stream resolved at 720p. Playback restored.");
  } else if (cmdText.startsWith("/help") || cmdText === "help") {
    log("Help Manual - Context Commands:");
    wait(150);
    for (const cmd of paletteCommands) {
      log(`  /${cmd.id.padEnd(12)} - ${cmd.description}`);
      wait(50);
    }
    log("Type '/' for more commands or open the CLI Reference.");
  } else {
    log(`Evaluating unknown command: "${cmdText}"`);
    wait(300);
    log("Command not recognized. Type '/' for suggestions, or '/help'.");
  }

  return { steps, doneAt: at };
}
