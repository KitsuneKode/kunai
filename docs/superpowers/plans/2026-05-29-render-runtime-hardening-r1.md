# Render Runtime Hardening — Phase R1 (Alt-screen lifecycle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the rich shell into the alternate screen buffer and guarantee the terminal is restored (alt buffer left, cursor shown, images cleared) on EVERY teardown path — normal quit, Ctrl-C, SIGTERM/HUP, uncaught error — so quitting never pollutes scrollback or leaves a corrupted terminal.

**Architecture:** A pure `terminal-control.ts` (escape-sequence builders + an idempotent restorer factory, no IO) is unit-tested. A thin `terminal-runtime.ts` enters the alt buffer on shell start and registers the idempotent restorer on the graceful-exit handler chain and a synchronous `process.on("exit")` last resort. Guarded by `isTTY` + a zen opt-out.

**Tech Stack:** TypeScript, Bun, `bun:test`. Integrates with `app-shell/graceful-exit.ts` (`registerExitHandler`) and the Ink `render()` call sites in `app-shell/ink-shell.tsx`.

**Spec:** `docs/superpowers/specs/2026-05-29-render-runtime-hardening-design.md`

---

## Background the engineer needs

- Ink renders on the MAIN screen today (`ink-shell.tsx:268` `render(<RootShellHost/>)` and `:1164` `render(<AppRoot/>)`, both `exitOnCtrlC:false`). There is no alt-screen anywhere.
- `graceful-exit.ts` exposes `registerExitHandler(fn): () => void` and runs handlers on graceful exit. `main.ts:740-742` wires SIGINT/TERM/HUP; `:744/757` wire uncaught/rejection.
- Node fires `process.on("exit")` synchronously on any `process.exit()` and on normal termination — this is our guaranteed last-resort restore hook. Only synchronous work runs there; `process.stdout.write` of an escape string is synchronous on a TTY.
- Escape sequences: enter alt buffer `\x1b[?1049h`; leave `\x1b[?1049l`; show cursor `\x1b[?25h`; clear Kitty images `\x1b_Ga=d,d=A;\x1b\\` (matches `poster-renderer.ts:59`).
- Tests use `bun:test`. Run one file: `cd apps/cli && bun test test/unit/app-shell/render-runtime/terminal-control.test.ts`.
- Path alias `@/` = `apps/cli/src/`.

---

## File structure (Phase R1)

- Create `apps/cli/src/app-shell/render-runtime/terminal-control.ts` — pure sequences + restorer factory.
- Create `apps/cli/src/app-shell/render-runtime/terminal-runtime.ts` — enter + register-restore wiring (thin IO).
- Modify `apps/cli/src/app-shell/ink-shell.tsx` — call `enterRichRenderRuntime()` before the `render()` calls.
- Test `apps/cli/test/unit/app-shell/render-runtime/terminal-control.test.ts`.

---

## Task 1: Pure terminal-control (sequences + idempotent restorer)

**Files:**

- Create: `apps/cli/src/app-shell/render-runtime/terminal-control.ts`
- Test: `apps/cli/test/unit/app-shell/render-runtime/terminal-control.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";

import {
  ALT_SCREEN_ENTER,
  createTerminalRestorer,
  restoreTerminalSequence,
} from "@/app-shell/render-runtime/terminal-control";

test("enter sequence is the alternate-screen-buffer code", () => {
  expect(ALT_SCREEN_ENTER).toBe("\x1b[?1049h");
});

test("restore sequence clears images, leaves alt buffer, shows cursor (in that order)", () => {
  expect(restoreTerminalSequence()).toBe("\x1b_Ga=d,d=A;\x1b\\\x1b[?1049l\x1b[?25h");
});

test("restorer writes the restore sequence exactly once, then is a no-op", () => {
  const writes: string[] = [];
  const restorer = createTerminalRestorer((s) => writes.push(s));
  expect(restorer.restored()).toBe(false);

  restorer.restore();
  expect(restorer.restored()).toBe(true);
  expect(writes).toEqual([restoreTerminalSequence()]);

  restorer.restore(); // second call must not write again
  expect(writes).toEqual([restoreTerminalSequence()]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test test/unit/app-shell/render-runtime/terminal-control.test.ts`
Expected: FAIL — cannot resolve module `@/app-shell/render-runtime/terminal-control`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/cli/src/app-shell/render-runtime/terminal-control.ts

/** Enter the alternate screen buffer (vim/htop-style takeover). */
export const ALT_SCREEN_ENTER = "\x1b[?1049h";
/** Leave the alternate screen buffer, restoring prior main-screen scrollback. */
export const ALT_SCREEN_LEAVE = "\x1b[?1049l";
/** Show the cursor. */
export const CURSOR_SHOW = "\x1b[?25h";
/** Delete all Kitty graphics images so posters don't ghost after teardown. */
export const KITTY_CLEAR_ALL = "\x1b_Ga=d,d=A;\x1b\\";

/** One-shot restore string: clear images → leave alt buffer → show cursor. */
export function restoreTerminalSequence(): string {
  return `${KITTY_CLEAR_ALL}${ALT_SCREEN_LEAVE}${CURSOR_SHOW}`;
}

export interface TerminalRestorer {
  /** Write the restore sequence once; subsequent calls are no-ops. */
  restore(): void;
  restored(): boolean;
}

/**
 * Idempotent restorer. Many teardown paths (graceful exit, signals, uncaught,
 * process "exit") may all call restore(); only the first call writes.
 */
