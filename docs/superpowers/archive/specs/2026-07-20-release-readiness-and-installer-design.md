# Kunai 0.3.0 Release Readiness and Installer Design

**Date:** 2026-07-20  
**Status:** Approved design  
**Release target:** 0.3.0  
**Support posture:** Linux supported; macOS and Windows beta  
**Primary goal:** Ship a dependable public release whose installer, release metadata, first-run experience, and core continuity/playback features agree with reality.

## 1. Context

Kunai has accumulated substantial user-facing functionality, but the next release has been delayed because distribution and release truth have not kept pace with the product surface.

The current repository has strong foundations:

- eight native binary targets and checksum generation;
- a versioned native binary store;
- atomic in-process launcher swaps;
- install manifests, upgrade planning, retention, and uninstall commands;
- meaningful diagnostics redaction and support-bundle coverage;
- robust download worker shutdown and retry behavior;
- history, queue, post-play, and persistent-shell features that are close to shippable.

The release is blocked by boundary failures rather than a lack of features:

- the public binary install path points at a release without binary assets;
- macOS bootstrap paths disagree with runtime paths;
- source installation can overlap and delete Linux user data;
- Windows can report a successful native install while an old npm/Bun shim remains active;
- npm lifecycle registration is declared but excluded from the package tarball;
- release-note generation does not correctly handle the pending minor release;
- staged 0.2.6 metadata is exposed as if it were published;
- queue, resume, search-lane, provider-fallback, and episode-identity state is lost at subsystem boundaries;
- setup cannot open when `mpv` is missing;
- public documentation describes shortcuts, dependencies, and platform capabilities that do not match the application.

The chosen approach is a **reliable release spine**: repair distribution and release ownership, add bounded lifecycle capabilities, fix the key core-feature correctness defects, and avoid a full distribution-platform rewrite.

## 2. Product and release decisions

### 2.1 Version

- Ship the next public release as **0.3.0**.
- Treat 0.2.6 as unpublished staging, not release history.
- Public docs must not link to or show checksums for an unverified tag.

### 2.2 Platform support

- Linux glibc and musl are the supported 0.3.0 platforms.
- macOS and Windows binaries may ship as beta after known destructive and ownership defects are fixed.
- Windows ARM64 remains experimental until native execution evidence exists.
- macOS and Windows protocol registration must not be advertised until implemented.

### 2.3 Feature posture

- Queue/resume/post-play ships only after its acknowledgement and identity model is corrected.
- Downloads and offline playback ship as **beta** after bounded library interaction fixes and a real smoke test.
- Diagnostics remain a promoted feature; their internal privacy and export design is already strong.
- Browser/Playwright providers, daemon, web, desktop, and broad package-manager distribution remain outside 0.3.0.

### 2.4 Outward-facing release actions

Publishing npm, creating tags, and promoting a GitHub release require explicit final confirmation after all deterministic gates pass.

## 3. Goals

1. Make installation, update, rollback, diagnosis, and uninstall deterministic for every advertised installation method.
2. Prevent installers from deleting user data or silently mutating another package manager's installation.
3. Ensure a successful install message identifies the executable that will actually run.
4. Make release notes, versions, checksums, documentation, npm metadata, and GitHub assets agree.
5. Preserve exact media identity across search, history, queue, provider resolution, playback, shutdown, and restore.
6. Keep optional enrichment and integrations from blocking playback or breaking the shell.
7. Prove the shipped binary can execute the core product loop, not merely print `--help`.
8. Keep the release bounded enough to ship without taking on signing infrastructure, broad package-manager support, or a cross-platform shell-configuration editor.

## 4. Non-goals

The following are intentionally deferred:

- signed update metadata, TUF, Sigstore, or new release-key management;
- stable/latest rollout channels and remote downgrade floors;
- Homebrew, Winget, deb, rpm, apk, pacman, mise, or asdf distribution support;
- automatic mutation of user shell configuration;
- automatic deletion of npm, Bun, or package-manager-owned installs;
- full macOS/Windows support parity;
- a broad startup architecture rewrite or daemon extraction;
- notification `play-now` migration;
- rich recoverable-session browsing or cross-session merge UI;
- a full offline/download UX redesign;
- broad continuation-engine deletion, beyond aligning visible behavior.

