/**
 * AnimeKai legacy analyzer
 *
 * This is not a production scraper. It is a reverse-engineering helper for
 * figuring out:
 * - whether search can be done without Playwright
 * - which watch-page values are already present in server-rendered HTML
 * - which network requests fire when the user changes episode / server / language
 * - which DOM fragments contain the provider + sub/dub metadata we care about
 *
 * Default workflow:
 *   1. Fetch the raw search + watch HTML and extract obvious data.
 *   2. Launch a visible browser on the watch page.
 *   3. Let the user click around manually while we log:
 *      - clicks
 *      - requests / responses
 *      - iframe URLs
 *      - snapshots of #player-server and related watch DOM
 *   4. Write everything to legacy/anikai-findings.json
 *
 * Usage:
 *   bun legacy/anikai.ts
 *   bun legacy/anikai.ts "one piece" one-piece-dk6r 1
 *   bun legacy/anikai.ts "naruto" naruto-9r5k 3 --timeout=180
 *   bun legacy/anikai.ts --help
 */

import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import { writeFile } from "fs/promises";
import { resolve } from "path";

const HELP = `
Usage:
  bun legacy/anikai.ts [searchQuery] [slug] [episode] [--timeout=seconds]

Examples:
  bun legacy/anikai.ts
  bun legacy/anikai.ts "one piece" one-piece-dk6r 1
  bun legacy/anikai.ts "naruto" naruto-9r5k 3 --timeout=180

What it does:
  - fetches raw HTML for /browser and /watch
  - extracts server-rendered search/watch hints
  - opens the watch page in a visible browser
  - records your clicks, network requests, iframe URLs, and player DOM snapshots
  - saves a structured report to legacy/anikai-findings.json

Interactive flow:
  - click Play
  - switch Soft Sub / Hard Sub / Dub
  - switch Server 1 / Server 2 / any other provider buttons
  - switch episodes if useful
  - close the browser window when done, or wait for the timeout
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const positional = args.filter((arg) => !arg.startsWith("--"));
const searchQuery = positional[0] ?? "one piece";
const animeSlug = positional[1] ?? "one-piece-dk6r";
const episode = positional[2] ?? "1";
const timeoutFlag = args.find((arg) => arg.startsWith("--timeout="));
const interactiveSeconds = Number(timeoutFlag?.slice("--timeout=".length) ?? "240");

const outFile = resolve(import.meta.dir, "anikai-findings.json");
const browserUrl = `https://anikai.to/browser?keyword=${encodeURIComponent(searchQuery)}`;
const watchUrl = `https://anikai.to/watch/${animeSlug}#ep=${episode}`;
const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface SearchResultLink {
  href: string;
  title: string | null;
}

interface StaticSearchSummary {
  url: string;
  searchFormAction: string | null;
  suggestionContainerPresent: boolean;
  resultLinks: SearchResultLink[];
  totalResultLinks: number;
  pageLinks: string[];
  rawHtmlSnippet: string;
}

interface StaticWatchSummary {
  url: string;
  watchPageDataset: Record<string, string>;
  syncData: Json | null;
  playerServerHtml: string | null;
  playerControlLabels: string[];
  rawWatchIndicators: {
    hasPlayerServer: boolean;
    hasEpisodeSection: boolean;
    hasPlayButton: boolean;
    hasDubBadge: boolean;
    hasSubBadge: boolean;
  };
  rawHtmlSnippet: string;
}

interface ClickRecord {
  at: string;
  text: string | null;
  href: string | null;
  tagName: string | null;
  id: string | null;
  className: string | null;
  role: string | null;
  path: string[];
  outerHtmlSnippet: string | null;
}

interface DomSnapshot {
  at: string;
  reason: string;
  locationHref: string;
  playerServerHtml: string | null;
  playerServerText: string | null;
  playerHtml: string | null;
  playerIframeUrls: string[];
  episodeText: string | null;
  watchPageData: Record<string, string>;
  activeServerLikeButtons: Array<{
    text: string;
    className: string;
    dataAttrs: Record<string, string>;
  }>;
}

