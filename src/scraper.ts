import { chromium, type Browser, type Page } from "playwright";
import { fetchSubtitlesFromWyzie } from "./subtitle";
import type { StreamInfo, SubtitleEvidence } from "@/domain/types";
import { cacheStream } from "./cache";
import { dbg, dbgErr } from "./logger";
import { PLAYER_DOMAINS, type PlaywrightProvider } from "./providers";

// =============================================================================
// AD BLOCKLIST — aborted at the network layer via Playwright route().
// =============================================================================

const AD_DOMAINS = [
  "googlesyndication.com",
  "doubleclick.net",
  "adnxs.com",
  "adsrvr.org",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "amazon-adsystem.com",
  "moatads.com",
  "advertising.com",
  "media.net",
  "exoclick.com",
  "juicyads.com",
  "trafficjunky.com",
  "adsterra.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
];

function isAd(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return AD_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// =============================================================================
// TYPES
// =============================================================================

export type StreamData = {
  url: string;
  headers: Record<string, string>;
  subtitle: string | null;
  subtitleList: unknown[];
  subtitleSource: NonNullable<StreamInfo["subtitleSource"]>;
  subtitleEvidence: SubtitleEvidence;
  title: string;
  timestamp: number;
};

// =============================================================================
// TITLE EXTRACTION
//
// Each provider declares its preferred strategy. We execute it here so the
// scraper stays provider-agnostic — no if/else provider checks in the core.
// =============================================================================

async function extractTitle(page: Page, provider: PlaywrightProvider): Promise<string> {
  if (provider.titleSource === "selectors") {
    for (const sel of provider.titleSelectors ?? []) {
      const el = await page.$(sel).catch(() => null);
      const text = el ? (await el.innerText().catch(() => "")).trim() : "";
      if (text) return text;
    }
    // Fallback: page title (filter out the provider name)
    const pt = await page.title().catch(() => "");
    if (pt && pt.toLowerCase() !== provider.id) return pt;
    return "Unknown";
  }

  if (provider.titleSource === "og") {
    const og = await page
      .$eval(
        'meta[property="og:title"]',
        (el: any) => (el.content as string) ?? "", // eslint-disable-line @typescript-eslint/no-explicit-any
      )
      .catch(() => "");

    if (og && !new RegExp(`^${provider.id}$`, "i").test(og.trim())) {
      return (og.split(/\s*[-|–—·]\s*/)[0] ?? og).trim() || og.trim();
    }

    // OG missing or equal to provider name — fall back to page title
    const raw = await page.title().catch(() => "");
    if (raw) {
      return (
        raw
          .replace(/\bwatch\b/gi, "")
          .replace(new RegExp(`\\b${provider.id}\\b`, "gi"), "")
          .replace(/\s*[-|–—·]\s*/g, " ")
          .replace(/\s+/g, " ")
          .trim() || "Unknown"
      );
    }
    return "Unknown";
  }

  // "page-title" strategy
  const raw = await page.title().catch(() => "");
  return raw.trim() || "Unknown";
}

// =============================================================================
// SCRAPER
//
// Accepts a Provider object so all provider-specific behaviour (click, title
// extraction, popup detection) is driven by the registry, not inline checks.
// =============================================================================

export async function scrapeStream(
  provider: PlaywrightProvider,
  targetUrl: string,
  subLang: string,
  headless = true,
): Promise<StreamData | null> {
  dbg("scraper", "start", { provider: provider.id, targetUrl, subLang, headless });
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
      window.addEventListener("beforeunload", (e) => {
        e.preventDefault();
        e.returnValue = "";
      });
    });

    // Block ad/tracker domains at the network layer
    await context.route("**/*", (route) => {
      if (isAd(route.request().url())) return route.abort();
      return route.continue();
    });

    const page = await context.newPage();
    page.on("dialog", (d) => d.dismiss());

    let directSubUrl: string | null = null;
    let wyzieSearchUrl: string | null = null;
    let scrapedTitle = "Unknown";

    const streamData = await new Promise<StreamData | null>((resolve) => {
      let streamFound = false;

      const onRequest = (req: { url(): string; headers(): Record<string, string> }) => {
        const url = req.url();

        // Direct subtitle file (.vtt / .srt / wyzie CDN)
        if (
          !directSubUrl &&
          (url.includes(".vtt") || url.includes(".srt") || url.includes("sub.wyzie.io/c/")) &&
          !url.includes("search")
        ) {
          directSubUrl = url;
          dbg("scraper", "direct subtitle found", { url });
        }

        // Wyzie subtitle search — capture the full URL (contains embedded API key)
        if (!wyzieSearchUrl && url.includes("sub.wyzie.io/search")) {
          wyzieSearchUrl = url;
          dbg("scraper", "wyzie search URL captured", { url });
        }

        // m3u8 stream
        if (!streamFound && url.includes(".m3u8")) {
          streamFound = true;
          const streamUrl = url;
          const streamHeaders = req.headers();
          dbg("scraper", "m3u8 intercepted", { streamUrl });

          setTimeout(async () => {
            // Give wyzie an extra 1.5 s to fire if it hasn't yet
            if (!directSubUrl && !wyzieSearchUrl) {
              await new Promise((r) => setTimeout(r, 1500));
            }

            let subtitle: string | null = directSubUrl;
            let subtitleList: unknown[] = [];
            let subtitleSource: StreamData["subtitleSource"] = directSubUrl ? "direct" : "none";
            let subtitleReason: StreamData["subtitleEvidence"]["reason"] = directSubUrl
              ? "direct-file"
              : "not-observed";

            if (!subtitle && wyzieSearchUrl) {
              const result = await fetchSubtitlesFromWyzie(wyzieSearchUrl, subLang);
              subtitle = result.selected;
              subtitleList = result.list;
              subtitleSource = subtitle ? "wyzie" : "none";
              subtitleReason = subtitle
                ? "wyzie-selected"
                : result.failed
                  ? "wyzie-failed"
                  : "wyzie-empty";
            }

            const result = {
              url: streamUrl,
              headers: streamHeaders,
              subtitle,
              subtitleList,
              subtitleSource,
              subtitleEvidence: {
                directSubtitleObserved: Boolean(directSubUrl),
                wyzieSearchObserved: Boolean(wyzieSearchUrl),
                reason: subtitleReason,
              },
              title: scrapedTitle,
              timestamp: Date.now(),
            };
            dbg("scraper", "resolved", {
              subtitle,
              subtitleCount: subtitleList.length,
              subtitleSource,
              subtitleReason,
              directSubtitleObserved: Boolean(directSubUrl),
              wyzieSearchObserved: Boolean(wyzieSearchUrl),
            });
            resolve(result);
          }, 2000);
        }
      };

      page.on("request", onRequest);

      // Popup tab handling — allow player tabs, close everything else
      context.on("page", async (newPage) => {
        newPage.on("request", onRequest);
        newPage.on("dialog", (d) => d.dismiss());
        await newPage.waitForLoadState("domcontentloaded").catch(() => {});
        const pu = newPage.url();
        const isPlayer = PLAYER_DOMAINS.some((d) => pu.includes(d));
        if (!isPlayer && pu && pu !== "about:blank") {
          dbg("scraper", "closing ad popup", { url: pu });
          await newPage.close().catch(() => {});
        }
      });

      page
        .goto(targetUrl, { waitUntil: "domcontentloaded" })
        .then(async () => {
          try {
            await page.waitForTimeout(500);

            // Click only if the provider's player requires it
            if (provider.needsClick) await page.mouse.click(500, 500);

            // Title extraction is fully driven by the provider's declared strategy
            scrapedTitle = await extractTitle(page, provider);
            dbg("scraper", "title extracted", { scrapedTitle, strategy: provider.titleSource });
          } catch {}
        })
        .catch(() => {});

      // Hard 20-second timeout
      (async () => {
        for (let i = 0; i < 20; i++) {
          if (streamFound) return;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!streamFound) {
          dbg("scraper", "timeout — no stream found");
          resolve(null);
        }
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
