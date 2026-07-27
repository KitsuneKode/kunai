# Diagnostics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the diagnostics overlay from a flat scrolling list into a dashboard that groups by what the user must act on, distinguishes "unknown" from "broken", and uses the whole terminal instead of a picker-sized box.

**Architecture:** The panel is currently `ShellPanelLine[]` — a flat array where section headings are themselves rows (`{ label: "─── Verdict" }`). That is why it cannot lay out: there is no group to lay out. This plan introduces a real `DiagnosticsSection` model, groups rows by actionability rather than by subsystem, and sizes the panel from the terminal rather than from `listMaxVisible`, which is a list-picker policy.

**Tech Stack:** Bun, TypeScript, React/Ink, `bun:test`.

## Observed problems

From a live capture of the overlay at 1900×1018:

| Problem                             | Evidence                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Panel uses ~40% of available height | `18/49 lines` shown with the lower ~60% of the terminal blank                                                 |
| Discord rendered three times        | header line, `Verdict` row, and `Discord` row, same text                                                      |
| Two competing footers               | `↑/↓ scroll · Space toggle span · e export · Esc closes` **and** `[e] export bundle [esc] close [/] commands` |
| Unknown reads as broken             | `Provider — Unknown · no resolve telemetry yet` sits in the same visual channel as a real Discord failure     |
| No actionable grouping              | 13 flat label/value rows under two pseudo-headings                                                            |
| Truncation artifact                 | `Rivestream · …healthy · 31h ago`                                                                             |

## Global Constraints

- Runtime is Bun. Use `bun`, `bunx`, `bun run` — never `npm`, `npx`, `node`, `yarn`, or `pnpm`.
- Run the full suite with `bun run test` from the repo root, never bare `bun test`.
- The repo forbids non-null assertions (`no-non-null-assertion`).
- **Use design tokens.** No raw hex or ad-hoc ANSI. Follow `.docs/design-system.md`; the Ember Dusk palette is the current authority.
- **Unknown is not a fault.** A subsystem with no data yet must be visually distinct from a failing one. This is the whole point of the redesign and is non-negotiable.
- The panel must degrade on small terminals rather than clipping content — `ViewportResizeGate` already exists for this.
- Export must stay reachable by a single key from the dashboard.
- Do not change what diagnostics _collect_. This plan is presentation only; `runtime-health.ts` and `diagnostics-insight.ts` keep their contracts.
- Before finishing: `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run fmt`.

**Prerequisite:** `2026-07-28-resolve-telemetry-spine.md` must be complete. The Provider row currently reads "no resolve telemetry yet" — redesigning a panel around a permanently empty field would design for a bug.

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

| File                                                         | Responsibility                                   | Change                    |
| ------------------------------------------------------------ | ------------------------------------------------ | ------------------------- |
| `apps/cli/src/app-shell/diagnostics-dashboard-model.ts`      | Group rows into sections by actionability. Pure. | **Create**                |
| `apps/cli/src/app-shell/diagnostics-panel-lines.ts`          | Build sections instead of a flat list.           | Modify                    |
| `apps/cli/src/app-shell/components/DiagnosticsDashboard.tsx` | Render sections full-height.                     | **Create**                |
| `apps/cli/src/app-shell/root-overlay-shell.tsx`              | Mount the dashboard; drop the duplicate footer.  | Modify (~line 903, ~2232) |

The model is pure and separate from the renderer because grouping and severity precedence are the things worth testing, and they must not require mounting Ink to verify.

---

### Task 1: Group diagnostics by what the user must act on

Rows are currently grouped by subsystem, so a healthy subsystem, an unknown one, and a broken one all look alike and sit interleaved. Grouping by actionability puts the one thing that needs attention first and collapses the rest.

**Files:**

- Create: `apps/cli/src/app-shell/diagnostics-dashboard-model.ts`
- Test: `apps/cli/test/unit/app-shell/diagnostics-dashboard-model.test.ts`

**Interfaces:**

- Consumes: `DiagnosticsHealthRow` from `@/services/diagnostics/runtime-health`.
- Produces:
  - `type DiagnosticsSectionId = "attention" | "unknown" | "ok"`
  - `interface DiagnosticsSection { id; title; rows; }`
  - `buildDiagnosticsSections(rows): readonly DiagnosticsSection[]`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/diagnostics-dashboard-model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { buildDiagnosticsSections } from "@/app-shell/diagnostics-dashboard-model";

