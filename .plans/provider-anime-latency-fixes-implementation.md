# Anime Provider Latency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make anime playback faster and more reliable by fixing Miruro provider-key/source selection, proving AllManga `Ak` DASH playback, and preserving fast startup by keeping subtitle work off the blocking path.

**Architecture:** Keep provider research in `apps/experiments`, provider parsing in `packages/providers`, and playback orchestration in `apps/cli`. Production providers stay direct HTTP; Playwright remains an evidence/fixture tool unless a future runtime-browser boundary is explicitly approved.

**Tech Stack:** Bun, TypeScript, `@kunai/core` provider cycle, `@kunai/types` provider contracts, mpv, Playwright only in `apps/experiments`.

**Implementation status (2026-05-26):** Implemented in production code with deterministic tests. Miruro provider keys are data-driven and ranked; AllManga `Ak` resolves as an opaque deferred DASH stream and is materialized to a temporary MPD at playback time; startup priority (`balanced`, `fast`, `quality-first`) flows through cache/work/source-inventory identity and provider selection; initial mpv launch attaches only the selected subtitle while late lookup can use Wyzie when provider/cache subtitle inventory lacks the configured language; title-scoped provider health can try a previously successful fallback first; VidKing definitive 404s and duplicate year variants are trimmed; Rivestream service discovery is cached and fast startup preserves provider ready-order even when returned inventory is quality-sorted.

---

## File Map

- `.docs/provider-dossiers/allmanga.md`: evidence and contract notes for AllManga.
- `.docs/provider-dossiers/miruro.md`: evidence and contract notes for Miruro.
- `apps/experiments/scratchpads/provider-allmanga/`: AllManga DASH/MPD proof scripts and redacted fixtures.
- `apps/experiments/scratchpads/provider-miruro/`: Miruro provider-key matrix probes.
- `packages/providers/src/allmanga/api-client.ts`: eventual `Ak` source parser after experiment proof.
- `packages/providers/src/allmanga/direct.ts`: eventual `Ak` stream/subtitle mapping.
- `packages/providers/src/miruro/direct.ts`: generalized provider-key candidate cycle and source filtering.
- `packages/providers/test/fixtures/allmanga/`: deterministic `Ak` fixture.
- `packages/providers/test/fixtures/miruro/`: multi-provider-key fixture.
- `packages/providers/test/providers.test.ts`: provider contract tests.
- `apps/cli/src/mpv.ts`: fast-start subtitle launch policy.
- `apps/cli/src/infra/player/persistent-ready-work-executor.ts`: late subtitle attachment behavior.
- `apps/cli/test/unit/mpv.test.ts`: launch arg expectations.
- `apps/cli/test/unit/infra/player/persistent-ready-work-executor.test.ts`: persistent subtitle timing expectations.

---

### Task 1: Miruro Provider-Key Matrix Probe

**Status:** Completed. The resulting production implementation uses data-driven provider-key discovery rather than fixed `kiwi` / `bee` assumptions.

**Files:**

- Create: `apps/experiments/scratchpads/provider-miruro/miruro-provider-key-matrix.ts`
- Output: `apps/experiments/scratchpads/provider-miruro/miruro-provider-key-matrix-report.json`

- [x] **Step 1: Write the experiment script**

Create a script that imports or copies the existing pipe encode/decode helpers from `packages/providers/src/miruro/direct.ts` shape, then probes these samples:

```ts
const samples = [
  { label: "solo-leveling", anilistId: 151807, episode: 1 },
  { label: "frieren", anilistId: 154587, episode: 1 },
  { label: "one-piece", anilistId: 21, episode: 100 },
];
```

For each sample:

1. Fetch `episodes`.
2. Enumerate every key under `providers`.
3. For each key and `sub`/`dub` list that contains the target episode, fetch `sources`.
4. For each stream, record only:

```ts
{
  (providerKey,
    audioCategory,
    sourceMs,
    streamCount,
    subtitleCount,
    hosts,
    qualities,
    referers,
    activeCount,
    firstFailure);
}
```

Do not write raw stream URLs.

- [x] **Step 2: Run the probe**

Run:

```sh
cd apps/experiments
bun scratchpads/provider-miruro/miruro-provider-key-matrix.ts
```

Expected: report JSON with provider keys including more than `kiwi`/`bee` for at least Solo Leveling or Frieren.

- [x] **Step 3: Update dossier**

Update `.docs/provider-dossiers/miruro.md` with the winning provider-key order and any keys that should be skipped.

---

### Task 2: Miruro Production Candidate Generalization

**Status:** Completed in provider code with deterministic fixtures.

**Files:**

- Modify: `packages/providers/src/miruro/direct.ts`
- Test: `packages/providers/test/providers.test.ts`
- Fixture: `packages/providers/test/fixtures/miruro/multi-provider-episodes.json`

- [x] **Step 1: Add fixture test first**

