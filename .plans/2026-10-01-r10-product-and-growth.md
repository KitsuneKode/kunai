# R10 — A useful daily product with verified distribution

Status: WAITING FOR QUALIFIED R07/R08/R09 JOURNEYS; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Make first playback, return-to-watch and sharing dependable; validate retention before broad promotion.
**Architecture:** CLI-first journeys and existing share/install/docs surfaces; growth evidence uses consented research and available aggregate metrics. Keep product copy separate from internal architecture details.
**Tech stack:** Existing CLI/Ink drivers, Next docs/share client island, installation scripts, redacted demos.
**Spec:** [share contract](../.docs/share-links.md), [065 CTA owner](./065-share-landing-cta-resilience.md), [growth owner](./kunai-experience-and-growth-moat.md), [privacy](../.docs/analytics-privacy-contract.md).
**Dependencies:** R07 build truth, R08 journey, R09 qualified budgets; promoted journeys have no open P1. Mobile claims require R06 physical evidence.

## Review focus

1. First-use dependency/setup errors explain one actionable next step and support cancellation.
2. Daily resume/offline/next paths retain exact content, position and user preferences after relaunch.
3. Shared links contain safe identity references and offer install/copy fallback without false protocol detection.
4. Activation/retention/recommendation definitions have cohorts and denominators; no silent tracking additions.
5. Public claims, demos and contribution instructions match the exact release candidate and proven platforms.

## R10.1 — Activation and daily return

Allowed edits: `docs/users/getting-started.mdx`,
`docs/users/install-and-update.mdx`, `docs/users/downloads-and-offline.md`,
`docs/users/troubleshooting.mdx`,
`docs/users/continue-watching-and-new-episodes.mdx`;
existing setup/help copy in `apps/cli/src/app/bootstrap` and
`apps/cli/src/app-shell` under R08 ownership. Docs landing/help edits require
an exact path reservation with R07; no broad generator changes.

- [ ] Inspect fresh setup on Linux/macOS/Windows: missing mpv, optional yt-dlp/ffprobe, poster-disabled terminal, declined analytics and cancelled setup. One dependency gap must not block unrelated supported features.
- [ ] Use task-based public instructions: install→find→play→resume; then download→restart→offline play. Explain source availability, confirmed playback and optional subtitles without internal provider trace jargon.
- [ ] Show current continue-watching/queue/offline availability at appropriate entrypoints using existing features. Keep zero-state instructions useful; do not add another dashboard or onboarding screen when a direct action suffices.
- [ ] Verify settings readback and user preference persistence; never “improve activation” by accepting analytics or installing system software silently.
- [ ] Run the full owned-media pilot journey after relaunch and with network disabled. Failure/recovery copy must describe available action and retained data honestly.

## R10.2 — Safe sharing and install fallback

Execute 065 as its existing owner. Allowed edits: `apps/docs/app/w/[code]/page.tsx`, create `apps/docs/components/share/open-in-kunai.tsx` if still absent; existing share presentation/copy components and tests. CLI share codecs/bootstrap tests change only for a demonstrated bug.

- [ ] CTA activation reveals persistent “Opening Kunai… If nothing happened, install below and try again” guidance and a copyable safe deep link. Never claim to detect protocol registration from blur/timeouts.
- [ ] Keyboard/mobile/clipboard-denied/JavaScript-disabled paths remain usable. Preserve server-rendered content and a small client island.
- [ ] Round-trip anime/TMDB/video identity and play/download intent. Reject malformed/overlong payloads; never embed signed direct media URLs, credentials or local filesystem paths.
- [ ] Shared download intent still requires normal local admission/confirmation; receipt of a link does not authorize destructive replacement or automatic background work.
- [ ] Keep share pages' analytics suppression/privacy behavior. Adding per-title/link/user conversion events requires a separate explicit privacy decision, not this plan.
- [ ] Qualify desktop protocol handling on native platforms and mobile install-copy fallback. Share receipt and player progress are different observations.

## R10.3 — Pilot and growth experiment definitions

Recommended research pilot: 15 consenting representative users across beginner CLI, daily anime/series and offline use; numbers below are initial product targets, not statistical guarantees.

| Signal          | Definition                                                                       | Initial pilot criterion                                        |
| --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Activation      | confirmed first playback in the observed session                                 | ≥12/15 within 3 minutes after dependencies are available       |
| Offline success | exact downloaded artifact plays after restart with network off                   | every participating offline task, with failures recorded       |
| D7 return       | activated participant reports/observably performs a real watch task around day 7 | report count / activated cohort; no target inferred from reach |
| Recommendation  | participant voluntarily shares/recommends after a successful task                | report count / activated cohort plus recipient experience      |
| Reliability     | attempted tasks, failures, retries and unresolved defects                        | no open P1 in promoted journeys                                |

- [ ] Recruit/contact only with explicit authorization; this plan does not authorize sending messages. Prepare a short consent/task script, neutral questions and failure journal for review.
- [ ] Use consented interviews/local observations to establish activation/retention. Existing anonymous aggregate install/activity metrics cannot reconstruct a user cohort; do not call their ratio D7 retention.
- [ ] Define each experiment as hypothesis, audience, one intervention, denominator, outcome window, stop rule and privacy implications. Examples: improve install fallback→more recipients complete first play; better local resume→more returning offline tasks.
- [ ] Use GitHub traffic/downloads/stars only for reach. GitHub repository traffic has a limited 14-day window; it is not proof of daily product use. [GitHub traffic reference](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository).
- [ ] Keep a research summary with participant identifiers minimized and no credentials/watch URLs. Report failures and nonresponse; do not select only successful users.
- [ ] Choose the next intervention from actual drop-offs. No cloud accounts, payment, daemon, recommendation engine or additional framework merely for a virality claim.

## R10.4 — Release and contributor loop

- [ ] Prepare a redacted demo using owned/public media: first play, resume, offline after provider removal and useful failure recovery. VHS fixture artifacts are demos, not live-provider qualification.
- [ ] Public feature/platform tables name preview/experimental/local/native/live qualification honestly. Release notes bind exact commit/artifact and known limitations.
- [ ] Verify newcomer contribution path: feature map→one owning doc→focused test→small fix→fresh gates. A new contributor should not read every .docs file or multiple competing plans.
- [ ] Keep glossary, boundary rules, commands and test strategy canonical. Add a small concrete example to the owning doc when a new interface needs explanation; delete stale duplicate guidance rather than growing a second handbook.
- [ ] Prepare installation/help/share assets and a release checklist locally. Publication, outreach, account mutation and deployment remain explicit final actions under session authorization.

## Verification and closure

```sh
bun run --cwd apps/docs generate
bun run --cwd apps/docs test
bun run --cwd apps/docs typecheck:app
bun run --cwd apps/docs build
bun run --cwd apps/cli test:file -- test/unit/architecture/contract-conformance.test.ts test/unit/app/offline-playback-launch.test.ts
bun run verify:doc-paths
bun run verify:doc-frontmatter
bun run verify:parity-references
```

Run 065's focused share tests and verify-kunai daily journeys against the exact candidate; use browser/native device checks for web/protocol UX and current official frontend guidance before implementation. Run runbook release gates before claiming readiness. Return pilot protocol/results, share/install evidence, contributor first-patch evidence and current qualified feature matrix. A planned experiment is not demonstrated retention or virality.
