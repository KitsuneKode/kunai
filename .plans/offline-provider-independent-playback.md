# Offline Provider-Independent Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: **planned** — implement before retiring a production provider, or promote during a broader offline-durability pass.

**Goal:** Keep a verified downloaded artifact playable even when the provider recorded on its download job is no longer registered.

**Architecture:** Resolve playback source authority before requiring a provider module. Represent local and provider acquisition as a discriminated union, keep provider-only orchestration behind the provider arm, and send both arms through the existing unified player lifecycle. Do not model the local library as a fake provider.

**Tech Stack:** Bun, TypeScript, SQLite-backed offline repositories, the existing `PlaybackPhase` and `PlayerService` seams.

**Spec:** [.docs/download-offline-onboarding.md](../.docs/download-offline-onboarding.md)

## Global Constraints

- A readable, validated local artifact is authoritative for an offline-library launch.
- Missing provider registration must not block verified local playback.
- Provider lookup remains mandatory before any online resolution, cache invalidation, health mutation, or provider fallback.
- Preserve the exact-path local trust contract; never weaken mpv URL validation.
- Preserve the unified `player.play()` lifecycle, including resume, autoplay, tracks, timing, cancellation, and generation ownership.
- Do not introduce a synthetic or fake provider module for local media.
- Additional provider subtitle tracks remain remote; only a verified local sidecar receives local trust.
- Episode numbers remain 1-based at the UI seam.

---

## Problem and trigger

`applyDownloadJobSessionRouting()` currently restores `job.providerId` into session state. `PlaybackPhase` then calls `providerRegistry.get()` and returns `PROVIDER_UNAVAILABLE` before `resolveLocalEpisodePlayback()` can inspect the validated artifact. A download therefore becomes stranded if its recorded provider is removed without an alias.

This does not block current downloads while their provider remains registered. Treat either of these events as the trigger to schedule the plan:

- removal or renaming of a production provider without a complete alias;
- a beta/release milestone that promises downloads survive provider retirement.

## Non-goals

- Do not make online playback work without a compatible provider.
- Do not rewrite provider fallback, source inventory, or title identity.
- Do not split the entire `PlaybackPhase` in the same change.
- Do not migrate old download rows merely to satisfy playback; the runtime must tolerate their recorded provider ID.

## Acceptance criteria

1. An offline-library job with `providerId: "retired-provider"` launches its verified local media and sidecar.
2. The retired provider is never resolved, health-scored, invalidated, or selected as fallback.
3. Local playback retains resume, timing, track selection, active cancellation, and persistent-session generation behavior.
4. If the local artifact is missing or invalid, the user receives `offline-file-unavailable`; Kunai does not attempt online fallback under `--offline`.
5. If an online launch has no local source and its selected provider is absent, behavior remains `PROVIDER_UNAVAILABLE`.
6. Local next-episode continuation uses only the offline episode index; it does not require provider metadata.

---

### Task 1: Introduce source authority before provider lookup

**Files:**

- Create: `apps/cli/src/app/playback/playback-source-authority.ts`
- Create: `apps/cli/test/unit/app/playback/playback-source-authority.test.ts`
- Reuse: `apps/cli/src/app/playback/episode-playback-source.ts`

**Interfaces:**

- Consumes: `LocalEpisodePlaybackResolution`, `ProviderRegistry`, `TitleInfo`, and `EpisodeInfo`.
- Produces: `PlaybackSourceAuthority` and `resolvePlaybackSourceAuthority()`.

- [ ] **Step 1: Write the failing authority tests**

```ts
test("verified offline media wins before a retired provider lookup", async () => {
  let providerReads = 0;
  const local = readyLocalResolution({ providerId: "retired-provider" });

  const result = await resolvePlaybackSourceAuthority({
    configuredProviderId: "retired-provider",
    offlineOnly: true,
    resolveLocal: async () => local,
    getProvider: () => {
      providerReads += 1;
      return undefined;
    },
  });

  expect(result).toEqual({ kind: "local", resolution: local });
  expect(providerReads).toBe(0);
});

test("online acquisition still fails closed without local media or a provider", async () => {
  const result = await resolvePlaybackSourceAuthority({
    configuredProviderId: "retired-provider",
    offlineOnly: false,
    resolveLocal: async () => null,
    getProvider: () => undefined,
  });

  expect(result).toEqual({
    kind: "provider-unavailable",
    providerId: "retired-provider",
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```sh
bun run --cwd apps/cli test test/unit/app/playback/playback-source-authority.test.ts
```

Expected: failure because `playback-source-authority.ts` does not exist.

- [ ] **Step 3: Implement the acquisition interface**

```ts
import type { LocalEpisodePlaybackResolution } from "@/app/playback/episode-playback-source";
import type { Provider } from "@/services/providers/Provider";

