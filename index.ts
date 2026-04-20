#!/usr/bin/env bun
import { intro, outro, text, spinner, log, isCancel, cancel } from "@clack/prompts";
import { parseArgs } from "util";

import { searchVideasy, type SearchResult } from "@/search";
import { displayPoster, isKittyCompatible } from "@/image";
import { getHistory, saveHistory, isFinished, formatTimestamp, type HistoryEntry } from "@/history";
import { getCachedStream } from "@/cache";
import {
  buildUrl,
  getProvider,
  PLAYWRIGHT_PROVIDERS,
  isPlaywright,
  isApi,
  type PlaywrightProvider,
  type ApiProvider,
  type ApiSearchResult,
} from "@/providers";
import { scrapeStream, type StreamData } from "@/scraper";
import { launchMpv } from "@/mpv";
import { checkDeps, pickWithFzf, pickSubtitleWithFzf } from "@/ui";
import {
  loadConfig,
  loadDomainOverrides,
  applyDomainOverrides,
  type KitsuneConfig,
} from "@/config";
import { openSettings, bold, cyan, dim, green, yellow } from "@/menu";
import { initLogger, dbg } from "@/logger";
import { openHomeShell, openPlaybackShell, formatMemoryUsage } from "@/app-shell/ink-shell";
import { chooseStartingEpisode, cycleProvider, describeHistoryEntry } from "@/session-flow";

// =============================================================================
// 1. FLAGS
// =============================================================================
const { values } = parseArgs({
  args: Bun.argv,
  options: {
    id: { type: "string", short: "i" }, // TMDB / provider ID (skip search)
    search: { type: "string", short: "S" }, // pre-fill search query
    title: { type: "string", short: "T" }, // override display title in MPV
    season: { type: "string", short: "s" },
    episode: { type: "string", short: "e" },
    provider: { type: "string", short: "p" }, // provider ID
    type: { type: "string", short: "t" }, // movie | series
    "sub-lang": { type: "string", short: "l" }, // en | ar | fzf | none
    "no-headless": { type: "boolean", short: "H" }, // force visible browser
    debug: { type: "boolean", short: "d" }, // verbose debug to stderr
    anime: { type: "boolean", short: "a" }, // anime mode (AllAnime search)
    attach: { type: "boolean" }, // attach MPV to terminal (no detach)
  },
  strict: true,
  allowPositionals: true,
});

// =============================================================================
// 2. SESSION STATE
// =============================================================================
let currentId: string;
let currentTitle: string;
let currentSeason: number;
let currentEpisode: number;
let currentProvider: string; // provider ID (resolved from config/flags)
let currentType: "movie" | "series";
let currentSubLang: string;
let useHeadless: boolean;
let isAnime: boolean; // true → anime provider flow
let config: KitsuneConfig;

// Pre-fetch slot — only active for Playwright providers
let prefetchedStream: { url: string; data: Promise<StreamData | null> } | null = null;

let hasFzf = true;

// =============================================================================
// 3. HELPERS
// =============================================================================

function cancelAndExit(): never {
  cancel("Cancelled.");
  process.exit(0);
}
function guard<T>(v: T | symbol): T {
  if (isCancel(v)) cancelAndExit();
  return v as T;
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

function statusForCurrentMode() {
  return {
    label: `${isAnime ? "Anime" : "Series"} mode ready`,
    tone: "neutral" as const,
  };
}

// Non-blocking key peek — waits up to 800 ms for a keypress before proceeding.
// Returns the key char, or "" if nothing pressed (timed out / non-TTY).
async function readPrePlaybackKey(): Promise<string> {
  if (!process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    let done = false;
    const finish = (k: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(k);
    };
    const timer = setTimeout(() => finish(""), 800);
    try {
      process.stdin.setRawMode(true);
      process.stdin.read(); // drain buffered bytes
      process.stdin.resume();
      process.stdin.once("data", (buf: Buffer) => {
        const k = buf.toString();
        if (k === "\x03") {
          finish("q");
          return;
        }
        finish(k.toLowerCase().trim() || "");
      });
    } catch {
      clearTimeout(timer);
      resolve("");
    }
  });
}

