import { chromium, type Browser } from "playwright";
import { spawn } from "child_process";
import { appendFile, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { parseArgs } from "util";
import * as readline from "readline";

// =================================================================
// 1. CLI ARGUMENT PARSING
// =================================================================
const { values } = parseArgs({
  args: Bun.argv,
  options: {
    id: { type: "string" },
    title: { type: "string", default: "Unknown Show" },
    season: { type: "string", default: "1" },
    episode: { type: "string", default: "1" },
    provider: { type: "string", default: "cineby" }, // "cineby" or "vidking"
  },
  strict: true,
  allowPositionals: true,
});

if (!values.id) {
  console.error("❌ Error: You must provide a TMDB ID. Usage: bun run index.ts --id 127529");
  process.exit(1);
}

// Global State
let currentId = values.id;
let currentTitle = values.title as string;
let currentSeason = parseInt(values.season as string);
let currentEpisode = parseInt(values.episode as string);
let currentProvider = values.provider as string;

// =================================================================
// 2. IO & LOGGING MANAGER
// =================================================================
class IOManager {
  private static CACHE_FILE = "stream_cache.json";
  private static LOG_FILE = "logs.txt";
  private static CACHE_TTL = 1000 * 60 * 60; // 1 Hour

  static async getCachedStream(url: string): Promise<any> {
    if (!existsSync(this.CACHE_FILE)) return null;
    try {
      const cache = JSON.parse(await readFile(this.CACHE_FILE, "utf-8"));
      const entry = cache[url];
      if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
        return entry;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  static async saveCacheAndLog(
    targetUrl: string,
    streamUrl: string,
    headers: Record<string, string>,
    subtitle: string | null,
    title: string,
  ) {
    try {
      // 1. Write to Cache
      let cacheData: any = {};
      if (existsSync(this.CACHE_FILE))
        cacheData = JSON.parse(await readFile(this.CACHE_FILE, "utf-8"));
      cacheData[targetUrl] = { url: streamUrl, headers, subtitle, title, timestamp: Date.now() };
      await writeFile(this.CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf8");

      // 2. Append to Logs
      const logEntry = `\n=== Stream Log ===\nTime: ${new Date().toISOString()}\nTarget: ${targetUrl}\nStream: ${streamUrl}\nSubtitle: ${subtitle || "None"}\nScraped Title: ${title}\nHeaders:\n${JSON.stringify(headers, null, 2)}\n===================\n`;
      await appendFile(this.LOG_FILE, logEntry, "utf8");
    } catch (e) {
      console.error("[!] IO Error:", e);
    }
  }
}

// =================================================================
// 3. CORE LOGIC (Strictly separated Scraping and Playback)
// =================================================================

function buildUrl(provider: string, id: string, s: number, e: number) {
  if (provider === "vidking") return `https://www.vidking.net/embed/tv/${id}/${s}/${e}`;
  return `https://www.cineby.sc/tv/${id}/${s}/${e}?play=true`;
}

function launchMpv(
  url: string,
  headers: Record<string, string>,
  subtitle: string | null,
  scrapedTitle: string,
): Promise<void> {
  return new Promise((resolve) => {
    // If the user passed --title in CLI, use it. Otherwise, use the scraped title!
    const finalShowName = currentTitle !== "Unknown Show" ? currentTitle : scrapedTitle;
    const displayTitle = `${finalShowName} - Season ${currentSeason} Episode ${currentEpisode}`;

    console.log("\n=================================================");
    console.log(`🎉 LAUNCHING MPV: ${displayTitle}`);
    console.log("=================================================\n");

    const mpvArgs = [url];
    if (headers["referer"]) mpvArgs.push(`--referrer=${headers["referer"]}`);
    if (headers["user-agent"]) mpvArgs.push(`--user-agent=${headers["user-agent"]}`);
    if (headers["origin"]) mpvArgs.push(`--http-header-fields=Origin: ${headers["origin"]}`);
    if (subtitle) mpvArgs.push(`--sub-file=${subtitle}`);

    // Inject the clean title into MPV
    mpvArgs.push(`--force-media-title=${displayTitle}`);

    const mpv = spawn("mpv", mpvArgs, { stdio: "inherit" });

    mpv.on("close", () => {
      console.log(`\n[+] mpv playback finished.`);
      resolve();
    });

    mpv.on("error", (err) => {
      console.error("\n[!] Failed to launch mpv. Is it installed?", err.message);
      resolve();
    });
  });
}

// Scrape strictly returns the data, it does NOT trigger playback itself.
async function scrapeStream(targetUrl: string): Promise<any> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // @ts-ignore
      window.close = () => console.log("[X] Blocked window.close()");
      // @ts-ignore
      window.addEventListener("beforeunload", (e) => {
        e.preventDefault();
        e.returnValue = "Blocked";
      });
    });

    const page = await context.newPage();
    page.on("dialog", (dialog) => dialog.dismiss());

    let capturedSubtitleUrl: string | null = null;
    let scrapedTitle = "Unknown Show";

    // Use a Promise to completely pause until the stream and subtitles are caught
    const streamData: any = await new Promise((resolve) => {
      let streamFound = false;

      // 1. CATCH DIRECT URLS (Cineby & Standard files)
      page.on("request", (request) => {
        const url = request.url();

        // Catch direct Subtitles (Ignore the Vidking 'search' JSON endpoint here)
        if (
          (url.includes(".vtt") || url.includes(".srt") || url.includes("sub.wyzie.io/c/")) &&
          !url.includes("search")
        ) {
          if (!capturedSubtitleUrl) {
            console.log(`\n[💬 DIRECT SUBTITLE CAUGHT] URL: ${url}\n`);
            capturedSubtitleUrl = url;
          }
        }

        // Catch Master Stream
        if (url.includes(".m3u8") && !streamFound) {
          streamFound = true;
          console.log("[+] Master stream found! Waiting 1.5s for subtitles...");

          setTimeout(() => {
            resolve({
              url,
              headers: request.headers(),
              subtitle: capturedSubtitleUrl,
              title: scrapedTitle,
            });
          }, 1500);
        }
      });

      // 2. CATCH & PARSE JSON RESPONSES (Vidking Registry)
      page.on("response", async (response) => {
        const url = response.url();

        // When Vidking hits the subtitle API, we intercept the JSON answer
        if (url.includes("sub.wyzie.io/search")) {
          try {
            const json = await response.json();

            if (Array.isArray(json) && json.length > 0) {
              // Smart extract: Find the English sub, or default to index 0
              const englishSub = json.find((sub: any) => sub.language === "en") || json[0];

              if (!capturedSubtitleUrl && englishSub?.url) {
                capturedSubtitleUrl = englishSub.url;
                console.log(`\n[💬 VIDKING SUBTITLE PARSED] English URL: ${capturedSubtitleUrl}\n`);
              }
            }
          } catch (e) {
            // Ignore if the request aborted or wasn't valid JSON
          }
        }
      });

      console.log(`Navigating to: ${targetUrl}`);

      // Navigate and grab the title immediately after DOM loads
      page
        .goto(targetUrl, { waitUntil: "domcontentloaded" })
        .then(async () => {
          try {
            // Wait a tiny bit for React/Vue to mount the DOM components
            await page.waitForTimeout(500);

            if (targetUrl.includes("vidking.net")) {
              // Vidking injects the title into an H1 tag inside the player UI
              const h1Element = await page.$("h1");
              if (h1Element) {
                const textContent = await h1Element.innerText();
                if (textContent) {
                  scrapedTitle = textContent.trim() || "Unknown Show";
                  console.log(`[+] Scraped Vidking Title: ${scrapedTitle}`);
                }
              }
            } else {
              // Cineby sets the HTML <title> tag
              const rawTitle = await page.title();
              if (rawTitle) {
                scrapedTitle =
                  rawTitle
                    ?.replace(/watch/i, "") // 1. Remove the word "Watch"
                    ?.replace(/^[^a-zA-Z0-9]+/, "") // 2. Nuke leading symbols (removes the " / ")
                    ?.split(/[-|]/)[0] // 3. Cut off trailing garbage at dashes/pipes
                    ?.trim() || "Unknown Show";
                console.log(`[+] Scraped Cineby Title: ${scrapedTitle}`);
              }
            }
          } catch (e) {
            console.log("[!] Could not grab page title, using fallback.");
          }
        })
        .catch(() => {});

      // Custom timeout loop (20 seconds max)
      (async () => {
        for (let i = 0; i < 20; i++) {
          if (streamFound) return; // The setTimeout above will handle the resolution
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!streamFound) resolve(null); // Timeout hit
      })();
    });

    // Cleanup browser regardless of success/fail
    await browser.close().catch(() => {});

    if (streamData) {
      await IOManager.saveCacheAndLog(
        targetUrl,
        streamData.url,
        streamData.headers,
        streamData.subtitle,
        streamData.title,
      );
    }
    return streamData;
  } catch (error: any) {
    console.error(`\n❌ Scrape Error: ${error.message}`);
    await browser?.close().catch(() => {});
    return null;
  }
}

