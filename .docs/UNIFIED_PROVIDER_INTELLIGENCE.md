# Kunai Provider Intelligence Report (Unified)

This report consolidates the latest reverse-engineering findings for multi-server, multi-audio, and 0-RAM streaming capabilities.

---

## 1. High-Precision Mappings (Multi-Server)

### **Cineby (VidKing Engine)**

_Archetype: Valorant Agents_

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

_Archetype: Animals_

| UI Name         | Subtitle Mode | Type         | Capabilities         |
| :-------------- | :------------ | :----------- | :------------------- |
| **kiwi**        | **Hardsub**   | Native       | Primary              |
| **bee**         | **Softsub**   | Native       | Primary (Thumbnails) |
| **telli / bun** | Mixed         | Embed        | Mirror backups       |
| **ally / nun**  | Mixed         | Native/Embed | Alt mirrors          |

---

## 2. 0-RAM Implementation Guide

| Provider       | Strategy    | Key / Algorithm                                 | Status                  |
| :------------- | :---------- | :---------------------------------------------- | :---------------------- |
| **VidKing**    | WASM + AES  | `tmdbId` (int) / Empty AES Key `""`             | Production              |
| **Miruro**     | Pipe API    | XOR + Gzip / `71951034f8fbcf53d89db52ceb3dc22c` | Candidate active module |
| **Rivestream** | API Hashing | Bitwise MurmurHash / Salt Rotation              | Experimental            |
| **AllManga**   | GQL + AES   | Persisted Query / `Xot36i3lK3:v1`               | Production              |

---

## 3. Investigated Gaps

### **AllManga**

- Already employs `sub/dub` category selection via GraphQL.
- Source names are generic (Default, Filemoon, etc.) and don't use a "Flavor" archetype yet.

### **Rivestream**

- Uses a `service` parameter (flowcast, vidplay, filemoon).
- Does not currently have a "Flavor" archetype (it just lists service names).
- Multi-audio is handled via the m3u8 playlist or a dedicated `tvOnlineSubtitles` API call.

---

## 4. Universal Recommendation

To maintain the "Kunai Advantage" (Speed & Quality):

1. **Prefer Native 0-RAM** over Playwright/Scraping.
2. **Expose "Flavor" archetypes** in the CLI/UI to match the user's familiarity with the source sites.
3. **Use the "meine" pattern** for any future providers that offer dedicated language endpoints.
