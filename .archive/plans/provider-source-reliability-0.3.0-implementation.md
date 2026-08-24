# Provider Source Reliability for 0.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden AniDB source inventory, verify AllManga build 140 independently, preserve a safe real-config relay diagnostic, and fold the finished work into unreleased 0.3.0 without changing versions.

**Architecture:** AniDB performs one episode/language catalog read, resolves the requested language as required work, and bounds optional alternate discovery with existing startup budgets. AllManga keeps the ported crypto but gains literal known-answer tests and overlaps crypto preparation with episode-catalog loading. Relay diagnostics separate pure config validation/redaction from the read-only real-profile entrypoint and isolated production-engine smoke.

**Tech Stack:** Bun 1.4, TypeScript, `bun:test` through repository scripts, Turborepo, provider SDK types, Changesets, Markdown release artifacts.

**Spec:** [provider-source-reliability-0.3.0.md](./provider-source-reliability-0.3.0.md)

## Global Constraints

- Work only on `fix/provider-source-reliability-0.3.0`; preserve unrelated dirty files and stage exact paths per task.
- Use `apps/cli/src/main.ts` as the only application entrypoint.
- Treat `animeProviderPriority` as ordering, not an allowlist.
- Only `jpn` maps to AniDB `sub`; only `eng` maps to AniDB `dub`.
- The requested AniDB mode owns the full provider deadline; optional inventory uses 0 ms for fast, 1,000 ms for balanced, and 4,000 ms for quality-first.
- No source is selectable without real streams, and requested-mode absence is non-retryable.
- Never increase global provider timeouts to hide latency.
- The relay wrapper reads real `providerRelay` configuration but never writes real config, data, cache, or tokens; its child owns an isolated profile.
- Never print relay tokens, URL credentials, query strings, fragments, or full relay paths.
- Do not enable video relay, a shared public relay, or a true provider allowlist.
- Do not change a package version or retain a changeset for this work; fold it into existing 0.3.0 changelogs and release notes.
- Run tests through `bun run` scripts, never `bun test` directly.

## File Structure

### Provider runtime

- Modify `packages/providers/src/anidb/client.ts`: recognized-language plan, per-mode outcomes, cancellation, and bounded alternate resolution.
- Modify `packages/providers/src/anidb/direct.ts`: requested-mode selection, trace evidence, source inventory, and retry classification.
- Modify `packages/providers/test/anidb.test.ts`: deterministic language, latency, failure, and cancellation regressions.
- Modify `packages/providers/src/allmanga/crypto.ts`: retain build-140 literals and narrowly correct parity comments.
- Modify `packages/providers/src/allmanga/api-client.ts`: expose measurable bootstrap work without leaking request material.
- Modify `packages/providers/src/allmanga/direct.ts`: overlap catalog and crypto preparation and emit bounded timing evidence.
- Modify `packages/providers/src/allmanga/manifest.ts`: describe build-140 behavior without provider-lane claims.
- Modify `packages/providers/test/allmanga.test.ts`: independent known-answer, exact-header, overlap, and trace tests.

### Relay diagnostic

- Create `apps/cli/test/live/relay-config.ts`: pure config/env resolution, URL validation, display redaction, and child script path helper.
- Create `apps/cli/test/unit/live/relay-config.test.ts`: deterministic helper contract.
- Modify `apps/cli/test/live/relay-from-config.ts`: read-only real-config adapter and child process lifecycle.
- Modify `apps/cli/test/live/relay-allanime.smoke.ts`: validate input and emit only a redacted relay origin.
- Modify `apps/cli/package.json` and `package.json`: retain the `test:relay` manual command.

### Configuration, docs, and release

- Restore `packages/config/src/defaults.ts` and `packages/config/test/config.test.ts` to truthful ordering semantics; do not claim a new allowlist lane.
- Restore `packages/providers/src/miruro/manifest.ts` unless another runtime-backed Miruro change remains.
- Modify `.docs/providers.md`: build-140 parity, AniDB inventory behavior, real priority semantics, and manual relay diagnostic.
- Modify `CHANGELOG.md` and `apps/cli/CHANGELOG.md`: add concise provider reliability entries inside 0.3.0.
- Modify `.release/kunai-v0.3.0.md`: add AniDB, AllManga 140, and optional relay evidence gates.
- Remove `.changeset/allmanga-lane-restoration.md`.
- Regenerate `apps/docs/lib/generated-metadata.json` and any other committed docs outputs with `bun run --cwd apps/docs generate`.

