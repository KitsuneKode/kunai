# Share Links & PlaybackTargetRef — Implementation Plan

> **⚠️ SUPERSEDED / IMPLEMENTED (2026-06-24).** This feature is fully landed and green. The canonical reference is now [`.docs/share-links.md`](../.docs/share-links.md) — read that for current behavior. This document is retained for historical context only.
>
> **Key divergence from this spec:** the shipped implementation has **NO back-compat**. The legacy `kunai1:` clipboard codec (`apps/cli/src/domain/share/share-code.ts`) was **deleted**, not kept decode-only, and the legacy `id`/`type`/`search`/`mode` URL params are **not** supported — the parser returns `null` when neither `cat` nor `q` is present. The canonical format is only `kunai://play?cat=<ns>:<id>&kind=…` / `kunai://download?…` with a `q=<query>` search fallback. The dead Phase 4 `PlaybackIntentBus`/`PlaybackIterationState` scaffolding was removed as planned. Wherever the text below describes legacy decode or back-compat params, treat it as historical intent that was dropped.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [CLAUDE.md](../CLAUDE.md) Hard Boundaries and [.docs/architecture.md](../.docs/architecture.md) before touching playback/resolution code.

**Goal:** Replace the two inconsistent, incomplete share encodings (`kunai1:` clipboard codes + `kunai://` handoff URLs) with one canonical, catalog-anchored, cross-machine/cross-provider portable link model (`PlaybackTargetRef`) that carries series → episode → timestamp, drives every share surface, and from which Discord links are derived.

**Architecture:** One pure domain model + URL codec (`domain/share/`), one container-aware resolver (`app/resolve-share-target.ts`) that reuses existing title/anime/provider machinery, a one-shot bootstrap start-position channel for shared timestamps (riding the existing `--start`/`targetResumeSeconds` seam), then thin wiring at each surface (`/share`, `/watch`, post-play, history, `kunai open`/`kunai://`, Discord). Legacy `kunai1:` codes stay decode-only for back-compat. The unwired Phase 4 `PlaybackIntentBus`/`PlaybackIterationState` scaffolding is removed — this feature is the real "what to play" abstraction it was a placeholder for.

**Tech Stack:** Bun + TypeScript, `commander` (CLI args), Node `URL`, `@kunai/types` (`ProviderExternalIds`), existing `bun run test` (bun test runner via wrapper), `bun run typecheck`, `bun run lint`, `bun run fmt`.

---

## Resolved decisions (was open during brainstorming)

| Topic                                                  | Decision                                                                                                                         | Why                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Two encodings (`kunai1:` + `kunai://`)                 | Collapse to **one** canonical `kunai://` URL string; legacy `kunai1:` stays **decode-only**                                      | Kills duplication + the portability bug; one human-readable format for clipboard, CLI, protocol, Discord-derivation |
| Link anchor                                            | **Catalog IDs** (`tmdb`/`anilist`/`mal`/`imdb`) with a **`search` fallback** for un-anchorable titles                            | `title.id` is often provider-native → not portable across machines/providers. This is the core bug being fixed      |
| Granularity                                            | title / season+episode / anime absolute / **optional timestamp**                                                                 | Matches "series → episode → timestamp" intent; timestamp is opt-in                                                  |
| Provider hint                                          | Optional `src=` hint; resolver applies only if registered+enabled, else default + **note**; never hard-fail                      | "provider-specific or something" without breaking portability                                                       |
| Discord button                                         | Stays an **https catalog link** but **derived from the same ref**; playable `kunai://` ref goes in presence text, not the button | Discord rejects custom URI schemes on buttons (http(s) only) — honest constraint                                    |
| In-mpv "copy at current time" hotkey                   | **Deferred to last slice (Phase F, optional)**; paused/post-play copy using last-known position ships first                      | Real mpv `input.conf`+IPC work; 90% of value comes from the cheaper paths                                           |
| Phase 4 `PlaybackIntentBus` / `PlaybackIterationState` | **Remove now** (unwired, only self-referenced by tests)                                                                          | Superseded by this feature; dead scaffolding is a maintainability smell                                             |
| Model home                                             | `apps/cli/src/domain/share/` for now (pure); promote to `packages/core` only when web needs it                                   | YAGNI; keep it pure and local until a second consumer exists                                                        |

---

## Orchestrator status board

| Phase | Focus                                                                                                   | Depends on | Parallel?          | Status                |
| ----- | ------------------------------------------------------------------------------------------------------- | ---------- | ------------------ | --------------------- |
| A     | Pure model + `kunai://` URL codec + legacy decode bridge                                                | —          | —                  | done (no back-compat) |
| B     | Container-aware `resolveShareTarget` resolver                                                           | A          | —                  | done                  |
| C     | One-shot bootstrap start-position (shared timestamp resume)                                             | A          | with B             | done                  |
| D     | Surface wiring: `/share`, `/watch`, post-play, history, `kunai open` + `kunai://`, arg/handoff refactor | A,B,C      | —                  | done (no back-compat) |
| E     | Discord links derived from `PlaybackTargetRef`                                                          | A,B        | after D core types | done                  |
| F     | (Optional) in-mpv hotkey: copy share link at live position                                              | D          | optional           | done                  |
| G     | Remove Phase 4 `PlaybackIntentBus`/`PlaybackIterationState` scaffolding                                 | A–F landed | end cleanup        | done                  |
| H     | Docs + plan-truth + test-debt sweep (incl. batched surface tests)                                       | A–G        | last               | done                  |