interface NetworkRecord {
  at: string;
  phase: string;
  method: string;
  url: string;
  resourceType: string;
  status: number | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  postData: string | null;
  responseBodySnippet: string | null;
}

interface Findings {
  meta: {
    capturedAt: string;
    searchQuery: string;
    animeSlug: string;
    episode: string;
    browserUrl: string;
    watchUrl: string;
    interactiveSeconds: number;
  };
  staticSearch: StaticSearchSummary | null;
  staticWatch: StaticWatchSummary | null;
  clicks: ClickRecord[];
  domSnapshots: DomSnapshot[];
  network: {
    search: NetworkRecord[];
    watch: NetworkRecord[];
    interactions: NetworkRecord[];
  };
  iframes: Array<{ at: string; url: string }>;
  notes: string[];
}

const findings: Findings = {
  meta: {
    capturedAt: new Date().toISOString(),
    searchQuery,
    animeSlug,
    episode,
    browserUrl,
    watchUrl,
    interactiveSeconds,
  },
  staticSearch: null,
  staticWatch: null,
  clicks: [],
  domSnapshots: [],
  network: {
    search: [],
    watch: [],
    interactions: [],
  },
  iframes: [],
  notes: [],
};

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

function clip(value: string | null | undefined, max = 1200): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function pickHeaders(headers: Record<string, string>): Record<string, string> {
  const wanted = [
    "accept",
    "content-type",
    "referer",
    "origin",
    "x-requested-with",
    "authorization",
    "location",
    "set-cookie",
  ];

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (wanted.includes(key.toLowerCase())) result[key] = value;
  }
  return result;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&#47;/g, "/");
}

function stripTags(value: string): string {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function matchFirst(source: string, regex: RegExp): string | null {
  const match = source.match(regex);
  return match?.[1] ?? null;
}

function matchAll(source: string, regex: RegExp): string[] {
  return Array.from(source.matchAll(regex), (match) => match[1]).filter(Boolean);
}

function parseAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of raw.matchAll(/([:@\w-]+)\s*=\s*["']([^"']*)["']/g)) {
    out[match[1]] = decodeHtml(match[2]);
  }
  return out;
}

