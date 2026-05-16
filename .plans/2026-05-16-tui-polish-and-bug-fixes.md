# TUI Polish & Bug Fix Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three P0 layout/visual bugs, redesign the cluttered top bar, unify the Library shell, improve empty states and error surfaces, and add a compact poster to mediumBrowse.

**Architecture:** All changes are isolated to `app-shell/`. No new files are needed. Each task is independent and can be verified with `bun run typecheck` after completion. The top-bar change touches `root-status-summary.ts` (data) + `ink-shell.tsx` (render) as a pair. The Library fix touches `library-shell.tsx` + `root-overlay-shell.tsx` as a pair.

**Tech Stack:** Ink (React for terminals), Bun, TypeScript. No new dependencies.

---

## Files Changed

| File                                            | What changes                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/src/app-shell/use-poster-preview.ts`  | Move `clearRenderedPosterImages()` from effect start to before resolved/reset dispatch (P0)                                 |
| `apps/cli/src/app-shell/ink-shell.tsx`          | BrowseShell empty-state `flexGrow`, top bar render, mediumBrowse poster cols/rows, placeholder text, `useCallback` handlers |
| `apps/cli/src/app-shell/root-status-summary.ts` | Replace `badges[]` with `crumb` + `alert` shape                                                                             |
| `apps/cli/src/app-shell/library-shell.tsx`      | Remove double `ShellFooter` + `InlineBadge` row; replace with tab bar + status line                                         |
| `apps/cli/src/app-shell/root-overlay-shell.tsx` | Remove duplicate library footer; keep CommandPalette, pass correct actions to single footer                                 |
| `apps/cli/src/app-shell/root-status-shells.tsx` | ErrorShell: remove `borderStyle="round"` box → left accent bar                                                              |

---

## Task 1 — Fix poster clear timing (P0 visual bug)

**File:** `apps/cli/src/app-shell/use-poster-preview.ts`

**Problem:** `clearRenderedPosterImages()` is called at the very start of every effect run. This deletes the terminal image immediately when the URL changes, before the new fetch even starts — producing a blank flash even though the reducer preserves the previous poster in React state.

**Fix:** Remove the call from effect start. Call it only (a) when there is no URL/enabled (reset to nothing), and (b) just before dispatching a resolved result (so old image is replaced atomically with new one).

- [ ] **Step 1: Edit the effect in `use-poster-preview.ts`**

Replace the entire `useEffect` body (lines 61–90) with:

```ts
useEffect(() => {
  if (!url || !enabled) {
    clearRenderedPosterImages();
    dispatch({ type: "reset", posterState: url ? "unavailable" : "idle" });
    return undefined;
  }

  let cancelled = false;
  dispatch({ type: "loading" });

  const timer = setTimeout(() => {
    fetchPoster(url, { rows, cols, variant, allowKitty })
      .then((result) => {
        if (cancelled) return undefined;
        clearRenderedPosterImages();
        startTransition(() => dispatch({ type: "resolved", result }));
        return undefined;
      })
      .catch(() => {
        if (cancelled) return;
        clearRenderedPosterImages();
        startTransition(() => dispatch({ type: "reset", posterState: "unavailable" }));
      });
  }, debounceMs);

  return () => {
    cancelled = true;
    clearTimeout(timer);
    // Do not call clearRenderedPosterImages here — the incoming effect's fetch
    // clears just before rendering its result, preserving the old image during load.
  };
}, [allowKitty, cols, debounceMs, enabled, rows, url, variant]);
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/app-shell/use-poster-preview.ts
git commit -m "fix: preserve poster image during rapid navigation (clear only before render)"
```

---

## Task 2 — Fix browse empty-state layout: command palette floating mid-screen (P0 visual bug)

**File:** `apps/cli/src/app-shell/ink-shell.tsx` — `BrowseShell` component

**Problem:** When `options.length === 0` the empty-state `<Box>` has no intrinsic height. Because `flexGrow={1}` on the sibling doesn't propagate to it, the `CommandPalette` + `ShellFooter` at the bottom of the outer Box end up mid-screen rather than anchored to the terminal bottom.

**Fix:** Add `flexGrow={1}` to every non-results branch (empty state, no-results state, error state). This ensures the content area always claims remaining vertical space regardless of which branch renders.

- [ ] **Step 1: Add `flexGrow={1}` to empty state branch**

Find the ternary at approximately line 2537–2548 that renders when `options.length === 0 && searchState !== "error"`:

```tsx
// BEFORE
) : searchState === "ready" && lastSearchedQuery.length > 0 ? (
  <Box marginTop={2} flexDirection="column">
    <Text color={palette.amber}>{`No results for "${lastSearchedQuery}"`}</Text>
    <Text color={palette.gray} dimColor>
      Try a different spelling, or switch provider with /provider
    </Text>
  </Box>
) : (
  <Box marginTop={1}>
    <Text color={palette.gray}>{emptyMessage}</Text>
  </Box>
)}
```

```tsx
// AFTER
) : searchState === "ready" && lastSearchedQuery.length > 0 ? (
  <Box marginTop={2} flexDirection="column" flexGrow={1}>
    <Text color={palette.amber}>{`No results for "${lastSearchedQuery}"`}</Text>
    <Text color={palette.gray} dimColor>
      Try a different spelling, or switch provider with /provider
    </Text>
  </Box>
) : (
  <Box marginTop={1} flexGrow={1}>
    <Text color={palette.gray}>{emptyMessage}</Text>
  </Box>
)}
```

- [ ] **Step 2: Add `flexGrow={1}` to error state branch**

Find the error message box at approximately line 2387–2394:

```tsx
// BEFORE
{
  searchState === "error" && errorMessage ? (
    <Box marginTop={1} flexDirection="column">
      <Text color={palette.red}>{errorMessage}</Text>
      <Text color={palette.muted} dimColor>
        Press Enter to retry or Esc to clear
      </Text>
    </Box>
  ) : null;
}
```

```tsx
// AFTER
{
  searchState === "error" && errorMessage ? (
    <Box marginTop={1} flexDirection="column" flexGrow={1}>
      <Text color={palette.red}>{errorMessage}</Text>
      <Text color={palette.muted} dimColor>
        Press Enter to retry or Esc to clear
      </Text>
    </Box>
  ) : null;
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "fix: anchor command palette to terminal bottom in browse empty states"
```

---

## Task 3 — Fix Library shell double footer (P0 bug)

**Files:** `apps/cli/src/app-shell/library-shell.tsx`, `apps/cli/src/app-shell/root-overlay-shell.tsx`

**Problem:** `LibraryShell` renders its own `ShellFooter` (lines 97–107) AND its own `InlineBadge` header row (lines 64–74). `RootOverlayShell` wraps it in a second `ShellFooter` + badge. Result: two footers stack, the Library label appears three times, and the badge chrome conflicts with the global header.

**Fix:** Remove `ShellFooter` and `InlineBadge` section from `LibraryShell`. `RootOverlayShell` already renders a single footer for the library overlay — update those actions to include all Library keys. Replace the badge row with a compact tab bar + one-line status.

- [ ] **Step 1: Strip `LibraryShell` down to content-only**

Replace the `LibraryShell` function body in `apps/cli/src/app-shell/library-shell.tsx` with:

```tsx
export function LibraryShell({
  container,
  onClose,
  initialView = "library",
}: {
  container: Container;
  onClose: () => void;
  initialView?: TabId;
}) {
  const [tab, setTab] = useState<TabId>(initialView);
  const [downloadsEnabled, setDownloadsEnabled] = useState(container.config.downloadsEnabled);
  const [autoDownload, setAutoDownload] = useState(container.config.autoDownload);
  const viewport = useDebouncedViewportPolicy("picker");

  useInput((input) => {
    if (input === "1" || input === "l") {
      setTab("library");
      return;
    }
    if (input === "2" || input === "q") {
      setTab("queue");
      return;
    }
    if (input === "d" || input === "D") {
      const next = !downloadsEnabled;
      setDownloadsEnabled(next);
      void container.config.update({ downloadsEnabled: next });
      void container.config.save();
      return;
    }
    if (input === "a" || input === "A") {
      const next =
        autoDownload === "off"
          ? ("next" as const)
          : autoDownload === "next"
            ? ("season" as const)
            : ("off" as const);
      setAutoDownload(next);
      void container.config.update({ autoDownload: next });
      void container.config.save();
      return;
    }
  });

  if (viewport.tooSmall) {
    return <ResizeBlocker minColumns={viewport.minColumns} minRows={viewport.minRows} />;
  }

  const autoLabel =
    autoDownload === "next" ? "next ep" : autoDownload === "season" ? "season" : "off";

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <Box flexDirection="row" columnGap={3}>
        <Text color={tab === "library" ? palette.teal : palette.dim} bold={tab === "library"}>
          {tab === "library" ? "▸ " : "  "}Library
        </Text>
        <Text color={tab === "queue" ? palette.teal : palette.dim} bold={tab === "queue"}>
          {tab === "queue" ? "▸ " : "  "}Queue
        </Text>
      </Box>
      {/* Single-line status */}
      <Text color={palette.dim} dimColor>
        {downloadsEnabled ? "downloads on" : "downloads off"} · auto: {autoLabel}
      </Text>

      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {tab === "queue" ? (
          <DownloadManagerContent
            container={container}
            onClose={onClose}
            onNavigateToLibrary={() => setTab("library")}
          />
        ) : (
          <LibraryTab container={container} />
        )}
      </Box>
      {/* No ShellFooter here — RootOverlayShell owns the single footer */}
    </Box>
  );
}
```

- [ ] **Step 2: Update the library overlay section in `root-overlay-shell.tsx`**

Find the `if (overlay.type === "library")` block (approximately line 868–897) and replace it:

```tsx
if (overlay.type === "library") {
  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" flexGrow={1}>
        <LibraryShell
          container={container}
          onClose={() => container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" })}
          initialView={overlay.view ?? "library"}
        />
      </Box>

      <Box flexDirection="column">
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
          />
        ) : null}
        <ShellFooter
          taskLabel="Library"
          actions={[
            { key: "↑↓", label: "select", action: "search" as const },
            { key: "enter", label: "open", action: "search" as const },
            { key: "d", label: "downloads", action: "search" as const },
            { key: "a", label: "auto", action: "search" as const },
            { key: "/", label: "commands", action: "command-mode" as const },
            { key: "esc", label: "close", action: "quit" as const },
          ]}
          mode="minimal"
          commandMode={commandMode}
        />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/library-shell.tsx apps/cli/src/app-shell/root-overlay-shell.tsx
