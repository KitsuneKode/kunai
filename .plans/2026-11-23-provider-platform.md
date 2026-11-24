# Plan: Provider platform — pluggable sources, a catalog that degrades instead of breaking, and fixes that ship themselves

## Status

- **Status:** PROPOSED. Needs the four decisions at the end before phase 2.
  Phase 0 does not depend on them.
- **Supersedes:** [2026-10-02-signed-provider-profile-feed.md](../.archive/plans/2026-10-02-signed-provider-profile-feed.md)
  (its core shipped in PR #721 as the signed hotfix manifest; this plan
  reconciles the difference, see "What changed since the earlier plans").
- **Reopens, deliberately:** the 2026-09-30 audit's "no generalized plugin
  system". See "Why reopen the plugin decision".

## The problem, measured against the tree

Four things break, and they break for different reasons:

| What breaks                                                       | Why                                                                                                                                                                      | Today's fix path                                                                                        | Time to users                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A stream provider (host move, crypto rotation, new anti-bot step) | Upstream changes; AllManga rotates every constant roughly monthly                                                                                                        | Hotfix manifest for data (mirrors, `deadServers`, crypto constants); a release for anything code-shaped | Minutes for data, days for code                                |
| Search, trending, recommendations, discover — all at once         | One catalog path: TMDB via the Videasy proxy hosts, then direct TMDB with a **borrowed public API key** (`tmdb-proxy.ts`, "same as used in the luffy reference project") | Code change and release                                                                                 | Days, and the key can be revoked at any moment by someone else |
| Anime metadata                                                    | AniList GraphQL only for most of it; Jikan in places                                                                                                                     | Code change and release                                                                                 | Days                                                           |
| Users on npm / package managers                                   | `BinaryAutoUpdater` auto-applies only on the binary channel; npm is notify-only                                                                                          | User runs `npm i -g`                                                                                    | Whenever they notice                                           |

And one structural risk: the official binary ships eleven scraper adapters with
hardcoded hosts. The project, not the user, distributes every scraper.

## Principles

1. **The core never gets worse because of a remote update.** Every remote input
   is signed, versioned, verified before activation, and has a last-known-good
   plus a bundled fallback.
2. **Data before code.** If a fix can be expressed as data (a host, a constant,
   a priority), it ships as data. Code updates exist for what data cannot fix.
3. **Separate the player from the sources.** Kunai core is a player, a library,
   and a catalog. Where streams come from is a pluggable layer with its own
   release train.
4. **Degrade, never blank.** Search, trending and recommendations always show
   something: live, then cached with an age, then a signed snapshot.
5. **The user decides.** Every automatic behaviour has `auto / notify / off`,
   and `/diagnostics` shows what is installed, from where, and why.
6. **The hazards still hold.** No analytics-derived rollout (no `installId`
   without consent), no baked shared hosts (locations live in signed data with
   fallbacks), no stream reported playable without `verifyCandidateStream`, and
   the layering test stays green.

## Target architecture

```text
┌──────────────────────────── Kunai core (binary) ─────────────────────────────┐
│ shell · player · history · downloads · sync                                  │
│                                                                              │
│  Catalog layer                         Stream layer                          │
│  CatalogSource registry                Provider registry + engine (exists)   │
│   capabilities: search, trending,       verifyCandidateStream gate (exists)  │
│   discover, recs, episodes,             ports: fetch, cache, auth (exist)    │
│   schedule, artwork                     ┌──────────────────────────────┐     │
│   health + fallback chain               │ Pack host (new)              │     │
│   durable stale-while-revalidate        │  bundled baseline packs      │     │
│   signed snapshot floor                 │  installed packs (Worker)    │     │
│                                         │  remote addons (HTTP, data)  │     │
│                                         └──────────────────────────────┘     │
│  Update agent (new, unifies three existing mechanisms)                       │
│   tier 0 data manifest (exists) → tier 1 packs → tier 2 binary (exists)      │
└──────────────────────────────────────────────────────────────────────────────┘
          ▲ signed index (static hosting, location itself rotatable)
          │
   CI: provider-status sweep · crypto canary · live gate → build → sign → publish
```

