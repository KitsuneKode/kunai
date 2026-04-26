# Plan: Loading Shell — Bug Fix + Animation Redesign

## Status: pending

---

## 1. Problem Statement

### 1a. Repetition Bug

When the app transitions from "resolving" (stream lookup) to "playing" (mpv running), two stacked
title lines appear simultaneously, e.g.:

```
¦ Koori no Jouheki
¦ Koori no Jouheki - S01E04
```

Both lines carry the box border `¦`, meaning both `LoadingShell` instances are visible in the
terminal at the same time.

### 1b. Visual Quality

The current `LoadingShell` is functional but low-polish: plain text, braille spinner, no visual
hierarchy, no identity. The redesign should make it look significantly better.

---

## 2. Root Cause: Repetition Bug

**File**: `src/app/PlaybackPhase.ts` and `src/app-shell/ink-shell.tsx`

### The Sequence

```
1. openLoadingShell({ operation: "resolving", title: "Koori no Jouheki" })
   → mountShell → setRootShellScreen({ id: 1, element: <LoadingShell resolving /> })
   → React renders "resolving" shell to terminal (3–5 lines)

2. loading.close()
   → settle() → setRootShellScreen(null)
   → rootShellScreen = null, notifySubscribers()
   → React schedules a re-render of RootShellHost

3. await loading.result   ← promise resolves immediately after settle()

4. playStream() is called — synchronously opens a new loading shell
   → openLoadingShell({ operation: "playing", title: "Koori no Jouheki - S01E04" })
   → mountShell → setRootShellScreen({ id: 2, element: <LoadingShell playing /> })
   → React schedules another re-render
```

**The problem**: React and Ink batch micro-task renders. Between steps 2 and 4, the promise in step
3 resolves synchronously (microtask) before React has flushed. When React finally renders, it has
two queued state updates: `null` and `{ id: 2 }`. Ink's differential cursor-based renderer does
**not** erase previously-painted terminal lines when rendering shorter content. So:

- The "resolving" shell paints lines 1–5
- React renders the null frame — cursor moves to line 0 but lines 1–5 remain
- React renders the "playing" shell — paints lines 1–5 again (or from cursor position)
- Terminal shows both sets of lines stacked

### The Fix: Eliminate the Null Frame

Instead of close-then-open (which creates a null gap), **update the existing mounted component
in-place**. This requires:

1. Add `update(state: LoadingShellState) => void` to `LoadingShellHandle`
2. Implement it via an internal React state updater captured in the mounted component
3. In `PlaybackPhase.ts`, pass the "resolving" handle into `playStream`, which calls
   `handle.update(...)` to switch to "playing" state without ever setting the screen to null

---

## 3. Implementation Plan

### Step 1 — Add `update()` to `LoadingShellHandle`

**File**: `src/app-shell/ink-shell.tsx`

**Current** (line ~1563):

```ts
export function openLoadingShell({ state, cancellable = false }) {
  const session = mountShell<"done" | "cancelled">({
    renderShell: (finish) => (
      <LoadingShell state={state} onCancel={...} />
    ),
    fallbackValue: "done",
  });
  return {
    close: () => session.close("done"),
    result: session.result,
  };
}

export type LoadingShellHandle = {
  close: () => void;
  result: Promise<"done" | "cancelled">;
};
```

**New**:

```ts
export type LoadingShellHandle = {
  close: () => void;
  update: (state: LoadingShellState) => void;
  result: Promise<"done" | "cancelled">;
};

export function openLoadingShell({
  state: initialState,
  cancellable = false,
}: {
  state: LoadingShellState;
  cancellable?: boolean;
}): LoadingShellHandle {
  let externalSetState: ((s: LoadingShellState) => void) | null = null;

  function LiveLoadingShell({
    finish,
  }: {
    finish: (value: "done" | "cancelled") => void;
  }) {
    const [state, setState] = useState(initialState);
    useEffect(() => {
      externalSetState = setState;
      return () => {
        externalSetState = null;
      };
    }, []);
    return (
      <LoadingShell
        state={state}
        onCancel={cancellable ? () => finish("cancelled") : undefined}
      />
    );
  }

  const session = mountShell<"done" | "cancelled">({
    renderShell: (finish) => <LiveLoadingShell finish={finish} />,
    fallbackValue: "done",
  });

  return {
    close: () => session.close("done"),
    update: (state) => externalSetState?.(state),
    result: session.result,
  };
}
```

