import { chromium, type Browser } from "playwright";
import { fetchSubtitlesFromWyzie } from "./subtitle";
import { cacheStream } from "./cache";
import { dbg, dbgErr } from "./logger";

// =============================================================================
// AD BLOCKLIST — aborted at the network layer via Playwright route().
// =============================================================================

const AD_DOMAINS = [
  "googlesyndication.com", "doubleclick.net", "adnxs.com", "adsrvr.org",
  "pubmatic.com", "rubiconproject.com", "openx.net", "criteo.com",
  "taboola.com", "outbrain.com", "amazon-adsystem.com", "moatads.com",
  "advertising.com", "media.net", "exoclick.com", "juicyads.com",
  "trafficjunky.com", "adsterra.com", "popads.net", "popcash.net",
  "propellerads.com",
];

function isAd(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return AD_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch { return false; }
}

// =============================================================================
// TYPES
// =============================================================================

export type StreamData = {
  url:          string;
  headers:      Record<string, string>;
  subtitle:     string | null;
  subtitleList: unknown[];
  title:        string;
  timestamp:    number;
};

// =============================================================================
// SCRAPER
//
// Launches a Playwright browser, navigates to the target URL, intercepts:
//   - .m3u8 stream URL + request headers
//   - wyzie subtitle search URL (captured from request, fetched independently)
//   - direct .vtt/.srt subtitle URLs
//
// Popup ad tabs are detected and closed. A 20-second hard timeout prevents
// hanging indefinitely if the provider doesn't emit a stream.
// =============================================================================

export async function scrapeStream(
  targetUrl: string,
  subLang:   string,
  headless = true,
): Promise<StreamData | null> {
  dbg("scraper", "start", { targetUrl, subLang, headless });
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();

    // Neutralize webdriver fingerprint and hostile window.close / beforeunload traps
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // @ts-ignore
      window.close = () => {};
      // @ts-ignore
      window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; });
    });

    // Block ad/tracker domains at the network layer
    await context.route("**/*", (route) => {
      if (isAd(route.request().url())) return route.abort();
      return route.continue();
    });

    const page = await context.newPage();
    page.on("dialog", (d) => d.dismiss());

    let directSubUrl:   string | null = null;
    let wyzieSearchUrl: string | null = null;
    let scrapedTitle = "Unknown";

    const streamData = await new Promise<StreamData | null>((resolve) => {
      let streamFound = false;

      const onRequest = (req: { url(): string; headers(): Record<string, string> }) => {
        const url = req.url();

        // Direct subtitle file (.vtt / .srt / wyzie CDN)
        if (!directSubUrl &&
            (url.includes(".vtt") || url.includes(".srt") || url.includes("sub.wyzie.io/c/")) &&
            !url.includes("search")) {
          directSubUrl = url;
        }

        // Wyzie subtitle search — capture the full URL (contains an embedded API key)
        if (!wyzieSearchUrl && url.includes("sub.wyzie.io/search")) {
          wyzieSearchUrl = url;
        }

        // m3u8 stream
        if (!streamFound && url.includes(".m3u8")) {
          streamFound = true;
          const streamUrl     = url;
          const streamHeaders = req.headers();
          dbg("scraper", "m3u8 intercepted", { streamUrl });

          setTimeout(async () => {
            // Give wyzie an extra 1.5 s to fire if it hasn't yet
            if (!directSubUrl && !wyzieSearchUrl) {
              await new Promise((r) => setTimeout(r, 1500));
            }

            let subtitle:     string | null = directSubUrl;
            let subtitleList: unknown[]     = [];

            if (!subtitle && wyzieSearchUrl) {
              const result = await fetchSubtitlesFromWyzie(wyzieSearchUrl, subLang);
              subtitle     = result.selected;
              subtitleList = result.list;
            }

            const result = {
              url: streamUrl,
              headers: streamHeaders,
              subtitle,
              subtitleList,
              title: scrapedTitle,
              timestamp: Date.now(),
            };
            dbg("scraper", "resolved", { subtitle, subtitleCount: subtitleList.length });
            resolve(result);
          }, 2000);
        }
      };

      page.on("request", onRequest);

      // Popup tab handling — attach request listeners, close non-player tabs
      context.on("page", async (newPage) => {
        newPage.on("request", onRequest);
        newPage.on("dialog", (d) => d.dismiss());
        await newPage.waitForLoadState("domcontentloaded").catch(() => {});
        const pu = newPage.url();
        const isPlayer = ["cineby", "vidking", "about:blank", "blob:"].some((d) => pu.includes(d));
        if (!isPlayer && pu && pu !== "about:blank") await newPage.close().catch(() => {});
      });

      const isVidking = targetUrl.includes("vidking.net");

      page.goto(targetUrl, { waitUntil: "domcontentloaded" })
        .then(async () => {
          try {
            await page.waitForTimeout(500);
            // Cineby's player is lazy and needs a click to start.
            // VidKing uses autoPlay=true, no click needed.
            if (!isVidking) await page.mouse.click(500, 500);

            // Title extraction
            if (isVidking) {
              for (const sel of ["h1", "h2", "[class*='title']", "[class*='name']"]) {
                const el   = await page.$(sel).catch(() => null);
                const text = el ? (await el.innerText().catch(() => "")).trim() : "";
                if (text) { scrapedTitle = text; break; }
              }
              if (scrapedTitle === "Unknown") {
                const pt = await page.title().catch(() => "");
                if (pt && pt.toLowerCase() !== "vidking") scrapedTitle = pt;
              }
            } else {
              // Cineby: OG meta title is the most reliable source
              const ogTitle = await page.$eval(
                'meta[property="og:title"]',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (el: any) => (el.content as string) ?? ""
              ).catch(() => "");

              if (ogTitle && !/^cineby$/i.test(ogTitle.trim())) {
                scrapedTitle = (ogTitle.split(/\s*[-|–—·]\s*/)[0] ?? ogTitle).trim() || ogTitle.trim();
              } else {
                const raw = await page.title().catch(() => "");
                if (raw) {
                  scrapedTitle = raw
                    .replace(/\bwatch\b/gi, "")
                    .replace(/\bcineby\b/gi, "")
                    .replace(/\s*[-|–—·]\s*/g, " ")
                    .replace(/\s+/g, " ")
                    .trim() || "Unknown";
                }
              }
            }
          } catch {}
        })
        .catch(() => {});

      // Hard 20-second timeout
      (async () => {
        for (let i = 0; i < 20; i++) {
          if (streamFound) return;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!streamFound) resolve(null);
      })();
    });

    await browser.close().catch(() => {});

    if (streamData) await cacheStream(targetUrl, streamData);

    return streamData;
  } catch (e: unknown) {
    dbgErr("scraper", "uncaught error", e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n❌ Scrape error: ${msg}`);
    await browser?.close().catch(() => {});
    return null;
  }
}
