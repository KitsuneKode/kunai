---
status: current
lastReviewed: "2026-10-26"
---

# Kunai — Repo Infrastructure

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

This is the canonical reference for local developer guardrails and GitHub CI.

## Current State

Repo infrastructure from the May 2026 superpowers plan is implemented.

| Area                      | Canonical location                    | Status      |
| ------------------------- | ------------------------------------- | ----------- |
| Pull request + main CI    | `.github/workflows/ci.yml`            | Implemented |
| Release workflow          | `.github/workflows/release.yml`       | Implemented |
| Release guard (PR/main)   | `.github/workflows/release-guard.yml` | Implemented |
| Release guard script      | `scripts/release-guard.ts`            | Implemented |
| Root changelog sync       | `scripts/sync-root-changelog.ts`      | Implemented |
| Pre-commit hook           | `.husky/pre-commit`                   | Implemented |
| Pre-push hook             | `.husky/pre-push`                     | Implemented |
| Staged formatting/linting | root `package.json` `lint-staged`     | Implemented |
| PR template               | `.github/pull_request_template.md`    | Implemented |
| Issue template config     | `.github/ISSUE_TEMPLATE/config.yml`   | Implemented |

## Workspace Dependencies

The monorepo uses [Bun catalogs](https://bun.sh/docs/pm/catalogs) in the root
`package.json` to pin shared versions once:

- `catalog:` — TypeScript 7, React, React DOM, `@types/*`, Zod
- `catalog:cli` — `commander`, `ink` (CLI runtime)
- `catalog:lint` — `oxlint`, `oxfmt` (root only; turbo package scripts +
  lint-staged resolve them via workspace hoist)
- `catalog:providers` — `@assemblyscript/loader`; provider crypto uses built-in APIs
- `catalog:repo` — `turbo` (root orchestration only)
- `catalog:web` — Next.js, Fumadocs, Tailwind, Motion, Base UI, Tabler icons,
  docs UI helpers. The docs app shares TypeScript 7 from `catalog:`; Next.js
  16.4 uses its native CLI checker during production builds.

Prefer npm `latest` (stable) pins in catalogs — not `canary`, `preview`, `rc`,
or `next` tags.

The October 26 refresh checks every production-workspace direct dependency against
its registry stable tag. Bun 1.4.4 and TypeScript 7.0.2 are already current;
Bun's runtime floor, package-manager declaration, types and CI setup agree.
Ink 8.0.0 was tested (6,638 CLI unit tests passed) but not adopted: its bundle
was 3,189,750 bytes, above the unchanged 3,170,304-byte cap. Ink 7.1.1 remains
until a separate runtime-preserving optimization qualifies the upgrade.
Oxlint/plugins 1.89.0 also require a separate React Compiler migration: the CLI
reports existing render-time ref and effect patterns as errors. Keep the 1.74.0
pair until those lifecycle changes are independently qualified; no rules or
baselines were disabled to make the upgrade pass. Oxfmt is updated to 0.74.0. Research
workspaces and unpublished Kunai platform packages are not registry-updated.

Changesets 3 requires the matching v2 action (pinned by commit), renamed
`version-script`/`pr-title`/`commit-message` inputs, and explicit
`privatePackages: { version: true, tag: false }` to preserve the former private
workspace versioning behavior. `changeset status` must compose the existing
public/private changesets successfully; no version or tag is created by that
check. Root Changesets scripts use the locked CLI through `bunx --bun --no-install`
so a machine-specific Node version cannot select the release tool runtime or
download an unpinned CLI. Publication still follows the preserved-artifact pipeline.

Root `overrides` dedupe known transitive drift (`@types/node`, `fumadocs-core`,
`fumadocs-ui`). Fumadocs still pulls Radix + `lucide-react` transitively; do not
re-catalog those as direct docs deps — docs UI uses Base UI + Tabler.

`braces@3.0.3` retains a tracked Bun depth-limit patch. Shared CI setup
checks the installed shadcn glob path and the Changesets 3 migration away from
`braces` after frozen install with
`bun run verify:dependency-patches`; [patch maintenance](../patches/README.md)
records provenance, compatibility, and removal criteria.

`bun run audit:dependencies` checks the complete locked workspace tree against
current registry advisories. The PR release guard runs it before installation,
and the manual release candidate runs it before its repository/artifact build
gates. Findings and audit failures stop those jobs. The scan includes development
dependencies: internal CLI workspace packages are build inputs even where they
are declared as devDependencies, and the docs/tooling graph has its own exposure.
An audit result identifies affected installed packages; it does not by itself
prove an application exploit. Current versions, dependency paths and verification
results belong in the release qualification record.

Dependency fixes use compatible upstream stable releases and targeted catalog or
override floors. Update a parent package when its supported newer release removes
a vulnerable legacy dependency; do not force an incompatible major into its graph.
Local patches require a reproduced defect, upstream provenance, removal criteria
and behavioral verification through their real consumers. Keep unrelated framework
major migrations separate from playback correctness work.

`.reference/experiments` is **outside** the default workspace, so it cannot use
`catalog:` protocols. Main installs stay lean; research deps install only via
`bun run experiments:install` (standalone `.reference/experiments/bun.lock`).

Default workspace packages: `apps/cli`, `apps/mobile`, `apps/docs`, `apps/relay-server`,
`apps/analytics-ingest`, `packages/*`.

## Local Hooks

`bun install` runs the root `prepare` script and installs Husky hooks.

The pre-commit hook runs staged-file lint/format only. Its formatter commands
allow an all-ignored batch (for example captured reference source) to be empty;
active matched files still undergo the normal formatter check:

```sh
bunx lint-staged
```

When release-related files change (`apps/cli/package.json`, `apps/cli/CHANGELOG.md`,
root `CHANGELOG.md`, or `.changeset/*.md`), lint-staged also runs `bun run guard` to
catch version/changelog drift before commit.

The pre-push hook checks generated documentation metadata first. Pushes to
`main` or tags then run the full workspace gate; other branch pushes use the
affected workspace gate:

```sh
bun run ci           # main and tags
bun run ci:affected  # other branches
```

Both run preflight (including root documentation/workflow formatting), types,
lint, formatting and tests. Only `bun run ci` additionally runs
`verify:parity-references` and `verify:doc-coverage`; `ci:affected` omits those
two verifiers. The hosted CI job matrix has its own path conditions described
below, so a successful branch pre-push does not establish that those hosted
checks ran.

Affected runs may include cache replays; final candidate qualification still
requires forced gates.

The minified development bundle has its own measured size ratchet in
`apps/cli/scripts/build-shared.ts`. It is not the public npm payload: the Node
launcher retains separate 32 KiB packed / 64 KiB unpacked limits. Combined PRs
can exceed the development ratchet even when each passed independently. Measure
the same build options together, remove redundant code, and document any
remaining intentional adjustment beside the constant. The October 15 review
train removed duplicate subtitle checks before a 4 KiB development-only budget
adjustment; public package limits remain unchanged.

Doc freshness compares both committed versions with the installed formatter
before allowing an unchanged review date on a formatting-only edit. Content
changes still require reconciliation; a missing or failing formatter cannot
exempt a doc. This avoids inventing review dates during formatter upgrades.

## CI

Pull requests and pushes to `main` use the composite setup action
[`.github/actions/setup-bun-monorepo`](../.github/actions/setup-bun-monorepo/action.yml):
Bun store cache, per-job `.turbo` cache prefixes, `TURBO_SCM_BASE` on PRs, and
`TURBO_TOKEN` / `TURBO_TEAM` for remote Turbo cache. The README CI badge points
at `.github/workflows/ci.yml`, which runs the Linux test job plus blocking
Windows (`windows-cli`) and macOS (`macos-cli`) legs.

### Checkout is caller-owned

`CI ready` is the aggregate merge check. It runs with `!cancelled()` after every
CI job and executes `scripts/ci-ready.mjs` using the runner's Node, without a
workspace install. A cancelled workflow stops the aggregate instead of publishing
a failure from a superseded run. On active workflows it rejects missing dependencies,
failures, cancelled dependency jobs, invalid filter outputs and unexpected skips. Only jobs whose path conditions
are false may skip. Update the policy and its routing fixtures when changing
job conditions. Release Guard runs on every PR so docs-only changes also emit
`Version ↔ changelog guard`; a required workflow must not disappear behind a
PR path filter. Remote enforcement must be checked separately from this YAML.

Release publication proposes its status update through a reviewed metadata PR,
using `.github/scripts/open-release-metadata-pr.sh`. It does not push to main.
Maintainers approve bot-created workflow runs when requested, then review and
merge the PR after required checks pass. Recovery is documented in
[RELEASING.md](../RELEASING.md#metadata-pr-recovery).

**Every job must run `actions/checkout` before it uses a local composite
action.** The composite deliberately does not check out.

A local composite (`uses: ./.github/actions/...`) is loaded from the workspace,
so GitHub can only resolve it once the repository is already on disk. If the
composite performs the checkout itself, a job whose first step is that composite
fails while trying to _find_ the action — before the checkout inside it can run.

This broke the release pipeline silently: the composite carried its own
checkout, `release.yml` had none of its own, and from 2026-06-27 the release job
never reached publish. A whole development cycle was versioned and had notes
written, but produced no tag and no binaries — while every local gate stayed
green, because local runs never execute workflow bootstrap. Its work was folded
into the next release and the orphaned artifacts were dropped, so the published
line stays contiguous.

The invariant is enforced two ways:

- `bun run scripts/ci-bootstrap-contract.ts` — exits non-zero listing any
  composite that checks out, or any local-composite use not preceded by a
  checkout in the same job.
- `apps/cli/test/unit/scripts/ci-bootstrap-contract.test.ts` — the same rule in
  the default test path, so a regression fails CI rather than the next release.

**Parallel jobs** (`.github/workflows/ci.yml`):

| Job                   | PR                                                                                          | Main         |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| `fmt`                 | `scripts/ci-affected-run.ts fmt:check` + `fmt:root:check` for root-owned files              | full + root  |
| `lint`                | `scripts/ci-affected-run.ts lint` + changed-file anti-slop advisory + count baseline        | full         |
| `typecheck`           | `scripts/ci-affected-run.ts typecheck` (task is `cache: false` — always a real run)         | full         |
| `test`                | `scripts/ci-affected-run.ts test` (CLI splits into cached `test:unit` + `test:integration`) | full         |
| `windows-cli`         | root typecheck + CLI tests when CLI paths change                                            | same on main |
| `build-cli`           | `bun run build` + `bun run pkg:check` when CLI paths change                                 | same on main |
| `build-binaries`      | 2 Linux targets via Turbo when CLI/installer paths change                                   | same         |
| `checks-docs`         | docs gate when docs paths change                                                            | same         |
| `checks-doc-coverage` | `verify:doc-coverage` when a scanned code root or the feature map changes                   | same         |

Format, lint, typecheck, and test jobs retain Turbo run summaries for seven days,
including failed attempts. The Linux test job also retains its combined output;
`pipefail` preserves the test failure when output is piped through `tee`. Artifact
names include the run attempt so retries retain distinct evidence.

Formatting runs independently of typecheck. Provider registration changes in
`apps/cli/src/container/bootstrap-providers.ts` reach the docs freshness gate;
`apps/cli/test/unit/scripts/ci-ready.test.ts` guards that selection.

`checks-doc-coverage` is separate from `checks-docs` on purpose. Its trigger is
every directory the gate scans (`apps/cli/src/{services,domain,infra,app}`,
`packages/**`), because a new unrouted directory arrives as new _code_ files and
would otherwise skip the check meant to catch it. It runs `setup-bun` without
`bun install` — the script imports only `node:fs` and `node:path`.

`scripts/ci-affected-run.ts` wraps `--affected` because a PR touching only
non-package files (`.github/`, `install.sh`, `tools/`, `docs/`, `.docs/`) used
to select zero workspace tasks and exit 0 — four green legs that ran nothing.
The wrapper dry-runs the selection first and falls back to the full task when
it is empty. Root-owned files still need their own unconditional step: they are
not in any workspace, so turbo never sees them regardless of the diff
(`fmt:root:check` covers `.github/`, `scripts/`, `docs/`, `.changeset/`, and the
root configs). Locally, `bun run ci` runs the four blocking tasks plus the
`verify:doc-*` and `verify:parity-references` gates; pre-push calls it.

`verify:doc-frontmatter` (inside `checks-docs`) has two halves. The first is
static: every live `.docs` doc declares `status`, an ISO `lastReviewed`, and the
L3 banner. The second compares the change set against `origin/main` and fails
when a doc's body moved but its `lastReviewed` did not — the field only means
something if editing a doc forces you to answer for it. Set `lastReviewed` to
the day you actually re-read the doc against the tree, or a UTC ISO timestamp
(`YYYY-MM-DDTHH:mm:ssZ`) for a second review on the same day. Unchanged dates
and timestamps still fail when the body changes. For a mechanical sweep
that cannot change meaning, re-run with `SKIP_DOC_FRESHNESS=1`. Both halves need
history, which is why every `checkout` in the workflow pins `fetch-depth: 0`; on
a checkout without the base ref the freshness half skips with a notice rather
than failing on the shape of the clone.

The v4 Bun cache covers `~/.bun/install/cache`, with an OS and install-configuration
partition (`package.json` and `bunfig.toml`) before the lockfile/patch fingerprint.
Fallback restores stay inside that partition; older generations are excluded.
Windows CI exports `BUN_INSTALL_GLOBAL_STORE=0` before frozen installation so
dependency links remain in the checkout. Restored global-store junctions had
produced `EPERM` on a transitive dependency despite a successful install and
oxfmt probe. Registry package bytes remain cacheable. Linux/macOS retain the
configured global store. Executable dependency-patch verification remains
mandatory before any cache save; this change does not retry or skip that gate.
The formatter probe uses `bunx --no-install` so a missing local binary cannot
silently fetch another formatter version.

**Build tasks** (Turbo):

- `build` — unpublished development bundle (`dist/kunai.js`, `dist/assets/**`)
  and public npm launcher package (`dist/npm/**`)
- `build:binary:host` — host compiled binary (`dist/bin/kunai-*`)
- `build:binaries` — release cross-compiles plus deterministic archives
  (`dist/bin/**`): `.tar.gz` for Linux/macOS, `.zip` for Windows

`bun run build` at the repo root runs `build` + `build:binary:host` in parallel.
The public launcher resolves a platform package; `pkg:check` enforces its file
allowlist and size budget. Both application build outputs project the CLI
`package.json` import to its version, the only field runtime callers consume.
Manifest matching follows links and compares device/inode identity with exact
bigint values, covering aliases through symlinks, junctions and hard links. Other JSON imports retain their
complete contents, and build-host environment
values are never inlined. The development-bundle size gate remains unchanged.

Release preparation and publication scope each npm invocation with an explicit
`--prefix` pointing to the platform package or preserved tarball directory.
This keeps npm 11's development-engine checks on the artifact being handled;
the repository itself deliberately requires Bun. It does not bypass engine
checks with `--force` or alter the repository's package-manager policy. Preserved
tarball inspection and registry/publish commands use the same artifact context;
user/environment registry authentication still follows npm's normal resolution.
Pack metadata accepts npm 11's single-record array and npm 12's single-entry
package-name map. A keyed record must agree with its key; multiple records,
missing fields and mismatched expected package identity/version/integrity still
fail. This compatibility does not change the release workflow's pinned Node/npm
toolchain or enable publication during candidate preparation.
The real-npm regression in
`apps/cli/test/integration/npm-global-install.test.ts` packs tiny isolated
candidates and verifies that inspection returns their exact preserved integrity.

The 0.3.0 GitHub Release compatibility bridge is an exact 22-file set: ten
canonical archives, the same ten raw standalone binaries, legacy
`SHA256SUMS` for raw binaries, and `SHA256SUMS.archives` for archives. Keeping
raw hashes under the legacy name preserves already-published installer/updater
compatibility. Each archive contains exactly
one member named after its raw asset. Tar members have normalized uid/gid/mtime
and mode `0755`; zip members carry normalized DOS timestamps and Unix mode
metadata, although Windows zip extraction does not restore POSIX executable
bits. The build reconstructs and byte-compares each archive after preservation,
then the release workflow stages the exact set under the candidate artifact's
isolated `native/` directory. The verifier runs immediately before candidate
upload, confirmation, draft asset upload, and draft-to-public promotion; those
boundaries use the downloaded files directly without a rebuild, native copy, or
recompression. GitHub downloads may discard the raw binary's executable mode,
so the Linux smoke restores that filesystem metadata after byte verification;
the canonical `0755` mode inside tar archives remains independently verified.
The candidate job then creates GitHub artifact attestations for the exact 22
verified paths. Confirmation and publication fail closed unless every file
verifies against `KitsuneKode/kunai/.github/workflows/release.yml`, the main
branch ref, and the current release commit. The verifier also rejects extra or
non-regular directory entries before consulting remote provenance.
On every available Linux, macOS, and Windows native runner, the release smoke
also exposes only that runner's downloaded archive and the two manifests over a
loopback fixture, installs it through the production shell installer into an
isolated profile, verifies the archive provenance in `install.json`, and runs
the installed launcher. Deliberately withholding the raw asset makes an
accidental archive-to-raw fallback fail this gate.

The TypeScript native updater and the Bash/PowerShell installers consume the
platform archive, independently verify its transport hash and extracted
raw-binary hash, and keep a 404/410-only raw fallback for releases published
before archives existed. TypeScript uses an in-process bounded parser,
PowerShell uses bounded .NET zip streams, and Bash validates a bounded tar
container before streaming its one expected member through the host `tar`.
Malformed archives and all other download/integrity failures fail closed. The
archive-consuming updater and installers are stacked on the final activation-lock
protocol; release promotion and attestation remain downstream protected gates.

### Windows parity

`windows-cli` is a blocking `windows-latest` job. It runs the workspace
typecheck, the CLI unit/integration suite, the storage package suite (including
Windows SQLite teardown), provisions native mpv so the real named-pipe IPC
contract is mandatory, and runs the compiled Windows binary through the plain
Node npm launcher with Bun absent from the child PATH.

Native mpv provisioning is owned by
`.github/scripts/provision-windows-mpv.ps1`. CI downloads a pinned official mpv
Windows archive directly, retries transient transfer failures, verifies its
checked-in SHA-256 before extraction, then executes `mpv --version`. Do not
replace this with an unpinned Chocolatey or Scoop install: package-manager feed
availability is not part of Kunai's Windows parity contract. When upgrading mpv,
update the version, release URL, and digest together and keep the provisioning
contract test green.

Closed: the parity leg now builds a Windows host binary and smoke-tests
`--version` / `--help` through the same Node launcher npm users execute. That
gap had shipped a `kunai.exe` which exited 0
printing nothing — inside a compiled Windows binary `import.meta.main` is false
for the entry module (Bun compares `import.meta.path`, spelled with backslashes,
against a forward-slash main specifier), so the startup call behind the guard
never ran. `isProcessEntrypoint` in `apps/cli/src/infra/build/entrypoint.ts` now
answers that question, and the smoke asserts real output rather than exit 0 —
the failure mode exits 0, so an exit-code check alone would not have caught it.
Release native smoke also executes the advertised Windows ARM64 artifact on a
`windows-11-arm` runner instead of qualifying it by checksum alone.

Open Windows parity backlog:

- Windows-only test isolation is easy to get wrong in ways POSIX hides. Two
  shared helpers exist for the cases already found — `apps/cli/test/helpers/temp-store.ts`
  (close database handles before removing a temp dir; Windows refuses to delete
  open files) and `apps/cli/test/helpers/storage-env.ts` (redirect storage roots on every
  platform, not just via `XDG_*`, which Windows ignores).
- Native rollback activation/refusal still has POSIX-only symlink fixtures. The
  install transaction and launcher-copy paths now run on Windows, but rollback
  needs equivalent copy-and-rename transaction cases before release-grade
  updater parity is complete.

**Local pipeline verification**

The local build-cache gate reads the JSON summary path printed by that exact
Turbo invocation. Both `@kitsunekode/kunai#build` and
`@kitsunekode/kunai#build:binary:host` must occur once with cache status `HIT`;
cached dependency typechecks cannot satisfy the gate. Missing or ambiguous
summary announcements, unreadable/malformed summaries, duplicate required tasks,
and either build missing the cache all fail verification. Historical summaries
are never selected by timestamp.

```sh
bun run verify:build-pipeline       # fast: build + pkg:check + turbo cache
bun run verify:build-pipeline:pr    # PR parity: + 2 Linux binaries
KUNAI_VERIFY_ALL_BINARIES=1 bun run verify:build-pipeline:all-targets  # opt-in 10-target build

# README quick-start commands against a real binary. Bare invocation defaults
# to fixture-assets mode + `bun run build:binary:host` output; CI/release pass
# the explicit form:
bun run verify:readme:commands -- \
  --mode fixture-assets --version 0.3.0 --binary apps/cli/dist/bin/kunai-linux-x64
```

## Release guardrails

Release workflow details live in [RELEASING.md](../RELEASING.md). Infrastructure touchpoints:

- `bun run guard` — local version ↔ changelog consistency check
- `.github/workflows/release-guard.yml` — runs `bun run guard` on every PR; main pushes remain path-filtered to release-related changes
- `.github/workflows/release.yml` — version/publish pipeline (scoped paths; runs guard before publish)
- Changelog parser tests: `apps/cli/test/unit/scripts/release-changelog.test.ts`

## Out Of Scope

- Branch protection configuration lives in GitHub settings.
- Binary publishing is tracked separately in packaging/release plans.
- Typecheck does not run in pre-commit; it belongs in CI and pre-push/full local verification.

## Local cache and CI evidence ownership

Turbo uses an explicit `.turbo/cache` directory per checkout. Its automatic
worktree cache sharing can otherwise restore outputs containing absolute paths
from another checkout. Remote cache remains separately configured. The setup
action restores and saves only `.turbo/cache`, so run summaries under
`.turbo/runs` belong to the current CI attempt rather than a cached previous job.
Verification tasks remain uncached; build caching and affected-package selection
continue to provide reuse without replacing fresh release evidence.

## React documentation rendering

Viewer-local timestamps use a `useSyncExternalStore` server snapshot so UTC
markup remains identical during hydration and useful without JavaScript.
Analytics snapshot age receives one request clock sample from the async server
route per ISR generation; the route retains a narrow purity-lint exception
because freezing that clock would make the stale badge unreliable. The footer
year is a deployment/module snapshot, not a continuously updating clock.

Chart-hover table expansion adjusts its monotonic reveal count before commit,
so the matching row is present without an effect-driven render cascade. Rows
stay revealed when hover ends. Kanna visibility subscribes to pointer preference,
reduced motion, storage, dismissal, and restoration changes through a browser
external store, using an empty server snapshot. This preserves dismissal before
paint and supports restoration even when browser storage is denied.

The docs build declares `BUN_INSTALL_CACHE_DIR` in its package Turbo task
environment, extending the root list rather than replacing it.
`apps/docs/next.config.mjs` consumes this path to include Bun's global dependency
store in the Turbopack and tracing roots. Turbo strict mode otherwise drops a
custom cache path, making an isolated installation build fail with dependency
symlinks outside the filesystem root. The cache path participates in the build
hash because changing it changes generated absolute paths.

If a verification profile changes `HOME` after dependencies were installed,
explicitly set `BUN_INSTALL_CACHE_DIR` to the cache used by that installation.
The isolated home cannot discover the original global store by default. This
preserves profile isolation while letting the docs builder follow its installed
dependency links.

The root `test:live:allmanga-crypto` command forwards to the CLI's existing
metadata-only freshness probe; it does not resolve or play a video. It is an
opt-in live command, outside default unit/integration CI.

### Docs discovery and canonical identity

`apps/docs/lib/site.ts` defaults to `https://kunai.kitsunekode.in`, independent
of a preview alias or the developer's hostname. `DOCS_SITE_URL` may override it
with an HTTP(S) origin; credentials, paths, query strings and fragments are
rejected. The root layout marks Vercel preview deployments `noindex, follow`.
Public pages retain their own canonical URLs, social cards and structured data;
utility/share/withdrawn pages keep their existing indexing policy.

`apps/docs/scripts/doc-last-modified.ts` memoizes guide timestamps per path
using full Git history and Fumadocs' author-date convention, avoiding re-dating
unchanged guides when commits are rebased. File-specific queries retain edits
authored during merge resolution, which directory-wide log summaries can omit.
A Git subprocess ignores inherited repository-location overrides and verifies
that its canonical top-level directory matches the requested checkout. Worktrees
and symlinked checkout paths remain supported. A shallow clone or a source
archive, including one inside an unrelated repository, supplies no guide dates,
rather than attributing every guide to the clone boundary or ancestor history. Use a
full checkout (or Vercel's `VERCEL_DEEP_CLONE=true`) to publish per-file dates.
The sitemap lists canonical content URLs and published release dates; the home
page does not borrow the date of an unrelated guide. XML without a stylesheet
is expected crawler output, not a broken page.

`apps/docs/app/llms.txt/route.ts` exposes linked guide summaries and source
provenance, including home, support and privacy. It supplements readable HTML
and JSON-LD; no separate AI ranking mechanism or guaranteed search placement is
claimed. After deployment, sitemap submission and index coverage still require
the site's Search Console owner; local builds cannot establish indexing.

### October 22 watching candidate bundle measurement

The combined provider, v4 timing, consent and mouse implementation produced
3,185,739 bytes against the prior 3,174,400-byte development-bundle cap
(11,339 bytes over). The explicit development cap is now 3,194,880 bytes
(3120 KiB), leaving 9,141 bytes of headroom. This admits the measured feature
set; the boundary test still rejects the first byte over the cap. The public
Node launcher's packed and unpacked budgets remain 32 KiB and 64 KiB.