---

### Task 1: Bound AniDB language resolution in the client

**Files:**

- Modify: `packages/providers/src/anidb/client.ts`
- Test: `packages/providers/test/anidb.test.ts`

**Interfaces:**

- Consumes: `StartupPriority`, `ResolveErrorCode`, `AnidbLanguageEntry`, `AnidbStreamLink`, `fetchAnidbEpisodes`, `fetchAnidbLanguages`, and `resolveAnidbLanguageStreams`.
- Produces:

```ts
export type AnidbAudioMode = "sub" | "dub";

export type AnidbModeOutcome =
  | {
      readonly mode: AnidbAudioMode;
      readonly status: "resolved";
      readonly links: readonly AnidbStreamLink[];
    }
  | {
      readonly mode: AnidbAudioMode;
      readonly status: "catalog-unavailable" | "skipped";
      readonly links: readonly [];
    }
  | {
      readonly mode: AnidbAudioMode;
      readonly status: "failed" | "timed-out";
      readonly links: readonly [];
      readonly failure: {
        readonly code: ResolveErrorCode;
        readonly message: string;
        readonly retryable: true;
      };
    };

export type AnidbEpisodeStreamResolution = {
  readonly availableModes: readonly AnidbAudioMode[];
  readonly requested: AnidbModeOutcome;
  readonly alternate?: AnidbModeOutcome;
};

export function anidbAlternateWaitBudgetMs(priority?: StartupPriority): number;

export async function resolveAnidbEpisodeStreams(options: {
  readonly context?: ProviderRuntimeContext;
  readonly showId: string;
  readonly episodeNumber: number;
  readonly requestedMode: AnidbAudioMode;
  readonly startupPriority?: StartupPriority;
  readonly alternateWaitBudgetMs?: number;
  readonly signal?: AbortSignal;
}): Promise<AnidbEpisodeStreamResolution>;
```

- [ ] **Step 1: Replace the single dual-audio happy-path test with failing client-contract tests**

Add focused cases that call `resolveAnidbEpisodeStreams` directly with stubbed responses. Use a Spanish entry to prove it is not relabeled, and use a deferred English response with a 20 ms override to prove bounded waiting:

```ts
expect(resolution.availableModes).toEqual(["sub"]);
expect(resolution.requested).toMatchObject({ mode: "sub", status: "resolved" });
expect(resolution.alternate).toBeUndefined();

const startedAt = performance.now();
const bounded = await resolveAnidbEpisodeStreams({
  showId: "1234",
  episodeNumber: 1,
  requestedMode: "sub",
  startupPriority: "balanced",
  alternateWaitBudgetMs: 20,
  signal: controller.signal,
});
expect(performance.now() - startedAt).toBeLessThan(250);
expect(bounded.requested.status).toBe("resolved");
expect(bounded.alternate).toMatchObject({ mode: "dub", status: "timed-out" });
expect(englishRequestAborted).toBe(true);
```

Add cases for Japanese-only, English-only, dual-mode, unknown-only, rejected alternate, fast-profile skip, missing episode, and caller abort. After the abort case, assert the deferred alternate observes `signal.aborted` before the resolver settles.

- [ ] **Step 2: Run the AniDB file and confirm the new assertions fail**

Run:

```sh
bun run --cwd packages/providers test:file test/anidb.test.ts
```

Expected: failures show the flat array API, Spanish being mapped to `sub`, and the unresolved alternate holding completion.

- [ ] **Step 3: Implement exact language normalization and budget selection**

Import `StartupPriority` and `ResolveErrorCode` from `@kunai/types`. Replace all-language mapping with one exact entry per recognized code:

```ts
function languageEntryForMode(
  languages: readonly AnidbLanguageEntry[],
  mode: AnidbAudioMode,
): AnidbLanguageEntry | undefined {
  const code = mode === "dub" ? "eng" : "jpn";
  return languages.find((entry) => entry.code.toLowerCase() === code);
}

export function anidbAlternateWaitBudgetMs(priority: StartupPriority = "balanced"): number {
  if (priority === "fast") return 0;
  return priority === "quality-first"
    ? QUALITY_FIRST_WAIT_BUDGET_MS
    : BALANCED_QUALITY_WAIT_BUDGET_MS;
}
```

