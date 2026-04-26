import { chromium } from "playwright";
import { createWriteStream } from "fs";
import { resolve } from "path";
import * as readline from "readline";

// Log file path
const LOG_PATH = resolve("vidking-sniff-data.log");
const logStream = createWriteStream(LOG_PATH, { flags: "a" });

interface RequestInfo {
  method: string;
  url: string;
  headers: Record<string, string>;
}

const captured: RequestInfo[] = [];

const logRequest = (info: RequestInfo) => {
  const line = JSON.stringify(info);
  logStream.write(line + "\n");
  captured.push(info);
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = (query: string): Promise<string> =>
  new Promise((resolve) => rl.question(query, resolve));

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  // Prevent detection tricks
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // @ts-ignore
    window.close = () => console.log("[X] Blocked window.close()");
  });

  const checkRequest = (request: any) => {
    const info = {
      method: request.method(),
      url: request.url(),
      headers: request.headers(),
    } as RequestInfo;
    console.log(`[REQ] ${info.method} ${info.url}`);
    logRequest(info);
  };

  context.on("page", (pg) => pg.on("request", checkRequest));

  const page = await context.newPage();
  page.on("request", checkRequest);

  try {
    await page.goto("https://www.vidking.net/embed/tv/127529/1/2", {
      waitUntil: "domcontentloaded",
    });
  } catch (e) {
    console.error("Navigation error:", e);
  }

  console.log(
    "\nNetwork sniffing started. Press ENTER to view logged requests, or type q to quit.\n",
  );

  // Interactive loop
  while (true) {
    const input = (await prompt("Command (ENTER=view, q=quit): ")).trim();
    if (input.toLowerCase() === "q") break;
    if (captured.length === 0) {
      console.log("No requests captured yet.");
      continue;
    }
    console.log(`\nCaptured ${captured.length} requests:`);
    captured.forEach((req, idx) => {
      console.log(`${idx + 1}. ${req.method} ${req.url}`);
    });
    const idxStr = await prompt("Enter request number for details (or press ENTER to continue): ");
    const idx = parseInt(idxStr, 10);
    if (!isNaN(idx) && idx > 0 && idx <= captured.length) {
      const sel = captured[idx - 1];
      console.log(`\n--- Request ${idx} Details ---`);
      console.log(`Method: ${sel.method}`);
      console.log(`URL: ${sel.url}`);
      console.log(`Headers:`);
      console.dir(sel.headers, { depth: null });
      console.log("---------------------------\n");
    }
  }

  await browser.close();
  rl.close();
  logStream.end();
  console.log("\nSniffing stopped. Log saved to", LOG_PATH);
})();
