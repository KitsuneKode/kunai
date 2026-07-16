# Notifications Inbox v2 — Design

**Status:** Approved  
**Date:** 2026-07-16  
**Surface:** Existing Notifications root overlay in `apps/cli/src/app-shell`

## Context

The 2026-07-16 handoff grouped Queue, Notifications, and Playlists under a broad “richer action UI” backlog. Current code has moved beyond that summary:

- Up Next already has a dedicated rich queue surface.
- Notifications already has Active/Archive tabs, pagination, read/archive/delete controls, and routed media actions.
- Durable Playlists still needs a separate first-class manager.

The smallest coherent unfinished slice is therefore a Notifications refinement: richer ordering, stronger selected-notice evidence, and visible safe actions. This design covers both Active and Archive. It does not change Watch History/New Episodes behavior.

## Goals

- Make urgent and actionable unread notices easy to find without losing chronological access.
- Present the selected notice’s evidence and available actions in a calm companion rail.
- Treat Active and Archive as two states of one coherent Notifications experience.
- Preserve playback-safe action routing and existing notification lifecycle commands.
- Reuse current shell primitives and extract only proven domain-neutral presentation logic.
- Keep behavior deterministic across sorting, pagination, actions, and terminal resizing.

## Non-goals

- Redesigning Up Next.
- Building the Durable Playlists manager.
- Changing Watch History or New Episodes behavior.
- Introducing a shared cross-domain “attention item” behavior model.
- Adding notification kinds, storage fields, migrations, provider calls, or availability checks.
- Performing a general `root-overlay-shell.tsx` decomposition.
- Persisting the selected sort mode across overlay sessions.

## Product decisions

- Active defaults to **Needs attention**.
- Sort selection is session-local: each tab retains its chosen mode until the overlay closes.
- Active defaults to Attention and cycles `Attention → Newest → Type`.
- Archive defaults to Newest and cycles `Newest → Type`.
- The approved wide layout is a list with a selected-notice companion rail.
- The rail is informational in v1; it is not a separately focused interaction pane.
- A successful primary action marks the notice read but leaves it Active.
- Archive remains explicit.
- Watch History remains behaviorally unchanged.

## Architecture and ownership

### Pure view model

Extend `apps/cli/src/app-shell/notifications-view.ts` as the projection boundary. It receives records and transient display state and returns everything the shell needs to render:

- ordered and paginated rows;
- kind label, glyph, tone, and unread/actionable state;
- selected-notice evidence;
- primary and secondary action presentation;
- sort and tab labels;
- empty-state copy;
- page metadata.

The builder remains deterministic and side-effect free. It may reuse action parsing from `notification-overlay-model.ts`; it must not execute actions or query storage.

### Presentational shell

`apps/cli/src/app-shell/notifications-shell.tsx` renders the view model:

- wide and suitable medium widths: list plus companion rail;
- narrow widths: list-only layout with the existing overflow action picker;
- distinct Active and Archive empty states;
- compact pagination and current-sort context.

The shell composes through existing shared primitives such as `MediaListShell`, `PreviewRail`, `ListRow`, `SectionGroup`, `StateBlock`, and `ActionList` where their current contracts fit. A new shared primitive is justified only if the approved rail cannot be expressed without duplicating domain-neutral presentation code.

### Input ownership

`apps/cli/src/app-shell/use-notifications-overlay-input.ts` owns notification-overlay interaction state and commands:

- tab switching;
- sort cycling;
- pagination and selection resets;
- mark-read, archive, delete, mark-all-read, and clear-archive commands;
- opening the complete action picker.

Notification-specific sort and presentation rules must not accumulate in `root-overlay-shell.tsx`. The root overlay continues to provide records, selected identity, action callbacks, and feedback orchestration.

### Action execution

The existing `NotificationActionRouter` and media-action routers remain the only execution path for playback, queue placement, download, follow state, Watchlist, Up Next, details, recovery, and dismissal. The view may describe those actions but must not duplicate their behavior.