Import both constants from `../shared/startup-selection`. Remove the unused optional `audioMode` property and rename the required property to `requestedMode`.

- [ ] **Step 4: Implement selected-first resolution with owned cancellation**

Fetch the episode and language catalog once. If the requested entry is absent, return `catalog-unavailable` without starting another language. For a recognized alternate, start it concurrently only when the computed budget is nonzero.

Use a child `AbortController` linked to the caller for alternate work. Start the timeout only after requested work resolves, clear it in `finally`, remove the caller listener, abort on timeout, and await alternate settlement before returning. Map an empty HLS result to `failed` with `code: "parse-failed"`; map thrown network work to `failed`; map the owned deadline to `timed-out`. Re-throw caller cancellation so the provider can classify it as `cancelled`.

The critical completion shape is:

```ts
const requested = await settleRequested(requestedPromise, options.requestedMode);
if (requested.status !== "resolved") {
  alternateController?.abort("requested-mode-failed");
  await alternatePromise?.catch(() => undefined);
  return { availableModes, requested };
}

const alternate = alternatePromise
  ? await settleAlternateWithinBudget({
      promise: alternatePromise,
      controller: alternateController,
      waitBudgetMs,
      mode: alternateMode,
      callerSignal: options.signal,
    })
  : alternateEntry
    ? { mode: alternateMode, status: "skipped", links: [] as const }
    : undefined;

return { availableModes, requested, alternate };
```

- [ ] **Step 5: Run focused tests, typecheck the package, and commit**

Run:

```sh
bun run --cwd packages/providers test:file test/anidb.test.ts
bun run --cwd packages/providers typecheck
```

Expected: all AniDB tests pass; no alternate request remains pending after any test.

Commit only the client and its focused tests:

```sh
git add packages/providers/src/anidb/client.ts packages/providers/test/anidb.test.ts
git commit -m "fix(providers): bound AniDB alternate source discovery"
```

---

### Task 2: Map AniDB outcomes into truthful provider inventory

**Files:**

- Modify: `packages/providers/src/anidb/direct.ts`
- Test: `packages/providers/test/anidb.test.ts`

**Interfaces:**

- Consumes: `AnidbEpisodeStreamResolution`, `AnidbModeOutcome`, and `resolveAnidbEpisodeStreams` from Task 1.
- Produces: production `ProviderResolveResult` with requested-source selection, optional resolved alternate sources, and redacted per-mode trace events.

- [ ] **Step 1: Add failing direct-provider result tests**

Add assertions for these exact outcomes:

```ts
expect(unavailable.status).toBe("exhausted");
expect(unavailable.failures[0]).toMatchObject({ code: "not-found", retryable: false });

expect(withFailedAlternate.status).toBe("resolved");
expect(withFailedAlternate.sources?.map((source) => source.id)).toEqual(["source:anidb:sub"]);
expect(withFailedAlternate.trace.events).toContainEqual(
  expect.objectContaining({ type: "source:failed", sourceId: "source:anidb:dub" }),
);

expect(explicitDub.selectedStreamId).toBe(
  explicitDub.streams.find((stream) => stream.sourceId === "source:anidb:dub")?.id,
);
```

Also assert that a caller-aborted resolve returns `code: "cancelled"`, `retryable: false`, and never reports provider health as an ordinary network failure.

- [ ] **Step 2: Run the AniDB file and verify result-level failures**

Run:

```sh
bun run --cwd packages/providers test:file test/anidb.test.ts
```

Expected: requested absence is still retryable, alternate failure evidence is missing, and the direct provider still expects a flat link array.

- [ ] **Step 3: Remove duplicate catalog work and consume structured outcomes**

Delete the separate `fetchAnidbEpisodes` plus `collectAnidbAvailableAudioModes` path from `direct.ts`. Resolve once:

```ts
const resolution = await resolveAnidbEpisodeStreams({
  context,
  showId,
  episodeNumber,
  requestedMode: audioMode,
  startupPriority: input.startupPriority,
  signal: context.signal,
});
```

