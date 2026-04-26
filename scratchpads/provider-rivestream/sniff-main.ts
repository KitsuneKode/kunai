import { chromium } from "playwright";

(async () => {
    console.log("Starting Playwright to sniff Rivestream main embed...");
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        console.clear = () => {};
    });

    const page = await context.newPage();

    page.on('request', request => {
        const type = request.resourceType();
        const url = request.url();
        if ((type === 'xhr' || type === 'fetch') && url.includes("backendfetch")) {
            console.log(`\n>> [REQ] ${request.method()} ${url}`);
        }
    });

    page.on('response', async response => {
        const type = response.request().resourceType();
        const url = response.url();
        if ((type === 'xhr' || type === 'fetch') && url.includes("backendfetch")) {
            console.log(`<< [RES] ${response.status()} ${url}`);
            try {
                const text = await response.text();
                console.log(`   Body preview: ${text.substring(0, 300).replace(/\n/g, '')}`);
            } catch (e) {}
        }
    });

    console.log("Navigating to https://www.rivestream.app/embed?type=movie&id=533535 ...");
    try {
        await page.goto("https://www.rivestream.app/embed?type=movie&id=533535", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(10000);
    } catch (e) {
        console.error("Error during navigation:", e.message);
    }

    await browser.close();
    console.log("Done sniffing.");
})();