# Plan 059: Verify the npm-channel update-notify path end to end

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/services/update/notification-update-action.ts apps/cli/src/services/update/upgrade-planner.ts apps/cli/src/services/update/install-method.ts apps/cli/src/main.ts`
> Mismatch → re-read the notify chain; this plan is a verification, not a rewrite.

Closes #121.

## Status

- **Priority:** P3
- **Effort:** S
- **Risk:** LOW — verification + at most a small fix
- **Depends on:** none
- **Category:** tests / verification
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

#93 added `not-applicable` so a package-managed install pressing "update now"
hears the real upgrade command instead of "Update did not apply (disabled)".
Every link is unit-tested, but nobody has watched an actual npm install notice
a release and offer `npm i -g …`. This plan is that watch — the point is to
catch the gap between unit tests and the real journey, if one exists.

## Current state (the chain under test)

1. `main.ts` routes non-binary channels to `updateService.checkForUpdate()`,
   which respects `updateChecksEnabled` and `updateCheckIntervalDays` (7).
2. The check records an `app-update` notification signal.
3. `resolveNotificationUpdateAction`
   (`services/update/notification-update-action.ts`) routes by channel via
   `planUpgrade` (`upgrade-planner.ts`): binary → `self-update`;
   package-managed → `run-command` with the exact `npm i -g`/`bun add -g` line;
   unresolvable → `open-release-page`. Verified reading the file — the routing
   exists and is channel-correct on paper.
4. `install-method.ts` decides the channel — the thing unit tests stub and
   reality may disagree with.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Install-method detection unit tests | `bun run --cwd apps/cli test:file test/unit/services/update/` | pass |
| Real install | `npm i -g @kitsunekode/kunai@<previous-version>` | lands on PATH |
| Isolation | run with `storageRootEnv`-style env (sandboxed HOME/XDG) — never your live profile | config under sandbox |

## Steps

### Step 1: Static trace — walk the chain once, dry

Read each hop and confirm the data flows: does `checkForUpdate` produce a
notification that reaches the inbox action? Does `install-method` classify an
npm-global install as the package-managed channel (find its detection order —
PATH sniffing, install-manifest presence, npm root prefix)? Any hop where a
unit test stubs what reality provides differently is the suspect. Write the
trace into the PR body.

### Step 2: Real-machine pass

1. `npm i -g @kitsunekode/kunai@<one-version-back>` in a sandboxed env.
2. Run `kunai` → let the update check fire (or force the cadence: find how
   `updateCheckIntervalDays` is stored — a config/state field you can set to
   make it check immediately; never fake network).
3. Confirm: a notification appears; its action names `npm i -g @kitsunekode/kunai`
   (or the bun equivalent per detected channel) — not "Update did not apply",
   not a self-update attempt.
4. Press/invoke the action and confirm the command shown is copyable-correct.

### Step 3: Fix only if a gap appears

Expected finding classes: detection misclassifies the channel; the
notification is recorded but the inbox action never resolves it; the command
string is wrong for the detected manager. Fix the actual gap — small, at the
failing seam — not a rewrite. If the chain works end-to-end, the deliverable
is the recorded trace + a checklist comment on #121.

## Test plan

- This is a verification plan: the "test" is the real-machine pass in Step 2.
- If a gap is found and fixed: add the unit test that would have caught it
  (the seam that disagreed with reality gets a contract test).

## Done criteria

- [ ] The full journey observed on a real npm install, or a named gap with its fix
- [ ] Outcome recorded as a comment/referenceable note on #121
- [ ] If code changed: `bun run test --force` + `typecheck --force` green

## STOP conditions

- No way to force the update check without waiting 7 days or mocking time —
  report; the check-cadence seam may itself be the bug (untestable cadence).
- The npm package can't be installed in this environment (no registry access)
  — document the static trace, flag the live pass as the remaining step, and
  close the plan PARTIAL rather than fabricating the verification.

## Maintenance notes

- Keep auto-apply binary-only — the reasoning lives in
  `notification-update-action.ts`; this plan is notify-path trust, not
  extending self-update to package managers.
