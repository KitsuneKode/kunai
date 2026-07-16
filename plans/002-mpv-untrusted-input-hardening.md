# Plan 002: Harden the untrusted-provider → mpv argv/IPC boundary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/mpv.ts apps/cli/src/infra/player/PersistentMpvSession.ts`
> If either file changed, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Kunai resolves stream URLs, subtitle URLs, and HTTP header values from third-party scraper output — untrusted input. These flow into mpv's argv and IPC `sub-add` commands **without a `--` option terminator and without scheme validation**. A hostile or compromised provider that returns a "URL" starting with `-`/`--` gets mpv to parse it as CLI options (`--script=…`, `--sub-file=…`, config overrides) — an option-injection primitive that can reach local file read or mpv-Lua execution. Subtitle "tracks" with `file://`/local paths similarly make mpv open arbitrary local files. Adding a `--` terminator and an `http/https/file` scheme allowlist (file only for the local download/offline surface) closes this cheaply without changing legitimate playback.

## Current state

- `apps/cli/src/mpv.ts` — mpv launch + argv builder + IPC subtitle attach.
- `apps/cli/src/infra/player/PersistentMpvSession.ts:508` — reuses `buildMpvArgs`.

`buildMpvArgs` at `mpv.ts:408-446`:

```ts
export function buildMpvArgs(
  opts: { url: string; headers: Record<string, string> /* … */ },
  ipcPath: string | null,
  config?: {
    /* … */
  },
): string[] {
  const args: string[] = [opts.url]; // <-- provider URL is argv[0], no `--` before it
  if (isYoutubeWatchUrl(opts.url) || opts.requiresYtdl) {
    args.push(`--ytdl-format=${opts.ytdlFormat ?? "bv*+ba/b"}`);
    // …
  } else if (opts.url.toLowerCase().includes(".m3u8")) {
    args.push("--ytdl=no");
  }
  const { referer, userAgent, origin } = normalizeStreamHttpHeaders(opts.headers);
  if (referer) args.push(`--referrer=${referer}`);
  if (userAgent) args.push(`--user-agent=${userAgent}`);
  if (origin) args.push(`--http-header-fields=Origin: ${origin}`); // comma in origin injects extra header fields
  // …subtitle/lang args pushed after…
}
```

IPC subtitle attach at `mpv.ts:629-651` (inside `attachLateSubtitles`):

```ts
const result = await ipcSession.send([
  "sub-add",
  attachment.primarySubtitle,
  "select",
  primary.title,
  primary.language,
]);
// …and per additional track:
const result = await ipcSession.send([
  "sub-add",
  track.url,
  "auto",
  track.display ?? "",
  track.language ?? "",
]);
```

Launch-time subtitle files go through `--sub-file=` at `mpv.ts:449` and `collectLaunchSubtitleFiles` (~`:568-580`).

Note: mpv places positional media _after_ options, so the `--` terminator must be inserted immediately **before** `opts.url` while keeping option flags after it. mpv accepts `mpv <options> -- <file>`; since here the URL is currently first, the fix is to build options first and append `"--"` then the URL last, **or** keep the URL first but guarantee it can never be read as an option by validating scheme and rejecting a leading `-`. Prefer the scheme-validation + leading-dash rejection approach because reordering argv risks the `isYoutubeWatchUrl`/`.m3u8` branches that inspect `opts.url`.

Repo conventions: small pure helpers with exported names for testing (see `shouldAbortLaunchForDefinitivePreflight` at `mpv.ts:401`); conventional commits (`fix(...)` / `security(...)`).

## Commands you will need

| Purpose   | Command                                   | Expected on success |
| --------- | ----------------------------------------- | ------------------- |
| Typecheck | `bun run typecheck`                       | exit 0              |
| Lint      | `bun run lint`                            | exit 0              |
| One file  | `cd apps/cli && bun run test:file <path>` | tests pass          |
| CLI tests | `bun run --cwd apps/cli test`             | all pass            |

## Scope

**In scope**:

- `apps/cli/src/mpv.ts`
- `apps/cli/test/unit/infra/player/mpv-args-safety.test.ts` (create; check the exact existing dir with `ls apps/cli/test/unit/infra/player/` and place beside the other mpv arg tests)

**Out of scope**:

- `PersistentMpvSession.ts` (it calls `buildMpvArgs`; fixing the builder fixes it — do not edit).
- Provider scrapers in `packages/providers/*` — do not try to sanitize at the source; the boundary guard belongs at the mpv seam.
- YouTube ytdl branch logic — keep as-is; only add validation.

## Git workflow

- Branch: `advisor/002-mpv-untrusted-input-hardening`
- Commit: `security(mpv): validate stream/subtitle URL schemes before spawn`

## Steps

### Step 1: Add a URL-scheme validation helper

Add an exported pure function to `mpv.ts`:

```ts
export type MpvUrlKind = "remote" | "local";

/** Returns true if `url` is a safe media/subtitle target for the given surface.
 *  Remote surfaces allow http/https only. Local (download/offline) additionally allows file:// and bare local paths. */
export function isAllowedMpvUrl(url: string, kind: MpvUrlKind): boolean {
  if (url.startsWith("-")) return false; // never allow an argv that mpv reads as an option
  const lower = url.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return true;
  if (kind === "local") {
    if (lower.startsWith("file://")) return true;
    if (!lower.includes("://")) return true; // bare local filesystem path
  }
  return false;
}
```

Determine how `buildMpvArgs` knows whether it's a local surface. Inspect the call sites (`grep -rn "buildMpvArgs" apps/cli/src`) and the `opts` shape — if there is no existing local/offline flag, add an optional `opts.allowLocalFile?: boolean` and have the offline/download launch path set it. If you cannot determine the surface, STOP and report.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Enforce validation in `buildMpvArgs`

At the top of `buildMpvArgs`, before constructing `args`, reject invalid URLs:

```ts
const urlKind: MpvUrlKind = opts.allowLocalFile ? "local" : "remote";
if (!isAllowedMpvUrl(opts.url, urlKind)) {
  throw new Error(`Refusing to launch mpv with unsafe stream URL scheme`);
}
```

Also insert a literal `"--"` guard: keep `opts.url` reachable to the YouTube/m3u8 branch checks, but ensure the final args array has `"--"` immediately before the URL positional. Simplest safe form that preserves the branch checks:

```ts
const args: string[] = [];
// …push all `--flag=` options first (ytdl, referrer, user-agent, header-fields, sub-file, alang, slang, script-opts)…
args.push("--", opts.url); // terminator guarantees the URL is treated as a media path
```

Move the option-pushing code above the URL push. Verify the YouTube/m3u8 detection still reads `opts.url` (it does — it reads the local variable, not the array).

**Verify**: the existing `buildMpvArgs` coverage still passes — `cd apps/cli && bun run test:file test/unit/infra/player/mpv-stream-http-headers.test.ts` (this is the file that exercises the arg builder; there is no file named `*arg*`).

### Step 3: Sanitize header values

In the header block, strip CR/LF/comma from `origin` (and referer/user-agent) before interpolation so a provider cannot inject extra header fields:

```ts
const safeOrigin = origin.replace(/[\r\n,]/g, "");
if (safeOrigin) args.push(`--http-header-fields=Origin: ${safeOrigin}`);
```

Apply the CR/LF strip to referer and user-agent too (comma is legal in those, so strip only `[\r\n]` there).

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Validate subtitle URLs before `sub-add` / `--sub-file`

In `attachLateSubtitles` (`mpv.ts:~620`), skip any subtitle whose URL fails `isAllowedMpvUrl(url, kind)` where `kind` matches the playback surface (remote for streamed subtitles; local only for the offline/download surface). Same guard for `collectLaunchSubtitleFiles` feeding `--sub-file=`. A rejected subtitle is simply not attached (log via the existing `dbg`/event mechanism, do not throw — a bad subtitle must not kill playback).

**Verify**: `bun run typecheck` → exit 0.

### Step 5: Tests

Create `apps/cli/test/unit/infra/player/mpv-args-safety.test.ts`:

- `isAllowedMpvUrl`: `http://`/`https://` remote → true; leading `-` → false; `file://` remote → false but local → true; bare path remote → false, local → true.
- `buildMpvArgs`: throws on a `--script=evil` URL; output array contains `"--"` immediately before the URL; a header origin containing `\r\nX: y` is stripped.
- Subtitle attach path skips a `file://` subtitle on a remote surface (assert not attached).

Model after existing `test/unit/infra/player/*arg*` or `mpv-session-lifecycle.test.ts`.

**Verify**: `cd apps/cli && bun run test:file test/unit/infra/player/mpv-args-safety.test.ts` → all pass.

### Step 6: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint` exit 0
- [ ] New test file exists and passes; `test/unit/infra/player/mpv-stream-http-headers.test.ts` still passes
- [ ] `grep -n '"--"' apps/cli/src/mpv.ts` shows the terminator is pushed before the URL
- [ ] `buildMpvArgs` throws on a leading-dash URL (covered by test)
- [ ] Subtitle attach rejects non-allowed schemes on remote surfaces
- [ ] No files outside scope modified; `plans/README.md` row updated

## STOP conditions

- You cannot determine from call sites whether a playback surface is local vs remote (needed for the `file://` allowance) — report what you found.
- Reordering args to put `"--"` before the URL breaks an existing mpv-arg test you cannot reconcile.
- `buildMpvArgs` turns out to be called for a legitimate non-http, non-file scheme (e.g. a custom protocol) — report it rather than blocking it.

## Maintenance notes

- Any new provider that returns a novel legitimate scheme must be added to `isAllowedMpvUrl`, not worked around at the call site.
- File-overlap note: plan 004 also edits `apps/cli/src/mpv.ts` (the IPC abort path, `:359-389` — a different region than this plan's arg builder/subtitle attach). Land 002 and 004 sequentially, not in parallel.
- Reviewer should confirm: local `file://` is allowed ONLY for the offline/download surface, never for streamed providers.
- Deferred: deeper mpv config hardening (`--no-config`, `--load-scripts=no`) is a separate, larger decision — not in this plan.
