# Plan 005: Make the test suite tell the truth (fail-closed fetch stubs, real assertions, no machine-speed sleeps)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat faf1afd22..HEAD -- apps/cli/test/unit/services/playback/hls-manifest-materializer.test.ts apps/cli/test/unit/app/post-playback-recommendations.test.ts apps/cli/test/integration/anime-discovery-resolve-handoff.test.ts apps/cli/test/unit/app-shell/download-confirmation-shell.test.tsx apps/cli/test/unit/tmdb.test.ts apps/cli/test/unit/services/update/BinaryAutoUpdater.test.ts apps/cli/test/unit/app-shell/sixel-overlay.test.ts apps/cli/src/tmdb.ts apps/cli/src/services/update/BinaryAutoUpdater.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `faf1afd22`, 2026-10-09

## Why this matters

Five test-quality defects make the suite claim guarantees it doesn't check:
(1) three fetch stubs answer their fixture host and otherwise delegate to the
**real network** — a refactor that fetches one more host silently converts a
hermetic test into a live-network test that can false-pass on someone else's
uptime; (2) a width-budget test iterates `lastFrame() ?? ""` so an empty
render passes "every line fits"; (3) the TMDB bounded-cache test loops and
asserts **nothing** (the cache is unobservable); (4) the auto-updater
"idempotent interval" test has **no assertions**; (5) the sixel-overlay suite
synchronizes with 18 fixed `await Bun.sleep(5)` calls over a `setTimeout(0)`
flush — machine-speed dependence the repo's own helper exists to prevent.
This plan fixes all five and adds a ratchet so raw numeric sleeps cannot
regrow.

## Current state

**Known baseline (do not "fix"):** full unit runs fail on exactly one test —
`design color resolution > downgrades accent for truecolor terminals` — and
`@kunai/docs#test` fails `docs design token drift`. Both are caused by the
maintainer's uncommitted WIP `packages/design/src/tokens.ts` re-theme. They
are not yours; plan every verification around them.

1. **Fetch fall-throughs** (fix to throw):

   - `apps/cli/test/unit/services/playback/hls-manifest-materializer.test.ts:76-86`
     — serves `light.goldweather.net`, else delegates:

```ts
      if (parsedUrl.hostname === "light.goldweather.net") {
        return new Response(manifest, { ... });
      }
      return originalFetch(input);
```

- `apps/cli/test/unit/app/post-playback-recommendations.test.ts:71-85` —
  serves `graphql.anilist.co`, else `return originalFetch(input);`
- `apps/cli/test/integration/anime-discovery-resolve-handoff.test.ts:51-56`:

```ts
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  if (url.includes("allanime.day")) allanimeRequests += 1;
  return originalFetch(input, init);
}) as typeof fetch;
```

**In-repo exemplar for the correct pattern** (same file, lines 178-190 —
note this file already contains the right discipline in another test):

```ts
if (url.includes("anidb.app/browse")) {
  return new Response('<a href="...">', { status: 200 });
}
throw new Error(`unexpected network call: ${url}`);
```

2. **Empty-frame width test** —
   `apps/cli/test/unit/app-shell/download-confirmation-shell.test.tsx:167-185`:

```ts
  test("every rendered line fits the confirmation width", () => {
    const handle = render(
      <DownloadConfirmationContent title={{ id: "tmdb:2", type: "series", name: "Severance" }} ... />,
      { columns: 100, rows: 40 },
    );
    try {
      for (const line of stripAnsi(handle.lastFrame() ?? "").split("\n")) {
        expect(line.length).toBeLessThanOrEqual(100);
      }
    } finally {
      handle.unmount();
    }
  });
```

`lastFrame() ?? ""` → `[""]` → the loop asserts on an empty string.
**Exemplar that orders content-first**: `apps/cli/test/unit/app-shell/error-shell.test.tsx:84-90`
— `expect(frame).toContain("Playback failed")` _before_ its width loop
(and it uses `renderedWidth`, the column-aware helper from
`apps/cli/test/support/rendered-width.ts`, not `line.length`).

3. **Zero-assert cache test** — `apps/cli/test/unit/tmdb.test.ts:126-143`:
   loops `fetchEpisodes` past `MAX_TMDB_CACHE_ENTRIES` and ends with no
   `expect`. The cache lives in `apps/cli/src/tmdb.ts:48-59`:

