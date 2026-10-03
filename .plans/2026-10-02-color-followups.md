# Plan: Finish the color work (what the palette retune left open)

> **Drift check (run first):** `git grep -nE "palette\.(dim|muted).*dimColor|dimColor.*palette\.(dim|muted)" -- apps/cli/src | wc -l` counts the same-line cases, an upper bound on item 1 (57 when this plan was written; item 1 says which of them are not mechanical). `git grep -c dimColor` is a raw inventory, not remaining work. `bun run --cwd apps/cli test:file test/unit/app-shell/text-tier-contrast.test.ts` must stay green.

## Status

- **Status:** PROPOSED — one follow-up left (item 1). The retune and the status-text tokens have landed.
- **Priority:** P2
- **Effort:** S per item
- **Risk:** LOW (colors only), but item 1 touches files that open PRs also edit
- **Depends on:** the PR stacks landing for item 1 (see [2026-10-02-pr-stack-consolidation.md](./2026-10-02-pr-stack-consolidation.md))
- **Category:** UX / accessibility

## What is already done

- The text tiers were retuned by APCA, lightness only, hue and chroma held, to reach Lc 75, 60 and 45 on the canvas, the panel and the selection fill (`accentFill`, the ground every selected row, tab and picker option is painted on): `textDim` Lc 77, `muted` Lc 62, `dim` Lc 47 on the canvas (were 70, 41, 20; the old `dim` was Lc 18 on the selection fill). The 256-colour fallbacks meet the same targets. `apps/cli/test/unit/app-shell/text-tier-contrast.test.ts` enforces both levels and all three grounds.
- `danger` (Lc 46 on the canvas) and `milestone` (Lc 40) were too dark to read as text, against about 60 for `accent`, `warn` and `info`. Text now reads `dangerText` (`#ff9791`) and `milestoneText` (`#b2adf5`), the same hues lifted to Lc 60 on all three grounds. `danger` stays for the one border and the petal art, and `status-text-tokens.test.ts` keeps text from reading the vivid originals again. This plan first described these as badge text on `dangerFill` and `milestoneFill`; the CLI never draws that pairing (neither fill is read anywhere), so the figures that matter are the ones on the canvas.
- 17 redundant `dimColor` props (unconditional, same element as a `dim` or `muted` token) were removed in files no open PR touches.
- The docs site keeps its own palette copy; its `muted-foreground` intentionally stays put because `charts.css` reuses it as the chart residual de-emphasis gray.

## 1. Remove the remaining double-dimming

`<Text color={palette.dim} dimColor>` applies two mechanisms to one meaning: the token already encodes the tier, then the terminal's faint attribute dims it again. If a terminal renders faint at about 50% alpha (xterm.js does; others vary), `dim` + `dimColor` is Lc 15 and `muted` + `dimColor` is Lc 20, which cancels the retune.

On `main`, 89 lines use `dimColor` and 74 of them share a line with `palette.dim` or `palette.muted`. 17 are fixed, leaving 57 in 18 files:

- **46 in 13 files that open PRs also edit** (as of the 2026-10-02 PR snapshot): `loading-shell.tsx` (10, including the "Terminal or mpv — the keys above stay live" hint, the most visible one), `browse-shell.tsx` and `details-pane-ui.tsx` (6 each), `download-manager-shell.tsx` (5), `library-shell.tsx` and `shell-primitives.tsx` (4 each), and seven smaller files. These are the work for after those PRs land.
- **11 in files no open PR touches, none of them mechanical.** 4 are in `picker-overlay.tsx`, which the cleanup PR (#531) deletes. 3 are in `skeleton.tsx`, whose `SkeletonRows` has no production consumer. 4 set `dimColor={condition}` (`exit-shell.tsx`, `primitives/Switch.tsx`, `setup/SetupFrame.tsx`), which may be deliberate extra de-emphasis for an inactive state and needs a design decision, not a sweep.

Do the 46 after those PRs land, with the same mechanical rule: where the same element sets `color={palette.dim}` or `color={palette.muted}`, drop `dimColor`. Leave uses that set no token (they dim the default foreground) and judge multi-line and conditional cases by hand. Then re-record `apps/cli/test/vhs/ui-demo.tape` and regenerate `.reference/design/brand/demo-ui-walkthrough.*`.

## 2. Optional, low value

- Collapse near-duplicate neutrals only if a hairline ever needs to differ from a surface: `lineSoft` (L 0.257) and `surfaceElevated` (0.262); `line` (0.374) and `raised` (0.355).
- The canvas hue (333°) sits 21° off the rest of the neutral ramp (312°). Imperceptible at chroma 0.012, and `#100b0f` is pinned across docs, art and recordings. Not recommended.

## Acceptance

- The same-line grep in the drift check returns only cases a person judged deliberate (conditional or unrendered), not unconditional `color={palette.dim} dimColor` pairs.
- `text-tier-contrast.test.ts` stays green.
- The README demo and the launch ad are re-recorded from the final UI.
