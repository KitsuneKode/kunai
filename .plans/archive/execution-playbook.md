# Kunai Execution Playbook (The Way Forward) 🥷✨

This document serves as the final bridge between the planning phase and the execution phase. It defines the strict architectural boundaries, the UI design sense, and the exact order of operations to build the $100M ecosystem.

---

## 1. Architectural Boundaries (Strict Separation of Concerns)

To guarantee flawlessness, the codebase is split into three impenetrable layers. They must never leak into each other.

### Layer 1: `@kunai/providers` (The Grunts)

- **The Job:** Handle the messy reality of the internet.
- **The Rules:** It accepts a standardized ID (AniList or TMDB). It handles Cloudflare, WASM decryption, retries, and mirror looping internally. It returns a pure `StreamSource` object.
- **Forbidden:** It cannot access the UI, it cannot store watch history, and it cannot talk to the user.

### Layer 2: `@kunai/core` (The Orchestrator)

- **The Job:** Act as the traffic cop and brain of the operation.
- **The Rules:** It manages the **SWR Cache** (Stale-While-Revalidate). It coordinates the **Fallback Loop** (e.g., if Provider 1 fails, call Provider 2). It handles **Title Mapping** (translating AniList ID 21 to TMDB ID 37854 for Vidking).
- **Forbidden:** It cannot render UI elements.

### Layer 3: `apps/cli` & `apps/web` (The UI/UX)

- **The Job:** Look incredibly beautiful and respond in 0ms.
- **The Rules:** It fetches gorgeous metadata and exact release dates from AniList/TMDB. It passes user clicks to `@kunai/core`. It renders the `ArtPlayer` or launches `mpv`.
- **Forbidden:** It cannot write scraping logic. It cannot decrypt video streams.

---

## 2. UI Design Sense (The "Priceless" Feel)

The UI must never feel like a pirated movie site. It must feel like an elite, premium product.

- **Zero Spinners for Cached Data:** If a user opens their watchlist, it must load instantly from the local SQLite cache. No network wait.
- **Deterministic Fallbacks:** The user never selects "Server 1" or "Mirror 2". The UI simply has a large "Play" button. The chaos of cycling through 5 dead links happens silently in the background via `@kunai/core`.
- **Quality & Subtitle Confidence:** The UI must display explicit badges (`[4K DEBRID]`, `[1080p SUB]`, `[HARDSUB]`) returned by the core, so the user knows exactly what they are clicking.
- **AniSkip Integration:** The UI passes OP/ED timestamps to the player. The video skips intros natively. The user's hands never touch the keyboard.

---

## 3. Immediate Next Steps (The Execution Order)

We have mapped the entire universe in the `apps/experiments/` scratchpads. Now, we execute.

### Phase 1: Build `@kunai/providers`

1.  Initialize the package in `packages/providers/`.
2.  Define the `IProvider`, `StreamSource`, and `ResolutionTrace` interfaces.
3.  Port the 0-RAM Miruro (Backend API) script into a class.
4.  Port the 0-RAM Rivestream (MurmurHash) script into a class.
5.  Port the Hybrid Anikai (Playwright + Mirror Loop) script into a class.

### Phase 2: Build `@kunai/core`

1.  Initialize the package in `packages/core/`.
2.  Build the `Resolver` class that orchestrates the providers and handles the fallback ladder.
3.  Build the SWR (Stale-While-Revalidate) Cache logic using SQLite.
4.  Implement the Local Mapping JSON downloader (MAL-Sync).

### Phase 3: The CLI Overhaul (`apps/cli`)

1.  Strip out the old, messy scraping logic from the legacy CLI.
2.  Hook the CLI up to the new `@kunai/core` package.
3.  Implement the `AbortSignal` bindings so hitting `Ctrl+C` instantly kills Playwright memory leaks.
4.  Implement the `mpv` IPC auto-heal socket.

### Phase 4: The Next.js Web App (`apps/web`)

1.  Build the Cloudflare CORS Proxy to enable 0-RAM fetching in the browser.
2.  Build the Local Daemon pairing (`localhost:8080`) so Web users can offload Playwright tasks to their PC.
3.  Build the TypeScript Extractor Unpackers for `megaup` and `mp4upload` to keep the Web Player ad-free.