```ts
export const MAX_TMDB_CACHE_ENTRIES = 100;
const epCache = new Map<string, EpisodeInfo[]>();
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_TMDB_CACHE_ENTRIES): void {
  if (map.size >= max && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
```

**Exemplar for the observability seam** (house style, same app):
`apps/cli/src/app-shell/prepared-poster-cache.ts:76-80`:

```ts
export const __testing = {
  runtime,
  realPreparePoster: preparePoster,
  cacheSize: () => preparedCache.size,
  cacheBytes: () => preparedCache.byteLength,
};
```

4. **Zero-assert updater test** —
   `apps/cli/test/unit/services/update/BinaryAutoUpdater.test.ts:21-29` calls
   start/stop/stop/start/stop with no `expect` (neighbour at `:31-57` does
   assert). The state it claims to check:
   `apps/cli/src/services/update/BinaryAutoUpdater.ts:139-153`:

```ts
  startBackground(options: { readonly runImmediately?: boolean } = {}): void {
    if (options.runImmediately !== false) void this.runOnce().catch(() => {});
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => { ... }, BACKGROUND_INTERVAL_MS);
    this.intervalHandle.unref?.();
  }
  /** Stop future background update checks. Idempotent; used during shutdown. */
  stopBackground(): void {
    if (!this.intervalHandle) return;
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
```

5. **Fixed sleeps** — `apps/cli/test/unit/app-shell/sixel-overlay.test.ts` has
   18 `await Bun.sleep(5)` sites (lines 58, 60, 75, 77, 96, 98, 113, 116,
   133, 136, 156, 160, 178, 196, 198, 205, 212, 215). The production flush is
   `apps/cli/src/app-shell/sixel-overlay.ts:151-160`:

```ts
  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    setTimeout(() => {
      this.flushQueued = false;
      this.flush();
    }, 0);
  }
```

And `register()` (`:77-82`) is a synchronous no-op when
`sameOverlay(previous, overlay)` returns true. The sanctioned helper is
`apps/cli/test/support/wait-until.ts` — its doc comment names
_"a fixed sleep standing in for synchronisation"_ as the defect class.
Two semantics appear in the suite, needing two replacements (see Step 4).

6. **Sleep inventory (ratchet baseline)**: at `faf1afd22`, the regex
   `await Bun\.sleep\([0-9]+\)` over `apps/cli/test` excluding
   `test/(support|live|agent|templates)/` matches **58 sites in 19 files**
   (verified 2026-10-09; recompute at execution time — Step 5).

## Commands you will need

| Purpose                                    | Command                                                                        | Expected on success                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Single test file                           | `bun run --cwd apps/cli test:file <path-relative-to-apps/cli>`                 | passes                                                   |
| CLI unit suite                             | `bunx turbo run test:unit --filter=@kitsunekode/kunai --force`                 | only known WIP failure (`design color resolution > ...`) |
| Integration (for the anime-discovery file) | `bun run --cwd apps/cli test:integration` — or the single file via `test:file` | passes (see STOP-3 for network discoveries)              |
| Typecheck                                  | `bun run typecheck`                                                            | exit 0                                                   |
| Lint                                       | `bun run lint`                                                                 | exit 0 (17 pre-existing warnings = baseline)             |
| Format changed files                       | `bunx oxfmt --write <files you changed>`                                       | formatted                                                |

## Scope

**In scope** (the only files you should modify/create):

