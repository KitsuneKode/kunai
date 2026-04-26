---
name: headless-scraper-pro
description: Guides the agent through reverse-engineering streaming websites and building 0-RAM headless scrapers (like ani-cli). Use this skill whenever the user wants to "scrape a provider", "reverse engineer a streaming site", "build a scraper for", "bypass obfuscation", or "crack a streaming API". It provides a step-by-step methodology for sniffing network traffic, deobfuscating JS/WASM, and writing pure HTTP fetch scripts to extract m3u8 streams without launching heavy headless browsers.
---

# Headless Scraper Pro

This skill provides the ultimate playbook for reverse-engineering obfuscated streaming websites (like Vidking, Rivestream, HDToday, etc.) to build lightning-fast, 0-RAM, headless scrapers. The goal is to always extract the direct `.m3u8` or `.mp4` stream links using pure `fetch` and `cheerio`, bypassing the need for RAM-heavy headless browsers (like Playwright, Puppeteer, or JSDOM) in the final implementation.

## The 4 Phases of Cracking a Provider

### Phase 1: Reconnaissance (The Sniff)
Most illegal streaming sites block the F12 Developer Tools. To bypass this, you must write a temporary Playwright script that navigates to the page and intercepts `request` and `response` events.
**Goal:** Find the hidden backend API endpoint that returns the video links or server list.

**Example Sniffer Template:**
```typescript
import { chromium } from "playwright";
(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        console.clear = () => {}; // Bypass devtools clearing
    });
    const page = await context.newPage();
    page.on('response', async res => {
        if ((res.request().resourceType() === 'xhr' || res.request().resourceType() === 'fetch')) {
            console.log(`<< [RES] ${res.status()} ${res.url()}`);
            try { console.log(await res.text()); } catch(e) {}
        }
    });
    await page.goto("TARGET_URL", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await browser.close();
})();
```

### Phase 2: Deobfuscation (Finding the Source)
If the API endpoint returns clean JSON with `.m3u8` links, you are done. Move to Phase 4.
If it returns an encrypted string (e.g., Hex, Base64), you must find the decryption logic.
1. Download the site's minified React/Webpack JavaScript chunks (`/_next/static/chunks/*.js` or similar).
2. `grep` through the chunks for the API endpoint path, `secretKey`, `decrypt`, `AES`, or `CryptoJS`.
3. Extract the surrounding function to understand how the authorization key is generated or how the payload is decrypted.

### Phase 3: Decryption (Porting the Logic)
You must recreate the browser's decryption logic in pure Node.js/TypeScript. 
Never use JSDOM or Playwright to execute obfuscated code in production if you can avoid it.
- **Port the Math:** If they use AES, extract their secret key/salt from the JS and write a native `CryptoJS.AES.decrypt(payload, "secret_key")` call in TypeScript.
- **WASM Native Loading:** If they use a WebAssembly `.wasm` file (e.g., to hide a "Zip Bomb" or RAM exhaust trap), download it, patch out verification checks using `wasm2wat` and `wat2wasm`, and load it natively using `@assemblyscript/loader` inside Node.js. It runs instantly and consumes 0 RAM.
- **Decoy Algorithms:** Be aware that sites often leave massive decoy algorithms (like complex XOR loops). Always test edge cases (like an empty string `""` as the AES key) before assuming the obfuscated math is actually used.

### Phase 4: Execution (The Headless Fetch)
Wrap the entire flow in a clean, reusable TypeScript CLI script that runs with zero browser overhead.
1. `fetch()` the search results HTML -> use `cheerio` to parse the TMDB ID or proprietary video ID.
2. Generate the dynamic `secretKey` (if required) using the ported hashing algorithm.
3. `fetch()` the backend API using the ID and key.
4. `CryptoJS.AES.decrypt()` the response (if encrypted).
5. Output the `.m3u8` master playlist or direct `.mp4` link.
6. Spawn `mpv` (or VLC) passing the stream URL, the `Referer` header, and any extracted subtitle `.vtt` links.

## Common Pitfalls & Anti-Bot Mitigations
- **Cloudflare 521/503 Errors:** If a raw `fetch` gets blocked by Cloudflare but a browser doesn't, ensure you pass a complete set of standard headers (`User-Agent`, `Accept`, `Accept-Language`, `Origin`, `Referer`). Some runtimes (like Bun) have slightly different TLS fingerprints than Chrome, which can trigger Cloudflare blocks on strict sites.
- **URL Encoding Issues:** If a secret key hashing algorithm fails on search terms with spaces, ensure you are hashing the raw string (e.g., `breaking bad`) but passing the URL-encoded string (`breaking%20bad`) in the `fetch` request.
- **JSDOM/Playwright Hangs:** If your script gets stuck or uses massive RAM (15GB+), the site is running a client-side Zip Bomb trap. Kill the process immediately and decompile their `.wasm` or obfuscated JS instead of executing it.