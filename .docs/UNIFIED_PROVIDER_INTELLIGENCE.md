# Kunai Provider Intelligence Report (Unified)

This report consolidates the latest reverse-engineering findings for multi-server, multi-audio, and 0-RAM streaming capabilities. It serves as the "Gold Standard" architectural guide for integrating diverse provider UI taxonomies into Kunai's unified backend.

---

## 1. UI-to-Backend Taxonomy Anomalies (Crucial Findings)

The biggest challenge in building a unified streaming engine is that every provider exposes their streams to the user differently. We have categorized these into distinct "Archetypes". Our engine's strict guardrail is to **normalize all of these into a standard `VariantTree` grouped by Presentation, Quality, and Language.**

### Archetype A: The "Unified" Dropdown (Rivestream)

Rivestream merges **Provider**, **Quality**, and **Language** into a single messy UI string.

- **UI Example:** `FlowCast (1080)` or `#Hà Nội (Vietsub) (HLS)`
- **Backend Reality:** The user selects a single string, but the backend uses this to pass a `service` parameter (e.g., `flowcast`, `vidplay`) to the `/api/backendfetch` endpoint. Quality is bound directly to the server alias.
- **Embed vs. Native Modes:** Rivestream distinguishes between an "Embed Mode" and a "Non Embed Mode (AD-free)". The "Embed" mode returns an iframe URL, whereas the Native mode fetches the direct `.m3u8` playlist. Kunai strictly utilizes the Native (`tvVideoProvider`) mode for 0-RAM.

### Archetype B: Server as a Language Alias (Cineby / VidKing)

Cineby uses fake server names (Valorant Agents) that actually serve as hardcoded language selectors.

- **UI Example:** `Killjoy (German audio)` or `Neon (Original audio)`.
- **Backend Reality:** Selecting "Killjoy" does not switch the CDN; it switches the API endpoint to `meine?language=german`. Selecting "Fade" switches the endpoint to `hdmovie` and filters the resulting streams for the word "Hindi".
- **Kunai Guardrail:** We map these UI aliases back to their respective API parameters. The engine MUST parse the master `.m3u8` playlist (using `m3u8-parser.ts`) to expose the separated qualities (1080p, 720p) to the CLI/UI, because the provider API does not expose them upfront.

### Archetype C: Strict Sub/Dub/Raw Separation (AllManga / Miruro)

Anime providers inherently treat Subtitles, Dubs, and Raws as fundamentally different catalogs.

- **UI Example (AllManga):** A global toggle for `SUB` / `DUB` / `RAW`. Under `SUB`, you see technical servers like `FM-HLS`, `UNI`, `YT`, `OK`.
- **UI Example (Miruro):** A global toggle for `SUB` / `DUB`. Under `SUB`, you see animal names like `kiwi` (Hardsubbed) or `bee` (Softsubbed with thumbnails).
- **Backend Reality:** Changing Sub/Dub requires a completely new network request. For AllManga, it changes the `translationType` GraphQL variable. For Miruro, it changes the `category` in the Pipe API.
- **Kunai Guardrail:** The UI must NEVER query every server upfront (the N+1 problem). The engine must return a `VariantTree` loaded with `deferredLocator`s. Only when the user selects `FM-HLS` under `DUB` does the engine execute the complex multi-step decryption to fetch the stream.

---

## 2. High-Precision Mappings (Multi-Server)

### **Cineby (VidKing Engine)**

_Archetype: Valorant Agents (Server = Language)_

| UI Name     | API Endpoint             | Audio Language                      |
| :---------- | :----------------------- | :---------------------------------- |
| **Neon**    | `mb-flix`                | Original                            |
| **Yoru**    | `cdn`                    | Original (4K)                       |
| **Cypher**  | `downloader2`            | Original                            |
| **Sage**    | `1movies`                | Original                            |
| **Vyse**    | `hdmovie`                | English (Filter quality: "English") |
| **Killjoy** | `meine?language=german`  | **German**                          |
| **Harbor**  | `meine?language=italian` | **Italian**                         |
| **Chamber** | `meine?language=french`  | **French** (Movies)                 |
| **Fade**    | `hdmovie`                | **Hindi** (Filter quality: "Hindi") |
| **Omen**    | `lamovie`                | **Spanish**                         |
| **Raze**    | `superflix`              | **Portuguese**                      |

