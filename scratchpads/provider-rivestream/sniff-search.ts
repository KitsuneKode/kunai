import { chromium } from "playwright";

(async () => {
    console.log("Starting Playwright to sniff Rivestream Search...");
    
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
        if ((type === 'xhr' || type === 'fetch') && !url.includes("google-analytics") && !url.includes("cloudflare")) {
            console.log(`\n>> [REQ] ${request.method()} ${url}`);
        }
    });

    console.log("Navigating to https://www.rivestream.app/search ...");
    try {
        await page.goto("https://www.rivestream.app/search", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        
        console.log("Typing 'bloodhounds' using keyboard events...");
        
        // Tab through the page a few times to focus the search bar if it's autofocus, or just blindly type.
        // Actually, let's just find the placeholder 'Search movies, tv...' or 'Search'
        const inputs = await page.$$('input');
        if (inputs.length > 0) {
             console.log(`Found ${inputs.length} input(s). Typing in the first one...`);
             await inputs[0].fill('bloodhounds');
             await page.keyboard.press('Enter');
        } else {
             console.log("No input fields found! Let's just try keyboard typing.");
             await page.keyboard.type('bloodhounds');
             await page.keyboard.press('Enter');
        }
        
        await page.waitForTimeout(5000);
        
    } catch (e) {
        console.error("Error during navigation/search:", e.message);
    }

    await browser.close();
    console.log("Done sniffing.");
})();