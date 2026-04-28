# Kunai Architecture And Cache Hardening Plan

Status: Planned

Last updated: 2026-04-28

Use this plan when shaping Kunai's web, CLI, desktop, local daemon, cloud proxy, cache, provider runtime, paid compute, sync, or security model.

This plan fills the major holes identified in the Kunai master architecture:

- public CORS proxy cost and abuse risk
- weak WASM-as-auth assumption
- JIT Playwright vs persistent hybrid-provider session tension
- unsafe localhost daemon exposure
- provider and cache duplication
- prefetch accidentally becoming provider abuse
- sync conflicts and history corruption
- cloud compute cost control

## North Star

Kunai should feel instant because the system predicts, caches, warms, and explains work intelligently. It should stay cheap because expensive work happens only after user intent is strong, on user-owned compute whenever possible, and behind hard quotas when cloud compute is used.

The product should not depend on a single magical server. It should run as three cooperating tiers:

```text
Tier 1: Static web + client cache
  - fastest, cheapest, most limited
  - catalog, UI, local browser cache, 0-RAM provider logic when safe

Tier 2: Local daemon / desktop compute
  - main power tier
  - Playwright, yt-dlp, mpv, stream cache, provider health, device pairing

Tier 3: Paid cloud convenience
  - narrow escape hatch
  - mobile/TV heavy providers, sync, relay, premium convenience
```

## Non-Negotiable Decisions

- Never build a generic `?url=` CORS proxy.
- Do not treat WASM obfuscation as authentication.
- Do not make hover prefetch unlimited.
- Do not store user provider credentials on Kunai servers.
- Do not centralize playable stream caches from untrusted users.
- Do not make cloud extraction the default path.
- Do not hide recovery decisions from the user forever; show a compact trace.
- Do not let the web app command localhost without explicit pairing.

## Target Architecture

### 1. Web App

Recommended hosting shape:

- Use a mostly static Next.js app first.
- Prefer static rendering and client-side data hydration for browse surfaces.
- Avoid Server Components for every interaction unless they materially reduce bundle or improve first load.
- Keep provider scraping logic in `@kunai/scraper-core`, but expose only browser-safe 0-RAM modules to the web bundle.
- Use Cloudflare Workers or Pages Functions for narrow relay endpoints, not broad app logic.

Why:

- Static pages and client caches are the cheapest traffic shape.
- Provider traffic should not make every title page dynamic.
- The web app should still feel useful when cloud limits are exhausted.

### 2. CORS Relay

Replace the generic CORS proxy idea with a Provider RPC Relay:

```text
POST /rpc/provider/vidking/search
POST /rpc/provider/vidking/sources
POST /rpc/provider/rivestream/search
POST /rpc/provider/rivestream/sources
```

Relay rules:

- fixed provider allowlist
- fixed upstream host allowlist
- fixed path templates
- no arbitrary redirects
- no arbitrary headers from the browser
- strict response size limits
- streaming response bodies where possible
- per-IP and per-session budgets
- Turnstile gate on anonymous spikes
- fail closed when daily budget is exhausted
- structured error codes, not raw upstream stack traces

The relay exists to solve browser same-origin restrictions, not to become Kunai's compute engine.

### 3. Local Daemon

The local daemon is the real power product.

Required shape:

- loopback only
- random high port by default, not permanent `8080`
- one-time pairing token or QR code
- origin allowlist for `kunai.app`
- short-lived session keys
- visible "web client connected" state in CLI/desktop
- local permission scopes:
  - `catalog`
  - `0ram-resolve`
  - `browser-resolve`
  - `player-control`
  - `library-sync`
- no arbitrary URL fetch endpoint
- local rate limits even though it is user-owned compute

Pairing flow:

```text
1. Web app detects candidate daemon via safe discovery.
2. Web app shows "Pair with local Kunai".
3. CLI/Desktop shows a code or QR.
4. User confirms.
5. Daemon grants a scoped, expiring token to that browser origin.
```

### 4. Paid Cloud Compute

Paid cloud compute should be a convenience layer, not the product's default respiratory system.

Allowed cloud jobs:

- heavy provider resolution for mobile/TV users
- iframe extraction when local daemon is unavailable
- sync and activity features
- account entitlement checks
- provider health probes run by Kunai, not by random clients

Not allowed by default:

- unlimited Playwright sessions
- anonymous browser compute
- open relaying
- central stream cache from untrusted users
- cloud storage of user Real-Debrid credentials

Cloud compute auth:

- user account session
- active subscription entitlement
- server-issued capability token
- operation-specific nonce
- replay cache
- per-user daily and monthly budgets
- provider-level concurrency caps
- fraud and abuse counters

WASM signature role:

- keep it only as clone friction or telemetry attestation
- never use it as the only gate to paid compute
- rotate client algorithms without breaking legitimate users
- assume motivated attackers can reproduce it

## Provider Runtime Model

### Provider Capability Types