// =================================================================
// 4. THE INTERACTIVE PLAYBACK LOOP
// =================================================================

// Create a readline interface for async prompts (fixes the Ctrl+C bug)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

(async () => {
  // Graceful Shutdown Handler
  process.on("SIGINT", () => {
    console.log("\n\n[🛑] Received Ctrl+C. Shutting down StreamSnatcher cleanly... 🦊");
    rl.close();
    process.exit(0);
  });

  while (true) {
    const targetUrl = buildUrl(currentProvider, currentId, currentSeason, currentEpisode);
    console.log(
      `\n▶️ PREPARING: Season ${currentSeason}, Episode ${currentEpisode} [${currentProvider}]`,
    );

    // 1. Fetch data (either from Cache or Scraper)
    let streamInfo = await IOManager.getCachedStream(targetUrl);

    if (streamInfo) {
      console.log("[⚡ CACHE HIT] Valid stream found in cache. Bypassing scraper...");
    } else {
      streamInfo = await scrapeStream(targetUrl);
    }

    // 2. Play video if data was found
    if (streamInfo) {
      // The script will PAUSE right here until you physically close mpv
      await launchMpv(streamInfo.url, streamInfo.headers, streamInfo.subtitle, streamInfo.title);
    } else {
      console.log(
        "\n⚠️ Failed to retrieve episode. It might not exist yet or the provider blocked us.",
      );
    }

    // 3. Prompt user ONLY after playback ends or fails
    console.log("\n-------------------------------------------------");
    console.log("Options: [n]ext episode | [p]revious episode | [s]ext season | [q]uit");

    // Asynchronous prompt allows Ctrl+C to work perfectly
    const answer = await askQuestion("What next? ");
    const choice = answer.trim().toLowerCase();

    if (choice === "q" || choice === "quit") {
      console.log("Exiting StreamSnatcher. See you next time! 🦊");
      rl.close();
      process.exit(0);
    } else if (choice === "n") {
      currentEpisode++;
    } else if (choice === "p") {
      if (currentEpisode > 1) currentEpisode--;
      else console.log("Already at episode 1!");
    } else if (choice === "s") {
      currentSeason++;
      currentEpisode = 1;
    } else {
      console.log("Invalid choice, exiting.");
      rl.close();
      process.exit(0);
    }
  }
})();