// Playwright embed scraper — injected into ApiProvider.resolveStream so
// hybrid providers (Braflix) can do the final embed extraction without
// importing scraper.ts themselves (avoids circular dependencies).
const embedScraper = (
  embedUrl: string,
  scraperOpts?: { needsClick?: boolean },
): Promise<StreamData | null> => {
  const provider: PlaywrightProvider = {
    kind: "playwright",
    id: "embed",
    name: "Embed",
    description: "",
    domain: "",
    recommended: false,
    movieUrl: () => "",
    seriesUrl: () => "",
    needsClick: scraperOpts?.needsClick ?? false,
    titleSource: "page-title",
  };
  return scrapeStream(provider, embedUrl, currentSubLang, useHeadless);
};

// =============================================================================
// 4. STREAM RESOLUTION
// =============================================================================

// CDN tokens (e.g. wixmp) typically expire in ~20 min. Pre-fetched streams
// captured at the start of a long episode may have stale tokens by the time
// they are used. Discard anything older than this threshold.
const PRE_FETCH_MAX_AGE = 15 * 60 * 1000;

// Playwright path: pre-fetch → disk cache → fresh scrape.
async function resolvePlaywrightStream(
  provider: PlaywrightProvider,
  targetUrl: string,
): Promise<StreamData | null> {
  if (prefetchedStream?.url === targetUrl) {
    const s = spinner();
    s.start("Awaiting pre-fetched stream…");
    const data = await prefetchedStream.data;
    prefetchedStream = null;
    const age = data ? Date.now() - data.timestamp : Infinity;
    if (data && age < PRE_FETCH_MAX_AGE) {
      s.stop("Stream ready.");
      return data;
    }
    s.stop(
      data ? "Pre-fetched stream expired — scraping fresh." : "Pre-fetch missed — scraping fresh.",
    );
  } else if (prefetchedStream) {
    prefetchedStream = null; // stale
  }

  const cached = await getCachedStream(targetUrl);
  if (cached) {
    log.success("Cache hit — skipping scraper.");
    return cached;
  }

  const s = spinner();
  s.start("Scraping stream…");
  const data = await scrapeStream(provider, targetUrl, currentSubLang, useHeadless);
  s.stop(data ? "Stream found." : "Failed to find stream.");
  return data;
}

// API path: provider owns the full pipeline.
async function resolveApiStream(provider: ApiProvider): Promise<StreamData | null> {
  const s = spinner();
  s.start(`Resolving via ${provider.name}…`);
  const data = await provider.resolveStream(currentId, currentType, currentSeason, currentEpisode, {
    subLang: currentSubLang,
    animeLang: config.animeLang,
    embedScraper,
  });
  s.stop(data ? "Stream found." : `${provider.name} could not resolve a stream.`);
  return data;
}

// Top-level dispatcher — routes by provider kind.
async function resolveStream(): Promise<StreamData | null> {
  const provider = getProvider(currentProvider);

  if (isPlaywright(provider)) {
    const url = buildUrl(provider, currentId, currentType, currentSeason, currentEpisode);
    return resolvePlaywrightStream(provider, url);
  }
  return resolveApiStream(provider as ApiProvider);
}

function startPrefetch() {
  const provider = getProvider(currentProvider);
  if (!isPlaywright(provider)) return; // API providers don't use URL-based pre-fetch
  const nextUrl = buildUrl(provider, currentId, currentType, currentSeason, currentEpisode + 1);
  if (prefetchedStream?.url === nextUrl) return;
  prefetchedStream = { url: nextUrl, data: scrapeStream(provider, nextUrl, currentSubLang, true) };
}