Every provider should declare:

- runtime: `browser-safe-fetch`, `node-fetch`, `playwright-lease`, `yt-dlp`, `debrid`
- content: `movie`, `series`, `anime`
- source inventory: `single`, `multi-source`, `quality-ranked`
- credential needs: `none`, `local-user-key`, `premium-kunai`
- cache policy: `manifest-cacheable`, `stream-short-ttl`, `never-cache`
- prefetch safety: `safe`, `guarded`, `manual-only`
- fallback confidence: `high`, `medium`, `low`

This should drive UI labels, prefetch rules, cache TTL, and fallback policy.

### Session Leases For Hybrid Providers

Current docs conflict between instant-kill JIT Playwright and persistent provider sessions. The right middle path is a provider-scoped lease:

```text
Lease starts:
  - user selects a hybrid provider
  - user opens an episode picker where hybrid resolution is likely
  - user explicitly warms a provider

Lease stays alive while:
  - user is actively browsing that title/provider
  - a resolve is in progress
  - next-episode prewarm is inside budget

Lease ends when:
  - idle TTL expires
  - memory cap is exceeded
  - provider reports degraded state
  - user switches provider family
  - daemon shuts down
```

Recommended defaults:

- idle TTL: 90-180 seconds
- hard TTL: 10-15 minutes
- max pages per provider lease: 1-2
- max concurrent Playwright leases: 1 by default, 2 on high-memory machines
- aggressive crash cleanup with process group kill

## Cache Strategy

Kunai should have one cache system with multiple layers, not scattered ad hoc caches.

### Cache Layers

```text
L0: In-memory hot cache
  - active session only
  - selected title, episode catalog, current stream candidates

L1: Local persistent cache
  - CLI/Desktop/daemon
  - SQLite preferred, JSON compatibility during migration

L2: Browser cache
  - IndexedDB
  - catalog metadata, posters, user preferences, recent resolve traces

L3: Edge metadata cache
  - public non-sensitive metadata only
  - provider health, app config, feature flags, static catalog snapshots

L4: Paid account sync
  - history, bookmarks, preferences, device state
  - no raw user credentials
```

### What To Cache

Cache aggressively:

- catalog search results
- title metadata
- season and episode lists
- posters and backdrops
- provider capability manifests
- provider health and degradation signals
- subtitle search results
- user settings
- watch history event log
- debrid torrent metadata, if credentials stay local

Cache carefully:

- HLS master manifest URL
- quality variants
- stream headers
- iframe extraction results
- resolved embed links

Do not cache centrally:

- raw playable links submitted by random users
- Real-Debrid API keys
- private cookies
- provider session cookies
- user local daemon tokens
- cloud compute capability tokens

### TTL Classes

```text
catalog-static: 7-30 days
catalog-trending: 15-60 minutes
episode-list: 6-24 hours
poster-image: browser/CDN immutable when URL is content-addressed
subtitle-list: 24 hours
provider-health: 1-5 minutes
stream-manifest: 2-15 minutes
direct-media-url: 30 seconds-5 minutes
provider-session-cookie: provider lease only
cloud-capability-token: 30-120 seconds
```

### Cache Keys

Cache keys must include the real compatibility inputs:

```text
providerId
providerVersion
titleId
titleType
season
episode
audioLanguage
subtitleLanguage
qualityPreference
regionHint
authMode
resolverRuntime
```

If any of these change, reuse can become wrong or user-hostile.

## Prefetch Policy

Prefetch should feel magical, but it must never become accidental scraping spam.

### Intent Score

Only prefetch when intent is strong enough:

```text
+3 selected row stayed active for 400ms
+2 user opened episode details
+2 item is next episode after current
+1 provider is cheap 0-RAM
-3 provider requires Playwright
-2 provider health is degraded
-2 user is rapidly scrolling
-2 battery saver or reduced data mode
-3 cloud budget is near cap
```

Recommended thresholds:

- 0-RAM local/browser: prefetch at score 3
- local Playwright: prefetch at score 6
- paid cloud: prefetch only after explicit click or score 8 with subscription and budget

### Prefetch Budget

Defaults:

- one active title
- one active episode
- next episode only after playback starts or finishes
- cancel in-flight prefetch on rapid navigation
- no prefetch for providers marked `manual-only`
- no cloud prefetch for anonymous users

### User-Facing Labels

The UI should show warm state without making the user learn internals:

```text
Ready
Warming
Needs browser
Cached
Trying backup
Provider slow
Local daemon required
Cloud convenience available
```

## Auto-Heal And Fallback

Auto-heal should be deterministic, debuggable, and user-configurable.

### Health Signals

Detect:

- manifest 403/404
- segment failures
- buffering timeout
- mpv exit reason
- repeated CDN stalls
- subtitle fetch failure
- provider lease crash

### Fallback Ladder

```text
1. retry same manifest if failure looks transient
2. refresh same provider source
3. switch source inside same provider inventory
4. switch compatible 0-RAM provider
5. switch local Playwright provider
6. ask before paid cloud compute
```