- `apps/cli/test/unit/services/playback/hls-manifest-materializer.test.ts`
- `apps/cli/test/unit/app/post-playback-recommendations.test.ts`
- `apps/cli/test/integration/anime-discovery-resolve-handoff.test.ts`
- `apps/cli/test/unit/app-shell/download-confirmation-shell.test.tsx`
- `apps/cli/test/unit/tmdb.test.ts`
- `apps/cli/src/tmdb.ts` (add `__testing` seam ONLY)
- `apps/cli/test/unit/services/update/BinaryAutoUpdater.test.ts`
- `apps/cli/src/services/update/BinaryAutoUpdater.ts` (add one getter ONLY)
- `apps/cli/test/unit/app-shell/sixel-overlay.test.ts`
- `apps/cli/test/unit/architecture/bare-sleep-ratchet.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):

- `packages/design/src/tokens.ts` and the two WIP failures it causes.
- The other 16 files with numeric sleeps — the ratchet (Step 5) freezes the
  debt; only `sixel-overlay.test.ts` gets converted here.
- `apps/cli/test/support/wait-until.ts` and `container-fixture.ts`
  (fixture divergence = a different audit item).
- `apps/cli/test/preload.ts`, `bunfig.toml`.
- pty-transcript / package-timeout items (other audit rows).

## Git workflow

- Branch: `advisor/005-test-truth-batch`
- Commit style: `fix(test): fail-closed fetch stubs, real assertions, deterministic sixel waits`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Close the three fetch fall-throughs

For `hls-manifest-materializer.test.ts` and `post-playback-recommendations.test.ts`:
replace `return originalFetch(input);` with
`throw new Error(\`unexpected network call: ${url}\`);`(keep the url variable
each file already computes;`post-playback`needs`const url = ...`extracted
before the`if` — it already computes it).

For `anime-discovery-resolve-handoff.test.ts:51-56`: replace
`return originalFetch(input, init);` with the same throw. Then **run that
file**. Two outcomes:

- Passes → done; the fall-through was dead weight.
- Fails with `unexpected network call: <url>` → those are URLs the test's
  flow actually fetches. If the URL is clearly fixture-shaped (the test
  already stubs a sibling host), add a stub branch with a canned Response
  **and a comment naming why this host is part of the contract**. If the URL
  is a live service host (AniList/TMDB/CDN) the test genuinely depends on —
  that is a bigger discovery than this plan: revert your change to this file,
  and see STOP condition 3.

**Verify**: `bun run --cwd apps/cli test:file test/unit/services/playback/hls-manifest-materializer.test.ts`
→ passes; same for `test/unit/app/post-playback-recommendations.test.ts`;
`bun run --cwd apps/cli test:file test/integration/anime-discovery-resolve-handoff.test.ts`
→ passes (or STOP-3).

### Step 2: Make the width test fail on an empty frame

In `download-confirmation-shell.test.tsx`, restructure the test to
content-first, following the `error-shell.test.tsx:84-90` ordering — and use
the column-aware helper `renderedWidth` from
`apps/cli/test/support/rendered-width.ts` (import it the way
`error-shell.test.tsx` does):

```ts
try {
  const frame = stripAnsi(handle.lastFrame() ?? "");
  expect(frame).toContain("Severance"); // content must exist before "it fits"
  const lines = frame.split("\n").filter((line) => line.length > 0);
  expect(lines.length).toBeGreaterThanOrEqual(3);
  for (const line of lines) {
    expect(renderedWidth(line)).toBeLessThanOrEqual(100);
  }
} finally {
  handle.unmount();
}
```

(Adjust `toContain`/line-count to what this panel actually renders — run once
and read `lastFrame()` if unsure; the invariants are: a content assertion, a
minimum line count, then the width loop.)

**Verify**: `bun run --cwd apps/cli test:file test/unit/app-shell/download-confirmation-shell.test.tsx`
→ passes; then temporarily comment the content assertion and confirm the test
STILL passes only if a frame is rendered — i.e. hand-check that rendering an
empty frame would now fail (revert your comment).

### Step 3: Give the TMDB cache test something to assert

1. In `apps/cli/src/tmdb.ts`, next to `MAX_TMDB_CACHE_ENTRIES` / the caches,
   add a seam modeled on `prepared-poster-cache.ts:76-80` (extend an existing
   `__testing` object if the file already has one — check first):

```ts
export const __testing = {
  epCacheSize: () => epCache.size,
  epCacheHas: (key: string) => epCache.has(key),
  epCacheClear: () => epCache.clear(),
};
```

Before choosing `epCacheHas`'s key shape, read `fetchEpisodes`'s cache-key
construction (same file) and use the REAL key format — do not guess.

2. Rewrite the `:126-143` test to be deterministic:

```ts
    const { fetchEpisodes, MAX_TMDB_CACHE_ENTRIES, __testing } = await import("@/tmdb");
    setFetchRouter(() => ({ episodes: [ /* one row as today */ ] }));
    __testing.epCacheClear();
    const first = <real-key-of-first-insert>;
    await fetchEpisodes(<first-args>, 1);
    for (let i = 0; i <= MAX_TMDB_CACHE_ENTRIES + 5; i++) {
      await fetchEpisodes(`show-${i}`, 1);
    }
    expect(__testing.epCacheSize()).toBeLessThanOrEqual(MAX_TMDB_CACHE_ENTRIES);
    expect(__testing.epCacheHas(first)).toBe(false); // oldest entry was evicted
```

If clearing `epCache` breaks a sibling test in the same file (a later test
that relied on warm cache), restore the cache state after your test or
re-order your test last — do NOT delete the sibling's assumption.

**Verify**: `bun run --cwd apps/cli test:file test/unit/tmdb.test.ts` → all
tests in the file pass, including the rewritten one. Sanity: temporarily
assert `toBeLessThanOrEqual(MAX_TMDB_CACHE_ENTRIES - 1)` → must FAIL (proves
the assertion observes the cache) → revert.

### Step 4: Make the updater test assert

1. In `apps/cli/src/services/update/BinaryAutoUpdater.ts`, directly after
   `stopBackground()`, add:

```ts
  /** True while a background interval is armed. Used by tests and shutdown diagnostics. */
  get backgroundRunning(): boolean {
    return this.intervalHandle !== null;
  }
```

2. Rewrite `BinaryAutoUpdater.test.ts:21-29` to assert the claim it makes:

```ts
test("clears the background interval and is idempotent", () => {
  const instance = updater();
  expect(instance.backgroundRunning).toBe(false);
  instance.startBackground();
  expect(instance.backgroundRunning).toBe(true);
  instance.stopBackground();
  expect(instance.backgroundRunning).toBe(false);
  instance.stopBackground(); // idempotent second stop
  expect(instance.backgroundRunning).toBe(false);
  instance.startBackground(); // restart after stop must be possible
  expect(instance.backgroundRunning).toBe(true);
  instance.stopBackground();
  expect(instance.backgroundRunning).toBe(false);
});
```

Keep the file's existing `updater()` fixture and call shapes (the original
test already called `startBackground()` bare — the fixture handles the
immediate `runOnce`).