### 1. Catalog layer: many sources, one contract

Introduce `CatalogSource` (in `services/catalog`, contract in `@kunai/types`):
capability flags (`search`, `trending`, `discover`, `recommendations`,
`episodes`, `schedule`, `artwork`), a lane (`movie-series`, `anime`, `video`),
and the existing network-observation and timeout helpers. A registry walks
sources in health order per capability, exactly as `tmdb-proxy.ts` already walks
hosts, but across providers of data, not just mirrors of one.

Candidate sources, all public APIs with real terms of use:

| Source                                    | Lane         | Gives                                     | Key           |
| ----------------------------------------- | ------------ | ----------------------------------------- | ------------- |
| TMDB (Kunai's **own** key, or the user's) | movie-series | search, trending, discover, recs, artwork | yes           |
| TVmaze                                    | series       | episodes, schedule, search                | no            |
| AniList                                   | anime        | search, trending, recs, schedule          | no            |
| Jikan (MAL)                               | anime        | search, recs, schedule                    | no            |
| Kitsu                                     | anime        | search, trending, episodes                | no            |
| Trakt                                     | movie-series | trending, recs                            | yes, optional |

Rules:

- **Remove the borrowed TMDB key.** Register a Kunai key, show TMDB attribution
  as its terms require, and let users set their own key (`tmdbApiKey`) for
  headroom. The Videasy proxy becomes one source among several, not the head of
  the chain.
- **Durable stale-while-revalidate.** Trending, discover and recommendation
  results go to `kunai-cache.sqlite` with a short fresh TTL and a long stale TTL.
  A total outage shows the last result with "updated 3 days ago", never an empty
  rail.
- **Signed snapshot floor (decide after a terms check).** A daily CI job
  publishes trending and popular lists as signed static JSON (ids and titles
  only, artwork resolved live). It makes a cold-start offline-capable rail and
  cuts API load. Check TMDB's redistribution terms before shipping it; if they
  forbid it, keep only the durable local cache.

### 2. Stream layer: packs, addons, and a baseline

Three ways a stream source can exist, in decreasing trust:

1. **Bundled baseline packs.** Today's `packages/providers` adapters, compiled
   in. They are the floor when nothing else is installed or verified.
2. **Installed packs (code).** A pack is one provider built from
   `packages/providers/src/<id>` into a single ESM file plus `pack.json`
   (id, version, `CoreProviderManifest`, hosts it contacts, minimum core
   version, sha256) and an Ed25519 signature. Packs install to
   `dataDir/providers/<id>/<version>/` and the newest verified version wins over
   the bundled baseline.
3. **Remote addons (data).** Sources that speak an HTTP JSON protocol and return
   catalogs and stream URLs. Kunai executes nothing from them. Supporting the
   Stremio addon protocol (`manifest.json`, `/catalog`, `/meta`, `/stream`) gives
   access to an existing ecosystem without running anyone's code. Their streams
   still pass `verifyCandidateStream` before playback.

**Execution model for packs.** Options, with the honest trade-off:

| Model                                          | Isolation                                                               | Cost                                                 | Verdict                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| In-process `import()`                          | none: shares memory, globals and the event loop                         | lowest                                               | only for bundled baselines              |
| **Bun `Worker` per pack, ports over messages** | crash, hang and state isolation; a hung pack is terminated, not awaited | moderate: message hop per fetch                      | **recommended**                         |
| Subprocess or WASM (QuickJS)                   | real sandbox                                                            | high, and packs could no longer reuse shared helpers | only if third-party packs become common |

