# Provider Integration Guide & Data Findings 🎯

## 1. The `yt-dlp` Question: Is it computationally heavy?

**No, `yt-dlp` is incredibly lightweight for our use case.**
When `yt-dlp` is used _just_ to extract a stream URL (which is what `mpv` does behind the scenes), it acts purely as a web scraper. It does **not** download, encode, or transcode the video. It simply:

1. Takes the embed URL (e.g., `mp4upload.com/...`)
2. Fetches the HTML of that page.
3. Uses Python regex/logic to find the hidden `.mp4` or `.m3u8` link.
4. Hands that raw link back to `mpv`.

**The Best Approach:**

- Always aim for our scrapers to extract the direct `.m3u8` (HLS) stream first, as this avoids invoking `yt-dlp` altogether (saving ~1-2 seconds of startup time).
- If the provider obscures the video behind a 3rd-party file host (like `mp4upload`, `streamtape`, `doodstream`), return the embed link and let `yt-dlp` handle it. This prevents us from having to write and maintain 50+ custom extractors for every video host on the internet.

---

## 2. Have we completed the required data findings?

**Yes.** We have successfully reverse-engineered the entire network flow, authentication, and obfuscation techniques for all target providers. We know exactly what to pass, what headers to use, and how to decrypt the responses.

### 📊 Data Findings Summary

| Provider                       | Architecture Required                  | Key Findings                                                                                                                                                                                                                                                                                                  |
| :----------------------------- | :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vidking (HDToday / Cineby)** | **True 0-RAM Headless** (Node `fetch`) | - Relies on `videasy.net` infrastructure.<br>- Uses a WASM binary (`module1.wasm`) as a "zip-bomb" trap for Playwright.<br>- **Bypass:** The AES key is a static empty string `""`. We completely bypass the WASM trap by fetching the JSON directly.                                                         |
| **Rivestream**                 | **True 0-RAM Headless** (Node `fetch`) | - Uses a custom 32-bit MurmurHash variant to generate a `secretKey`.<br>- **Bypass:** We ported the entire bitwise hashing algorithm to pure TypeScript. It requires zero browser interaction.                                                                                                                |
| **Anikai.to**                  | **Hybrid Full-Session** (Playwright)   | - Uses aggressive Cloudflare TLS fingerprinting and socket drops (`ECONNRESET`).<br>- **Bypass:** We use a single, persistent, hidden Playwright context to mimic a real user perfectly, bypassing network-level blocks without slowing down the flow.                                                        |
| **Miruro.tv**                  | **Hybrid Full-Session** (Playwright)   | - Uses `secure/pipe` API with Base64URL envelopes.<br>- Responses are encrypted via XOR against `VITE_PIPE_OBF_KEY` and compressed with Gzip.<br>- Also blocked by Cloudflare TLS fingerprinting.<br>- **Bypass:** We ported the XOR+Gzip decryptor to TypeScript and use Playwright to bypass the TLS block. |

---

## 3. How to Test the Findings

All findings are safely stored in the `scratchpads/` directory as self-contained, executable scripts. You can test them instantly from your terminal:

```bash
# Test Vidking (Universal 0-RAM)
bun scratchpads/provider-vidking/vidking-0-ram-scraper.ts "breaking bad"

# Test Rivestream (0-RAM with Hashing)
bun scratchpads/provider-rivestream/rivestream-headless.ts "the matrix"

# Test Anikai (Hybrid)
bun scratchpads/provider-anikai/anikai-headless.ts "one piece" 1 1159

# Test Miruro (Hybrid + Decryption)
bun scratchpads/provider-miruro/miruro-headless.ts "one piece" 1 1159
```

---

## 4. Implementation Plan (Moving to the Main App)

To integrate these findings into KitsuneSnipe's core (`src/providers/`), we need to adapt the scratchpad logic into the app's `Provider` interface.

### Step 1: Standardize the Provider Interface

Ensure `src/domain/types.ts` supports both `HLS` and `EMBED` source types so the UI knows whether to expect an instant start or a short `yt-dlp` delay.

```typescript
export interface StreamSource {
  url: string;
  type: "hls" | "mp4" | "embed";
  quality: string;
  referer?: string;
}
```

### Step 2: Implement True 0-RAM Providers (Vidking & Rivestream)

Create `src/providers/vidking.ts` and `src/providers/rivestream.ts`.

- Copy the `fetch` and `cheerio` logic from their respective `-0-ram-scraper.ts` scratchpads.
- Map their outputs to the standard `SearchResult`, `Episode`, and `StreamSource` objects expected by the app.

### Step 3: Implement Hybrid Providers (Anikai & Miruro)

Create `src/providers/anikai.ts` and `src/providers/miruro.ts`.

- These providers will need to instantiate a Playwright browser context when the user selects them.
- _Crucial:_ Do not close the browser after search. Keep the `page` object alive in a class property so that the `getEpisodes` and `getSources` methods can reuse the established session, maintaining the speed of the scratchpad.

### Step 4: Fix Subtitles (`wyzie`)

Apply the findings from `.docs/subtitle-resolver-analysis.md`:

- Remove the passive browser observer from `src/scraper.ts`.
- Update the providers to return their `tmdbId`.
- Make an active, direct `fetch` to `sub.wyzie.io` using the static key, skipping SDH tracks and preferring `.srt`.