git commit -m "fix: remove double footer from Library shell, replace badge row with tab bar"
```

---

## Task 4 — Top bar redesign: crumb line + single alert (P1 UX)

**Files:** `apps/cli/src/app-shell/root-status-summary.ts`, `apps/cli/src/app-shell/ink-shell.tsx`

**Problem:** The badge row (up to 8 wrapped badges) is visual noise. Mode/provider/title are already visible from the shell. The agreed new shape: brand + status on line 1, `mode · provider` (+ title + episode during playback) as compact crumb on line 2, one transient alert line (highest-priority wins) on line 3.

**Fix:** Change `RootStatusSummary` type, update `buildRootStatusSummary`, update `AppRoot` render.

- [ ] **Step 1: Update `RootStatusSummary` type and builder in `root-status-summary.ts`**

Replace the entire file content with:

```ts
import {
  compactPlaybackSubtitleStatus,
  describePlaybackSubtitleStatus,
  playbackSubtitleStatusTone,
} from "@/app/subtitle-status";
import type { SessionState } from "@/domain/session/SessionState";

import type { ShellStatusTone } from "./types";

export type RootStatusAlert = {
  text: string;
  tone: ShellStatusTone;
};

export type RootStatusSummary = {
  header: {
    label: string;
    tone: ShellStatusTone;
  };
  /** Compact context crumb: "series · vidking" or "series · vidking · Title · S01E04" */
  crumb: string;
  /** Highest-priority transient alert, or null when idle */
  alert: RootStatusAlert | null;
};

