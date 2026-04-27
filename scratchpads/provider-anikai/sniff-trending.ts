import { chromium } from "playwright";

(async () => {
  console.log("Starting Playwright to sniff Anikai Trending...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("ajax")) {
      console.log(`\n<< [AJAX RES] ${url}`);
      try {
        const text = await response.text();
        // Check if it's discovery data
        if (text.includes("One Piece") || text.includes("Naruto") || text.includes("title")) {
          console.log(`   Potential Trending Data found!`);
        }
      } catch (e) {}
    }
  });

  try {
    console.log("Loading Anikai Homepage...");
    await page.goto("https://anikai.to/home", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(10000);
  } catch (e) {
    console.error("Failed:", e.message);
  }

  await browser.close();
})();
