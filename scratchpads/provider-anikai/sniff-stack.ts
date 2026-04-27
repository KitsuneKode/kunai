import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable CDP to get detailed stack traces
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");

  client.on("Network.requestWillBeSent", (params) => {
    if (params.request.url.includes("ajax/episodes/list")) {
      console.log(`\nURL: ${params.request.url}`);
      console.log("Initiator:", params.initiator);
      if (params.initiator.stack) {
        console.log("Full Stack Trace:");
        params.initiator.stack.callFrames.forEach((frame: any, i: number) => {
          console.log(
            `  [${i}] ${frame.functionName} @ ${frame.url}:${frame.lineNumber}:${frame.columnNumber}`,
          );
        });
      }
    }
  });

  console.log("Loading Anikai watch page...");
  await page.goto("https://anikai.to/watch/one-piece-dk6r", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  await browser.close();
})();