**Decision log (fill as you land):**

| Phase | Decision point                               | Choice                                                                                                                                                |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| C     | timestamp wins-over-history strategy         | one-shot bootstrap start, `max(shared, history)` for first play only                                                                                  |
| D     | `kunai open` vs `--handoff-url` confirmation | `open` = user-trusted (no extra confirm); `kunai://` handoff keeps confirmation                                                                       |
| G     | When to remove Phase 4 scaffolding           | **Deferred to after the feature lands** (dead/unwired + git-recoverable, so removal is risk-free; defer buys decision-with-full-context at zero cost) |

## Testing posture (hybrid — confirmed)

- **TDD on pure logic (Phases A, B, C helpers):** write tests alongside — codec round-trips, legacy decode, back-compat params, timestamp parsing, resolver branches, `resolveBootstrapStartSeconds`. These ARE the portability + back-compat guarantees and are the cheapest tests to write (no container/mocks).
- **Batch surface/integration tests (Phases D, E) at the end (Phase H):** `/share`, `/watch`, handoff, `kunai open`, Discord. Heavier fixtures; deferring these is where time is actually saved.
- Rationale: a codec that silently drops a field or a legacy code that won't decode = a friend's link won't play, undetectable without the pure tests. Do not defer those.

---

## Blast radius / other logics affected (read before starting)

- **`apps/cli/src/app/handoff-url.ts`** — `KunaiHandoffLaunch` shape changes (adds episode/timestamp/anchor). Consumers to update in lockstep:
  - `apps/cli/src/main.ts` (`mergeHandoffIntoArgs` ~L80-92; `parseKunaiHandoffUrl` use ~L534).
  - `apps/cli/src/services/media-actions/MediaActionRouter.ts` (handoff execution).
  - `apps/cli/test/unit/app/handoff-url.test.ts`, `apps/cli/test/unit/main-args.test.ts`.
- **`apps/cli/src/domain/share/share-code.ts`** — becomes decode-only legacy bridge. Consumers: `apps/cli/src/app-shell/workflows.ts` (`handleShare`/`handleWatch`), `apps/cli/test/unit/domain/share/share-code.test.ts`.
- **`history-entry` `ShellWorkflowResult`** carries `title` + `episode` but **no timestamp today**. Gains optional `startSeconds`. Producers/consumers: `apps/cli/src/app-shell/workflows.ts`, `apps/cli/src/app-shell/command-router.ts`, `apps/cli/src/app/post-playback-routing.ts`, `apps/cli/src/app/SearchPhase.ts`.
- **Initial resume seam** — `apps/cli/src/app/PlaybackPhase.ts` first-play `pendingStart` via `startEpisodeNavigation({ targetResumeSeconds })` + `resumeSecondsFromHistoryForEpisode` (`apps/cli/src/app/playback-resume-from-history.ts`); mpv `--start` gate is `shouldApplyStartAtSeek` (`apps/cli/src/infra/player/mpv-start-seek.ts`).
- **Anime cross-provider mapping** — reuse `mapAnimeDiscoveryResultToProviderNative` (`apps/cli/src/app/anime-provider-mapping.ts`); do **not** modify it.
- **Discord** — `apps/cli/src/services/presence/discord-activity-links.ts` + `PresenceService` consumers.
- **CLI args** — `apps/cli/src/cli-args.ts` (`CliArgs`, `KNOWN_FLAGS`, `VALUE_FLAGS`, commander options) + `main.ts`.
- **Provider id aliases** — reuse `resolveProviderIdAlias` / `isVideasyFamilyProvider` (`packages/core/src/provider-id-aliases.ts`) when comparing `src=` hints.

---

## File structure (locked decomposition)

- **Create** `apps/cli/src/domain/share/playback-target-ref.ts` — pure: `PlaybackTargetRef`, `ShareAnchor`, `CatalogNs`, `encodePlaybackTargetRef`, `parsePlaybackTargetRef`, `parseTimestampToSeconds`, `formatSecondsForUrl`. No container, no I/O.
- **Modify** `apps/cli/src/domain/share/share-code.ts` — keep `decodeShareCode` (legacy bridge); keep `encodeShareCode` only if still referenced by its test (no new callers).
- **Create** `apps/cli/src/app/resolve-share-target.ts` — container-aware: `resolveShareTarget(ref, container) -> ResolvedShareTarget`.
- **Modify** `apps/cli/src/app/handoff-url.ts` — re-express `KunaiHandoffLaunch` on top of `PlaybackTargetRef` + `action`; `parseKunaiHandoffUrl`/`buildKunaiPlaybackHandoffUrl` delegate to the codec.
- **Modify** `apps/cli/src/app-shell/workflows.ts` — `handleShare` emits URL (with/without timestamp), `handleWatch` parses URL + legacy code + threads `startSeconds`.
- **Modify** `apps/cli/src/app-shell/command-router.ts`, `apps/cli/src/app/post-playback-routing.ts` — `history-entry` gains optional `startSeconds`; add post-play / history "copy share link".
- **Modify** `apps/cli/src/app/PlaybackPhase.ts` — consume one-shot bootstrap start-position for first play.
- **Modify** `apps/cli/src/cli-args.ts`, `apps/cli/src/main.ts` — `kunai open <url>` / `--open <url>`.
- **Modify** `apps/cli/src/services/presence/discord-activity-links.ts` — derive links from `PlaybackTargetRef`.
- **Delete** `apps/cli/src/app/playback-intent.ts`, `apps/cli/src/app/playback-iteration-state.ts`, `apps/cli/test/unit/app/playback-intent.test.ts` (+ any iteration-state test).
- **Tests** mirror under `apps/cli/test/unit/domain/share/` and `apps/cli/test/unit/app/`.

