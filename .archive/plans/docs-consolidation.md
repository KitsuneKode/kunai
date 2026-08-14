# Docs and reference consolidation

Status: DONE — landed 2026-08-14. All five steps plus the content practices.
The ADR promotion was investigated and deliberately dropped; see below.
Origin: roadmap.

**Done:** glossary (`.docs/glossary.md`, 12 trap-first terms, anchors checked by
`verify:doc-paths`), `CONTEXT.md` pointer retired, frontmatter + L3 banner on all
57 live `.docs` files, `scripts/verify-doc-frontmatter.ts` gating both in CI, and
**step 1 — `.archive/`** (310 files from five locations, one ignore rule, all
references rewritten).

**Done (cont.):** **step 2 — `.reference/`** (80 files; `apps/` is now exactly the
four workspace apps), **step 3 — `.plans/` merge** (`plans/` deleted, K-table
moved verbatim, 15 numbered plans keep their ids), **step 4 — `.docs/agents/`**
(`docs/` is now purely the published site).

**Done (cont.):** **step 5 — source-comment scanning**. `verify:doc-paths` now
covers 1854 source files as well as 46 docs, resolving package-relative first.
It found five dead citations that no checker could previously see: three to the
old `docs/superpowers/` and two to a plan that had been archived.

### Step 1 notes

- `verify-doc-paths.ts` needed **no** `EXCLUDED_DIRS` change. The walker only
  descends from `SCANNED_ROOTS`, and `.archive/` is not one — the spec's original
  claim here was over-cautious. The stale `"archive"` name entry is now inert but
  harmless.
- `boundary-imports.test.ts:19` needed no change, as predicted: its regex matches
  the `legacy` path segment, and `.archive/legacy` still contains the literal
  `archive/legacy` besides.
- `apps/cli/test/unit/scripts/build-shared.test.ts` **did** need a fix beyond the
  path rename: the guard returns a `.sort()`ed list, and `.archive/…` sorts before
  `.plans/…`, so the expected array order changed.
- Relative links of the form `](./archive/x.md)` were invisible to a
  substring rewrite and had to be fixed per directory, since each old `archive/`
  maps to a different `.archive/` subtree.

### Step 2 notes

- Files with no matching extension are invisible to a source rewrite and had to
  be found by hand: `.claudeignore`, `.cursorignore`, `.gitignore`
  (`.design/cli/*.gif`), and `.oxlintignore` (`apps/experiments/**`).
- `apps/docs/app/opengraph-image.tsx` resolves a **real asset at runtime**
  (`../../.reference/design/brand/kunai-mascot-og.png`), so this rename could
  have broken the OG image silently. Verified by rebuilding the docs site.
- `boundary-imports.test.ts:19` again needed no change: the regex matches the
  `experiments` path segment, which `.reference/experiments` still contains.
- `packages/design` is untouched and must stay that way — it is shipped code, not
  reference. The rewrite patterns require a literal leading dot (`.design`).

### Steps 3–4 notes

- The approved sketch put an `Origin` column on every active-track table. A
  dedicated `### Production readiness — external audit` subsection carries the
  same information without repeating "roadmap" on 18 unrelated rows, so the
  numbered plans went there instead. Same outcome, less noise.
- Moving `docs/agents/` into `.docs/` put three previously unstamped files inside
  the frontmatter gate, which failed exactly as designed. Their `lastReviewed`
  came back `unknown` because a `git mv` has no history at the new path until it
  is committed — the dates were read from the old paths instead.
- That exposed a real hole: `lastReviewed: "unknown"` satisfied the original
  check. `verify-doc-frontmatter.ts` now requires an ISO `YYYY-MM-DD` date.
- `docs/installer-reference/` is gitignored local material, left alone.

### Step 5 notes

- **Paths in comments are usually package-relative.** A comment inside
  `apps/cli/scripts/` naming `scripts/build-binaries.ts` means its sibling. A
  naive repo-root check reported 17 dead paths; 14 were this false positive.
  The check resolves package-relative first, then repo-relative.