## View model

### Sort modes

```ts
export type NotificationsSortMode = "attention" | "newest" | "type";
```

Archive never exposes `attention` because archived records no longer have a meaningful unread-attention hierarchy.

### Attention ordering

Active Attention order uses these tiers:

1. Unread records whose primary executable action is not `dismiss`.
2. Other unread records.
3. Read records.

Within each tier, sort by `updatedAt` descending and then `dedupKey` for deterministic ties. Old read records do not outrank newer read records merely because they still expose an action.

### Newest ordering

Sort by `updatedAt` descending and then `dedupKey`.

### Type ordering

Group current and future kinds into a stable semantic sequence:

1. **Recovery and failures:** `queue-recovery`, `download-failed`.
2. **New releases:** `new-episode`.
3. **Updates:** `app-update`.
4. **Completed work:** `download-complete`.
5. **Other:** unknown or future kinds.

Within a group, sort by `updatedAt` descending and then `dedupKey`.

### Row model

Each visible row contains enough information to render without reparsing records:

- `dedupKey`;
- notification kind, label, glyph, and tone;
- title and body;
- unread and actionable flags;
- primary-action label;
- poster URL when valid and useful;
- relative time.

Unread state must use both text/glyph and color. Unknown kinds use the existing generic label/glyph path.

### Companion rail model

The selected-notice rail contains:

- kind/tone and unread state;
- full title and body;
- relative time;
- poster or text fallback;
- parsed media evidence when present;
- prominent primary-action label and key;
- compact secondary-action labels;
- lifecycle-command hints.

Malformed or absent `itemJson` produces text-only evidence. It never throws or blocks rendering.

## Interaction contract

| Input     | Behavior                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `↑` / `↓` | Move selection within visible rows.                                                                       |
| `Enter`   | Execute the selected notice’s primary action.                                                             |
| `a`       | Open the existing complete action picker.                                                                 |
| `s`       | Cycle the current tab’s session-local sort mode and reset page/selection.                                 |
| `Tab`     | Switch Active/Archive, retain the destination tab’s current session-local sort, and reset page/selection. |
| `[` / `]` | Move between pages and reset selection to the first visible row.                                          |
| `r`       | Mark the selected notice read.                                                                            |
| `x`       | Archive the selected notice.                                                                              |
| `d`       | Delete the selected notice.                                                                               |
| `A`       | Mark all notices read.                                                                                    |
| `C`       | Clear archived notices.                                                                                   |
| `Esc`     | Close the current picker or Notifications overlay through existing routing.                               |

The approved mock’s temporary `d Details` example is not part of the key contract. `d` remains Delete. Details remains available through the primary or complete action list when supported by the record.

The companion rail is not independently focusable in this version. Secondary actions remain discoverable through `a`, avoiding another keyboard mode and reducing root-input regression risk.

## Action lifecycle

1. Resolve the selected record by `dedupKey`.
2. Execute the chosen action through the existing router.
3. Complete any existing confirmation flow before treating the action as successful.
4. On successful non-lifecycle action execution, mark the notice read and refresh the view.
5. Keep the notice in Active until the user explicitly archives it.
6. On cancellation or failure, leave read/archive state unchanged and report feedback through the current overlay status path.
7. Archive, delete, and dismiss retain their existing explicit lifecycle semantics.
8. Preserve selection by `dedupKey` when the result set remains compatible. If the record leaves the current result set, select the nearest surviving row.

Archived notices may retain executable media actions. Successful execution does not move them out of Archive.

## Responsive layout

Use the shared shell’s existing collapse policy instead of adding a Notifications-only breakpoint.

### Wide

- List on the left.
- Selected-notice companion rail on the right.
- Poster/evidence, primary action, and compact secondary actions remain visible.

### Medium

- Keep the rail only while the shared layout can preserve useful row-title width.
- Do not squeeze the primary list to retain decorative evidence.

