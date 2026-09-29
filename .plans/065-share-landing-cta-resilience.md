# Plan 065: Share landing — the primary CTA fails silently for the exact audience it serves

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- "apps/docs/app/w/[code]/page.tsx" apps/docs/components/ lib/share-presentation.ts apps/docs/lib/install-commands.ts`
> Mismatch → re-read `ValidShareLanding` before proceeding.

Found while sweeping `apps/docs` for interaction gaps after plan 064.

## Status

- **Priority:** P2
- **Effort:** S
- **Risk:** LOW — presentational; adds a client island to a static page
- **Depends on:** none
- **Category:** UX / share surface
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`/w/<code>` exists to convert a shared link into a running Kunai client. Its
primary action is a bare `kunai://` href:

```tsx
// apps/docs/app/w/[code]/page.tsx:103
<a className="kunai-button kunai-button-primary mt-8 w-full sm:w-auto" href={appUrl}>
  {action === "download" ? "Open download in Kunai" : "Open in Kunai"}
</a>
```

`kunai://` resolves only when the protocol handler is registered — which is
precisely what a *new* recipient does not have. For them the click is a dead
control: no error, no toast, no state change. The install commands are already
on the page, but nothing connects "I clicked" to "it didn't work → install
below". The page knows this audience exists — the "New to Kunai?" section is
right there — and still leaves the failure silent.

Two honest fixes, neither of which pretends to detect protocol registration
(there is no reliable API for that — `navigator.registerProtocolHandler`
support cannot be probed, and `blur`-after-navigation heuristics false-positive
on every successful handoff):

1. **Post-click state.** After the CTA is activated, reveal a small line:
   "Opening Kunai… If nothing happened, install it below — then come back and
   click again." Persistent, not a toast that vanishes.
2. **A copyable deep link.** The `appUrl` is never shown or copyable on the
   page. With no handler, the recipient cannot even send the link to their
   desktop machine. A `CopyButton` next to a collapsed/mono `kunai://…` row is
   the zero-assumption fallback — the same pattern the install commands already
   use two sections down.

## Current state

- `app/w/[code]/page.tsx` is fully server-rendered; `CopyButton` is already a
  client component used on this page for install commands.
- `appUrl = encodePlaybackTargetRef(ref, action)` (:44) — the deep link is
  computed but only ever bound to the anchor.
- `robots: noindex` is already set (:30) — exposing the raw link in the DOM adds
  no indexable surface.
- The invalid-link path (`InvalidShareLanding`) is already honest; the valid
  path is the gap.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `bun run --cwd apps/docs test` | all pass |
| Docs build | `bun run --cwd apps/docs build` | exits 0 |
| Full gates | `bun run typecheck --force && bun run test --force` | exit 0 |

## Scope

**In scope:**
- `apps/docs/app/w/[code]/page.tsx`
- A new small client component (e.g. `components/share/open-in-kunai.tsx`) for
  the click-state — the page itself stays server-rendered

**Out of scope:**
- Protocol-handler detection claims — there is no honest API; the copy says
  "if nothing happened", never "we detected it's missing".
- Changing the share grammar or `encodePlaybackTargetRef`.
- The CLI side of the handoff (`--handoff-url` already confirms before acting).

## Steps

### Step 1: Client CTA with post-click reveal

Replace the bare `<a>` with a client component wrapping it: on click, set
`clicked` → render the helper line under the button (and keep the link
re-clickable — returning users re-fire the handler). Copy must not promise the
app opened; it says the browser *tried* to open Kunai.

```tsx
{clicked ? (
  <p className="text-sm text-[var(--color-fd-muted-foreground)]">
    Nothing opened? Install Kunai below, then click again — the link carries
    the title, so it will still work.
  </p>
) : null}
```

### Step 2: Copyable deep link

Under the CTA (or beside it on wide layouts), a muted row:
`kunai://…` truncated mono text + `CopyButton` labelled `share-deep-link`.
Keep it visually secondary — it is the fallback, not the action.

### Step 3: Test + build

New render test asserting: helper line is absent before click, present after;
the deep-link copy target carries the exact `appUrl`.

## Test plan

- New (`share-landing.test.tsx` exists — extend it): valid code renders the
  CTA with the `kunai:` href; post-click helper appears; `CopyButton` text
  equals `encodePlaybackTargetRef(ref, action)`.
- Regression: `InvalidShareLanding` unchanged.

## Done criteria

- [ ] Clicking the CTA reveals persistent "install below" guidance
- [ ] The raw `kunai://` link is copyable from the page
- [ ] No detection claims in copy; JS-off still shows the working href +
  install commands (the SSR anchor stays a real link)
- [ ] `bun run --cwd apps/docs test` exits 0

## STOP conditions

- The page became a client component or was redesigned — re-derive, the gap is
  "no post-click affordance", not these line numbers.
- `encodePlaybackTargetRef` output shape changed — re-check what the copy row
  shows (never display a malformed link as confident text).

## Maintenance notes

- If the CLI ever gains a download-free web fallback, this page is where the
  "open in browser" option would slot in — the copy is written so it degrades
  rather than lies.
