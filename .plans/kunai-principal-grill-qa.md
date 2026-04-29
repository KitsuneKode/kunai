# Kunai Principal Grill Q&A

Status: Planned

Last updated: 2026-04-29

Use this document when converting Kunai from an exciting architecture into an investable, durable, premium product plan.

This is the hard-question companion to:

- [.plans/kunai-architecture-and-cache-hardening.md](./kunai-architecture-and-cache-hardening.md)
- [.plans/kunai-experience-and-growth-moat.md](./kunai-experience-and-growth-moat.md)
- [.plans/provider-hardening.md](./provider-hardening.md)
- [.plans/cli-ux-overhaul.md](./cli-ux-overhaul.md)

## Premise

Kunai should start capital-efficient, not artificially tiny.

The old framing was "zero cost forever." The stronger company framing is:

```text
Spend almost nothing until product pull is proven.
Spend deliberately once revenue exists.
Invest only in surfaces that increase reliability, retention, trust, or premium conversion.
```

This matters because a $100M-feeling company is not one that refuses to spend money. It is one that knows exactly when spending money produces leverage.

## The Main Bet

### Q: What is Kunai actually trying to become?

Recommended answer:

Kunai is a local-first media runtime that starts by making the CLI feel like the best possible terminal cinema cockpit. Its moat is not raw scraping. Its moat is fault-tolerant playback, provider intelligence, local storage correctness, subtitle/audio/source control, and a level of user experience that makes chaotic sources feel calm.

### Q: What should people remember after using Kunai once?

Recommended answer:

"It just handled everything."

Not "it has many providers." Not "it has a cool terminal UI." The remembered feeling should be:

- playback started faster than expected
- the next episode was obvious
- subtitles behaved
- failures recovered or explained themselves
- source switching felt under control
- the product felt in control

### Q: What is the wedge?

Recommended answer:

Start with the elite CLI because it proves the hardest runtime problems and attracts technical users. Add IPC or a daemon only when the CLI needs multi-process control, player control, or local pairing. Then use web as the growth surface and desktop as the mainstream wrapper once storage, provider, and cache contracts are stable.

The order should be:

```text
CLI/local runtime -> IPC/daemon only if needed -> web surface -> paid sync/convenience -> desktop -> broader social
```

The CLI is the first flagship, not a side quest. It is the proof that Kunai is technically serious and experientially different. The website comes after as the mainstream doorway that translates the same power into a low-friction visual product.

### Q: What is the biggest mistake we could make?

Recommended answer:

Building breadth before reliability.

The danger list:

- many providers but no provider health model
- web app before the CLI runtime is excellent
- paid cloud compute before quotas and entitlements are strong
- social/watch-party before sync is correct
- gorgeous UI that cannot explain failures
- generic CORS proxy that gets abused
- "WASM auth" theater instead of server-side entitlements

## Architecture

### Q: What architecture should we commit to?

Recommended answer:

Eventually, three cooperating tiers:

- Free/local tier: CLI, daemon, desktop, local cache, local Playwright, local yt-dlp, local credentials.
- Web tier: static app, browser cache, narrow provider RPC relay for browser-safe providers.
- Premium cloud tier: sync, device management, account convenience, limited cloud resolver, premium relay budget.

The product should degrade gracefully if any one tier is missing.

Current execution caveat: the active phase is the CLI. Web, desktop, remote sync, paid cloud, account-required flows, and public plugin marketplaces are parked until local playback, storage, cache, subtitles, and diagnostics feel excellent.

### Q: Should the web app depend on cloud compute?

Recommended answer:

No. The web app should be useful without cloud compute:

- browse catalog
- continue watching from local/browser state
- use 0-RAM providers through a narrow relay
- pair with local daemon for heavy providers
- invite upgrade only when cloud convenience would solve a real limitation

Cloud should feel like convenience, not ransom.

### Q: Is the Cloudflare CORS proxy still part of the plan?