export function createTerminalRestorer(write: (sequence: string) => void): TerminalRestorer {
  let done = false;
  return {
    restore() {
      if (done) return;
      done = true;
      write(restoreTerminalSequence());
    },
    restored() {
      return done;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test test/unit/app-shell/render-runtime/terminal-control.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/render-runtime/terminal-control.ts apps/cli/test/unit/app-shell/render-runtime/terminal-control.test.ts
git commit -m "feat(render-runtime): pure terminal-control sequences + idempotent restorer"
```

---

## Task 2: terminal-runtime wiring (enter + guaranteed restore)

**Files:**

- Create: `apps/cli/src/app-shell/render-runtime/terminal-runtime.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (before the `render()` calls at `:268` and `:1164`)

- [ ] **Step 1: Write the runtime module**

```ts
// apps/cli/src/app-shell/render-runtime/terminal-runtime.ts
import { registerExitHandler } from "../graceful-exit";

import {
  ALT_SCREEN_ENTER,
  createTerminalRestorer,
  type TerminalRestorer,
} from "./terminal-control";

let started = false;
let restorer: TerminalRestorer | null = null;

/**
 * Enter the alternate screen for the rich shell and register an idempotent
 * terminal restorer on every teardown path. Safe to call multiple times.
 * No-op when not a TTY or when zen mode opts out (inline rendering).
 */
export function enterRichRenderRuntime(options: { zen?: boolean } = {}): void {
  if (started) return;
  if (options.zen === true) return;
  if (!process.stdout.isTTY) return;
  started = true;

  process.stdout.write(ALT_SCREEN_ENTER);
  restorer = createTerminalRestorer((sequence) => process.stdout.write(sequence));

  // Graceful path (also reached by main.ts signal shutdown via runExitHandlers).
  registerExitHandler(async () => {
    restorer?.restore();
  });
  // Synchronous last resort: fires on any process.exit() and normal termination,
  // covering uncaughtException/unhandledRejection paths too.
  process.on("exit", () => {
    restorer?.restore();
  });
}

/** Explicit restore (idempotent). For callers that tear down before process exit. */
export function restoreRichRenderRuntime(): void {
  restorer?.restore();
}
```

- [ ] **Step 2: Wire it into the shell mount**

In `apps/cli/src/app-shell/ink-shell.tsx`, add the import near the other app-shell imports:

```ts
import { enterRichRenderRuntime } from "./render-runtime/terminal-runtime";
```

Then call it on the line immediately before each `render(` call (`:268` and `:1164`):

```ts
enterRichRenderRuntime();
rootShellInk = render(/* …existing args unchanged… */);
```

(The function is idempotent, so calling it before both render sites is safe.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/render-runtime/terminal-runtime.ts apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat(render-runtime): enter alt-screen on shell start with guaranteed restore"
```

---

## Task 3: Phase gate + live verification

- [ ] **Step 1: Unit + static gates**

Run (repo root):

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

Expected: all PASS (the only new tests are Task 1's; nothing existing changes behavior in a way that alters other tests).

- [ ] **Step 2: Live — normal quit restores the terminal**

Run `bun run dev`, let the shell mount, then quit normally (the shell's quit key).
Expected: terminal returns to the **prior** prompt with your earlier scrollback intact (the shell frame is NOT left in history), cursor visible.

- [ ] **Step 3: Live — Ctrl-C and SIGTERM restore**

Run `bun run dev`, press Ctrl-C. Then run again and from another terminal `kill <pid>`.
Expected: both leave the terminal clean (back in main screen, cursor visible, no ghost posters).

- [ ] **Step 4: Live — scripted check that the leave sequence is emitted**

Run (repo root) — start the shell, send SIGINT, and confirm the alt-leave code is written:

```bash
script -qec 'bun run dev' /tmp/kunai-altscreen.log >/dev/null 2>&1 &
PID=$!; sleep 6; kill -INT $PID; sleep 2
grep -c $'\x1b\\[?1049l' /tmp/kunai-altscreen.log && echo "restore emitted"
```

Expected: a non-zero count and "restore emitted". (If `script` is unavailable, rely on Steps 2-3 visual confirmation.)

- [ ] **Step 5: Final commit (if lint/fmt adjusted anything)**

```bash
git add -A
git commit -m "chore(render-runtime): phase R1 verification" || echo "nothing to commit"
```

---

## Self-review notes (for the author)

- **Spec coverage:** R-1 alt-screen lifecycle → Tasks 1-2; guaranteed restore on all paths → Task 2 (graceful handler + `process.on("exit")` last resort) verified in Task 3. The zen opt-out is the `options.zen` param (wired to real config in Plan Z).
- **Out of scope (Phase R2):** resize repaint discipline, reserved-height (B8), ghost-image cleanup on surface-change/resize (A6 beyond teardown), loader cadence (A7), Ink incremental-render/version confirmation. Those touch surface components and the viewport hook and are their own plan.
- **Type consistency:** `ALT_SCREEN_ENTER` / `restoreTerminalSequence` / `createTerminalRestorer` / `TerminalRestorer` / `enterRichRenderRuntime` / `restoreRichRenderRuntime` names are used identically across module, test, and wiring.
- **Risk note:** `process.on("exit")` writing the escape is synchronous and TTY-safe; the restorer's idempotency prevents double-writes when multiple teardown paths fire.
