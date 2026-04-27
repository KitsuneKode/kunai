import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Loading Anikai watch page...");

  try {
    await page.goto("https://anikai.to/watch/one-piece-dk6r", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const result = await page.evaluate(() => {
      const target = "xQm9tJfLwGhz_0Eq8S_YAHYkwp-qQPLfm50W5fxnyd30nAY";
      // Check all global variables for this string
      const found: string[] = [];
      for (let key in window) {
        try {
          if ((window as any)[key] === target) found.push(`window.${key}`);
        } catch (e) {}
      }
      return found;
    });

    console.log("Found in globals:", result);
  } catch (e) {
    console.error("Failed:", e.message);
  }

  await browser.close();
})();
