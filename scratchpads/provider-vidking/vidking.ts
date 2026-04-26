import { chromium } from "playwright";
import { spawn } from "child_process";
import { appendFile } from "fs/promises";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    //@ts-ignore
    window.close = () => console.log("[X] Blocked window.close()");
  });

  console.log("Navigating to Vidking and analyzing network traffic...");

  let streamFound = false;
  let capturedSubtitleUrl: string | null = null;

  const logStream = async (url: string, headers: Record<string, string>, subUrl: string | null) => {
    try {
      const logEntry = `\n=== Stream Log ===\nTimestamp: ${new Date().toISOString()}\nURL: ${url}\nSubtitle: ${subUrl || "None"}\nHeaders:\n${JSON.stringify(headers, null, 2)}\n===================\n`;
      await appendFile("logs.txt", logEntry, "utf8");
    } catch (logError) {
      console.error("[!] Failed to write to log file:", logError);
    }
  };

  const launchMpv = async (url: string, headers: Record<string, string>) => {
    await logStream(url, headers, capturedSubtitleUrl);

    console.log("\n=================================================");
    console.log("🎉 BINGO! STREAM FOUND. LAUNCHING MPV...");
    console.log("=================================================\n");

    const mpvArgs = [url];
    if (headers["referer"]) mpvArgs.push(`--referrer=${headers["referer"]}`);
    if (headers["user-agent"]) mpvArgs.push(`--user-agent=${headers["user-agent"]}`);
    if (headers["origin"]) mpvArgs.push(`--http-header-fields=Origin: ${headers["origin"]}`);

    if (capturedSubtitleUrl) {
      console.log(`[+] Attaching Subtitle: ${capturedSubtitleUrl}`);
      mpvArgs.push(`--sub-file=${capturedSubtitleUrl}`);
    }

    console.log("[+] Injecting MPV Args:\n", mpvArgs);

    await browser.close().catch(() => {});

    const mpv = spawn("mpv", mpvArgs, { stdio: "inherit" });
    mpv.on("close", () => process.exit(0));
  };

  const checkRequest = (request: any) => {
    console.log(`[REQ] ${request.method()} ${request.url()}`);
    console.log("Headers:", request.headers());
    const url = request.url();
    const type = request.resourceType();

    // 1. SNOOP FOR HIDDEN APIs (Helpful for writing your Go/TS CLI)
    if (type === "fetch" || type === "xhr") {
      if (!url.includes("google") && !url.includes("cloudflare")) {
        console.log(`[🔍 API SNOOP] ${request.method()} -> ${url}`);
      }
    }

    // 2. SNOOP FOR SUBTITLES
    if (url.includes(".vtt") || url.includes(".srt") || url.includes("sub.wyzie.io")) {
      if (!capturedSubtitleUrl) {
        console.log(`\n[💬 SUBTITLE CAUGHT] URL: ${url}\n`);
        capturedSubtitleUrl = url;
      }
    }

    // 3. CATCH THE STREAM AND WAIT
    if (url.includes(".m3u8") && !streamFound) {
      streamFound = true;
      console.log("[+] Master stream found! Waiting 1.5s to catch subtitles...");

      setTimeout(() => {
        launchMpv(url, request.headers()).catch(console.error);
      }, 1500);
    }
  };

  context.on("page", async (newPage) => {
    newPage.on("request", checkRequest);
  });

  const page = await context.newPage();
  page.on("request", checkRequest);

  try {
    await page.goto("https://www.vidking.net/embed/tv/127529/1/2", {
      waitUntil: "domcontentloaded",
    });

    // Robust wait loop: Breaks instantly if stream is found
    for (let i = 0; i < 20; i++) {
      if (streamFound) break;
      await page.waitForTimeout(1000);
    }
  } catch (error: any) {
    console.log(`[!] Page error: ${error.message}`);
    for (let i = 0; i < 10; i++) {
      if (streamFound) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  setTimeout(async () => {
    if (!streamFound) {
      console.log("\n[!] Timeout: Could not find m3u8.");
      await browser.close().catch(() => {});
      process.exit(1);
    }
  }, 2000);
})();