function formatEpisode(state: SessionState): string | null {
  if (!state.currentEpisode) return null;
  return `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
    state.currentEpisode.episode,
  ).padStart(2, "0")}`;
}

function humanReadableRootStatus(raw: string): string {
  switch (raw) {
    case "playing":
      return "Playing";
    case "buffering":
      return "Buffering…";
    case "stalled":
      return "Stream stalled";
    case "seeking":
      return "Seeking…";
    case "loading":
      return "Loading…";
    case "error":
      return "Playback error";
    case "idle":
      return "ready";
    case "resolving":
      return "Resolving…";
    case "paused":
      return "Paused";
    default:
      return raw;
  }
}

function headerTone(rootStatus: string, subtitleTone: ShellStatusTone | null): ShellStatusTone {
  if (rootStatus === "error") return "error";
  if (subtitleTone === "warning") return "warning";
  if (rootStatus === "playing" || rootStatus === "ready" || rootStatus === "idle") return "success";
  return "neutral";
}

export function buildRootStatusSummary({
  state,
  currentViewLabel: _currentViewLabel,
  rootStatus,
  downloadStatus,
}: {
  state: SessionState;
  currentViewLabel: string;
  rootStatus: string;
  downloadStatus?: string | null;
}): RootStatusSummary {
  const episode = formatEpisode(state);
  const title = state.currentTitle?.name;
  const isActivePlayback =
    rootStatus === "playing" ||
    rootStatus === "buffering" ||
    rootStatus === "stalled" ||
    rootStatus === "seeking";

  const subtitleStatus =
    state.stream || isActivePlayback
      ? describePlaybackSubtitleStatus(
          state.stream,
          state.mode === "anime"
            ? state.animeLanguageProfile.subtitle
            : state.seriesLanguageProfile.subtitle,
        )
      : null;
  const subtitleTone = subtitleStatus ? playbackSubtitleStatusTone(subtitleStatus) : null;
  const subtitleCompact = subtitleStatus ? compactPlaybackSubtitleStatus(subtitleStatus) : null;

  const headerLabel =
    isActivePlayback && subtitleCompact
      ? `${humanReadableRootStatus(rootStatus)} · ${subtitleCompact}`
      : humanReadableRootStatus(rootStatus);

  // Crumb: always mode · provider; add title + episode during playback
  const crumbParts: string[] = [state.mode, state.provider];
  if (isActivePlayback && title) {
    crumbParts.push(title);
    if (episode) crumbParts.push(episode);
    if (subtitleCompact) crumbParts.push(subtitleCompact);
  }
  const crumb = crumbParts.join(" · ");

  // Alert: highest-priority transient signal, null when nothing is active
  let alert: RootStatusAlert | null = null;
  if (state.playbackProblem) {
    alert = {
      text: `⚠ issue · ${state.playbackProblem.cause}`,
      tone: state.playbackProblem.severity === "blocking" ? "error" : "warning",
    };
  } else if (state.autoplaySessionPaused) {
    alert = { text: "⚠ autoplay paused", tone: "warning" };
  } else if (state.autoskipSessionPaused) {
    alert = { text: "⚠ autoskip paused", tone: "warning" };
  } else if (state.stopAfterCurrent) {
    alert = { text: "⚠ stop after current", tone: "warning" };
  } else if (downloadStatus) {
    alert = { text: `⬇ ${downloadStatus}`, tone: "info" };
  }

  return {
    header: {
      label: headerLabel,
      tone: headerTone(rootStatus, subtitleTone),
    },
    crumb,
    alert,
  };
}
```

- [ ] **Step 2: Update `AppRoot` render in `ink-shell.tsx` to use the new shape**

Find the section in `AppRoot` that renders the header + badge row (approximately lines 824–847):

```tsx
// BEFORE
<Box justifyContent="space-between">
  <Text bold color={palette.text}>
    {title}
  </Text>
  {status ? <Text color={statusColor(status.tone)}>{status.label}</Text> : null}