- **A negative test found a real bug in the checker.** A path ending a sentence
  (`…/foo.md.`) captured its trailing period, failed the extension test, and was
  skipped silently. Stripping trailing punctuation then exposed two more genuine
  dead citations that had been invisible. A checker nobody has watched fail is
  not known to work.
- Only comment spans are scanned, never string literals — a path in a literal is
  usually runtime data, not a citation.
- CI: `verify:doc-paths` moved onto the cheap `checks-doc-coverage` job, whose
  filter now covers `apps/**` and `packages/**`. Putting it only on the `docs`
  filter would have skipped it on the code PRs most likely to break it, and
  widening the `docs` filter instead would drag the full site build onto every
  code PR.

One meaning per top-level directory, one archive, one plan board, and doc
authority that a grepped fragment can state about itself.

## Problem

The repo carries 440 tracked doc files. **308 of them (70%) are history**, spread
across five locations with separate exclusion rules. A further 80 files of live
reference material (`.design/`, `apps/experiments/`) sit outside both. Beyond
the volume:

- **Two live plan boards.** `.plans/roadmap.md` (roadmap tracks) and
  the old `plans/README.md` (numbered audit residue) are each accurate and each
  disclaims the other, but "`.plans` or `plans`?" is a question on every visit.
- **`docs/` means two things.** `apps/docs/source.config.ts` renders only
  `index.mdx`, `users/**`, and `developer/**` — 33 of the 130 files. The other 97
  under `docs/` (`agents/` 3, `superpowers/` 94) are never published. They look
  published and are not.
- **Live reference material is misfiled.** `apps/experiments/` (39 files) is the
  provider research lab but is **not in the workspaces list**, so it sits in
  `apps/` implying it is an app. `.design/` (41 files) is cited as design
  authority from runtime source comments but carries no README saying so.
- **No doc self-identifies.** No banners, no frontmatter. A fragment read out of
  context cannot be placed as authority, history, or aspiration.
- **No glossary, and the pointer to one is dangling.** `docs/agents/domain.md`
  routes agents to `CONTEXT.md` as the ubiquitous language. That file has never
  existed. `.docs/adr/` holds exactly one ADR.

## Target layout

```
AGENTS.md              CLAUDE.md -> AGENTS.md (symlink, unchanged)

.docs/        60     agent subject docs (L3)
  glossary.md          NEW — ubiquitous language, source-anchored
  agents/              <- from docs/agents/        (3)
  adr/ features/ templates/ research/ provider-dossiers/

.plans/       ~39    ONE board
  roadmap.md           THE index; absorbed the old plans/README.md K-table
  006-*.md 021-*.md 046-*.md    numbered IDs preserved

.reference/   80     live, never imported by runtime
  README.md
  design/              <- from .design/            (41)
  experiments/         <- from apps/experiments/   (39)

.archive/     308    no authority
  README.md
  docs/                <- from .docs/archive/      (30)
  plans/               <- from .plans/archive/    (122)
  numbered-plans/      <- from plans/archive/      (34)
  superpowers/         <- from docs/superpowers/   (94)
  legacy/              <- from archive/legacy/     (28)

docs/         33     PUBLISHED SITE ONLY (L2)
  index.mdx  users/  developer/  *.yaml  meta.json

apps/                cli  docs  relay-server  telemetry-ingest
```

Nothing is deleted. The win is not fewer files — it is fewer _places_:

|                         | Before                 | After             |
| ----------------------- | ---------------------- | ----------------- |
| History locations       | 5                      | 1 (`.archive/`)   |
| Live plan boards        | 2                      | 1 (`.plans/`)     |
| Live reference trees    | 2, unlabeled           | 1 (`.reference/`) |
| Meanings of `docs/`     | 2 (site + junk drawer) | 1 (site)          |
| Archive exclusion rules | 6 across 3 files       | 1 per file        |

Live doc surface stays 132; `plans/`, `.design/`, and `apps/experiments/` cease
to exist as top-level concepts.

