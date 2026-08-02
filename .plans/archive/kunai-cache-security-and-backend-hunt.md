# Kunai Cache Security & The Backend Hunt 🥷✨

This document outlines the final two pillars of the Kunai architecture: securing the global edge cache from malicious actors while keeping costs at $0, and aggressively bypassing frontend wrappers (like Anikai/Miruro) to communicate directly with their hidden 3rd-party backend databases.

---

## 1. The Zero-Trust Cache Security Model

Allowing thousands of anonymous CLI users to freely write `.m3u8` links into our central Upstash Redis database is a massive security vulnerability. A single malicious script could inject a pornographic or malware iframe URL, instantly destroying the reputation of the Kunai Web App.

**The Solution: The "Trusted Harvester" Architecture**

1. **Read-Only Public Access:** The millions of users on the Kunai Web App and free CLI users only have **READ** access to the central cache. If the cache misses, the Web App routes the scrape to the user's local daemon (BYOC), which scrapes the link _only for themselves_. They do not upload it.
2. **The Trusted Server (Write Access):** Only our official, closed-source backend server (the one powering the $3/mo Premium Tier) has the authentication keys to **WRITE** to the central Redis cache.
3. **How the Cache gets populated:**
   - When a Premium user requests an episode on their mobile phone, our Trusted Server runs the Playwright/0-RAM scraper in the cloud.
   - Because our Trusted Server executed the scrape, we mathematically guarantee the resulting `.m3u8` link is clean and safe.
   - The Trusted Server writes that pristine link to the Redis cache.
   - The next 10,000 free Web App users instantly benefit from that cached link.

**Utilizing Free Users Safely (Telemetry):**
We still utilize the massive swarm of free CLI users, but not for links. When a free user's local daemon successfully watches a stream, it sends a tiny, sanitized telemetry ping to our server: `{"provider": "miruro", "status": "healthy", "latency": 120ms}`. This allows us to build a global, real-time "Provider Health Dashboard" without risking URL injection.

---

## 2. The Backend Hunt (Bypassing Wrappers)

You correctly identified that sites like HDToday, Cineby, Anikai, and Miruro are rarely hosting the videos themselves. They are almost always UI wrappers built on top of massive, hidden 3rd-party databases (like `videasy.net`).

If we rely on our JIT Playwright scraper to navigate Anikai's frontend, we are at the mercy of Cloudflare. **We must hunt for the backend.**

**The Strategy:**

1. **Network Sniffing for the API:** Inside our `apps/experiments/` laboratory, we will sniff the exact XHR/Fetch requests Anikai and Miruro make _after_ Cloudflare clears. We are looking for the hidden API (e.g., `api.anikai-backend.com`).
2. **Direct ID Construction (The Holy Grail):** We will analyze the API payload to see if the hidden database maps anime using standard `AniList` or `MAL` IDs.
3. **The 0-RAM Conversion:** If we discover that Miruro's backend simply accepts an AniList ID (e.g., `https://api.miruro-backend.tv/v1/source?anilistId=101922`), we completely abandon the Playwright frontend scraper.
   - We construct the URL dynamically.
   - We fetch the raw encrypted JSON.
   - We decrypt it locally in Node.js.
   - **The Result:** We turn the heaviest, most Cloudflare-protected sites into lightning-fast, True 0-RAM providers.

By aggressively hunting for the backend APIs and securing our cache writes behind Trusted Servers, Kunai becomes an impenetrable, instantaneous, zero-cost streaming engine.