export type PlaybackSourceAuthority =
  | { readonly kind: "local"; readonly resolution: LocalEpisodePlaybackResolution }
  | { readonly kind: "provider"; readonly provider: Provider }
  | { readonly kind: "offline-unavailable" }
  | { readonly kind: "provider-unavailable"; readonly providerId: string };

export async function resolvePlaybackSourceAuthority(input: {
  readonly configuredProviderId: string;
  readonly offlineOnly: boolean;
  readonly resolveLocal: () => Promise<LocalEpisodePlaybackResolution | null>;
  readonly getProvider: (providerId: string) => Provider | undefined;
}): Promise<PlaybackSourceAuthority> {
  const local = await input.resolveLocal();
  if (local) return { kind: "local", resolution: local };
  if (input.offlineOnly) return { kind: "offline-unavailable" };
  const provider = input.getProvider(input.configuredProviderId);
  return provider
    ? { kind: "provider", provider }
    : { kind: "provider-unavailable", providerId: input.configuredProviderId };
}
```

Keep source-preference policy inside the injected `resolveLocal()` call so online search and Continue retain their existing preference semantics.

- [ ] **Step 4: Run the authority tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Commit the authority module**

```sh
git add apps/cli/src/app/playback/playback-source-authority.ts \
  apps/cli/test/unit/app/playback/playback-source-authority.test.ts
git commit -m "refactor(playback): resolve source authority before providers"
```

---

### Task 2: Make `PlaybackPhase` consume the authority union

**Files:**

- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/test/unit/app/playback/playback-phase-outer-loop.test.ts`
- Test: `apps/cli/test/integration/offline-local-playback-resolution.test.ts`

**Interfaces:**

- Consumes: `resolvePlaybackSourceAuthority()` from Task 1.
- Produces: a provider-independent local route through the existing `runMpvPlaybackSession()` and `PlayerServiceImpl` handoff.

- [ ] **Step 1: Add the retired-provider phase regression**

Build a `PlaybackPhase.execute()` harness whose offline library returns a ready local source, whose `providerRegistry.get()` returns `undefined`, and whose player captures `PlayerOptions.localPlaybackSource`.

```ts
expect(result.status).toBe("success");
expect(capturedOptions?.localPlaybackSource?.filePath).toBe(localMediaPath);
expect(providerResolveCalls).toBe(0);
expect(providerHealthWrites).toBe(0);
expect(cacheInvalidations).toBe(0);
```

Also retain an online control case:

```ts
expect(onlineResult).toMatchObject({
  status: "error",
  error: { code: "PROVIDER_UNAVAILABLE" },
});
```

- [ ] **Step 2: Run the phase regression and verify RED**

```sh
bun run --cwd apps/cli test \
  test/unit/app/playback/playback-phase-outer-loop.test.ts \
  test/integration/offline-local-playback-resolution.test.ts
```

Expected: the offline case returns `PROVIDER_UNAVAILABLE` before reaching the player.

- [ ] **Step 3: Integrate source authority without nullable-provider leakage**

At the start of the episode iteration:

```ts
const sourceAuthority = await resolvePlaybackSourceAuthority({
  configuredProviderId: run.sessionSoftProviderId ?? configuredProviderId,
  offlineOnly: isOfflineLaunch,
  resolveLocal: () =>
    resolveLocalEpisodePlayback(container, title, currentEpisode, {
      entrypoint: isOfflineLaunch
        ? "offline-library"
        : title.launchSource === "continue"
          ? "continue"
          : "online-search",
      forceOnline: run.episodePlaybackSourceOverride === "online",
      forceLocal: isOfflineLaunch || run.episodePlaybackSourceOverride === "local",
    }),
  getProvider: (providerId) => providerRegistry.get(providerId),
});
```

