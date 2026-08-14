# Offline Identity Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one downloaded title resolvable under every id form it can arrive with, by giving downloads a real external-id record and routing every offline lookup through the existing `history_title_aliases` index.

**Architecture:** Downloads currently persist a title id canonicalised from whatever ids happened to be in hand at enqueue, and fabricate external ids afterwards by pattern-matching that id. Playback canonicalises from a title that is usually _better_ enriched, asks for an id no asset row holds, and reports "Downloaded file unavailable" for a healthy file. PR #32 patched the read side with a two-id candidate list; this plan replaces it with one resolution. Downloads store their real `externalIds` and register alias rows at enqueue; a single `OfflineTitleIdentityService` answers the one id an asset is filed under, and is used by both the write path (`adoptCompletedJob`) and every read path; a bootstrap backfill relocates legacy asset rows onto their canonical id.

**Tech Stack:** Bun 1.3.14, TypeScript, `bun:test`, SQLite (`bun:sqlite` via `@kunai/storage`), Turborepo.

## Global Constraints

- **Run tests with `bun run test`, never bare `bun test`.**
- **Run `bun run fmt:check`, never `bun run fmt`.** `fmt` _writes_ and always exits 0; that substitution is why PR #32 was green locally and red in CI's Format check.
- Layering is enforced by `apps/cli/test/unit/architecture/boundary-imports.test.ts`: `domain/` imports neither `app`, `app-shell`, nor `services`; `infra/` and `services/` import neither `app` nor `app-shell`.
- Silent no-ops are the house failure mode, gated by `apps/cli/test/unit/architecture/contract-conformance.test.ts`. Every declaration added here gets its reader in the same task.
- Data-database migrations are appended to `dataMigrations` in `packages/storage/src/migrations.ts`. The highest existing data id is `026_data_queue_playback_lifecycle`; the next is `027`.
- Never query the live database. Shadow-copy it **with its `-wal` sidecar** or the snapshot is stale.
- New identifiers must not be introduced without a consumer: `OfflineTitleIdentity` is consumed in Task 5 and Task 8, both inside this plan.

## File Structure

**Created**

| File                                                                          | Responsibility                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/cli/src/services/download/download-job-mode.ts`                         | The single derivation of a shell mode from a persisted download job       |
| `apps/cli/src/services/offline/offline-title-identity.ts`                     | The one answer to "which id are this title's offline assets filed under?" |
| `apps/cli/src/services/offline/offline-asset-identity-backfill.ts`            | Idempotent relocation of legacy asset rows onto their canonical title id  |
| `apps/cli/test/unit/services/offline/offline-title-identity.test.ts`          | Unit cover for the resolver                                               |
| `apps/cli/test/unit/services/offline/offline-asset-identity-backfill.test.ts` | Unit cover for the backfill                                               |
| `packages/storage/test/download-job-external-ids.test.ts`                     | Round-trip cover for the new column                                       |
| `packages/storage/test/offline-asset-relocate.test.ts`                        | Cover for `relocateTitleId`, including the identity-key collision         |

**Modified**

| File                                                     | Change                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/storage/src/migrations.ts`                     | Migration `027_data_download_job_external_ids`                |
| `packages/storage/src/repositories/download-jobs.ts`     | `externalIds` on the record, the row, the insert and `mapRow` |
| `packages/storage/src/repositories/offline-assets.ts`    | `listDistinctTitleIds()` and `relocateTitleId()`              |
| `packages/storage/src/index.ts`                          | Re-export what the CLI needs                                  |
| `apps/cli/src/services/download/DownloadService.ts`      | Persist real external ids, register aliases, stop fabricating |
| `apps/cli/src/services/offline/OfflineAssetService.ts`   | File assets under the resolved canonical id                   |
| `apps/cli/src/services/offline/offline-episode-index.ts` | Back to a single title id; candidate list deleted             |
| `apps/cli/src/container/bootstrap-persistence.ts`        | Run the backfill                                              |
| `apps/cli/src/container/bootstrap-services.ts`           | Construct and wire `OfflineTitleIdentityService`              |
| `apps/cli/src/container/types.ts`                        | Expose `offlineTitleIdentity`                                 |
| `apps/cli/src/app/playback/episode-playback-source.ts`   | Resolve once, pass one id                                     |
| `apps/cli/src/app/playback/PlaybackPhase.ts`             | Both offline read sites resolve through the service           |
| `apps/cli/src/app-shell/playback-mount-shell.tsx`        | Resolve once, pass one id                                     |
| `.docs/download-offline-onboarding.md`                   | Document the identity rule                                    |

---

### Task 1: Persist external ids on the download job

**Files:**

- Modify: `packages/storage/src/migrations.ts` (append to `dataMigrations`, after `026_data_queue_playback_lifecycle`)
- Modify: `packages/storage/src/repositories/download-jobs.ts`
- Test: `packages/storage/test/download-job-external-ids.test.ts`

**Interfaces:**

- Produces: `DownloadJobRecord.externalIds?: ProviderExternalIds` — populated from `download_jobs.external_ids_json`, accepted by `DownloadJobsRepository.enqueue`.

- [ ] **Step 1: Write the failing test**

Create `packages/storage/test/download-job-external-ids.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "../src/index";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "kunai-download-external-ids-"));
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return {
    jobs: new DownloadJobsRepository(db),
    dispose: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    },
  };
}

function enqueueInput(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    titleId: "tmdb:1339713",
    titleName: "Obsession",
    mediaKind: "movie" as const,
    providerId: "videasy" as const,
    mode: "series" as const,
    streamUrl: "https://example.invalid/stream.m3u8",
    headers: {},
    outputPath: "/tmp/kunai/obsession.mp4",
    tempPath: "/tmp/kunai/obsession.mp4.tmp",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("a download job round-trips the external ids it was enqueued with", () => {
  const { jobs, dispose } = repo();
  try {
    jobs.enqueue(
      enqueueInput({
        externalIds: { tmdbId: "1339713", imdbId: "tt1234567" },
      }),
    );

    expect(jobs.get("job-1")?.externalIds).toEqual({ tmdbId: "1339713", imdbId: "tt1234567" });
  } finally {
    dispose();
  }
});

test("a download job enqueued without external ids reads back undefined, not an empty bag", () => {
  const { jobs, dispose } = repo();
  try {
    jobs.enqueue(enqueueInput({ id: "job-2" }));

    expect(jobs.get("job-2")?.externalIds).toBeUndefined();
  } finally {
    dispose();
  }
});

test("provider-native ids survive the round trip", () => {
  const { jobs, dispose } = repo();
  try {
    jobs.enqueue(
      enqueueInput({
        id: "job-3",
        titleId: "21",
        externalIds: { malId: "21", providerNativeIds: { allmanga: "ReooPAxPMsHM4KPMY" } },
      }),
    );

    expect(jobs.get("job-3")?.externalIds).toEqual({
      malId: "21",
      providerNativeIds: { allmanga: "ReooPAxPMsHM4KPMY" },
    });
  } finally {
    dispose();
  }
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd packages/storage test`
Expected: FAIL. `DownloadJobRecord` has no `externalIds` field, so this fails at typecheck first — that is a legitimate red, not a broken test. Confirm the message names `externalIds`; if it names anything else, the harness is wrong rather than the code.

