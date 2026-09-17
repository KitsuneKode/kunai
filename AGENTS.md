# Kunai

Kunai is a terminal-first Bun CLI that finds playable direct-provider video
streams and hands them off to `mpv`. `CLAUDE.md` is a symlink to this file —
edit this one.

## Working here

Treat what follows as good defaults, not hard rules. The exceptions are the
enforced non-negotiables below and the four hazards; everything else is
judgment, and the developer's stated preference outranks anything here. If a
rule fights the task in front of you, say so and get a decision rather than
quietly working around it.

Find code through [.docs/feature-map.md](.docs/feature-map.md) before grepping.
Read the code as the source of truth — when a doc disagrees with the tree, the
tree wins and the doc is the bug. Route to the one or two deep docs your change
touches; do not read `.docs/` end to end. Vocabulary lives in
[.docs/glossary.md](.docs/glossary.md).

## The four ways to hurt yourself

1. **Writing to the real profile.** `KUNAI_CONFIG_DIR` is **not** an override —
   a run that relies on it silently uses the developer's live config and can
   migrate it. Isolate with `storageRootEnv` (HOME + XDG + APPDATA). Never point
   tests or a debug run at the live SQLite databases; copy them to a shadow
   directory first. Data flows one way: into your sandbox, never back out.
2. **Believing a green gate.** A passing root `bun run typecheck` / `test` can be
   a turbo cache replay — re-run with `--force` or per-package before claiming
   green. Pwsh-gated installer tests land in the "N skip" line, not the failure
   count, and `verify:doc-coverage` does not run locally at all.
3. **Enabling analytics by accident.** Only an explicit keystroke may turn it on.
   A skip, an accept-all-defaults, or any non-interactive path that creates an
   `installId` or permits a send is a contract breach, not a bug.
4. **Shipping a shared relay URL.** `providerRelay.baseUrl` is empty by default
   and user-owned. Published binaries are immutable, so a baked-in host is
   forever.

## Non-negotiables

Each of these is enforced by a test or is expensive to get wrong.

- **Layering is a test, not a convention.**
  `apps/cli/test/unit/architecture/boundary-imports.test.ts` fails on a new
  violation: `domain/` imports neither `app`, `app-shell`, nor `services`;
  `infra/` and `services/` import neither `app` nor `app-shell`; `app-shell`
  imports no provider or player runtime; nothing outside the shell imports
  `ink`; no active code imports `.archive/legacy` or `.reference/experiments`.
  Map in [.docs/runtime-boundary-map.md](.docs/runtime-boundary-map.md).
- **`apps/cli/src/main.ts` is the only entrypoint.** Do not add a second one.
- **Production providers are the ones
  `loadProductionProviderModules()` returns** in
  `apps/cli/src/container/bootstrap-providers.ts`. A module existing under
  `packages/providers/src/` does not make it live.
- **Episode numbers are 1-based in the UI.** Providers adapt internally.
- **`isAnimeProvider: true` is what puts a provider in anime mode.**
- **`packages/providers/src/allmanga/api-client.ts` carries ani-cli parity
  logic.** Check parity against the reference implementation before changing
  crypto or decoder constants, and document deliberate divergence in
  [.docs/providers.md](.docs/providers.md).
- **Relay is metadata-only** — no media route, no video fallback; stream URLs
  stay direct. `packages/relay` is the single implementation and
  `apps/relay-server` stays a thin adapter.
- **Analytics is user-controlled.** The full contract is
  [.docs/analytics-privacy-contract.md](.docs/analytics-privacy-contract.md) and
  it is gated by `analytics-disclosure-once`, `analytics-endpoint-pin`, and
  `analytics-payload-drift` in `apps/cli/test/unit/architecture/`. Read it before
  touching `services/analytics`, `domain/analytics`, or `apps/analytics-ingest`.

## Hit every seam

**The house failure mode is the silent no-op** — a flag parsed and dropped, a
setting persisted and ignored, a capability declared and never read.
`apps/cli/test/unit/architecture/contract-conformance.test.ts` catches some of
it; the rest is this list. On a change that adds or alters behaviour, walk it
before calling the work done and say which entries applied.

- **Declaration → reader.** If you add a flag, config key, capability, or
  contract field, name the code that consumes it. If nothing does, you shipped
  a no-op.
- **Reverse states.** If you added a way in, add the way out and the way to see
  it. Enable needs disable, queue needs dequeue, a one-way door is a bug.
- **Entry points.** A behavior reachable from browse is usually also reachable
  from the command palette, a hotkey, and post-play. Fixing one is not fixing
  the feature.
- **Both lanes.** Anime and TMDB identity resolve differently. A catalog or
  history change needs a decision for each.
- **Every provider.** Provider-shaped changes need a decision per adapter, even
  if the decision is "not supported here".
- **Every platform.** Linux, macOS, and Windows. Most cross-platform CI failures
  here are tests pinning one OS's incidental behavior, not real breakage.
- **Docs.** Update the doc that owns the subject in the same change set.

## Commands

```sh
bun run dev                       # interactive shell
bun run dev -- -S "Dune"          # search on launch
bun run dev -- -i 438631 -t movie # jump to a TMDB id
bun run dev -- -a                 # anime mode
bun run dev -- --debug            # verbose redacted logging to ./logs.txt
bun run dev:relay                 # local relay server
bun run link:global               # install `kunai` from this checkout
```