Recommended answer:

Yes, but not as a generic CORS proxy.

It must become a provider RPC relay:

```text
POST /rpc/provider/:provider/search
POST /rpc/provider/:provider/episodes
POST /rpc/provider/:provider/sources
```

Rules:

- provider allowlist
- upstream host allowlist
- no arbitrary URL parameter
- no user-controlled upstream headers
- body and response limits
- per-session budgets
- rate limits
- abuse detection
- hard kill switch

### Q: What is the correct Playwright lifecycle?

Recommended answer:

Provider-scoped session leases.

Pure JIT is clean but too slow and fragile for Cloudflare-heavy providers. Permanent sessions are fast but leak-prone. Leases give the middle:

- keep one provider context alive while intent is active
- reap after idle TTL
- hard-kill after max TTL
- expose memory and browser state in diagnostics
- cap concurrent leases

### Q: What is the single most important shared abstraction?

Recommended answer:

`ResolveTrace`.

Every CLI, web, desktop, cache, provider, and premium decision should emit a trace:

- provider selected
- cache layer used
- runtime used
- candidates found
- subtitles found
- source chosen
- fallback tried
- timings
- final outcome

This powers diagnostics, UX trust, provider health, support, and future ranking.

### Q: What should `@kunai/core` contain?

Recommended answer:

It should contain provider contracts, provider capability declarations, pure provider logic, runtime-port contracts, cache key policy, result types, resolver orchestration, source ranking, and resolve tracing. It should not contain app UI, `mpv`, account billing, daemon transport, history/config storage, or platform-specific secrets.

Recommended package shape:

```text
packages/core/
  src/capabilities/
  src/resolve/
  src/cache-policy/
  src/tracing/
  src/ranking/
  src/runtime/

packages/providers/
  src/provider-modules/
  src/extractors/
  src/dossiers/

packages/runtime-browser/
  src/leases/
  src/interceptors/
  src/evidence/
```

### Q: Should we extract providers as a separate package?

Recommended answer:

Yes, but not inside `@kunai/core`. The package should be `@kunai/providers`, backed by `@kunai/core` contracts and resolver policy. The moat is deterministic resolution, ranking, tracing, recovery, and provider isolation rather than simply scraping.

The safe order is:

- define `@kunai/types` and `@kunai/schemas`
- add current-provider compatibility adapters in the CLI
- move storage paths, cache keys, TTL policy, and SQLite repositories into `@kunai/storage`
- define the Provider SDK contract and candidate model
- create `@kunai/providers` and move one low-risk provider module first
- create `@kunai/runtime-browser` before migrating Playwright-heavy provider behavior

Do not big-bang move every provider. That would hide regressions in fallback behavior, history persistence, subtitles, and provider health.

### Q: What is the provider spec we should force every source to follow?

Recommended answer:

Every provider must declare capability, runtime, cache, confidence, and failure behavior before it is treated as production.

Minimum spec:

- provider ID, version, display label, and supported media kinds
- browser-safe, relay-safe, local-daemon-required, or Playwright-required runtime class
- supported operations such as search, episode listing, source resolution, subtitles, and debrid lookup
- normalized input identity requirements
- deterministic cache-key inputs and TTL class
- `StreamCandidate[]` and `SubtitleCandidate[]` output shape
- structured error codes instead of silent `null`
- `ResolveTrace` evidence for every attempt
- provider health delta after success, timeout, parse failure, or upstream block

### Q: Who owns storage and cache writes?

Recommended answer:

Not the provider. Providers emit cache policy and evidence. `@kunai/storage` and the active app surface decide persistence. This avoids corrupt cache ownership when the same core provider is used from CLI, web, desktop, daemon, or tests.

### Q: What should stay app-specific?

Recommended answer:

- Ink shell
- web player UI
- desktop tray
- account pages
- billing
- platform storage adapters
- daemon transport
- premium entitlement checks
- local OS setup flows

