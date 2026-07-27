# History Actions and Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user download a title straight from history, by making history a first-class title-control surface — and retire the duplicate, never-called action policy that currently claims to own that responsibility.

**Architecture:** The repo has two action-policy modules. `title-control-actions.ts` is the real one, driving every menu through per-surface allow-lists, but its `TitleControlSurface` union has no `"history"`. `media-action-policy.ts` has a `"history"` surface and a `download` action, and its `getMediaActions` is called from **nothing but its own test**. Rather than wiring the dead module, history is added to the live one — the superset menu already renders `download`, and the `MediaActionRouter` already executes it.

**Tech Stack:** Bun, TypeScript, React/Ink, `bun:test`.

## Global Constraints

- Runtime is Bun. Use `bun`, `bunx`, `bun run` — never `npm`, `npx`, `node`, `yarn`, or `pnpm`.
- Run the full suite with `bun run test` from the repo root, never bare `bun test`.
- The repo forbids non-null assertions (`no-non-null-assertion`).
- **Do not rewrite the title-control menu.** It is already the superset of the older per-surface menus; the work is adding a surface to it, not building a parallel one.
- Downloads stay gated on the existing `downloadsEnabled` capability. A user with downloads off must see no download action anywhere, history included.
- `download` on an unwatched-but-known title must not silently resolve a provider without the existing confirmation — `MediaActionRouter` already throws `"download requires provider resolution confirmation"`; preserve that path.
- Before finishing: `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run fmt`.
- Related: `.docs/download-offline-onboarding.md`, `.plans/download-offline-onboarding.md`.

## Executor Protocol

### Working directory

```bash
cd "$(git rev-parse --show-toplevel)" && <your command>
```

### The red phase is mandatory

Write test → **run it and watch it fail** → implement → run it and watch it pass → commit.

### Do not repair collateral damage

If a **pre-existing** test fails, stop and report file, line, and assertion.

### Commit discipline

One commit per task, staging only that task's **Files**. **Never `git add -A`.**

## File Structure

| File                                                            | Responsibility                                | Change                      |
| --------------------------------------------------------------- | --------------------------------------------- | --------------------------- |
| `apps/cli/src/app-shell/title-control/title-control-actions.ts` | Add `"history"` surface + its allow-list.     | Modify (~line 4, ~line 498) |
| `apps/cli/src/app-shell/use-history-overlay-input.ts`           | Open the title-control menu from history.     | Modify                      |
| `apps/cli/src/domain/media/media-action-policy.ts`              | Delete the dead policy, keep `MediaActionId`. | Modify                      |
| `apps/cli/test/unit/domain/media/media-action-policy.test.ts`   | Drop tests for the deleted function.          | Modify                      |

---

### Task 1: Make history a title-control surface

`TitleControlSurface` is `"browse" | "library" | "loading" | "playing" | "post-play"`. History is absent, so opening a menu over a history row has no action set to draw from — which is why download-from-history does not exist.

**Files:**

- Modify: `apps/cli/src/app-shell/title-control/title-control-actions.ts:4` and the surface allow-list map (~line 498)
- Test: `apps/cli/test/unit/app-shell/title-control-history-surface.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `TitleControlSurface` gains `"history"`. Task 2 passes it.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/title-control-history-surface.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { buildTitleControlActions } from "@/app-shell/title-control/title-control-actions";

function actionIds(context: Record<string, unknown>): string[] {
  return buildTitleControlActions(context as never).map((action) => action.id);
}

describe("history title-control surface", () => {
  test("offers download when downloads are enabled", () => {
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: true,
    });
    expect(ids).toContain("download");
  });

  test("hides download when downloads are disabled", () => {
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: false,
    });
    expect(ids).not.toContain("download");
  });

  test("offers resuming and episode selection, since history rows are resumable", () => {
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      titleType: "series",
      downloadsEnabled: true,
    });
    expect(ids).toContain("resume");
    expect(ids).toContain("pick-episode");
  });

  test("does not offer playback-only controls", () => {
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: true,
    });
    // Nothing is playing when you are looking at history.
    expect(ids).not.toContain("stop");
    expect(ids).not.toContain("quality");
    expect(ids).not.toContain("cancel");
  });
});
```