A Worker is **not** a security sandbox: a pack can still call `Bun.connect` or
read files. Trust comes from the signature, so first-party packs are signed by
the project key and anything else is marked untrusted and needs an explicit
per-pack opt-in, as Tachiyomi-style extension apps do. The Worker gives what
matters day to day: a broken pack cannot hang or crash the shell, can be killed
at its resolve budget, and is hot-swapped without restarting.

**Pack lifecycle.** download → verify signature and sha256 → load in a scratch
Worker → run the pack's `selfTest()` (a canary title through the real resolve
gate) → activate → keep the previous version as last-known-good. A failed self
test keeps the old version active and records why in `/diagnostics`. A pack
whose resolves fail N times in a row after activation is rolled back to
last-known-good automatically.

### 3. Update agent: one pipeline, three tiers

Unify the three mechanisms that exist today behind one signed **index**:

| Tier | What                                                                   | Mechanism                                      | Activation            | Speed   |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------- | --------------------- | ------- |
| 0    | Data: mirrors, dead servers, disables, crypto constants, lane priority | signed hotfix manifest (shipped in #721)       | immediate, verified   | minutes |
| 1    | Packs: provider code                                                   | signed pack bundles                            | after local self test | hours   |
| 2    | Binary                                                                 | `BinaryAutoUpdater` (exists); npm stays notify | next start            | days    |

The index is one small signed JSON document that names the current manifest
revision, each pack's latest version and hash, and the binary's latest version.
Its location is itself data: the binary bakes a short list of locations
(GitHub release asset, Pages), and a signed index can announce a new location.
No location is ever the only one, so no published binary is stranded.

**Policy.** One setting per tier: `auto` (default for tiers 0 and 1),
`notify`, `off`. Users with custom providers or pinned versions keep them:
auto-update never replaces a user-pinned or user-added pack.

**Health-triggered refresh.** The client already knows when a provider is
failing (`provider-health`). When a provider is down locally and the cached
index is older than ~15 minutes, refresh the index now instead of waiting for
the 6-hour interval. This is local evidence only, so it needs no telemetry.

**Staged rollout without telemetry.** A pack entry can carry `rolloutPercent`.
Each install draws a random local bucket once and stores it; nothing is sent
anywhere. A bad pack reaches a fraction of users, and the publisher widens it as
the issue tracker stays quiet.

**Publishing pipeline.** The provider-status sweep and the crypto canary
already detect breakage on a schedule, and the canary now opens an issue. A fix
merges → CI builds the changed packs → runs the live provider gate against them
→ signs with a key held in a protected GitHub environment that needs a
reviewer → publishes the packs and a new index. Clients pick it up on their next
check, or within minutes if they are seeing the failure.

## What comparable apps do (researched 2026-11-23)

The point of this section is to adopt proven mechanisms instead of inventing
workarounds. Sources are linked; claims marked _unverified_ came from secondary
material only.

| App                                                                                          | Where sources come from                                 | Code or data                                                                                                                            | Updates                                                                      | Trust                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Stremio](https://stremio.github.io/stremio-addon-sdk/api)                                   | Addons the user installs by URL; the core ships none    | **Data**: an HTTP addon serves `/manifest.json` and answers `/{resource}/{type}/{id}.json` for `catalog`, `meta`, `stream`, `subtitles` | The addon server changes; the client does nothing                            | HTTPS URL the user chose                                          |
| [Mihon / Aniyomi](https://github.com/Secozzi/aniyomi-extensions)                             | Extension repos the user adds (an `index.min.json` URL) | **Code**: signed APKs                                                                                                                   | Repo index lists versions; the app offers updates                            | APK signatures; repo-level signing-key fingerprint (_unverified_) |
| [Cloudstream](https://th4mjeed.github.io/posts/cloudstream-plugin/)                          | `repo.json` → `pluginLists` → `plugins.json`            | **Code**: compiled plugins implementing one `MainAPI` (home, search, load, links)                                                       | `plugins.json` carries version and, in newer tooling, `jarHash`              | Repository the user added                                         |
| [Seanime](https://seanime.gitbook.io/seanime-extensions) (desktop, anime — closest to Kunai) | Extensions installed from a `manifest.json` URL         | **Code**: JS/TS run in an embedded engine (Goja), no Node or browser APIs; plugins declare permissions for commands and files           | Each manifest carries a `manifestURI` the app re-checks                      | Declared permissions; repos unaffiliated with the app             |
| [Kodi](https://kodi.wiki/view/Add-on_repositories)                                           | Repository add-ons with an `addons.xml` index           | Code (Python add-ons)                                                                                                                   | `addons.xml.md5` is a change marker so clients skip re-downloading the index | The checksum is explicitly _not_ a security check; no signing     |
| [Jellyfin](https://jellyfin.org/docs/general/server/metadata)                                | Metadata providers as plugins                           | Code                                                                                                                                    | Plugin catalog                                                               | Ordered per-library provider list with sequential fallback        |

What this means for the plan:

1. **No comparable app ships scrapers in its core.** Every one of them installs
   sources from repositories the user adds. Decision 2 option (b), "no bundled
   scrapers, first run offers the official repository", is the industry norm,
   not an outlier. The recommendation stays (a) for now, but (b) is the
   destination, not an optional extra.
2. **Two mechanisms, both proven.** A remote, data-only addon protocol
   (Stremio) and local code extensions (Mihon, Cloudstream, Seanime). Kunai
   should support both, as phase 2 and phase 4 already propose. Supporting the
   Stremio protocol directly beats inventing a Kunai-only addon protocol.
3. **Isolate packs with an embedded engine, not just a Worker.** Seanime, the
   nearest analogue, runs extension code in an embedded engine without host
   APIs and grants capabilities through declared permissions. A Bun `Worker`
   still has every Bun API. The phase 2 Worker is the right first step for
   first-party signed packs; for third-party packs, plan an embedded runtime
   (QuickJS compiled to WASM) that only sees the provider ports (`fetch`,
   `cache`, `emit`), with each pack's manifest declaring the hosts it may
   contact.
4. **One manifest per pack with its own update URI.** Seanime's
   `manifestURI` pattern (each manifest says where its next version lives) plus
   Cloudstream's per-artifact hash is simpler than a central index for
   third-party packs. Keep the signed central index for first-party packs.
5. **Change markers are not security.** Kodi's `addons.xml.md5` only tells the
   client whether to re-download. Kunai's Ed25519-signed index with per-pack
   sha256 is stronger than the norm; keep it, and use ETag or revision checks
   as the cheap change marker.
6. **Ordered metadata providers per lane.** Jellyfin's per-library ordered
   providers with fallback is what the `CatalogSource` registry is. Let the
   user reorder sources per lane in Settings, as Jellyfin does.
7. **Anime id mapping from a dataset, not per-request lookups.** The Jikan
   fallback maps each entry through an ARM request (up to 15 per load). The
   cleaner approach is an offline cross-site id dataset such as
   [manami-project/anime-offline-database](https://github.com/manami-project/anime-offline-database)
   or [Kometa Anime-IDs](https://github.com/Kometa-Team/Anime-IDs), refreshed
   weekly into `kunai-cache.sqlite` and looked up locally, with ARM as the
   fallback for new titles. Check each dataset's licence (ODbL or similar)
   before shipping it.

## Legal posture: what actually changes

This is not legal advice, and it does not make scraping legal. It changes who
distributes what:

- **Remove the borrowed TMDB key** and comply with TMDB attribution. This is
  the clearest current issue and needs no architecture.
- **Core distributes no scraper by default** (decision 2). The official binary
  is a player, a catalog client and an SDK. Stream sources arrive as packs or
  addons from a repository the user adds. Distributing a neutral client, while
  scrapers live in separately published repositories, is the model the major
  extension-based apps use.
- **First-class legitimate sources** make the default useful without scrapers:
  YouTube (exists), Internet Archive, and the user's own Jellyfin, Plex or Emby
  servers and local files.
- **Keep the README disclaimer** and add a source-attribution line in
  `/diagnostics` so every stream says which pack or addon produced it.

## Why reopen the plugin decision

The audit rejected "a generalized plugin system to avoid maintaining twelve
explicit adapters." That reasoning still holds: packs do **not** reduce
maintenance, because each adapter stays an explicit module with its own tests.
The reasons to proceed anyway are different and new:

1. **Delivery speed.** Code-shaped provider fixes currently need a full binary
   release. Packs ship them in hours, with verification and rollback.
2. **Distribution separation.** Decoupling the scrapers from the core binary
   is the legal lever described above.
3. **Failure isolation.** A Worker per pack contains hangs and crashes, which
   in-process modules cannot.

The audit's warning still applies to _how_: no universal provider superclass,
no new framework. The pack is a build artifact of the existing
`CoreProviderModule`, and the existing engine and gate run it.

## What changed since the earlier plans

The signed-profile-feed plan said "data only: no URLs, no remote control of
enabled providers or ordering." The hotfix manifest shipped in #721 carries
mirrors, `deadServers`, `disabled` and lane priorities. That is defensible,
because those fields are what fixes provider outages, and it is now guarded
(HTTPS and private-host checks per hop, revision and body pinning,
`rollback`/`reset` holds). But the earlier plan and the shipped code disagree.
This plan replaces it, and `.docs/providers.md` is the source of truth for the
manifest's behaviour.

## Phases

### Phase 0 — stop the bleeding (no decisions needed)

- Replace the borrowed TMDB key with a Kunai key plus an optional user key, and
  add TMDB attribution.
- Durable stale-while-revalidate for trending, discover and recommendations.
- Add TVmaze (series episodes and schedule) and Kitsu (anime) as fallback
  sources behind the existing TMDB and AniList calls.
- Health-triggered hotfix-manifest refresh.

### Phase 1 — catalog contract

- `CatalogSource` contract and registry; move search, trending, discover,
  recommendations and schedules behind it, one capability at a time.
- `/diagnostics` shows which source answered each catalog request.
- Decide on the signed snapshot floor after the terms check.

### Phase 2 — packs (needs decisions 1, 3)

- Pack format, build script, signing, and verification (reuse the manifest's
  Ed25519 code and key handling).
- Worker pack host behind the existing provider ports; bundled baselines keep
  running in-process.
- Self test, activation, last-known-good, automatic rollback.
- CI: build, gate, sign and publish changed packs.

### Phase 3 — update agent

- The signed index, rotatable locations, per-tier `auto / notify / off`
  settings, staged rollout by local bucket, and a Settings page for installed
  packs.

### Phase 4 — repositories and addons (needs decisions 2, 4)

- User-added pack repositories with an untrusted-source warning.
- Stremio addon protocol adapter for catalogs and streams.
- Decide the official build's composition and publish the first-party packs
  repository.

## Decisions needed

1. **Code-delivered packs.** Reopen the audit decision and allow signed packs
   run in a Worker? _Recommendation: yes, first-party signed packs only at
   first._
2. **What the official binary ships.** (a) bundled scrapers as today plus
   packs, which keeps the best first-run experience and the current legal
   posture; (b) no bundled scrapers, with first run offering to add the official
   packs repository, which gives more distance for one extra step; or (c) the
   project publishes no scrapers and community repositories host them, which
   gives the most distance and the least control. _Recommendation: (a) now,
   with the architecture built so (b) is a build flag._
3. **Hosting and key custody.** Where the index and packs are served from, who
   holds the signing key, and the revocation story. _Recommendation: GitHub
   releases plus Pages as two locations; key in a protected Actions environment
   with a required reviewer; a second offline key that can sign a "revoke and
   rotate" index._
4. **Stremio addon protocol.** Support it? _Recommendation: yes in phase 4. It
   is the cheapest large pluggability win and executes no remote code._