If `resolution.requested.status !== "resolved"`, return an exhausted result using its failure; synthesize only the catalog-unavailable failure as `{ code: "not-found", retryable: false }`. If the caller signal is aborted, return `{ code: "cancelled", retryable: false }` before other classification.

- [ ] **Step 4: Build inventory only from real streams and preserve alternate evidence**

Flatten only resolved outcomes:

```ts
const resolvedOutcomes = [resolution.requested, resolution.alternate].filter(
  (outcome): outcome is Extract<AnidbModeOutcome, { status: "resolved" }> =>
    outcome?.status === "resolved",
);
const links = resolvedOutcomes.flatMap((outcome) => outcome.links);
const resolvedModes = resolvedOutcomes.map((outcome) => outcome.mode);
```

Pass `resolvedModes` to `buildAnidbSourceInventory`, select `source:anidb:${audioMode}`, and never create an available source for a failed, timed-out, skipped, or catalog-unavailable alternate. Emit `source:success`, `source:failed`, or `source:skipped` with mode and status only; do not include embed or stream URLs. Retain `inventory:audio-modes` for the recognized catalog modes.

- [ ] **Step 5: Run provider gates and commit**

Run:

```sh
bun run --cwd packages/providers test:file test/anidb.test.ts
bun run test --filter=@kunai/providers
bun run --cwd packages/providers typecheck
bun run --cwd packages/providers lint
```

Expected: provider tests pass, requested-source selection is deterministic, and slow/failed alternates do not delay or invalidate requested success.

Commit:

```sh
git add packages/providers/src/anidb/direct.ts packages/providers/test/anidb.test.ts
git commit -m "fix(providers): expose truthful AniDB source inventory"
```

---

### Task 3: Lock AllManga build 140 and overlap cold preparation

**Files:**

- Modify: `packages/providers/src/allmanga/crypto.ts`
- Modify: `packages/providers/src/allmanga/api-client.ts`
- Modify: `packages/providers/src/allmanga/direct.ts`
- Modify: `packages/providers/src/allmanga/manifest.ts`
- Test: `packages/providers/test/allmanga.test.ts`

**Interfaces:**

- Consumes: current build-140 constants, `getAllMangaCryptoMaterial`, `loadAvailableEpisodesDetail`, `ProviderRuntimeContext.emit`, and existing provider trace event types.
- Produces: literal crypto regression vectors, exact bootstrap-header verification, concurrent catalog/bootstrap preparation, and redacted phase timings.

- [ ] **Step 1: Add independent build-140 known-answer tests**

Import `hashBuildId`, `deriveMaskKey`, and `buildAllMangaBootToken`. Replace the derived `EXPECTED_KEY_HEX` with literals and add these exact assertions:

```ts
expect(hashBuildId("140").toString("hex")).toBe(
  "07041a152a2823383631cec4dfdcd2ede2e0fbf08e89869c9794aaa5bab8b348",
);
expect(deriveMaskKey("140").toString("hex")).toBe(
  "522db8a067d8ea23616f7670788574dd786af7ffffd27bccfaeccfde57a67ce7",
);
expect(
  deriveKeyFromPartB("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=", "140").toString("hex"),
).toBe("532fbba462deed2b68657d7c758b7bcd6978e4ebeac46cd4e3f6d4c24ab863c7");
expect(
  buildAllMangaBootToken({
    buildId: "140",
    epoch: 6900,
    keyGroup: "mkissa",
    refererHost: "mkissa.to",
    contentLane: "k7",
  }),
).toBe("9589a0b5c93919e01039dc83eeced3966f2abda839f8302dc7087e7b3df5cd35");
```

Record `RequestInit.headers` in `mockCryptoSiteFetch` and assert the bootstrap request contains literal `x-build-id: 140`, the known boot token, `Origin: https://mkissa.to`, and `Referer: https://mkissa.to/`. Do not compute the expected token with production helpers inside the assertion.

- [ ] **Step 2: Add a failing cold-preparation concurrency test**

Extend the AllManga resolve fixture so bootstrap and catalog responses are controlled by two promises. Record when each fetch starts, release both, and assert both began before either response resolved:

```ts
const resolvePromise = resolveEvidenceEpisode();
await Promise.all([bootstrapStarted.promise, catalogStarted.promise]);
expect(startedRequests).toEqual(expect.arrayContaining(["bootstrap", "catalog"]));
bootstrapResponse.resolve(buildBootstrapResponse());
catalogResponse.resolve(buildCatalogResponse());
const result = await resolvePromise;
expect(result.status).toBe("resolved");
```

Collect context events and assert the bootstrap/cold-preparation timing event has a finite non-negative `durationMs` and contains no URL, token, attestation, or signed query.

- [ ] **Step 3: Run the AllManga file and confirm vector/header/concurrency failures**

Run:

```sh
bun run --cwd packages/providers test:file test/allmanga.test.ts
```

Expected: the literal vector section is incomplete, exact headers are not captured, and bootstrap does not begin while the catalog response is pending.

- [ ] **Step 4: Keep build-140 code minimal and emit redacted bootstrap timing**

Retain only constants and algorithm changes required by the fixed vectors. In the live bootstrap function, measure with `performance.now()` and emit `source:start`, then `source:success` or `source:failed` using `sourceId: "source:allanime:crypto-bootstrap"`. Attributes are limited to `buildId`, `contentLane`, `epochCandidate`, and `fallbackUsed`; URLs, headers, partB, derived keys, tokens, and `aaReq` are forbidden.

Ensure cache hits do not claim a live bootstrap and that fallback to bundled material is distinguishable from a successful refresh.

- [ ] **Step 5: Overlap crypto preparation with episode catalog loading**

In `allmangaProviderModule.resolve`, start `getAllMangaCryptoMaterial(context, DEFAULT_UA, context.signal)` and `loadAvailableEpisodesDetail(...)` together. Use `Promise.allSettled` so both owned operations settle, propagate the catalog rejection, and allow the crypto result to fall back through its existing policy:

```ts
const [catalogResult] = await Promise.allSettled([
  loadAvailableEpisodesDetail(
    context,
    ALLANIME_API_URL,
    ALLANIME_REFERER,
    DEFAULT_UA,
    showId,
    context.signal,
  ),
  getAllMangaCryptoMaterial(context, DEFAULT_UA, context.signal),
]);
if (catalogResult.status === "rejected") throw catalogResult.reason;
const detail = catalogResult.value;
```

Emit one provider trace event for combined preparation duration. The bootstrap event from Step 4 owns the live-versus-bundled evidence. `resolveEpisodeSources` then consumes the deduplicated cached material. Do not alter retry counts, 12-second request deadlines, or 3.2-second rate-limit backoff in this task.

- [ ] **Step 6: Run focused/full provider gates and commit**

Run:

```sh
bun run --cwd packages/providers test:file test/allmanga.test.ts
bun run test --filter=@kunai/providers
bun run --cwd packages/providers typecheck
bun run --cwd packages/providers lint
```

Expected: literals and exact headers pass, bootstrap/catalog begin concurrently, cache/fallback behavior remains covered, and no new serial wait is introduced.

Commit:

```sh
git add packages/providers/src/allmanga/crypto.ts packages/providers/src/allmanga/api-client.ts packages/providers/src/allmanga/direct.ts packages/providers/src/allmanga/manifest.ts packages/providers/test/allmanga.test.ts
git commit -m "fix(providers): harden AllManga build 140 cold resolution"
```

---

### Task 4: Harden the real-config relay diagnostic

**Files:**

- Create: `apps/cli/test/live/relay-config.ts`
- Create: `apps/cli/test/unit/live/relay-config.test.ts`
- Modify: `apps/cli/test/live/relay-from-config.ts`
- Modify: `apps/cli/test/live/relay-allanime.smoke.ts`
- Modify: `apps/cli/package.json`
- Modify: `package.json`

**Interfaces:**

- Consumes: `getKunaiPaths().configPath`, `Bun.file`, `Bun.spawn`, `fileURLToPath`, and the existing isolated profile in `provider-smoke.ts`.
- Produces:

```ts
export interface RawRelayDiagnosticConfig {
  readonly providerRelay?: {
    readonly enabled?: boolean;
    readonly baseUrl?: string;
    readonly token?: string;
    readonly providers?: Record<string, { readonly enabled?: boolean } | undefined>;
  };
}

export type RelayDiagnosticResolution =
  | { readonly kind: "skip"; readonly reason: string }
  | {
      readonly kind: "run";
      readonly baseUrl: string;
      readonly token: string;
      readonly source: "env" | "config";
      readonly displayOrigin: string;
      readonly tokenPresent: boolean;
      readonly forcesAllAnime: boolean;
    };

export function resolveRelayDiagnosticConfig(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly config?: RawRelayDiagnosticConfig;
  readonly configPath: string;
}): RelayDiagnosticResolution;

export function relayDisplayOrigin(value: string): string;
export function relayAllAnimeSmokePath(metaUrl: string): string;
```

- [ ] **Step 1: Write failing pure-helper tests**

Cover env-over-config precedence, config fallback, missing config, disabled config relay, invalid schemes, embedded username/password, query/fragment redaction, token-presence reporting, provider-disabled force notice, and filesystem decoding:

```ts
expect(
  resolveRelayDiagnosticConfig({
    env: { KUNAI_RELAY_BASE_URL: "https://env.example/rpc?secret=x" },
    config: { providerRelay: { baseUrl: "https://config.example", token: "config-token" } },
    configPath: "/profile/config.json",
  }),
).toMatchObject({
  kind: "run",
  source: "env",
  baseUrl: "https://env.example/rpc?secret=x",
  displayOrigin: "https://env.example",
  tokenPresent: true,
});

expect(() => relayDisplayOrigin("file:///tmp/relay")).toThrow("http or https");
expect(() => relayDisplayOrigin("https://user:pass@relay.example")).toThrow("credentials");
expect(relayAllAnimeSmokePath("file:///tmp/kunai%20repo/relay-from-config.ts")).toContain(
  "kunai repo",
);
```

Assert no serialized run result contains the actual token, query value, fragment, username, or password.

- [ ] **Step 2: Run the new unit file and confirm the helper is missing**

Run:

```sh
bun run test:cli:file test/unit/live/relay-config.test.ts
```

Expected: module or export resolution fails because `relay-config.ts` does not exist.

- [ ] **Step 3: Implement pure validation and redaction**

Parse the URL once. Accept only `http:` and `https:`, reject `username` or `password`, retain the full validated URL only for child environment, and return `url.origin` for display. Treat blank strings as absent. Environment base URL activates the diagnostic even when stored config is missing or disabled; an environment token overrides a stored token independently.

Implement the child path with Node's platform-aware conversion:

```ts
import { fileURLToPath } from "node:url";

export function relayAllAnimeSmokePath(metaUrl: string): string {
  return fileURLToPath(new URL("./relay-allanime.smoke.ts", metaUrl));
}
```

- [ ] **Step 4: Refactor the wrapper into a read-only adapter**

Keep `Bun.file(configPath).json()` inside `relay-from-config.ts`; pass the parsed object and `process.env` to the helper. Log one JSON object containing only `source`, `displayOrigin`, `tokenPresent`, `forcesAllAnime`, and the config path. Never log `baseUrl` or `token`.

Spawn:

```ts
const child = Bun.spawn({
  cmd: [process.execPath, relayAllAnimeSmokePath(import.meta.url), ...process.argv.slice(2)],
  cwd: import.meta.dir,
  env: {
    ...process.env,
    KUNAI_RELAY_BASE_URL: resolution.baseUrl,
    ...(resolution.token ? { KUNAI_RELAY_TOKEN: resolution.token } : {}),
  },
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await child.exited);
```

Do not create any profile in this parent; the existing child smoke remains the sole owner and cleaner of its disposable profile.

- [ ] **Step 5: Redact the child smoke and preserve manual scripts**

In `relay-allanime.smoke.ts`, validate `KUNAI_RELAY_BASE_URL` with the same helper and replace every `relayBaseUrl` payload field with `relayOrigin: relayDisplayOrigin(relayBaseUrl)`. Keep the current isolated `createProviderSmokeProfile("allanime")` call and forced AllManga config update.

Retain these scripts exactly:

```json
"test:relay": "bun test/live/relay-from-config.ts"
```

and at the root:

```json
"test:relay": "bun run --cwd apps/cli test:relay"
```

- [ ] **Step 6: Run relay unit and no-config behavior, then commit**

Run:

```sh
bun run test:cli:file test/unit/live/relay-config.test.ts
env -u KUNAI_RELAY_BASE_URL -u KUNAI_RELAY_TOKEN XDG_CONFIG_HOME=/tmp/kunai-relay-no-config bun run test:relay
```

Expected: unit tests pass; the manual command emits `{ "ok": true, "skipped": true }` with a clear missing-config reason and writes nothing to the real profile.

Commit:

```sh
git add apps/cli/test/live/relay-config.ts apps/cli/test/unit/live/relay-config.test.ts apps/cli/test/live/relay-from-config.ts apps/cli/test/live/relay-allanime.smoke.ts apps/cli/package.json package.json
git commit -m "test(relay): harden real-config diagnostics"
```

---

### Task 5: Restore provider-priority truth and fold into 0.3.0

**Files:**

- Modify: `packages/config/src/defaults.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `packages/providers/src/miruro/manifest.ts`
- Modify: `.docs/providers.md`
- Modify: `CHANGELOG.md`
- Modify: `apps/cli/CHANGELOG.md`
- Modify: `.release/kunai-v0.3.0.md`
- Remove: `.changeset/allmanga-lane-restoration.md`
- Regenerate: `apps/docs/lib/generated-metadata.json` and other committed docs outputs
- Modify: `.plans/roadmap.md`
- Move after all gates pass: `.plans/provider-source-reliability-0.3.0.md` and `.plans/provider-source-reliability-0.3.0-implementation.md` to `.archive/plans/`

**Interfaces:**

- Consumes: production bootstrap/candidate-planner ordering behavior and verified provider/relay results from Tasks 1–4.
- Produces: documentation and release artifacts that describe actual 0.3.0 behavior without a patch changeset or version edit.

- [ ] **Step 1: Add or restore the priority-semantics regression assertion**

Keep the default order at its pre-change value and make the test describe ordering rather than membership exclusion:

```ts
expect(DEFAULT_CONFIG.animeProvider).toBe("anidb");
expect(DEFAULT_CONFIG.animeProviderPriority[0]).toBe("anidb");
```

Use the existing candidate-planner coverage as the authority that unlisted compatible providers remain eligible. Do not add assertions that AllManga or Miruro is manual-only.

- [ ] **Step 2: Run config and provider tests before doc edits**

Run:

```sh
bun run test --filter=@kunai/config --filter=@kunai/providers
```

Expected: all tests pass with priority represented as ordering.

- [ ] **Step 3: Reconcile provider docs and manifests**

In `.docs/providers.md`:

- replace build-81/build-119 statements in current-behavior sections with build 140;
- retain historical rotations only when labeled historical;
- document AniDB's requested-first, exact `jpn`/`eng`, bounded alternate behavior;
- state that priority entries are tried first and other compatible production providers remain eligible;
- document `bun run test:relay` as an opt-in read-only diagnostic whose child uses an isolated profile;
- do not claim a direct or relay live check passed unless fresh Task 6 evidence supports it.

Keep the AllManga manifest's build-140 parity note. Restore the Miruro manifest's unrelated lane edit because its exclusion claim is not enforced by runtime priority semantics.

- [ ] **Step 4: Fold the user-facing change into unreleased 0.3.0**

Add concise bullets under existing 0.3.0 sections in both changelogs:

```md
- **Anime providers:** AniDB exposes verified Japanese and English sources without
  making optional source discovery hold playback, while AllAnime follows mkissa
  build 140 with fixed crypto regression vectors and overlapped cold preparation.
- **Relay diagnostics:** `bun run test:relay` can reproduce AllAnime metadata-relay
  failures with read-only user configuration while the smoke runs in an isolated profile.