If `buildTitleControlActions` is not the exported builder's name, use the actual exported name from `title-control-actions.ts` and keep the assertions identical. Report the difference in your task report.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/title-control-history-surface.test.ts
```

Expected: FAIL — `"history"` is not assignable to `TitleControlSurface`, so the surface has no allow-list and no actions come back.

- [ ] **Step 3: Write minimal implementation**

In `apps/cli/src/app-shell/title-control/title-control-actions.ts`, extend the union at line 4:

```ts
export type TitleControlSurface =
  "browse" | "library" | "loading" | "playing" | "post-play" | "history";
```

Then add a `history` entry to the surface allow-list map, beside `library`:

```ts
  // History rows are resumable catalog entries, not live playback, so this
  // mirrors `library` rather than `playing`: no stop/quality/cancel, but full
  // resume, episode selection, and download.
  history: [
    "play",
    "resume",
    "pick-episode",
    "switch-provider",
    "download",
    "mark-watched",
    "mark-unwatched",
    "share",
    "purge-title-cache",
    "forget-title-provider-preference",
    "diagnostics",
  ],
```

The list is an allow-list — an action omitted here is filtered out before its `when()` predicate ever runs, so anything a user should be able to do from history must appear.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/title-control-history-surface.test.ts
cd "$(git rev-parse --show-toplevel)" && bun run typecheck
```

Expected: PASS, 4 tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/app-shell/title-control/title-control-actions.ts apps/cli/test/unit/app-shell/title-control-history-surface.test.ts
git commit -m "feat(history): add history as a title-control surface with download"
```

---

### Task 2: Open the menu from a history row

The surface exists but nothing opens it from history.

**Files:**

- Modify: `apps/cli/src/app-shell/use-history-overlay-input.ts`
- Test: `apps/cli/test/unit/app-shell/history-overlay-menu-key.test.ts`

**Interfaces:**

- Consumes: `TitleControlSurface` `"history"` from Task 1; `openTitleControlMenu` from `@/app-shell/title-control/open-title-control-menu`.
- Produces: `m` over a history row opens the title-control menu for that row's title.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/history-overlay-menu-key.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { resolveHistoryOverlayKey } from "@/app-shell/use-history-overlay-input";

describe("history overlay key routing", () => {
  test("m opens the title control menu for the selected row", () => {
    expect(resolveHistoryOverlayKey("m", { hasSelection: true })).toBe("open-title-menu");
  });

  test("m does nothing with no row selected", () => {
    expect(resolveHistoryOverlayKey("m", { hasSelection: false })).toBe("ignore");
  });

  test("enter still resumes rather than opening the menu", () => {
    expect(resolveHistoryOverlayKey("\r", { hasSelection: true })).not.toBe("open-title-menu");
  });
});
```

If `use-history-overlay-input.ts` has no pure key-routing export, add `resolveHistoryOverlayKey` as one and route the hook's existing `m` handling through it. Extracting the decision is what makes it testable without mounting Ink; do not test through a rendered component.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/history-overlay-menu-key.test.ts
```

Expected: FAIL — `resolveHistoryOverlayKey` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add the pure router to `apps/cli/src/app-shell/use-history-overlay-input.ts`:

```ts
export type HistoryOverlayKeyOutcome = "open-title-menu" | "ignore" | "unhandled";

/**
 * Pure key routing for the history overlay, extracted so the decision can be
 * tested without mounting Ink.
 */
export function resolveHistoryOverlayKey(
  key: string,
  state: { readonly hasSelection: boolean },
): HistoryOverlayKeyOutcome {
  if (key === "m") {
    return state.hasSelection ? "open-title-menu" : "ignore";
  }
  return "unhandled";
}
```

Then, in the hook's key handler, call it and open the menu on `"open-title-menu"`, passing `surface: "history"` and the selected row's title. Follow the existing call shape used by the browse and library surfaces — do not invent a new one.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/history-overlay-menu-key.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Verify by hand**

Run `bun run dev`, open history, select a row, press `m`. The menu must appear with a Download entry. Choosing it must enqueue a download, not throw.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/app-shell/use-history-overlay-input.ts apps/cli/test/unit/app-shell/history-overlay-menu-key.test.ts
git commit -m "feat(history): open the title control menu from a history row"
```

---

### Task 3: Delete the duplicate action policy

