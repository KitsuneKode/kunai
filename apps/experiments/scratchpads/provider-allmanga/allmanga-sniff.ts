import { chromium } from "playwright";

/**
 * AllManga / AllAnime Network Sniffer
 * 
 * Goal: AllAnime operates a massive GraphQL backend. They constantly rotate their API endpoints
 * and their AES decryption keys to prevent scraping.
 * This script launches a browser to sniff the exact GraphQL endpoints and headers they are currently using.
 */
async function sniffAllManga() {
    console.log("=========================================");
    console.log(" ALLMANGA / ALLANIME GRAPHQL SNIFFER");
    console.log("=========================================\n");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    const page = await context.newPage();

    console.log("[*] Intercepting Network Requests...");

    page.on('request', req => {
        const url = req.url();
        const method = req.method();

        // We are looking for their massive GraphQL endpoint (often named /api or /graphql)
        if ((method === "POST" && (url.includes('api') || url.includes('graphql'))) || url.includes('allanime')) {
            const postData = req.postData();
            if (postData && postData.includes('query')) {
                console.log(`\n[🔍 GRAPHQL FOUND] ${method} -> ${url}`);
                console.log(`    Headers: Agent -> ${req.headers()['agent']}`);
                console.log(`    Payload Snippet: ${postData.substring(0, 150)}...`);
            }
        }
    });

    page.on('response', async res => {
        const url = res.url();
        const method = res.request().method();

        if (method === "POST" && (url.includes('api') || url.includes('graphql'))) {
            try {
                const text = await res.text();
                // Look for the encrypted string or the raw episode list
                if (text.includes('episodeString') || text.includes('sourceUrls')) {
                    console.log(`\n[+] CAPTURED ENCRYPTED PAYLOAD:`);
                    console.log(`    ${text.substring(0, 200)}...`);
                }
            } catch(e) {}
        }
    });

    console.log("[*] Navigating to AllAnime/AllManga domain...");
    try {
        // They constantly rotate domains (e.g., allanime.day, allanime.to)
        await page.goto("https://allanime.day", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(5000); // Give the homepage time to load the trending lists via GraphQL
    } catch (e) {
        console.error("[!] Navigation failed. Domain might have rotated or Cloudflare blocked.", e.message);
    }

    await browser.close();
    console.log("\n=========================================");
    console.log(" SNIFFING COMPLETE");
}

sniffAllManga();