```

Update `.release/kunai-v0.3.0.md` with deterministic provider tests, isolated AniDB/AllManga live commands, recorded duration fields, and the conditional user-owned relay command. Remove `.changeset/allmanga-lane-restoration.md`. Do not edit any `"version"` field.

- [ ] **Step 5: Regenerate docs and verify release metadata**

Run:

```sh
bun run --cwd apps/docs generate
bun run --cwd apps/docs scripts/check-codegen-freshness.ts
bun run changeset status
bun run release:notes:check
bun run verify:doc-paths
git diff --check
```

Expected: generated outputs are fresh, doc paths resolve, no provider patch changeset remains, release notes are synchronized, and no package version changes appear in `git diff`.

- [ ] **Step 6: Commit release and docs truth without archiving the active plan yet**

Commit exact release/documentation paths, leaving plan archival for the final verified commit:

```sh
git add packages/config/src/defaults.ts packages/config/test/config.test.ts packages/providers/src/miruro/manifest.ts .docs/providers.md CHANGELOG.md apps/cli/CHANGELOG.md .release/kunai-v0.3.0.md apps/docs/lib/generated-metadata.json apps/docs/lib/generated-release-notes.json apps/docs/lib/generated-troubleshooting-faq.json apps/docs/lib/generated-mascot.json
git add -u .changeset/allmanga-lane-restoration.md
git commit -m "docs(release): fold provider reliability into 0.3.0"
```

If the docs generator changed additional committed output directories, inspect and stage only outputs derived from the provider/release edits.

---

### Task 6: Verify performance, archive the plan, and prepare the PR

**Files:**

- Move: `.plans/provider-source-reliability-0.3.0.md` to `.archive/plans/provider-source-reliability-0.3.0.md`
- Move: `.plans/provider-source-reliability-0.3.0-implementation.md` to `.archive/plans/provider-source-reliability-0.3.0-implementation.md`
- Modify: `.plans/roadmap.md`
- Modify if evidence changed: `.release/kunai-v0.3.0.md`

**Interfaces:**

- Consumes: completed commits from Tasks 1–5.
- Produces: deterministic gate evidence, isolated live timings, archived completed plans, and a PR-ready branch.

- [ ] **Step 1: Run the full deterministic gate**

Run in this order:

```sh
bun run test
bun run typecheck
bun run lint
bun run fmt
bun run verify:doc-paths
bun run build
git diff --check
```

Expected: every command exits zero. After `bun run fmt`, inspect and commit only formatting changes belonging to this scope.

- [ ] **Step 2: Run fresh isolated live provider checks and capture evidence**

Run separately so deterministic success is not conflated with upstream availability:

```sh
bun run test:live:anidb
bun run test:live:allanime
```

Record `ok`, `streamHost`, `streamCandidates`, `failureCodes`, `resolveDurationMs`, and `isolatedProfile`. Confirm AniDB selected-source latency is not held by alternate discovery. Compare AllManga with the earlier approximately 12.3-second cold baseline; report the observed value without claiming a stable percentage from one sample.

- [ ] **Step 3: Run the configured relay diagnostic when credentials exist**

Run:

```sh
bun run test:relay
```

When configuration is present, require `ok: true`, an isolated child profile, and redacted relay output. When configuration is absent, record the explicit skip. Never add or change real relay configuration merely to make this gate run.

- [ ] **Step 4: Update release evidence only with observed results**

If live values differ from the values recorded in Task 5, edit `.release/kunai-v0.3.0.md` to contain the exact observed duration and result fields. Do not call a provider release-safe when only deterministic tests passed.

- [ ] **Step 5: Archive completed plans and remove the active roadmap row**

After all required deterministic work passes:

```sh
git mv .plans/provider-source-reliability-0.3.0.md .archive/plans/provider-source-reliability-0.3.0.md
git mv .plans/provider-source-reliability-0.3.0-implementation.md .archive/plans/provider-source-reliability-0.3.0-implementation.md
```

Remove the `0.3.0 source reliability` row from `.plans/roadmap.md`, run `bun run verify:doc-paths`, and commit the evidence plus archival:

```sh
git add .archive/plans/provider-source-reliability-0.3.0.md .archive/plans/provider-source-reliability-0.3.0-implementation.md .plans/roadmap.md .release/kunai-v0.3.0.md
git commit -m "chore(providers): record reliability verification"
```

- [ ] **Step 6: Review the final branch and open the PR**

Run:

```sh
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
git diff main...HEAD -- package.json apps/cli/package.json packages/config/src/defaults.ts
```

Confirm no version changed, package-script edits only retain `test:relay`, no unrelated dirty file entered a commit, and the plan's checks are reflected in the PR body. Push the branch and create the PR only after this review. The PR body separates deterministic gates, live provider evidence, conditional relay evidence, and remaining upstream risk.