## 5. Distribution architecture

### 5.1 One lifecycle model

The native installation lifecycle is:

```text
bootstrap installer
    -> verified version artifact
    -> version store
    -> managed launcher
    -> install manifest
    -> install / upgrade / rollback / uninstall / doctor
```

`install.sh` and `install.ps1` remain self-contained bootstrappers. They install a verified native binary and write the same logical layout and ownership record used by the runtime. They do not maintain a competing upgrade or uninstall policy.

Lifecycle commands remain owned by the CLI:

- `kunai install`
- `kunai upgrade`
- `kunai rollback`
- `kunai uninstall`
- `kunai doctor`

### 5.2 Path separation

The installer must keep these concerns separate:

- user configuration;
- durable application data;
- downloads;
- permanent version artifacts;
- temporary staging;
- locks and transaction records;
- source checkout;
- user-visible launcher.

A source checkout must never share the runtime data directory. On Linux, the source installer must use a dedicated location such as `~/.local/src/kunai` or an explicit override. On macOS, script defaults must match the runtime's `Application Support` and `Caches` paths.

Relative XDG overrides must be rejected or ignored. Every resolved managed path must be canonicalized and verified to remain inside its expected root.

### 5.3 Install manifest

The manifest becomes the primary ownership record. Runtime detection remains a recovery mechanism when the manifest is absent or stale.

The versioned schema records at least:

```ts
interface InstallManifest {
  schemaVersion: number;
  method: "binary" | "npm-global" | "bun-global" | "source";
  observedProvenance?: string;
  activeVersion: string;
  previousVersion?: string;
  preferredChannel: "stable";
  launcherPath: string;
  versionedPath?: string;
  managedPaths: string[];
  target?: string;
  artifactSha256?: string;
  installedAt: string;
  updatedAt: string;
}
```

The exact persisted type may use the repository's existing naming, but these ownership concepts must not be inferred from unrelated configuration.

Manifest migrations are forward-only, idempotent, atomically written, and covered for every legacy state.

### 5.4 Channel ownership

Kunai follows these rules:

- Native install may coexist with npm/Bun/source, but it must report every discovered candidate and the PATH winner.
- Native install never silently uninstalls another channel.
- Package-manager-owned installations are updated and removed through their package manager.
- A future explicit migration or cleanup action may remove a confirmed old install, but it is not an install side effect.
- Direct Bun and source installs must either write a manifest or be recoverable through deterministic executable-path provenance.
- Windows detection must use platform-correct path handling rather than Unix-only path fragments.

### 5.5 Transaction model

Every native installation or upgrade follows this order:

1. Resolve and strictly validate version and platform.
2. Acquire an exclusive per-version transaction lock.
3. Create a unique staging transaction.
4. Download with total and no-progress deadlines, bounded retries, and a size limit.
5. Verify the required checksum before activation.
6. Copy to a sibling temporary file on the final filesystem.
7. Set executable mode where applicable.
8. Atomically move into the immutable version path.
9. Write per-version metadata.
10. Atomically activate the managed launcher.
11. Atomically write the manifest.
12. Release the lock.
13. Schedule non-blocking retention and abandoned-staging cleanup.

A failed download, checksum, write, or activation must leave the previous launcher and manifest usable.

`--force` means redownload and reverify. It does not delete a demonstrably live lock.

### 5.6 Launcher ownership

- POSIX activation creates a sibling temporary symlink and renames it over an installer-owned launcher without pre-unlinking it.
- Windows activation preserves the previous launcher until the new copy is complete and uses checksum or explicit ownership, never file size alone.
- An unmanaged regular file at the launcher path is not overwritten automatically.
- Old Windows copy-asides are transaction-owned and cleaned after safe activation or recovery.

### 5.7 Retention and rollback

The existing retained-version model gains a user-visible purpose.

`kunai rollback` supports:

- default rollback to the previous active version;
- `--list`;
- `--to <version>`;
- `--dry-run`.

Rollback:

- lists only local verified candidates by default;
- reverifies stored metadata/checksum before activation;
- atomically repoints the launcher;
- records previous and active versions;
- preserves the preferred update channel;
- refuses corrupt, missing, or currently locked/unsafe candidates;
- does not download historical binaries unless a later explicit feature is designed.

Retention protects:

- the active launcher target;
- the currently executing version;
- versions locked by live processes;
- an explicitly selected rollback candidate;
- the newest configured number of additional verified versions.

### 5.8 Doctor

`kunai doctor` is read-only and reports:

- running executable path;
- all PATH candidates in resolution order;
- manifest method versus observed provenance;
- active launcher and target;
- installed/retained versions;
- version metadata and checksum status;
- stale or active install transactions and locks;
- platform target and dependency status;
- concrete remediation commands.

`kunai doctor --json` exposes the same structured result for tests and support tooling.

Doctor does not clean locks, rewrite PATH, uninstall packages, or repair state unless a separately designed explicit repair action is invoked.

### 5.9 Uninstall

Default native uninstall removes installer-owned:

- launcher;
- version store;
- locks;
- staging files;
- transaction metadata;
- install manifest.

It preserves configuration, history, cache, downloads, and user-created files. `--purge` is explicit and reports every removed path. Package-manager-owned installs receive the correct package-manager command rather than native deletion.

## 6. Release truth and packaging

### 6.1 Staged versus published

Release metadata distinguishes at least:

- `staged`;
- `published`;
- `withdrawn` when needed.

The docs site:

- does not treat staged metadata as the latest public release;
- does not generate GitHub links for an unpublished tag;
- does not display checksums for unavailable assets.

A release becomes published only after npm, tag, and complete GitHub asset verification agree.

### 6.2 Changelog generation

The release parser must support:

- Major Changes;
- Minor Changes;
- Patch Changes;
- multiple change groups;
- multiple Changeset entries;
- human-written release summaries without leaking draft instructions.

The 0.3.0 generation flow must be exercised before the version PR is merged and all generated outputs reviewed together:

- `apps/cli/package.json`;
- `apps/cli/CHANGELOG.md`;
- root `CHANGELOG.md`;
- staged `.release` markdown and JSON.

### 6.3 npm package lifecycle

The npm tarball must contain every executable lifecycle hook it declares.

Preferred implementation:

- bundle a standalone postinstall entry with no imports from excluded source files; or
- move registration into shipped runtime behavior if it can remain deterministic.

A real clean global installation with scripts enabled must verify:

- executable resolution;
- `kunai --version`;
- install manifest registration;
- `kunai upgrade --check`;
- uninstall routing.

`npm pack --ignore-scripts` is retained as a contents check, not treated as an installation test.

### 6.4 Release workflow ordering

The release workflow is reordered so verified artifacts precede publication:

1. Full CI, build, package check, release guard, and release-note check.
2. Build all eight binaries and `SHA256SUMS`.
3. Verify binary presence, checksum, version, help, and deterministic playback smoke where runnable.
4. Preserve verified artifacts as workflow artifacts.
5. Publish npm only after all deterministic gates pass.
6. Create a draft GitHub release.
7. Upload the eight binaries and `SHA256SUMS`.
8. Verify the draft's complete asset contract.
9. Promote it to the public latest release.
10. Mark repository release metadata published through an explicit post-release step.

A release should never publish npm and only then discover that binaries cannot be built.

## 7. Core feature architecture

### 7.1 Queue acknowledgement contract

Queue playback uses an explicit identity-bearing handoff:

```ts
interface QueuePlaybackIntent {
  queueEntryId: string;
  titleId: string;
  mediaKind: "movie" | "series" | "anime";
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  source: "queue" | "auto-next" | "post-play";
}
```

Queue entries move through:

```text
pending -> in-flight -> played
```

Rules:

- Selection marks the exact entry in-flight before cross-phase handoff.
- Search cancellation, episode cancellation, provider exhaustion, or mpv launch failure restores that entry to pending with diagnostic context.
- Confirmed mpv startup marks that exact ID played.
- Reordering during countdown cannot change the acknowledged entry.
- Manual queue selection and automatic next-up use the same acknowledgement contract.
- Stale in-flight entries become recoverable after crash.
- Shutdown preserves a final in-flight item as recoverable work.

### 7.2 Queue restore

Restore uses queue-owned in-flight identity first.

Legacy history inference is permitted only when:

- no queue-owned in-flight identity exists;
- history time is at or after session creation;
- history time is at or before the last real session activity plus a bounded tolerance;
- media identity, including absolute anime episode identity, matches.

Restore must define deterministic placement when the current queue is non-empty. The 0.3.0 policy is to preserve the restored session's internal order and place it as one contiguous block rather than interleave duplicate queue positions.

If the inferred item already exists, restore promotes that exact row rather than returning without action.

### 7.3 Episode-specific resume

Every explicit episode launch resolves history for the chosen episode identity.

Title-level latest history may inform a generic Continue action, but it must never supply `positionSeconds` to a different selected episode.

All per-title history list operations use canonical identity resolution for:

- bare TMDB IDs versus `tmdb:<id>`;
- opaque provider IDs versus AniList/MAL identity;
- season/episode identity;
- absolute anime episode identity.

### 7.4 Continuation policy

Startup Continue, History, queue restore, and post-play use one conservative continuation policy.

When authoritative release evidence is unavailable, a completed title is considered up to date rather than fabricating an unverified next episode. The older optimistic behavior may remain internally during migration, but it cannot produce contradictory user-visible decisions.

### 7.5 Search lane

Search results carry the resolved lane into selection:

- movie;
- series;
- anime;
- YouTube.

A cross-mode query must update the selected title's mode and provider route. Selection cannot fall back to the shell's previous lane merely because a result lacks an `isAnime` marker.

### 7.6 Successful provider identity

The provider that successfully resolves the stream becomes a first-class playback-cycle value.

It is used for:

- history;
- presence;
- share hints;
- diagnostics;
- timing context where relevant;
- source display;
- subsequent episode routing during the session.

The configured provider and the successful fallback provider remain distinct concepts. A successful fallback is retained for the session unless the user changes source or configuration.

### 7.7 Timing and optional enrichment

Optional timing enrichment cannot block mpv indefinitely.

Every source combines:

- caller cancellation;
- a source deadline;
- an aggregate foreground timing budget.

A timeout or failure starts playback without skip metadata and emits classified diagnostics such as:

- not applicable;
- identity missing;
- not found;
- timeout;
- offline;
- HTTP error.

Background retry remains optional and bounded.

### 7.8 Subtitle policy

Automatic subtitle attachment selects only:

- the configured language;
- an allowed fallback language.

Unrelated tracks remain in the manual subtitle inventory but do not suppress late configured-language lookup.

Anime late lookup requires a proven numeric TMDB external ID. Provider-native or AniList IDs are not sent as TMDB IDs. If no mapping exists, Kunai skips the lookup and records diagnostic evidence. Playback-iteration cancellation is threaded through the lookup.

### 7.9 History checkpoint lifecycle

When playback policy rejects a short, failed, or did-not-start session, the active history checkpoint is immediately unregistered and cleared. Coordinated shutdown must not persist a row that normal history policy rejected.

## 8. First-run, setup, and offline

### 8.1 Missing dependencies

The shell, setup, settings, diagnostics, and browsing surfaces can mount without `mpv`.

Playback actions perform the dependency gate and present platform-specific installation guidance. `kunai --setup` must always open, including when `mpv` is missing.

### 8.2 Library interaction

`/library` must not contain selectable inert rows. Watchlist-only rows are omitted from the offline library in 0.3.0; Watchlist remains owned by its dedicated online/saved-title surface. This keeps `/library` aligned with its documented purpose: downloads and locally playable artifacts.

Input ownership is centralized so parent and nested handlers cannot both process the same printable key. Mounted interaction tests prove one key causes one action.

### 8.3 Opener failures

