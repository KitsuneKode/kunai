---
status: current
lastReviewed: 2026-08-14
---

# Kunai — Glossary

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Terms whose confusion has caused real bugs. This is not a type index — a term
earns a row here by naming a distinction that is easy to get wrong, and every
row cites the code that settles it.

Paths are backtick-quoted and repo-root-relative, so `bun run verify:doc-paths`
fails when one moves. **Code wins.** If an entry disagrees with the tree, the
tree is right and the entry is the bug.

---

## Shell mode vs Provider lane

Both are `"anime" | "series" | "youtube"`. They are not the same thing.

- **Shell mode** (`ShellMode`) is shell UI state — which mode the user is in.
- **Provider lane** (`ProviderLane`) is provider routing — which providers are
  eligible.

Both in `apps/cli/src/domain/types.ts`. Convert deliberately via
`shellModeToProviderLane` / `providerLaneToShellMode` in
`apps/cli/src/domain/provider-lane.ts`; never assign one to the other because
the unions happen to match.

> **Known defect:** `ProviderLane` is declared twice, identically, in
> `apps/cli/src/domain/types.ts` and `packages/types/src/index.ts`. Neither is
> marked canonical. Tracked on `.plans/roadmap.md`.

## Anime mode: `isAnime` vs `isAnimeProvider`

`TitleInfo.isAnime` (`apps/cli/src/domain/types.ts`) is **persisted content
classification only — never routing.** Its own comment says so.

`isAnimeProvider: true` on provider metadata is what actually puts a provider in
anime mode. This is an `AGENTS.md` non-negotiable. Lane resolution reads provider
metadata and media kinds, not the title flag — see `resolveProviderLaneFromMetadata`
in `apps/cli/src/domain/provider-lane.ts`.

## Episode vs absolute episode

`EpisodeInfo.episode` is season-relative and **1-based in the UI**. `absoluteEpisode`
is anime episode identity used when season/episode mapping is unavailable or
secondary. Both in `apps/cli/src/domain/types.ts`.

They are not interchangeable. Providers that prefer `absoluteEpisode` without
catalog proof are open audit finding **K-17**.

## Cache provenance

`StreamInfo.cacheProvenance` (`apps/cli/src/domain/types.ts`) describes how a
**successful** stream was obtained: `fresh`, `cached`, `revalidated`, `refetched`,
`prefetched`, `fallback`, `expired`.

`fallback` here means "served from a fallback cache tier" — it is a success
value, not a failure. Substring-matching it (or any prose containing "fallback")
to infer failure is what made "Trying another source" render during healthy
resolves. Classify from typed state, never from prose.

## Canonical catalog title id

`resolveCanonicalCatalogTitleId()` in `packages/core/src/title-identity.ts` —
the stable catalog key for history, continue-watching, and cross-provider merge.

Not the same as a provider's own title id. The `contentClass` option lets an
anime work that arrived through the TMDB/series lane keep its AniList/MAL history
unit; pure western series are never forced. Every offline lookup resolves through
one title id.

## Resolve trace vs analytics

Two different things are called telemetry. Do not conflate them.

- **Resolve trace** — local-only, full detail, never leaves the machine. Built by
  `packages/core/src/trace.ts`, persisted through
  `apps/cli/src/services/diagnostics/ResolveTraceSink.ts`, wired in production in
  `apps/cli/src/container/bootstrap-persistence.ts`.
- **Analytics** — opt-in product telemetry that does leave the machine
  (`apps/telemetry-ingest`). Payload-bounded by
  `.docs/telemetry-privacy-contract.md`, and deliberately cannot carry a title
  id — so it can never diagnose a resolve.

A resolve question is answered by traces, never by analytics.

## Download job vs offline asset

- **Download job** (`DownloadJobRecord`, `packages/storage/src/repositories/download-jobs.ts`)
  is the _transfer_: `queued`, `running`, `completed`, `completed-with-notes`,
  `repairable`, `failed`, `aborted`.
- **Offline asset** (`OfflineAssetRecord`, `packages/storage/src/repositories/offline-assets.ts`)
  is the _resulting playable file_: `ready`, `missing`, `invalid-file`,
  `repairable`. It links back via `originJobId`.

**A completed job does not imply a playable asset.** Publication is a separate
step, which is why crash recovery is its own machine (audit finding K-12).

## History bucket vs continuation

- **History bucket** (`apps/cli/src/domain/continuation/history-bucket.ts`) is the
  single authority for which `/history` tab a title belongs in: `continue`,
  `completed`, `new-episodes`. It decides off authoritative release status and
  never fabricates one.
- **Continuation** (`apps/cli/src/domain/continuation/ContinuationEngine.ts`)
  decides what to _offer_ next: `play-local`, `watch-online`, `download-more`,
  `browse-offline`.

"New episode" means aired **since the user last watched** — not merely unwatched.
A backlog you haven't got to is `continue`, not `new-episodes`.

## Endpoint health and quarantine

`apps/cli/src/services/playback/ProviderEndpointHealthService.ts`. Quarantine is
per-endpoint, persisted, and time-boxed: `route-dead` for 24h, `server-error` for
1h, with a 60s transient cooldown.

Two independent triggers exist because the original two-distinct-titles rule
never fired in normal single-title viewing; three consecutive `server-error`
failures on one endpoint now quarantine on their own. A cancelled attempt is not
a failure — timeout and cancel must stay distinct, or hedging losers poison
healthy endpoints.

## Playback source: local vs online

`apps/cli/src/domain/playback-source/SourceSelectionEngine.ts` chooses per
episode, from an entrypoint (`online-search`, `continue`, `offline-library`) and
a preference (`ask`, `prefer-local`, `prefer-online`).

`apps/cli/src/domain/playback-source/offline-availability.ts` answers "is this
downloaded?" for badges and that decision — built once, queried many times.
Offline is a _source_, not a separate pipeline.

## Provider vs production provider

A module existing under `packages/providers/src/` does **not** make it live.
Production providers are exactly those returned by
`loadProductionProviderModules()` in
`apps/cli/src/container/bootstrap-providers.ts`. This is an `AGENTS.md`
non-negotiable.

Treat anything else under `packages/providers/src/` as research until it appears
in that loader.

## Support bundle

`apps/cli/src/services/diagnostics/support-bundle.ts` — the redacted diagnostics
export a user hands over. It is payload-bounded and redacted through
`bundle-redaction.ts`; **no stream URLs**.

It must export every category in `DIAGNOSTIC_CATEGORIES`
(`apps/cli/src/services/diagnostics/diagnostic-event.ts`). Dropping a category
silently is what made issue #20 undiagnosable (audit finding K-02).