## Cache And Performance

### Q: What should Kunai cache aggressively?

Recommended answer:

- title metadata
- search results
- season and episode lists
- posters
- subtitle lists
- provider capability manifests
- provider health summaries
- user preferences
- watch progress events

These caches make the app feel instant without risky provider abuse.

### Q: What should Kunai cache carefully?

Recommended answer:

- HLS manifests
- direct media URLs
- stream headers
- iframe extraction results
- source inventories

These are useful, but they expire quickly and can be provider/session/header specific.

### Q: What should Kunai never cache centrally?

Recommended answer:

- raw playable links from untrusted users
- Real-Debrid credentials
- provider cookies
- local daemon tokens
- signed media URLs in shareable reports
- capability tokens

### Q: Is central geo-aware playable-link caching a good idea?

Recommended answer:

No, not as a default architecture. It sounds magical, but it creates cache-poisoning, legal, privacy, provider-ban, and regional correctness risks. The safer version is local SWR plus central provider-health intelligence.

What we can centralize:

- provider capability manifests
- coarse regional provider health
- catalog metadata
- static mappings
- non-sensitive source inventory when provider policy allows it

What stays local:

- raw `.m3u8` links
- signed URLs
- provider cookies
- debrid-derived playback links
- local daemon tokens
- user-specific headers

The user-facing magic should be "Kunai healed the stream instantly," not "Kunai has a global database of other users' playable links."

### Q: What makes the app feel fast even when providers are slow?

Recommended answer:

Perceived speed comes from:

- instant shell response
- cached metadata
- clear warming states
- prefetch only where intent is strong
- optimistic UI for safe actions
- skeletons only where content shape is known
- source confidence before pressing play
- trace messages that show progress
- fallback happening without blank screens

### Q: Should we prefetch on hover?

Recommended answer:

Only with an intent budget.

Rules:

- cheap 0-RAM providers can prefetch after stable focus
- Playwright providers need stronger intent
- cloud prefetch is almost never allowed
- rapid scrolling cancels prefetch
- only one active title and one active episode warm by default
- next episode warm is allowed after playback starts

### Q: What is the best cache backend?

Recommended answer:

Use SQLite now for the CLI's history, stream cache, provider health, source inventory, and resolve traces. This is a pre-release repo, so do not preserve repo-local `stream_cache.json` or old JSON history as a compatibility contract unless external-user support is explicitly reintroduced. Use IndexedDB for web later. Use edge KV only for public non-sensitive metadata and provider health, not raw streams.

### Q: What should users see about cache?

Recommended answer:

They should not see cache internals by default. They should see confidence:

- `Cached`
- `Ready`
- `Warming`
- `Refreshing`
- `Provider slow`
- `Trying backup`

Power users can open the cache inspector in CLI/Desktop.

## Provider Strategy

### Q: How many providers should V1 support?

Recommended answer:

Fewer, but deeply hardened.

Recommended V1:

- 1-2 strong movie/series 0-RAM providers
- 1 strong anime provider
- 1 hybrid provider behind local daemon
- 1 iframe/yt-dlp fallback path
- Real-Debrid integration as local credential path if it is reliable

Depth beats breadth.

### Q: What makes a provider "production ready"?

Recommended answer:

- capability declaration
- source inventory when possible
- subtitle behavior known
- cache TTL known
- fallback confidence known
- live smoke case
- redacted diagnostics
- provider dossier
- graceful failure labels

### Q: Should provider research live in scratchpads forever?

Recommended answer:

No. Scratchpads are the lab. Production knowledge should graduate into provider dossiers and fixtures.

The flow:

```text
scratchpad -> findings -> dossier -> provider implementation -> smoke case -> health monitoring
```

### Q: Should Kunai support community providers?

Recommended answer:

Eventually, but not early as arbitrary code execution.

Early safe version:

- local-only provider manifests
- reviewed provider packs
- no remote arbitrary JS in web
- strict sandbox later

