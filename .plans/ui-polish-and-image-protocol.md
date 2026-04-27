# Plan: UI/UX Polish + Terminal Image Protocol

## Status: pending

---

## Overview

Four areas of work, ordered by risk and dependency:

1. **Image Protocol** — Kitty/Ghostty graphics via unicode placeholders, chafa block-art fallback,
   integrated into the browse companion pane without breaking Ink's render cycle
2. **Browse Shell Polish** — selection feel, result rows, companion pane layout, empty state
3. **ShellFrame Redesign** — header layout, status strip, footer density
4. **Post-Playback + Search Shell** — body content, exit polish, minor UX fixes

---

## 1. Image Protocol

### 1a. Problem

`src/image.ts` already implements the Kitty graphics APC chunk protocol, but it writes raw escape
sequences to stdout outside the Ink render cycle. This causes flicker: Ink doesn't know the cursor
has moved, so its next differential render lands in the wrong place.

The existing code is used by the old legacy flow and not wired into the Ink browse shell at all.
The `OverlayPanel` code currently says `"Inline Kitty/Ghostty rendering is kept behind the
image-pane path"` — that path does not exist yet.

### 1b. Solution: Kitty Unicode Placeholders

Kitty protocol ≥ 1.1 (current Kitty and Ghostty) supports **unicode placeholder cells**: after
uploading an image you emit special Unicode characters that _are_ part of the text layout. Ink
renders them as ordinary characters occupying known cell positions; the terminal GPU-composites
the image on top. No cursor tricks, no Ink interference.

For terminals without Kitty support, fall back to `chafa` rendered block art (UTF-8 block
characters), which Ink can render as a plain `<Text>` child.

### 1c. `src/app-shell/image-pane.ts` (new file)

```ts
export type PosterResult =
  | { kind: "kitty"; placeholder: string; rows: number; cols: number }
  | { kind: "chafa"; art: string; rows: number; cols: number }
  | { kind: "none" };

// LRU-style map: url → PosterResult (capped at 12 entries)
const posterCache = new Map<string, PosterResult>();

export async function fetchPoster(
  url: string | undefined,
  { rows, cols }: { rows: number; cols: number },
): Promise<PosterResult>;
```

**Kitty path** (`isKittyCompatible()` true):

1. Fetch image from TMDB (5 s timeout); decode to raw bytes
2. Base64-encode; send Kitty `a=T,f=100,q=2,i=<id>,m=0` sequence to transmit the image
   silently (no display yet)
3. Build the **unicode placeholder string**: `rows` lines of `cols` repetitions of
   `\u{10EEEE}` (the Kitty placeholder codepoint) with combining chars encoding
   `(image_id >> 24) & 0xFF` … `image_id & 0xFF`
4. Return `{ kind: "kitty", placeholder, rows, cols }`

**chafa fallback** (no Kitty, `chafa` binary found):

1. Download image to tmp file
2. `Bun.spawn(["chafa", "--size", `${cols}x${rows}`, "--format", "utf8", tmpPath])`
3. Return `{ kind: "chafa", art: stdout, rows, cols }`

**No-op fallback**: return `{ kind: "none" }`

**Image IDs**: use a monotonically incrementing counter per session, wrapped at 16-bit. Delete
previous placement when the URL changes: `\x1b_Ga=d,d=I,i=<old_id>;\x1b\\`

**Helper** (`src/image.ts` update):

- Keep `isKittyCompatible()`
- Add `isChafaAvailable(): boolean` — checks `which chafa` once, caches result
- Move `displayPoster()` to a legacy export only; do not use in new code

### 1d. Integration into BrowseShell

`BrowseShell` already has `previewImageUrl` on each option. When the selected option changes:

```tsx
// New state in BrowseShell
const [poster, setPoster] = useState<PosterResult>({ kind: "none" });
const posterRows = compact ? 8 : 12;
const posterCols = Math.min(previewWidth - 2, 28);

// Effect triggered on selection change (debounced 120 ms)
useEffect(() => {
  const url = selectedOption?.previewImageUrl;
  if (!url || !wideBrowse) {
    setPoster({ kind: "none" });
    return;
  }
  let cancelled = false;
  const timer = setTimeout(async () => {
    const result = await fetchPoster(url, { rows: posterRows, cols: posterCols });
    if (!cancelled) setPoster(result);
  }, 120);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}, [selectedOption?.previewImageUrl, posterRows, posterCols, wideBrowse]);
```

**Rendering in the companion pane** (the right-side preview panel that already exists):

```tsx
{
  poster.kind !== "none" && wideBrowse && (
    <Box flexDirection="column" width={posterCols} height={posterRows} marginBottom={1}>
      {poster.kind === "kitty" ? (
        // Ink renders the placeholder chars; Kitty composites the image
        <Text>{poster.placeholder}</Text>
      ) : (
        // chafa block art: split by newlines, render each line
        poster.art
          .split("\n")
          .slice(0, posterRows)
          .map((line, i) => <Text key={i}>{line}</Text>)
      )}
    </Box>
  );
}
```

