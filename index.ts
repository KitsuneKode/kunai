#!/usr/bin/env bun
import { intro, outro, text, select, confirm, spinner, log, isCancel, cancel } from "@clack/prompts";
import { parseArgs } from "util";

import { searchVideasy, type SearchResult } from "./lib/search";
import { displayPoster, isKittyCompatible } from "./lib/image";
import { getHistory, saveHistory, isFinished, formatTimestamp, type HistoryEntry } from "./lib/history";
import { getCachedStream } from "./lib/cache";
import { buildUrl, getProvider, PROVIDER_LIST } from "./lib/providers";
import { scrapeStream, type StreamData } from "./lib/scraper";
import { launchMpv } from "./lib/mpv";
import { checkDeps, pickWithFzf, pickSubtitleWithFzf } from "./lib/ui";
import { loadConfig, saveConfig, type KitsuneConfig } from "./lib/config";
import { drawMenu, openSettings, readSingleKey, bold, cyan, dim, green, yellow } from "./lib/menu";
import { initLogger, dbg } from "./lib/logger";

// =============================================================================
// 1. FLAGS  (all optional — omit everything to run fully interactively)
// =============================================================================
const { values } = parseArgs({
  args: Bun.argv,
  options: {
    id:            { type: "string",  short: "i" }, // TMDB ID (skip search)
    search:        { type: "string",  short: "S" }, // pre-fill search query
    title:         { type: "string",  short: "T" }, // override display title in MPV
    season:        { type: "string",  short: "s" },
    episode:       { type: "string",  short: "e" },
    provider:      { type: "string",  short: "p" }, // vidking | cineby
    type:          { type: "string",  short: "t" }, // movie | series
    "sub-lang":    { type: "string",  short: "l" }, // en | ar | fzf | none
    "no-headless": { type: "boolean", short: "H" }, // force visible browser
    "debug":       { type: "boolean", short: "d" }, // verbose debug output to stderr
  },
  strict: true,
  allowPositionals: true,
});

// =============================================================================
// 2. SESSION STATE
// =============================================================================
let currentId:       string;
let currentTitle:    string;
let currentSeason:   number;
let currentEpisode:  number;
let currentProvider: string;
let currentType:     "movie" | "series";
let currentSubLang:  string;
let useHeadless:     boolean;
let config:          KitsuneConfig;

// In-memory pre-fetch slot — holds a pending scrape for the next episode
let prefetchedStream: { url: string; data: Promise<StreamData | null> } | null = null;

let hasFzf = true;

// =============================================================================
// 3. HELPERS
// =============================================================================

function cancelAndExit(): never {
  cancel("Cancelled.");
  process.exit(0);
}

function guard<T>(value: T | symbol): T {
  if (isCancel(value)) cancelAndExit();
  return value as T;
}

process.on("SIGINT", () => {
  process.stdout.write("\n");
  outro("See you next time 🦊");
  process.exit(0);
});

function buildDisplayTitle(): string {
  return currentType === "movie"
    ? currentTitle
    : `${currentTitle} - S${currentSeason}E${currentEpisode}`;
}

// =============================================================================
// 4. STREAM RESOLUTION  (pre-fetch → disk cache → fresh scrape)
// =============================================================================

async function resolveStream(targetUrl: string): Promise<StreamData | null> {
  // 1. In-memory pre-fetch (started during previous episode's MPV session)
  if (prefetchedStream?.url === targetUrl) {
    const s = spinner();
    s.start("Awaiting pre-fetched stream…");
    const data = await prefetchedStream.data;
    prefetchedStream = null;
    s.stop(data ? "Stream ready." : "Pre-fetch missed — scraping fresh.");
    if (data) return data;
  } else if (prefetchedStream) {
    prefetchedStream = null; // stale (user jumped episodes)
  }

  // 2. Disk cache (1-hour TTL)
  const cached = await getCachedStream(targetUrl);
  if (cached) { log.success("Cache hit — skipping scraper."); return cached; }

  // 3. Fresh scrape
  const s = spinner();
  s.start("Scraping stream…");
  const data = await scrapeStream(getProvider(currentProvider), targetUrl, currentSubLang, useHeadless);
  s.stop(data ? "Stream found." : "Failed to find stream.");
  return data;
}