**Verify**: `bun run --cwd apps/cli test:file test/unit/services/update/BinaryAutoUpdater.test.ts`
→ passes with ≥5 expects in that test
(`grep -c "expect(" the file` rises accordingly).

### Step 5: Deterministic sixel waits + the sleep ratchet

**5a.** In `sixel-overlay.test.ts`, replace the 18 sleeps by semantics — read
`sixel-overlay.ts` `register`/`commit`/`unregister`/`afterInkRender` first
(the excerpts in "Current state" cover `register` and `scheduleFlush`):

- **Positive waits** (a write is expected to land): replace
  `await Bun.sleep(5)` with
  `await waitUntil(() => writes.length >= N, { label: "..." })` where N is the
  count expected at that point (`writes.length = 0` resets stay where they
  are; N counts from the reset). Import:
  `import { waitUntil } from "../../support/wait-until";`
- **Negative waits** (nothing must be written — e.g. the test at `:141-158`
  "does not erase through the Ink frame that removed an overlay" ends with a
  sleep then `expect(writes).toHaveLength(0)`): replace the sleep with a
  single ordered macrotask yield:

```ts
// Any flush scheduled by the call above was queued BEFORE this timer,
// so FIFO ordering guarantees it has run (or done nothing) by now.
await new Promise((resolve) => setTimeout(resolve, 0));
```

then keep the `toHaveLength(0)` assertion. This is deterministic — not a
wall-clock bet.

- After conversion, `grep -n "Bun.sleep" apps/cli/test/unit/app-shell/sixel-overlay.test.ts`
  → no matches.

**5b.** Create `apps/cli/test/unit/architecture/bare-sleep-ratchet.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Reduce-only ratchet for raw numeric sleeps in tests. Synchronizing with a
// fixed wall-clock sleep makes results depend on host speed — use
// `test/support/wait-until.ts` instead (see its doc comment). Baseline was
// 58 sites at faf1afd22 (before the sixel-overlay conversion); lower this
// number when you remove sites, never raise it.
const MAX_BARE_SLEEP_SITES = <?>; // see Step 5b instructions
const SKIP_DIRS = new Set(["node_modules", "support", "live", "agent", "templates"]);
const PATTERN = /await Bun\.sleep\(\d+\)/g;

function countSleeps(dir: string, out: { file: string; count: number }[], depth = 12): void {
  if (depth <= 0) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let isDir = false;
    try { isDir = !entry.endsWith(".ts") && !entry.endsWith(".tsx") ? require("node:fs").statSync(full).isDirectory() : false; } catch { continue; }
    if (isDir) { countSleeps(full, out, depth - 1); continue; }
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    const matches = readFileSync(full, "utf8").match(PATTERN);
    if (matches) out.push({ file: full, count: matches.length });
  }
}

describe("test hygiene", () => {
  test("raw numeric Bun.sleep sites stay within the reduce-only ratchet", () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
    const found: { file: string; count: number }[] = [];
    countSleeps(join(repoRoot, "apps", "cli", "test"), found);
    const total = found.reduce((sum, f) => sum + f.count, 0);
    expect(total).toBeLessThanOrEqual(MAX_BARE_SLEEP_SITES);
  });
});
```