---

## Phase A — Pure model + `kunai://` codec

**Files:**

- Create: `apps/cli/src/domain/share/playback-target-ref.ts`
- Test: `apps/cli/test/unit/domain/share/playback-target-ref.test.ts`

### Task A1: Model + timestamp helpers (TDD)

- [ ] **Step 1: Write failing tests**

```ts
// apps/cli/test/unit/domain/share/playback-target-ref.test.ts
import { describe, expect, it } from "bun:test";
import { parseTimestampToSeconds, formatSecondsForUrl } from "@/domain/share/playback-target-ref";

describe("timestamp parsing", () => {
  it("parses raw seconds", () => expect(parseTimestampToSeconds("83")).toBe(83));
  it("parses 1m23s", () => expect(parseTimestampToSeconds("1m23s")).toBe(83));
  it("parses 1:23", () => expect(parseTimestampToSeconds("1:23")).toBe(83));
  it("parses 1:02:03", () => expect(parseTimestampToSeconds("1:02:03")).toBe(3723));
  it("rejects junk", () => expect(parseTimestampToSeconds("abc")).toBeNull());
  it("rejects negative", () => expect(parseTimestampToSeconds("-5")).toBeNull());
  it("formats seconds plainly", () => expect(formatSecondsForUrl(83)).toBe("83"));
});
```

- [ ] **Step 2: Run, expect FAIL** — `bun run test apps/cli/test/unit/domain/share/playback-target-ref.test.ts` → "Cannot find module".

- [ ] **Step 3: Implement model + helpers**

```ts
// apps/cli/src/domain/share/playback-target-ref.ts
export type CatalogNs = "tmdb" | "anilist" | "mal" | "imdb";

export type ShareAnchor =
  | { readonly by: "catalog"; readonly ns: CatalogNs; readonly id: string }
  | { readonly by: "search"; readonly query: string };

export type PlaybackTargetRef = {
  readonly anchor: ShareAnchor;
  readonly kind: "movie" | "series" | "anime";
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly startSeconds?: number;
  readonly title?: string;
  readonly hint?: { readonly providerId: string; readonly quality?: string };
};

const CATALOG_NS: ReadonlySet<string> = new Set(["tmdb", "anilist", "mal", "imdb"]);

export function parseTimestampToSeconds(raw: string | null | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(value);
  if (clock) {
    const h = clock[1] ? Number.parseInt(clock[1], 10) : 0;
    const m = Number.parseInt(clock[2], 10);
    const s = Number.parseInt(clock[3], 10);
    if (m > 59 || s > 59) return null;
    return h * 3600 + m * 60 + s;
  }
  const human = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (human && (human[1] || human[2] || human[3])) {
    const h = human[1] ? Number.parseInt(human[1], 10) : 0;
    const m = human[2] ? Number.parseInt(human[2], 10) : 0;
    const s = human[3] ? Number.parseInt(human[3], 10) : 0;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

export function formatSecondsForUrl(seconds: number): string {
  return String(Math.max(0, Math.round(seconds)));
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(share): PlaybackTargetRef model + timestamp helpers"`

### Task A2: `encodePlaybackTargetRef` + `parsePlaybackTargetRef` (TDD)

- [ ] **Step 1: Add failing round-trip + legacy + back-compat tests**

```ts
import {
  encodePlaybackTargetRef,
  parsePlaybackTargetRef,
  type PlaybackTargetRef,
} from "@/domain/share/playback-target-ref";

const ANIME: PlaybackTargetRef = {
  anchor: { by: "catalog", ns: "anilist", id: "21" },
  kind: "anime",
  absoluteEpisode: 1075,
  startSeconds: 83,
  hint: { providerId: "allanime" },
};

describe("ref codec", () => {
  it("round-trips an anime ref with timestamp + hint", () => {
    const url = encodePlaybackTargetRef(ANIME);
    expect(url).toBe("kunai://play?cat=anilist:21&kind=anime&abs=1075&t=83&src=allanime");
    expect(parsePlaybackTargetRef(url)).toEqual(ANIME);
  });
  it("round-trips series season/episode", () => {
    const ref: PlaybackTargetRef = {
      anchor: { by: "catalog", ns: "tmdb", id: "1399" },
      kind: "series",
      season: 2,
      episode: 5,
    };
    expect(parsePlaybackTargetRef(encodePlaybackTargetRef(ref))).toEqual(ref);
  });
  it("accepts human timestamp on input, normalizes on parse", () => {
    const ref = parsePlaybackTargetRef("kunai://play?cat=tmdb:1399&kind=series&s=2&e=5&t=1m23s");
    expect(ref?.startSeconds).toBe(83);
  });
  it("reads legacy back-compat params id/type", () => {
    const ref = parsePlaybackTargetRef("kunai://play?id=1399&type=series");
    expect(ref).toEqual({ anchor: { by: "catalog", ns: "tmdb", id: "1399" }, kind: "series" });
  });
  it("reads legacy anime search+mode", () => {
    const ref = parsePlaybackTargetRef("kunai://play?search=naruto&mode=anime");
    expect(ref).toEqual({ anchor: { by: "search", query: "naruto" }, kind: "anime" });
  });
  it("decodes a legacy kunai1: code", () => {
    const code =
      "kunai1:" +
      Buffer.from(
        JSON.stringify({ id: "tmdb:1399", type: "series", name: "GoT", season: 1, episode: 2 }),
      ).toString("base64url");
    const ref = parsePlaybackTargetRef(code);
    expect(ref?.anchor).toEqual({ by: "catalog", ns: "tmdb", id: "1399" });
    expect(ref?.season).toBe(1);
    expect(ref?.episode).toBe(2);
  });
  it("returns null for non-kunai input", () => {
    expect(parsePlaybackTargetRef("https://example.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement codec** (append to `playback-target-ref.ts`). Emit order is fixed (`cat`,`kind`,`s`,`e`,`abs`,`t`,`src`,`q`) so round-trip strings are stable. Parser reads new params first, then legacy `id`/`type`/`search`/`mode`, then delegates `kunai1:` to `decodeShareCode`.

```ts
import { decodeShareCode } from "@/domain/share/share-code";