</Box>
<Text color={palette.muted}>{subtitle}</Text>
// ... and the badges map at line ~832:
<Box marginTop={0} flexWrap="wrap">
  {rootStatusSummary.badges.map((badge) => (
    <InlineBadge key={...} label={...} tone={badge.tone} />
  ))}
</Box>
{presenceBootLine ? (
  <Box marginTop={0}>
    <Text dimColor color={statusColor(presenceBootLine.tone)}>
      {truncateLine(presenceBootLine.text, ...)}
    </Text>
  </Box>
) : null}
```

Replace both the header row and the badge row with:

```tsx
{
  /* Brand + macro status */
}
<Box justifyContent="space-between">
  <Text bold color={palette.amber}>
    {APP_LABEL}
  </Text>
  <Text color={statusColor(rootStatusSummary.header.tone)}>
    {container.config.minimalMode && currentViewLabel === "browse"
      ? undefined
      : rootStatusSummary.header.label}
  </Text>
</Box>;
{
  /* Compact crumb: mode · provider (+ title · episode during playback) */
}
<Text color={palette.infoDim}>{rootStatusSummary.crumb}</Text>;
{
  /* Single transient alert — highest priority wins, null when idle */
}
{
  rootStatusSummary.alert ? (
    <Text color={statusColor(rootStatusSummary.alert.tone)} dimColor>
      {truncateLine(rootStatusSummary.alert.text, Math.max(36, shellWidth - 8))}
    </Text>
  ) : null;
}
{
  /* Presence boot line renders as alert override when it fires */
}
{
  presenceBootLine && !rootStatusSummary.alert ? (
    <Text dimColor color={statusColor(presenceBootLine.tone)}>
      {truncateLine(presenceBootLine.text, Math.max(36, shellWidth - 8))}
    </Text>
  ) : null;
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors. If `RootStatusSummary.badges` is still referenced anywhere, the compiler will catch it — remove those references.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/root-status-summary.ts apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat: replace badge dump with crumb line + single transient alert in top bar"
```

---

## Task 5 — Error shell: remove border box, use left accent bar (P2 polish)

**File:** `apps/cli/src/app-shell/root-status-shells.tsx`

**Problem:** `ErrorShell` uses `borderStyle="round"` — the only remaining box border in the entire app. It's inconsistent with the rest of the shell design which removed all borders.

**Fix:** Replace with a left-accent-bar pattern using `│ ` prefix text character.

- [ ] **Step 1: Replace `ErrorShell` render in `root-status-shells.tsx`**

```tsx
export function ErrorShell({
  message,
  onResolve,
  onRetry,
}: {
  message: string;
  onResolve: () => void;
  onRetry?: () => void;
}) {
  useInput((input, key) => {
    if (key.return || key.escape) {
      onResolve();
      return;
    }
    if (input.toLowerCase() === "r" && onRetry) {
      onRetry();
    }
  });

  return (
    <Box flexDirection="row" marginTop={1}>
      <Text color={palette.red}>{"│ "}</Text>
      <Box flexDirection="column">
        <Text color={palette.red} bold>
          Playback failed
        </Text>
        <Text color={palette.text}>{message}</Text>
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {onRetry ? "r retry  ·  Enter / Esc dismiss" : "Enter / Esc to continue"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/app-shell/root-status-shells.tsx
git commit -m "polish: remove border box from ErrorShell, use left accent bar"
```

---

## Task 6 — Browse empty state placeholder text (P1 UX)

**File:** `apps/cli/src/app-shell/ink-shell.tsx` — `BrowseShell` component

**Problem:** The idle placeholder "Type a title and press Enter to search." is flat and doesn't surface discovery features. Users never learn about `/trending` or filter syntax organically.

**Fix:** Update `emptyMessage` default and the idle-state rendered hint to nudge users toward `/trending` and filter syntax.

- [ ] **Step 1: Update the initial `emptyMessage` state in `BrowseShell`**

Find (approximately line 1861):

```tsx
const [emptyMessage, setEmptyMessage] = useState("Type a title and press Enter to search.");
```

Replace with:

```tsx
const [emptyMessage, setEmptyMessage] = useState(
  "Search for a title — or try /trending to see what's popular",
);
```

- [ ] **Step 2: Update the `clearResults` helper to use the same message**

Find (approximately line 1878):

```tsx
setEmptyMessage("Type a title and press Enter to search.");
```

Replace with:

```tsx
setEmptyMessage("Search for a title — or try /trending to see what's popular");
```

- [ ] **Step 3: Add a filter syntax hint below the empty state text**

In the render, the empty-state branch (after Task 2's fix) is:

```tsx
) : (
  <Box marginTop={1} flexGrow={1}>
    <Text color={palette.gray}>{emptyMessage}</Text>
  </Box>
)}
```

Replace with:

```tsx
) : (
  <Box marginTop={1} flexGrow={1} flexDirection="column">
    <Text color={palette.gray}>{emptyMessage}</Text>
    {emptyMessage.includes("trending") ? (
      <Text color={palette.dim} dimColor>
        Use <Text color={palette.gray}>year:2022</Text> or <Text color={palette.gray}>type:anime</Text> to narrow · <Text color={palette.gray}>/filters</Text> for all tokens
      </Text>
    ) : null}
  </Box>
)}
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "polish: improve browse empty state placeholder with /trending and filter hints"
```

---

## Task 7 — Enable compact poster in mediumBrowse (P1 UX)

**File:** `apps/cli/src/app-shell/ink-shell.tsx` — `BrowseShell` component

**Problem:** The current code calls `usePosterPreview` with `cols: viewport.wideBrowse ? 24 : 18, rows: viewport.wideBrowse ? 10 : 8` — so in `mediumBrowse`, the poster IS fetched (cols 18, rows 8, enabled: true). But looking at where this is consumed in the companion pane: the companion pane only renders when `showCompanion` is true, and `showPoster` is `viewport.wideBrowse || viewport.mediumBrowse`. So the poster should already appear in mediumBrowse.

The real issue is that `mediumBrowse` used to map to `compact`-level behavior in older code. Verify the poster renders in mediumBrowse, and if the cols/rows are too small for chafa to produce usable output, bump them slightly.

- [ ] **Step 1: Confirm mediumBrowse poster dimensions in `BrowseShell`**

Find (approximately line 1864–1870):

```tsx
const showPoster = viewport.wideBrowse || viewport.mediumBrowse;
const { poster, posterState } = usePosterPreview(options[selectedIndex]?.previewImageUrl, {
  rows: viewport.wideBrowse ? 10 : 8,
  cols: viewport.wideBrowse ? 24 : 18,
  enabled: showPoster,
  debounceMs: 120,
});
```

Update mediumBrowse dimensions to be slightly more generous (chafa needs at least ~14 cols for recognisable output):

```tsx
const showPoster = viewport.wideBrowse || viewport.mediumBrowse;
const { poster, posterState } = usePosterPreview(options[selectedIndex]?.previewImageUrl, {
  rows: viewport.wideBrowse ? 11 : 9,
  cols: viewport.wideBrowse ? 26 : 16,
  enabled: showPoster,
  debounceMs: 120,
});
```

- [ ] **Step 2: Confirm companion renders for mediumBrowse in the poster section**

Find the companion pane poster block (approximately line 2475–2485):

```tsx
{
  showPoster && poster.kind !== "none" ? (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{poster.placeholder}</Text>
    </Box>
  ) : showPoster && selectedOption?.previewImageUrl ? (
    <Box marginBottom={1}>
      <Text color={posterState === "loading" ? palette.info : palette.dim} dimColor>
        {posterState === "loading" ? "Loading artwork…" : "Artwork unavailable"}
      </Text>
    </Box>
  ) : null;
}
```

No change needed here — `showPoster` already covers mediumBrowse. This step is a verification that the code path is correct.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "polish: bump mediumBrowse poster dimensions for better chafa output"
```

