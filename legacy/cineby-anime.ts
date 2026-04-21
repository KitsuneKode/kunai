import { chromium } from "playwright";
import { spawn } from "child_process";
import { appendFile } from "fs/promises";
import { createInterface } from "readline";

const SEARCH_API = "https://anime-db.videasy.net/api/v2/hianime/search";

const query = process.argv[2];
if (!query) {
  console.error("Usage: bun legacy/cineby-anime.ts <search query>");
  process.exit(1);
}

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function searchAnime(q: string): Promise<{ id: string; title: string; slug: string }[]> {
  const url = `${SEARCH_API}?q=${encodeURIComponent(q)}&page=1`;
  console.log(`[*] Searching: ${url}`);
  const res = await fetch(url);
  const data = await res.json();

  // hianime search response: data.results or data.animes
  const list = data?.data?.animes ?? data?.results ?? data?.animes ?? [];
  return list.map((a: any) => ({
    id: a.id ?? a.animeId ?? "",
    title: a.name ?? a.title ?? a.english ?? a.romaji ?? a.id,
    slug: a.id ?? "",
  }));
}

(async () => {
  const results = await searchAnime(query);

  if (!results.length) {
    console.error("[!] No results found.");
    process.exit(1);
  }

  results.slice(0, 10).forEach((r, i) => console.log(`  [${i + 1}] ${r.title}  (id: ${r.id})`));

  const pick = parseInt(await ask("\nPick anime [1]: ") || "1") - 1;
  const anime = results[pick];
  if (!anime) {
    console.error("[!] Invalid pick.");
    process.exit(1);
  }

  const epInput = await ask("Episode number (leave blank for 1): ");
  const episode = epInput ? parseInt(epInput) : 1;

  // cineby anime URL — episode as query param
  const pageUrl = `https://www.cineby.sc/anime/${anime.slug}?episode=${episode}&play=true`;
  console.log(`\n[*] Opening: ${pageUrl}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // @ts-ignore
    window.close = () => console.log("[X] Blocked window.close()");
  });

  let streamFound = false;
  let capturedSubtitleUrl: string | null = null;

  const logStream = async (url: string, headers: Record<string, string>, subUrl: string | null) => {
    const entry = `\n=== Anime Stream Log ===\nTimestamp: ${new Date().toISOString()}\nAnime: ${anime.title} — ep${episode}\nURL: ${url}\nSubtitle: ${subUrl || "None"}\nHeaders:\n${JSON.stringify(headers, null, 2)}\n===================\n`;
    await appendFile("logs.txt", entry, "utf8").catch(() => {});
  };

  const launchMpv = async (url: string, headers: Record<string, string>) => {
    await logStream(url, headers, capturedSubtitleUrl);

    console.log("\n=================================================");
    console.log("STREAM FOUND. LAUNCHING MPV...");
    console.log("=================================================\n");

    const mpvArgs = [url];
    if (headers["referer"]) mpvArgs.push(`--referrer=${headers["referer"]}`);
    if (headers["user-agent"]) mpvArgs.push(`--user-agent=${headers["user-agent"]}`);
    if (headers["origin"]) mpvArgs.push(`--http-header-fields=Origin: ${headers["origin"]}`);
    if (capturedSubtitleUrl) {
      console.log(`[+] Subtitle: ${capturedSubtitleUrl}`);
      mpvArgs.push(`--sub-file=${capturedSubtitleUrl}`);
    }

    await browser.close().catch(() => {});
    const mpv = spawn("mpv", mpvArgs, { stdio: "inherit" });
    mpv.on("close", () => process.exit(0));
  };

  const checkRequest = (request: any) => {
    const url = request.url();

    if (url.includes(".vtt") || url.includes(".srt") || url.includes("sub.wyzie.io")) {
      if (!capturedSubtitleUrl) {
        console.log(`[SUBTITLE] ${url}`);
        capturedSubtitleUrl = url;
      }
    }

    if (url.includes(".m3u8") && !streamFound) {
      streamFound = true;
      // Snapshot headers immediately — request object may be stale after setTimeout delay
      const headers = request.headers();
      console.log("[+] Stream found! Waiting 1.5s for subtitles...");
      setTimeout(() => launchMpv(url, headers).catch(console.error), 1500);
    }
  };

  context.on("page", (newPage) => {
    console.log(`[!] Popup: ${newPage.url()}`);
    newPage.on("request", checkRequest);
  });

  const page = await context.newPage();
  page.on("request", checkRequest);

  try {
    // networkidle waits for the player iframe to settle, not just bare DOM
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});

    // Retry clicking every 2s — first click may land on a blank/loading screen
    for (let i = 0; i < 20; i++) {
      if (streamFound) break;
      if (i % 2 === 0) {
        console.log(`[~] Click attempt ${i / 2 + 1}...`);
        await page.mouse.click(500, 500).catch(() => {});
      }
      await page.waitForTimeout(1000);
    }
  } catch {
    console.log("[!] Page redirected, keeping alive for popup...");
    for (let i = 0; i < 10; i++) {
      if (streamFound) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  setTimeout(async () => {
    if (!streamFound) {
      console.log("[!] Timeout: no m3u8 found.");
      await browser.close().catch(() => {});
      process.exit(1);
    }
  }, 2000);
})();