export function encodePlaybackTargetRef(ref: PlaybackTargetRef): string {
  const params = new URLSearchParams();
  if (ref.anchor.by === "catalog") params.set("cat", `${ref.anchor.ns}:${ref.anchor.id}`);
  else params.set("q", ref.anchor.query);
  params.set("kind", ref.kind);
  if (typeof ref.season === "number") params.set("s", String(ref.season));
  if (typeof ref.episode === "number") params.set("e", String(ref.episode));
  if (typeof ref.absoluteEpisode === "number") params.set("abs", String(ref.absoluteEpisode));
  if (typeof ref.startSeconds === "number") params.set("t", formatSecondsForUrl(ref.startSeconds));
  if (ref.hint?.providerId) params.set("src", ref.hint.providerId);
  if (ref.hint?.quality) params.set("sq", ref.hint.quality);
  if (ref.title) params.set("n", ref.title);
  // Stable key order independent of URLSearchParams insertion quirks.
  const order = ["cat", "q", "kind", "s", "e", "abs", "t", "src", "sq", "n"];
  const ordered = order
    .filter((k) => params.has(k))
    .map((k) => `${k}=${encodeURIComponent(params.get(k) as string)}`)
    .join("&");
  return `kunai://play?${ordered}`;
}

export function parsePlaybackTargetRef(raw: string): PlaybackTargetRef | null {
  const value = raw.trim();
  if (value.startsWith("kunai1:")) return refFromLegacyCode(value);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "kunai:") return null;

  const anchor = readAnchor(url.searchParams);
  if (!anchor) return null;
  const kind = readKind(url.searchParams, anchor);

  const season = readInt(url.searchParams.get("s"));
  const episode = readInt(url.searchParams.get("e"));
  const absoluteEpisode = readInt(url.searchParams.get("abs"));
  const startSeconds = parseTimestampToSeconds(url.searchParams.get("t"));
  const src = url.searchParams.get("src")?.trim();
  const quality = url.searchParams.get("sq")?.trim();
  const title = url.searchParams.get("n")?.trim();

  return {
    anchor,
    kind,
    ...(season !== null ? { season } : {}),
    ...(episode !== null ? { episode } : {}),
    ...(absoluteEpisode !== null ? { absoluteEpisode } : {}),
    ...(startSeconds !== null ? { startSeconds } : {}),
    ...(src ? { hint: { providerId: src, ...(quality ? { quality } : {}) } } : {}),
    ...(title ? { title } : {}),
  };
}

function readAnchor(p: URLSearchParams): ShareAnchor | null {
  const cat = p.get("cat")?.trim();
  if (cat) {
    const [ns, ...rest] = cat.split(":");
    const id = rest.join(":").trim();
    if (CATALOG_NS.has(ns) && id) return { by: "catalog", ns: ns as CatalogNs, id };
    return null;
  }
  const q = (p.get("q") ?? p.get("search"))?.trim();
  if (q) return { by: "search", query: q.slice(0, 200) };
  // Legacy id/type → tmdb catalog anchor.
  const id = p.get("id")?.trim();
  if (id) return { by: "catalog", ns: "tmdb", id };
  return null;
}

function readKind(p: URLSearchParams, anchor: ShareAnchor): PlaybackTargetRef["kind"] {
  const explicit = p.get("kind")?.trim();
  if (explicit === "movie" || explicit === "series" || explicit === "anime") return explicit;
  if (p.get("mode") === "anime") return "anime";
  const legacyType = p.get("type")?.trim();
  if (legacyType === "movie") return "movie";
  if (anchor.by === "catalog" && anchor.ns === "anilist") return "anime";
  return "series";
}

