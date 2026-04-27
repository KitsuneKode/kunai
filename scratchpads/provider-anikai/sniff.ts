import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Loading Anikai watch page...");
  await page.goto("https://anikai.to/watch/one-piece-dk6r", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const result = await page.evaluate(() => {
    const input = (window as any).__$;
    const target = "xQm9tJfLwGhz_0Eq8S_YAHYkwp-qQPLfm50W5fxnyd30nAY";
    const results: any = [];

    function scan(obj: any, path: string, depth: number) {
      if (depth > 3) return;
      try {
        for (let key in obj) {
          const val = obj[key];
          if (typeof val === "function") {
            try {
              const out = val(input);
              if (out === target) results.push(path + "." + key);
            } catch (e) {}
          } else if (val && typeof val === "object" && val !== window) {
            scan(val, path + "." + key, depth + 1);
          }
        }
      } catch (e) {}
    }

    scan(window, "window", 0);
    return results;
  });

  console.log("Functions that generate the token:", result);

  await browser.close();
})();