function extractDatasetFromTag(source: string, tagPattern: RegExp): Record<string, string> {
  const rawTag = matchFirst(source, tagPattern);
  if (!rawTag) return {};

  const attrs = parseAttributes(rawTag);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("data-")) {
      const camelKey = key
        .slice(5)
        .replace(/-([a-z])/g, (_all, char: string) => char.toUpperCase());
      out[camelKey] = value;
    }
  }
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseStaticSearch(html: string): StaticSearchSummary {
  const seen = new Set<string>();
  const resultLinks: SearchResultLink[] = [];

  for (const match of html.matchAll(/<a\b([^>]*href=["']([^"']*\/watch\/[^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttributes(match[1]);
    const href = attrs.href;
    if (!href || seen.has(href)) continue;
    seen.add(href);

    resultLinks.push({
      href,
      title: attrs.title?.trim() || stripTags(match[3]) || null,
    });

    if (resultLinks.length >= 80) break;
  }

  const pageLinks = matchAll(
    html,
    /<a\b[^>]*class=["'][^"']*\bpage-link\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi
  );

  return {
    url: browserUrl,
    searchFormAction: matchFirst(html, /<form\b[^>]*action=["']([^"']+)["'][^>]*>/i),
    suggestionContainerPresent: /<div\b[^>]*class=["'][^"']*\bsuggestion\b[^"']*["'][^>]*>/i.test(html),
    resultLinks,
    totalResultLinks: resultLinks.length,
    pageLinks,
    rawHtmlSnippet: clip(html, 2000) ?? "",
  };
}

function parseJsonScript(raw: string | null): Json | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Json;
  } catch {
    return raw;
  }
}

function parseStaticWatch(html: string): StaticWatchSummary {
  const syncData = matchFirst(
    html,
    /<script\b[^>]*id=["']syncData["'][^>]*>([\s\S]*?)<\/script>/i
  );
  const playerServerHtml = matchFirst(
    html,
    /<div\b[^>]*id=["']player-server["'][^>]*>([\s\S]*?)<\/div>/i
  );
  const playerControlLabels = Array.from(
    html.matchAll(
      /<div\b[^>]*id=["']player-control["'][\s\S]*?<span>([\s\S]*?)<\/span>/gi
    ),
    (match) => stripTags(match[1])
  ).filter(Boolean);

  return {
    url: watchUrl,
    watchPageDataset: extractDatasetFromTag(
      html,
      /(<div\b[^>]*id=["']watch-page["'][^>]*>)/i
    ),
    syncData: parseJsonScript(syncData),
    playerServerHtml: clip(playerServerHtml, 2000),
    playerControlLabels,
    rawWatchIndicators: {
      hasPlayerServer: /id=["']player-server["']/i.test(html),
      hasEpisodeSection: /class=["'][^"']*\bepisode-section\b/i.test(html),
      hasPlayButton: /id=["']player["'][\s\S]*class=["'][^"']*\bplay-btn\b/i.test(html),
      hasDubBadge: /class=["'][^"']*\bdub\b/i.test(html),
      hasSubBadge: /class=["'][^"']*\bsub\b/i.test(html),
    },
    rawHtmlSnippet: clip(html, 2500) ?? "",
  };
}

async function captureResponseBody(response: Response): Promise<string | null> {
  const headers = response.headers();
  const contentType = (headers["content-type"] ?? "").toLowerCase();
  const isTextLike =
    contentType.includes("json") ||
    contentType.includes("text") ||
    contentType.includes("javascript") ||
    contentType.includes("html") ||
    contentType.includes("xml") ||
    response.url().includes(".m3u8");

  if (!isTextLike) return null;

  try {
    return clip(await response.text(), 2000);
  } catch {
    return null;
  }
}

async function toNetworkRecord(phase: string, response: Response): Promise<NetworkRecord> {
  const request = response.request();
  return {
    at: new Date().toISOString(),
    phase,
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
    status: response.status(),
    requestHeaders: pickHeaders(request.headers()),
    responseHeaders: pickHeaders(response.headers()),
    postData: clip(request.postData(), 1500),
    responseBodySnippet: await captureResponseBody(response),
  };
}

function isInterestingUrl(url: string): boolean {
  if (url.startsWith("data:")) return false;
  if (/\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|css)(\?|$)/i.test(url)) return false;
  return true;
}

function classifyPhase(url: string, currentPhase: "search" | "watch" | "interactions"): keyof Findings["network"] {
  if (url.includes("/browser")) return "search";
  if (currentPhase === "interactions") return "interactions";
  if (url.includes("/watch/")) return "watch";
  if (
    url.includes("iframe") ||
    url.includes("embed") ||
    url.includes(".m3u8") ||
    url.includes("playlist") ||
    url.includes("/ajax/") ||
    url.includes("/api/")
  ) {
    return "interactions";
  }
  return currentPhase;
}

async function snapshotDom(page: Page, reason: string) {
  const snapshot = await page.evaluate((why) => {
    const watchPage = document.querySelector("#watch-page") as HTMLElement | null;
    const playerServer = document.querySelector("#player-server") as HTMLElement | null;
    const player = document.querySelector("#player") as HTMLElement | null;
    const episodeSection = document.querySelector(".episode-section") as HTMLElement | null;
    const buttonCandidates = Array.from(
      document.querySelectorAll("button, [role='button'], .btn, .tab, [data-value], [data-id], [data-server]")
    ) as HTMLElement[];

    const activeServerLikeButtons = buttonCandidates
      .map((element) => ({
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
        className: element.className ?? "",
        dataAttrs: Object.fromEntries(
          Object.entries(element.dataset).filter(([, value]) => typeof value === "string")
        ),
      }))
      .filter((entry) => {
        const haystack = `${entry.text} ${entry.className} ${Object.values(entry.dataAttrs).join(" ")}`.toLowerCase();
        return (
          haystack.includes("server") ||
          haystack.includes("soft") ||
          haystack.includes("hard") ||
          haystack.includes("dub") ||
          haystack.includes("sub")
        );
      })
      .slice(0, 40);

    const iframeUrls = Array.from(document.querySelectorAll("iframe"))
      .map((iframe) => iframe.getAttribute("src") || iframe.getAttribute("data-src") || "")
      .filter(Boolean);

    return {
      at: new Date().toISOString(),
      reason: why,
      locationHref: location.href,
      playerServerHtml: playerServer?.innerHTML ?? null,
      playerServerText: playerServer?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      playerHtml: player?.innerHTML ?? null,
      playerIframeUrls: iframeUrls,
      episodeText: episodeSection?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      watchPageData: watchPage ? Object.fromEntries(Object.entries(watchPage.dataset)) : {},
      activeServerLikeButtons,
    };
  }, reason);

  findings.domSnapshots.push({
    at: snapshot.at,
    reason: snapshot.reason,
    locationHref: snapshot.locationHref,
    playerServerHtml: clip(snapshot.playerServerHtml, 2400),
    playerServerText: clip(snapshot.playerServerText, 800),
    playerHtml: clip(snapshot.playerHtml, 2000),
    playerIframeUrls: snapshot.playerIframeUrls,
    episodeText: clip(snapshot.episodeText, 1200),
    watchPageData: snapshot.watchPageData,
    activeServerLikeButtons: snapshot.activeServerLikeButtons,
  });
}

async function attachNetworkLogging(context: BrowserContext) {
  let currentPhase: "search" | "watch" | "interactions" = "search";

  context.on("page", (page) => {
    page.on("response", async (response) => {
      const url = response.url();
      if (!isInterestingUrl(url)) return;

      const bucket = classifyPhase(url, currentPhase);
      const record = await toNetworkRecord(currentPhase, response);
      findings.network[bucket].push(record);

      const lower = url.toLowerCase();
      if (
        lower.includes(".m3u8") ||
        lower.includes("embed") ||
        lower.includes("iframe") ||
        lower.includes("playlist")
      ) {
        findings.notes.push(`[${record.at}] interesting response: ${response.status()} ${url}`);
      }
    });

    page.on("framenavigated", (frame) => {
      const url = frame.url();
      if (!url || url === "about:blank" || url.startsWith("data:")) return;
      findings.iframes.push({ at: new Date().toISOString(), url });
    });

    page.on("load", async () => {
      if (page.url().includes("/watch/")) {
        currentPhase = "watch";
        await snapshotDom(page, "page-load");
      }
    });
  });

  return {
    setPhase(phase: "search" | "watch" | "interactions") {
      currentPhase = phase;
    },
  };
}

async function installClickProbe(page: Page) {
  await page.exposeBinding("anikaiRecordClick", (_source, payload: ClickRecord) => {
    findings.clicks.push(payload);
    findings.notes.push(`[${payload.at}] click: ${payload.text ?? "<no text>"} ${payload.href ?? ""}`.trim());
  });

  await page.addInitScript(() => {
    const describe = (element: Element | null): string | null => {
      if (!element) return null;
      const bits: string[] = [element.tagName.toLowerCase()];
      const htmlEl = element as HTMLElement;
      if (htmlEl.id) bits.push(`#${htmlEl.id}`);
      const classes = Array.from(element.classList).slice(0, 3);
      if (classes.length) bits.push(`.${classes.join(".")}`);
      return bits.join("");
    };

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const chain = event.composedPath().filter((node): node is Element => node instanceof Element);
        const clickable =
          target?.closest("button, a, [role='button'], .btn, .tab, [data-id], [data-value], [data-server]") ?? target;

        const payload = {
          at: new Date().toISOString(),
          text: clickable?.textContent?.replace(/\s+/g, " ").trim() || null,
          href: clickable instanceof HTMLAnchorElement ? clickable.href : clickable?.getAttribute("href") || null,
          tagName: clickable?.tagName ?? null,
          id: clickable?.id ?? null,
          className: clickable?.className ?? null,
          role: clickable?.getAttribute("role") ?? null,
          path: chain.map((node) => describe(node)).filter(Boolean) as string[],
          outerHtmlSnippet: clickable?.outerHTML?.slice(0, 1200) ?? null,
        };

        queueMicrotask(() => {
          void (window as typeof window & { anikaiRecordClick?: (payload: unknown) => Promise<void> })
            .anikaiRecordClick?.(payload);
        });
      },
      true
    );
  });
}

async function runInteractiveCapture(context: BrowserContext) {
  const page = await context.newPage();
  await installClickProbe(page);

  log(`[*] Opening watch page: ${watchUrl}`);
  await page.goto(watchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await snapshotDom(page, "initial-watch");

  log("");
  log("[*] Manual capture is live.");
  log("[*] Recommended click path:");
  log("    1. Click Play");
  log("    2. Click Soft Sub / Hard Sub / Dub");
  log("    3. Click each server button that appears");
  log("    4. Switch episode if the page exposes episode rows");
  log("    5. Close the browser window when finished");
  log("");

  const begin = Date.now();
  while (!page.isClosed() && Date.now() - begin < interactiveSeconds * 1000) {
    const clickCountBefore = findings.clicks.length;
    await page.waitForTimeout(1200);

    if (page.isClosed()) break;

    if (findings.clicks.length !== clickCountBefore) {
      await snapshotDom(page, "post-click");
    }
  }

  if (!page.isClosed()) {
    findings.notes.push(
      `[${new Date().toISOString()}] interactive timeout reached after ${interactiveSeconds} seconds`
    );
    await snapshotDom(page, "timeout-final");
    await page.close();
  }
}

async function main() {
  log("[*] Fetching raw search HTML...");
  const searchHtml = await fetchHtml(browserUrl);
  findings.staticSearch = parseStaticSearch(searchHtml);
  findings.notes.push(
    `Search appears server-rendered via ${findings.staticSearch.searchFormAction ?? "/browser"} with ${findings.staticSearch.totalResultLinks} result links parsed from HTML.`
  );

  log("[*] Fetching raw watch HTML...");
  const watchHtml = await fetchHtml(watchUrl);
  findings.staticWatch = parseStaticWatch(watchHtml);

  if (findings.staticWatch.watchPageDataset.meta) {
    findings.notes.push("Watch page exposes #watch-page[data-meta], which is likely important for later internal requests.");
  }
  if (findings.staticWatch.syncData) {
    findings.notes.push("Watch page exposes #syncData JSON, which includes anime_id and current episode.");
  }

  log("[*] Launching browser...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1440, height: 960 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const tracker = await attachNetworkLogging(context);
  tracker.setPhase("watch");

  try {
    await runInteractiveCapture(context);
  } finally {
    await context.close();
    await browser.close();
  }

  const summary = {
    meta: findings.meta,
    counts: {
      searchResultsParsed: findings.staticSearch?.totalResultLinks ?? 0,
      clicks: findings.clicks.length,
      domSnapshots: findings.domSnapshots.length,
      networkSearch: findings.network.search.length,
      networkWatch: findings.network.watch.length,
      networkInteractions: findings.network.interactions.length,
      iframes: findings.iframes.length,
    },
    findings,
  };

  await writeFile(outFile, JSON.stringify(summary, null, 2), "utf8");

  log("");
  log(`[✓] Wrote findings to ${outFile}`);
  log(`[✓] Clicks: ${summary.counts.clicks}`);
  log(`[✓] DOM snapshots: ${summary.counts.domSnapshots}`);
  log(`[✓] Network responses: ${summary.counts.networkSearch + summary.counts.networkWatch + summary.counts.networkInteractions}`);
}

await main().catch(async (error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  findings.notes.push(`Fatal error: ${message}`);
  await writeFile(
    outFile,
    JSON.stringify(
      {
        meta: findings.meta,
        error: message,
        findings,
      },
      null,
      2
    ),
    "utf8"
  ).catch(() => {});
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
