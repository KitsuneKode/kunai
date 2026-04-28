import { chromium } from "playwright";
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
    process.title = "miruro-hybrid";
    console.log("=========================================");
    console.log(" MIRURO.TV HYBRID HEADLESS SCRAPER");
    console.log(" (Stable Full-Session Persistence)");
    console.log("=========================================\n");

    const query = process.argv[2] || await ask("Enter anime to search: ");

    console.log(`\n[*] Initializing browser session for "${query}"...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    
    // We navigate to home to establish session/cookies
    try {
        await page.goto("https://www.miruro.tv/", { waitUntil: "commit" });
    } catch (e) {
        console.log("[!] Initial navigation failed, but continuing...");
    }

    // 1. Search via page.evaluate (using the site's internal pipe logic)
    console.log(`[*] Executing search...`);
    const searchResults = await page.evaluate(async (q) => {
        const payload = {
            path: "search",
            method: "GET",
            query: { q, limit: 15, offset: 0, type: "ANIME" },
            body: null,
            version: "0.2.0"
        };
        const e = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const res = await fetch(`/api/secure/pipe?e=${e}`);
        // We'll use the site's internal response handling by just returning the raw JSON
        // but wait, we need to decrypt it. Since we are in the page, 
        // we can just let the site handle it if we hook the internal request method, 
        // OR we can just use the fact that fetch() will have the x-obfuscated header.
        
        // Simpler: Use the existing window.env and local logic
        // But for this hybrid, we'll just return the results as the page sees them.
        const text = await res.text();
        return { text, isObfuscated: res.headers.get('x-obfuscated') === '2' };
    }, query);

    // We use our local decryption logic since we have the keys!
    const PIPE_KEY = "71951034f8fbcf53d89db52ceb3dc22c";
    const { gunzipSync } = await import("zlib");
    
    function decrypt(data: string) {
        const Ro = new Uint8Array(PIPE_KEY.match(/.{2}/g)!.map(e => parseInt(e, 16)));
        let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
        const pad = base64.length % 4;
        if (pad) base64 += "=".repeat(4 - pad);
        const a = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const e = new Uint8Array(a.length);
        for (let t = 0; t < a.length; t++) e[t] = a[t] ^ Ro[t % Ro.length];
        let finalBytes = e;
        if (e[0] === 31 && e[1] === 139) {
            try { finalBytes = gunzipSync(e); } catch (err) {}
        }
        return JSON.parse(new TextDecoder().decode(finalBytes));
    }

    const searchData = searchResults.isObfuscated ? decrypt(searchResults.text) : JSON.parse(searchResults.text);
    const list = Array.isArray(searchData) ? searchData : (searchData.results || []);

    if (list.length === 0) {
        console.error("[!] No results found.");
        rl.close();
        await browser.close();
        process.exit(1);
    }

    list.slice(0, 10).forEach((r: any, i: number) => {
        console.log(`  [${i + 1}] ${r.title.userPreferred || r.title.english}`);
    });

    const pickStr = process.argv[3] || await ask("\nPick anime [1]: ");
    const selected = list[parseInt(pickStr || "1") - 1] || list[0];

    // 2. Fetch Episodes
    console.log(`\n[*] Fetching episodes for ${selected.title.userPreferred}...`);
    const epResults = await page.evaluate(async (anilistId) => {
        const payload = {
            path: "episodes",
            method: "GET",
            query: { anilistId: String(anilistId) },
            body: null,
            version: "0.2.0"
        };
        const e = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const res = await fetch(`/api/secure/pipe?e=${e}`);
        const text = await res.text();
        return { text, isObfuscated: res.headers.get('x-obfuscated') === '2' };
    }, selected.id);

    const epData = epResults.isObfuscated ? decrypt(epResults.text) : JSON.parse(epResults.text);
    console.log("[DEBUG] epData keys:", Object.keys(epData));
    if (epData.providers) {
        console.log("[DEBUG] providers:", Object.keys(epData.providers));
        if (epData.providers.kiwi) {
             console.log("[DEBUG] kiwi keys:", Object.keys(epData.providers.kiwi));
             if (epData.providers.kiwi.episodes) {
                 const epsObj = epData.providers.kiwi.episodes;
                 console.log("[DEBUG] epsObj keys:", Object.keys(epsObj));
             }
        }
    }
    
    let eps: any[] = [];
    let selectedProvider = "kiwi";
    if (Array.isArray(epData)) {
        eps = epData;
    } else if (epData?.providers) {
        const PREFERRED_PROVIDERS = ['kiwi', 'arc', 'dune', 'bee'];
        const availableProviders = Object.keys(epData.providers);
        let found = false;

        for (const pref of [...PREFERRED_PROVIDERS, ...availableProviders]) {
            if (found) break;
            const p: any = epData.providers[pref];
            if (p && typeof p === 'object') {
                 if (Array.isArray(p)) { eps = p; selectedProvider = pref; found = true; break; }
                 if (p.sub && Array.isArray(p.sub)) { eps = p.sub; selectedProvider = pref; found = true; break; }
                 if (p.dub && Array.isArray(p.dub)) { eps = p.dub; selectedProvider = pref; found = true; break; }
                 if (p.episodes && typeof p.episodes === 'object') {
                     if (p.episodes.sub && Array.isArray(p.episodes.sub)) { eps = p.episodes.sub; selectedProvider = pref; found = true; break; }
                     if (p.episodes.dub && Array.isArray(p.episodes.dub)) { eps = p.episodes.dub; selectedProvider = pref; found = true; break; }
                 }
            }
        }
    } else if (epData?.results) {
        eps = epData.results;
    }

    console.log(`[+] Found ${eps.length} episodes via provider ${selectedProvider}.`);
    const epPickStr = process.argv[4] || await ask(`\nPick episode [${eps.length}]: `);
    const selectedEpNum = parseInt(epPickStr || String(eps.length));
    const selectedEp = eps[selectedEpNum - 1] || eps[eps.length - 1];

    console.log(`[DEBUG] selectedEp:`, selectedEp);

    // 3. Fetch Sources
    console.log(`\n[*] Extracting stream sources...`);
    const sourceResults = await page.evaluate(async (params) => {
        const payload = {
            path: "sources",
            method: "GET",
            query: { 
                episodeId: params.epId, 
                provider: params.provider, 
                category: "sub", 
                anilistId: Number(params.aniId) 
            },
            body: null,
            version: "0.2.0"
        };
        const e = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const res = await fetch(`/api/secure/pipe?e=${e}`);
        const text = await res.text();
        return { text, isObfuscated: res.headers.get('x-obfuscated') === '2' };
    }, { epId: selectedEp.id, aniId: selected.id, provider: selectedProvider });

    const sourceData = sourceResults.isObfuscated ? decrypt(sourceResults.text) : JSON.parse(sourceResults.text);
    const hls = sourceData.streams.find((s: any) => s.type === "hls") || sourceData.streams[0];

    console.log(`\n[+] SUCCESS! Stream URL extracted:`);
    console.log(`    -> ${hls.url}`);

    if (hls.type !== "hls" && !hls.url.includes('.m3u8')) {
        console.log(`    [!] This is an embed link. 'mpv' will automatically use 'yt-dlp' to extract the raw video.`);
    }

    await browser.close();

    rl.close();
    spawn("mpv", [hls.url, `--referrer=${hls.referer || 'https://www.miruro.tv/'}`, `--user-agent=${userAgent}`], { stdio: "inherit" }).on("close", () => process.exit(0));
}

main().catch(e => {
    console.error("Fatal error:", e);
    rl.close();
    process.exit(1);
});
