import { chromium } from "playwright";

(async () => {
    console.log("Starting Playwright to sniff Rivestream...");
    
    // We'll use headless: true to keep it clean, but spoof the user agent
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    // Strip webdriver flag to avoid basic bot detection
    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // Override console.clear just in case they try to clear devtools
        console.clear = () => {};
    });

    const page = await context.newPage();

    page.on('request', request => {
        const type = request.resourceType();
        const url = request.url();
        // Only log interesting requests
        if ((type === 'xhr' || type === 'fetch') && !url.includes("google-analytics") && !url.includes("doubleclick") && !url.includes("clarity")) {
            console.log(`\n>> [REQ] ${request.method()} ${url}`);
        }
    });

    page.on('response', async response => {
        const type = response.request().resourceType();
        const url = response.url();
        
        if ((type === 'xhr' || type === 'fetch') && !url.includes("google-analytics") && !url.includes("doubleclick") && !url.includes("clarity")) {
            console.log(`<< [RES] ${response.status()} ${url}`);
            try {
                // Try to read the body as text to see if it's JSON or encrypted
                const text = await response.text();
                console.log(`   Body preview: ${text.substring(0, 300).replace(/\n/g, '')}`);
            } catch (e) {
                console.log(`   Body: (Could not read or non-text)`);
            }
        }
    });

    console.log("Navigating to https://www.rivestream.app/embed/agg?type=movie&id=278 ...");
    try {
        await page.goto("https://www.rivestream.app/embed/agg?type=movie&id=278", { waitUntil: "domcontentloaded" });
        console.log("Page loaded. Waiting 10 seconds for any delayed API calls...");
        await page.waitForTimeout(10000);
    } catch (e) {
        console.error("Error during navigation:", e.message);
    }

    await browser.close();
    console.log("Done sniffing.");
})();