Before finishing: `bun run typecheck`, `bun run lint`, `bun run fmt`, and
`bun run verify:doc-paths` if you touched `AGENTS.md` or `.docs/`. Use
`bun run test`, never `bun test` directly. Run `bun run build` after a complete
feature — it catches build-only errors. Tests live in `apps/cli/test/{unit,integration,live}/`;
relay smoke is opt-in (see [.docs/testing-strategy.md](.docs/testing-strategy.md)).

A test that needs a timeout or a real sleep to pass is wrong. Anchor injected
clocks past the data they read, never to a hardcoded date.

## Bun-first runtime

Prefer Bun APIs (`Bun.spawn`, `Bun.which`, `Bun.connect`, `Bun.sleep`,
`Bun.file`/`Bun.write`, or `writeAtomicJson` in
[`apps/cli/src/infra/fs/atomic-write.ts`](apps/cli/src/infra/fs/atomic-write.ts))
on Bun-only paths. Keep Node `fs` where its semantics are clearer: append,
crash-safe atomic replace, `copyFile` with mtime checks, and tight
`existsSync`/`unlink` sequences on mpv socket paths. Two gotchas worth knowing:
assets embedded in a compiled binary resolve to `/$bunfs/...`, which `Bun.write`
handles and Node `fs.copyFile` does not; and `setTimeout` (not `Bun.sleep`) is
what gives mpv IPC its cancellable deadlines. Do not change APIs for style alone.

## Deep docs

`.docs/` holds how the system works and why. Read one when your change lands in
its subject — not before, and never the directory end to end.

Four entry points cover most work:

- [feature-map.md](.docs/feature-map.md) — where feature X lives
- [architecture.md](.docs/architecture.md) — playback flow, provider
  orchestration, persistence, recovery
- [runtime-boundary-map.md](.docs/runtime-boundary-map.md) — which layer or
  package work belongs in
- [glossary.md](.docs/glossary.md) — what we call things; product vocabulary is
  pinned by [adr/0001](.docs/adr/0001-personal-media-vocabulary.md)

Everything else routes from [.docs/README.md](.docs/README.md) — the full index,
grouped by subsystem, contract, and working-on-it, and the one that gets updated
when `.docs/` moves. Per-feature product rules live in
[.docs/features/](.docs/features/); provider research dossiers in
[.docs/provider-dossiers/](.docs/provider-dossiers/).

## Where things are written down

One meaning per directory. If two places could hold a file, it belongs in the
more specific one.

| Folder          | Holds                                                                   | Authority                      |
| --------------- | ----------------------------------------------------------------------- | ------------------------------ |
| `.docs/`        | How the system works and why                                            | Current, unless code disagrees |
| `.plans/`       | Unfinished work only, indexed by [.plans/roadmap.md](.plans/roadmap.md) | Intent, not behavior           |
| `.reference/`   | Live material never imported by runtime: design authority, provider lab | Reference                      |
| `.archive/`     | Everything superseded — docs, plans, dead modules                       | **None** — history only        |
| `docs/`         | The public docs site (`apps/docs`); provider and flag tables generated  | Current, user-facing           |
| `.docs/agents/` | Issue tracker, triage labels, domain-doc conventions                    | Current                        |

Never cite a file under `.archive/` as authority for current behavior. The
canonical design boards are HTML under `.reference/design/cli/` — build UI from
those, not from prose summaries.

A landed plan does not stay in `.plans/`: move it to `.archive/plans/` and leave
one roadmap row for the residue. A merged PR is the implementation record — do
not keep a second checklist beside it. Doc rot here is almost always a directory
move that leaves routing docs pointing at the old layout, so
`bun run verify:doc-paths` checks every backticked path and relative link in
`AGENTS.md` and `.docs/`. Cite a removed file only with wording that says so
("the old `x.ts` was removed") — the verifier keys off that.

## User data

Paths are platform-resolved by `getKunaiPaths()` in
`packages/storage/src/paths.ts` — Linux `~/.config/kunai`, macOS
`~/Library/Application Support/kunai`, Windows `%APPDATA%\kunai`. Never hardcode
`~/.config`. Config is `configDir/config.json`; the mpv bridge script is
`configDir/mpv/kunai-bridge.lua`; `kunai-data.sqlite` lives in the OS data dir
and `kunai-cache.sqlite` in the OS cache dir; `./logs.txt` exists only under
`--debug`. SQLite owns history and cache — the JSON history and cache stores are
legacy implementation details.

## Conventions

Issues are GitHub Issues on `KitsuneKode/kunai` — workflow in
[.docs/agents/issue-tracker.md](.docs/agents/issue-tracker.md), labels in
[.docs/agents/triage-labels.md](.docs/agents/triage-labels.md). Domain language
is [.docs/agents/domain.md](.docs/agents/domain.md). Before filing an audit
finding — or acting on one someone else filed — read
[.docs/agents/audit-findings-bar.md](.docs/agents/audit-findings-bar.md): about a
third of the findings this repo has received were true about a line and wrong
about what it does. Kunai is single-context:
one system-wide ADR set in `.docs/adr/`, no per-package context files, and new
ADRs take the next sequential number.
