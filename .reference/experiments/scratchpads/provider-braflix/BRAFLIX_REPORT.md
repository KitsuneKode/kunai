# Braflix Reverse-Engineering & Review Report

## Overview

This report details the analysis of the legacy **Braflix** provider (`braflix.mov`).
During our schema hunt, we discovered that `braflix.mov` is either heavily blocking headless requests or the domain is currently unstable. However, analyzing the legacy codebase reveals its exact structure.

---

## 1. TMDB Integration

Yes, Braflix natively uses **TMDB IDs**.
In the legacy code, the `mediaId` is extracted directly from the requested title. This means for Movies and Western Series, we can completely bypass their search engine and construct the AJAX URLs directly.

---

## 2. The API Structure

Braflix operates as a UI wrapper over 3rd-party file hosts, similar to Anikai.

1. **Movie Servers:** `GET /ajax/episode/list/{tmdbId}` returns an HTML block containing `data-id="{serverId}"`.
2. **Series Seasons:** `GET /ajax/season/list/{tmdbId}` returns season IDs.
3. **Series Episodes:** `GET /ajax/season/episodes/{seasonId}` returns episode IDs.
4. **Series Servers:** `GET /ajax/episode/servers/{episodeId}` returns the `serverId`.
5. **The Final Extract:** `GET /ajax/episode/sources/{serverId}` returns a JSON payload containing the 3rd-party `link`.

---

## 3. The Extraction Strategy (Hybrid Fallback)

Because the `link` returned by Step 5 is almost always a 3rd-party wrapper (like Rabbitstream or Megacloud), Braflix cannot be a "True 0-RAM" provider out of the box unless we build native extractors for those hosts.

**The Implementation Plan:**

- We will port Braflix into `@kunai/providers` as a **Hybrid Provider** (`runtime: playwright-lease`).
- The Node.js side will handle Steps 1-5 instantly using 0-RAM fetches.
- Once we get the final `link` (Step 5), we pass it to the `@kunai/browser` lease to intercept the actual `.m3u8` network request.

---

## 4. Subtitles

Braflix relies entirely on the 3rd-party embeds to serve subtitles. This means we must use Network Sniffing (listening for `.vtt` requests) during the Playwright lease to capture them.
