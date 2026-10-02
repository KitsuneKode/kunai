# Plan: Finish the color work (what the palette retune left open)

> **Drift check (run first):** `git grep -c "dimColor" -- apps/cli/src` and `bun run --cwd apps/cli test:file test/unit/app-shell/text-tier-contrast.test.ts` — the first count is the work left in item 1, the second must stay green.

## Status

- **Status:** PROPOSED — follow-ups only. The retune itself is done in the working copy.
- **Priority:** P2
- **Effort:** S per item
- **Risk:** LOW (colors only), but item 1 touches files that open PRs also edit
- **Depends on:** the PR stacks landing for item 1 (see [2026-10-02-pr-stack-consolidation.md](./2026-10-02-pr-stack-consolidation.md))
- **Category:** UX / accessibility

## What is already done

- The text tiers were retuned by APCA, lightness only, hue and chroma held: `textDim` Lc 76, `muted` Lc 61, `dim` Lc 46 (were 70, 41, 20; the old `dim` was Lc 15 on the selected row). The 256-colour fallbacks meet the same targets. `apps/cli/test/unit/app-shell/text-tier-contrast.test.ts` enforces both.
- 17 redundant `dimColor` props were removed in files no open PR touches.
- The docs site keeps its own palette copy; its `muted-foreground` intentionally stays put because `charts.css` reuses it as the chart residual de-emphasis gray.

## 1. Remove the remaining double-dimming

`<Text color={palette.dim} dimColor>` applies two mechanisms to one meaning: the token already encodes the tier, then the terminal's faint attribute dims it again. If a terminal renders faint at about 50% alpha (xterm.js does; others vary), `dim` + `dimColor` is Lc 15 and `muted` + `dimColor` is Lc 20, which cancels the retune.

Of 84 `dimColor` uses, 68 share a line with a `dim` or `muted` token. 17 are fixed; the rest are in 13 files that open PRs also edit, including `loading-shell.tsx` (the "Terminal or mpv — the keys above stay live" and "? for all keys" hint lines are the most visible example) and `playback-keys-panel.ts`.

Do it after those PRs land, with the same mechanical rule: where the same element sets `color={palette.dim}` or `color={palette.muted}`, drop `dimColor`. Leave uses that set no token (they dim the default foreground) and judge multi-line cases by hand. Then re-record `apps/cli/test/vhs/ui-demo.tape` and regenerate `.reference/design/brand/demo-ui-walkthrough.*`.

## 2. Role tokens for status text on a tinted fill

Measured as badge text on its own fill: `danger` on `dangerFill` is Lc 44 and `milestone` on `milestoneFill` is Lc 39 (WCAG 5.5 and 5.1, so the usual check passes). The others are Lc 57–66. Lifting `danger` itself would repaint the alarm red everywhere it is a fill or icon. Add `dangerText` and `milestoneText` role tokens, lightness lifted only, and point status badges at them. A lightness-only lift to Lc 60 gives about `#ff9892` and `#b1abff`; remeasure after choosing.

## 3. Optional, low value

- Collapse near-duplicate neutrals only if a hairline ever needs to differ from a surface: `lineSoft` (L 0.257) and `surfaceElevated` (0.262); `line` (0.374) and `raised` (0.355).
- The canvas hue (333°) sits 21° off the rest of the neutral ramp (312°). Imperceptible at chroma 0.012, and `#100b0f` is pinned across docs, art and recordings. Not recommended.

## Acceptance

- `git grep "dimColor" -- apps/cli/src` shows no use that shares an element with a `dim` or `muted` token.
- `text-tier-contrast.test.ts` stays green.
- The README demo and the launch ad are re-recorded from the final UI.
