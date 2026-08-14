# Rivestream Headless Scraper Report

## Overview

This report details the successful reverse-engineering and implementation of a 0-RAM, purely headless scraper for **Rivestream** (`rivestream.app`).

Unlike Vidking, Rivestream relies entirely on Client-Side Rendering (CSR) and does not embed any video data in its raw HTML. However, it also does not encrypt its network traffic or use hostile WebAssembly anti-bot traps.

---

## 1. The Discovery

By sniffing the network traffic with Playwright (bypassing their "DevTools Disabled" blocker), we identified that Rivestream's React application fetches video sources by talking directly to its backend API.

We found two main API calls:

1. **Providers Check:** `GET /api/backendfetch?requestID=EmbedProviderServices&secretKey=rive`
   Returns an array of available servers (e.g., `["self", "prime"]`).
2. **Sources Fetch:** `GET /api/backendfetch?requestID=movieEmbedProvider&id=533535&service=self&secretKey=NTU2ZjdhYTc=`
   Returns the actual host and embed link.

---

## 2. Reverse Engineering the `secretKey` Authentication

The only hurdle to hitting this API headlessly was the `secretKey` parameter (`NTU2ZjdhYTc=`), which changed dynamically for every movie/show ID.

1. **Base64 Decoding:** The key was clearly Base64 encoded. `NTU2ZjdhYTc=` decoded to `556f7aa7`.
2. **Finding the Hashing Algorithm:** We downloaded all the minified JavaScript chunks (`/_next/static/chunks/*.js`) and searched them for `secretKey`. We found the generation logic inside the main `_app.js` bundle.
3. **Deobfuscation:** The obfuscated code revealed a custom 32-bit hashing algorithm (very similar to MurmurHash3). It takes the `tmdbId`, performs a series of bitwise operations (`<<`, `>>>`, `^`), and uses a hardcoded array of 64 random strings (the `cArray`) as salts.
4. **The Headless Implementation:** We successfully extracted the `cArray` and ported the entire bitwise hashing algorithm into pure TypeScript (`generateSecretKey`).

---

## 3. The Multi-Mode Headless Scraper

With the `secretKey` algorithm cracked, we wrote `scratchpads/provider-rivestream/rivestream-headless.ts`.

It runs with 0 RAM, asks the user for the TMDB ID, supports both **Movies and TV Shows**, and can query multiple endpoints natively:

- **Embeds:** `movieEmbedProvider`, `tvEmbedProvider`
- **Torrents:** `movieTorrentProvider`, `tvTorrentProvider`

This completely bypasses the need for Playwright, rendering Rivestream just as scrape-able as any native `ani-cli` provider!
