# Cineby Source Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure Cineby-exposed Videasy flavors and decide, from redacted five-second playback evidence, which choices are useful provider-local inventory rather than speculative production fallback.

**Architecture:** `apps/experiments` owns live/research probes and redacted reports; production `packages/providers/src/cineby/index.ts` remains research-only during this plan. Any later promotion is a separate reviewed runtime change based on the collected report.

**Tech Stack:** Bun, TypeScript, existing direct provider modules, optional manual browser observation by the user, `mpv` five-second proof mode.

---

## File Map

- `apps/experiments/scratchpads/provider-latency-bench.ts`: add flavor-aware Cineby cases and safe reporting fields.
- `apps/experiments/scratchpads/provider-cineby/cineby-source-matrix.ts`: create deterministic wrapper that benchmarks known flavors without writing media URLs.
- `apps/experiments/scratchpads/provider-cineby/CINEBY_SOURCE_INTAKE.md`: record measured capability/latency/playability evidence.
- `.docs/provider-dossiers/cineby.md`: update conclusions and promotion gate.
- `.docs/provider-dossiers/vidking.md`: record any confirmed shared Videasy behavior.
- `packages/providers/src/cineby/index.ts`: read-only during intake; change only in a separately approved promotion slice.

---

### Task 1: Build A Redacted Cineby Flavor Benchmark

**Files:**

- Create: `apps/experiments/scratchpads/provider-cineby/cineby-source-matrix.ts`
- Modify: `apps/experiments/scratchpads/provider-latency-bench.ts`

- [ ] **Step 1: Add explicit flavor cases without raw URL output**

Expose an experiments-only case builder shaped as:

```ts
type CinebyFlavorBenchRow = {
  readonly label: string;
  readonly server: string;
  readonly audioLanguage: string;
  readonly resolveMs: number | null;
  readonly manifestMs: number | null;
  readonly mpvStarted: boolean;
  readonly mpvMs: number | null;
  readonly streamCount: number;
  readonly subtitleCount: number;
  readonly qualityLabels: readonly string[];
  readonly hosts: readonly string[];
  readonly failureClass: string | null;
};
```

Use the existing `cinebyProviderModule`/VidKing engine path and only retain host names, quality labels, counts and classified failures. Do not serialize stream, manifest or subtitle URLs.

- [ ] **Step 2: Run type checking for the experiment surface**

Run:

```sh
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit the research harness**

```sh
git add apps/experiments/scratchpads/provider-cineby/cineby-source-matrix.ts apps/experiments/scratchpads/provider-latency-bench.ts
git commit -m "test(experiments): add redacted Cineby source matrix"
```

---

### Task 2: Collect Manual Live Evidence With Playback Proof

**Files:**

- Create: `apps/experiments/scratchpads/provider-cineby/CINEBY_SOURCE_INTAKE.md`

- [ ] **Step 1: Run focused live cases after user approval for network testing**

Run:

```sh
cd apps/experiments
bun scratchpads/provider-latency-bench.ts --series --episodes=1,2 --providers=vidking,cineby,rivestream --mpv --mpv-play-seconds=5
bun scratchpads/provider-cineby/cineby-source-matrix.ts --tmdb=76479 --season=1 --episodes=1,2 --mpv --mpv-play-seconds=5
```

Expected: each successful result proves five seconds of playback and reports safe host/quality/timing counts; failures are recorded as classified outcomes.

- [ ] **Step 2: Record evidence without assuming website parity**

Write a table containing:

```md
| flavor | server | episode | resolve ms | first play ms | best known quality | subtitles | result | promotion note |
| ------ | ------ | ------: | ---------: | ------------: | ------------------ | --------: | ------ | -------------- |
```

State whether a route reuses known Videasy behavior or exposes a distinct contract. Do not state that a failing route is globally dead from a single local run.

- [ ] **Step 3: Commit only the redacted evidence**

```sh
git add apps/experiments/scratchpads/provider-cineby/CINEBY_SOURCE_INTAKE.md
git commit -m "docs(experiments): record Cineby source evidence"
```

---

### Task 3: Update Dossiers And Make A Promotion Decision

**Files:**

- Modify: `.docs/provider-dossiers/cineby.md`
- Modify: `.docs/provider-dossiers/vidking.md`

- [ ] **Step 1: Classify each measured flavor**

For each measured route, classify it as exactly one:

```md
- `validated-local-flavor`: successful five-second playback and VidKing-compatible behavior.
- `observed-unplayable`: resolved or attempted but did not pass playback proof in this run.
- `unmeasured`: identified from site evidence but not validated by the harness.
- `distinct-contract`: behavior is not covered by VidKing and requires a separate reviewed provider design.
```

- [ ] **Step 2: State the production recommendation**

Only recommend a later production change when at least one flavor is `validated-local-flavor`. The recommendation must say whether it should extend VidKing/Videasy local inventory or receive a distinct provider contract; do not register broad fallback routes in this research commit.

- [ ] **Step 3: Commit dossier reconciliation**

```sh
git add .docs/provider-dossiers/cineby.md .docs/provider-dossiers/vidking.md
git commit -m "docs: classify Cineby provider intake evidence"
```

---

### Task 4: Final Combined Manual Comparison

**Files:**

- No production code changes.

- [ ] **Step 1: Run comparison after the fast-first runtime tranche is green**

Run:

```sh
cd apps/experiments
bun scratchpads/provider-latency-bench.ts --series --episodes=1,2 --providers=vidking,cineby,rivestream --mpv --mpv-play-seconds=5
bun scratchpads/provider-latency-bench.ts --anime --query="solo leveling" --episodes=1 --providers=allanime,miruro --mpv --mpv-play-seconds=5
```

Expected: produce a final, user-observed comparison of first-play latency and five-second playback proof; use that evidence to tune startup policy budgets or approve a narrowly scoped Cineby promotion plan.
