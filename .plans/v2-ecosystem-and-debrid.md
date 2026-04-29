# Kunai V2 Ecosystem & Debrid Strategy 🥷✨

This document outlines the master plan for turning Kunai from a standalone CLI tool into a massively profitable, self-sustaining ecosystem that rivals Stremio, Netflix, and Crunchyroll in quality, without ever hosting a single video file or scraping server.

This is a V2 strategy document. The implementation must follow the safety constraints in:

- [.plans/kunai-architecture-and-cache-hardening.md](./kunai-architecture-and-cache-hardening.md)
- [.plans/kunai-experience-and-growth-moat.md](./kunai-experience-and-growth-moat.md)
- [.plans/kunai-principal-grill-qa.md](./kunai-principal-grill-qa.md)

Hard constraints:

- Debrid credentials stay local or in user-controlled secure storage.
- Kunai does not sell content; it sells integration, convenience, reliability, and polish.
- Community plugins are local-first and reviewed/sandboxed before they ever become a web ecosystem.
- No arbitrary remote plugin execution in the browser.

---

## 1. The Monetization Engine: The Affiliate Debrid Model

To offer true 4K HDR Blu-ray quality without paying millions of dollars in server bandwidth, we rely on the "Debrid Cache" layer.

**How it works:**

1. Real-Debrid, AllDebrid, and Premiumize already cache petabytes of high-quality torrents on their massive servers.
2. Users pay those services ~$3/month for access to their high-speed APIs.
3. **The Kunai Integration:** We build native UI integrations for these Debrid APIs. When a user clicks "Play", Kunai can use reviewed local providers or user-configured sources to find a candidate hash, send it to the user's Debrid account, and stream the resulting file natively in our `ArtPlayer` or `mpv`.

**How we make money:**
We can embed provider-approved **affiliate links** in the Kunai onboarding wizard and settings page when terms allow it. This should be treated as upside, not the only business model.

- **Cost to Us:** $0 (Debrid hosts the files).
- **Quality to User:** 4K Uncompressed (Better than Crunchyroll/Netflix).
- **Income to Us:** Potential affiliate revenue, plus stronger conversion into Kunai Plus/Pro through a polished Debrid experience.

---

## 2. The Local Plugin Ecosystem (Future-Proofing)

Maintaining 50 different scrapers as streaming sites constantly change their Cloudflare protections is a full-time job. We will not do that forever.

**The Architecture:**

1. The `@kunai/core` package is the standardized provider and resolution engine.
2. We define a strict TypeScript interface (e.g., `interface KunaiPlugin { extract(id): Promise<Stream> }`).
3. Advanced users can write a provider for a new site and install it locally.
4. Kunai loads local plugins only after explicit user approval.
5. Web plugin execution remains out of scope until sandboxing, signing, and review exist.

**The Result:** The community can help with provider churn without turning Kunai Web into an arbitrary-code execution platform. We focus on building the most beautiful, frictionless Video Player and TUI in the world while keeping the default provider set reviewed and diagnosable.

---

## 3. Waterfall Resolution Sorting (The "Wow" Factor)

When a user clicks an episode, they shouldn't have to guess which link is the best. Kunai does the math for them automatically.

1. **Priority 1: Safe cached metadata and source inventory.** Kunai checks local/provider health, known subtitle quality, and prior success before doing expensive work.
2. **Priority 2: Debrid Cache (4K HDR / 1080p Blu-ray).** If the user has a Debrid account, Kunai can prefer high-quality Debrid results. The UI displays a `[4K DEBRID]` badge when confidence is high.
3. **Priority 3: Native HLS Streams (1080p Web-Rip).** If no Debrid, Kunai tries browser-safe or local providers for direct `.m3u8` links. The UI displays confidence, language, and subtitle state.
4. **Priority 4: The Embed Fallback (720p).** If all else fails, local CLI/Desktop can resolve from an iframe using `yt-dlp`.

The user never sees a messy list of 50 dead links by default. They hit "Play" and Kunai chooses the best available route for their device, credentials, provider health, and compute budget.

---

## 4. The Download Manager (Local Only)

We will not build a cloud download queue (which costs massive server bandwidth).

- **The TUI / Desktop App:** Kunai will bundle `aria2c` (an ultra-fast, multi-connection download utility) or leverage `yt-dlp`.
- **The UX:** A user presses `d` in the terminal or clicks a download icon in the Desktop app. Kunai extracts the raw `.mp4` link using the Waterfall strategy above, passes it to `aria2c`, and downloads it directly to their `~/Videos/Kunai` folder at maximum speed.
- **Web App Limitation:** Web users cannot trigger raw downloads due to browser security, but they can easily be prompted to "Install the Desktop App" to unlock lightning-fast batch downloading.
