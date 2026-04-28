import { spawnSync, spawn } from 'child_process';
import * as readline from 'readline';
import { gunzipSync } from "zlib";

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PIPE_KEY = "71951034f8fbcf53d89db52ceb3dc22c";

function ask(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, (ans) => {
        rl.close();
        resolve(ans.trim());
    }));
}

function decrypt(data: string, isObfuscated: boolean): any {
    try {
        if (!isObfuscated) return JSON.parse(data);
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
    } catch (err) {
        console.error("Decryption/Parse error:", err.message);
        console.log("Raw Data:", data.substring(0, 100));
        return null;
    }
}

function miruroPipe(path: string, query: any = {}): any {
    const payload = JSON.stringify({
        path,
        method: "GET",
        query,
        body: null,
        version: "0.2.0"
    });
    const encoded = Buffer.from(payload).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const url = `https://www.miruro.tv/api/secure/pipe?e=${encoded}`;
    
    const args = ['-is', '--tls-max', '1.2', '--compressed', '-L', url];
    args.push('-H', `User-Agent: ${userAgent}`);
    args.push('-H', `Referer: https://www.miruro.tv/`);
    args.push('-H', `Accept: application/json, text/plain, */*`);
    
    const res = spawnSync('curl', args);
    const output = res.stdout.toString();
    const parts = output.split('\r\n\r\n');
    const body = parts.pop()?.trim();
    const headers = parts.join('\n').toLowerCase();

    if (!body) {
        console.error(`[!] Empty response for ${path}`);
        return null;
    }
    const isObfuscated = headers.includes('x-obfuscated: 2') || body.startsWith('bh4YNPj7');
    return decrypt(body, isObfuscated);
}

async function main() {
    process.title = "miruro-0-ram";
    console.log("=========================================");
    console.log(" MIRURO.TV 0-RAM HEADLESS SCRAPER");
    console.log(" (Cracked XOR + Gzip + Curl Pipeline)");
    console.log("=========================================\n");

    const query = process.argv[2] || await ask("Enter anime to search: ");

    // 1. Search
    console.log(`[*] Searching for "${query}"...`);
    const searchData = miruroPipe("search", { q: query, limit: 15, offset: 0, type: "ANIME" });
    if (!searchData) process.exit(1);

    const list = Array.isArray(searchData) ? searchData : (searchData.results || []);
    if (list.length === 0) {
        console.error("[!] No results found.");
        process.exit(1);
    }

    list.slice(0, 10).forEach((r: any, i: number) => {
        const title = r.title?.userPreferred || r.title?.english || "Unknown";
        console.log(`  [${i + 1}] ${title}`);
    });

    const pickStr = await ask("\nPick anime [1]: ");
    const selected = list[parseInt(pickStr || "1") - 1] || list[0];

    // 2. Fetch Episodes
    console.log(`\n[*] Fetching episodes for ID ${selected.id}...`);
    const epData = miruroPipe("episodes", { anilistId: String(selected.id) });
    if (!epData) {
        console.warn("[!] No episode data. Falling back to ID-based source probe...");
    }
    
    let eps: any[] = [];
    if (Array.isArray(epData)) {
        eps = epData;
    } else if (epData?.providers) {
        // Miruro structure: providers -> kiwi -> sub -> array
        for (const provider of Object.values(epData.providers)) {
            const p: any = provider;
            if (p && typeof p === 'object') {
                 if (Array.isArray(p)) { eps = p; break; }
                 if (p.sub && Array.isArray(p.sub)) { eps = p.sub; break; }
                 if (p.dub && Array.isArray(p.dub)) { eps = p.dub; break; }
                 if (p.episodes && Array.isArray(p.episodes)) { eps = p.episodes; break; }
            }
        }
    } else if (epData?.results) {
        eps = epData.results;
    }
    
    let selectedEpId = "";
    if (eps.length > 0) {
        console.log(`[+] Found ${eps.length} episodes.`);
        const epPickStr = await ask(`\nPick episode (1-${eps.length}) [${eps.length}]: `);
        const selectedEpNum = parseInt(epPickStr || String(eps.length));
        selectedEpId = eps[selectedEpNum - 1]?.id || eps[eps.length - 1]?.id;
    } else {
        // Miruro sometimes uses a standard pattern for episode IDs
        // We'll try to guess ep 1 if needed
        console.error("[!] Could not retrieve episode list.");
        process.exit(1);
    }

    // 3. Fetch Sources
    console.log(`\n[*] Fetching stream sources...`);
    const sourceData = miruroPipe("sources", {
        episodeId: selectedEpId,
        provider: "kiwi", 
        category: "sub",
        anilistId: String(selected.id)
    });

    if (!sourceData || !sourceData.streams) {
        console.error("[!] No streams found.");
        process.exit(1);
    }

    const hls = sourceData.streams.find((s: any) => s.type === "hls") || sourceData.streams[0];
    console.log(`\n[+] SUCCESS! Stream URL extracted:`);
    console.log(`    -> ${hls.url}`);

    if (hls.type !== "hls" && !hls.url.includes('.m3u8')) {
        console.log(`    [!] This is an embed link. 'mpv' will automatically use 'yt-dlp' to extract the raw video.`);
    }

    spawn("mpv", [hls.url, `--referrer=${hls.referer || 'https://www.miruro.tv/'}`, `--user-agent=${userAgent}`], { stdio: "inherit" }).on("close", () => process.exit(0));
}

main().catch(e => {
    console.error("Fatal error:", e);
    process.exit(1);
});