- [ ] **Step 3: Add the migration**

In `packages/storage/src/migrations.ts`, append to `dataMigrations` immediately after the `026_data_queue_playback_lifecycle` entry:

```ts
  {
    id: "027_data_download_job_external_ids",
    database: "data",
    sql: `
      ALTER TABLE download_jobs ADD COLUMN external_ids_json TEXT;
    `,
  },
```

- [ ] **Step 4: Carry the column through the repository**

In `packages/storage/src/repositories/download-jobs.ts`:

Import the type — change the existing import to:

```ts
import type { MediaKind, ProviderExternalIds, ProviderId } from "@kunai/types";
```

Add to `DownloadJobRecord`, directly after `readonly titleId: string;`:

```ts
  /**
   * The external ids the title carried at enqueue time.
   *
   * Without this the service had to guess them back out of `titleId`, which
   * turned a MAL-only anime into `{ anilistId: <malId> }` — a wrong id asserted
   * confidently and re-consumed on every re-resolve.
   */
  readonly externalIds?: ProviderExternalIds;
```

Add to `DownloadJobRow`, after `readonly title_id: string;`:

```ts
  readonly external_ids_json: string | null;
```

In `enqueue`, add `external_ids_json` to the column list (after `title_id`) and one more `?` placeholder in the matching position, then pass the value. The insert's column list and `VALUES` list must stay aligned — the safest edit is to place it immediately after `title_id`:

```ts
          INSERT INTO download_jobs (
            id, title_id, external_ids_json, title_name, media_kind, season, episode, provider_id,
```

with the leading placeholders becoming `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ...` and the `.run(...)` arguments becoming:

```ts
        input.id,
        input.titleId,
        input.externalIds ? JSON.stringify(input.externalIds) : null,
        input.titleName,
```

In `mapRow`, after `titleId: row.title_id,`:

```ts
    externalIds: parseExternalIds(row.external_ids_json),
```

And add beside `parseHeaders` at the bottom of the file:

```ts
function parseExternalIds(value: string | null): ProviderExternalIds | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ProviderExternalIds;
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun run --cwd packages/storage test`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add packages/storage/src/migrations.ts packages/storage/src/repositories/download-jobs.ts packages/storage/test/download-job-external-ids.test.ts
git commit -m "feat(storage): persist the external ids a download job was created with"
```

---

### Task 2: Stop fabricating external ids on re-resolve

**Files:**

- Modify: `apps/cli/src/services/download/DownloadService.ts` (`enqueue` around `:299`, the re-resolve site around `:991`, `externalIdsFromDownloadJob` at `:1532`)
- Create: `apps/cli/src/services/download/download-job-mode.ts`
- Test: `apps/cli/test/unit/services/download/download-job-external-ids.test.ts`

**Interfaces:**

- Consumes: `DownloadJobRecord.externalIds` (Task 1).
- Produces: `downloadJobShellMode(job): "series" | "anime" | "youtube"` from `@/services/download/download-job-mode`, and `downloadJobExternalIds(job): ProviderExternalIds | undefined` exported from `DownloadService.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/download/download-job-external-ids.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { downloadJobExternalIds } from "@/services/download/DownloadService";
import type { DownloadJobRecord } from "@kunai/storage";

function job(partial: Partial<DownloadJobRecord>): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "21",
    titleName: "One Piece",
    mediaKind: "anime",
    providerId: "allmanga",
    mode: "anime",
    streamUrl: "",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath: "/tmp/x.mp4",
    tempPath: "/tmp/x.mp4.tmp",
    retryCount: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...partial,
  } as DownloadJobRecord;
}

