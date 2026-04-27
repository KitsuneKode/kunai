import { chromium } from "playwright";
import { writeFileSync } from "fs";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  console.log("Loading Anikai search page...");
  try {
    // Use a more patient goto
    await page.goto("https://anikai.to/browser?keyword=one%20piece", { waitUntil: "commit" });

    // Wait for potential redirects and the actual content
    console.log("Waiting for .aitem to appear...");
    await page.waitForSelector(".aitem", { timeout: 15000 });

    await page.screenshot({ path: "scratchpads/provider-anikai/search-debug.png" });
    const html = await page.content();
    writeFileSync("scratchpads/provider-anikai/search-debug.html", html);

    const result = await page.evaluate(() => {
      return {
        items: document.querySelectorAll(".aitem").length,
        title: document.title,
        url: window.location.href,
      };
    });
    console.log("Page Info:", result);
  } catch (e) {
    console.error("Diagnosis failed:", e.message);
    // Take a screenshot of the failure state
    await page.screenshot({ path: "scratchpads/provider-anikai/search-error.png" });
  }

  await browser.close();
})();