Handle every union arm explicitly:

- `local`: populate `stream`, `run.localEpisodeTiming`, `run.localPlaybackJobId`, and `run.localPlaybackSource`; use `"local"` only as diagnostic source identity.
- `provider`: enter the existing provider trace/cache/resolve path with `sourceAuthority.provider`.
- `offline-unavailable`: dispatch `buildOfflineFileUnavailableProblem()` and return to results.
- `provider-unavailable`: return the existing `PROVIDER_UNAVAILABLE` error.

Do not create `const currentProvider: Provider | undefined` and thread it through the method. Provider-only operations—including recent remote-stream reuse, source selection, resolve tracing, provider handoff, cache invalidation, health mutation, and provider prefetch—must live inside the `provider` arm. Local episode availability continues through the offline index.

- [ ] **Step 4: Run the focused phase and player suites**

```sh
bun run --cwd apps/cli test \
  test/unit/app/playback/playback-phase-outer-loop.test.ts \
  test/integration/offline-local-playback-resolution.test.ts \
  test/unit/app/playback/run-mpv-playback-session.test.ts \
  test/unit/infra/player/PlayerServiceImpl.test.ts
```

Expected: all tests pass, including the online control case.

- [ ] **Step 5: Commit phase integration**

```sh
git add apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/test/unit/app/playback/playback-phase-outer-loop.test.ts \
  apps/cli/test/integration/offline-local-playback-resolution.test.ts
git commit -m "fix(offline): play downloads after provider retirement"
```

---

### Task 3: Pin offline continuation and update product truth

**Files:**

- Modify: `apps/cli/test/unit/app/offline-playback-launch.test.ts`
- Modify: `.docs/download-offline-onboarding.md`
- Modify: `.plans/roadmap.md`
- Move on completion: `.plans/offline-provider-independent-playback.md` to `.archive/plans/offline-provider-independent-playback.md`

**Interfaces:**

- Consumes: the source-authority behavior from Tasks 1–2.
- Produces: durable offline-launch and documentation contracts.

- [ ] **Step 1: Add launch and local-next-episode assertions**

```ts
test("offline launch preserves a retired provider id as metadata only", async () => {
  const job = readyJob({ providerId: "retired-provider" });
  const launch = await prepareOfflinePlaybackLaunch(containerFor(job), job.id);

  expect(launch?.title.launchSource).toBe("offline-library");
  expect(dispatchedMode.provider).toBe("retired-provider");
  expect(providerRegistryReads).toBe(0);
});
```

Extend the phase regression to move from S01E01 to an offline-ready S01E02 with the provider still absent. Assert no remote prefetch or provider lookup occurs.

- [ ] **Step 2: Run offline launch, episode-index, and source-selection tests**

```sh
bun run --cwd apps/cli test \
  test/unit/app/offline-playback-launch.test.ts \
  test/unit/services/offline/offline-episode-index.test.ts \
  test/unit/domain/playback-source/source-selection-engine.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Update current behavior documentation**

Add this invariant to `.docs/download-offline-onboarding.md` after implementation:

```md
- A validated local artifact remains playable when its recorded provider is no longer registered.
  Provider identity is metadata for local playback and becomes mandatory only when online resolution starts.
```

Move this plan to `.archive/plans/`, remove its active roadmap row, and describe it as historical implementation evidence.

- [ ] **Step 4: Run complete verification**

```sh
bun run test
bun run typecheck
bun run lint
bun run fmt:check
bun run verify:doc-paths
bun run build
git diff --check
```

Expected: every command exits zero. Existing warning-only lint output is acceptable only if no new warning points at files changed by this plan.

- [ ] **Step 5: Commit documentation and plan closure**

```sh
git add .docs/download-offline-onboarding.md .plans/roadmap.md \
  .archive/plans/offline-provider-independent-playback.md \
  apps/cli/test/unit/app/offline-playback-launch.test.ts
git commit -m "docs(offline): record provider-independent playback"
```

## Self-review record

- Spec coverage: all six acceptance criteria map to Tasks 1–3.
- Placeholder scan: no unfinished marker, generic error-handling instruction, or unnamed test obligation remains.
- Type consistency: Task 2 consumes the exact `PlaybackSourceAuthority` and `resolvePlaybackSourceAuthority()` interface defined in Task 1.
