# Sakura S1 — Agent Briefs (consumer migration)

Three agents migrate deprecated color-named `palette.*` call sites to the semantic Sakura names. File ownership is disjoint (shared chrome has a single owner), so all three run safely in the same working tree on branch `design/sakura-rollout`.

Read alongside [.docs/design-system.md](../.docs/design-system.md) and [.plans/sakura-rollout.md](sakura-rollout.md).

## Hard rules for ALL agents

- Edit **only** the files in your list. Do not open another agent's files.
- **Never** edit `packages/design/src/tokens.ts` or `apps/cli/src/app-shell/shell-theme.ts` (shared; alias removal is the verifier's final step).
- Do **not** run `bun run fmt` or `bun run lint` (they write / race across the shared tree). Do **not** `git commit`, `git stash`, or switch branches.
- Self-check with `bun run typecheck` only (read-only, safe to run concurrently).
- When done, report: files touched, and **every** `teal`/`cyan`/`info`/`pink`/`yellow` decision you made (which semantic you chose + why), plus any titles you de-colored.

## Mapping cheat-sheet (deprecated → semantic)

| deprecated                             | use                                            | notes                                                                                                                      |
| -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `amber`                                | `accent`                                       | primary action / focus / selection                                                                                         |
| `amberSoft` / `amberDim` / `amberFill` | `accentSoft` / `accentDim` / `accentFill`      |                                                                                                                            |
| `teal` / `cyan`                        | `accent` **or** `muted`                        | `accent` if it's a cursor/caret/active marker/focus; `muted` if it's an info label/status text. Unsure → `muted` (recede). |
| `green` / `greenDim` / `greenFill`     | `ok` / `okDim` / `okFill`                      | ready · complete · available                                                                                               |
| `red` / `redFill`                      | `danger` / `dangerFill`                        | pair with a glyph (`✗`)                                                                                                    |
| `info` / `infoDim` / `infoFill`        | `muted` / `dim` / `surfaceElevated`            | blue retired                                                                                                               |
| `lavender` / `lavenderFill`            | `muted` / `surfaceElevated`                    | recommendations are neutral rows                                                                                           |
| `yellow` / `yellowFill`                | `accentDeep` / `accentFill`                    | caution — prefer a glyph (`△`) + text over color                                                                           |
| `pink` / `pinkFill`                    | `typeAnime` (Stats only) / `accentFill`        | outside Stats: remove the hue → `text`/`muted`                                                                             |
| `purple` / `purpleDim` / `purpleFill`  | `milestone` / `milestoneDim` / `milestoneFill` | series-complete **only**                                                                                                   |
| `gray`                                 | `dim`                                          |                                                                                                                            |
| `borderStrong`                         | `lineStrong`                                   | `tealFill` → `okFill`                                                                                                      |

## THE ONE RULE (apply while migrating)

- Color = state or focus, never identity. A **title** that was colored (e.g. amber/teal) becomes `palette.text` **bold**, not `accent`.
- Provider, audio language, episode code, recency → `muted`. Never a hue.
- Media-type hue (`typeAnime/Series/Movie`, `contentTintColor`) only inside the **Stats** surface.
- Selection = `accent` left rule (`▌`) + `accentFill` band. Ready dot = `ok`; failure = `danger` + glyph.
- If migrating a file that has a pinned-hex or pinned-deprecated-name test, update that test to the semantic palette name.

## Done criteria (per agent)

1. `grep -nE "palette\.(amber|amberSoft|amberDim|pink|teal|cyan|info|infoDim|lavender|green|red|gray|yellow|purple|amberFill|tealFill|infoFill|pinkFill|lavenderFill|greenFill|yellowFill|redFill|purpleFill|borderStrong)" <your files>` returns **nothing**.
2. `bun run typecheck` passes.
3. You did not touch any file outside your list, `tokens.ts`, or `shell-theme.ts`.

---

## Agent A — core primitives + playback

You own the shared chrome; B and C depend on it but will not edit it.

```
apps/cli/src/app-shell/shell-primitives.tsx
apps/cli/src/app-shell/shell-frame.tsx
apps/cli/src/app-shell/primitives/AppHeader.tsx
apps/cli/src/app-shell/primitives/SegmentedControl.tsx
apps/cli/src/app-shell/primitives/ProgressBar.tsx
apps/cli/src/app-shell/primitives/InsightLine.tsx
apps/cli/src/app-shell/ink-shell.tsx
apps/cli/src/app-shell/loading-shell.tsx
apps/cli/src/app-shell/post-play-shell.tsx
apps/cli/src/app-shell/dot-matrix-loader.tsx
apps/cli/src/app-shell/exit-shell.tsx
```

Also update `apps/cli/test/unit/app-shell/selectable-row.test.ts` to the semantic names if you change `selectableRowStyle` (it currently asserts `palette.amberSoft`/`amberFill`).

## Agent B — overlays / discovery / pickers

You own the overlay + picker chrome.

```
apps/cli/src/app-shell/overlay-panel.tsx
apps/cli/src/app-shell/overlay-picker-row.tsx
apps/cli/src/app-shell/picker-overlay.tsx
apps/cli/src/app-shell/root-overlay-shell.tsx
apps/cli/src/app-shell/discover-shell.tsx
apps/cli/src/app-shell/shell-command-ui.tsx
apps/cli/src/app-shell/calendar-ui.tsx
apps/cli/src/app-shell/details-pane-ui.tsx
```

## Agent C — memory surfaces (setup / library / downloads / status)

You own the poster-initial block.

```
apps/cli/src/app-shell/setup-shell.tsx
apps/cli/src/app-shell/library-shell.tsx
apps/cli/src/app-shell/download-manager-shell.tsx
apps/cli/src/app-shell/root-status-shells.tsx
apps/cli/src/app-shell/checklist-shell.tsx
apps/cli/src/app-shell/poster-initial-block.tsx
```

---

## Verifier (Claude, after agents report)

1. Per agent: run the grep above on their files → must be empty. Read the diff; sanity-check `teal`/`info`/`pink`/`yellow` choices and any title de-coloring; confirm no out-of-scope edits and no edits to `tokens.ts`/`shell-theme.ts`.
2. Full gate: `bun run typecheck && bun run lint && bun run test && bun run build`.
3. When all three pass: delete the deprecated alias blocks from `tokens.ts` and the deprecated entries from `shell-theme.ts`'s `palette`; grep the whole `apps/cli/src/app-shell` for any remaining deprecated name (→ 0); re-run the full gate.
4. Manual sanity in a narrow / non-truecolor terminal (`bun run dev`), then commit the integrated migration + alias removal.
