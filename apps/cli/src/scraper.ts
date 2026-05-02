import type { StreamInfo, SubtitleEvidence } from "@/domain/types";
import { dbg, dbgErr } from "@/logger";
import { parseWyzieSubtitleList, selectSubtitle, type SubtitleEntry } from "@/subtitle";
import { chromium, type Browser, type Page, type Response } from "playwright";

// =============================================================================
// TYPES
// =============================================================================

export interface ScrapeConfig {
  id: string;
  needsClick: boolean;
  titleSource: "selectors" | "og" | "page-title";
  readonly titleSelectors?: readonly string[];
  readonly playerDomains?: readonly string[];
}

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
// TITLE EXTRACTION
//
// Each provider declares its preferred strategy. We execute it here so the
// scraper stays provider-agnostic — no if/else provider checks in the core.
// =============================================================================

async function extractTitle(page: Page, config: ScrapeConfig): Promise<string> {
  if (config.titleSource === "selectors") {
    for (const sel of config.titleSelectors ?? []) {
      const el = await page.$(sel).catch(() => null);
      const text = el ? (await el.innerText().catch(() => "")).trim() : "";
      if (text) return text;
    }
    // Fallback: page title (filter out the provider name)
    const pt = await page.title().catch(() => "");
    if (pt && pt.toLowerCase() !== config.id) return pt;
    return "Unknown";
  }

  if (config.titleSource === "og") {
    const og = await page
      .$eval(
        'meta[property="og:title"]',
        (el: any) => (el.content as string) ?? "", // eslint-disable-line @typescript-eslint/no-explicit-any
      )
      .catch(() => "");

    if (og && !new RegExp(`^${config.id}$`, "i").test(og.trim())) {
      return (og.split(/\s*[-|–—·]\s*/)[0] ?? og).trim() || og.trim();
    }

    // OG missing or equal to provider name — fall back to page title
    const raw = await page.title().catch(() => "");
    if (raw) {
      return (
        raw
          .replace(/\bwatch\b/gi, "")
          .replace(new RegExp(`\\b${config.id}\\b`, "gi"), "")
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
// Accepts a ScrapeConfig object so all provider-specific behaviour (click, title
// extraction, popup detection) is driven by the registry, not inline checks.
// =============================================================================

export async function scrapeStream(
  config: ScrapeConfig,
  targetUrl: string,
  subLang: string,
  headless = true,
): Promise<StreamData | null> {
  dbg("scraper", "start", { provider: config.id, targetUrl, subLang, headless });
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
    let wyzieBrowserList: SubtitleEntry[] | null = null;
    let scrapedTitle = "Unknown";

    const streamData = await new Promise<StreamData | null>((resolve) => {
      let streamFound = false;

      const onResponse = async (response: Response) => {
        const url = response.url();
        if (!url.includes("sub.wyzie.io/search")) return;

        try {
          const status = response.status();
          dbg("scraper", "wyzie browser response", {
            status,
            ok: response.ok(),
            contentType: response.headers()["content-type"] ?? null,
          });

          if (!response.ok()) {
            return;
          }

          const payload = JSON.parse(await response.text()) as unknown;
          wyzieBrowserList = parseWyzieSubtitleList(payload);
          dbg("scraper", "wyzie browser subtitles parsed", {
            subtitleCount: wyzieBrowserList.length,
          });
        } catch (error) {
          dbgErr("scraper", "wyzie browser response parse failed", error);
        }
      };

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
          dbg("scraper", "wyzie search URL captured", {
            url,
            headerKeys: Object.keys(req.headers()),
          });
        }

        // m3u8 stream
        if (!streamFound && url.includes(".m3u8")) {
          streamFound = true;
          const streamUrl = url;
          const streamHeaders = req.headers();
          dbg("scraper", "m3u8 intercepted", { streamUrl });

          const browserPick = wyzieBrowserList ? selectSubtitle(wyzieBrowserList, subLang) : null;
          const subtitle = directSubUrl ?? browserPick?.url ?? null;
          const subtitleList: unknown[] = wyzieBrowserList ?? [];
          const subtitleSource: StreamData["subtitleSource"] = directSubUrl
            ? "direct"
            : subtitle
              ? "wyzie"
              : "none";
          const subtitleReason: StreamData["subtitleEvidence"]["reason"] = directSubUrl
            ? "direct-file"
            : subtitle
              ? "wyzie-selected"
              : wyzieSearchUrl
                ? "search-observed"
                : "not-observed";

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
        }
      };

      page.on("request", onRequest);
      page.on("response", onResponse);

      // Popup tab handling — allow player tabs, close everything else
      context.on("page", async (newPage) => {
        newPage.on("request", onRequest);
        newPage.on("response", onResponse);
        newPage.on("dialog", (d) => d.dismiss());
        await newPage.waitForLoadState("domcontentloaded").catch(() => {});
        let pu = "about:blank";
        try {
          pu = newPage.url();
        } catch {
          // target closed before we could read url
        }
        const playerDomains = config.playerDomains ?? [];
        const isPlayer =
          playerDomains.some((d) => pu.includes(d)) ||
          ["about:blank", "blob:"].some((d) => pu.includes(d));
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
            if (config.needsClick) await page.mouse.click(500, 500);

            // Title extraction is fully driven by the provider's declared strategy
            scrapedTitle = await extractTitle(page, config);
            dbg("scraper", "title extracted", { scrapedTitle, strategy: config.titleSource });
          } catch {}
        })
        .catch(() => {});

      // Hard 20-second timeout
      (async () => {
        for (let i = 0; i < 20; i++) {
          if (streamFound) return;
          await Bun.sleep(1000);
        }
        if (!streamFound) {
          dbg("scraper", "timeout — no stream found");
          resolve(null);
        }
      })();
    });

    await browser.close().catch(() => {});
    return streamData;
  } catch (e: unknown) {
    dbgErr("scraper", "uncaught error", e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n❌ Scrape error: ${msg}`);
    await browser?.close().catch(() => {});
    return null;
  }
}