## Local Daemon

### Q: Is the local daemon optional or core right now?

Recommended answer:

Optional right now.

The current flagship is the CLI. Add IPC first for direct `mpv` control, subtitle/audio/source switching, health reporting, and auto-heal. Introduce a daemon only when we need a separate long-lived local process for web pairing, background provider leases, multi-client control, or durable player orchestration.

### Q: How do we make daemon setup not scary?

Recommended answer:

Make it feel like pairing headphones:

- web says "Pair your device"
- CLI/Desktop shows QR/code
- user confirms
- web gains "Local compute available"
- user sees active connected devices

Do not say "start backend server on port 8080" in product UX.

### Q: What daemon permissions should exist?

Recommended answer:

- catalog read
- stream resolve
- browser resolve
- player control
- library/history sync
- local credential usage

Each paired device should have scoped permissions and revocation.

### Q: Should the daemon auto-start invisibly?

Recommended answer:

For desktop later, yes, with tray visibility. For CLI, prefer no daemon until a concrete multi-process need appears. If a daemon exists, start explicitly or as part of `kunai serve`. For web, never silently start a daemon; web can only pair with one already installed/running.

Invisible is good only after trust has been established.

## Web App

### Q: What must web V1 do beautifully?

Recommended answer:

- fast browse
- continue watching
- source confidence
- custom player
- subtitle controls
- QR pairing
- graceful locked states
- PWA install
- account/sync if premium is ready

### Q: What should web V1 not do?

Recommended answer:

- arbitrary providers
- unlimited cloud resolver
- community plugin execution
- complicated social
- provider debugging UI for normal users
- huge settings wall

### Q: How should locked providers feel?

Recommended answer:

Clear and useful, not frustrating:

```text
Needs local compute
Pair desktop to unlock this source.
```

or:

```text
Cloud convenience available
Use premium cloud resolve when your device is offline.
```

Every locked state needs a next action.

## CLI

### Q: What is the CLI's unique advantage?

Recommended answer:

It can be the fastest, most transparent, most powerful surface:

- keyboard-first
- dense
- diagnostics-rich
- local compute native
- mpv-native
- excellent for power users

### Q: What should CLI V1 feel like?

Recommended answer:

Like Raycast crossed with a terminal media cockpit:

- persistent fullscreen shell
- instant command palette
- source confidence row
- compact trace
- provider health overlay
- no prompt-chain feeling
- no broken terminal state

### Q: Should terminal trailers be a priority?

Recommended answer:

No, not before reliability, posters, and layout stability. Trailer loops are flashy but risky. Build them later as a rare delight, not core UX.

### Q: What CLI features are premium-company-level?

Recommended answer:

- cache inspector
- provider health view
- paired device view
- playback flight recorder
- first-run wizard
- Autopilot mode
- source confidence
- zero-flicker shell transitions

## Desktop

### Q: When should desktop happen?

Recommended answer:

After daemon protocol, cache, and web player are stable.

Desktop should not be a distraction. It should be the polished package of already-proven pieces.

### Q: What should desktop add?

Recommended answer:

- bundled daemon
- tray status
- QR pairing
- safer credential storage
- local notifications
- player bridge
- background sync
- offline cache management

## Premium And Money

### Q: If money comes in, where should we invest first?

Recommended answer:

Invest in reliability and retention before vanity.

Order:

1. provider health infrastructure
2. sync correctness
3. cloud resolver queue and quotas
4. design polish
5. desktop packaging
6. support tooling
7. growth/marketing
8. social/watch-party

### Q: What should premium sell?

Recommended answer:

Convenience, continuity, and confidence.

Premium should include:

- cross-device sync
- device pairing history
- cloud resolve budget
- priority relay
- provider health intelligence
- premium dashboard
- TV/mobile convenience

Do not sell "content." Sell the operating system around user-owned access.

After the core product is reliable, premium can also sell taste and identity:

- themes
- player skins
- polished profile personalization
- premium density/layout presets
- animated recovery and pairing moments
- shareable watch cards
- custom ambience later

This should follow the Cider/Spotify-skins logic: people pay because the product feels better to live in, not because free was made deliberately worse.

### Q: What are the pricing tiers?

Recommended answer:

Start simple:

```text
Free:
  local CLI/daemon, local cache, web basic, limited anonymous relay

Plus:
  sync, devices, priority relay, small cloud resolve budget

Pro:
  larger cloud budget, TV/mobile convenience, family/devices later
```

Keep the tiers understandable. Too many premium knobs will look desperate.

### Q: What metric tells us premium is working?

Recommended answer:

Not signups alone. Track:

- weekly active watchers
- successful playback starts
- resume across devices
- cloud resolve use per paid user
- failed resolve recovery rate
- churn after provider failures
- pairing conversion
- trial-to-paid conversion

### Q: What metric tells us the product is unhealthy?

Recommended answer:

- users search repeatedly but do not play
- users play once and never return
- provider failure causes session exit
- cloud costs grow faster than paid usage
- cache hit rate is low for metadata
- prefetch attempts are high but play conversion is low
- support reports lack enough trace detail

## Legal And Trust

### Q: What is the trust posture?

Recommended answer:

Local-first, credential-minimizing, transparent.

Rules:

- no server storage of user provider credentials
- no central crowd cache of untrusted playable links
- no claim that Kunai hosts content
- clear separation between open client and paid convenience services
- privacy-safe diagnostics

### Q: Should we open source everything?

Recommended answer:

Open source the client, local runtime contracts, provider interfaces, and safe 0-RAM providers if desired. Keep paid cloud orchestration, abuse controls, entitlement services, and operational secrets closed.

Open source should build trust. It should not donate the entire paid infrastructure.

## UX And Design

### Q: What is the product's design signature?

Recommended answer:

Calm, cinematic, sharp, terminal-native where appropriate, web-native where appropriate.

Not neon hacker clutter. Not generic streaming clone. Not glassmorphism everywhere.

The CLI should be the iconic surface: dense, fast, dramatic in restraint, screenshot-worthy without becoming noisy. The web should feel welcoming, tactile, and premium for non-terminal users. They should share intelligence and taste, but not clone each other's layout.

### Q: What are the most important design details?

Recommended answer:

- stable layout
- no layout shift near play controls
- instant command palette
- meaningful loading states
- compact source confidence
- clear disabled reasons
- tabular numbers for time and counts
- tactile controls on web
- minimal animation for repeated actions
- rare cinematic moments only on onboarding, pairing, and recovery success

### Q: How should failures feel?

Recommended answer:

Like a competent assistant is handling it:

```text
Source stalled.
Refreshing manifest.
Trying backup.
Resumed from 12:39.
```

Not:

```text
Error: failed
```

### Q: What is the acquisition-worthy UX?

Recommended answer:

The app makes unreliable, fragmented source ecosystems feel as smooth as a first-party service. That is the valuable product insight.

## Growth

### Q: What gets users in?

Recommended answer:

- beautiful CLI demos
- QR-paired local compute demo
- fast web PWA
- "provider failed but Kunai healed it" clips
- developer-grade docs
- honest local-first privacy story
- tasteful themes/player skins once reliability is already proven

### Q: What keeps users?

Recommended answer:

- accurate continue watching
- next episode always ready
- subtitles remembered
- devices paired
- provider health gets better over time
- failures do not waste their night

### Q: What gets people to pay?

Recommended answer:

- they already trust the free/local product
- they want phone/TV convenience
- they want sync
- they want cloud fallback when their machine is offline
- they understand their monthly budget and feel in control

## Implementation Gates

### Gate 1: Runtime Foundation

Do not ship web/premium seriously until:

- provider capability schema exists
- typed cache policy exists
- resolve trace exists
- local stream cache is reliable
- current CLI runtime is stable
- provider failures have actionable diagnostics

