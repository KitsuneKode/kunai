# Kunai Architecture V3: The Zero-Cost "Stremio Killer" 🥷✨

This document outlines the final, ultimate architecture for Kunai. It achieves what seems impossible: serving potentially millions of users with a premium, custom UI, without hosting any video content, without running expensive scraping servers, and **without paying a dime for backend compute.**

It merges the best parts of Stremio (decentralization, Bring-Your-Own-Provider) with the accessibility of a modern web app (no installation required for the basic tier).

---

## 1. The Core Philosophy: "Zero-Cost, Zero-Trust"

If we centralize the scraping (hosting Node.js/Playwright servers to fetch streams for users), we will go bankrupt from server costs and get our IPs banned.
If we use a "Crowd-Cache" (users send links to a central database), malicious users will poison the cache with fake or inappropriate links.

**The Solution:** Every user scrapes their own streams, securely, on their own device. We provide the UI and the tools; they provide the compute.

---

## 2. The Web App Strategy: The CORS Proxy & Client-Side Scraping

A major goal is to have a functional Web App (`kunai.app`) so users don't _have_ to download a desktop app just to watch something. But browsers block cross-origin requests (CORS). You can't fetch `anikai.to/api` from `kunai.app`.

### How we bypass CORS for free:

1. **The Cloudflare Worker (The Proxy):** We deploy a tiny, free serverless function on Cloudflare called a CORS proxy (e.g., `proxy.kunai.app`).
2. **The Pass-Through:** When the user's browser wants to scrape Vidking, instead of calling `https://videasy.net/api`, it calls `https://proxy.kunai.app/?url=https://videasy.net/api`.
3. **The Magic:** The Cloudflare proxy fetches the data from Vidking, strips away the security headers that block browsers, and hands the raw encrypted data back to the user's browser.
4. **Client-Side Decryption:** The user's iPhone or Laptop runs our 0-RAM TypeScript decryption logic (XOR, Gzip, Hashing) entirely in their browser memory.
5. **The Result:** The user's device did all the heavy lifting. Cloudflare's free tier handled the proxying. We paid **$0** in compute, and the user gets the stream instantly.

---

## 3. The Stremio Model: "Bring Your Own Provider" (BYOP)

Stremio is legally safe and incredibly powerful because it doesn't provide the pirated content; it provides a framework for community "addons." We will adopt a similar, but more seamless, approach.

### How Kunai does BYOP better:

- **Default Native Providers:** Kunai ships with our 0-RAM providers (Vidking, Rivestream) pre-configured to run via the CORS proxy. This gives 90% of users a flawless, instant, out-of-the-box experience.
- **The "Local Daemon" (For Heavy Providers):** For providers that require Playwright (like Anikai or Miruro to bypass Cloudflare TLS), the Web App cannot run them.
  - Instead, power users install the `kunai` CLI or Desktop App.
  - They run it in the background.
  - The Web App detects `localhost:8080` and suddenly "unlocks" the heavy providers, routing the scraping requests through the user's own local machine instead of the CORS proxy.
- **BYO-Subscription (Debrid Integration):** Real-Debrid is huge. We will add an option in Kunai's settings: "Enter Real-Debrid API Key." If provided, Kunai prioritizes caching high-quality torrents via their paid Debrid account, played natively in our UI. We touch zero credentials; it all stays in their local browser storage.

---

## 4. Solving the Iframe Problem (Maintaining the Premium UI)

If a provider only gives us an iframe (like `mp4upload.com`), we cannot embed it on the Web App without ruining the UI with their popups and ads.

**The Multi-Tiered Solution:**

1. **The Native Filter (Web Default):** The Web App simply ignores iframe-only servers. It aggressively filters for direct `.m3u8` or `.mp4` links to feed into our custom `ArtPlayer` UI. With multiple providers, we almost always find a native stream.
2. **The Local Extractor (CLI/Desktop):** If the user is running the CLI or Desktop app (which has `yt-dlp` bundled), they can click the iframe server. The local app invisibly rips the raw video using `yt-dlp` and feeds it to the player.
3. **The Premium Cloud Extractor (Optional SaaS):** For mobile web users who _really_ want an obscure anime that only exists on `mp4upload`, we offer a tiny $3/mo subscription. This unlocks a backend microservice we host (`extract.kunai.app`) that runs `yt-dlp` on our servers, rips the link, and sends it to their phone.

---

## 5. The Monorepo Ecosystem

This architecture demands a Turborepo to share code seamlessly:

```text
kunai/
├── apps/
│   ├── web/               # Next.js App Router (The gorgeous UI, AniList catalog, CORS proxy scraper)
│   ├── cli/               # Ink Terminal App (The hacker's choice, built-in yt-dlp)
│   └── desktop/           # Tauri App (Web UI + CLI power bundled into one)
├── packages/
│   ├── scraper-core/      # The universal engine. Runs in Browser, Node, and Edge.
│   ├── ui/                # Shared Radix/Shadcn components (ArtPlayer wrapper, layouts)
│   └── types/             # Shared TypeScript models
```

### Why this wins:

- **Zero Hosting Costs:** Vercel (Web UI), Cloudflare (CORS Proxy), and Upstash (AniList cache) all have massive free tiers.
- **Unbannable:** We have no central scraping IP. Millions of users = millions of different scraping IPs.
- **Immaculate UX:** No popups, no iframes. Just pure, native video in a custom player.
- **Legally Resilient:** We host no video, we host no scraping servers. We just provide a UI and a client-side scraping engine.