The fallback decision should be recorded as a trace:

```text
Vidking 1080p stalled at 12:41
Refreshed manifest, failed 403
Switched to Rivestream 1080p
Resumed at 12:39
```

This is a user-love feature. People forgive failures when the app acts competent and explains itself calmly.

## Sync Model

Replace last-write-wins for watch progress with an event log.

### Event Types

- `playback_started`
- `progress_checkpoint`
- `playback_paused`
- `playback_completed`
- `episode_marked_watched`
- `episode_unmarked_watched`
- `bookmark_added`
- `preference_changed`

Each event includes:

- user ID
- device ID
- monotonic local sequence
- UTC timestamp
- title ID
- provider-neutral content identity
- season and episode when relevant
- playback position

### Conflict Rules

- Settings can use last-write-wins.
- Watch progress should prefer the furthest meaningful progress unless a later explicit user action contradicts it.
- Completed episodes should not be undone by stale partial-progress events.
- Offline device events should merge by sequence, not blind timestamp trust.

## Observability

The product needs a local flight recorder.

### Trace Every Resolve

Capture:

- selected provider
- cache layer used
- prefetch vs fresh resolve
- provider health state
- runtime used
- candidate count
- chosen source
- subtitles chosen
- fallback path
- timing per stage
- user-visible error code

### Privacy Rules

- redact credentials
- redact cookies
- avoid storing full signed media URLs in shareable reports
- reports should be local-first and user-triggered

## Cost Strategy

Use free tiers for launch and development, but design as if the product succeeds.

Current public constraints to design around:

- Cloudflare Workers Free has daily request limits and low CPU budgets.
- Cloudflare Workers Paid starts cheaply, but abuse can still create cost and provider-risk.
- Vercel Hobby has monthly function and CPU limits and is not the right assumption for a commercial-scale app.

Recommended serving split:

```text
Static app:
  Cloudflare Pages/Workers Static Assets or Vercel static hosting

Provider relay:
  Cloudflare Worker, paid plan once public

Realtime sync:
  Supabase/Cloudflare Durable Objects/Fly.io only after account model is real

Cloud Playwright:
  queue-backed worker pool, paid users only, strict concurrency

Images:
  use upstream CDN URLs where legal and allowed, avoid proxying by default
```

Cloud compute should be priced by budget:

```text
Free:
  local compute
  browser-safe 0-RAM relay within anonymous budget
  no cloud Playwright

Plus:
  sync
  device pairing convenience
  limited cloud resolves/month

Pro:
  higher cloud resolve budget
  TV/mobile convenience
  shared watch rooms
```

## Security Gates

### Anonymous Web

- Turnstile during suspicious relay usage
- IP and session rate limits
- provider allowlist
- hard daily budget
- no cloud browser compute

### Signed-In Free

- larger relay budget
- synced preferences
- no heavy cloud compute except tiny trial quotas

### Paid

- entitlement checks
- capability tokens
- operation-specific nonces
- replay cache
- monthly cloud compute budget
- degraded-mode messaging before hard shutoff

### Local Daemon

- pairing
- scoped tokens
- origin checks
- no arbitrary fetch
- visible active clients
- revoke all clients command

## Implementation Phases

### Phase 0: Decisions And Contracts

- define provider capability schema
- define cache key and TTL classes
- define relay RPC shape
- define daemon pairing protocol
- define account entitlement model
- document WASM as friction, not auth

### Phase 1: Local-First Runtime

- migrate provider output to inventory-first stream candidates
- centralize cache service around typed TTL classes
- add resolve trace model
- add local provider health store
- implement prefetch budget manager
- add daemon pairing skeleton

### Phase 2: Web Safe Public Beta

- ship static web shell
- browser IndexedDB cache
- allowlisted relay for 0-RAM providers only
- Turnstile/rate limits/budget counters
- local daemon pairing for heavy providers
- clear "local required" and "cloud convenience" states

### Phase 3: Premium Convenience

- account sync event log
- paid capability tokens
- cloud resolver queue
- cloud concurrency caps
- paid usage dashboard
- graceful budget exhaustion UX

### Phase 4: Scale And Moat

- provider health map
- adaptive fallback ranking
- user-facing source confidence
- drift reports
- device mesh handoff
- watch-party sync only after playback reliability is excellent

## Acceptance Criteria

- web relay cannot fetch arbitrary URLs
- cloud compute cannot be used without server-side entitlement
- local daemon requires explicit pairing
- prefetch has global and provider-specific budgets
- cache reuse is traceable and invalidates on provider/runtime/language changes
- Playwright sessions are leased and reaped
- history sync cannot lose completed episodes because of stale offline writes
- every stream resolve can explain whether it used cache, prefetch, fresh scraping, fallback, local daemon, or cloud
- public launch can survive free-tier exhaustion with graceful degraded states