Add a fixture shaped like the browser harvest with provider keys such as `ANIMEKAI`, `ANIMEZ`, `kiwi`, `hop`, and `ZORO`. Add a test asserting candidate construction includes every provider key with the requested episode.

Expected assertion shape:

```ts
expect(candidates.map((candidate) => candidate.serverId)).toContain("kiwi");
expect(candidates.map((candidate) => candidate.serverId)).toContain("ANIMEKAI");
expect(candidates.every((candidate) => candidate.metadata?.episodeId)).toBe(true);
```

- [x] **Step 2: Make `MiruroServerKey` data-driven**

Replace the fixed union with a string-backed key:

```ts
export type MiruroServerKey = string;
```

Keep known display labels in a map:

```ts
const MIRURO_PROVIDER_LABELS: Record<string, string> = {
  kiwi: "Kiwi",
  bee: "Bee",
  ANIMEKAI: "AnimeKai",
  ANIMEZ: "AnimeZ",
  hop: "Hop",
  ZORO: "Zoro",
  ally: "Ally",
  dune: "Dune",
};
```

- [x] **Step 3: Build candidates from all provider keys**

Change candidate construction to iterate `Object.entries(epData.providers ?? {})`, find `episodes.sub` / `episodes.dub`, and create candidates for every provider key with the requested episode.

Candidate metadata must include:

```ts
{
  audioCategory,
  episodeId,
  serverId: providerKey,
  subtitleDelivery: "unknown"
}
```

- [x] **Step 4: Preserve stream evidence**

When mapping streams, set source label from provider key and preserve `raw.referer`.

Do not infer hardsub/softsub from provider key unless `sourceData.subtitles` or stream metadata proves it.

- [x] **Step 5: Run tests**

Run:

```sh
bun test packages/providers/test/providers.test.ts --grep miruro
```

Expected: all Miruro tests pass.

---

### Task 3: Miruro Stream Filtering and Startup Health

**Status:** Completed in provider code with source-order and active-CDN tests.

**Files:**

- Modify: `packages/providers/src/miruro/direct.ts`
- Test: `packages/providers/test/providers.test.ts`

- [x] **Step 1: Add stream ordering test**

Use a fixture with:

- one active CDN HLS stream,
- one inactive CDN HLS stream,
- one direct `kwik.cx` HLS stream.

Assert selected stream prefers the active CDN host.

```ts
expect(new URL(selected.url ?? "").hostname).toContain("uwucdn");
```

- [x] **Step 2: Implement local stream priority**

Sort Miruro streams by:

1. `isActive === true`
2. CDN host contains `uwucdn` or `owocdn`
3. higher `qualityRank`
4. original order

Do not remove non-winning candidates from inventory unless they are malformed.

- [x] **Step 3: Add failure metadata**

If a candidate source returns no HLS streams, emit a provider-cycle failure with provider key and audio category in the message.

- [x] **Step 4: Run tests**

Run:

```sh
bun test packages/providers/test/providers.test.ts --grep miruro
```

Expected: selected stream is stable and inventory still contains all valid candidates.

---

### Task 4: AllManga `Ak` DASH Experiment Proof

**Files:**

- Create: `apps/experiments/scratchpads/provider-allmanga/allmanga-ak-dash-proof.ts`
- Output: `apps/experiments/scratchpads/provider-allmanga/allmanga-ak-dash-proof-report.json`

- [x] **Step 1: Create proof script**

The script must:

1. Resolve Solo Leveling Season 1 episode 1 using id `B6AMhLy6EQHDgYgBF`.
2. Decode `tobeparsed`.
3. Fetch the `Ak` endpoint.
4. Select one video representation and one audio representation.
5. Generate a temporary MPD or EDL under `/tmp/kunai-allmanga-ak-*`.
6. Run mpv until the playing marker or timeout.

The report must include:

```ts
{
  providerOk: boolean,
  akFound: boolean,
  videoRepresentations: number,
  audioRepresentations: number,
  subtitleCount: number,
  mpvStarted: boolean,
  mpvMs: number | null,
  failure: string | null
}
```

- [x] **Step 2: Run proof**

Run:

```sh
cd apps/experiments
bun scratchpads/provider-allmanga/allmanga-ak-dash-proof.ts
```

Expected: either 5s mpv playback succeeds, or the report states exactly why MPD/EDL failed.

- [x] **Step 3: Update dossier**

Update `.docs/provider-dossiers/allmanga.md` with the proof result before touching production provider code.

---

### Task 5: AllManga `Ak` Production Adapter

**Prerequisite:** Task 4 succeeded with audio.

**Files:**

- Modify: `packages/providers/src/allmanga/api-client.ts`
- Modify: `packages/providers/src/allmanga/direct.ts`
- Add fixture: `packages/providers/test/fixtures/allmanga/ak-source-response.json`
- Test: `packages/providers/test/providers.test.ts`

- [x] **Step 1: Add fixture and failing test**