function readInt(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function refFromLegacyCode(value: string): PlaybackTargetRef | null {
  const payload = decodeShareCode(value);
  if (!payload) return null;
  const tmdb = /^tmdb:(\d+)$/.exec(payload.id.trim());
  const anilist = /^anilist:(\d+)$/.exec(payload.id.trim());
  const anchor: ShareAnchor = tmdb
    ? { by: "catalog", ns: "tmdb", id: tmdb[1] }
    : anilist
      ? { by: "catalog", ns: "anilist", id: anilist[1] }
      : { by: "search", query: payload.name };
  const kind = anilist ? "anime" : payload.type;
  return {
    anchor,
    kind,
    ...(typeof payload.season === "number" ? { season: payload.season } : {}),
    ...(typeof payload.episode === "number" ? { episode: payload.episode } : {}),
    ...(payload.name ? { title: payload.name } : {}),
  };
}
```

- [ ] **Step 4: Run, expect PASS.** Fix `bun run typecheck`.
- [ ] **Step 5: Commit** — `feat(share): kunai:// URL codec with legacy decode bridge`

---

## Phase G — Remove Phase 4 scaffolding (end cleanup, after the feature lands)

> Deferred from "parallel-from-start" to here by decision: the modules are dead/unwired and fully git-recoverable, so removal is risk-free, and deferring lets us delete with the finished feature in view. Note: `PlaybackTargetRef` supersedes `PlaybackIterationState`'s "what to play" role; `PlaybackIntentBus` is a separate (input-mailbox) concern that this feature does not replace — it is removed simply because it is unused.

**Files:**

- Delete: `apps/cli/src/app/playback-intent.ts`, `apps/cli/src/app/playback-iteration-state.ts`, `apps/cli/test/unit/app/playback-intent.test.ts`
- Verify: no other importers

- [ ] **Step 1:** `rg -n "playback-intent|PlaybackIntentBus|playback-iteration-state|PlaybackIterationState|createPlaybackIterationState" apps packages` → expect only the files above + their tests. (Use Grep tool.)
- [ ] **Step 2:** Delete the three files (and an iteration-state test if one exists).
- [ ] **Step 3:** `bun run typecheck && bun run test` → expect PASS (nothing referenced them).
- [ ] **Step 4: Commit** — `chore(playback): remove unwired PlaybackIntentBus/IterationState scaffolding`

---

## Phase B — `resolveShareTarget` resolver

**Files:**

- Create: `apps/cli/src/app/resolve-share-target.ts`
- Test: `apps/cli/test/unit/app/resolve-share-target.test.ts`

The resolver turns a ref into a launch shape compatible with the existing `history-entry` `ShellWorkflowResult` (`title`, `episode?`) plus `startSeconds?` and a human `note?`. Reuse `mapAnimeDiscoveryResultToProviderNative` for anime catalog anchors; use `providerRegistry`/`config` for hint validation via `isVideasyFamilyProvider`/`resolveProviderIdAlias` from `@kunai/core`.

### Task B1: catalog/movie/series resolution (TDD)

- [ ] **Step 1: Write failing tests** using `createContainerFixture()` (`apps/cli/test/support/container-fixture.ts`).

```ts
// apps/cli/test/unit/app/resolve-share-target.test.ts
import { describe, expect, it } from "bun:test";
import { resolveShareTarget } from "@/app/resolve-share-target";
import { createContainerFixture } from "@test/support/container-fixture";

describe("resolveShareTarget", () => {
  it("maps a tmdb series catalog anchor to a TitleInfo with externalIds", async () => {
    const container = createContainerFixture();
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "tmdb", id: "1399" },
        kind: "series",
        season: 2,
        episode: 5,
        startSeconds: 90,
      },
      container,
    );
    expect(out.title.id).toBe("tmdb:1399");
    expect(out.title.type).toBe("series");
    expect(out.title.externalIds?.tmdbId).toBe("1399");
    expect(out.episode).toEqual({ season: 2, episode: 5 });
    expect(out.startSeconds).toBe(90);
  });

  it("falls back to search anchor with auto-pick", async () => {
    const container = createContainerFixture();
    const out = await resolveShareTarget(
      { anchor: { by: "search", query: "naruto" }, kind: "anime" },
      container,
    );
    expect(out.searchQuery).toBe("naruto");
    expect(out.autoPickIndex).toBe(1);
    expect(out.mode).toBe("anime");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `resolveShareTarget`. Build `TitleInfo` from the anchor (`tmdb:`/`anilist:`/`mal:`/`imdb:` id form + `externalIds`); for `kind: "anime"` set `mode: "anime"`; map `episode`/`absoluteEpisode` to `EpisodeInfo` (absolute → `{ season: 1, episode: absoluteEpisode }` when no season). For `search` anchor, return `searchQuery` + `autoPickIndex: 1`. Validate `hint.providerId` against `providerRegistry` (normalize via `resolveProviderIdAlias`); if unusable, drop it and set `note`.

```ts
// apps/cli/src/app/resolve-share-target.ts
import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { PlaybackTargetRef } from "@/domain/share/playback-target-ref";
import { resolveProviderIdAlias } from "@kunai/core";

export type ResolvedShareTarget = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly startSeconds?: number;
  readonly mode: ShellMode;
  readonly searchQuery?: string;
  readonly autoPickIndex?: number;
  readonly note?: string;
};

export async function resolveShareTarget(
  ref: PlaybackTargetRef,
  container: Container,
): Promise<ResolvedShareTarget> {
  const mode: ShellMode = ref.kind === "anime" ? "anime" : "series";
  if (ref.anchor.by === "search") {
    return {
      title: {
        id: `search:${ref.anchor.query}`,
        type: ref.kind === "movie" ? "movie" : "series",
        name: ref.anchor.query,
      },
      mode,
      searchQuery: ref.anchor.query,
      autoPickIndex: 1,
      ...(ref.startSeconds !== undefined ? { startSeconds: ref.startSeconds } : {}),
    };
  }
  const title = buildTitleFromAnchor(ref);
  const episode = buildEpisode(ref);
  const note = validateHint(ref, container);
  return {
    title,
    mode,
    ...(episode ? { episode } : {}),
    ...(ref.startSeconds !== undefined ? { startSeconds: ref.startSeconds } : {}),
    ...(note ? { note } : {}),
  };
}

