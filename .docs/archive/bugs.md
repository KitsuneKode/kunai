# Bug Fixes

## Ink Shell stdin Race (Fixed 2026-04-21)

### Symptom

After completing search and selecting a title, the app exits immediately without
showing the episode picker or entering playback. The flow jumps from search
directly to exit.

### Root Cause

Ink calls `stdin.unref()` when a shell component unmounts, which lets the Node
event loop drain. The next shell's `useInput` effect is supposed to re-ref
`stdin` on mount, but there's a race window:

1. Shell A calls `ink.unmount()` → Ink calls `stdin.unref()`
2. Event loop begins draining (no more refs keeping it alive)
3. Shell B's `open*Shell()` is called (but Promise executor runs async)
4. Shell B's `render()` → `useInput` registers and tries to re-ref
5. But event loop already exited → `waitUntilExit()` resolves immediately

The fix in `ink-shell.tsx` moved `stdin.ref()` from inside the Promise executor
to synchronous code **before** the Promise is created.

### Affected Functions

- `openShell()` (HomeShell, PlaybackShell)
- `openSearchShell()`
- `openListShell()`

### Files Changed

- `src/app-shell/ink-shell.tsx`

## Async Finish Function with Void Call (Fixed 2026-04-21)

### Symptom

Shells that prompt for selection (search results, episode pickers) immediately
return with `null` as if cancelled, even when user makes a selection.

### Root Cause

The `finish` function was made async with `await ink.waitUntilExit()` but
called using `void` which discards the Promise:

```typescript
// Broken code:
async function finish(value: T | null) {
  settled = true;
  ink.unmount();
  await ink.waitUntilExit();  // ← Never completes because void discards Promise
  resolve(value);
}

onSubmit={(value) => void finish(value)}  // ← Promise discarded!
```

Since `finish` was async and called with `void`:

1. User presses Enter → creates Promise for finish() → Promise is discarded
2. finish() tries to run but Promise chain is lost
3. `settled` never becomes true
4. `waitUntilExit().then()` fallback fires and resolves `null`

### Fix

Remove the `async` keyword and `await` from `finish`, resolve synchronously:

```typescript
// Fixed:
function finish(value: T | null) {
  settled = true;
  ink.unmount();
  resolve(value);
}

onSubmit={(value) => finish(value)}  // ← Direct call
```

### Affected Functions

- `openShell()` - HomeShell/PlaybackShell callbacks
- `openSearchShell()` - search input callbacks
- `openListShell()` - list selection callbacks

### Files Changed

- `src/app-shell/ink-shell.tsx` (3 functions, 4 callback sites)
