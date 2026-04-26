# HDToday / Vidking Decryption & Headless Scraping Report

## Overview
This report details the successful reverse-engineering and implementation of a 0-RAM, purely headless scraper for **HDToday**, which relies on **Vidking (videasy.net)** infrastructure for its video delivery.

We successfully bypassed a highly aggressive, RAM-exhausting WebAssembly (WASM) anti-bot measure and discovered a massive decoy encryption algorithm, resulting in a clean, lightning-fast TypeScript scraper similar to `ani-cli`.

---

## 1. The Discovery: HDToday uses Vidking
While investigating `hdtoday.gd`, we discovered that it is a Next.js application that does not host its own video streams. Instead, its server buttons ("Upcloud", "Megacloud") are entirely cosmetic wrappers that load a Vidking iframe:
`https://player.videasy.net/tv/{tmdbId}/{season}/{episode}`

This meant that to scrape HDToday, we only needed to search HDToday for the `tmdbId`, and then attack the Vidking API directly.

---

## 2. The Anti-Bot "Zip Bomb" (Why RAM Spiked to 15GB)
Vidking employs a very aggressive client-side anti-bot mechanism designed to crash headless browsers (like Playwright, Puppeteer) and DOM emulators (like JSDOM).

The process works as follows:
1. The site loads an obfuscated JavaScript file (`module1.js`).
2. This script downloads a WebAssembly binary (`module1.wasm`).
3. The WASM binary exports a `serve()` function, which returns a pointer to a massive string in memory.
4. This string contains highly obfuscated JavaScript that hooks into the browser's `window` object to generate a dynamic `hash`.
5. If the script detects it is running in a non-standard or emulated environment, it intentionally triggers an infinite loop of gigabyte-sized string allocations, causing a massive memory leak (the 15GB RAM spike we observed) until the OS kernel kills the process (`Exit Code: 137`).

---

## 3. Reverse Engineering the Encryption
The actual video stream (`.m3u8`) is fetched via an API call to:
`https://api.videasy.net/mb-flix/sources-with-title?tmdbId=...`

This API returns a large hex-encoded payload. The client-side code decrypts this payload in a multi-step process:

### Step A: The WASM Decryptor & Verification
The obfuscated JS passes the encrypted payload and the `tmdbId` into the WASM module's `decrypt(payloadPtr, tmdbId)` function.
However, before `decrypt()` will work, the WASM module requires the `verify(hashPtr)` function to be called with the correct dynamic `window.hash`. If `verify()` fails, the `decrypt()` function hits an `unreachable` trap and aborts the execution.

### Step B: The Decoy XOR/Hashids Algorithm
The decompiled JS showed a highly complex algorithm intended to generate the AES key for the final decryption step:
```javascript
function Us(e) {
    // Splits the string, applies an XOR cipher using a hardcoded key, 
    // converts to hex, and encodes via the Hashids library.
}
const aesKeyBase = tmdbId + "d486ae1ce6fdbe63b60bd1704541fcf0";
const aesKey = Us(aesKeyBase);
```

### Step C: Final CryptoJS AES Decryption
The output of the WASM `decrypt` function (a Base64 string starting with `U2FsdGVkX1` - the standard OpenSSL salted prefix) is then passed to `CryptoJS.AES.decrypt(wasmOutput, aesKey)`.

---

## 4. The Bypass (The "Empty String" Revelation)
To build a 0-RAM scraper, we needed to bypass the WASM verification without running the malicious, memory-leaking JS payload.

1. **WASM Patching:** We decompiled `module1.wasm` to WebAssembly Text format (`.wat`) using `wabt`. We found the memory assertion inside the `decrypt` function that checked the `g_sb` variable (set by `verify()`). We patched the `.wat` file to permanently replace `global.get 70` (the verification flag) with `i32.const 1` (True). We then recompiled this into `module1_patched.wasm`.
2. **The Decoy Discovery:** With the WASM successfully decrypted, we attempted to pass the output through the complex `Us()` XOR/Hashids algorithm to get the AES key. However, the decryption failed. We then realized that the obfuscated JS was intentionally misleading. By testing edge cases, **we discovered that the actual AES key required to decrypt the WASM output is simply an empty string `""`**. The entire `Hashids` XOR algorithm was a brilliantly orchestrated decoy to waste the time of reverse-engineers!

---

## 5. The Final Headless Implementation
The final scraper (`scratchpads/hdtoday-scraper.ts`) is incredibly lightweight and entirely bypasses the need for a browser:

1. **Search:** Uses a simple `fetch` request and `cheerio` to parse the Next.js HTML from `hdtoday.gd`, extracting the `tmdbId`.
2. **Fetch:** Requests the encrypted payload directly from `api.videasy.net`.
3. **WASM Decrypt:** Loads the patched `module1_patched.wasm` directly in Node.js (0 browser overhead) to decrypt the hex payload into a Base64 OpenSSL string.
4. **AES Decrypt:** Uses `CryptoJS.AES.decrypt(base64, "")` to retrieve the final, clean JSON containing the `.m3u8` master playlist.
5. **Subtitles:** Makes a direct `fetch` to `sub.wyzie.io` using the statically discovered API key to get `.vtt`/`.srt` links.
6. **Playback:** Spawns `mpv` with the direct stream URL, the `Referer` header, and the subtitle track.

## 6. Qualities and Multi-Provider Support
Our analysis of the decrypted JSON revealed that Vidking provides the `.m3u8` master playlists for *multiple qualities* inside a single response, typically:
- `360p`
- `720p`
- `1080p`

Additionally, the frontend buttons for "Upcloud", "Megacloud", etc., map to specific API endpoints. We discovered that Vidking actually operates 4 distinct server infrastructure endpoints:
1. **Oxygen:** `api.videasy.net/mb-flix/sources-with-title`
2. **Hydrogen:** `api.videasy.net/cdn/sources-with-title`
3. **Lithium:** `api.videasy.net/downloader2/sources-with-title`
4. **Helium:** `api.videasy.net/1movies/sources-with-title`

The scraper now prompts the user to select which internal server (provider) they want to query. Once the payload is decrypted, it outputs all available qualities and automatically plucks the `url` for the highest available resolution (usually `1080p`). Finally, the scraper natively extracts the subtitles directly from the decrypted payload, completely eliminating the need to query the external `wyzie` API.

---

_End of report._