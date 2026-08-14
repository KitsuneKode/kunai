# Anikai Reverse-Engineering & Wrapper Report

## Overview

This report details the successful reverse-engineering of **Anikai.to**.
Anikai is one of the most heavily fortified streaming aggregators, employing aggressive Cloudflare protections, internal iframe wrappers, and multiple 3rd-party file hosts to obscure the actual video stream.

Unlike Vidking or Miruro, Anikai **cannot** be scraped with 0-RAM pure Node.js fetches. It requires the **JIT (Just-in-Time) Playwright Lifecycle**.

---

## 1. The Cloudflare Challenge (The Hybrid Scraper)

Anikai routinely drops TCP sockets (`ECONNRESET`) or returns `net::ERR_ABORTED` if a headless browser is detected.

- **The Bypass:** We built a robust Playwright scraper (`anikai-headless.ts`) that launches a hidden browser context. We explicitly catch the `ERR_ABORTED` connection resets and force the scraper to continue waiting for the DOM to settle, allowing the underlying JavaScript to execute the Cloudflare Turnstile redirect successfully.
- **The Session Token:** During the initial load, Anikai fetches a dynamic session token via an AJAX request to `/ajax/episodes/list?ani_id=...&_={token}`. This token is required to view episode lists.

---

## 2. The Internal ID Mapping

Unlike Miruro, Anikai does **not** natively accept AniList IDs on its frontend search or watch pages.

- For example, _One Piece_ (AniList ID `21`) is internally mapped to the proprietary slug `one-piece-dk6r` and the internal ID `c4ey`.
- **The Solution:** We must use a **Local Mapping Database** (such as the open-source `MAL-Sync` or `Consumet` JSON files) to translate standard AniList IDs into Anikai's internal slugs _before_ requesting the stream. This bypasses their clunky search engine entirely.

---

## 3. The Iframe Onion (Extracting the Embed)

When a user selects a server on Anikai (e.g., `[SUB] Server 1`), Anikai does not return the video file.

1. **The Internal Wrapper:** Clicking the server triggers an AJAX request to `/ajax/links/view?id={dynamic_hash}`. This returns a link to Anikai's internal iframe wrapper (e.g., `https://anikai.to/iframe/Ksf-sOWq...`).
2. **The External Embed:** The internal wrapper HTML contains another iframe pointing to the _actual_ 3rd-party file host (e.g., `megaup.nl`, `mp4upload`, `vidstreaming`).
3. **The Playwright Intercept:** Our script intercepts the network traffic, grabs the internal wrapper URL, navigates _into_ it, and extracts the final, raw 3rd-party embed URL.

---

## 4. The Client-Side Unpacker Strategy (The Final Extractor)

Because the Web App cannot run `yt-dlp` to extract the raw `.mp4` from these 3rd-party file hosts (like MegaUp or Mp4Upload), we proved that the final video link can be forced out using **Client-Side Unpacking**.

1. **The Obfuscation:** The file hosts use JavaScript Packers (like the classic Dean Edwards `eval(function(p,a,c,k,e,d){...})` cipher) to hide the `<video src="...">` tag.
2. **The Extractor Test:** We modified the headless script to fetch the raw HTML of the embed link. It successfully located the `eval()` blocks containing the hidden video.
3. **The Web Implementation:** For the `@kunai/scraper-core` integration, we will build a dedicated `/extractors` module containing lightweight TypeScript Regex parsers. They will download the raw HTML of the file host via the CORS proxy, unpack the JS natively, and extract the raw `.mp4` string for the Web App's `ArtPlayer` UI, maintaining a 100% ad-free experience.

---

## 5. The Fallback Server Loop

During our Deep Research pass (`anikai-deep-research.ts`), we discovered that `yt-dlp` (used by the CLI daemon) natively supports some file hosts (like `mp4upload`), but throws an "Unsupported URL" error for others (like `megaup.nl`).

**The Implementation Mandate:**
The final Anikai scraper **must not** blindly click "Server 1". It must implement a fallback loop:

1. Click Server 1.
2. Intercept the embed link.
3. If the embed link is an unsupported host (e.g., `megaup`), ignore it, click Server 2, and repeat until a supported host (or a direct `.m3u8`) is found.
4. If no supported hosts are found, seamlessly fall back to the Miruro or Vidking provider.