Issue reporting, browser opening, and folder reveal consume the opener result.

When opening fails, Kunai prints:

- a copyable URL or path;
- the support-bundle location where relevant;
- a concise platform-specific explanation.

Spawn failures become typed results rather than uncaught promise rejection.

### 8.4 Offline status

The download worker and offline service remain substantially unchanged. Their retry, shutdown, temp cleanup, missing-artifact visibility, subtitle sidecar, and local-source policies are retained.

The public label remains beta until one real release-candidate matrix proves:

- enqueue;
- pause/cancel;
- restart recovery;
- completed artifact discovery;
- local playback;
- subtitle/timing sidecars;
- clean shutdown.

## 9. Documentation design

The public installation hierarchy is:

1. native binary;
2. Bun global;
3. npm global;
4. source checkout for contributors.

The README quick start includes:

1. install;
2. `kunai --version`;
3. `mpv --version` or platform installation guidance;
4. `kunai --setup`;
5. `kunai -S "Dune"`;
6. expected selection and playback flow.

Documentation requirements:

- `kunai upgrade` is the primary update path;
- uninstall guidance uses `kunai uninstall` or the owning package manager;
- binary install does not claim Bun is required;
- `yt-dlp` is described for YouTube playback and downloads;
- shortcut docs are generated from the registry or intentionally reduced;
- poster behavior matches the half-block renderer release;
- Discord IPC is described as Unix socket or Windows named pipe;
- Windows and WSL environment boundaries are explicit;
- unsigned-binary guidance is near platform install commands;
- Alpine/musl has a concrete setup recipe;
- YouTube cookie configuration has a safe, redaction-aware guide;
- protocol registration is documented as Linux-only;
- source installation is clearly a contributor path;
- staged release metadata is visibly upcoming, never published.

## 10. Verification strategy

### 10.1 Deterministic tests

Add or repair coverage for:

- install manifest migration and ownership;
- strict version and managed-path validation;
- install/upgrade failure-result behavior;
- flat-to-versioned migration;
- retention, staging cleanup, and lock ownership;
- rollback and uninstall cleanup;
- macOS path contract;
- Windows install-method detection;
- queue pending/in-flight/played transitions;
- exact-ID acknowledgement;
- failed handoff recovery;
- session-window restore;
- absolute-episode dedupe;
- non-empty queue merge placement;
- episode-specific resume identity;
- stale history checkpoint cleanup;
- cross-surface continuation agreement;
- cross-mode search selection;
- successful fallback-provider propagation;
- timing deadlines with a live parent signal;
- subtitle mismatch and anime TMDB lookup;
- setup without mpv;
- one-action-per-library-key;
- opener failure fallback;
- major/minor/patch release-note parsing;
- staged/published release metadata behavior.

### 10.2 Installer scenarios

Blocking scenarios include:

- Linux glibc install -> upgrade -> rollback -> uninstall;
- Linux musl install -> upgrade -> rollback -> uninstall;
- source install with seeded user data preserved;
- npm contamination followed by native install;
- equivalent PowerShell shadowing detection;
- default macOS path selection matching runtime paths;
- checksum missing, mismatch, empty asset, and 404 recovery;
- interrupted activation preserving the old launcher;
- direct npm global install with scripts enabled;
- direct Bun/source provenance and uninstall guidance;
- uninstall residue and `--purge` boundaries.

The root installer harness is wired into package scripts, CI path filters, and a blocking job.

### 10.3 Compiled artifact smoke

The shipped binary is exercised through deterministic fake-provider/fake-mpv scenarios for:

- movie;
- series;
- anime;
- queue manual selection;
- auto-next;
- failed handoff recovery;
- shutdown and restore;
- return to the persistent shell.

The test must assert mpv IPC or an equivalent committed playback-start signal, not only process startup.

### 10.4 Live signoff

Live provider checks remain separate from deterministic CI, but at least one current provider-matrix run is required before release signoff for the default movie/series/anime routes.

Exact README commands are exercised in clean environments against the actual published or draft-verified assets.

### 10.5 Repository gates