The `externalSetState` ref is set once on mount and cleared on unmount. The `update()` method
pushes new state into the already-mounted component — React re-renders in-place, Ink repaints the
same line range, no null frame, no stacking.

---

### Step 2 — Thread the loading handle through `playStream`

**File**: `src/app/PlaybackPhase.ts`

**Current flow** (lines ~165–198 and ~562):

```ts
const loading = openLoadingShell({ state: { operation: "resolving", ... } });
try {
  stream = await currentProvider.resolveStream(...);
} finally {
  loading.close();
  await loading.result;
}
// ... fallback check ...
const result = await this.playStream(stream, title, episode, context, startAt);

// Inside playStream (line 562):
const playing = openLoadingShell({ state: { operation: "playing", ... } });
try {
  ...
} finally {
  playing.close();
  await playing.result.catch(() => {});
}
```

**New flow**:

```ts
// Main loop — open loading once, update it as phases change
const loading = openLoadingShell({ state: { operation: "resolving", ... } });

let stream: StreamInfo | null = null;
try {
  stream = await currentProvider.resolveStream(...);
} catch (e) {
  loading.close();
  await loading.result;
  throw e;
}
// No close/await here — loading stays open, playStream takes ownership

// ... fallback / null-stream handling still closes loading if returning early ...

const result = await this.playStream(stream, title, episode, context, startAt, loading);
```

```ts
private async playStream(
  stream: StreamInfo,
  title: TitleInfo,
  episode: EpisodeInfo,
  context: PhaseContext,
  startAt = 0,
  loading: LoadingShellHandle,    // ← new param
): Promise<PlaybackResult> {
  const { player, stateManager, config } = context.container;

  const displayTitle = ...;
  const subtitleStatus = ...;

  stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });

  // Update in-place instead of open-close-open
  loading.update({
    title: displayTitle,
    subtitle: "mpv is open — waiting for playback to finish",
    operation: "playing",
    details: `Provider: ${stateManager.getState().provider}`,
    trace: `Stream resolved · headers ${Object.keys(stream.headers ?? {}).length} keys`,
    subtitleStatus,
    showMemory: config.showMemory,
  });

  try {
    const result = await player.play(stream, { ... });
    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "finished" });
    return result;
  } finally {
    loading.close();
    await loading.result.catch(() => {});
  }
}
```

**Edge cases to handle**:

- Stream resolve fails → `catch` block above closes loading before re-throwing
- Stream is null (not found) → close loading before logging and returning `status: error`
- Fallback provider path → close primary loading, open a new one for fallback (or update in-place if feasible — see note below)

**Note on fallback**: The fallback path logs an error and tries a second provider. Since this
involves a second `resolveStream` call, we should update the loading state to reflect the fallback
rather than open a new shell:

```ts
loading.update({ operation: "resolving", details: `Fallback: ${fallback.metadata.id}`, ... });
stream = await fallback.resolveStream(...);
```

Then continue to `playStream` as above.

---

### Step 3 — Visual Redesign of `LoadingShell`

**File**: `src/app-shell/ink-shell.tsx` — `LoadingShell` component (lines ~1406–1486)

**Goals**:

- Visual hierarchy: app identity → content title → status
- Animated elements beyond the spinner
- Elapsed time counter for long operations
- Fox identity (`🦊`) in header
- Cleaner, more modern layout with subtle box structure

**Layout design**:

```
 🦊 KitsuneSnipe

   Koori no Jouheki                    ← title, bold white
   Season 01 · Episode 04              ← subtitle, muted

   ⠙  Resolving stream...              ← spinner + operation, cyan
      Provider: rivestream              ← details, dim

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ← thin separator

   Subtitles: attached                  ← subtitleStatus (green/amber)
   Stream resolved · headers 3 keys    ← trace, dim

   0:12 elapsed                         ← elapsed time counter, dim
```

**Animations beyond spinner**:

1. **Elapsed timer**: `useElapsed()` hook — increments every second, shows `X:XX elapsed`
   - Only shown for `operation: "resolving" | "scraping"` (not "playing" where mpv is visible)
2. **Pulsing operation color**: cycle `palette.cyan → "white" → palette.cyan` over 1.5s for
   the operation label text when `operation !== "playing"`
3. **"playing" state variant**: when `operation === "playing"`, swap the spinner for a static `▶`
   symbol and show a static "now playing" style layout rather than an activity spinner

**Component structure** (pseudocode):