describe("downloadJobExternalIds", () => {
  test("returns the persisted bag verbatim", () => {
    expect(downloadJobExternalIds(job({ externalIds: { malId: "21" } }))).toEqual({ malId: "21" });
  });

  test("never invents an AniList id for a bare numeric anime title id", () => {
    // The old derivation read `titleId.replace(/^anilist:/, "")` and, finding
    // digits, asserted `{ anilistId: "21" }`. For a MAL-only anime that is a
    // different work entirely, and it was fed straight back into re-resolve.
    expect(downloadJobExternalIds(job({ externalIds: undefined }))).toBeUndefined();
  });

  test("recovers only what a prefixed legacy title id genuinely encodes", () => {
    expect(
      downloadJobExternalIds(job({ titleId: "tmdb:1339713", mediaKind: "movie", mode: "series" })),
    ).toEqual({ tmdbId: "1339713" });
    expect(
      downloadJobExternalIds(job({ titleId: "anilist:21", mediaKind: "anime", mode: "anime" })),
    ).toEqual({ anilistId: "21" });
    expect(
      downloadJobExternalIds(job({ titleId: "youtube:abc", mediaKind: "video", mode: "youtube" })),
    ).toEqual({ youtubeId: "abc" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd apps/cli test test/unit/services/download/download-job-external-ids.test.ts`
Expected: FAIL — `downloadJobExternalIds` is not exported.

- [ ] **Step 3: Add the mode helper**

Create `apps/cli/src/services/download/download-job-mode.ts`:

```ts
import type { DownloadJobRecord } from "@kunai/storage";

/**
 * The single derivation of a shell mode from a persisted job.
 *
 * `mode` was only added in migration 006, so older rows carry none and the
 * mode has to be recovered from `mediaKind`. That recovery was inlined in two
 * places that must agree — stream re-resolve and offline identity — and a
 * disagreement between them is invisible until a title resolves under one id
 * and is stored under another.
 */
export function downloadJobShellMode(
  job: Pick<DownloadJobRecord, "mode" | "mediaKind">,
): "series" | "anime" | "youtube" {
  if (job.mode) return job.mode;
  if (job.mediaKind === "anime") return "anime";
  if (job.mediaKind === "video") return "youtube";
  return "series";
}
```

- [ ] **Step 4: Replace the fabrication**

In `apps/cli/src/services/download/DownloadService.ts`, delete `externalIdsFromDownloadJob` (at `:1532`) entirely and add in its place:

```ts
/**
 * The external ids for a job: the persisted bag, else only what a prefixed
 * legacy title id genuinely encodes.
 *
 * The predecessor guessed: any bare numeric id on an anime job became an
 * AniList id, so a MAL-only title was re-resolved against the wrong catalog.
 * Rows written before `external_ids_json` existed still deserve the ids their
 * prefix really carries — but nothing beyond that is knowable, and inventing
 * one is worse than answering undefined.
 */
export function downloadJobExternalIds(
  job: Pick<DownloadJobRecord, "titleId" | "externalIds">,
): ProviderExternalIds | undefined {
  if (job.externalIds) return job.externalIds;
  const titleId = job.titleId.trim();
  if (titleId.startsWith("tmdb:")) return { tmdbId: titleId.slice("tmdb:".length) };
  if (titleId.startsWith("anilist:")) return { anilistId: titleId.slice("anilist:".length) };
  if (titleId.startsWith("youtube:")) return { youtubeId: titleId.slice("youtube:".length) };
  return undefined;
}
```

Add `ProviderExternalIds` to the `@kunai/types` import at the top of the file:

```ts
import type { MediaKind, ProviderExternalIds } from "@kunai/types";
```

At the re-resolve site (around `:991`), replace `externalIds: externalIdsFromDownloadJob(job),` with:

```ts
        externalIds: downloadJobExternalIds(job),
```

Immediately above it, the local `mode` derivation currently reads:

```ts
const mode =
  job.mode ??
  (job.mediaKind === "anime" ? "anime" : job.mediaKind === "video" ? "youtube" : "series");
```

Replace it with `const mode = downloadJobShellMode(job);` and import the helper:

```ts
import { downloadJobShellMode } from "./download-job-mode";
```

- [ ] **Step 5: Persist the real ids at enqueue**

In `enqueue` (around `:317`), add `externalIds` to the `this.deps.repo.enqueue({ ... })` call, directly after `titleId: canonicalTitleId,`:

```ts
      externalIds: input.title.externalIds,
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `bun run --cwd apps/cli test test/unit/services/download/download-job-external-ids.test.ts`
Expected: PASS (3 tests).

Then run the download suite to catch anything that depended on the old fabrication:
Run: `bun run --cwd apps/cli test test/unit/services/download`
Expected: PASS.

- [ ] **Step 7: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add apps/cli/src/services/download apps/cli/test/unit/services/download/download-job-external-ids.test.ts
git commit -m "fix(download): persist real external ids instead of guessing them back out of the title id"
```

---

### Task 3: Register alias rows when a download is enqueued

**Files:**

- Modify: `apps/cli/src/services/download/DownloadService.ts` (deps at `:215`, `enqueue` at `:299`)
- Modify: `apps/cli/src/container/bootstrap-services.ts` (`new DownloadService({...})` at `:170`)
- Test: `apps/cli/test/unit/services/download/download-title-aliases.test.ts`

**Interfaces:**

- Consumes: `externalIdsToAliases`, `HistoryTitleAliasInput`, `HistoryTitleAliasRepository` from `@kunai/storage`; `looksLikeOpaqueProviderNativeId` from `@kunai/core`.
- Produces: `downloadTitleAliases(title, providerId): readonly HistoryTitleAliasInput[]` exported from `DownloadService.ts`; `DownloadService` deps gain `readonly titleAliases: Pick<HistoryTitleAliasRepository, "upsertAliases">`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/download/download-title-aliases.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { downloadTitleAliases } from "@/services/download/DownloadService";

describe("downloadTitleAliases", () => {
  test("indexes every catalog id the title arrived with", () => {
    // The raw alias id is what matters: ("tmdb", "1339713") is what lets a
    // later lookup on the bare id "1339713" find the canonical "tmdb:1339713".
    expect(
      downloadTitleAliases({ id: "1339713", externalIds: { tmdbId: "1339713" } }, "videasy"),
    ).toEqual([{ ns: "tmdb", id: "1339713" }]);
  });

  test("indexes an opaque provider-native id under its provider namespace", () => {
    expect(
      downloadTitleAliases({ id: "ReooPAxPMsHM4KPMY", externalIds: undefined }, "allmanga"),
    ).toEqual([{ ns: "provider:allmanga", id: "ReooPAxPMsHM4KPMY" }]);
  });

  test("does not launder a numeric catalog id into a provider alias", () => {
    // A bare numeric id is a catalog id, not an opaque provider handle;
    // indexing it under `provider:` would collide across providers.
    expect(downloadTitleAliases({ id: "21", externalIds: { malId: "21" } }, "allmanga")).toEqual([
      { ns: "mal", id: "21" },
    ]);
  });

  test("answers empty for a title carrying nothing indexable", () => {
    expect(downloadTitleAliases({ id: "1339713", externalIds: undefined }, "videasy")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd apps/cli test test/unit/services/download/download-title-aliases.test.ts`
Expected: FAIL — `downloadTitleAliases` is not exported.

- [ ] **Step 3: Implement the projection**

In `apps/cli/src/services/download/DownloadService.ts`, add beside `downloadJobExternalIds`:

```ts
/**
 * Alias rows a download registers so its title is findable under every id it
 * arrived with.
 *
 * History has indexed its own titles this way since the catalog-identity-parity
 * work; downloads never participated, so a title only ever downloaded was
 * invisible to `lookupTitleIdByAliasId` and its assets could only be found by
 * the exact id they were filed under.
 */
export function downloadTitleAliases(
  title: Pick<TitleInfo, "id" | "externalIds">,
  providerId: string,
): readonly HistoryTitleAliasInput[] {
  const aliases = [...externalIdsToAliases(title.externalIds)];
  if (looksLikeOpaqueProviderNativeId(title.id, title.externalIds)) {
    const nativeId = title.id.replace(/^allanime:/, "").trim();
    if (nativeId) aliases.push({ ns: `provider:${providerId}`, id: nativeId });
  }
  return aliases;
}
```

Extend the imports:

```ts
import { looksLikeOpaqueProviderNativeId } from "@kunai/core";
import {
  externalIdsToAliases,
  getKunaiPaths,
  type DownloadArtifactStatus,
  type DownloadJobRecord,
  type DownloadJobsRepository,
  type HistoryTitleAliasInput,
  type HistoryTitleAliasRepository,
} from "@kunai/storage";
```

- [ ] **Step 4: Wire it into enqueue**

Add to the `deps` object type at `:215`, after `readonly repo: DownloadJobsRepository;`:

```ts
      readonly titleAliases: Pick<HistoryTitleAliasRepository, "upsertAliases">;
```

In `enqueue`, immediately after the `this.deps.repo.enqueue({ ... });` call:

```ts
// Register the download's identity so a later playback read can find its
// assets under any id form. Without this a title that was only ever
// downloaded — never watched online — has no alias row at all.
this.deps.titleAliases.upsertAliases(
  canonicalTitleId,
  downloadTitleAliases(input.title, input.providerId),
);
```

In `apps/cli/src/container/bootstrap-services.ts`, add to the `new DownloadService({ ... })` call after `repo: downloadJobs,`:

```ts
    titleAliases: historyTitleAliases,
```

`historyTitleAliases` is already on the persistence bundle (`bootstrap-persistence.ts:328`). If it is not yet destructured in `bootstrap-services.ts`, add it to the destructuring beside `downloadJobs`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `bun run --cwd apps/cli test test/unit/services/download/download-title-aliases.test.ts`
Expected: PASS (4 tests).

Run: `bun run --cwd apps/cli test test/unit/services/download`
Expected: PASS — any `new DownloadService({...})` in a test that now misses `titleAliases` fails typecheck first; give those a `{ upsertAliases: () => {} }` stub.

- [ ] **Step 6: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add apps/cli/src/services/download apps/cli/src/container/bootstrap-services.ts apps/cli/test/unit/services/download/download-title-aliases.test.ts
git commit -m "feat(download): register title aliases at enqueue so downloads participate in the identity index"
```

---

### Task 4: The single offline identity resolver

**Files:**

- Create: `apps/cli/src/services/offline/offline-title-identity.ts`
- Test: `apps/cli/test/unit/services/offline/offline-title-identity.test.ts`

**Interfaces:**

- Consumes: `downloadJobShellMode` (Task 2), `DownloadJobRecord.externalIds` (Task 1), `resolveTitleHistoryLookupId` from `@/domain/catalog/title-history-lookup`, `HistoryTitleAliasRepository.lookupTitleIdByAliasId` from `@kunai/storage`.
- Produces:
  - `interface OfflineTitleIdentity { resolveForTitle(title, mode?): string; resolveForJob(job): string }`
  - `class OfflineTitleIdentityService implements OfflineTitleIdentity`, constructed with `Pick<HistoryTitleAliasRepository, "lookupTitleIdByAliasId">`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/offline/offline-title-identity.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { OfflineTitleIdentityService } from "@/services/offline/offline-title-identity";
import type { DownloadJobRecord } from "@kunai/storage";

function identity(aliases: Record<string, string> = {}) {
  const seen: string[] = [];
  const service = new OfflineTitleIdentityService({
    lookupTitleIdByAliasId: (id: string) => {
      seen.push(id);
      return aliases[id];
    },
  });
  return { service, seen };
}

describe("OfflineTitleIdentityService.resolveForTitle", () => {
  test("uses the canonical id when the title carries enough to compute one", () => {
    const { service, seen } = identity();

    expect(
      service.resolveForTitle(
        { id: "1339713", type: "movie", externalIds: { tmdbId: "1339713" } },
        "series",
      ),
    ).toBe("tmdb:1339713");
    // No alias lookup is needed — the title answered for itself.
    expect(seen).toEqual([]);
  });

  test("upgrades a bare id through the alias index when the title carries no external ids", () => {
    // This is the download-time shape: the job was filed under "1339713"
    // because nothing richer was in hand, and history later learned the tmdb id.
    const { service, seen } = identity({ "1339713": "tmdb:1339713" });

    expect(service.resolveForTitle({ id: "1339713", type: "movie" }, "series")).toBe(
      "tmdb:1339713",
    );
    expect(seen).toEqual(["1339713"]);
  });

  test("keeps the raw id when nothing knows better", () => {
    const { service } = identity();

    expect(service.resolveForTitle({ id: "1339713", type: "movie" }, "series")).toBe("1339713");
  });

  test("resolves an opaque provider-native id through its provider alias", () => {
    const { service } = identity({ ReooPAxPMsHM4KPMY: "21" });

    expect(
      service.resolveForTitle({ id: "ReooPAxPMsHM4KPMY", type: "series", isAnime: true }, "anime"),
    ).toBe("21");
  });
});

describe("OfflineTitleIdentityService.resolveForJob", () => {
  function job(partial: Partial<DownloadJobRecord>): DownloadJobRecord {
    return {
      id: "job-1",
      titleId: "1339713",
      titleName: "Obsession",
      mediaKind: "movie",
      providerId: "videasy",
      mode: "series",
      streamUrl: "",
      headers: {},
      status: "completed",
      progressPercent: 100,
      outputPath: "/tmp/x.mp4",
      tempPath: "/tmp/x.mp4.tmp",
      retryCount: 0,
      attempt: 0,
      maxAttempts: 3,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      ...partial,
    } as DownloadJobRecord;
  }

  test("a job and its title agree on one id", () => {
    const { service } = identity();
    const externalIds = { tmdbId: "1339713" };

    expect(service.resolveForJob(job({ externalIds }))).toBe(
      service.resolveForTitle({ id: "1339713", type: "movie", externalIds }, "series"),
    );
  });

  test("an anime job resolves in anime mode, not series mode", () => {
    const { service } = identity();

    expect(
      service.resolveForJob(
        job({ titleId: "x1", mediaKind: "anime", mode: "anime", externalIds: { malId: "21" } }),
      ),
    ).toBe("21");
  });

  test("a legacy job with no stored mode recovers it from the media kind", () => {
    const { service } = identity();

    expect(
      service.resolveForJob(
        job({
          titleId: "x1",
          mediaKind: "anime",
          mode: undefined,
          externalIds: { anilistId: "21" },
        }),
      ),
    ).toBe("21");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd apps/cli test test/unit/services/offline/offline-title-identity.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the resolver**

Create `apps/cli/src/services/offline/offline-title-identity.ts`:

```ts
import { resolveTitleHistoryLookupId } from "@/domain/catalog/title-history-lookup";
import type { ShellMode, TitleInfo } from "@/domain/types";
import { downloadJobShellMode } from "@/services/download/download-job-mode";
import type { DownloadJobRecord, HistoryTitleAliasRepository } from "@kunai/storage";

export type OfflineIdentityTitle = Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">;

/** The one answer to "which id are this title's offline assets filed under?". */
export interface OfflineTitleIdentity {
  resolveForTitle(title: OfflineIdentityTitle, mode?: ShellMode): string;
  resolveForJob(
    job: Pick<DownloadJobRecord, "titleId" | "mediaKind" | "mode" | "externalIds">,
  ): string;
}

/**
 * Resolves offline title identity through the shared alias index.
 *
 * Writes and reads used to canonicalise from different starting material — a
 * download knew only what the browse row carried, playback usually knew more —
 * so the same title was stored under `1339713` and looked up as
 * `tmdb:1339713`. Both sides now call the same resolver, which prefers what the
 * title can prove about itself and falls back to what the alias index has
 * learned from history and from earlier downloads.
 */
export class OfflineTitleIdentityService implements OfflineTitleIdentity {
  constructor(
    private readonly aliases: Pick<HistoryTitleAliasRepository, "lookupTitleIdByAliasId">,
  ) {}

  resolveForTitle(title: OfflineIdentityTitle, mode?: ShellMode): string {
    const canonical = resolveTitleHistoryLookupId(title, mode);
    if (canonical !== title.id) return canonical;
    return this.aliases.lookupTitleIdByAliasId(title.id) ?? title.id;
  }

  resolveForJob(
    job: Pick<DownloadJobRecord, "titleId" | "mediaKind" | "mode" | "externalIds">,
  ): string {
    const mode = downloadJobShellMode(job);
    return this.resolveForTitle(
      {
        id: job.titleId,
        type: job.mediaKind === "movie" ? "movie" : "series",
        externalIds: job.externalIds,
        isAnime: job.mediaKind === "anime",
      },
      mode,
    );
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run --cwd apps/cli test test/unit/services/offline/offline-title-identity.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add apps/cli/src/services/offline/offline-title-identity.ts apps/cli/test/unit/services/offline/offline-title-identity.test.ts
git commit -m "feat(offline): add the single resolver for offline title identity"
```

---

### Task 5: File new assets under the resolved canonical id

**Files:**

- Modify: `apps/cli/src/services/offline/OfflineAssetService.ts`
- Modify: `apps/cli/src/container/bootstrap-services.ts` (`new OfflineAssetService(offlineAssets)` at `:141`)
- Modify: `apps/cli/test/unit/services/offline/offline-asset-service.test.ts`
- Modify: `apps/cli/test/unit/services/offline/offline-episode-index.test.ts`
- Modify: `apps/cli/test/integration/offline-local-playback-resolution.test.ts`

**Interfaces:**

- Consumes: `OfflineTitleIdentity` (Task 4).
- Produces: `new OfflineAssetService(assets, titleIdentity)` — the second argument is **required**, so no call site can silently keep the old behaviour.

- [ ] **Step 1: Write the failing test**

Add to `apps/cli/test/unit/services/offline/offline-asset-service.test.ts`:

That file already has a `completedJob(patch)` helper and builds its repository stub inline
(`new OfflineAssetService({ upsertPlayable(input) {...} } as never)`). Add:

```ts
test("adopting a completed job files the asset under the resolved canonical title id", () => {
  // The write path used to store `job.titleId` verbatim while every read
  // canonicalised, which is how a healthy 13GB download became "Downloaded
  // file unavailable".
  let stored: OfflineAssetRecord | undefined;
  const service = new OfflineAssetService(
    {
      upsertPlayable(input: OfflineAssetInput) {
        stored = {
          ...input,
          id: "asset-1",
          identityKey: `${input.titleId}:movie`,
          protected: false,
          createdAt: input.updatedAt,
        };
        return stored;
      },
    } as never,
    {
      resolveForTitle: () => "tmdb:1339713",
      resolveForJob: () => "tmdb:1339713",
    },
  );

  const adopted = service.adoptCompletedJob(
    completedJob({ titleId: "1339713", mediaKind: "movie", mode: "series" }),
  );

  expect(adopted?.titleId).toBe("tmdb:1339713");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd apps/cli test test/unit/services/offline/offline-asset-service.test.ts`
Expected: FAIL — `OfflineAssetService` takes one constructor argument, so this is a typecheck failure followed by `adopted?.titleId` being `"1339713"`.

- [ ] **Step 3: Implement**

In `apps/cli/src/services/offline/OfflineAssetService.ts`:

```ts
import type { OfflineTitleIdentity } from "./offline-title-identity";
```

Change the constructor:

```ts
  constructor(
    private readonly assets: OfflineAssetsRepository,
    private readonly titleIdentity: OfflineTitleIdentity,
  ) {}
```

In `adoptCompletedJob`, replace `titleId: job.titleId,` with:

```ts
      // Resolved, not verbatim: the read path resolves the same way, so an
      // asset can only be filed under an id a read will ask for.
      titleId: this.titleIdentity.resolveForJob(job),
```

- [ ] **Step 4: Update every construction site**

`apps/cli/src/container/bootstrap-services.ts` at `:141`:

```ts
const offlineTitleIdentity = new OfflineTitleIdentityService(historyTitleAliases);
const offlineAssetService = new OfflineAssetService(offlineAssets, offlineTitleIdentity);
```

Import `OfflineTitleIdentityService` from `@/services/offline/offline-title-identity`, and return `offlineTitleIdentity` on the services bundle so the container exposes it (Task 8 consumes `container.offlineTitleIdentity`). Add it to the container type beside `offlineAssetService`.

In the three test files, pass a stub that mirrors the production rule closely enough for the test's intent:

```ts
const passthroughIdentity = {
  resolveForTitle: (title: { id: string }) => title.id,
  resolveForJob: (job: { titleId: string }) => job.titleId,
};
```

For `apps/cli/test/integration/offline-local-playback-resolution.test.ts`, do **not** use the passthrough — use the real service so the test keeps exercising the real rule:

```ts
const aliases = new HistoryTitleAliasRepository(db);
const assets = new OfflineAssetService(
  new OfflineAssetsRepository(db),
  new OfflineTitleIdentityService(aliases),
);
```

and return `aliases` on the harness (Task 8 adds a case that seeds it).

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `bun run --cwd apps/cli test test/unit/services/offline test/integration/offline-local-playback-resolution.test.ts`
Expected: PASS. The integration suite must stay green — it is the safety net for this whole plan.

- [ ] **Step 6: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add apps/cli/src/services/offline apps/cli/src/container apps/cli/test
git commit -m "fix(offline): file adopted assets under the resolved canonical title id"
```

---

### Task 6: Relocating an asset's title id in storage

**Files:**

- Modify: `packages/storage/src/repositories/offline-assets.ts`
- Test: `packages/storage/test/offline-asset-relocate.test.ts`

**Interfaces:**

- Produces:
  - `OfflineAssetsRepository.listDistinctTitleIds(): readonly string[]`
  - `OfflineAssetsRepository.relocateTitleId(oldTitleId, newTitleId, now?): number` — returns rows moved.

- [ ] **Step 1: Write the failing test**

Create `packages/storage/test/offline-asset-relocate.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OfflineAssetsRepository, openKunaiDatabase, runMigrations } from "../src/index";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "kunai-offline-relocate-"));
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return {
    assets: new OfflineAssetsRepository(db),
    dispose: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    },
  };
}

function assetInput(titleId: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    titleId,
    titleName: "Obsession",
    mediaKind: "movie" as const,
    season: 1,
    episode: 1,
    profileKey: "series:original:none:best",
    originJobId: `job-${titleId}`,
    filePath: `/tmp/${titleId}.mp4`,
    state: "ready" as const,
    byteSize: 10,
    updatedAt: now,
    ...overrides,
  };
}

test("relocating rewrites both the title id and the derived identity key", () => {
  const { assets, dispose } = repo();
  try {
    assets.upsertPlayable(assetInput("1339713"));

    expect(assets.relocateTitleId("1339713", "tmdb:1339713")).toBe(1);

    expect(assets.listTitleAssets("1339713")).toEqual([]);
    const moved = assets.listTitleAssets("tmdb:1339713");
    expect(moved).toHaveLength(1);
    // The identity key is what `upsertPlayable` conflicts on. Leaving it stale
    // would make the next adopt insert a duplicate row for the same file.
    expect(moved[0]?.identityKey).toContain("tmdb:1339713");
  } finally {
    dispose();
  }
});

test("relocating onto an id that already holds the same episode collapses to one row", () => {
  const { assets, dispose } = repo();
  try {
    assets.upsertPlayable(assetInput("1339713"));
    assets.upsertPlayable(assetInput("tmdb:1339713", { originJobId: "job-canonical" }));

    assets.relocateTitleId("1339713", "tmdb:1339713");

    expect(assets.listTitleAssets("tmdb:1339713")).toHaveLength(1);
    expect(assets.listTitleAssets("1339713")).toEqual([]);
  } finally {
    dispose();
  }
});

test("relocating is a no-op when there is nothing to move or the ids match", () => {
  const { assets, dispose } = repo();
  try {
    assets.upsertPlayable(assetInput("1339713"));

    expect(assets.relocateTitleId("nothing-here", "tmdb:1339713")).toBe(0);
    expect(assets.relocateTitleId("1339713", "1339713")).toBe(0);
    expect(assets.listTitleAssets("1339713")).toHaveLength(1);
  } finally {
    dispose();
  }
});

test("listDistinctTitleIds answers each title once", () => {
  const { assets, dispose } = repo();
  try {
    assets.upsertPlayable(assetInput("1339713"));
    assets.upsertPlayable(assetInput("1339713", { episode: 2, originJobId: "job-b" }));
    assets.upsertPlayable(assetInput("61222", { originJobId: "job-c" }));

    expect([...assets.listDistinctTitleIds()].sort()).toEqual(["1339713", "61222"]);
  } finally {
    dispose();
  }
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd packages/storage test`
Expected: FAIL — `relocateTitleId` is not a function.

- [ ] **Step 3: Implement**

In `packages/storage/src/repositories/offline-assets.ts`, add to `OfflineAssetsRepository` (beside `listByTitleIds`):

```ts
  listDistinctTitleIds(): readonly string[] {
    return this.db
      .query<{ title_id: string }, []>("SELECT DISTINCT title_id FROM offline_assets")
      .all()
      .map((row) => row.title_id);
  }

  /**
   * Move every asset filed under `oldTitleId` onto `newTitleId`, returning how
   * many moved.
   *
   * `identity_key` embeds the title id and is the UNIQUE key `upsertPlayable`
   * conflicts on, so it has to move too — otherwise the next adopt of the same
   * file inserts a second row. `UPDATE OR REPLACE` handles the case where the
   * destination already holds the same episode under the same profile: the
   * duplicate is dropped rather than the update failing.
   */
  relocateTitleId(
    oldTitleId: string,
    newTitleId: string,
    now = new Date().toISOString(),
  ): number {
    if (!oldTitleId || !newTitleId || oldTitleId === newTitleId) return 0;
    const rows = this.db
      .query<OfflineAssetRow, [string]>("SELECT * FROM offline_assets WHERE title_id = ?")
      .all(oldTitleId);
    if (rows.length === 0) return 0;
    const update = this.db.query(
      "UPDATE OR REPLACE offline_assets SET title_id = ?, identity_key = ?, updated_at = ? WHERE id = ?",
    );
    for (const row of rows) {
      const identityKey = createOfflineAssetIdentityKey({
        titleId: newTitleId,
        mediaKind: row.media_kind,
        season: row.season ?? undefined,
        episode: row.episode ?? undefined,
        profileKey: row.profile_key,
      });
      update.run(newTitleId, identityKey, now, row.id);
    }
    return rows.length;
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run --cwd packages/storage test`
Expected: PASS (4 tests).

If the collision test fails with a UNIQUE constraint error rather than collapsing, the connection has `PRAGMA foreign_keys` interacting with `OR REPLACE`; check `openKunaiDatabase` in `packages/storage/src/sqlite.ts` and, if needed, delete the conflicting destination row explicitly before the update instead of relying on `OR REPLACE`.

- [ ] **Step 5: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add packages/storage/src/repositories/offline-assets.ts packages/storage/test/offline-asset-relocate.test.ts
git commit -m "feat(storage): relocate offline assets onto a new title id, identity key included"
```

---

### Task 7: Backfill legacy asset rows at bootstrap

**Files:**

- Create: `apps/cli/src/services/offline/offline-asset-identity-backfill.ts`
- Modify: `apps/cli/src/container/bootstrap-persistence.ts`
- Test: `apps/cli/test/unit/services/offline/offline-asset-identity-backfill.test.ts`

**Interfaces:**

- Consumes: `listDistinctTitleIds`, `relocateTitleId` (Task 6); `lookupTitleIdByAliasId` from `@kunai/storage`.
- Produces: `runOfflineAssetIdentityBackfill(assets, aliases): OfflineAssetIdentityBackfillStats` where `OfflineAssetIdentityBackfillStats = { titlesScanned: number; titlesRelocated: number; assetsRelocated: number }`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/offline/offline-asset-identity-backfill.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { runOfflineAssetIdentityBackfill } from "@/services/offline/offline-asset-identity-backfill";

function assetsStub(titleIds: readonly string[]) {
  const moves: Array<{ from: string; to: string }> = [];
  return {
    moves,
    repo: {
      listDistinctTitleIds: () => titleIds,
      relocateTitleId: (from: string, to: string) => {
        moves.push({ from, to });
        return 1;
      },
    },
  };
}

describe("runOfflineAssetIdentityBackfill", () => {
  test("moves an asset filed under a raw id onto the canonical id history knows", () => {
    const { repo, moves } = assetsStub(["1339713"]);

    const stats = runOfflineAssetIdentityBackfill(repo, {
      lookupTitleIdByAliasId: (id) => (id === "1339713" ? "tmdb:1339713" : undefined),
    });

    expect(moves).toEqual([{ from: "1339713", to: "tmdb:1339713" }]);
    expect(stats).toEqual({ titlesScanned: 1, titlesRelocated: 1, assetsRelocated: 1 });
  });

  test("leaves a title alone when the alias index knows nothing better", () => {
    const { repo, moves } = assetsStub(["1339713"]);

    const stats = runOfflineAssetIdentityBackfill(repo, {
      lookupTitleIdByAliasId: () => undefined,
    });

    expect(moves).toEqual([]);
    expect(stats.titlesRelocated).toBe(0);
  });

  test("is idempotent: a second pass over already-canonical rows moves nothing", () => {
    // It runs on every bootstrap by design — an asset written before history
    // learned the title's ids would be stranded forever by a one-shot marker.
    const { repo, moves } = assetsStub(["tmdb:1339713"]);

    runOfflineAssetIdentityBackfill(repo, {
      lookupTitleIdByAliasId: (id) => (id === "1339713" ? "tmdb:1339713" : undefined),
    });

    expect(moves).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd apps/cli test test/unit/services/offline/offline-asset-identity-backfill.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `apps/cli/src/services/offline/offline-asset-identity-backfill.ts`:

```ts
import type { HistoryTitleAliasRepository, OfflineAssetsRepository } from "@kunai/storage";

export type OfflineAssetIdentityBackfillStats = {
  readonly titlesScanned: number;
  readonly titlesRelocated: number;
  readonly assetsRelocated: number;
};

/**
 * Move offline assets filed under a non-canonical title id onto the canonical
 * one the alias index knows.
 *
 * This runs on every bootstrap rather than once behind a migration marker.
 * An asset can be written under a raw id at a moment when nothing yet knows
 * the title's catalog ids, and only become relocatable later when history or
 * another download registers them — a one-shot pass would strand exactly those
 * rows. The scan is one `SELECT DISTINCT` over a table with tens of rows plus
 * one indexed point lookup each.
 */
export function runOfflineAssetIdentityBackfill(
  assets: Pick<OfflineAssetsRepository, "listDistinctTitleIds" | "relocateTitleId">,
  aliases: Pick<HistoryTitleAliasRepository, "lookupTitleIdByAliasId">,
): OfflineAssetIdentityBackfillStats {
  const titleIds = assets.listDistinctTitleIds();
  let titlesRelocated = 0;
  let assetsRelocated = 0;
  for (const titleId of titleIds) {
    const canonical = aliases.lookupTitleIdByAliasId(titleId);
    if (!canonical || canonical === titleId) continue;
    const moved = assets.relocateTitleId(titleId, canonical);
    if (moved === 0) continue;
    titlesRelocated += 1;
    assetsRelocated += moved;
  }
  return { titlesScanned: titleIds.length, titlesRelocated, assetsRelocated };
}
```

- [ ] **Step 4: Run it at bootstrap**

In `apps/cli/src/container/bootstrap-persistence.ts`, after `const offlineAssets = new OfflineAssetsRepository(dataDb);` (`:230`) and after `historyTitleAliases` is constructed (`:203`):

```ts
const offlineIdentityBackfill = runOfflineAssetIdentityBackfill(offlineAssets, historyTitleAliases);
if (debug && offlineIdentityBackfill.assetsRelocated > 0) {
  logger.info(
    `Offline identity backfill moved ${offlineIdentityBackfill.assetsRelocated} asset(s) across ${offlineIdentityBackfill.titlesRelocated} title(s)`,
  );
}
```

Import it:

```ts
import { runOfflineAssetIdentityBackfill } from "@/services/offline/offline-asset-identity-backfill";
```

Match the surrounding style — the two existing backfills in that file (`isWatchLedgerBackfillApplied` block and the consolidator block) log under `debug` the same way.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `bun run --cwd apps/cli test test/unit/services/offline/offline-asset-identity-backfill.test.ts`
Expected: PASS (3 tests).

Run: `bun run --cwd apps/cli test test/unit/container`
Expected: PASS.

- [ ] **Step 6: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add apps/cli/src/services/offline/offline-asset-identity-backfill.ts apps/cli/src/container/bootstrap-persistence.ts apps/cli/test/unit/services/offline/offline-asset-identity-backfill.test.ts
git commit -m "feat(offline): relocate legacy assets onto their canonical title id at startup"
```

---

### Task 8: One id on every read path, candidate list deleted

**Files:**

- Modify: `apps/cli/src/services/offline/offline-episode-index.ts`
- Modify: `apps/cli/src/app/playback/episode-playback-source.ts:42-47`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts:1293` and `:1323-1327`
- Modify: `apps/cli/src/app-shell/playback-mount-shell.tsx:200-205`
- Modify: `apps/cli/test/unit/app/playback/episode-playback-source.test.ts`
- Modify: `apps/cli/test/unit/services/offline/offline-episode-index.test.ts`
- Modify: `apps/cli/test/integration/offline-local-playback-resolution.test.ts`

**Interfaces:**

- Consumes: `container.offlineTitleIdentity` (Task 5).
- Produces: `isEpisodeDownloaded`, `findNextReadyEpisode` and `findReadyJobIdForEpisode` take `titleId: string` again. `OfflineTitleIdQuery`, `assetsFor` and `offlineAssetTitleIdCandidates` no longer exist.

- [ ] **Step 1: Write the failing test**

Add to `apps/cli/test/integration/offline-local-playback-resolution.test.ts` — this is the case the candidate list structurally cannot serve:

```ts
test("a downloaded title resolves from an opaque provider id once an alias exists", async () => {
  // The asset is filed under the canonical id "21". The user arrives from a
  // provider search whose title id is the provider's own opaque handle and
  // carries no external ids at all, so no amount of canonicalising the title
  // reaches "21" — only the alias index does.
  const harness = createHarness({ titleId: "21", mediaKind: "series", season: 1, episode: 1 });
  harness.aliases.upsertAliases("21", [{ ns: "provider:allmanga", id: "ReooPAxPMsHM4KPMY" }]);

  const resolution = await resolveLocalEpisodePlayback(
    containerFor(harness),
    {
      id: "ReooPAxPMsHM4KPMY",
      type: "series",
      name: "Demo",
      launchSource: "offline-library",
    },
    { season: 1, episode: 1 },
    { entrypoint: "offline-library", forceLocal: true },
  );

  expect(resolution?.stream.url).toBe(harness.filePath);
});
```

`containerFor` must now supply `offlineTitleIdentity: new OfflineTitleIdentityService(harness.aliases)`, and `createHarness` must return `aliases` (started in Task 5).

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run --cwd apps/cli test test/integration/offline-local-playback-resolution.test.ts`
Expected: FAIL — `resolution` is `null`; the candidate list only ever produces `["ReooPAxPMsHM4KPMY"]`.

- [ ] **Step 3: Return the index to a single id**

In `apps/cli/src/services/offline/offline-episode-index.ts`, delete `OfflineTitleIdQuery`, `offlineAssetTitleIdCandidates` and `assetsFor`, drop the now-unused `resolveTitleHistoryLookupId`, `ShellMode`, `TitleInfo` and `OfflineAssetRecord` imports, and restore the single-id signatures:

```ts
export function isEpisodeDownloaded(
  offlineAssetService: OfflineAssetService,
  titleId: string,
  season?: number,
  episode?: number,
): boolean {
  return offlineAssetService
    .listTitleAssets(titleId)
    .some(
      (asset) =>
        asset.state === "ready" &&
        (season === undefined || asset.season === season) &&
        (episode === undefined || asset.episode === episode),
    );
}
```

```ts
/**
 * The next downloaded episode after `current`, or null when nothing is ready.
 *
 * The offline launch path must answer episode availability from the library
 * rather than the catalog: returning null unconditionally reads as "series
 * finished" downstream, so a downloaded next episode would never autoplay.
 */
export function findNextReadyEpisode(
  offlineAssetService: OfflineAssetService,
  titleId: string,
  current: { readonly season: number; readonly episode: number },
): { readonly season: number; readonly episode: number } | null {
  if (!titleId) return null;
  const next = offlineAssetService
    .listNextReadyByTitleCursors([{ titleId, season: current.season, episode: current.episode }])
    .find((asset) => asset.season != null && asset.episode != null);
  if (!next || next.season == null || next.episode == null) return null;
  return { season: next.season, episode: next.episode };
}
```

```ts
export function findReadyJobIdForEpisode(
  offlineAssetService: OfflineAssetService,
  titleId: string,
  season: number,
  episode: number,
  options: {
    readonly mediaKind?: "movie" | "series" | "anime" | "video";
  } = {},
): string | undefined {
  return offlineAssetService
    .listTitleAssets(titleId)
    .find(
      (asset) =>
        asset.state === "ready" &&
        (options.mediaKind === "movie" || options.mediaKind === "video"
          ? asset.mediaKind === options.mediaKind
          : asset.season === season && asset.episode === episode),
    )?.originJobId;
}
```

- [ ] **Step 4: Resolve once at each of the four read sites**

`apps/cli/src/app/playback/episode-playback-source.ts` — replace the `offlineAssetTitleIdCandidates(title, mode)` argument and its import:

```ts
const jobId = findReadyJobIdForEpisode(
  container.offlineAssetService,
  container.offlineTitleIdentity.resolveForTitle(title, mode),
  episode.season,
  episode.episode,
  { mediaKind },
);
```

`apps/cli/src/app/playback/PlaybackPhase.ts` at `:1293` — this site never used the candidate list and still carries the original bug, so the episode picker marks downloaded episodes as not downloaded for any enriched title:

```ts
const offlineTitleId = container.offlineTitleIdentity.resolveForTitle(title, playbackMode);
const downloadedEpisodes = new Set(
  container.offlineAssetService
    .listTitleAssets(offlineTitleId)
    .filter((asset) => asset.state === "ready")
    .map((asset) => `${asset.season ?? 1}:${asset.episode ?? 1}`),
);
```

and at `:1323`:

```ts
                nextEpisode: findNextReadyEpisode(
                  container.offlineAssetService,
                  offlineTitleId,
                  currentEpisode,
                ),
```

Drop the `offlineAssetTitleIdCandidates` import; keep `resolveTitleHistoryLookupId` only if `:2389` still uses it.

`apps/cli/src/app-shell/playback-mount-shell.tsx` at `:200`:

```ts
isEpisodeDownloaded(
  container.offlineAssetService,
  container.offlineTitleIdentity.resolveForTitle(title, state.mode),
  episode.season,
  episode.episode,
);
```

- [ ] **Step 5: Update the unit tests to the single-id contract**

In `apps/cli/test/unit/services/offline/offline-episode-index.test.ts`, the `listByTitleIds` stubs are no longer exercised by these functions; the cursor assertion returns to its single-cursor form, which it already is:

```ts
expect(cursorsSeen).toEqual([[{ titleId: "t1", season: 1, episode: 1 }]]);
```

In `apps/cli/test/unit/app/playback/episode-playback-source.test.ts` ("matches downloaded assets by the canonical title id"), the container stub currently answers both `listTitleAssets` and `listByTitleIds`. Drop the `listByTitleIds` branch, add the identity service, and assert the canonical id is the **only** one requested:

```ts
      offlineAssetService: {
        listTitleAssets: (titleId: string) => {
          requestedTitleIds.push(titleId);
          return assetsById(titleId);
        },
      },
      offlineTitleIdentity: new OfflineTitleIdentityService({
        lookupTitleIdByAliasId: () => undefined,
      }),
```

```ts
expect(requestedTitleIds).toEqual(["151807"]);
```

The title carries `anilistId: "151807"`, so the resolver answers the canonical id outright and never reaches the alias index — which is exactly why the assertion can be exact again. Its comment still describes the raw id "riding along as a fallback"; rewrite it to describe the single resolution.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `bun run --cwd apps/cli test test/unit/services/offline test/integration/offline-local-playback-resolution.test.ts`
Run: `bun run --cwd apps/cli test test/unit/app/playback/episode-playback-source.test.ts`
Run: `bun run --cwd apps/cli test test/unit/app/playback`
Expected: PASS, including the new provider-alias case and all six pre-existing integration cases.

- [ ] **Step 7: Confirm the candidate list is gone**

```bash
rg -n "offlineAssetTitleIdCandidates|OfflineTitleIdQuery|assetsFor" apps packages
```

Expected: no matches. Both mechanisms must not survive together.

- [ ] **Step 8: Run the gates and commit**

```bash
bun run typecheck && bun run lint && bun run fmt:check
git add apps/cli/src apps/cli/test
git commit -m "fix(offline): resolve every offline lookup through one title id"
```

---

### Task 9: Document the rule and verify the whole change

**Files:**

- Modify: `.docs/download-offline-onboarding.md`
- Modify: `docs/superpowers/plans/2026-08-13-offline-identity-unification-handoff.md` (mark landed) or move it under the wave's `archive/`, following whatever that board does with landed pairs

- [ ] **Step 1: Write the identity rule down**

Add a short section to `.docs/download-offline-onboarding.md` stating the invariant, in the voice of the surrounding doc:

- An offline asset is filed under the id `OfflineTitleIdentityService.resolveForJob` answers, and every read asks `resolveForTitle` for the same id. Neither side canonicalises on its own.
- `download_jobs.external_ids_json` is the download's own record of the ids the title arrived with. Nothing may re-derive external ids from a title id.
- Aliases are registered at enqueue and at every history upsert; `runOfflineAssetIdentityBackfill` relocates rows whose canonical id was learned after the asset was written, and runs on every bootstrap because that learning has no deadline.

- [ ] **Step 2: Check the doc paths resolve**

Run: `bun run verify:doc-paths`
Expected: PASS.

- [ ] **Step 3: Run the full gate set from the worktree root**

```bash
bun run typecheck && bun run lint && bun run fmt:check && bun run test && bun run build && git diff --check
```

Report the real outcome of each. If anything is skipped, excluded, or environmental, say so explicitly rather than summarising as green.

- [ ] **Step 4: Verify against a shadow copy of the real database**

```bash
cd "$(mktemp -d)"
cp ~/.local/share/kunai/kunai-data.sqlite ./s.sqlite
cp ~/.local/share/kunai/kunai-data.sqlite-wal ./s.sqlite-wal
```

Then confirm, read-only against the shadow: how many `offline_assets` rows have a `title_id` that `history_title_aliases` maps to a different id (these are what the backfill will move), and that no `download_jobs` row would lose information.

Never touch the live database. Omitting the `-wal` sidecar produces a stale snapshot — that mistake previously showed a completed job as `running` at 86%.

- [ ] **Step 5: Commit and open the PR**

```bash
git add .docs docs
git commit -m "docs: record the offline identity rule"
git push -u origin fix/offline-identity-unification
gh pr create --title "fix(offline): unify offline title identity" --body "..."
```

The PR body should state: the invariant now enforced, that the candidate list from #32 is deleted rather than layered over, the migration added, and that the backfill runs on every bootstrap and why.

---

## Manual verification

Automated cover cannot see the terminal. After the gates pass, run the real binary once:

```sh
bun run dev -- --debug
```

- Confirm the current `readlink /proc/<pid>/cwd` is this worktree before trusting anything you see. A stale worktree previously produced a "bug" that was only missing code.
- Open the offline library, press enter on a downloaded title, and confirm it plays rather than reporting "Downloaded file unavailable".
- Open a downloaded series' episode picker and confirm the downloaded episodes are marked as downloaded.
- Play a downloaded episode to its end and confirm the next downloaded episode autoplays.

---

## What execution changed about this plan

Recorded because the handoff and the first draft of this plan were wrong on
three points, and the reasons matter more than the corrections.

1. **The handoff named `reassignTitleId` for the backfill.** That method belongs
   to `HistoryTitleAliasRepository` and moves _alias_ rows; it cannot move an
   asset. Moving an asset also has to rewrite `identity_key`, which embeds the
   title id and is the UNIQUE key `upsertPlayable` conflicts on — so the work
   became a new `OfflineAssetsRepository.relocateTitleId` (Task 6).

2. **The bootstrap backfill is not one-shot.** A one-shot marker would strand
   every asset written under a raw id before anything knew the title's catalog
   ids. The scan is one `SELECT DISTINCT` plus an indexed lookup per title, so
   it runs every bootstrap instead.

3. **The backfill alone does not fix the reported title.** Verified against a
   shadow copy of the real database: the single `offline_assets` row is filed
   under `1339713`, and `history_title_aliases` holds no alias for that id — so
   the backfill would relocate nothing. The information only exists on the
   _title_ at read time. `OfflineTitleIdentityService.resolveForTitle` therefore
   relocates rows still filed under the id a title arrived with, once per id per
   session, and the same shadow copy then resolves `1339713` → `tmdb:1339713`
   and returns the real job id.

   Task 8's integration case for the tmdb form went red when the candidate list
   was deleted, which is how this was caught. Two triggers of one operation
   (`relocateTitleId`) is not the same thing as two lookup strategies — the
   candidate list is gone.