The L3 boundary from `docs/developer/docs-maintenance.mdx` is preserved: agent
docs stay outside `docs/`, and `docs/promotion-manifest.yaml` keeps tracking the
L3→L2 promotion path with unchanged `.docs/*` paths.

## Migration

One commit per tree so any single step reverts cleanly. Each commit carries its
own enforcement updates — never a rename without the checker change.

### 1. `.archive/`

Move all five history trees. Add `.archive/README.md` stating: no authority,
history only, never cite as current behavior, fix the live doc instead.

- `scripts/verify-doc-paths.ts:29` — add `.archive` to `EXCLUDED_DIRS`. The
  existing `"archive"` entry is a **directory-name** match and will not catch
  `.archive`.
- `.claudeignore` / `.cursorignore` — replace the four archive rules and the
  `docs/superpowers/` pair with one `.archive/` line.
- `boundary-imports.test.ts:19` — **no change.** The regex matches the `legacy`
  path _segment_, so `.archive/legacy` stays guarded against runtime imports.
  Verify this with a test run rather than by reading.

### 2. `.reference/`

Move `.design/` → `.reference/design/`, `apps/experiments/` →
`.reference/experiments/`. Add `.reference/README.md`: live reference, never
imported by runtime code, not archive.

- `package.json` — three scripts break: `brand:social`
  (`.design/brand/generate-social-cards.mjs`), `experiments:install`,
  `experiments:list` (both `--cwd apps/experiments`).
- `boundary-imports.test.ts:162` — `skipPrefixes: ["apps/experiments"]` →
  `[".reference"]`.
- `.docs/feature-map.md` — two rows cite `apps/experiments/*` (lines ~72, ~177).
- `.docs/playback-source-inventory-contract.md:10` — cites
  `apps/experiments/scratchpads/provider-*/*.md`.
- Runtime comments citing `.design/`: `app-shell/calendar-view.ts:4`,
  `app-shell/SakuraLoader.tsx:4`.
- The existing `apps/experiments/scratchpads/skill-headless-scraper/SKILL.md`
  moves with the tree; it is not promoted (repo skills are out of scope).

### 3. `.plans/` merge

Move `plans/*.md` into `.plans/`, keeping numeric prefixes so `006`, `021`, `046`
stay valid — they are cited by the K-reconciliation table and by commit
messages. Merge the old `plans/README.md` into `.plans/roadmap.md`:

- The K-01–K-17 table moves **verbatim**. Both boards were reconciled upstream
  on 2026-08-14, so this is content-preserving, not a rewrite.
- Active-track tables gain an `Origin` column: `audit` or `roadmap`.
- Keep the archive rule and the status vocabulary
  (`TODO · PARTIAL · BLOCKED (reason) · IN PROGRESS`).
- Delete `plans/`. Update `.plans/roadmap.md`'s "Separate tracker" section,
  which will no longer be true.

### 4. `.docs/agents/`

Move `docs/agents/{domain,issue-tracker,triage-labels}.md` into `.docs/agents/`.

- `scripts/verify-doc-paths.ts:28` — `SCANNED_ROOTS` becomes
  `["AGENTS.md", ".docs"]`; `docs/agents` is now inside `.docs`.
- `AGENTS.md` authority table and any `docs/agents/` links.
- `docs/agents/domain.md` — remove the `CONTEXT.md` instruction and point at
  `.docs/glossary.md` (see below).

## Content practices

### Glossary

`.docs/glossary.md`. Each term defined in prose, anchored to a real source path
via a reference-link block at the bottom of the file. Because `.docs` is a
scanned root, `verify-doc-paths.ts` validates every anchor for free — a rename
breaks CI instead of rotting silently.

Terms to define, each **written against the code, not from memory**: title,
episode, candidate, lane (dual-lane resolve), crosswalk, continuation, resolve
trace, offline job, playable identity, provider vs source, endpoint health,
hedging, relay, support bundle, K-id.

Retire the `CONTEXT.md` pointer in `docs/agents/domain.md` in the same change.

### ADRs — investigated, deliberately not done

The plan was to promote "pressure-tested decisions" out of
`.plans/kunai-principal-grill-qa.md` into numbered ADRs. **Reading the source
killed the idea**, which is the outcome the "confirm before writing" instruction
existed to produce.