```tsx
function LoadingShell({ state, onCancel }) {
  const spinner = useSpinner();
  const elapsed = useElapsed(); // seconds since mount
  const pulse = usePulse(1500); // 0.0–1.0 over 1.5s cycle

  const isPlaying = state.operation === "playing";
  const leadIcon = isPlaying ? "▶" : spinner;

  const opColor = isPlaying ? palette.green : interpolateColor(palette.cyan, "white", pulse); // or just alternate between two

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* App identity */}
      <Box marginBottom={1}>
        <Text color={palette.muted} dimColor>
          🦊 KitsuneSnipe
        </Text>
      </Box>

      {/* Content title */}
      <Box>
        <Text color={opColor}>{leadIcon} </Text>
        <Text bold color="white">
          {state.title}
        </Text>
      </Box>
      {state.subtitle && (
        <Box marginLeft={2}>
          <Text color={palette.muted}>{state.subtitle}</Text>
        </Box>
      )}

      {/* Separator */}
      <Box marginY={1}>
        <Text color={palette.muted} dimColor>
          {"─".repeat(Math.min(40, stdout.columns - 4))}
        </Text>
      </Box>

      {/* Operation status */}
      <Box>
        <Text color={opColor}>{operationLabels[state.operation]}</Text>
        {state.details && (
          <Text color={palette.gray} dimColor>
            {" "}
            {state.details}
          </Text>
        )}
      </Box>

      {/* Subtitle status */}
      {state.subtitleStatus && (
        <Box marginTop={1}>
          <Text color={state.subtitleStatus.includes("attached") ? palette.green : palette.amber}>
            {state.subtitleStatus}
          </Text>
        </Box>
      )}

      {/* Trace */}
      {state.trace && (
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {state.trace}
          </Text>
        </Box>
      )}

      {/* Elapsed (resolving/scraping only) */}
      {!isPlaying && elapsed > 2 && (
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {formatElapsed(elapsed)} elapsed
          </Text>
        </Box>
      )}

      {/* Progress bar */}
      {state.progress !== undefined && <Box marginTop={1}>...</Box>}

      {/* Cancel hint */}
      {state.cancellable && (
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            ESC to cancel
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

**New hooks to add** (above `LoadingShell`):

```ts
function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}

function usePulse(periodMs: number): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const phase = ((Date.now() - start) % periodMs) / periodMs;
      setT(Math.sin(phase * Math.PI * 2) * 0.5 + 0.5); // 0.0–1.0
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return t;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
```

**Note on `interpolateColor`**: Ink/React terminal doesn't support interpolated RGB colors. Instead,
use `usePulse` threshold to alternate between two colors:

```ts
const opColor = pulse > 0.5 ? palette.cyan : "white";
```

Or keep it simple — don't pulse the operation label, just pulse the spinner character by cycling
a different set of frames for the "active resolving" state.

---

## 4. Files Changed

| File                          | Change                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app-shell/ink-shell.tsx` | Add `update()` to `LoadingShellHandle`; add `LiveLoadingShell` wrapper; redesign `LoadingShell` component; add `useElapsed`, `usePulse`, `formatElapsed`                |
| `src/app-shell/types.ts`      | No changes required                                                                                                                                                     |
| `src/app/PlaybackPhase.ts`    | Thread `LoadingShellHandle` into `playStream`; update fallback path to call `loading.update()`; remove `loading.close(); await loading.result` before `playStream` call |

---

## 5. Acceptance Criteria

- [ ] No double-stacked titles when transitioning from resolving → playing
- [ ] No terminal artifacts (ghost lines) between shell transitions
- [ ] `update()` works when called before `externalSetState` is set (guard with `?.`)
- [ ] `close()` in error paths (stream null, resolve throws) still properly unmounts
- [ ] Elapsed timer appears after 2+ seconds on "resolving" operations
- [ ] App header `🦊 KitsuneSnipe` visible in loading shell
- [ ] "playing" operation shows `▶` instead of spinner
- [ ] Typecheck passes: `bun run typecheck`
- [ ] Lint passes: `bun run lint`

---

## 6. Out of Scope

- Progress bar redesign (no change to existing logic)
- `openSearchShell`, `openPlaybackShell`, `openListShell` — not touched
- `usePulse`-based color interpolation — keep simple (threshold-based alternation is enough)
- Fullscreen layout / Pass B of persistent shell — tracked separately in `persistent-shell-implementation.md`
