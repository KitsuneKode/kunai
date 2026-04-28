# Kunai Experience And Growth Moat Plan

Status: Planned

Last updated: 2026-04-28

Use this plan when deciding what to add, what not to add, how the CLI and web should feel, and how Kunai becomes a product users recommend, pay for, and do not want to leave.

This is the product companion to [.plans/kunai-architecture-and-cache-hardening.md](./kunai-architecture-and-cache-hardening.md).

## Product Thesis

Kunai cannot win by merely having more sources. Sources churn. Providers break. Clones can copy screens.

Kunai wins if it becomes the calmest, fastest, most self-healing way to watch across CLI, web, and desktop:

- it remembers where you are
- it knows what is likely to fail
- it warms the next thing without wasting compute
- it recovers without drama
- it explains enough to feel trustworthy
- it turns local compute into a superpower, not homework

The user should feel: "This thing is taking care of the annoying parts for me."

## Product Sequencing

Kunai should be CLI-first, but not CLI-only.

The CLI is the flagship wedge because it is unique, technically impressive, and proves the local-first runtime under the hardest conditions. It should become the product that developers, power users, and early fans show off.

The web app and later desktop/mobile-style app are the mainstream comfort layers. They should make the same intelligence feel easy, visual, playful, and low-friction for people who do not want to live in a terminal.

Recommended sequence:

```text
1. Make the CLI/local runtime excellent and differentiated.
2. Promote the daemon/cache/provider intelligence into stable shared contracts.
3. Build kunai.app as the frictionless mainstream entry point.
4. Add paid sync, cloud convenience, and personalization once users love the core.
5. Package desktop when the web player and daemon are stable.
```

The CLI creates credibility. The web creates reach. Premium creates sustainability.

## Experience Principles

- Speed is a feeling, not only latency.
- Reliability beats novelty.
- Every failure should come with a next action.
- Repeated actions should be instant and mostly unanimated.
- Rare moments can be cinematic.
- CLI and web share intelligence, not identical UI.
- The app should show competence, not internal complexity.
- Premium should sell convenience, continuity, and confidence.
- Premium can also sell taste, identity, and delight after the core product is reliable.

## What We Should Add

### 1. Source Confidence Radar

Every playable item gets a compact confidence state:

```text
Ready
Cached
Warming
Needs local daemon
Needs browser
Provider degraded
Backup available
Cloud available
Subtitles found
Subtitles uncertain
```

Why it matters:

- makes provider chaos legible
- lets users trust the app before pressing play
- turns diagnostics into UX, not a developer-only panel

CLI version:

- one terse status column or right-aligned badge
- details appear in the companion pane or diagnostics overlay

Web version:

- small confidence chips near the play button
- source drawer shows ranked options only when users ask

### 2. Kunai Autopilot

Autopilot is the high-level name for prefetch, auto-heal, fallback, subtitles, and next-episode preparation.

User-facing promise:

```text
Kunai keeps playback alive when providers misbehave.
```

Autopilot features:

- smart next-episode warm
- same-provider source refresh
- provider fallback
- subtitle fallback
- resume timestamp preservation
- trace summary after recovery

Modes:

- `Guided`: asks before fallback
- `Balanced`: auto-fixes once, then asks
- `Aggressive`: keeps trying silently unless quality drops

Default should be `Balanced`.

### 3. Device Pairing And Local Compute Mesh

The killer BYOC experience:

```text
Open kunai.app on phone.
Scan QR from desktop or CLI.
Phone now uses your machine as a private resolver.
```

This converts "install a daemon" from nerd tax into a magic trick.

Add:

- QR pairing
- active device list
- revoke device
- "using Kitsune's laptop" status on web
- "phone connected" status in CLI/Desktop
- optional LAN-only mode

### 4. Continue Watching That Feels Alive

Default home should not be a blank search bar.

Home sections:

- Continue Watching
- New Episodes
- Half-Finished
- Downloaded/Local Ready, if desktop supports it later
- Recently Healthy Providers
- Recommended From Your Watch Pattern, later

This is a retention engine. Search is for intent; home is for habit.

### 5. Playback Flight Recorder

A tiny visible trace that makes the app feel smart:

```text
Resolved from cache in 38ms
Subtitle: English SRT from Wyzie
Provider: Vidking healthy
Backup: Rivestream ready
```

When something fails:

```text
Vidking stalled at 12:41
Refreshed manifest, got 403
Switched to Rivestream
Resumed at 12:39
```

This is also the support moat. Users can share redacted reports.

### 6. Smart Subtitle And Audio Memory

Remember preferences per show, not only globally:

- preferred subtitle language
- sub/dub preference
- preferred quality
- provider preference
- skip intro preference
- subtitle delay correction

This is tiny, but sticky. Users hate redoing this.

### 7. Episode Queue With Intent-Aware Warmth