Add fixture for the redacted `Ak` response. Add a test that expects:

```ts
expect(result.status).toBe("resolved");
expect(result.streams[0]?.protocol).toBe("dash");
expect(result.subtitles.length).toBeGreaterThan(0);
```

- [x] **Step 2: Parse `Ak` response**

Add parser that returns a `StreamLink`-like object with:

```ts
{
  url: generatedMpdOrDeferredLocator,
  quality: selectedVideo.height + "p",
  referer: "https://allanime.day",
  subtitles: akSubtitles,
  protocol: "dash"
}
```

The production path represents `Ak` as a deferred DASH locator; mpv materialization owns the temporary MPD.

- [x] **Step 3: Map provider result**

Map `protocol: "dash"`, `container: "mpd"`, audio language, subtitle candidates, and source evidence.

- [x] **Step 4: Run targeted tests**

Run:

```sh
bun test packages/providers/test/providers.test.ts --grep AllManga
```

Expected: AllManga tests pass and Solo Leveling fixture resolves.

---

### Task 6: Fast Startup Subtitle Policy

**Files:**

- Modify: `apps/cli/src/mpv.ts`
- Modify: `apps/cli/src/infra/player/persistent-ready-work-executor.ts`
- Test: `apps/cli/test/unit/mpv.test.ts`
- Test: `apps/cli/test/unit/infra/player/persistent-ready-work-executor.test.ts`

- [x] **Step 1: Write mpv arg test**

Assert only the primary subtitle appears as `--sub-file`.

```ts
expect(args.filter((arg) => arg.startsWith("--sub-file="))).toEqual([
  "--sub-file=https://subs.example/en.vtt",
]);
```

- [x] **Step 2: Keep full inventory for late attach**

Keep `subtitleTracks` available to `attachLateSubtitles`, but do not append all tracks in `buildMpvArgs`.

- [x] **Step 3: Fix persistent session ready-work behavior**

If the primary subtitle was attached at spawn and there are no additional tracks, emit ready events without replacing inventory. If additional tracks exist, attach them after player ready.

- [x] **Step 4: Run targeted tests**

Run:

```sh
bun test apps/cli/test/unit/mpv.test.ts
bun test apps/cli/test/unit/infra/player/persistent-ready-work-executor.test.ts
```

Expected: mpv arg and late-subtitle tests pass.

---

### Task 7: Playback Timing Ladder Diagnostics

**Status:** Superseded by the startup timeline and provider selection diagnostics already landed in the broader provider-latency slice. Remaining UX copy work is tracked outside this plan.

**Files:**

- Modify: `apps/cli/src/app-shell/loading-shell-runtime.ts`
- Modify: `apps/cli/src/app/provider-resolve-user-state.ts`
- Test: add or extend relevant app-shell unit test if present

- [x] **Step 1: Add phase labels**

Represent at least these phases:

```ts
type PlaybackBootstrapPhase =
  | "provider-resolve"
  | "stream-selected"
  | "mpv-spawned"
  | "ipc-ready"
  | "playback-started"
  | "late-subtitles";
```

- [x] **Step 2: Stop collapsing every 20s wait into only `Slow source`**

Keep `Slow source` as a fallback, but include the current phase in visible copy and diagnostics.

- [x] **Step 3: Run targeted CLI tests**

Run:

```sh
bun test apps/cli/test/unit
```

Expected: loading-state tests pass; no snapshot lies about subtitle phase as provider resolve.

---

## Execution Order

1. Task 1: Miruro matrix probe.
2. Task 2: Miruro provider-key generalization.
3. Task 3: Miruro stream filtering.
4. Task 4: AllManga `Ak` proof.
5. Task 5: AllManga production adapter, only if Task 4 succeeds.
6. Task 6: Lazy subtitle startup.
7. Task 7: Timing ladder diagnostics.

## Verification Ladder

Run after implementation slices:

```sh
bun test packages/providers/test/providers.test.ts --grep miruro
bun test packages/providers/test/providers.test.ts --grep AllManga
bun test apps/cli/test/unit/mpv.test.ts
bun test apps/cli/test/unit/infra/player/persistent-ready-work-executor.test.ts
bun run typecheck
```

Manual smoke after tests:

```sh
cd apps/experiments
bun scratchpads/provider-latency-bench.ts --anime --query="solo leveling" --anilist=151807 --episodes=1 --providers=miruro --mpv --mpv-play-seconds=5
bun scratchpads/provider-latency-bench.ts --anime --query="solo leveling" --episodes=1 --providers=allanime --search-index=1 --mpv --mpv-play-seconds=5
```

Expected target:

- Miruro starts playback in roughly 1-4 seconds on good CDN candidates.
- AllManga `Ak` resolves as deferred DASH and materializes for mpv playback.
- VidKing/Cineby subtitle fanout stays off the initial launch path; late Wyzie lookup now runs when provider/cache inventory does not satisfy the configured subtitle language.