function buildTitleFromAnchor(ref: PlaybackTargetRef): TitleInfo {
  const a = ref.anchor as Extract<PlaybackTargetRef["anchor"], { by: "catalog" }>;
  const id = `${a.ns}:${a.id}`;
  const externalIds =
    a.ns === "tmdb"
      ? { tmdbId: a.id }
      : a.ns === "anilist"
        ? { anilistId: a.id }
        : a.ns === "mal"
          ? { malId: a.id }
          : { imdbId: a.id };
  return {
    id,
    type: ref.kind === "movie" ? "movie" : "series",
    name: ref.title ?? id,
    externalIds,
    ...(ref.kind === "anime" ? { isAnime: true as const } : {}),
  };
}

function buildEpisode(ref: PlaybackTargetRef): EpisodeInfo | null {
  if (typeof ref.season === "number" && typeof ref.episode === "number") {
    return { season: ref.season, episode: ref.episode };
  }
  if (typeof ref.absoluteEpisode === "number") {
    return { season: 1, episode: ref.absoluteEpisode };
  }
  if (typeof ref.episode === "number") return { season: 1, episode: ref.episode };
  return null;
}

function validateHint(ref: PlaybackTargetRef, container: Container): string | undefined {
  if (!ref.hint?.providerId) return undefined;
  const normalized = resolveProviderIdAlias(ref.hint.providerId);
  const provider = container.providerRegistry.get(normalized);
  if (!provider)
    return `Shared source "${ref.hint.providerId}" isn't available here — using your default provider.`;
  return undefined;
}
```

> NOTE for implementer: confirm exact `TitleInfo`/`EpisodeInfo`/`ProviderExternalIds` field names against `apps/cli/src/domain/types.ts` and `@kunai/types` (e.g. `malId` may be `malId`/`myAnimeListId`). Adjust the `externalIds` map accordingly; the test asserts `tmdbId`.

- [ ] **Step 4: Run, expect PASS.** `bun run typecheck`.
- [ ] **Step 5: Commit** — `feat(share): resolveShareTarget catalog/search/anime resolver`

### Task B2: anime catalog → provider-native mapping

- [ ] **Step 1:** Add a test asserting that for `kind: "anime"` + AniList anchor, when the active provider is an AllAnime-family provider, the resolver attaches provider-native id via `mapAnimeDiscoveryResultToProviderNative` (stub `searchProviderNative` through the fixture).
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** In the anime branch, after `buildTitleFromAnchor`, call the existing mapping helper to enrich identity for the recipient's provider; keep it best-effort (catch + fall back to AniList anchor; record `note`).
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit** — `feat(share): anime cross-provider mapping in resolver`

---

## Phase C — One-shot bootstrap start-position (shared timestamp)

**Files:**

- Modify: `apps/cli/src/app-shell/command-router.ts` (and `app-shell/types.ts` if the result type lives there), `apps/cli/src/app/post-playback-routing.ts`, `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Test: `apps/cli/test/unit/app/playback-start-position.test.ts`

Goal: a shared timestamp reaches the **first** mpv launch as `--start`, winning over history for that first play only, then normal history resume takes over.

### Task C1: thread `startSeconds` through `history-entry`

- [ ] **Step 1:** Locate the `history-entry` union member (`command-router.ts` `RoutedActionResult` ~L90 and the `ShellWorkflowResult` mirror). Add `readonly startSeconds?: number`.
- [ ] **Step 2:** Update producers that already build `history-entry` (no behavior change — field omitted) so types compile.
- [ ] **Step 3:** `bun run typecheck` → PASS.
- [ ] **Step 4: Commit** — `feat(share): carry optional startSeconds on history-entry result`

### Task C2: apply one-shot start in PlaybackPhase (TDD)

- [ ] **Step 1: Write failing test** for a small pure helper `resolveBootstrapStartSeconds({ sharedStartSeconds, historyResumeSeconds })` that returns `max(shared ?? 0, history ?? 0)` and `undefined` when both absent.