// =============================================================================
// 5. MAIN
// =============================================================================
(async () => {
  intro(`${bold("KitsuneSnipe")} 🦊`);

  // ── Debug ─────────────────────────────────────────────────────────────────
  const debugEnabled = !!values.debug || process.env.KITSUNE_DEBUG === "1";
  initLogger(debugEnabled);
  if (debugEnabled) log.warn("Debug mode on — verbose JSON lines to stderr  (pipe: 2>&1 | jq)");
  dbg("main", "session start", { debugEnabled });

  // ── Parallel startup: deps + config + domain overrides ───────────────────
  const [deps, cfg, overrides] = await Promise.all([
    checkDeps(),
    loadConfig(),
    loadDomainOverrides(),
  ]);
  hasFzf = deps.fzf;
  config = cfg;
  applyDomainOverrides(overrides);

  isAnime = !!values.anime;
  currentSubLang = (values["sub-lang"] as string) ?? config.subLang;
  useHeadless = values["no-headless"] ? false : config.headless;

  // Anime mode defaults to the anime provider; normal mode to the regular provider.
  if (values.provider) {
    currentProvider = values.provider as string;
    isAnime = isAnime || getProvider(currentProvider).kind === "api";
  } else {
    currentProvider = isAnime ? config.animeProvider : config.provider;
  }

  // Validate — throws early with a clear message if ID is wrong.
  getProvider(currentProvider);

  const needsChromium = isPlaywright(getProvider(currentProvider));
  log.info(
    `${dim("Provider")} ${cyan(currentProvider)}` +
      (needsChromium ? "" : `  ${dim("(no browser needed)")}`) +
      `  ${dim("Subs")} ${cyan(currentSubLang)}` +
      (isAnime ? `  ${dim("Anime")} ${cyan(config.animeLang)}` : "") +
      `  ${dim("· [c] to change")}`,
  );

  // =============================================================================
  // 6. SEARCH + PLAYBACK LOOPS
  //
  // Outer loop  — re-runs search when [a] toggles anime/series mode.
  // Inner loop  — playback of the selected title; [a] breaks out to outer.
  // =============================================================================

  // Only honour --id / --search / --season / --episode on the first pass.
  let firstPass = true;

  while (true) {
    // ── Outer: search loop ──────────────────────────────────────

    // ── Search / direct ID ─────────────────────────────────────────────────────
    let picked: SearchResult | null = null;
    let apiPicked: ApiSearchResult | null = null;

    if (firstPass && values.id) {
      currentId = values.id as string;
      currentType = (values.type as "movie" | "series") ?? "series";
      currentTitle = (values.title as string) ?? "Unknown";
      picked = {
        id: currentId,
        type: currentType,
        title: currentTitle,
        year: "?",
        overview: "",
        posterPath: null,
      };
    } else {
      // ── Pre-search gate ──────────────────────────────────────────────────────
      // Show key hints and intercept [c]/[a]/[q] BEFORE the text() prompt
      // so those keys don't land in the search box.
      if (!(firstPass && values.search)) {
        let gating = true;
        while (gating) {
          const gateAction = await openHomeShell({
            mode: isAnime ? "anime" : "series",
            provider: currentProvider,
            subtitle: currentSubLang,
            animeLang: config.animeLang,
            status: statusForCurrentMode(),
          });

          if (gateAction === "quit") {
            outro("See you next time 🦊");
            process.exit(0);
          }
          if (gateAction === "toggle-mode") {
            isAnime = !isAnime;
            currentProvider = isAnime ? config.animeProvider : config.provider;
            prefetchedStream = null;
            log.info(`Switched to ${isAnime ? "🌸 anime" : "📺 series"} mode`);
          } else if (gateAction === "settings") {
            const updated = await openSettings(config);
            if (updated) {
              config = updated;
              currentProvider = isAnime ? updated.animeProvider : updated.provider;
              currentSubLang = updated.subLang;
              useHeadless = updated.headless;
              prefetchedStream = null;
            }
          } else {
            gating = false;
          }
        }
      }

      if (isAnime) {
        // ── Anime search (provider-native) ───────────────────────────────────────
        const rawQuery =
          (firstPass && (values.search as string)) ||
          (guard(
            await text({
              message: `Search ${isAnime ? "anime" : ""}:`,
              placeholder: isAnime ? "Demon Slayer" : "Breaking Bad",
            }),
          ) as string);

        const provider = getProvider(currentProvider);
        if (!isApi(provider)) throw new Error(`${currentProvider} is not an API provider`);

        const s = spinner();
        s.start(`Searching ${provider.name}…`);
        let animeResults: ApiSearchResult[] = [];
        try {
          animeResults = await provider.search(rawQuery, { animeLang: config.animeLang });
          s.stop(`${animeResults.length} results`);
        } catch {
          s.stop("Search failed.");
          log.error(`Could not reach ${provider.name}. Check your connection.`);
          process.exit(1);
        }

        if (animeResults.length === 0) {
          log.error("No results found.");
          process.exit(1);
        }

        const fmt = (r: ApiSearchResult) =>
          `${r.title}${r.epCount ? ` (${r.epCount} eps)` : ""}${r.year ? ` · ${r.year}` : ""}`;

        apiPicked = await pickWithFzf(animeResults, fmt, { prompt: "Select anime", hasFzf });
        if (!apiPicked) cancelAndExit();

        currentId = apiPicked.id;
        currentType = apiPicked.type;
        currentTitle = (firstPass && (values.title as string)) || apiPicked.title;
      } else {
        // ── TMDB search (videasy) ────────────────────────────────────────────────
        const rawQuery =
          (firstPass && (values.search as string)) ||
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

        if (results.length === 0) {
          log.error("No results found.");
          process.exit(1);
        }

        const fmt = (r: SearchResult) =>
          `${r.title} (${r.year}) — ${r.type === "series" ? "Series" : "Movie"}  [${r.overview}]`;

        picked = await pickWithFzf(results, fmt, { prompt: "Select title", hasFzf });
        if (!picked) cancelAndExit();

        currentId = picked.id;
        currentType = picked.type;
        currentTitle = (firstPass && (values.title as string)) || picked.title;
      }
    } // end else (gate + search)

    firstPass = false;

    // ── Show what was picked ────────────────────────────────────────────────────
    const typeIcon = currentType === "movie" ? "🎬" : isAnime ? "🌸" : "📺";
    const typeLabel = currentType === "movie" ? "Movie" : isAnime ? "Anime" : "Series";
    log.step(`${typeIcon}  ${bold(currentTitle)}  ${dim(`(${typeLabel} · ID ${currentId})`)}`);

    // ── Poster preview (Kitty / Ghostty) ───────────────────────────────────────
    if (picked?.posterPath && isKittyCompatible()) {
      await displayPoster(picked.posterPath);
    } else if (apiPicked?.posterUrl && isKittyCompatible()) {
      await displayPoster(apiPicked.posterUrl);
    }

    if (currentType === "series") {
      const history = await getHistory(currentId);
      if (history) log.info(describeHistoryEntry(history));

      const selection = await chooseStartingEpisode({
        currentId,
        hasFzf,
        isAnime,
        apiPicked,
        flags: {
          season: values.season as string | undefined,
          episode: values.episode as string | undefined,
        },
        getHistoryEntry: () => Promise.resolve(history),
      });

      currentSeason = selection.season;
      currentEpisode = selection.episode;
    } else {
      currentSeason = 1;
      currentEpisode = 1;
    }

    // ── Inner: playback loop ──────────────────────────────────────────────────
    let backToSearch = false;

    while (!backToSearch) {
      const provider = getProvider(currentProvider);

      process.stdout.write(
        "\n" +
          (currentType === "movie"
            ? `  🎬  ${bold(currentTitle)}  ${dim("[" + currentProvider + "]")}`
            : `  ${isAnime ? "🌸" : "📺"}  ${cyan(`S${String(currentSeason).padStart(2, "0")}E${String(currentEpisode).padStart(2, "0")}`)} — ${bold(currentTitle)}  ${dim("[" + currentProvider + "]")}`) +
          `  ${dim("· [c] settings · [a] switch mode · [q] quit")}\n`,
      );

      // Non-blocking key peek — settings / mode toggle / quit before scraping.
      {
        const k = await readPrePlaybackKey();
        if (k === "q" || k === "\x1b") {
          outro("See you next time 🦊");
          process.exit(0);
        }
        if (k === "a") {
          isAnime = !isAnime;
          currentProvider = isAnime ? config.animeProvider : config.provider;
          prefetchedStream = null;
          log.info(`Switched to ${isAnime ? "🌸 anime" : "📺 series"} mode`);
          backToSearch = true;
          break;
        }
        if (k === "c") {
          const updated = await openSettings(config);
          if (updated) {
            config = updated;
            currentProvider = isAnime ? updated.animeProvider : updated.provider;
            currentSubLang = updated.subLang;
            useHeadless = updated.headless;
            prefetchedStream = null;
          }
          continue;
        }
      }

      // ── Resolve stream ───────────────────────────────────────────────────────
      let streamInfo = await resolveStream();

      // ── Auto-fallback (Playwright providers only — same TMDB ID space) ──────
      if (!streamInfo && isPlaywright(provider)) {
        const fallback = PLAYWRIGHT_PROVIDERS.find((p) => p.id !== currentProvider);
        if (fallback) {
          log.warn(`${currentProvider} failed — trying ${fallback.id}…`);
          const fbUrl = buildUrl(fallback, currentId, currentType, currentSeason, currentEpisode);
          const s = spinner();
          s.start(`Scraping via ${fallback.id}…`);
          streamInfo = await scrapeStream(fallback, fbUrl, currentSubLang, useHeadless);
          s.stop(streamInfo ? `Got stream via ${fallback.id}.` : `${fallback.id} also failed.`);
        }
      }

      if (!streamInfo) {
        log.error(
          "Could not retrieve stream. The episode may not exist or the provider is blocked.",
        );
      } else {
        // ── Subtitles ──────────────────────────────────────────────────────────
        let finalSubtitle = streamInfo.subtitle;
        if (currentSubLang === "fzf" && streamInfo.subtitleList?.length) {
          log.info(`${streamInfo.subtitleList.length} subtitle tracks available`);
          finalSubtitle = await pickSubtitleWithFzf(streamInfo.subtitleList, { hasFzf });
        } else if (currentSubLang === "none") {
          finalSubtitle = null;
        }

        // ── Pre-fetch next episode (Playwright only) ────────────────────────────
        if (currentType === "series") startPrefetch();

        // ── Resume position ─────────────────────────────────────────────────────
        let startAt = 0;
        const hist = await getHistory(currentId);
        if (
          hist &&
          hist.season === currentSeason &&
          hist.episode === currentEpisode &&
          !isFinished(hist)
        ) {
          startAt = hist.timestamp;
          log.info(`Resuming from ${formatTimestamp(startAt)}`);
        }

        // ── Launch MPV ──────────────────────────────────────────────────────────
        const result = await launchMpv({
          url: streamInfo.url,
          headers: streamInfo.headers,
          subtitle: finalSubtitle,
          displayTitle: buildDisplayTitle(),
          startAt,
          autoNext: config.autoNext && currentType === "series",
          attach: !!values.attach,
        });

        // ── Persist history ─────────────────────────────────────────────────────
        if (result.watchedSeconds > 10) {
          const entry: HistoryEntry = {
            title: currentTitle,
            type: currentType,
            season: currentSeason,
            episode: currentEpisode,
            timestamp: result.watchedSeconds,
            duration: result.duration,
            provider: currentProvider,
            watchedAt: new Date().toISOString(),
          };
          await saveHistory(currentId, entry);
          const pct =
            result.duration > 0 ? Math.round((result.watchedSeconds / result.duration) * 100) : 0;
          log.success(
            `Saved position: ${yellow(formatTimestamp(result.watchedSeconds))} ${dim(`(${pct}%)`)}`,
          );
        }

        // ── Auto-advance (EOF → next episode) ───────────────────────────────────
        if (result.endReason === "eof" && config.autoNext && currentType === "series") {
          log.info(`Auto-advancing to ${cyan(`S${currentSeason}E${currentEpisode + 1}`)}…`);
          currentEpisode++;
          continue;
        }
      }

      // ── Post-playback menu ─────────────────────────────────────────────────────
      const postAction = await openPlaybackShell({
        type: currentType,
        title: currentTitle,
        season: currentSeason,
        episode: currentEpisode,
        provider: currentProvider,
        showMemory: config.showMemory,
        memoryUsage: config.showMemory ? formatMemoryUsage() : undefined,
        mode: isAnime ? "anime" : "series",
        status: {
          label: streamInfo ? "Ready for next action" : "Resolve failed",
          tone: streamInfo ? "success" : "warning",
        },
      });

      if (postAction === "quit") {
        outro("See you next time 🦊");
        process.exit(0);
      } else if (postAction === "toggle-mode") {
        isAnime = !isAnime;
        currentProvider = isAnime ? config.animeProvider : config.provider;
        prefetchedStream = null;
        log.info(`Switched to ${isAnime ? "🌸 anime" : "📺 series"} mode`);
        backToSearch = true;
      } else if (postAction === "settings") {
        const updated = await openSettings(config);
        if (updated) {
          const provChanged =
            updated.provider !== currentProvider || updated.animeProvider !== config.animeProvider;
          config = updated;
          currentProvider = isAnime ? updated.animeProvider : updated.provider;
          currentSubLang = updated.subLang;
          useHeadless = updated.headless;
          if (provChanged) prefetchedStream = null;
        }
      } else if (postAction === "replay") {
        // replay — loop restarts
      } else if (postAction === "next" && currentType === "series") {
        currentEpisode++;
      } else if (postAction === "previous" && currentType === "series") {
        prefetchedStream = null;
        if (currentEpisode > 1) currentEpisode--;
        else log.warn("Already at episode 1.");
      } else if (postAction === "next-season" && currentType === "series") {
        prefetchedStream = null;
        currentSeason++;
        currentEpisode = 1;
      } else if (postAction === "provider") {
        prefetchedStream = null;
        currentProvider = cycleProvider(currentProvider, isAnime);
        log.info(`Switched to ${green(currentProvider)}`);
      }
      // Any unrecognised key replays the current episode.
    } // end inner playback loop
  } // end outer search loop
})();