Add a queue that understands likely next actions:

- current episode
- next episode
- next unwatched episode
- manually queued item
- friend/watch-party item later

Do not prefetch all of it. Warm only the top candidate when budget allows.

### 8. Provider Health Map

User-facing:

- "Vidking is slow right now"
- "Rivestream has better subtitles for this title"
- "Local daemon unlocks 2 more sources"

Internal:

- recent failures
- median resolve time
- subtitle success rate
- stream survival rate
- fallback success rate

This lets Kunai choose better defaults over time.

### 9. First-Run Wizard That Sells The Dream

The wizard should not be a dependency checklist only.

Flow:

```text
1. Pick your home mode: Anime / Movies / Both
2. Check mpv, yt-dlp, browser support
3. Explain local compute in one sentence
4. Optional AniList/TMDB/Trakt-style sync later
5. Optional Real-Debrid local key
6. Play a known-good sample or search immediately
```

Tone:

- sharp
- brief
- confident
- no shame if dependencies are missing

### 10. Premium Convenience Dashboard

Paid users need to understand what they bought.

Show:

- cloud resolves remaining
- synced devices
- last successful local compute pairing
- provider health
- cloud vs local usage saved
- premium features enabled

Sell peace of mind, not raw compute.

### 11. Premium Personalization And Taste

People pay for products that feel good to live in. Cider, Spotify clients, editor themes, game skins, and terminal tools prove that identity and polish can be part of the business when the core experience already works.

Premium personalization should never block core playback. It should make Kunai feel more personal, beautiful, and fun.

Possible premium delight features:

- curated visual themes for CLI and web
- player skins and control layouts
- animated pairing and recovery moments
- custom app icons later
- seasonal interface packs
- poster wall and watch-room ambience later
- advanced command palette themes
- premium typography and density presets
- profile-level subtitle/audio/player preferences
- tasteful activity presence and share cards

Rules:

- do not ship cosmetic premium before reliability is strong
- do not make free ugly
- do not let themes break accessibility or terminal readability
- keep motion optional with reduced-motion support
- sell identity and comfort, not artificial inconvenience

## What We Should Not Add Yet

- Social comments before playback reliability is excellent.
- Watch parties before sync and resume are bulletproof.
- Manga reader inside the terminal.
- Huge recommendation engine before history quality is good.
- AI summaries unless they are cheap, local, and clearly useful.
- Unlimited cloud Playwright.
- Generic public provider plugin execution in the browser.
- A bloated desktop app before the daemon contract is clean.
- Visual trailer loops until image/poster rendering is stable and non-blocking.
- Too many settings before good defaults exist.
- Cosmetic monetization before the free core feels excellent.

## CLI Experience Plan

### CLI Job

The CLI should feel like the flagship weapon:

- instant command entry
- dense lists
- no mouse dependency
- no scrollback dependency
- clear status
- fast recovery
- strong diagnostics

It should be the thing people screenshot, record, and share because it feels impossibly polished for a terminal app.

### CLI Additions

Priority additions:

- persistent root shell
- command palette
- source confidence badges
- playback flight recorder
- Autopilot mode setting
- local daemon pairing display
- provider health overlay
- cache inspector
- first-run setup wizard

High-polish details:

- tabular numbers for times, progress, and counts
- no animation for high-frequency keyboard actions
- subtle spinner only for real pending work
- resize blockers instead of broken layouts
- preview pane collapses before primary list
- command palette opens instantly
- themes preserve contrast and terminal-native clarity
- premium transitions never slow repeated keyboard actions

### CLI Home

Default home:

```text
Continue Watching
New Episodes
Search
Provider Health
Diagnostics
```

The search bar remains prominent, but the home screen should suggest the next useful action.

## Web Experience Plan

### Web Job

The web app should feel native to web:

- fast landing
- beautiful browse
- touch-friendly playback
- direct "play now" path
- QR pair with desktop/CLI
- graceful degradation when local compute is missing

The web app's job is to remove intimidation. Users should not need to understand providers, daemons, caches, relays, or Playwright. They should see a beautiful player, clear source confidence, and useful next actions.

### Web Architecture UX

The web UI should clearly distinguish:

```text
Browser Ready
Local Compute Available
Cloud Convenience Available
Unavailable
```

Do not show users raw architecture. Show capability:

- "Ready on this device"
- "Pair desktop to unlock"
- "Use cloud convenience"
- "Try another source"

### Web Additions

Priority additions:

- Continue Watching home
- source confidence near play buttons
- local daemon QR pairing
- provider/source drawer
- playback flight recorder
- smart subtitles
- installable PWA
- keyboard shortcuts for desktop web
- mobile-first player controls

High-polish details:

- no full-page skeletons after first load
- optimistic navigation for cached surfaces
- warm posters and metadata ahead of interaction
- reduce layout shift with fixed media aspect ratios
- use real disabled reasons on locked providers
- tactile press state on controls
- precise easing for player drawers and source panels

