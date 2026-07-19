# Track C — Local Observability, Support Bundles, and Opt-In Telemetry

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** make a user's problem reproducible on someone else's machine, and learn
how many people actually use Kunai — without collecting anything that could
identify a person or what they watch.

**Non-negotiable posture.** Kunai is a streaming tool. Its users have a
reasonable expectation that it does not phone home about what they watch. Every
decision here resolves in favour of the user:

- Diagnostics are **local by default**. Nothing leaves the machine except through
  an action the user explicitly takes.
- Telemetry is **opt-in**. A fresh install sends nothing, ever, until the user
  says yes.
- **No title, query, provider result, URL, or file path is ever transmitted.**
- The install id is a random UUID. Never derived from hostname, MAC, IP,
  username, or any hardware value.

If a step here conflicts with that posture, the posture wins — stop and report.

**Tech stack:** Bun 1.3.x, TypeScript, React/Ink, bun:sqlite, Bun test.

## Global constraints

- Do not use a worktree.
- Branch from current `main` (2026-07-19 or later); diagnostics and playback
  churned heavily that day.
- No live network call in the default test path.
- Keep app-shell/container dependencies out of diagnostics services.
- Keep SQL in `packages/storage`.
- Run with `bun` / `bun run`.

---

## Slice 1 — Structured diagnostics panel

Today the panel is a flat text list. It answers "what happened" but not "what
broke", and unrelated events interleave so a single failed playback is hard to
follow.

### Files

- Modify `apps/cli/src/app-shell/diagnostics-panel-source.ts`: group events by
  `correlation.playbackCycleId` / `traceId` into spans; derive a headline.
- Create `apps/cli/src/app-shell/diagnostics-panel.model.ts`: pure view model —
  span tree, per-span worst severity, headline, and counts. No Ink imports.
- Modify the diagnostics overlay renderer: collapsible spans, severity colour
  from the existing palette, newest span expanded by default.
- Create `apps/cli/test/unit/app-shell/diagnostics-panel-model.test.ts`.

### Steps

- [ ] **Step 1 (test first):** given a mixed event list from two playback cycles,
      the model produces two spans, each with its own worst-severity and a
      headline naming the failure class — not the raw operation string.
- [ ] **Step 2:** implement the model as a pure function. Keep it out of the
      keyboard hot path: memoize on a diagnostics revision, exactly as the
      notification overlay does, or navigation will stutter (see the calendar
      regression of 2026-06-16).
- [ ] **Step 3:** render spans with the design-system palette; obey the 4-colour
      discipline in `.docs/design-system.md`.
- [ ] **Step 4:** headline copy comes from `operation-taxonomy.ts`, so a new
      operation gets a human summary automatically rather than a raw id.

**Acceptance:** open diagnostics after a failed playback; the first line names
what broke and the failing span is expanded. Arrow keys stay responsive.

## Slice 2 — Redacted support bundle

This is the cross-machine reproduction story. No server involved.

### Files

- Modify `apps/cli/src/services/diagnostics/DiagnosticsBundleBuilder.ts`: add
  redaction + a size budget.
- Create `apps/cli/src/services/diagnostics/bundle-redaction.ts`: pure redactors.
- Create `apps/cli/test/unit/services/diagnostics/bundle-redaction.test.ts`.
- Modify the diagnostics overlay: a key that writes the bundle and shows its path.

### Steps

- [ ] **Step 1 (test first):** redaction removes absolute home paths (`/home/x`,
      `/Users/x` → `~`), query strings and auth tokens from any URL, and the
      username from process/env strings. Assert on a fixture containing all three.
- [ ] **Step 2:** bundle contents — Kunai version, OS/arch, Bun version, mpv
      version, terminal name, enabled providers, the last N diagnostic events
      (redacted), runtime health, and DB schema versions. **Never** history rows,
      titles, queries, or stream URLs.
- [ ] **Step 3:** cap the bundle (default 256 KB) by dropping oldest events, and
      say so in the file when truncation happens.
- [ ] **Step 4:** write to a path the user can see and open; print it. Do not
      auto-upload, and do not offer to.
- [ ] **Step 5:** add `--support-bundle` to the CLI so a user who cannot reach
      the overlay can still produce one.

**Acceptance:** generate a bundle from a shadow XDG profile with real history
present; grep it for the profile's username, a watched title, and a stream host —
all three must be absent.