Instructions: (1) run the exact repo regex below to get the current total
AFTER your sixel conversion; (2) set `MAX_BARE_SLEEP_SITES` to that total;
(3) simplify the `statSync` line to a clean `node:fs` import if you prefer —
the test must be lint-clean (`bun run lint`).

```
grep -rEo 'await Bun\.sleep\([0-9]+\)' apps/cli/test --include='*.ts' --include='*.tsx' \
  | grep -vE 'test/(support|live|agent|templates)/' | wc -l
```

**Verify**: the new ratchet test passes; then temporarily set
`MAX_BARE_SLEEP_SITES = 0` and confirm it FAILS with the real total in the
message → restore the pinned value.

### Step 6: Gates

**Verify**: `bun run typecheck` exits 0; `bun run lint` exits 0;
`bunx turbo run test:unit --filter=@kitsunekode/kunai --force` shows **only**
the known WIP failure `design color resolution > downgrades accent for truecolor terminals`.

## Test plan

All new/changed tests are named per step: 3 fail-closed stubs (Step 1), the
content-first width test (Step 2), the bounded-cache assertions (Step 3), the
background-interval assertions (Step 4), 18 deterministic waits + the ratchet
(Step 5). Each step's `test:file` run is its own verification gate.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "return originalFetch" apps/cli/test/unit/services/playback/hls-manifest-materializer.test.ts apps/cli/test/unit/app/post-playback-recommendations.test.ts apps/cli/test/integration/anime-discovery-resolve-handoff.test.ts` → no matches (unless STOP-3 was hit and reported)
- [ ] `grep -c "expect(" apps/cli/test/unit/services/update/BinaryAutoUpdater.test.ts` → ≥ 6
- [ ] `grep -n "Bun.sleep" apps/cli/test/unit/app-shell/sixel-overlay.test.ts` → no matches
- [ ] New ratchet test exists and passes; its pinned value equals a fresh run of the grep one-liner
- [ ] All touched test files pass individually via `test:file`
- [ ] `bun run typecheck` and `bun run lint` exit 0
- [ ] Full unit run shows no NEW failures beyond the known WIP failure
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- **STOP-3**: making the anime-discovery stub fail-closed reveals that the
  integration test depends on live network hosts (AniList/TMDB/CDN URLs it
  genuinely fetches). Revert that one file's change, report the URL list —
  that is a test-isolation discovery bigger than this plan.
- `fetchEpisodes`'s cache key cannot be determined by reading `tmdb.ts`
  (dynamic/opaque), so `epCacheHas(first)` can't be written honestly.
- The sixel tests' semantics don't match the two-replacement model (e.g. a
  sleep is load-bearing for a reason the excerpt doesn't show) — convert what
  fits, report the site(s) you left.
- Adding `backgroundRunning` trips a lint rule you cannot satisfy without
  changing test semantics.
- The ratchet total comes back above 60 (much higher than the audited 58) —
  the scan is probably matching something unintended; investigate before
  pinning.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The ratchet is reduce-only: when you remove sleeps, lower
  `MAX_BARE_SLEEP_SITES` in the same change set.
- If someone later adds a shared "stub fetch" helper, the three Step-1 files
  are its first adopters; the throw-on-unmatched convention is the contract.
- A reviewer should scrutinize the sixel negative-wait replacements: each
  `setTimeout(0)` yield must be scheduled AFTER the action whose flush it
  drains, or the FIFO reasoning breaks.
- Deferred (owned elsewhere): fixture-divergence (TQ-07), pty-transcript skip
  (TQ-08), package timeout budgets (TQ-09), process-shutdown gate (TQ-01),
  and the remaining ~40 numeric sleeps across 18 files (frozen by the
  ratchet, converted opportunistically).