## Desktop Experience Plan

Desktop is not "web in a box." Desktop is web polish plus local superpowers.

Add desktop only when:

- daemon protocol is stable
- local cache model is stable
- web app player is good enough to wrap

Desktop advantages:

- bundled daemon
- tray status
- local notifications
- mpv or native player bridge
- offline cache inspection
- easier QR pairing
- safer local credential storage

## Monetization Plan

### Free Tier

Purpose:

- user growth
- trust
- community
- local-first credibility

Includes:

- CLI
- local daemon
- browser-safe web
- local cache
- local provider resolution
- limited anonymous relay
- basic history local only

### Plus Tier

Purpose:

- mainstream convenience
- recurring revenue

Includes:

- cross-device sync
- device pairing history
- encrypted settings backup
- provider health intelligence
- limited cloud resolves
- priority relay budget
- premium themes and player personalization after core reliability is proven

### Pro Tier

Purpose:

- mobile/TV power users
- people who want convenience without local daemon always on

Includes:

- larger cloud resolve budget
- cloud heavy-provider convenience
- TV/mobile unlocks
- watch rooms later
- advanced diagnostics export
- family devices later
- advanced personalization packs later

### What We Are Actually Selling

Do not say "pay for streams."

Sell:

- continuity
- private local compute
- sync
- convenience
- recovery
- device handoff
- source intelligence
- reduced friction
- taste and identity, only after reliability earns trust

## Growth Loops

### Product-Led Growth

- QR pairing demo is inherently shareable.
- Flight recorder screenshots make failures look impressively handled.
- CLI visual polish attracts developers.
- Web PWA attracts non-technical users.
- Provider health transparency builds trust.
- themes, skins, and shareable ambience create softer consumer growth once playback is strong.

### Developer Credibility

- architecture docs
- provider dossiers
- local-first security story
- clear separation of open client and paid convenience
- strong diagnostics
- clean monorepo

### Community

Add community only around safe contribution surfaces first:

- provider health reports
- docs improvements
- UI themes later
- local-only provider manifests later

Avoid:

- public untrusted stream URL sharing
- public provider execution marketplace until sandboxing and review exist

## Competitive Positioning

### Against Stremio

Win on:

- better first-run setup
- better local daemon pairing
- better source confidence
- better diagnostics
- CLI power user experience
- more polished web UI

Do not fight by:

- blindly copying addon chaos
- centralizing unsafe caches

### Against Streaming Sites

Win on:

- no hostile iframes
- no ad/popup UX
- direct custom player
- fallback and subtitles
- watch continuity

### Against Crunchyroll/Netflix UX

Be careful: they win on licensing and official reliability.

Kunai can threaten on:

- speed of access across sources
- power-user control
- transparent recovery
- local-first privacy
- cross-surface continuity
- CLI/desktop/web uniqueness

The hiring/acquisition-worthy story is not "we scraped harder." It is:

```text
We built a resilient local-first media runtime with provider intelligence,
fault-tolerant playback, cross-device sync, and world-class UX.
```

## The "Cannot Leave" Checklist

Users become sticky when these are true:

- their watch history is accurate
- next episode is always obvious
- playback usually starts fast
- failures recover or explain themselves
- subtitles remember their preference
- switching devices is painless
- the app looks and feels premium
- the app saves them from provider chaos
- setup was easier than expected
- paid tier feels like convenience, not ransom

## Roadmap

### Phase 0: Product Spine

- finalize free/plus/pro boundaries
- define Autopilot modes
- define confidence badge vocabulary
- define home screen sections
- define local daemon pairing UX

### Phase 1: CLI Love

- persistent fullscreen root shell
- command palette
- confidence badges
- resolve trace panel
- cache inspector
- first-run setup
- CLI theme foundation that preserves accessibility and terminal clarity

### Phase 2: Web Love

- static fast home
- continue watching
- source confidence
- QR pairing
- browser cache
- PWA install
- player controls with polished source drawer
- player personalization foundation after the core player is stable

### Phase 3: Paid Convenience

- account sync
- device list
- cloud resolve budget
- premium dashboard
- graceful upgrade prompts
- premium themes and player skins only if free playback already feels excellent

### Phase 4: Moat

- provider health intelligence
- adaptive fallback ranking
- smart subtitle memory
- watch rooms
- device mesh handoff
- desktop shell

## Acceptance Criteria

- first-run users know what Kunai can do within 60 seconds
- returning users see a useful next action without searching
- play attempts show readiness before the user commits
- failures produce a next action or automatic recovery
- local daemon pairing feels intentional and safe
- cloud premium features are useful without becoming required
- CLI and web feel like siblings, not clones
- users can explain why Kunai feels faster even when providers are slow