## Slice 3 — Reproduction container

Answers "can we reproduce this on a small machine".

### Files

- Create `apps/cli/test/docker/repro/Dockerfile`: minimal Alpine + Bun + mpv.
- Create `apps/cli/test/docker/repro/run-repro.sh`: mount a support bundle, boot
  the musl binary against a throwaway XDG profile.
- Modify `.docs/diagnostics-guide.md`: document the flow.

### Steps

- [ ] **Step 1:** image installs only what playback needs; assert the built image
      is under ~200 MB.
- [ ] **Step 2:** the script accepts a bundle path and pre-seeds the container's
      config from its (redacted) settings so a reporter's configuration is
      reproduced without their data.
- [ ] **Step 3:** document that this is for maintainers reproducing an issue, not
      a shipped feature.

**Acceptance:** take a bundle produced on the host, run the container, and reach
the same startup state.

## Slice 4 — Opt-in telemetry

Do this slice last. It must not begin until Slices 1–3 are merged, so no
half-built consent path can ever send anything.

### Files

- Create `apps/cli/src/services/telemetry/TelemetryService.ts`.
- Create `apps/cli/src/services/telemetry/install-id.ts`: random UUID, persisted.
- Modify `ConfigService`: `telemetry: "unset" | "enabled" | "disabled"`.
- Modify onboarding/setup: the consent prompt.
- Create tests under `apps/cli/test/unit/services/telemetry/`.
- Modify `.docs/experience-overview.md` + README: state the policy publicly.

### Steps

- [ ] **Step 1 (test first):** with `telemetry: "unset"` the service performs
      **zero** network calls. Assert by injecting a fetch that fails the test if
      called. This is the most important test in the track.
- [ ] **Step 2:** install id is `crypto.randomUUID()` stored in config. Add a test
      asserting it does **not** match hostname, username, or any MAC-shaped value.
- [ ] **Step 3:** payload is exactly `{ installId, version, os, arch, ts }`.
      Snapshot it; the test fails if a field is ever added. That snapshot is the
      contract with users.
- [ ] **Step 4:** at most one ping per 24h, fire-and-forget, short timeout, never
      blocking startup or playback, silent on failure.
- [ ] **Step 5:** consent prompt states what is sent, that it is optional, and how
      to change it. Default on decline/timeout/non-TTY/CI is **disabled**.
      Honour `DO_NOT_TRACK=1` and `CI=true` as automatic declines.
- [ ] **Step 6:** `/telemetry` shows current status and toggles it. `/telemetry
    show` prints the exact JSON that would be sent.
- [ ] **Step 7:** receiving endpoint — a minimal Vercel function owned by the
      user. It must: accept POST only, validate the payload shape, rate-limit per
      IP, **store no IP address**, and keep only an aggregate daily count of
      distinct install ids. Document that abuse can only inflate a counter, never
      expose a user.

**Acceptance:** fresh profile with a network monitor attached → no requests
before consent. After consent → one request per day, and its body matches the
snapshot exactly.

## Slice 5 — Cache and health controls (small, user-visible)

Users hit stale provider health and stale caches and have no obvious lever.
`/clear-cache` and `/reset-provider-health` already exist but are undiscoverable
and unexplained.

### Steps

- [ ] **Step 1:** when the runtime health line shows a degraded/down provider,
      append the exact command that clears it (`/reset-provider-health`).
- [ ] **Step 2:** `/clear-cache` reports what it cleared and what it kept
      (history and config are never touched) so it is not scary to run.
- [ ] **Step 3:** document both in `.docs/diagnostics-guide.md` with the symptom
      that should prompt each.

**Acceptance:** a degraded provider line tells the user how to clear it, and
running that command visibly changes the line.

---

## Out of scope

- Crash reporting to a third party (Sentry and similar). Would require sending
  stack traces containing paths and possibly titles.
- Any per-title, per-provider, or per-query metric, even aggregated.
- Session replay, timing beacons, feature-usage counters.

## Review

Reviewed by `docs/superpowers/plans/2026-07-19-release-0.3.0-review-and-cleanup.md`
§3 Track C. That gate verifies the opt-in claim with a network check against a
fresh profile rather than by reading the code — treat that as the real
acceptance test for this track.