`media-action-policy.ts` exports `getMediaActions`, a second per-surface action policy with its own `MediaActionSurface` union. It is called from **no production code** — only its own test. Two policies deciding the same thing is precisely the duplication `CLAUDE.md` names as a design smell, and keeping a dead one invites someone to wire the wrong one later.

`MediaActionId` from that file **is** used — by `MediaActionRouter`, `NotificationActionRouter`, and `keybinding-runtime.ts`. Keep the type, delete the policy.

**Files:**

- Modify: `apps/cli/src/domain/media/media-action-policy.ts`
- Modify: `apps/cli/test/unit/domain/media/media-action-policy.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MediaActionId`, `MediaAction` remain exported. `getMediaActions`, `MediaActionPolicyInput`, and `MediaActionSurface` are removed.

- [ ] **Step 1: Confirm it is genuinely unused**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -rn "getMediaActions\|MediaActionSurface\|MediaActionPolicyInput" --include="*.ts" --include="*.tsx" apps packages | grep -v "domain/media/media-action-policy.ts" | grep -v "test/"
```

Expected: **no output**. If anything is printed, **stop and report it** — the deletion is not safe and this task needs rethinking.

- [ ] **Step 2: Delete the dead policy**

In `apps/cli/src/domain/media/media-action-policy.ts`, remove `MediaActionSurface`, `MediaActionPolicyInput`, and the entire `getMediaActions` function. Keep `MediaActionId` and `MediaAction`, and add a short note at the top of the file:

```ts
/**
 * Shared media action vocabulary.
 *
 * This file deliberately holds **only** the action id and shape. Deciding
 * which actions a surface offers lives in
 * `app-shell/title-control/title-control-actions.ts`, which is the single
 * policy the UI actually runs. A second per-surface policy previously lived
 * here and was never called; it was removed rather than wired, so there is
 * one place to change when a surface gains an action.
 */
```

- [ ] **Step 3: Trim the test file**

In `apps/cli/test/unit/domain/media/media-action-policy.test.ts`, delete every test that calls `getMediaActions`. If nothing remains, delete the file:

```bash
cd "$(git rev-parse --show-toplevel)"
git rm apps/cli/test/unit/domain/media/media-action-policy.test.ts
```

- [ ] **Step 4: Verify**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run typecheck && bun run test
```

Expected: typecheck clean, full suite green. A typecheck error here means step 1's grep missed a usage — restore the function and report.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/domain/media/media-action-policy.ts apps/cli/test/unit/domain/media/media-action-policy.test.ts
git commit -m "refactor(media): remove the never-called duplicate action policy"
```

---

### Task 4: Document the single action policy

**Files:**

- Modify: `.docs/ux-architecture.md`

- [ ] **Step 1: Update the doc**

Add to the section covering shell menus:

```markdown
### Title control is the one action policy

`app-shell/title-control/title-control-actions.ts` is the single source of
truth for which actions a surface offers. Surfaces are `browse`, `library`,
`loading`, `playing`, `post-play`, and `history`. The per-surface lists are
**allow-lists**: an action omitted from a surface is filtered out before its
`when()` predicate runs, so adding an action to a surface means adding it to
that surface's list.

`domain/media/media-action-policy.ts` holds only the `MediaActionId`
vocabulary shared with `MediaActionRouter`. It does not decide what a surface
offers; a second policy that did was removed after it was found to have no
callers.
```

- [ ] **Step 2: Verify and format**

```bash
cd "$(git rev-parse --show-toplevel)"
bun run typecheck && bun run lint && bun run test && bun run fmt
```

- [ ] **Step 3: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add .docs/ux-architecture.md
git commit -m "docs(ux): record title control as the single action policy"
```

---

## Verification

Complete when all of the following hold:

- `bun run typecheck`, `bun run lint`, `bun run test` pass from the repo root.
- Pressing `m` on a history row opens the title-control menu.
- That menu offers Download when downloads are enabled, and omits it when disabled.
- Choosing Download from history enqueues a job rather than throwing.
- History does not offer `stop`, `quality`, or `cancel`.
- `grep -rn "getMediaActions" apps packages` returns nothing.

## Out of scope

- Download quality selection and the download sheet — see `.plans/download-offline-onboarding.md`
- Offline playback pipeline unification
- Adding `notification`, `recommendation`, `search`, `playlist`, or `queue` as title-control surfaces — each needs its own allow-list decision, and none is required for download-from-history
