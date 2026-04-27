import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("ajax")) {
      console.log(`\n>> [REQ] ${request.method()} ${url}`);
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("ajax")) {
      try {
        const text = await response.text();
        console.log(`<< [RES] ${response.status()} ${url}`);
        console.log(`   BODY: ${text}`);
      } catch (e) {}
    }
  });

  console.log("Loading Anikai...");
  try {
    await page.goto("https://anikai.to/watch/one-piece-dk6r#ep=1", { waitUntil: "commit" });

    // Wait for the servers to be loaded into the DOM
    console.log("Waiting for .server buttons...");
    await page.waitForSelector(".server", { timeout: 30000 });

    const servers = await page.$$(".server");
    if (servers.length > 0) {
      console.log(`Found ${servers.length} servers. Clicking first one...`);
      await servers[0].click();

      // Wait for the next AJAX call
      await page.waitForTimeout(10000);
    }
  } catch (e) {
    console.error("Failed:", e.message);
  }

  await browser.close();
})();