When no poster is available (provider doesn't expose it, or unsupported terminal), the companion
pane shows its existing text content unchanged. Never block selection or navigation for images.

**Cleanup on unmount**: `useEffect(() => () => deleteKittyImage(currentImageId), [])` — send the
Kitty delete-all-placements sequence when `BrowseShell` unmounts.

### 1e. Post-Playback Shell Poster

After playback, the `PlaybackShell` body currently shows a static hint paragraph. When the title
has a `posterUrl` (it comes from `TitleInfo` → `SearchPhase`), show the poster here too using the
same `fetchPoster` path. This gives the post-playback screen a genuine visual identity.

The `PlaybackShellState` already has `title` and `type`. Add `posterUrl?: string` to it (one-line
change in `types.ts`) and thread it from `PlaybackPhase.ts`.

---

## 2. Browse Shell Polish

### 2a. Result Row Design

**Current**: selected item uses `❯` + cyan background on the cursor char, no type badge.

**New row layout**:

```
❯  Breaking Bad                              📺 2008
   One of the greatest shows ever made        AMC
```

Changes:

- Lead `❯` uses `palette.amber` (brand color) not `palette.cyan` — selection cursor owns amber
- Second column: type emoji `🎬` (movie) or `📺` (series) + year, right-aligned to list width
- Detail line (body preview) shown only on selected row, truncated to one line
- Unselected rows: dimColor on everything except the title itself

```tsx
function ResultRow({
  option,
  selected,
  width,
}: {
  option: BrowseShellOption<T>;
  selected: boolean;
  width: number;
}) {
  const typeIcon = option.value; /* need type info */ // see note below
  const titleWidth = width - 10; // leave room for year+icon

  return (
    <Box flexDirection="column">
      <Box width={width} justifyContent="space-between">
        <Box>
          <Text color={selected ? palette.amber : palette.gray}>{selected ? "❯ " : "  "}</Text>
          <Text bold={selected} color={selected ? "white" : palette.muted} dimColor={!selected}>
            {truncateLine(option.label, titleWidth)}
          </Text>
        </Box>
        {option.previewMeta?.[0] ? (
          <Text color={palette.gray} dimColor>
            {option.previewMeta[0]}
          </Text>
        ) : null}
      </Box>
      {selected && option.detail ? (
        <Box marginLeft={2}>
          <Text color={palette.gray} dimColor>
            {truncateLine(option.detail, width - 2)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
```

**Note**: `previewMeta` is already populated with `["2023  · Movie"]` or `["2023  · TV"]` by
`browse-option-mappers.ts`. Use `previewMeta[0]` for the right column.

### 2b. Empty State

When `options.length === 0` and `searchState === "ready"` and `lastSearchedQuery` is non-empty:

```tsx
<Box marginTop={2} flexDirection="column">
  <Text color={palette.amber}>No results for "{lastSearchedQuery}"</Text>
  <Text color={palette.gray} dimColor>
    Try a different spelling, or switch provider with /provider
  </Text>
</Box>
```

Current code shows nothing — the list is just empty, leaving the user guessing.

### 2c. Companion Pane Structure

The right-side preview pane layout on wide viewports:

```
┌─────────────────────────────────┐
│ [poster image — 12 rows]        │
│                                 │
├─────────────────────────────────┤
│ Breaking Bad                    │  ← previewTitle, bold
│ 2008  ·  TV  ·  ★ 9.5          │  ← previewMeta joined
│                                 │
│ A high school chemistry teacher │  ← previewBody, wrapped
│ diagnosed with cancer turns to  │
│ manufacturing meth to secure... │
│                                 │
│ AMC  ·  rivestream              │  ← previewNote, muted
└─────────────────────────────────┘
```

The separator between image and text should be a `─` line at `previewWidth` chars.

### 2d. Filter Input Hint

When filter is non-empty, show character count and a reminder that Esc clears:

```tsx
<Text color={palette.gray} dimColor>
  {filterQuery.length > 0
    ? `"${filterQuery}" · Esc clears`
    : `${options.length} results · type to filter`}
</Text>
```

### 2e. Provider Change Feedback

After selecting a new provider in the provider picker overlay, the results list clears (`clearResults()` is already called). Add a one-liner below the search input:

```tsx
{searchState === "searching" ? (
  <Text color={palette.amber}>Searching {activeProvider}…</Text>
) : options.length === 0 && lastSearchedQuery ? (
  /* empty state */ ...
) : null}
```

The loading state is already tracked via `searchState`; this just makes it visible.

---

## 3. ShellFrame Redesign

### 3a. Header

**Current**: `borderStyle="round"` box wrapping everything, amber eyebrow on top.

**Problem**: The box border appears on every shell (browse, playback, search, loading). It looks
like a floating card rather than a persistent application frame. The outer `paddingX={1}` plus the
border padding makes everything feel inset.

**New layout** (no outer border, instead a minimal top header bar):

```
🦊 KitsuneSnipe beta                        Series mode  ·  rivestream
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Breaking Bad
S02E05  ·  Provider rivestream  ·  Mode series            ● Ready
```

Components:

- **App bar**: `eyebrow` text left, `mode · provider` right — both `dimColor`
- **Thin separator**: `─` at full terminal width (`stdout.columns`)
- **Title line**: bold white, large
- **Subtitle line**: muted
- **Status chip**: `●` colored dot + short label, right-aligned on the title line

```tsx
function ShellFrame({ eyebrow, title, subtitle, status, ... }) {
  const { stdout } = useStdout();
  const sepWidth = stdout.columns ?? 80;

  return (
    <Box flexDirection="column">
      {/* App bar */}
      <Box justifyContent="space-between" paddingX={1}>
        <Text color={palette.amber}>{eyebrow}</Text>
        {status ? (
          <Box>
            <Text color={statusColor(status.tone)}>● </Text>
            <Text color={palette.gray} dimColor>{status.label}</Text>
          </Box>
        ) : null}
      </Box>

      {/* Separator */}
      <Text color={palette.gray} dimColor>{"─".repeat(sepWidth)}</Text>

      {/* Content */}
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="white">{title}</Text>
        <Text color={palette.muted}>{subtitle}</Text>
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
      </Box>

      {/* Command palette if active */}
      {commandMode ? <CommandPalette ... /> : null}

      {/* Footer separator */}
      <Text color={palette.gray} dimColor>{"─".repeat(sepWidth)}</Text>

      <ShellFooter ... />
    </Box>
  );
}
```

**Impact**: Browse, Playback, and Search all use `ShellFrame`. One change updates all three. The
loading shell uses its own layout and is not affected.

### 3b. Footer

**Current**: `taskLabel` is a long prose string ("Review playback actions and continue this
session"). The footer renders on two lines: task label, then hotkeys.

**New**:

- `taskLabel` shortened to just the task noun: `"Playback"`, `"Browse"`, `"Search"`
- Status suffix appended inline after `·`: `"Playback  ·  Ready"`
- Hotkeys line: group primary (`r replay  f search  e episodes`) and secondary (`n/p nav  q quit
/ commands`) separated by a gap
- Disabled commands omitted from footer (already done) but their reason shown as a tooltip-style
  suffix on the adjacent enabled command when relevant

### 3c. Command Palette

**Current**: command list shows `/alias  description` in a bordered box below the footer.

**New**:

- Opened command shows current match count: `Command (3 matches)`
- Disabled commands shown in a separate "Unavailable" section at the bottom, dimmed, with reason
- Default highlight: the most recently used command is pre-highlighted (stored in module-level
  `lastUsedCommandId`)
- `Tab` cycles through matches (already implemented) but also wraps

---

## 4. Post-Playback + Search Shell

### 4a. Post-Playback Body

**Current**: `<Text color={palette.muted}>Playback controls stay visible…</Text>` — a static hint
paragraph that provides no value after the first session.

**New**:

```tsx
{
  /* Title identity card */
}
<Box flexDirection="column" marginBottom={1}>
  {state.type === "series" ? (
    <>
      <Text bold color="white">
        {`S${String(state.season).padStart(2, "0")}E${String(state.episode).padStart(2, "0")}`}
      </Text>
      <Text color={palette.muted}>Episode complete</Text>
    </>
  ) : (
    <Text color={palette.muted}>Playback complete</Text>
  )}
</Box>;

{
  /* Inline poster (when available + Kitty) */
}
{
  poster.kind !== "none" && (
    <Box marginBottom={1}>{/* same poster rendering as browse companion */}</Box>
  );
}

{
  /* Subtitle status as a status chip */
}
{
  state.subtitleStatus ? (
    <Box>
      <Text color={state.subtitleStatus.includes("attached") ? palette.green : palette.amber}>
        ● {state.subtitleStatus}
      </Text>
    </Box>
  ) : null;
}
```

### 4b. Search Shell

**Current**: basic text input box. No context about how many results were in a previous session,
no recent-query suggestion.

Improvements:

- Show last search query as placeholder (already done via `initialValue`, but only if passed — make
  sure `SearchPhase` threads the previous query through `bootstrap.initialQuery` on back-to-results)
- On empty state (first open), show: `"Search by title, year, or phrase"`
- After Esc (cancel back to browse), restore the previous filter/selection exactly

### 4c. Exit Treatment

The UX doc specifies a "soft exit" — dim → footer drops → optional mascot reaction → one line →
done in 180–220ms. Currently `process.exit(0)` is called immediately on Ctrl+C.

Light implementation (no mascot reaction needed — keep it minimal):

1. On Ctrl+C: unmount Ink root → `clearShellScreen()` → write `🦊 bye\n` → `process.exit(0)` after a 150ms delay
2. Keep `Ctrl+C` → `process.exit(0)` as the instant path (< 50ms) — the "bye" only fires for graceful quit (`q`)

This is a small change to `stdinManager.cleanup()` and the `"quit"` resolve path.

---

## 5. UX Bug Fixes

| Bug                                                                                                      | Location                   | Fix                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Esc` in playback shell → immediately navigates to search, not a confirm                                 | `PlaybackShell` `useInput` | Keep as-is per UX doc: Esc on post-playback is documented to go back. Not a bug.                                                                                                               |
| Browse picker: first `Esc` should clear filter, second closes                                            | `ListShell`                | Already correct per code. No change needed.                                                                                                                                                    |
| Footer shows `/` key with label `"commands"` but action is `"replay"`                                    | `PlaybackShell` footer     | This conflates two hotkeys. Fix: `{ key: "/", label: "commands", action: "command-mode" }` — add `command-mode` as a local action in `resolvePlaybackAction` that calls `setCommandMode(true)` |
| Empty overlay `loading` state shows no indicator in `OverlayPanel`                                       | `OverlayPanel`             | Already handled via `overlay.loading ? <Text>Loading panel…</Text>` — fine                                                                                                                     |
| Browse results: `options.length === 0` after search shows nothing                                        | `BrowseShell` render       | Add empty state (section 2b above)                                                                                                                                                             |
| `previewBody` shows "Type a title and press Enter to search" even after results load and option has body | `BrowseShell`              | The fallback is applied when `previewBody` is falsy — correct, but the fallback copy should change to something less instructional when results exist: `"No description available"`            |
| Post-playback `Esc` resolves `"search"` but should signal `"back_to_results"`                            | `PlaybackShell`            | Change Esc to emit `"back_to_results"` so the search state is preserved (user returns to the result list)                                                                                      |
| Command palette `Tab` autocomplete only cycles forward                                                   | `useShellInput`            | Already correct — forward only, fine                                                                                                                                                           |

---

## 6. Files Changed

| File                          | Change                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app-shell/image-pane.ts` | **new** — `fetchPoster()`, Kitty unicode placeholder builder, chafa fallback, cache                                                                      |
| `src/image.ts`                | Add `isChafaAvailable()`, keep `isKittyCompatible()`, deprecate `displayPoster`                                                                          |
| `src/app-shell/ink-shell.tsx` | `ShellFrame` header redesign; `BrowseShell` poster effect + row design + empty state; `PlaybackShell` body + poster + Esc fix; `SearchShell` placeholder |
| `src/app-shell/types.ts`      | Add `posterUrl?: string` to `PlaybackShellState`                                                                                                         |
| `src/app/PlaybackPhase.ts`    | Thread `title.posterUrl` into `PlaybackShellState`                                                                                                       |

---

## 7. Implementation Order

1. `image-pane.ts` — isolated, testable, no UI changes
2. `ShellFrame` redesign — touches all shells, do this before other shell changes so the base
   layout is stable
3. `BrowseShell` result rows + empty state + poster integration
4. `PlaybackShell` body + Esc fix + poster
5. Exit treatment
6. UX bug fixes (the Esc `back_to_results` fix is most impactful)

---

## 8. Acceptance Criteria

### Image Protocol

- [ ] On Kitty/Ghostty: poster image appears in companion pane when a result with a poster URL is
      selected in browse shell
- [ ] Image changes without flicker when selection changes
- [ ] Image is cleared when browse shell closes
- [ ] On unsupported terminals: pane shows text-only companion, no errors
- [ ] `chafa` is tried before giving up on non-Kitty terminals
- [ ] Image never blocks selection — navigation remains instant

### Browse Shell

- [ ] Selected row: amber `❯`, bold title, type/year on right, one-line detail below
- [ ] Empty search result shows explicit message with recovery hint
- [ ] Filter input shows count of results and Esc-clears hint
- [ ] Provider change → brief "Searching…" indicator visible

### ShellFrame

- [ ] App bar replaces bordered box — feels like a TUI, not a floating card
- [ ] Status `●` dot uses correct tone color
- [ ] `taskLabel` is concise (noun + status suffix, not prose)
- [ ] Footer separator line visible above footer

### Post-Playback

- [ ] Body shows episode identity card (S02E05, Episode complete)
- [ ] `Esc` returns to browse results, not bare search
- [ ] `q` quit shows brief exit line before process ends

### General

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes (ignoring scratchpads)
- [ ] No terminal corruption on shells where images are not supported
