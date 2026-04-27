import { chromium } from "playwright";

(async () => {
  console.log("Starting Playwright to sniff Cineby Discovery...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("_next/data") || url.includes("db.videasy.net")) {
      console.log(`\n<< [DISCOVERY RES] ${url}`);
      try {
        const text = await response.text();
        // Check for movie/tv lists
        if (text.includes("title") && text.includes("id")) {
          console.log(`   Data found (first 500 chars): ${text.substring(0, 500)}`);
        }
      } catch (e) {}
    }
  });

  try {
    console.log("Loading Cineby Homepage...");
    await page.goto("https://www.cineby.sc/", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);
  } catch (e) {
    console.error("Failed:", e.message);
  }

  await browser.close();
})();