### **Miruro**

_Archetype: Animals (Server = Subtitle Mode)_

| UI Name         | Subtitle Mode | Type         | Capabilities         |
| :-------------- | :------------ | :----------- | :------------------- |
| **kiwi**        | **Hardsub**   | Native       | Primary              |
| **bee**         | **Softsub**   | Native       | Primary (Thumbnails) |
| **telli / bun** | Mixed         | Embed        | Mirror backups       |
| **ally / nun**  | Mixed         | Native/Embed | Alt mirrors          |

### **AllManga**

_Archetype: Technical (Server = Decryption Method)_

| UI Name      | Subtitle Mode | Backend Identity    | Capabilities                                  |
| :----------- | :------------ | :------------------ | :-------------------------------------------- |
| **UNI**      | Hardsub       | `Default` (wixmp)   | Multi-quality native HLS                      |
| **FM-HLS**   | Hardsub       | `Fm-mp4` (filemoon) | Requires secondary AES-256 decryption API hit |
| **YT**       | Hardsub       | `Yt-mp4` (youtube)  | Standard MP4                                  |
| **OK / MP4** | Mixed         | `OK` / `S-mp4`      | Legacy MP4 Fallbacks                          |

---

## 3. 0-RAM Implementation Guide & Guardrails

| Provider       | Strategy   | Key / Algorithm                   | Guardrail Notes                                                                              |
| :------------- | :--------- | :-------------------------------- | :------------------------------------------------------------------------------------------- |
| **VidKing**    | WASM + AES | `tmdbId` / Empty Key `""`         | WASM binary updates occasionally. Always supply `Origin: https://www.vidking.net`.           |
| **Miruro**     | Pipe API   | XOR + Gzip / `71951034f...`       | Rate-limited by Cloudflare. Must debounce UI clicks and use AbortSignals.                    |
| **Rivestream** | API Hash   | Bitwise Hash / Salt Table         | The 64-char `cArray` salt rotates. If extraction fails, fall back to Embed iframe scraping.  |
| **AllManga**   | GQL + AES  | Persisted Query / `Xot36i3lK3:v1` | Domain `tools.fast4speed.rsvp` streams strictly require `allmanga.to` Referer to avoid 403s. |

---

## 4. Feature Enhancements & Missing Gaps

### **Episode Thumbnails (The "Cineby" Approach vs Anime Sites)**

- **Movies/Series (Cineby/VidKing):** VidKing's backend (`db.videasy.net`) is just a caching proxy for the official TMDB API. It natively returns TMDB `still_path` URLs, meaning thumbnails work perfectly out of the box.
- **Anime (AllManga / Miruro):** Anime providers typically **do not** expose per-episode thumbnails in their streaming APIs. AllManga returns raw episode lists.
- **The Engine Guardrail:** Kunai MUST implement a **Metadata Enrichment Layer**. Using the `aniListId` returned by AllManga/Miruro, the UI/Shell must asynchronously fetch the season/episode metadata from TMDB or Kitsu in the background and overlay the thumbnails onto the UI. _Do not block stream resolution waiting for TMDB thumbnails._

### **Quality Discovery: Upfront Probing vs. Deferred Locators**

Legacy tools like `ani-cli` perform an upfront probe of all servers (e.g. executing the Filemoon AES decryptor) before presenting the menu, just to see what qualities exist.

- **The Engine Guardrail:** Kunai uses **Deferred Locators**. We render the UI instantly based on the known Provider Archetypes (e.g., we know `FM-HLS` exists). When the user actually selects `FM-HLS`, _then_ the engine runs the AES decryption, fetches the `.m3u8`, parses explicit qualities using `m3u8-parser.ts`, and launches the player. This guarantees 0ms initial delay.
