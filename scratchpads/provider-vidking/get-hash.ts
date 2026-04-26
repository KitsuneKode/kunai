import { chromium } from "playwright";

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    
    const page = await context.newPage();
    console.log("Navigating to Vidking embed...");
    await page.goto("https://www.vidking.net/embed/tv/127529/1/2", { waitUntil: "domcontentloaded" });
    
    // Wait for the window.hash to be set
    console.log("Waiting for window.hash to be generated...");
    const hashValue = await page.evaluate(async () => {
        // Wait until window.hash is truthy
        while (!window.hash) {
            await new Promise(r => setTimeout(r, 100));
        }
        return window.hash;
    });
    
    console.log("SUCCESS! Extracted window.hash:", hashValue);
    await browser.close();
})();