### Gate 2: Local Compute Foundation

Do not market BYOC until:

- daemon runs reliably
- pairing is explicit
- paired device revocation exists
- daemon has scoped permissions
- web can detect and explain daemon availability

### Gate 3: Web Beta

Do not scale web until:

- relay is allowlisted RPC, not generic proxy
- anonymous relay budgets exist
- IndexedDB cache exists
- locked provider states are clear
- player has subtitle and source drawer basics

### Gate 4: Premium

Do not charge for cloud compute until:

- entitlement checks exist
- capability tokens exist
- usage budgets exist
- cloud queue has concurrency caps
- paid dashboard explains usage
- graceful budget exhaustion exists

### Gate 5: Company-Grade Polish

Do not chase mass growth until:

- onboarding is excellent
- support reports are useful
- provider health is visible
- failure recovery is measured
- pricing is simple
- homepage communicates local-first value clearly

## Open Questions To Decide Next

### Q: Which identity wins: KitsuneSnipe or Kunai?

Recommended answer:

Kunai wins. The repository, docs, user-facing copy, install commands, and future packages should use Kunai.

Keep old KitsuneSnipe references only when they describe:

- legacy data migration
- old release compatibility
- historical notes in brainstorms
- temporary code paths that have not moved yet

Do not rename every runtime symbol in the same commit as the Turborepo migration. Treat code-path renames as a separate cleanup pass so behavior changes stay reviewable.

### Q: Which catalog identity is canonical?

Recommended answer:

Use provider-neutral content identity internally, with TMDB/AniList mappings as adapters. Do not let any one catalog provider own the whole data model.

### Q: Which player is canonical for web?

Recommended answer:

Pick one and optimize deeply. ArtPlayer is a reasonable starting point, but the real requirement is HLS control, subtitle control, source switching, mobile controls, and recovery hooks.

### Q: Which database for local storage?

Recommended answer:

SQLite for CLI history, cache, provider health, source inventory, resolve traces, and local playback events. IndexedDB for web later. Do not keep JSON migration compatibility by default during the current pre-release remodel.

Use `bun:sqlite` plus typed repositories first. Do not add a heavy ORM until schema and query complexity prove it is worth the packaging cost.

Use Zod at storage, IPC, relay, provider-response, sync, and imported-dataset boundaries. Use TypeScript for internal contracts.

### Q: Which backend for paid sync?

Recommended answer:

Defer final vendor choice until the event schema is stable. The architecture should work on Supabase, Cloudflare Durable Objects, Fly.io, or a small custom backend.

### Q: Should we build mobile native?

Recommended answer:

Not early. PWA plus local pairing first. Native mobile only after web usage proves demand and app-store constraints are understood.

### Q: What is the first "wow" demo?

Recommended answer:

CLI playback with source confidence, instant next episode, reliable subtitles/audio switching, failure auto-heal, and a visible trace. Then, only after the CLI earns it, web QR pairs with the local runtime and plays through local compute.

That demo tells the whole company story.

## Brutal Priority Stack

If everything feels important, use this order:

1. Playback reliability
2. Provider capability and health
3. Cache correctness
4. Resolve trace and diagnostics
5. CLI persistent shell polish
6. MPV IPC/player-control reliability
7. Local daemon pairing only if needed
8. Web static browse and player
9. Sync event log
10. Premium entitlement and budgets
11. Desktop packaging
12. Social and watch-party
13. Premium personalization and decorative delights

## Final Staff-Level Recommendation

Build Kunai as a reliability company disguised as a beautiful streaming app.

The market does not need another scraper UI. It needs a product that absorbs provider chaos, keeps user state correct, and makes local compute feel elegant.

If Kunai can make broken, fragmented, unofficial sources feel calm, recoverable, and cross-device, that is the premium wedge. That is the hiring-worthy, acquisition-worthy, company-worthy story.