function startPrefetch(url: string) {
  if (prefetchedStream?.url === url) return;
  prefetchedStream = { url, data: scrapeStream(getProvider(currentProvider), url, currentSubLang, true) };
}

// =============================================================================
// 5. MAIN
// =============================================================================
(async () => {
  intro(`${bold("KitsuneSnipe")} 🦊`);

  // ── Debug mode ────────────────────────────────────────────────────────────
  const debugEnabled = !!(values.debug) || process.env.KITSUNE_DEBUG === "1";
  initLogger(debugEnabled);
  if (debugEnabled) log.warn("Debug mode on — verbose output to stderr  (pipe with 2>&1 | jq)");
  dbg("main", "session start", { debugEnabled });

  // ── Dependency check ──────────────────────────────────────────────────────
  const deps = await checkDeps();
  hasFzf = deps.fzf;

  // ── Load config (persisted defaults) ─────────────────────────────────────
  // Flags override config; config overrides built-in defaults.
  config          = await loadConfig();
  currentProvider = (values.provider as string)    ?? config.provider;
  currentSubLang  = (values["sub-lang"] as string) ?? config.subLang;
  useHeadless     = values["no-headless"] ? false   : config.headless;

  log.info(
    `${dim("Provider")} ${cyan(currentProvider)}  ` +
    `${dim("Subs")} ${cyan(currentSubLang)}  ` +
    `${dim("Browser")} ${cyan(useHeadless ? "headless" : "visible")}  ` +
    dim("· change anytime with [c]"),
  );

  // ── Search / direct ID ────────────────────────────────────────────────────
  let picked: SearchResult | null = null;

  if (values.id) {
    currentId    = values.id as string;
    currentType  = (values.type as "movie" | "series") ?? "series";
    currentTitle = (values.title as string) ?? "Unknown";
    picked       = { id: currentId, type: currentType, title: currentTitle, year: "?", overview: "", posterPath: null };
  } else {
    const rawQuery = (values.search as string) ||
      (guard(await text({ message: "Search:", placeholder: "Breaking Bad" })) as string);

    const s = spinner();
    s.start("Searching…");
    let results: SearchResult[] = [];
    try {
      results = await searchVideasy(rawQuery);
      s.stop(`${results.length} results`);
    } catch {
      s.stop("Search failed.");
      log.error("Could not reach search API. Check your connection.");
      process.exit(1);
    }

    if (results.length === 0) { log.error("No results found."); process.exit(1); }

    const fmt = (r: SearchResult) =>
      `${r.title} (${r.year}) — ${r.type === "series" ? "Series" : "Movie"}  [${r.overview}]`;

    picked = await pickWithFzf(results, fmt, { prompt: "Select title", hasFzf });
    if (!picked) cancelAndExit();

    currentId    = picked.id;
    currentType  = picked.type;
    currentTitle = (values.title as string) || picked.title;
  }

  // ── Show what was picked (type + title) ──────────────────────────────────
  const typeIcon  = currentType === "movie" ? "🎬" : "📺";
  const typeLabel = currentType === "movie" ? "Movie" : "Series";
  log.step(`${typeIcon}  ${bold(currentTitle)}  ${dim(`(${typeLabel} · TMDB ${currentId})`)}`);

  // ── Poster preview (Kitty / Ghostty only) ─────────────────────────────────
  if (picked?.posterPath && isKittyCompatible()) {
    await displayPoster(picked.posterPath);
  }

  // ── Season / Episode (series only) ────────────────────────────────────────

  // Validates that the user entered a positive whole number.
  const validateNum = (label: string) => (v: string | undefined): string | undefined => {
    const t = (v ?? "").trim();
    if (!t) return `${label} is required`;
    if (!/^\d+$/.test(t)) return "Enter a whole number  (e.g. 1, 3, 12)";
    if (parseInt(t, 10) < 1) return "Must be 1 or higher";
    return undefined;
  };

  // Prompt for season and episode with live validation.
  const pickEpisode = async (initSeason: string, initEpisode: string) => {
    const s = Number(guard(await text({
      message:      "Season:",
      initialValue: initSeason,
      validate:     validateNum("Season"),
    })));
    const e = Number(guard(await text({
      message:      "Episode:",
      initialValue: initEpisode,
      validate:     validateNum("Episode"),
    })));
    return { season: s, episode: e };
  };

  if (currentType === "series") {
    // Flags always win — skip all prompts
    if (values.season || values.episode) {
      const s = parseInt((values.season  as string) ?? "1", 10);
      const e = parseInt((values.episode as string) ?? "1", 10);
      currentSeason  = Number.isFinite(s) && s >= 1 ? s : 1;
      currentEpisode = Number.isFinite(e) && e >= 1 ? e : 1;
    } else {
      const hist = await getHistory(currentId);

      if (hist) {
        const finished  = isFinished(hist);
        const nextEp    = hist.episode + 1;
        const pct       = hist.duration ? Math.round((hist.timestamp / hist.duration) * 100) : 0;
        const resumeAt  = formatTimestamp(hist.timestamp);

        if (!finished) {
          log.info(
            `Last watched: ${cyan(`S${hist.season}E${hist.episode}`)}  ` +
            `stopped at ${yellow(resumeAt)}  ${dim(`(${pct}%)`)}`,
          );
        } else {
          log.info(`Last finished: ${cyan(`S${hist.season}E${hist.episode}`)}`);
        }

        // Single select replaces the two-step confirm flow
        const choice = guard(await select({
          message: "Where to start?",
          options: [
            ...(!finished ? [
              { value: "resume",  label: `Resume S${hist.season}E${hist.episode} from ${resumeAt}` },
              { value: "restart", label: `Restart S${hist.season}E${hist.episode} from the beginning` },
            ] : []),
            { value: "next",   label: `Next episode  S${hist.season}E${nextEp}` },
            { value: "pick",   label: "Pick season & episode…" },
          ],
          initialValue: finished ? "next" : "resume",
        })) as "resume" | "restart" | "next" | "pick";

        if (choice === "resume") {
          currentSeason  = hist.season;
          currentEpisode = hist.episode;
        } else if (choice === "restart") {
          currentSeason  = hist.season;
          currentEpisode = hist.episode;
        } else if (choice === "next") {
          currentSeason  = hist.season;
          currentEpisode = nextEp;
        } else {
          const ep = await pickEpisode(String(hist.season), String(hist.episode));
          currentSeason  = ep.season;
          currentEpisode = ep.episode;
        }
      } else {
        // No history — always show the picker (pre-filled at S1E1)
        const ep = await pickEpisode("1", "1");
        currentSeason  = ep.season;
        currentEpisode = ep.episode;
      }
    }
  } else {
    currentSeason  = 1;
    currentEpisode = 1;
  }

  // =============================================================================
  // 6. PLAYBACK LOOP
  // =============================================================================
  while (true) {
    const targetUrl = buildUrl(currentProvider, currentId, currentType, currentSeason, currentEpisode);

    log.step(
      currentType === "movie"
        ? `Movie: ${bold(currentTitle)}  ${dim("[" + currentProvider + "]")}`
        : `${cyan(`S${currentSeason}E${currentEpisode}`)} — ${bold(currentTitle)}  ${dim("[" + currentProvider + "]")}`,
    );

    // Resolve stream (pre-fetch → cache → scrape)
    let streamInfo = await resolveStream(targetUrl);

    // Auto-fallback: if primary fails, silently try the other provider
    if (!streamInfo) {
      const fallbackProvider = PROVIDER_LIST.find((p) => p.id !== currentProvider);
      if (fallbackProvider) {
        log.warn(`${currentProvider} failed — trying ${fallbackProvider.id}…`);
        const fallbackUrl = buildUrl(fallbackProvider.id, currentId, currentType, currentSeason, currentEpisode);
        const s = spinner();
        s.start(`Scraping via ${fallbackProvider.id}…`);
        streamInfo = await scrapeStream(fallbackProvider, fallbackUrl, currentSubLang, useHeadless);
        s.stop(streamInfo ? `Got stream via ${fallbackProvider.id}.` : `${fallbackProvider.id} also failed.`);
      }
    }

    if (!streamInfo) {
      log.error("Could not retrieve stream. Episode may not exist yet or both providers are blocked.");
    } else {
      // ── Subtitle selection ─────────────────────────────────────────────────
      let finalSubtitle = streamInfo.subtitle;
      if (currentSubLang === "fzf" && streamInfo.subtitleList?.length) {
        log.info(`${streamInfo.subtitleList.length} subtitle tracks found`);
        finalSubtitle = await pickSubtitleWithFzf(streamInfo.subtitleList, { hasFzf });
      } else if (currentSubLang === "none") {
        finalSubtitle = null;
      }

      // ── Start pre-fetching next episode while MPV is open ─────────────────
      if (currentType === "series") {
        startPrefetch(buildUrl(currentProvider, currentId, currentType, currentSeason, currentEpisode + 1));
      }

      // ── Resume from saved position ─────────────────────────────────────────
      let startAt = 0;
      const hist  = await getHistory(currentId);
      if (hist && hist.season === currentSeason && hist.episode === currentEpisode && !isFinished(hist)) {
        startAt = hist.timestamp;
        log.info(`Resuming from ${formatTimestamp(startAt)}`);
      }

      // ── Launch MPV ─────────────────────────────────────────────────────────
      const result = await launchMpv({
        url:          streamInfo.url,
        headers:      streamInfo.headers,
        subtitle:     finalSubtitle,
        displayTitle: buildDisplayTitle(),
        startAt,
        autoNext:     config.autoNext && currentType === "series",
      });

      // ── Persist watch position ─────────────────────────────────────────────
      if (result.watchedSeconds > 10) {
        const entry: HistoryEntry = {
          title:     currentTitle,
          type:      currentType,
          season:    currentSeason,
          episode:   currentEpisode,
          timestamp: result.watchedSeconds,
          duration:  result.duration,
          provider:  currentProvider,
          watchedAt: new Date().toISOString(),
        };
        await saveHistory(currentId, entry);

        const pct = result.duration > 0 ? Math.round((result.watchedSeconds / result.duration) * 100) : 0;
        log.success(`Saved position: ${yellow(formatTimestamp(result.watchedSeconds))} ${dim(`(${pct}%)`)}`);
      }

      // ── Auto-advance on natural EOF ────────────────────────────────────────
      // The Lua script already showed a 5-second countdown inside MPV and quit.
      // endReason="eof"  → countdown completed, advance automatically.
      // endReason="quit" → user pressed q to cancel, fall through to menu.
      if (result.endReason === "eof" && config.autoNext && currentType === "series") {
        log.info(`Auto-advancing to ${cyan(`S${currentSeason}E${currentEpisode + 1}`)}…`);
        currentEpisode++;
        // resolveStream at the top of the loop will pick up the in-flight
        // pre-fetch (which was started before MPV launched). If that episode
        // doesn't exist, the scraper will fail and the menu will show naturally.
        continue;
      }
    }

    // ── Post-playback menu ─────────────────────────────────────────────────
    drawMenu({
      type:       currentType,
      title:      currentTitle,
      season:     currentSeason,
      episode:    currentEpisode,
      provider:   currentProvider,
      showMemory: config.showMemory,
    });

    const k = await readSingleKey();
    process.stdout.write("\n");

    if (k === "q" || k === "\x1b") {
      outro("See you next time 🦊");
      process.exit(0);
    } else if (k === "c") {
      const updated = await openSettings(config);
      if (updated) {
        const providerChanged = updated.provider !== currentProvider;
        config          = updated;
        currentProvider = updated.provider;
        currentSubLang  = updated.subLang;
        useHeadless     = updated.headless;
        if (providerChanged) prefetchedStream = null;
      }
    } else if (k === "r") {
      // replay — loop restarts with same episode, same url
    } else if (k === "n" && currentType === "series") {
      currentEpisode++;
    } else if (k === "p" && currentType === "series") {
      prefetchedStream = null;
      if (currentEpisode > 1) currentEpisode--;
      else log.warn("Already at episode 1.");
    } else if (k === "s" && currentType === "series") {
      prefetchedStream = null;
      currentSeason++;
      currentEpisode = 1;
    } else if (k === "o" && currentType === "series") {
      prefetchedStream = null;
      const idx = PROVIDER_LIST.findIndex((p) => p.id === currentProvider);
      currentProvider = (PROVIDER_LIST[(idx + 1) % PROVIDER_LIST.length] ?? PROVIDER_LIST[0])!.id;
      log.info(`Switched to ${green(currentProvider)}`);
    }
    // Any unknown key replays the current episode (safe default)
  }
})();