---

## Task 8 — `useCallback` audit for BrowseShell handlers (P2 performance)

**File:** `apps/cli/src/app-shell/ink-shell.tsx` — `BrowseShell` component

**Problem:** `clearResults`, `updateQuery`, `handleQuerySubmit` are recreated every render because they are plain function declarations (not `useCallback`). Ink's `useInput` attaches a new event listener every time the reference changes, which on fast renders can accumulate stale closures.

- [ ] **Step 1: Wrap `clearResults`, `updateQuery`, and `handleQuerySubmit` in `useCallback`**

Find the three function declarations in `BrowseShell` (approximately lines 1872–1904):

```tsx
const clearResults = useCallback(() => {
  setOptions([]);
  setSelectedIndex(0);
  setSearchState("idle");
  setLastSearchedQuery("");
  setErrorMessage(null);
  setEmptyMessage("Search for a title — or try /trending to see what's popular");
  setResultSubtitle("");
  setSelectedDetail("Search for a title — or try /trending to see what's popular");
  setActiveFilterBadges([]);
}, []);

const updateQuery = useCallback(
  (nextValue: string) => {
    const normalized = normalizeReservedCommandInput(nextValue);
    setQuery(normalized.value);
    setHistoryIndex(-1);
    if (normalized.openCommandPalette) {
      setCommandMode(true);
      setCommandInput("");
      setHighlightedCommandIndex(0);
    }
    if (normalized.value.trim().length === 0) {
      clearResults();
    }
  },
  [clearResults],
);

const handleQuerySubmit = useCallback(() => {
  if (!queryDirty && selectedOption && options.length > 0 && searchState === "ready") {
    onSubmit(selectedOption.value);
    return;
  }
  void runSearch();
}, [queryDirty, selectedOption, options.length, searchState, onSubmit, runSearch]);
```

