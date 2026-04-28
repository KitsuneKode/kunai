import { chromium } from "playwright";
import * as cheerio from 'cheerio';
import * as readline from 'readline';
import { spawn } from 'child_process';

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(query: string): Promise<string> {
    return new Promise(resolve => rl.question(query, (ans) => {
        resolve(ans.trim());
    }));
}

async function main() {
    process.title = "anikai-hybrid";
    console.log("=========================================");
    console.log(" ANIKAI.TO HYBRID HEADLESS SCRAPER");
    console.log(" (Stable Full-Session Persistence - DOM Clicker)");
    console.log("=========================================\n");

    const query = process.argv[2] || await ask("Enter anime to search: ");

    console.log(`\n[*] Initializing browser session for "${query}"...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    
    // We navigate to home to establish session/cookies
    try {
        await page.goto("https://anikai.to/home", { waitUntil: "commit" });
    } catch (e) {
        console.log("[!] Initial navigation failed, but continuing...");
    }

    console.log(`[*] Executing search...`);
    try {
        await page.goto(`https://anikai.to/browser?keyword=${encodeURIComponent(query)}`, { waitUntil: "commit" });
        await page.waitForTimeout(5000); // Wait for CF Challenge
        try { await page.waitForSelector('.aitem', { timeout: 15000 }); } catch (e) {}
    } catch (e) {
        console.error("[!] Search navigation or selector failed.");
    }

    const results = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.aitem'));
        return items.map(el => {
            const title = el.querySelector('.title')?.textContent?.trim() || "";
            const href = el.querySelector('a.poster')?.getAttribute('href') || "";
            const aniId = el.querySelector('button.ttip-btn')?.getAttribute('data-tip') || "";
            return { title, slug: href.split('/').pop(), aniId };
        }).filter(r => r.slug && r.aniId);
    });

    if (!results || results.length === 0) {
        console.error("[!] No results found.");
        const html = await page.content();
        console.log("DEBUG HTML Preview:", html.substring(0, 500));
        rl.close();
        await browser.close();
        process.exit(1);
    }

    results.slice(0, 10).forEach((r: any, i: number) => console.log(`  [${i + 1}] ${r.title}`));
    
    const pickStr = process.argv[3] || await ask("\nPick anime [1]: ");
    const selected = results[parseInt(pickStr || "1") - 1] || results[0];

    console.log(`\n[*] Navigating to ${selected.title}...`);
    let sessionToken = "";
    
    // We will intercept the final stream URL by watching network requests after we click the server
    // And also grab the session token from the initial episode list load
    let finalStreamUrl = "";
    page.on('response', async res => {
        const url = res.url();
        if (url.includes('ajax/')) {
            const parts = url.split('&_=');
            if (parts.length > 1 && !sessionToken) {
                sessionToken = parts[1];
                console.log(`[+] Captured Session Token: ${sessionToken.substring(0, 15)}...`);
            }
        }
        if (url.includes('ajax/sources/extract')) {
            try {
                const json = await res.json();
                if (json.status === "ok" && json.result?.url) {
                    finalStreamUrl = json.result.url;
                }
            } catch(e) {}
        }
    });

    try {
        await page.goto(`https://anikai.to/watch/${selected.slug}`, { waitUntil: "commit" });
        // Wait for the episode list to load. Anikai loads episodes via ajax into .ep-item
        // Give it a massive timeout for Cloudflare to clear
        await page.waitForSelector('a[token]', { timeout: 60000 });
    } catch (e) {
        console.error(`[!] Failed to load watch page or episode list. Cloudflare might be blocking heavily. Error: ${e.message}`);
        rl.close();
        await browser.close();
        process.exit(1);
    }

    console.log(`[*] Fetching episode list...`);
    const episodes = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('a[token]'));
        return items.map(el => {
            const epNum = el.getAttribute('num') || el.getAttribute('data-num') || el.getAttribute('data-number');
            const title = el.querySelector('span')?.textContent?.trim() || "";
            return { epNum, title, elementIndex: items.indexOf(el) };
        }).filter(ep => ep.epNum);
    });

    if (episodes.length === 0) {
        console.error("[!] No episodes found in the DOM.");
        rl.close();
        await browser.close();
        process.exit(1);
    }

    console.log(`[+] Found ${episodes.length} episodes.`);
    const epPickStr = process.argv[4] || await ask(`\nPick episode (1-${episodes.length}) [${episodes.length}]: `);
    const selectedEpNum = parseInt(epPickStr || String(episodes.length));
    const selectedEp = episodes.find(e => parseInt(e.epNum!) === selectedEpNum) || episodes[episodes.length - 1];

    console.log(`[*] Clicking episode ${selectedEp.epNum}...`);
    try {
        await page.locator('a[token]').nth(selectedEp.elementIndex).click();
        await page.waitForSelector('.server', { timeout: 30000 });
    } catch (e) {
        console.error("[!] Failed to click episode or load servers.");
        rl.close();
        await browser.close();
        process.exit(1);
    }

    const servers = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.server'));
        return items.map(el => {
            const name = el.textContent?.trim() || "";
            const group = el.closest('.server-items')?.getAttribute('data-id') || "";
            return { name, group, elementIndex: items.indexOf(el) };
        });
    });

    console.log("\nAvailable Servers:");
    servers.forEach((s, i) => console.log(`  [${i + 1}] [${s.group?.toUpperCase()}] ${s.name}`));
    const srvPickStr = process.argv[5] || await ask("\nPick server [1]: ");
    const selectedSrv = servers[parseInt(srvPickStr || "1") - 1] || servers[0];

    finalStreamUrl = "";
    page.on('request', req => {
        const url = req.url();
        if (url.includes('/iframe/')) {
            finalStreamUrl = url;
        }
    });

    console.log(`[*] Clicking server ${selectedSrv.name}...`);
    try {
        await page.locator('.server').nth(selectedSrv.elementIndex).click({ force: true });
        
        let retries = 0;
        while (!finalStreamUrl && retries < 30) {
            await new Promise(r => setTimeout(r, 500));
            retries++;
        }
    } catch (e) {
        console.error("[!] Failed to click server:", e.message);
    }

    if (!finalStreamUrl) {
        console.error("[!] Failed to extract final stream URL.");
        rl.close();
        await browser.close();
        process.exit(1);
    }

    // The intercepted URL is Anikai's internal iframe wrapper.
    // We need to navigate to it and extract the actual third-party filehost embed URL.
    console.log(`[*] Resolving actual embed URL from Anikai's iframe wrapper...`);
    try {
        await page.goto(finalStreamUrl, { waitUntil: "domcontentloaded" });
        const realIframe = await page.waitForSelector('iframe', { timeout: 15000 });
        if (realIframe) {
            const realSrc = await realIframe.getAttribute('src');
            if (realSrc && realSrc !== "about:blank") {
                finalStreamUrl = realSrc;
            }
        }
    } catch (e) {
        console.log(`    [!] Failed to extract inner iframe. Using wrapper URL...`);
    }

    console.log(`\n[+] SUCCESS! Stream URL extracted:`);
    console.log(`    -> ${finalStreamUrl}`);

    if (!finalStreamUrl.includes('.m3u8') && !finalStreamUrl.includes('.mp4')) {
        console.log(`    [!] This is an embed link. 'mpv' will automatically use 'yt-dlp' to extract the raw video.`);
    }

    rl.close();
    await browser.close();
    spawn("mpv", [finalStreamUrl, `--referrer=https://anikai.to/`, `--user-agent=${userAgent}`], { stdio: "inherit" }).on("close", () => process.exit(0));
}

main().catch(e => {
    console.error("Fatal error:", e);
    rl.close();
    process.exit(1);
});