```ts
// apps/cli/test/unit/app/playback-start-position.test.ts
import { describe, expect, it } from "bun:test";
import { resolveBootstrapStartSeconds } from "@/app/playback-resume-from-history";

describe("resolveBootstrapStartSeconds", () => {
  it("prefers the larger of shared vs history", () => {
    expect(resolveBootstrapStartSeconds({ sharedStartSeconds: 90, historyResumeSeconds: 30 })).toBe(
      90,
    );
    expect(
      resolveBootstrapStartSeconds({ sharedStartSeconds: 10, historyResumeSeconds: 120 }),
    ).toBe(120);
  });
  it("returns shared when no history", () => {
    expect(resolveBootstrapStartSeconds({ sharedStartSeconds: 45 })).toBe(45);
  });
  it("returns undefined when neither present", () => {
    expect(resolveBootstrapStartSeconds({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `resolveBootstrapStartSeconds` in `apps/cli/src/app/playback-resume-from-history.ts` (co-located with `resumeSecondsFromHistoryForEpisode`).

```ts
export function resolveBootstrapStartSeconds(input: {
  readonly sharedStartSeconds?: number;
  readonly historyResumeSeconds?: number;
}): number | undefined {
  const shared = input.sharedStartSeconds ?? 0;
  const history = input.historyResumeSeconds ?? 0;
  const best = Math.max(shared, history);
  return best > 0 ? best : undefined;
}
```

- [ ] **Step 4:** In `PlaybackPhase.ts`, where the **first** `pendingStart` is computed for the bootstrap episode (series resume block ~L711+, and the movie path), read the inbound `startSeconds` (passed from the launch target via `stateManager`/bootstrap), combine via `resolveBootstrapStartSeconds`, and feed it into the existing `startEpisodeNavigation({ targetResumeSeconds })` for the first episode only. After first launch, clear it so auto-advance/history behave normally. Gate the actual seek with the existing `shouldApplyStartAtSeek`.
- [ ] **Step 5: Run** `bun run test apps/cli/test/unit/app/playback-start-position.test.ts` → PASS; `bun run typecheck`.
- [ ] **Step 6: Commit** — `feat(share): apply shared timestamp as one-shot bootstrap start`

> Integration-risk note: confirm how the bootstrap title/episode crosses into `PlaybackPhase` (via `SessionController`/`stateManager`). The transient `startSeconds` must be consumed exactly once for the first episode; do not persist it. If there is no existing transient channel, add a single nullable field on the bootstrap target and null it after first use.

---

## Phase D — Surface wiring

**Files:**

- Modify: `apps/cli/src/app-shell/workflows.ts` (`handleShare`, `handleWatch`)
- Modify: `apps/cli/src/app/handoff-url.ts`, `apps/cli/src/main.ts`, `apps/cli/src/services/media-actions/MediaActionRouter.ts`
- Modify: `apps/cli/src/cli-args.ts`
- Modify: `apps/cli/src/app/post-playback-routing.ts` (post-play copy), history copy action
- Tests: update `handoff-url.test.ts`, `main-args.test.ts`, `share-code.test.ts`; add workflow tests

### Task D1: `/share` emits canonical URL (with/without timestamp)

- [ ] **Step 1:** Add a workflow test: `handleShare` builds a `PlaybackTargetRef` from `state.currentTitle`/`currentEpisode` (catalog-anchored via `externalIds`, anime-aware), encodes with `encodePlaybackTargetRef`, copies to clipboard, and offers a timestamp variant when a last-known position exists.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Rewrite `handleShare` to build the ref (prefer `externalIds.tmdbId`/`anilistId`/`malId`/`imdbId`; fall back to `search` anchor from `title.name` when no catalog id). Offer two clipboard options when a position is known: "Copy link" and "Copy link at HH:MM:SS". Use `encodePlaybackTargetRef`. Keep the manual-copy fallback note.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit** — `feat(share): /share emits catalog-anchored kunai:// link with optional timestamp`

### Task D2: `/watch` parses URL + legacy, threads timestamp

- [ ] **Step 1:** Test: `handleWatch` with a `kunai://...&t=83` on the clipboard resolves via `resolveShareTarget` and returns a `history-entry` with `startSeconds: 83`; with a legacy `kunai1:` code it still resolves.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Rewrite `handleWatch`: `parsePlaybackTargetRef(clip)` → `resolveShareTarget(ref, container)` → return `{ type: "history-entry", title, episode, startSeconds, ...(searchQuery for search anchor) }`; surface `note` via `SET_PLAYBACK_FEEDBACK`. Update the empty-clipboard message to mention links too.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit** — `feat(share): /watch resolves kunai:// links + legacy codes with timestamp`

### Task D3: handoff-url on top of the codec

- [ ] **Step 1:** Update `handoff-url.test.ts` to expect `KunaiHandoffLaunch = { action; ref: PlaybackTargetRef; requiresConfirmation: true }` and that `parseKunaiHandoffUrl("kunai://play?cat=tmdb:1399&kind=series&e=3")` yields the episode-level ref. Keep a legacy `kunai://play?id=1399&type=series` test.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Re-express `parseKunaiHandoffUrl`: resolve `action` (existing host/path logic), then `parsePlaybackTargetRef(value)`; return `{ action, ref, requiresConfirmation: true }` or `null`. `buildKunaiPlaybackHandoffUrl` delegates to `encodePlaybackTargetRef`. Update `describeKunaiHandoffLaunch` to read from `ref`.
- [ ] **Step 4:** Update consumers: `main.ts` `mergeHandoffIntoArgs` (build args from `ref`: catalog → `id/type`/anime, search → `search`+anime, plus `jump` from episode) and `MediaActionRouter` handoff execution. Run `bun run typecheck`.
- [ ] **Step 5:** Run full `bun run test`, expect PASS (fix `main-args.test.ts`).
- [ ] **Step 6: Commit** — `refactor(share): unify kunai:// handoff on PlaybackTargetRef codec`

### Task D4: `kunai open <url>` CLI entry

- [ ] **Step 1:** `main-args.test.ts`: `--open "kunai://play?cat=tmdb:1399&kind=series&e=3&t=83"` populates a new `CliArgs.openUrl` and bypasses protocol confirmation (user-trusted), feeding the same resolver path as `/watch`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Add `--open <url>` to `cli-args.ts` (`KNOWN_FLAGS`, `VALUE_FLAGS`, commander option, `CliArgs.openUrl`, help text under PATHS & INTEGRATION). In `main.ts`, when `args.openUrl` is set, `parsePlaybackTargetRef` → `resolveShareTarget` → bootstrap launch (with `startSeconds`), skipping the extra handoff confirmation. Invalid → clear error + non-zero exit.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit** — `feat(cli): kunai open <kunai:// link> launches resolved target`

### Task D5: post-play + history "copy share link"

- [ ] **Step 1:** Test: post-play routing exposes a "Copy share link" action that builds the ref from the just-finished title/episode (+ last position) and copies it; history list exposes the same for a selected entry (uses `externalIds` + last `positionSeconds`).
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Add the action in `post-playback-routing.ts` and the history workflow, reusing the same ref-builder helper extracted from `handleShare` (DRY — extract `buildShareRefFromState(...)` into `domain/share` or a small `app/share-ref-from-context.ts`).
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit** — `feat(share): copy share link from post-play and history`