Note: `runSearch` is an async function that references many state setters — wrap it too:

```tsx
const runSearch = useCallback(async () => {
  // ... existing body unchanged ...
}, [query, searchState, onSearch, onSubmit]);
```

The `runSearch` body is long; only the wrapping changes. Keep the body identical to the current implementation.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: 0 errors. Fix any `useCallback` dependency array warnings the TS compiler surfaces.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "perf: wrap BrowseShell handlers in useCallback to stabilise useInput listeners"
```

---

## Task 9 — Final verification

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

Expected: 0 errors across all 8 packages.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: 0 warnings.

- [ ] **Step 3: Format**

```bash
bun run fmt
```

- [ ] **Step 4: Tests**

```bash
bun run test
```

Expected: all pass.

- [ ] **Step 5: Final commit if fmt changed files**

```bash
git add -A
git commit -m "chore: fmt after polish pass"
```

---

## Verification Checklist (manual)

After the plan completes, run `bun run dev` and confirm:

- [ ] Top bar shows `🦊 Kunai` + status on line 1, compact crumb on line 2, no wrapping badge row
- [ ] Opening `/library` shows tab bar ("Library" / "Queue"), one-line status, single footer row
- [ ] `/downloads` still works (it opens the downloads overlay — separate from library)
- [ ] Browse shell: command palette appears at the bottom even with no search results
- [ ] Browse shell: switching results rapidly shows no poster flash (previous image persists during load)
- [ ] Browse shell (131–140 col terminal): companion panel includes a small poster
- [ ] Error shell (trigger by invalid provider): shows left accent bar, no box border
- [ ] Empty state shows `/trending` nudge and filter syntax hint
