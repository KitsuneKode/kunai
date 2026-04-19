import { chromium } from "playwright";
import { spawn } from "child_process";
import { appendFile } from "fs/promises";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // @ts-ignore
    window.close = () => console.log("[X] Blocked window.close()");
  });

  console.log("Navigating to site and hunting for the stream...");

  let streamFound = false;
  let capturedSubtitleUrl: string | null = null; // Store the subtitle here

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

    // Inject the subtitle if we caught one!
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
    const url = request.url();

    // 1. SNOOP FOR SUBTITLES
    if (url.includes(".vtt") || url.includes(".srt") || url.includes("sub.wyzie.io")) {
      if (!capturedSubtitleUrl) {
        console.log(`\n[💬 SUBTITLE CAUGHT] URL: ${url}\n`);
        capturedSubtitleUrl = url;
      }
    }

    // 2. CATCH THE STREAM AND WAIT
    if (url.includes(".m3u8") && !streamFound) {
      streamFound = true; // Lock it immediately
      console.log("[+] Master stream found! Waiting 1.5s to catch subtitles...");

      // Delay the launch by 1.5 seconds to let the subtitle requests fire
      setTimeout(() => {
        launchMpv(url, request.headers()).catch(console.error);
      }, 1500);
    }
  };

  context.on("page", async (newPage) => {
    console.log(`[!] Popup/Redirect detected: ${newPage.url()}`);
    newPage.on("request", checkRequest);
  });

  const page = await context.newPage();
  page.on("request", checkRequest);

  try {
    await page.goto("https://www.cineby.sc/tv/127529/1/1?play=true", {
      waitUntil: "domcontentloaded",
    });

    // Check every 1 second, up to 20 seconds
    for (let i = 0; i < 20; i++) {
      if (streamFound) break;
      await page.waitForTimeout(1000);
    }
  } catch (error: any) {
    console.log(`[!] Main page redirected. Keeping script alive for the popup...`);
    for (let i = 0; i < 10; i++) {
      if (streamFound) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Add a small buffer here in case it times out EXACTLY when it finds a stream
  setTimeout(async () => {
    if (!streamFound) {
      console.log("\n[!] Timeout: Could not find m3u8.");
      await browser.close().catch(() => {});
      process.exit(1);
    }
  }, 2000);
})();