All ~40 sections of that 937-line file are framed as **"Recommended answer"** —
strategic direction, not ratified decisions. Worse, most of it governs surfaces
the roadmap explicitly parks:

- The three-tier architecture and "should the web app depend on cloud compute"
  concern web/desktop/premium-cloud tiers that are **not scheduled**.
- The Cloudflare "provider RPC relay" is a design for that future web tier, not
  the relay Kunai ships today.
- The provider spec section is already **implemented and documented** —
  `ProviderManifest`, `ResolveTrace`, health deltas, structured failure codes —
  in `.docs/providers.md` and `.docs/provider-intake.md`.

Promoting any of these would elevate parked speculation to system-wide
architectural authority and duplicate the `AGENTS.md` non-negotiables. That is
precisely the aspirational-vs-current confusion this consolidation exists to
remove.

**Decision: leave the file where it is.** `.plans/` is the right home for
direction that is not yet a decision, the roadmap already labels it correctly,
and the genuinely load-bearing rules (relay stays metadata-only, no shared public
relay URL, production providers come from one loader) are already
non-negotiables in `AGENTS.md`. Write an ADR when a decision is actually ratified
and governs current code — not to relocate prose.

### Banners and frontmatter

Every `.docs/**/*.md` opens with:

```markdown
---
status: current
lastReviewed: 2026-08-14
---

# Title

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.
```

Every `.archive/**/*.md` gets the no-authority banner instead. Enforce presence
with a check — a missing banner is how t3code's one un-audited file was
identified, so absence is a useful signal, not just a style miss.

### 5. Verifier extension

Extend `verify-doc-paths.ts` to scan backticked doc paths in comments under
`apps/*/src` and `packages/*/src`. Known offenders today:

| File                                                    | Cites               |
| ------------------------------------------------------- | ------------------- |
| `apps/cli/src/app/playback/playback-postplay-policy.ts` | `docs/superpowers/` |
| `apps/cli/src/infra/player/kunai-mpv-bridge.ts`         | `docs/superpowers/` |
| `packages/providers/src/videasy/direct.ts`              | `docs/superpowers/` |
| `apps/cli/src/app-shell/calendar-view.ts`               | `.design/`          |
| `apps/cli/src/app-shell/SakuraLoader.tsx`               | `.design/`          |

Expect more once it runs. Land this **last** — it has the widest blast radius
and its failures are unrelated to the moves.

## Risks

1. **~450 renames.** Split per tree as above; each commit is independently
   revertible and `git log --follow` still works.
2. **Source comments are unchecked until step 5.** Steps 1–4 move paths that
   comments cite. Fix the five known offenders inside the commit that moves
   their target; the verifier extension then catches the rest.
3. **`.archive` name-match gap.** `EXCLUDED_DIRS` matching by directory name is
   the one place a silent regression hides — `.archive` skipped by the walker
   but not by the exclusion set would scan 308 stale files and fail CI loudly,
   which is the safe direction. Confirm by running the checker.
4. **Glossary accuracy.** Definitions written from memory rather than code would
   be worse than no glossary. Every term needs a source anchor before it ships.

## Out of scope

- **Repo skills** (`.agents/skills/` + `.claude/skills` symlink). Considered and
  declined for this change set.
- **Deleting history.** `.archive/` keeps it in-tree and browsable, out of agent
  context.
- The four open audit findings (K-04, K-08, K-16, K-17). Tracked on the merged
  board, not here.

## Definition of done

- `bun run verify:doc-paths` and `verify:doc-coverage` green.
- `bun run test` green, including `boundary-imports` and `contract-conformance`.
- `bun run --cwd apps/docs build` green — the published site is untouched.
- `package.json` scripts run: `brand:social`, `experiments:list`.
- No live doc, plan, or source comment cites `plans/`, `.design/`,
  `apps/experiments/`, `docs/superpowers/`, or `docs/agents/`.
- `.plans/roadmap.md` is the only plan index; `plans/` does not exist.
