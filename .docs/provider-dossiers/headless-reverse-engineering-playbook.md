# Headless Provider Reverse-Engineering Playbook

This playbook documents the exact methodology used to crack the Vidking / HDToday protection and provides a universal blueprint for building 0-RAM, headless scrapers for other streaming aggregators (like `anikai.to`, `cineby.sc`, and `rivestream.app`).

Our goal is to build providers that function exactly like `ani-cli`—using raw HTTP requests (`fetch`/`curl`) to talk directly to the backend APIs, completely ignoring heavy HTML DOM rendering, Playwright/Puppeteer automation, and malicious JavaScript executions that drain RAM.

---

## 1. The Core Philosophy (The "ani-cli" Method)

A video player embedded on a website is just a frontend UI. Under the hood, it _must_ eventually request an `.m3u8` master playlist or an `.mp4` file.
Our goal is never to simulate clicking a "Play" button in a browser. Our goal is to find the exact API request the browser makes when that button is clicked, and then replicate that request perfectly using pure TypeScript.

### The 4 Phases of Cracking a Provider:

1. **Reconnaissance (The Sniff)**
2. **Deobfuscation (Finding the Source)**
3. **Decryption (Porting the Logic)**
4. **Execution (The Headless Fetch)**

---

## Phase 1: Reconnaissance (The Sniff)

Before writing any code, you need to understand how the target website communicates with its backend.

**How we did it for HDToday / Vidking:**

1. We fetched the raw HTML of `hdtoday.gd`.
2. We noticed the `<iframe src="https://player.videasy.net/...">` tag, proving HDToday just wraps Vidking.
3. We used browser DevTools (Network tab) or a basic sniffer script to watch the network traffic when a video played.
4. We found the crucial API call: `GET https://api.videasy.net/mb-flix/sources-with-title?...`

**How to do it for Rivestream (`rivestream.app`):**

1. Check the embed URL: `https://www.rivestream.app/embed?type=movie&id=533535`
2. Open that URL in your browser's Network tab.
3. Filter by `Fetch/XHR` or `Media`.
4. Look for the request that returns the `.m3u8` stream. It might be a direct API call (e.g., `https://api.rivestream.app/sources`) or it might be embedded directly inside the HTML of the iframe.

---

## Phase 2: Deobfuscation (Finding the Source)

Once you find the API endpoint that returns the video stream, look at its response. Is it clean JSON? Or is it encrypted gibberish?

**How we did it for Vidking:**
Vidking's API returned a massive hex-encoded string. We had to find out how the frontend decrypted it.

1. We looked at the "Initiator" column in the Network tab to find the JavaScript file that made the API request (`VideoPlayer-DJDza8PA.js`).
2. We downloaded that file and searched for keywords like `fetch`, `decrypt`, `AES`, and `sources`.
3. We discovered it was loading a WebAssembly module (`module1.wasm`).

**How to apply this moving forward:**
If Rivestream or Cineby returns encrypted data, download their JavaScript bundles and format them (using an un-minifier). Look for:

- `CryptoJS.AES.decrypt`
- `atob(` (Base64 decoding)
- `JSON.parse` wrapped around a variable.
  This will tell you exactly what algorithm they are using to hide the stream.

---

## Phase 3: Decryption (Porting the Logic)

This is the hardest part. You must recreate the browser's decryption logic in pure Node.js/TypeScript so you never have to launch a browser.

**How we did it for Vidking (The 15GB RAM Bypass):**
Vidking used an intentional "Zip Bomb" (infinite memory loop) inside their obfuscated JS to crash headless scrapers.

1. We **Decompiled** their `module1.wasm` file into readable WebAssembly Text (`.wat`) using the `wabt` tool.
2. We found their anti-bot `verify()` check and patched it out by replacing the condition (`global.get 70`) with a hardcoded True (`i32.const 1`), then recompiled it to `module1_patched.wasm`.
3. We realized their complex `Hashids`/`XOR` algorithm in JavaScript was a massive decoy to waste our time. By testing the WASM output, we proved the final AES key was simply an empty string `""`.

**How to apply this moving forward:**
Never use JSDOM or Playwright to execute obfuscated code if you can avoid it. Instead:

- **Port the Math:** If they use AES, extract their secret key/salt from the JS and write a native `CryptoJS.AES.decrypt(payload, "secret_key")` call in TypeScript.
- **WASM Native Loading:** If they use WASM, load it natively using `@assemblyscript/loader` inside Node.js. It runs instantly and consumes 0 RAM.

## Phase 5: Discovery & Trending (The Homepage Logic)

Most aggregators have a "Trending" or "Discover" section. We can scrape these to build a high-quality "Browse" mode in our app.

### Discovery Patterns by Provider:

1. **Rivestream:**
   - Trending: `https://www.rivestream.app/api/backendfetch?requestID=trending&secretKey=rive`
   - Search: `https://www.rivestream.app/api/backendfetch?requestID=searchMulti&query={q}&secretKey={hashed_q}`
2. **Cineby / Vidking:**
   - The homepage uses Next.js static props. Fetch `https://www.cineby.sc/_next/data/{buildId}/en.json` to get the `initialGenreMovies` and `popularMovies` arrays.
   - buildId can be found by searching the raw HTML for `buildId":"([^"]+)"`.
3. **Anikai:**
   - Schedule: `https://anikai.to/ajax/schedule?tz=+05:30` returns the daily anime broadcast schedule.
   - Trending: Results are SSR'd directly into the home page HTML inside `.aitem` elements. Use `cheerio` to extract the `ani_id` from the `data-tip` attribute.

---

6. **Subtitles (Wyzie / JSON APIs):** Many providers return a subtitle JSON array. Do not just pick `subtitles[0]`.
   - **Language Matching:** Filter for `"en"` or `"eng"`. Handles locale variants like `en-US`.
   - **Filter SDH:** Exclude subtitles with "SDH" in the name/display unless no others exist (Hearing Impaired tracks contain annoying text like `[car screeches]`).
   - **Format Priority:** Prefer `.vtt` for web players, but `.srt` is usually safer for `mpv`.

## 7. The `yt-dlp` Fallback Strategy (Embed Links)

If a provider only provides a third-party embed link (e.g., `mp4upload.com`, `streamtape.com`) and does not expose a raw `.m3u8` or `.mp4` file, **do not throw an error or attempt to write a custom extractor.**

1. Log that an embed link was found and `yt-dlp` will be used.
2. Return the embed URL directly to the application.
3. `mpv` natively hooks into `yt-dlp` (if installed on the user's system) and will automatically resolve the file host's obfuscation and stream the raw video.

---

## 8. Porting to Production (The Provider Contract)

Once you have the logic working in a scratchpad, implement it in `src/providers/` following the existing `ApiProvider` or `PlaywrightProvider` interfaces. Always prioritize `ApiProvider` (pure fetch) for 0-RAM performance.

---
