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

  const pickProvider = (kinds: readonly string[]): HomeProviderMetadata | undefined => {
    const wanted = new Set(kinds);
    const eligible = providers.filter((p) => p.mediaKinds.some((k) => wanted.has(k.toLowerCase())));
    return eligible.find((p) => p.recommended) || eligible[0] || providers[0];
  };

  if (cmdText.startsWith("/anime") || cmdText === "anime") {
    const query = cmdText.replace(/^\/?anime\s*/i, "").trim() || "Frieren";
    const provider = pickProvider(["anime"]);
    log("[MODE] Switched search lane → anime (Tab cycles modes)");
    wait(300);
    log(`[QUERY] Searching anime catalog for "${query}"...`);
    wait(450);
    log(`[ OK ] Match: "${query}" · Ep 01–28 available (sub & dub)`);
    wait(350);
    if (provider) {
      log(`[INFO] Direct adapter: ${provider.displayName} (${provider.domain})`);
      wait(420);
      log("[ OK ] Stream probed: 1080p HLS verified + AniSkip chapters loaded");
      wait(350);
    }
    log(`[PLAY] Launching mpv — "${query}" Ep 01`);
  } else if (cmdText.startsWith("/series") || cmdText === "series") {
    const query = cmdText.replace(/^\/?series\s*/i, "").trim() || "Dune";
    const provider = pickProvider(["series", "movie"]);
    log("[MODE] Switched search lane → series & movies (Tab cycles modes)");
    wait(300);
    log(`[QUERY] Querying TMDB catalog for "${query}"...`);
    wait(450);
    log(`[ OK ] Match verified: "${query}" (multi-source metadata cached)`);
    wait(350);
    if (provider) {
      log(`[INFO] Direct adapter: ${provider.displayName} (${provider.domain})`);
      wait(420);
      log("[ OK ] Stream probed: 1080p verified · subtitles attached");
      wait(350);
    }
    log(`[PLAY] Launching mpv — "${query}" with resume supervisor`);
  } else if (cmdText.startsWith("/youtube") || cmdText === "youtube") {
    const query = cmdText.replace(/^\/?youtube\s*/i, "").trim() || "lofi radio";
    const provider = pickProvider(["video", "youtube"]);
    log("[MODE] Switched search lane → youtube (Tab cycles modes)");
    wait(300);
    log(`[QUERY] Resolving YouTube stream for "${query}"...`);
    wait(450);
    if (provider) {
      log(`[INFO] Adapter: ${provider.displayName} (${provider.domain})`);
      wait(350);
    }
    log("[ OK ] Audio/video formats verified (1080p / Opus) — zero browser tabs");
    wait(350);
    log(`[PLAY] Launching mpv — "${query}"`);
  } else if (
    cmdText.startsWith("/search ") ||
    cmdText.startsWith("search ") ||
    cmdText === "search"
  ) {
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
    const bare = cmdText.trim().replace(/^\//, "").split(/\s+/)[0]?.toLowerCase() ?? "";
    const matched = paletteCommands.find(
      (cmd) =>
        cmd.id.toLowerCase() === bare || cmd.aliases?.some((alias) => alias.toLowerCase() === bare),
    );
    if (matched) {
      log(`[CMD] Running /${matched.id} (${matched.label})`);
      wait(320);
      log(`[INFO] ${matched.description}`);
      wait(360);
      log("[ OK ] Ready in interactive shell — install Kunai to run locally.");
    } else if (bare.length > 0 && cmdText.trim().startsWith("/")) {
      log(`[CMD] Running /${bare}`);
      wait(320);
      log("[INFO] Simulated shell preview — full command runs locally in the Kunai CLI.");
      wait(320);
      log("[ OK ] Run `kunai --help` or open /docs/users/cli-reference for flags.");
    } else {
      log(`Evaluating unknown command: "${cmdText}"`);
      wait(300);
      log("Command not recognized. Type '/' for suggestions, or '/help'.");
    }
  }

  return { steps, doneAt: at };
}