---

## Phase E — Discord derived from `PlaybackTargetRef`

**Files:**

- Modify: `apps/cli/src/services/presence/discord-activity-links.ts`
- Test: `apps/cli/test/unit/services/presence/discord-activity-links.test.ts`

- [ ] **Step 1:** Test: given a `PresencePlaybackActivity`, the buttons/url-fields are derived from a single `buildShareRefForActivity(activity)` so the https catalog link is always episode-accurate; the playable `kunai://` ref appears in a presence text field (not a button), and is omitted under `privacy: "private"`.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Introduce `buildShareRefForActivity(activity): PlaybackTargetRef`, derive the existing https catalog link from it (keep `buildBestCatalogLink` behavior), and add the encoded `kunai://` ref to `buildDiscordActivityUrlFields` as a non-button field. No new Discord buttons (http(s)-only constraint honored).
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5: Commit** — `feat(presence): derive Discord links from PlaybackTargetRef`

---

## Phase F — (Optional, last) in-mpv "copy share link at current time"

**Files:**

- Modify: mpv keybinding source (`apps/cli/src/mpv.ts` args / bundled `input.conf`), `apps/cli/src/infra/player/PersistentMpvSession.ts` (IPC `script-message` observe), a handler that builds the ref with the live position and copies it.

- [ ] **Step 1:** Decide the gesture (e.g. mpv `script-message kunai-copy-share`) and add the keybinding.
- [ ] **Step 2:** Observe the message over existing mpv IPC; on receipt, read live `time-pos`, build the ref via the shared `buildShareRefFromState` helper with `startSeconds = round(time-pos)`, copy to clipboard, and toast via `SET_PLAYBACK_FEEDBACK`.
- [ ] **Step 3:** Test the message→ref mapping with a stubbed IPC + clipboard; assert the encoded URL carries `t=`.
- [ ] **Step 4:** Run, expect PASS; manual smoke with `bun run dev`.
- [ ] **Step 5: Commit** — `feat(share): mpv hotkey copies share link at current position`

> If effort/time is constrained, ship Phases A–E + G + H and leave F as a tracked follow-up; the paused/post-play copy (D5) already covers timestamp sharing.

---

## Phase H — Docs + plan-truth + test-debt sweep

**Files:**

- Create: `.docs/share-links.md` (model, URL grammar, surfaces, back-compat, Discord constraint)
- Modify: `CLAUDE.md` + `AGENTS.md` "Read This First" pointer to `.docs/share-links.md`; Fast Map entry for `domain/share` + `resolve-share-target.ts`
- Modify: `.docs/presence-integrations.md` (Discord links now derived from ref), `.docs/experience-overview.md` (share/open capability), `.plans/plan-implementation-truth.md` (record this landing + Phase 4 scaffolding removal), `.plans/architecture-review.md` (note Phase 4 candidate resolved)
- Modify: `.plans/share-links-and-playback-target-ref.md` status board → mark phases done

- [ ] **Step 1:** Write `.docs/share-links.md` with the URL grammar table (`cat`,`kind`,`s`,`e`,`abs`,`t`,`src`,`sq`,`n` + legacy `id`/`type`/`search`/`mode`), examples, and the Discord http(s) note.
- [ ] **Step 2:** Update the doc pointers + Fast Map in `CLAUDE.md`/`AGENTS.md`.
- [ ] **Step 3:** Update `plan-implementation-truth.md` and `architecture-review.md` decision/candidate rows.
- [ ] **Step 4:** Run `bun run typecheck && bun run lint && bun run fmt && bun run test` → all PASS. Then `bun run build`.
- [ ] **Step 5: Commit** — `docs(share): document share links model, surfaces, and back-compat`

---

## Self-review (run before declaring done)

1. **Spec coverage:** every resolved-decision row maps to a phase — encodings→A/D3, anchor→A/B, granularity+timestamp→A/C, hint→B, Discord→E, hotkey→F, Phase 4 removal→G. ✅
2. **Type consistency:** `PlaybackTargetRef`/`ShareAnchor`/`CatalogNs` defined in A and reused verbatim in B/C/D/E. `resolveShareTarget` returns `ResolvedShareTarget` consumed by D2/D4. `history-entry` gains `startSeconds` in C1 and is produced in D2/D5. `encodePlaybackTargetRef`/`parsePlaybackTargetRef` names stable across A/D/E.
3. **Open verifications for implementer (do not skip):** (a) exact `TitleInfo`/`EpisodeInfo`/`ProviderExternalIds` field names in `domain/types.ts`/`@kunai/types`; (b) exact transient channel into `PlaybackPhase` for one-shot `startSeconds`; (c) `@kunai/core` exports `resolveProviderIdAlias`/`isVideasyFamilyProvider`; (d) `createContainerFixture` exposes `providerRegistry`/`config` used in B tests.

---

## Execution handoff

Two execution options:

1. **Subagent-Driven (recommended):** orchestrator dispatches a fresh subagent per task with two-stage review between tasks. Suggested parallelism: gate **B/C on A**; **D on A+B+C**; **E** after D's shared types; then **F (optional) → G (removal) → H (docs + batched surface tests)** last.
2. **Inline Execution:** work phases A→B→C→D→E→(F)→G→H in this session with a checkpoint after each phase.
