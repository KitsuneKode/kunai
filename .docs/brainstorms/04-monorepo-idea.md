# Kunai Monorepo Architecture & Execution Strategy 🥷✨

## 1. The Monorepo Structure (Turborepo)

Moving to a monorepo allows us to share the elite scraping logic we've built across multiple platforms (CLI, Web, Desktop) without rewriting any code.

### Proposed Directory Layout

```text
kunai/
├── apps/
│   ├── cli/               # The Ink-based terminal app (formerly KitsuneSnipe)
│   ├── web/               # Next.js Web Player & Documentation (Astro/Next)
│   └── desktop/           # (Future) Tauri or Electron desktop wrapper
├── packages/
│   ├── scraper-core/      # The universal scraping engine (Vidking, Rivestream, Anikai, Miruro)
│   ├── core-types/        # Shared TypeScript interfaces (StreamSource, Episode, SearchResult)
│   ├── ui-cli/            # Shared Ink components (tables, spinners, prompts)
│   └── ui-web/            # Shared React components (custom Video player, cards)
├── package.json           # Root workspace config (npm/bun workspaces)
└── turbo.json             # Turborepo pipeline config
```

### Why this structure?

- **`packages/scraper-core` is the heart of Kunai.** It contains pure, platform-agnostic functions like `searchAnime()`, `getEpisodes()`, and `extractStream()`.
- If we update the Cloudflare bypass for Anikai in `scraper-core`, both the CLI and the Web app get the fix instantly.

---

## 2. The "Client-Side vs. Server-Side" Question

You asked: _"Rather than computing those again can we do it in the client side? Such that we get fast implementation and also the power to change the data and stream and everything?"_

**This is a brilliant architectural question, and the answer is YES, but it depends on the platform.**

Here is how the execution strategy breaks down across the monorepo apps:

### A. The CLI App (`apps/cli`) -> 100% Client-Side

- **How it works:** The CLI runs entirely on the user's local machine via Node.js/Bun.
- **Execution:** It imports `scraper-core` and executes the 0-RAM `fetch` requests and the Playwright headless browser _directly on the user's hardware_.
- **Benefits:**
  - Zero server costs for us.
  - Bypasses rate-limiting because every user scrapes from their own unique IP address.
  - Full client-side control over the stream data (which is why `mpv` works so well).

### B. The Desktop App (`apps/desktop` - Electron/Tauri) -> 100% Client-Side

- **How it works:** Exactly like the CLI, a desktop app runs locally. Electron has a hidden Node.js backend.
- **Execution:** It runs `scraper-core` locally. It can launch a hidden Playwright instance or just use raw `fetch` for 0-RAM providers.
- **Benefits:** The exact same benefits as the CLI, but with a beautiful graphical interface and a custom built-in video player instead of relying on `mpv`.

### C. The Web App (`apps/web` - Next.js) -> Hybrid (Edge + Server)

This is where it gets tricky. A standard web browser (like Chrome running your website) **cannot** launch a headless Playwright browser inside itself due to security sandboxing.

- **0-RAM Providers (Vidking, Rivestream):**
  - These use pure `fetch`. We _could_ run them 100% client-side in the user's browser, but we will likely hit **CORS (Cross-Origin Resource Sharing) blocks** (e.g., Vidking's server won't accept a fetch request originating from `kunai.app`).
  - _Solution:_ We run the 0-RAM scrapers on **Next.js Edge Functions**. Edge functions are serverless, instantly fast, and incredibly cheap. They act as a proxy: User Browser -> Edge Function (Scraper) -> Vidking.
- **Hybrid Providers (Anikai, Miruro):**
  - Because these require Playwright to bypass Cloudflare TLS fingerprinting, they **must** run on a Node.js server.
  - _Solution:_ We host a lightweight Node backend (or Next.js API route) that runs Playwright.

### The Ultimate Client-Side Play: "Bring Your Own Compute"

If we want the Web App to be completely serverless/free for us to host, we can offer a **"Local Kunai Daemon"**.

1. The user installs the `kunai` CLI.
2. They run `kunai serve`. The CLI starts a tiny local web server on `localhost:8080`.
3. The user opens the Kunai Web App (`kunai.app`).
4. The Web App detects the local daemon and delegates **ALL** scraping (including Playwright) to the user's local machine!
5. **Result:** A beautiful web interface, but 100% of the compute, scraping, and streaming happens client-side. Zero server costs, zero IP bans.

---

## 3. Migration Plan (How to get there)

1. **Initialize Turborepo:** Run `bunx create-turbo@latest` in a new branch.
2. **Scaffold Packages:** Move the code we wrote in `scratchpads/provider-*` into `packages/scraper-core/src/providers/`.
3. **Standardize the API:** Ensure every provider exports the exact same TypeScript interface:
   ```typescript
   interface Provider {
     name: string;
     search(query: string): Promise<SearchResult[]>;
     getEpisodes(animeId: string): Promise<Episode[]>;
     getSources(episodeId: string): Promise<StreamSource[]>;
   }
   ```
4. **Migrate the CLI:** Move the current `kitsunesnipe` codebase into `apps/cli/`. Update its imports to use `@kunai/scraper-core`.
5. **Build the Web Player:** Initialize a Next.js app in `apps/web/`. Hook it up to `@kunai/scraper-core` via API routes, and build a sleek `video.js` frontend to pipe the `.m3u8` links into.