function row(subsystem: string, status: string, detail = "") {
  return { subsystem, status, detail } as never;
}

describe("buildDiagnosticsSections", () => {
  test("separates unknown from broken", () => {
    const sections = buildDiagnosticsSections([
      row("discord", "needs-attention", "Could not connect"),
      row("provider", "unknown", "no resolve telemetry yet"),
      row("cache", "ok", "No cache issue"),
    ]);

    const byId = Object.fromEntries(sections.map((s) => [s.id, s.rows.map((r) => r.subsystem)]));
    // Unknown must never sit in the same bucket as a real fault — that is the
    // entire point of the grouping.
    expect(byId.attention).toEqual(["discord"]);
    expect(byId.unknown).toEqual(["provider"]);
    expect(byId.ok).toEqual(["cache"]);
  });

  test("attention comes first, ok last", () => {
    const sections = buildDiagnosticsSections([
      row("cache", "ok"),
      row("provider", "unknown"),
      row("discord", "needs-attention"),
    ]);
    expect(sections.map((s) => s.id)).toEqual(["attention", "unknown", "ok"]);
  });

  test("empty sections are omitted entirely", () => {
    const sections = buildDiagnosticsSections([row("cache", "ok"), row("memory", "ok")]);
    expect(sections.map((s) => s.id)).toEqual(["ok"]);
  });

  test("everything healthy still returns a section rather than nothing", () => {
    const sections = buildDiagnosticsSections([row("cache", "ok")]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.rows).toHaveLength(1);
  });

  test("no rows yields no sections", () => {
    expect(buildDiagnosticsSections([])).toEqual([]);
  });

  test("row order within a section is preserved", () => {
    const sections = buildDiagnosticsSections([row("b", "ok"), row("a", "ok"), row("c", "ok")]);
    expect(sections[0]?.rows.map((r) => r.subsystem)).toEqual(["b", "a", "c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/diagnostics-dashboard-model.test.ts
```

Expected: FAIL — `Cannot find module '@/app-shell/diagnostics-dashboard-model'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/app-shell/diagnostics-dashboard-model.ts`:

```ts
import type { DiagnosticsHealthRow } from "@/services/diagnostics/runtime-health";

export type DiagnosticsSectionId = "attention" | "unknown" | "ok";

export interface DiagnosticsSection {
  readonly id: DiagnosticsSectionId;
  readonly title: string;
  readonly rows: readonly DiagnosticsHealthRow[];
}

const SECTION_TITLES: Record<DiagnosticsSectionId, string> = {
  attention: "Needs attention",
  unknown: "Not measured yet",
  ok: "Healthy",
};

/** Rendering order. Whatever the user must act on comes first. */
const SECTION_ORDER: readonly DiagnosticsSectionId[] = ["attention", "unknown", "ok"];

function sectionFor(row: DiagnosticsHealthRow): DiagnosticsSectionId {
  const status = String(row.status);
  if (status === "ok" || status === "healthy") return "ok";
  if (status === "unknown") return "unknown";
  return "attention";
}

/**
 * Group health rows by what the user must do about them.
 *
 * Grouping by subsystem — the previous shape — put a broken integration, a
 * subsystem with no data yet, and a perfectly healthy one in the same visual
 * channel, so nothing stood out and "Unknown" read as a fault. Actionability
 * is the axis that matters when someone opens diagnostics.
 *
 * Empty sections are omitted so a healthy session shows one short block rather
 * than three headings and a lot of nothing.
 */
export function buildDiagnosticsSections(
  rows: readonly DiagnosticsHealthRow[],
): readonly DiagnosticsSection[] {
  const grouped = new Map<DiagnosticsSectionId, DiagnosticsHealthRow[]>();
  for (const row of rows) {
    const id = sectionFor(row);
    const bucket = grouped.get(id);
    if (bucket) bucket.push(row);
    else grouped.set(id, [row]);
  }

  return SECTION_ORDER.flatMap((id) => {
    const sectionRows = grouped.get(id);
    if (!sectionRows || sectionRows.length === 0) return [];
    return [{ id, title: SECTION_TITLES[id], rows: sectionRows }];
  });
}
```

If `DiagnosticsHealthRow.status` uses a different vocabulary than `ok` / `unknown` / `needs-attention`, read the actual union from `runtime-health.ts` and map every member explicitly — do not leave a member unhandled.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/diagnostics-dashboard-model.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/app-shell/diagnostics-dashboard-model.ts apps/cli/test/unit/app-shell/diagnostics-dashboard-model.test.ts
git commit -m "feat(diagnostics): group health rows by actionability"
```

---

### Task 2: Stop repeating the same fault three times

Discord's failure appears in the header line, the Verdict row, and its own Health row — identical text, three times, in a panel already short on space.

**Files:**

- Modify: `apps/cli/src/app-shell/diagnostics-panel-lines.ts` (~line 38-56)
- Test: `apps/cli/test/unit/app-shell/diagnostics-panel-dedupe.test.ts`

**Interfaces:**

- Consumes: `buildDiagnosticsSections` from Task 1.
- Produces: `shouldRenderVerdictRow(verdict, rows): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/diagnostics-panel-dedupe.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { shouldRenderVerdictRow } from "@/app-shell/diagnostics-panel-lines";

describe("verdict deduplication", () => {
  test("hides the verdict when a health row already says the same thing", () => {
    expect(
      shouldRenderVerdictRow(
        { label: "discord", detail: "Could not connect to Discord IPC" } as never,
        [{ subsystem: "discord", detail: "Could not connect to Discord IPC" }] as never,
      ),
    ).toBe(false);
  });

  test("shows the verdict when it summarises more than one subsystem", () => {
    expect(
      shouldRenderVerdictRow(
        { label: "2 issues", detail: "discord, release sync" } as never,
        [
          { subsystem: "discord", detail: "Could not connect" },
          { subsystem: "release", detail: "35 with errors" },
        ] as never,
      ),
    ).toBe(true);
  });

  test("shows the verdict when no health row covers it", () => {
    expect(
      shouldRenderVerdictRow(
        { label: "startup", detail: "Slow startup" } as never,
        [{ subsystem: "cache", detail: "fine" }] as never,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/diagnostics-panel-dedupe.test.ts
```

Expected: FAIL — `shouldRenderVerdictRow` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `apps/cli/src/app-shell/diagnostics-panel-lines.ts`:

```ts
/**
 * Whether the Verdict row adds anything beyond the health rows below it.
 *
 * When exactly one subsystem is unhealthy, the verdict is that subsystem's
 * message repeated — and it was previously rendered a third time in the
 * overlay header, so a single Discord failure filled three lines of a panel
 * that only had room for eighteen.
 */
export function shouldRenderVerdictRow(
  verdict: { readonly label: string; readonly detail: string },
  rows: readonly { readonly subsystem: string; readonly detail: string }[],
): boolean {
  const covering = rows.filter((row) => row.detail && verdict.detail.includes(row.detail));
  return covering.length !== 1;
}
```

Then gate the existing Verdict row on it, keeping the `─── Verdict` heading only when the row renders.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/diagnostics-panel-dedupe.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/app-shell/diagnostics-panel-lines.ts apps/cli/test/unit/app-shell/diagnostics-panel-dedupe.test.ts
git commit -m "fix(diagnostics): stop rendering the same fault three times"
```

---

### Task 3: Size the dashboard from the terminal

`maxLines` comes from `overlayLayout.listMaxVisible` (`root-overlay-shell.tsx:903`) — a **list-picker** sizing policy. A dashboard inherits it and scrolls inside a small box while most of the terminal is blank.

**Files:**

- Create: `apps/cli/src/app-shell/components/DiagnosticsDashboard.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (~line 903, ~2232-2256)
- Test: `apps/cli/test/unit/app-shell/diagnostics-dashboard-layout.test.ts`

**Interfaces:**

- Consumes: `DiagnosticsSection` from Task 1.
- Produces: `diagnosticsVisibleRows(input): number`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/diagnostics-dashboard-layout.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { diagnosticsVisibleRows } from "@/app-shell/components/DiagnosticsDashboard";

describe("diagnosticsVisibleRows", () => {
  test("uses the terminal height, not a picker budget", () => {
    // 49 rows of content in a 60-row terminal must not scroll at 18.
    const visible = diagnosticsVisibleRows({ contentRows: 60, chromeRows: 6, sectionCount: 3 });
    expect(visible).toBeGreaterThan(40);
  });

  test("reserves room for chrome and section headings", () => {
    const visible = diagnosticsVisibleRows({ contentRows: 60, chromeRows: 6, sectionCount: 3 });
    expect(visible).toBeLessThanOrEqual(60 - 6 - 3);
  });

  test("stays positive on a very small terminal", () => {
    expect(
      diagnosticsVisibleRows({ contentRows: 8, chromeRows: 6, sectionCount: 3 }),
    ).toBeGreaterThanOrEqual(1);
  });

  test("more sections mean fewer content rows", () => {
    const few = diagnosticsVisibleRows({ contentRows: 40, chromeRows: 4, sectionCount: 1 });
    const many = diagnosticsVisibleRows({ contentRows: 40, chromeRows: 4, sectionCount: 3 });
    expect(many).toBeLessThan(few);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/diagnostics-dashboard-layout.test.ts
```

Expected: FAIL — `Cannot find module '@/app-shell/components/DiagnosticsDashboard'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/app-shell/components/DiagnosticsDashboard.tsx` exporting the pure sizing helper plus the renderer:

```tsx
/**
 * How many content rows the dashboard may draw.
 *
 * Deliberately derived from the overlay's own height rather than
 * `listMaxVisible`, which is a list-picker budget — inheriting it made the
 * panel scroll at 18 of 49 rows while most of the terminal sat empty.
 */
export function diagnosticsVisibleRows(input: {
  readonly contentRows: number;
  readonly chromeRows: number;
  readonly sectionCount: number;
}): number {
  const available = input.contentRows - input.chromeRows - input.sectionCount;
  return Math.max(1, available);
}
```

Render each `DiagnosticsSection` as a heading followed by its rows, using existing design tokens for tone. Give the `unknown` section a visibly quieter treatment than `attention` — that visual difference is the requirement, not decoration.

In `root-overlay-shell.tsx`, mount `DiagnosticsDashboard` for the diagnostics overlay and size it with `diagnosticsVisibleRows` instead of `maxLines`. Leave every other overlay on `listMaxVisible`.

- [ ] **Step 4: Remove the duplicate footer**

The overlay renders two footers. Keep the one carrying the keybindings (`[e] export bundle [esc] close [/] commands`) and delete the other (`↑/↓ scroll · Space toggle span · e export · Esc closes`), folding any hint it had that the survivor lacks into the survivor.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app-shell/diagnostics-dashboard-layout.test.ts
cd "$(git rev-parse --show-toplevel)" && bun run test
```

Expected: PASS, 4 tests, full suite green.

- [ ] **Step 6: Verify by hand**

Run `bun run dev`, press `d`. Confirm: content fills the terminal, sections are ordered attention → unknown → healthy, unknown rows are visibly quieter than faults, one footer, Discord appears once, and `e` still exports.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/app-shell/components/DiagnosticsDashboard.tsx apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/test/unit/app-shell/diagnostics-dashboard-layout.test.ts
git commit -m "feat(diagnostics): lay the panel out as a full-height dashboard"
```

---

### Task 4: Document the dashboard contract

**Files:**

- Modify: `.docs/diagnostics-guide.md`

- [ ] **Step 1: Update the doc**

```markdown
### Dashboard layout

The diagnostics overlay groups health rows by **actionability**, not by
subsystem: `Needs attention`, then `Not measured yet`, then `Healthy`. Empty
groups are omitted.

"Not measured yet" is a deliberately separate group. A subsystem with no data
is not a fault, and rendering the two alike made every fresh session look
broken. Anything added to the health model must land in exactly one group.

The panel sizes itself from the overlay height, not from `listMaxVisible` —
that is a list-picker budget and made the dashboard scroll inside a small box
while the terminal sat mostly empty.
```

- [ ] **Step 2: Verify and format**

```bash
cd "$(git rev-parse --show-toplevel)"
bun run typecheck && bun run lint && bun run test && bun run fmt
```

- [ ] **Step 3: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add .docs/diagnostics-guide.md
git commit -m "docs(diagnostics): describe the dashboard grouping contract"
```

---

## Verification

Complete when all of the following hold:

- `bun run typecheck`, `bun run lint`, `bun run test` pass from the repo root.
- The panel fills the available terminal height; no large blank region below it.
- Sections render attention → unknown → healthy, and empty groups are absent.
- An unknown subsystem is visually distinct from a failing one.
- A single failing subsystem is named once, not three times.
- Exactly one footer renders.
- `e` still exports a bundle and reports its path.

## Out of scope

- Changing what diagnostics collect — presentation only
- A separate export format or destination
- Charts, sparklines, or history-over-time views
- Reworking the memory-trend sampler