### Narrow

- Collapse the rail first.
- Preserve the list, unread/actionable state, current sort, primary-action hint, pagination, and `a` action picker.
- Keep long text on one truncated line rather than reflowing the layout.

Poster degradation follows the established image → initials tile → hidden sequence. Color always has a glyph or word equivalent.

## Footer and context

The surface should show the current tab and sort without repeating them in multiple regions. The footer teaches only the most relevant live actions, for example:

```text
enter act · a actions · s sort · tab archive · [/] commands
```

Less frequent destructive commands remain available through the existing command/help surface rather than crowding every frame.

## Surface states

The implementation owns and tests:

- Active with an actionable unread selection.
- Active with a read selection.
- Archive with a selected notice.
- Empty Active: “You’re all caught up.”
- Empty Archive: “No archived notifications.”
- Multiple pages.
- Unknown/future notification kind.
- Malformed or absent `itemJson`.
- No executable action except `dismiss`.
- Playback-active confirmation.
- Action success, cancellation, and failure.
- Selection removal after archive/delete.
- Narrow, medium, and wide terminal widths.

## Failure handling

- Malformed item metadata degrades to text-only evidence.
- Unknown kinds use generic presentation and remain actionable when their stored action list is valid.
- If an action becomes unavailable between projection and execution, show router feedback and preserve notification lifecycle state.
- Failed or cancelled actions never mark a notice read automatically.
- Sorting and rendering perform no storage writes.
- Opening or using Notifications while mpv is active must not interrupt playback or leave terminal input in an inconsistent state.

## Testing

### Pure view-model tests

Extend `apps/cli/test/unit/app-shell/notifications-view.test.ts` with:

- exact Attention, Newest, and Type ordering;
- deterministic tie-breaking;
- allowed sort modes by tab;
- sorting before pagination;
- actionability derived from executable actions;
- read, kind, tone, evidence, unknown-kind, and malformed-JSON projections;
- selected-rail projection.

### Shell render tests

Extend `apps/cli/test/unit/app-shell/notifications-shell.test.tsx` using the local render-capture harness at 72, 100, and 140 columns. Cover:

- wide split-rail layout;
- narrow rail collapse;
- Active, Archive, empty, paginated, long-title, and degraded-metadata states;
- no duplicated instructions between rail and footer.

Do not add `ink-testing-library`.

### Input tests

Extend `apps/cli/test/unit/app-shell/use-notifications-overlay-input.test.ts` with:

- sort cycling and reset behavior;
- tab-specific default modes on open and per-tab sort retention while the overlay remains open;
- preserved behavior for `r`, `x`, `d`, `A`, `C`, `a`, `[`, and `]`;
- stable action targeting after sorting.

### Action-flow tests

Cover orchestration around the existing router:

- successful primary action marks read and keeps the notice Active;
- failed or cancelled action does not mark read;
- confirmation-sensitive playback marks read only after confirmed success;
- archive/delete selects the nearest surviving row.

Existing `notification-overlay-model` and `NotificationActionRouter` tests remain the action parsing and execution contract.

### Manual terminal smoke

With mpv playback active:

1. Open Notifications without interrupting playback.
2. Navigate Active and Archive.
3. Cycle every allowed sort mode.
4. Execute a safe non-playback action.
5. Exercise a confirmation-sensitive playback action without accidental takeover.
6. Archive and delete rows and verify stable selection.
7. Confirm terminal input, redraw, and playback remain healthy.

## Rollout

Implement as one bounded Notifications slice with no storage migration. Run focused unit/render tests, then repository `typecheck`, `lint`, `fmt`, relevant tests, and `build`. Attribute any dependency-related gate failures to the pre-existing package-manifest/lockfile changes rather than modifying those unrelated files inside this slice.

After the inbox contract is proven, a separate design may evaluate reusing any genuinely domain-neutral rail primitive in Watch History/New Episodes. Durable Playlists remains the next independent rich-manager surface.
