# State UX Contract

Every user-facing surface must have designed loading, success, empty, and error states. Generic fallback text is not acceptable for primary flows.

The goal is not to show more information. The goal is to keep the user oriented and give one good next action.

## Global State Rules

### Loading

Loading should be calm, stable, and specific.

- Keep the shell/header/footer stable.
- Show what is being loaded in plain language.
- Use subtle progress/dot/step indicators only when they clarify the wait.
- Avoid noisy bootstrap dashboards.
- Do not move the layout when loading completes.

Good:

```text
Resolving stream...
Searching TMDB...
Loading poster...
Fetching calendar...
```

Bad:

```text
Loading...
Please wait...
provider scrape resolve cache subtitle status startup wait...
```

### Success

Success should usually be quiet.

- Do not celebrate every normal state.
- Use mint only for meaningful ready/available/playable/complete states.
- Use rose for active focus, active progress, and expected-near-term states.
- Use crimson only for actionable failure.
- Prefer stable body updates over banners.
- Toasts are only for short-lived confirmations.

### Empty

Empty states should answer:

1. What is empty?
2. Why might it be empty?
3. What is the next best action?

Keep copy short. Do not teach the whole app.

### Error

Errors should be actionable and scoped.

Show:

- what failed
- whether user can retry
- one or two recovery actions
- diagnostics only as a secondary action

Do not show raw provider traces in normal UI.

## Playback Family

Surfaces:

- active playback
- post-playback
- playback issue
- tracks panel
- episode/season picker

### Loading

Active playback startup may show a compact trail:

```text
search -> scrape -> resolve -> play
```

After playback starts, compress or hide the trail. Active playback becomes the episode control surface.

### Empty

Examples:

- no next episode
- no track alternatives
- no subtitle choices exposed
- no watched progress

Empty should not open dead pickers. Show the fact and keep action available elsewhere.

### Error

Playback errors are first-class states:

- `Playback did not start`
- `Stream stalled`
- `No source available`
- `Quality variants unavailable`
- `Subtitles failed to attach`

Promote recovery actions only while relevant:

```text
[r] recover   [f] fallback   [≋ t] tracks   [/] commands
```

When healthy, keep recovery/fallback in commands.

## Search And Browse

### Loading

Keep the one-line query visible.

Use focused loading copy:

```text
Searching "The Boys"...
Loading poster...
Checking availability...
```

Provider availability may load lazily. Do not block result selection on poster or availability.

### Empty

Search empty:

```text
No results for "The Boys"
Try fewer words, switch mode, or open filters.
```

Filter empty:

```text
No results match this filter
Clear result filter or return to all results.
```

Continue watching empty:

```text
Nothing in progress
Search for a title or open trending.
```

### Error

Search errors should distinguish:

- metadata source failed
- provider availability failed
- poster failed
- partial results available

If partial results exist, show them and mark the degraded source quietly.

## Calendar Family

Calendar states must separate broadcast/release timing from provider availability.

- `available` means Kunai can reasonably open or resolve the episode now.
- `aired · resolving` means the episode has broadcast, but no playable provider result is ready yet.
- Countdown states should use relative time for same-day releases, such as `in 3h 20m`.
- Calendar should prioritize the return loop: tracked shows, saved titles, and `new since E#` context before generic releases.

Do not send users into a dead playback attempt from an `aired · resolving` row. Offer details, refresh, track/untrack, or wait-copy instead.

## Details Sheet

Details should be scrollable and resilient to missing metadata.

### Loading

- Reserve poster slot.
- Load text first.
- Poster/trailer/cast can fill in later.

### Empty/Missing Metadata

Dim missing optional fields:

```text
Trailer unavailable
Cast unavailable
Episode count unknown
```

Do not fail the entire details sheet for optional metadata.

## Calendar

### Loading

Keep tabs/day controls stable and show:

```text
Fetching releases for Today...
```

If cached data exists, show stale cache with a quiet refresh status.

### Empty

Calendar empty should be type/day-specific:

```text
No anime releases today
Try Tomorrow, This week, or All.
```

### Error

Calendar errors should distinguish:

- schedule source failed
- provider availability failed
- partial day data available

If schedule loads but availability does not, still show release rows.

## Recommendations

### Loading

Show the context:

```text
Finding picks after MARRIAGETOXIN...
```

Do not block PPS primary actions while recommendations load.

### Empty

```text
No recommendations yet
Watch more titles or search for something new.
```

### Error

If recommendation service fails, PPS should still be usable:

```text
Recommendations unavailable
Search, calendar, and history still work.
```

## Downloads / Library / History

These utility surfaces should be quieter and more operational.

- Empty states should point to the action that creates data.
- Errors should include a diagnostics path.
- Loading should preserve list/header/footer layout.

Examples:

```text
No downloads queued
Queue downloads from playback or details.

No watch history yet
Start watching and progress will appear here.
```

## Consistency Rules (Shell v4)

Every surface in Kunai uses the same four grammars. Do not invent surface-local loading spinners, custom error layouts, decorative empty footers, or ambiguous focus treatments.

### 1. One Loading Grammar

- **Header:** status switches to `◌ <verb>…` (never `● ready` while loading or resolving; never `● Searching…` once settled).
- **Body:** one `LoadingState` / `SakuraLoader` line (`❀ <Verb> <specific target>…`, static `❀` under reduced motion, `Loading: <Verb> <target>…` in `--plain`). Reserve the full content region height so completion never jumps layout.
- **Stage rail (multi-step waits only):** vertical checklist (`✓ done`, `◓ active`, `· pending`) strictly synced to the current headline — never show a stage rail behind the headline.
- **Plain / screen-reader quietness:** suppress 1-second elapsed ticks and polling redraws in `--plain`; emit milestone transitions only (start, 5s wait, 15s stall warning, settled) and never clear the full screen on keypress.
- **Escape hatch:** every cancellable load advertises `[esc] cancel` once in `ShellFooter` — never duplicated in the footer task line.

### 2. One Error Grammar

- **Static, never animated:** stop all spinners/blooms the instant an error renders.
- **Header:** status switches to `● issue` (or `● offline` when network is down) in `dangerText` / `warn` — never `● ready`.
- **Three-part body (`StateBlock kind="error"`):**
  1. **What happened:** `× <Plain-language failure>` in `dangerText` (`Error: <failure>` in `--plain`).
  2. **Why & what was preserved:** one muted line naming the cause and confirming safe state (e.g., `Progress saved at 14:22 · not marked watched`, or `Local library still works`). Never dump raw stack traces, tokens, or URLs.
  3. **The one next key:** one accented primary action row (`▌ ↵ <Safe recovery verb>`) matching the primary footer chip (e.g., `[r] retry`, `[r] recover`, `[o] switch source`). Diagnostics stay behind `[d]` — never primary.
- **Footer:** switches to recovery-only chips (`[r] retry`, `[esc] back`, `[/] commands`) — never leave stale browse or playback chips below an error.

### 3. One Empty-State Grammar

- **Two-part body (`StateBlock kind="empty"`):**
  1. **What is empty:** `· <Specific noun>` (`Empty: <Specific noun>` in `--plain`).
  2. **Why + the one next action:** one muted line naming the exact action that creates data (`Press /trending to browse popular titles`, `Enable downloads in Settings → Playback to save offline`).
- **No self-contradicting copy:** if actionable rows already exist on the screen (e.g., `For you now` on Browse home), do not render a competing `"empty for now"` / `"this one's bare"` mascot line above them.
- **Honest footer:** when a list has 0 rows, omit row-scoped verbs (`[enter] resume`, `[m] actions`, `[x] delete`, `[q] up next`, `[J/K] reorder`). Keep only live actions for the empty surface (e.g., `[tab] switch tab`, `[esc] back`, `[/] commands`).

### 4. One Focus-Owner Grammar

Exactly **one** region owns keyboard focus at any instant, and the terminal shows who owns it without making the user read the footer:

- **Text input focused:** rose `⌕` icon, rose underline/rule, visible block cursor (in `--plain`: `<Label> (focused): <value>` with explicit `(empty — placeholder: …)` so placeholders never read as typed text). Any visible list below drops its `▌` bar and dims.
- **List or action rows focused:** active row owns the leading `▌` bar at column 0 (never after an initials tile) plus `accentFill` band (`[selected]` plus a single `Focus: <region> (N of M)` line in `--plain`). Inactive inputs dim to `›` with a muted rule.
- **Home / Browse quick-pick handoff:** when Browse home has `For you now` rows and the query is empty, show a quiet `↓` affordance right on the `For you now` section header (`For you now  ·  ↓ to pick`) and let `↓` transfer the `▌` bar visibly onto row 1 while dimming the search bar — never leave the home row looking half-selected or unreachable.
- **Two-pane surfaces (Tracks, Settings, Calendar):** the focused pane owns `▌` + `accentFill`; the passive pane keeps a quiet `▸` / muted selection marker without a second `▌`. Always show the pane-switch key (`[←→] pane` or `[tab] section`) in `ShellFooter`.
- **Armed destructive confirmation (`ConfirmStrip`):** confirmation always takes focus in one fixed strip above the footer (`⚠ <Verb> <exact target>?`), switches `ShellFooter` exclusively to `[y] confirm <verb>` and `[esc] cancel`, and sits at the top of the Esc stack (`confirm` → `filter` → `submenu` → `overlay` → `surface`). No surface mixes double-press `x` with `y/Esc`.
