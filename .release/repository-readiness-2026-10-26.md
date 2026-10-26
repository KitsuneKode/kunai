# Repository recovery and release readiness — October 26, 2026

This is a qualification record, not merge or publication approval.

## Ownership and preservation

The active controller is the T3 thread `d1ab12b2-fc06-4eed-80ae-f4415a2feb5b`.
The audit continuation `ab6eaee2-9350-4033-b0f5-677032c02c3d` supplied PR668's
original audit work. The completed follow-up
`9eb77d83-e40f-4b70-afa6-62f4dd2cbe82` verified existing PR668 fixes and reported
its remaining GitGuardian incident; it introduced no separate patch to integrate.
Current source and hosted checks were checked independently.

The initial inventory found 52 worktrees, 24 dirty checkouts and 21 checkouts
with commits absent from origin. Counts overlap because branches share history.
The watching branch alone had 39 local-only commits and 212 dirty status entries.
Root main was clean and synchronized with origin. Old branches were retained;
there was no reset, force push, remote merge or release publication.

Before cleanup, a private recovery bundle captured every ref and worktree HEAD
and passed `git bundle verify`. Separate snapshots preserve tracked and staged
patches from all 24 dirty worktrees plus 139 untracked files. Ignored evidence
in retained worktrees stays there. Logs and candidate data from removed
checkouts were separately retained. Recovery location and full branch inventory
are in the private `RECOVERY-AND-MERGE-ORDER.md` recovery report.

Eleven clean, fully pushed, inactive checkouts attached to merged/closed PRs were
removed without force; all their branch refs remain. Twenty-five disposable
cache directories were removed while keeping task-run evidence and release
artifacts. Physical free space increased by 5.74 GiB during cleanup. The 13.16 GiB
sum of cache directory sizes includes shared files and is not a physical-space
claim. Forty-one worktrees remain. Dirty and unpublished work was not pruned.

## Integration order

1. **PR668 first.** Head `f0f83ef86` has passing hosted Windows/macOS parity,
   tests, builds, CodeQL and all six installer scenarios. GitGuardian remains
   maintainer-owned. The last published CodeRabbit review covers an older head;
   final-head review was requested again after its allowance reset. Status-check
   success is not review approval.
2. **Review the existing watching branch.** Its pinned heads for all 22 source
   PRs still match origin: 652, 655, 657–665, 667, 634–637, 639, 645, 622, 623,
   633 and 644. Do not apply those patches twice. After PR668 lands, merge the
   updated main normally into this candidate, resolve against owning contracts,
   and rerun the combined gates before approval. Do not rewrite shared history.
3. **Reconcile source PRs after integration.** Confirm each source head is
   incorporated before marking its review surface integrated/superseded. If
   merging individually instead, preserve the existing dependency chains:
   622 → 623 → (633, 644), and 634 → 635 → 636 → 637. Several source PRs currently
   conflict; green isolated PR checks cannot qualify their combined result.
4. **Refresh version PR327 last.** Regenerate its versions/changelogs only after
   the runtime scope settles. Its old mergeability is not release readiness.
5. **Qualify the exact release candidate.** Validate the preserved npm/native
   artifacts, provenance, checksums, installer/update behavior and supported
   platforms. Complete applicable live-provider, real-terminal and physical
   mobile gates, then obtain protected publication approval. Never rebuild
   different bytes between qualification and publication.

Unrelated torrent/debrid PR641/648, licensing PR638, Chromecast PR306 and
post-release architecture/manga/YouTube-discovery expansion remain outside this
watching release. Ink 8 and the newer React-compiler lint migration remain
separate measured work, not reasons to raise a budget or weaken a rule.

## Quality findings and evidence

A real CLI fixture replay exposed a header that reverted a stopped movie to its
series search lane. Three failing-first cases also cover anime theatrical films
and YouTube identity with movie structure. The root summary now uses the shared
content-kind resolver during playback/post-play; browsing retains its lane.
The replay confirms the corrected movie header and a persisted movie history
row. Unused playback declarations and an obsolete test waiter were removed.

The real-mpv tier passes both witnesses: advancing player IPC time and a Kunai
history row for generated local media. This is not live-provider qualification.
The registry audit reports no vulnerabilities in 815 checked packages; that is
not proof that the application has no exploitable flaws. Existing lint warnings
remain and must not be described as a warning-free result.

Evidence logs are `/tmp/kunai-release-quality-*`, the failing-first regression
is `/tmp/kunai-release-header-red.log`, and the final CLI replay bundle is
`/tmp/kunai-release-quality-drive-final/`. Final combined check results are
recorded below after completion.

## Final local gates

- Forced workspace typecheck: 15 successful tasks, zero cached.
- Forced workspace tests: 26 successful tasks, zero cached; 9,653 pass, 62 skip,
  zero fail. Skips remain platform/operator/live gates, not passes.
- Forced lint: 14 successful tasks, zero cached, no errors. Nine CLI warnings
  plus existing root/package warnings remain; this is not warning-free lint.
- Fresh build: ten successful tasks, zero cached; the development bundle is
  3,179,188 bytes under this candidate's existing 3,194,880-byte cap. The cap
  was not changed during this pass. The PR668 cap is separately smaller;
  reviewers must retain the documented combined-budget decision explicitly.
- Registry audit: no advisories in 815 packages. Doc coverage, preflight,
  formatting, Linux host binary and npm package checks pass.
- Real mpv: one opt-in generated-media test passes, with advancing IPC and
  persisted history witnesses. The CLI replay verifies the final `movie ·`
  header and the movie history row after post-play settles.

The final local changes are prepared for draft review on the existing watching
branch. Hosted qualification must run on that published commit. Do not reuse
PR668's platform results as proof of the larger combined candidate. The host
build refreshed Linux x64 only; existing files for other native targets are
not qualification of this final source. No remote PR was merged and no version,
tag, deployment, npm package or release was published by this pass.
