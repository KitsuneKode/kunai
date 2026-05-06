# Kunai Provider Extraction Flows (Mermaid Diagrams) 🥷✨

This document provides visual, deterministic state machines for how `@kunai/scraper-core` extracts streams from each of our supported providers. It serves as a visual companion to the textual dossiers.

---

## 1. Miruro (0-RAM Backend Bypass)
**Strategy:** Pure Node.js `fetch()` directly to the hidden backend, bypassing the Cloudflare-protected frontend entirely.

```mermaid
sequenceDiagram
    participant UI as Kunai UI
    participant Core as @kunai/core (Miruro Provider)
    participant DB as theanimecommunity.com
    participant CDN as pro.ultracloud.cc

    UI->>Core: resolveStream(AniList ID: 21, Sub)
    Note over Core: No search needed. Native AniList ID routing.
    Core->>DB: GET /api/v1/episodes/21/1
    DB-->>Core: JSON { sources: { sub: [...], dub: [...] } }
    Core->>Core: Parse sources.sub & sort qualities
    Core-->>UI: StreamSource (url: noahwilliams911.workers.dev/pl.m3u8)
    Note over UI: Pass to mpv with Referer: https://www.miruro.tv/
    UI->>CDN: Play Stream
```

---

## 2. Anikai (Hybrid Harvest & Fetch)
**Strategy:** Use JIT Playwright *only once* to harvest the `cf_clearance` cookie, then use pure `fetch()` for all subsequent requests, injecting headless AJAX calls to bypass DOM clicking.

```mermaid
sequenceDiagram
    participant UI as Kunai UI
    participant Core as @kunai/core (Anikai Provider)
    participant Map as Local MAL-Sync DB
    participant PW as JIT Playwright
    participant Anikai as anikai.to
    participant Ext as Custom TypeScript Extractor

    UI->>Core: resolveStream(AniList ID: 21, SoftSub)
    Core->>Map: translateId(21)
    Map-->>Core: Slug: 'one-piece-dk6r'
    
    alt Cold Start (No Cookie)
        Core->>PW: Launch hidden browser
        PW->>Anikai: Navigate & wait for Cloudflare
        Anikai-->>PW: Set cf_clearance cookie
        PW-->>Core: Return Cookie & User-Agent
        Core->>Core: Save to Local DB, Kill Playwright
    end

    Core->>Anikai: Node fetch() with cf_clearance cookie
    Anikai-->>Core: HTML & Session Token
    Core->>Anikai: fetch('/ajax/episodes/list?type=softsub...')
    Anikai-->>Core: Episode List HTML
    Core->>Anikai: fetch('/ajax/links/view?id=XYZ') (Server Loop)
    Anikai-->>Core: Iframe Wrapper URL
    Core->>Anikai: fetch(Iframe Wrapper URL)
    Anikai-->>Core: Raw Embed URL (e.g., megaup.nl)
    
    Core->>Ext: Pass to MegaUpExtractor
    Ext->>Ext: Unpack JS 'eval()' block & Regex .mp4
    Ext-->>Core: Raw .mp4 URL
    Core-->>UI: StreamSource (url: video.mp4)
```

---

## 3. Vidking (WASM Bypass & Universal Decryptor)
**Strategy:** Pure 0-RAM Node.js. Bypass the browser entirely by loading the patched WebAssembly trap natively in Node, bypassing the decoy Hashids, and performing AES decryption.

```mermaid
sequenceDiagram
    participant UI as Kunai UI
    participant Core as @kunai/core (Vidking Provider)
    participant API as api.videasy.net
    participant WASM as module1_patched.wasm
    participant Wyzie as sub.wyzie.io

    UI->>Core: resolveStream(TMDB ID: 127529)
    Core->>API: GET /mb-flix/sources-with-title?tmdbId=127529
    API-->>Core: Encrypted Hex Payload
    
    Core->>WASM: decrypt(Hex Payload, TMDB ID)
    Note over WASM: Patched to bypass memory-leak check
    WASM-->>Core: Base64 OpenSSL String
    
    Core->>Core: CryptoJS.AES.decrypt(Base64, "") (Empty String Key)
    Core->>Core: Parse JSON (Qualities array)
    
    par Async Subtitle Fetch
        Core->>Wyzie: GET /search?id=127529&key=wyzie-9baf...
        Wyzie-->>Core: JSON [{ url: "en.vtt", lang: "eng" }]
    end

    Core-->>UI: StreamSource (Qualities: 1080p, 720p, Subtitles: en.vtt)
```

---

## 4. Rivestream (0-RAM MurmurHash Generation)
**Strategy:** Pure 0-RAM Node.js. Generates the dynamic authentication hash locally in TypeScript to unlock the native JSON API.

```mermaid
sequenceDiagram
    participant UI as Kunai UI
    participant Core as @kunai/core (Rivestream Provider)
    participant Hash as TypeScript Hash Generator
    participant API as rivestream.app/api

    UI->>Core: resolveStream(TMDB ID: 533535)
    Core->>Hash: generateSecretKey(533535)
    Note over Hash: Uses ported 32-bit MurmurHash & cArray salt
    Hash-->>Core: secretKey: 'NTU2ZjdhYTc='
    
    Core->>API: GET /backendfetch?requestID=movieEmbedProvider&id=533535&secretKey=NTU2ZjdhYTc=
    API-->>Core: JSON { data: { sources: [...] } }
    
    Core-->>UI: StreamSource (url: cdn.rivestream.com/master.m3u8)
```

---

## 5. AllAnime / AllManga (GraphQL & AES)
**Strategy:** Pure 0-RAM Node.js. Uses strict `Agent` spoofing to query the GraphQL API, hex decodes the payload, and applies an AES-256-CTR cipher.

```mermaid
sequenceDiagram
    participant UI as Kunai UI
    participant Core as @kunai/core (AllAnime Provider)
    participant GQL as api.allanime.day

    UI->>Core: resolveStream(Show ID, Dub)
    Core->>GQL: POST { query: "...", variables: { type: "dub" } }
    Note over Core: Must pass 'Referer: https://youtu-chan.com'
    GQL-->>Core: Encrypted Hex String (sourceUrls)
    
    Core->>Core: Hex Decode -> Buffer
    Core->>Core: AES-256-CTR Decrypt (static IV/Key)
    Core->>Core: Extract wixmp/HLS links from decrypted JSON
    
    Core-->>UI: StreamSource (url: allanime.cdn/master.m3u8)
```