Before release candidate promotion:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
bun run pkg:check
```

Release-specific guards and installer/compiled-artifact scenarios must also pass.

## 11. Implementation slices

Implementation should proceed in independently reviewable slices.

### Slice 1: Stop destructive and false-success installation

- Separate source and data paths.
- Align macOS bootstrap/runtime paths.
- Add Windows PATH winner diagnostics.
- Remove silent npm cleanup from `kunai install`.
- Fix platform-aware method detection.
- Wire the installer scenario harness into CI.

### Slice 2: Repair release truth

- Fix major/minor/patch parsing.
- Repair npm lifecycle packaging and add a real install test.
- Add staged/published release metadata behavior.
- Retire unpublished 0.2.6 public presentation.
- Reorder artifact build before publish.

### Slice 3: Queue and continuation correctness

- Add queue in-flight identity and exact acknowledgement.
- Repair restore window, dedupe, and placement.
- Fix episode-specific resume.
- Clear rejected history checkpoints.
- Align Continue and History policy.
- Make the post-play queue hero execute the advertised action.

### Slice 4: Search and playback boundary fixes

- Preserve search lane.
- Propagate successful provider identity.
- Bound timing enrichment.
- Correct subtitle language and anime TMDB lookup.
- Improve offline/provider failure classification where evidence is reliable.

### Slice 5: First-run and beta offline UX

- Allow setup without mpv.
- Remove or activate inert Watchlist rows.
- Centralize library input ownership.
- Add opener fallback behavior.
- Correct protocol/platform claims.

### Slice 6: Doctor, rollback, and lifecycle completeness

- Expand the manifest schema and migrations.
- Implement structured doctor text/JSON.
- Implement local verified rollback.
- Complete uninstall residue cleanup.
- Add bounded native download behavior.

### Slice 7: Documentation and release signoff

- Reconcile README, npm README, docs, help, status metadata, and changelogs.
- Generate or reduce shortcut documentation.
- Run compiled artifact and provider signoff.
- Run the real release workflow to the final confirmation gate.

## 12. Acceptance criteria

0.3.0 is ready for final publish confirmation only when all of the following are true:

1. No installation method can delete runtime data as an implicit side effect.
2. macOS script and runtime paths agree.
3. Windows and Unix installers identify the actual PATH winner.
4. Install, upgrade, rollback, doctor, and uninstall use one ownership model.
5. npm and Bun/source routes have deterministic lifecycle ownership or explicit guidance.
6. A failed install/upgrade leaves the previous launcher usable.
7. Release-note generation correctly handles the 0.3.0 minor release.
8. Staged metadata cannot appear as a published release.
9. The npm package runs every declared lifecycle script from the actual tarball.
10. Queue entries are consumed exactly once only after committed playback startup.
11. Failed queue playback remains recoverable.
12. Queue restore cannot resurrect unrelated history or lose absolute-episode identity.
13. Explicit episode playback cannot inherit another episode's resume position.
14. Search selection enters the lane that produced the selected result.
15. History, presence, share hints, and subsequent episodes record the provider that actually succeeded.
16. Optional timing and subtitle work cannot indefinitely block playback.
17. Setup opens without mpv and playback shows targeted dependency guidance.
18. `/library` has no inert selectable rows or double-handled keys.
19. Documentation matches runtime shortcuts, dependencies, platform support, and lifecycle commands.
20. The compiled release binary passes deterministic movie, series, anime, queue, shutdown, and return-to-shell smoke tests.
21. The default live provider routes have a current signoff run.
22. The real release workflow builds and verifies all required assets before public promotion.
23. Publishing and public promotion receive explicit final confirmation.

## 13. Reference-source handling

The local installer reference was used only to identify general engineering patterns and counterexamples. The copied reference source under `docs/installer-reference/claude-code/` must not be committed.

Kunai may retain an original summary of reusable principles:

- staged verification before activation;
- version retention and rollback;
- install provenance;
- actionable diagnostics;
- bounded downloads;
- conservative ownership boundaries.

No source copy, copied comments, or project-specific internal behavior is required for the Kunai implementation.
