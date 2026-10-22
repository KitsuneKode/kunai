# R04 — Exact offline source authority and complete library queries

Status: WAITING FOR R02/R03 CONTRACTS; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Play the selected downloaded artifact without its original provider, including large libraries and continuation.
**Architecture:** App resolves local/provider source authority before provider acquisition; repository performs indexed identity queries; both sources use the existing player/history lifecycle.
**Tech stack:** TypeScript, SQLite, mpv, app/session handoffs.
**Spec:** Audit A18/A19 and [provider-independent owner](./offline-provider-independent-playback.md); [offline contract](../.docs/download-offline-onboarding.md).
**Dependencies:** R03 claim/deletion contract and storage migration freeze; R02 lifecycle results.

## Review focus

1. Selecting job B launches B even when A shares title/episode but differs in profile or native identity.
2. Verified local playback never requires a registered provider or network.
3. Episode 101+ and filtered items beyond display limits remain reachable.
4. Local resume, sidecars, next, cancellation and history stay on the unified lifecycle.
5. Missing/untrusted artifacts return an actionable local failure; offline mode never falls through online.

## R04.1 — Carry exact launch intent (A18)

Allowed edits: `apps/cli/src/app/offline/offline-playback-launch.ts`, `apps/cli/src/app/playback/PlaybackPhase.ts`, `apps/cli/src/app/playback/episode-playback-source.ts`, `apps/cli/src/services/offline/OfflineLibraryService.ts`, CLI domain/session types under coordinator review; existing offline launch/local source tests.

Reserve an app-level handoff consumed by PlaybackPhase:

```ts
type OfflinePlaybackIntent = {
  readonly kind: "artifact";
  readonly jobId: string;
};
```

Carry providerEpisodeIdentity from the selected job into EpisodeInfo using the existing type. The job ID chooses the exact artifact; title/episode coordinates are continuation/search context, not a replacement for that ID. Keep app intent out of provider contracts.

- [ ] Create two completed jobs A/B with same displayed title/episode, different audio/quality/native identity and different local files. Select B through prepareOfflinePlaybackLaunch and the real browse/direct handoff. Assert player path, subtitle/timing and history all refer to B.
- [ ] Add the same case through retained browse, command palette and post-play launch; test the anime and TMDB lanes.
- [ ] Preserve intent across SELECT_TITLE/SELECT_EPISODE, episodeInfoFromSelection, browse interruption and phase transitions. Clear it on an unrelated title/episode selection so stale B cannot override a new request.
- [ ] Resolve by getPlayableSource(jobId) and revalidate at playback time. Do not fall back to A if B disappears after selection; present the unavailable result and explicit repair/reselect actions.
- [ ] Keep providerEpisodeIdentity through history and local next-episode lookup; never infer equivalent native episodes from equal displayed numbers alone.

## R04.2 — Local/provider authority

Execute the existing provider-independent plan's tasks, with the intent above as an input extension. It owns the new files `apps/cli/src/app/playback/playback-source-authority.ts` and `apps/cli/test/unit/app/playback/playback-source-authority.test.ts`.

- [ ] Add offline job with retired-provider, network port that throws on every call, readable validated media and local sidecar. Assert playback progresses and zero provider reads/health changes/cache invalidations occur.
- [ ] Route local authority before registry.get and before provider metadata/timing/prefetch work. Only the provider arm may perform online acquisition.
- [ ] Exact verified media/sidecar paths receive local trust. Reject arbitrary path substitutions and symlink escape according to the existing trust contract.
- [ ] Test missing file, invalid media, missing optional subtitle, provider removal, offline-only miss and online provider-unavailable independently.
- [ ] Cover local→local next/resume with stored timing and user language choices. R02 remains owner of player generation mechanics.

## R04.3 — Point queries, pagination and counts (A19)

Allowed edits: `packages/storage/src/repositories/offline-assets.ts`, reserved `packages/storage/src/migrations.ts`; `apps/cli/src/services/offline/offline-episode-index.ts`, `OfflineRunwayService.ts` and `OfflineLibraryService.ts` in that directory; CLI offline library domain/view query consumers; create `packages/storage/test/offline-assets-query.test.ts`.

- [ ] Seed 150 episodes and multiple profiles; episode 101 is ready. Point resolution and next/runway must find it. Seed >200 library rows with a match outside the first page; search must find it.
- [ ] Add repository APIs for exact originJobId/asset identity and indexed episode matching. Use explicit profile/native identity constraints where selection requires them. Never increase listTitleAssets's limit to “fix” a point query.
- [ ] Add stable keyset pages for library browsing and SQL-filtered search; apply filters before limit. Define cursor fields from the actual sort (including a unique tie-breaker).
- [ ] Use COUNT/aggregate queries for library/runway summaries. Keep bounded display pages without treating a truncated list as the full library.
- [ ] Document index predicates and run EXPLAIN QUERY PLAN against a 10k-asset fixture. Reserve new migration IDs; do not alter released migrations. R09 measures query tails after correctness passes.

## Verification and closure

```sh
bun run --cwd packages/storage test
bun run --cwd apps/cli test:file -- test/unit/app/offline-playback-launch.test.ts test/unit/services/offline test/unit/domain/playback-source/offline-availability.test.ts test/integration/offline-local-playback-resolution.test.ts test/integration/persistent-mpv-local-transition-native.test.ts
bun run --cwd apps/cli typecheck
```

Update offline contract and owning plan reconciliation. Run the new source-authority test through test:file, runbook gates and real mpv with network disabled. Return evidence of exact B path, episode 101 lookup, provider-zero-call trace and durable history after relaunch. Coordinate R08's unavailable/repair copy.
