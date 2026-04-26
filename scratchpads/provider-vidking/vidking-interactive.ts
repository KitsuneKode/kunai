import { chromium } from "playwright";
import { createWriteStream } from "fs";
import { resolve } from "path";
import * as readline from "readline";

const NO_INTERACTION_LOG_PATH = resolve("scratchpads/log-no-interaction-vidking.log");
const INTERACTION_LOG_PATH = resolve("scratchpads/log-interaction-vidking.log");

const noIntStream = createWriteStream(NO_INTERACTION_LOG_PATH, { flags: "w" });
const intStream = createWriteStream(INTERACTION_LOG_PATH, { flags: "w" });

let hasInteracted = false;

const logEvent = (info: any) => {
  const line = JSON.stringify(info);
  if (!hasInteracted) {
    noIntStream.write(line + "\n");
  } else {
    intStream.write(line + "\n");
  }
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await context.exposeBinding('logClick', async (source, payload) => {
    if (!hasInteracted) {
        console.log("\n[!] FIRST INTERACTION DETECTED. Switching log file to log-interaction-vidking.log\n");
        hasInteracted = true;
    }
    const msg = `[CLICK] Frame: ${source.frame.url()} | Element: ${payload.tagName} | Classes: ${payload.className} | ID: ${payload.id} | Text: ${payload.text}`;
    console.log(msg);
    logEvent({
        type: 'user_click',
        frameUrl: source.frame.url(),
        ...payload,
        timestamp: new Date().toISOString()
    });
  });

  await context.addInitScript(() => {
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (!target) return;
      const clickable = target.closest("button, a, [role='button'], .btn, .tab, [data-id], [data-value], [data-server], li, span, div") ?? target;
      
      const payload = {
        tagName: clickable.tagName,
        className: clickable.className,
        id: clickable.id,
        text: clickable.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100),
      };
      
      // @ts-ignore
      window.logClick(payload).catch(() => {});
    }, true);
  });

  context.on("request", (request) => {
    logEvent({
      type: 'request',
      method: request.method(),
      url: request.url(),
      headers: request.headers(),
      timestamp: new Date().toISOString()
    });
  });

  context.on("response", async (response) => {
     let bodySnippet = null;
     try {
       const url = response.url();
       if (url.includes('sub.wyzie.io') || url.includes('.m3u8') || url.includes('.vtt') || url.includes('.json')) {
           const body = await response.text();
           bodySnippet = body.slice(0, 1000);
       }
     } catch(e) {}

     logEvent({
        type: 'response',
        status: response.status(),
        url: response.url(),
        bodySnippet: bodySnippet,
        timestamp: new Date().toISOString()
     });
  });

  const page = await context.newPage();

  console.log("Navigating to Vidking...");
  try {
    await page.goto("https://www.vidking.net/embed/tv/127529/1/2", {
      waitUntil: "domcontentloaded",
    });
  } catch (e) {
    console.error("Navigation issue:", e);
  }

  console.log("\n[+] Page loaded. All initial network requests saved to scratchpads/log-no-interaction-vidking.log");
  console.log("[+] Now waiting for you to interact. Once you click anything, future logs will go to scratchpads/log-interaction-vidking.log");
  console.log("[+] Playwright is tracking iframe clicks as well.\n");
  console.log("Type 'q' and press ENTER to quit the script.\n");

  rl.on('line', async (line) => {
      if (line.trim().toLowerCase() === 'q') {
          await browser.close();
          rl.close();
          noIntStream.end();
          intStream.end();
          console.log("Exiting...");
          process.exit(0);
      }
  });

})();
