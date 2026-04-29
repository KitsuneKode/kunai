# Provider Hardening Plan

Status: Planned around Provider SDK boundary

Use this plan when improving scraping depth, stream-source inventory, subtitles, quality variants, dub handling, or the workflow for adding a new provider.

## Goal

Turn provider work from "grab the first playable URL" into a repeatable system that:

- inventories all useful stream candidates when possible
- preserves source/mirror, quality, audio, subtitle, hard-sub, header, expiry, and confidence metadata
- surfaces better diagnostics and fallback decisions
- makes new-provider research reproducible and reviewable
- separates research, implementation, and regression follow-up

## Why This Exists

- some providers expose multiple upstream stream sources per episode
- current scraping often stops at the first successful path
- subtitles, quality labels, hard-subbed streams, and dub language support are not modeled consistently
- new-provider work is too easy to do ad hoc and too hard to audit later
- provider drift is inevitable; we need dossier-quality notes and fixtures to recover quickly

## Deliverables

Each provider should eventually have:

- a research dossier capturing knowns, unknowns, screenshots, URL patterns, iframe chains, network findings, and candidate streams
- an implementation handoff that maps findings to repo contracts
- a provider module behind the Kunai Provider SDK interface
- regression fixtures or sample titles that can be revisited when the site changes
- diagnostics conventions for explaining what was discovered and what failed

## Provider SDK Shape

Kunai uses a flexible candidate model instead of assuming every upstream site exposes the same tree.

Conceptual hierarchy:

```text
Provider
  -> Source / Mirror
    -> Variant
      -> stream URL or deferred locator
      -> subtitles
      -> audio language
      -> hard-sub metadata
      -> protocol/container
      -> headers/referer requirements
      -> expiry and confidence
```

Rules:

- the provider handles its own source/mirror loop and provider-specific retry details
- the resolver handles provider-level fallback, ranking, cache reads/writes, health scoring, and user policy
- the provider returns the selected stream plus all discovered candidates when possible
- the provider returns trace events so internal retries are observable instead of black-box magic
- the provider never imports UI, mpv, SQLite, app config, or Playwright directly
- runtime needs are requested through ports such as `fetch`, `browserLease`, and future `ytDlp`

Trace events should cover:

- provider started / provider exhausted
- source or mirror started
- source or mirror failed, skipped, timed out, or succeeded
- variant selected
- subtitle discovered or rejected
- cache hint emitted
- runtime browser lease requested, started, reused, or released
- retry scheduled or aborted

User controls that must be possible from the app layer:

- cancel resolution
- skip current source/mirror
- retry same provider fresh
- force no-cache
- fallback to another provider
- select provider, source/mirror, quality/variant, audio language, and subtitle language when candidates are known

## Workstreams

### Workstream 1: Intake And Research Workflow

- define the required inputs from the developer for a new provider
- standardize the dossier format
- store research findings in repo docs instead of chat-only memory
- require "dossier first, code second" for new providers and major provider rewrites

See [.docs/provider-intake.md](../.docs/provider-intake.md).

### Workstream 2: Capability Model

- represent whether a provider supports:
  - movie / series / anime
  - multi-source stream inventory
  - quality variants
  - dub / sub language variants
  - hard-subbed streams
  - subtitle extraction
  - referer or header requirements
  - click activation
  - nested embed chains
- stop treating every provider as if it only returns one opaque stream URL

### Workstream 3: Inventory-First Resolution

- separate "provider inventory extraction" from "final stream resolution"
- capture all candidate mirrors for a title or episode when the provider exposes them
- store enough metadata to rank or filter candidates later
- avoid expensive final resolution prefetch unless it is clearly worth the cost
- allow providers that reveal quality/subtitle details late to return evidence-backed partial candidates instead of lying about a full tree

### Workstream 4: Diagnostics And Reports

- show which research or resolution stage failed
- record what embeds, manifests, and subtitle endpoints were seen
- capture why candidates were accepted or rejected
- generate privacy-safe local reports that help debug provider drift
- feed live trace events to the TUI so retries and timeouts are visible while they happen

### Workstream 5: Regression And Drift Response

- define what evidence to keep for each provider so future breakage is faster to diagnose
- maintain sample titles for movies, series, anime, dub, sub, hard-sub, multi-quality, subtitle, and fallback cases
- document how to re-run research when a provider changes behavior

### Workstream 6: Runtime Browser Isolation

- create a JIT Playwright runtime boundary instead of letting providers import browser tooling directly
- own browser launch, lease reuse, interception, timeout, cooldown, bot-risk reduction, and teardown in one runtime package
- capture privacy-safe browser evidence so repeat resolves avoid unnecessary browser work when cache policy allows it
- expose browser work through runtime ports so CLI, desktop daemon, and future paired web can choose capabilities safely

### Workstream 7: Cache And Health Intelligence

- separate cache layers for metadata, provider inventory, stream manifests, subtitle lists, browser evidence, health, and traces
- keep SQLite local-first for CLI/desktop while preserving portable policy for future IndexedDB or daemon-backed caches
- track provider-level and source/mirror-level health locally: success rate, median latency, subtitle success, recent timeout spikes, and failure reasons
- use health as ranking input without making provider modules stateful

### Workstream 8: AllAnime / Ani-CLI Parity Discipline

- treat ani-cli as the canonical reference for AllAnime or AllManga behavior while it remains maintained
- on this machine, use the local checkout at `~/Projects/osc/ani-cli` for parity checks
- when both Kunai and ani-cli are broken, isolate the shared upstream break from local integration bugs
- allow temporary local fixes in Kunai when upstream is broken, but record:
  - what diverged
  - why the divergence exists
  - how to remove it once upstream parity is restored
- preserve at least one regression case for search, episode lookup, `tobeparsed`, and final source extraction

## Phase Plan

### Phase 0: Workflow Foundations

- add provider-intake docs and templates
- add repo-local agent instructions for provider research
- update AGENTS/docs routing so provider work follows the same playbook

### Phase 1: Research Artifacts

- start storing provider dossiers for high-value or fragile providers
- create a first pass for VidKing inventory research
- define a dossier checklist for screenshots, network traces, and sample titles
- use `apps/experiments/scratchpads/provider-*` and report files as source evidence, not production imports

### Phase 2: Runtime Modeling

- add a richer internal capability model
- add candidate stream inventory types rather than one winner-only path
- keep stream, subtitle, audio, and quality metadata composable
- add source/mirror/variant trace events and abort/retry semantics

### Phase 3: Resolver Upgrades

- support ranking and choosing among multiple candidate streams
- support configurable recovery and fallback policy
- improve subtitle and dub selection behavior
- wire provider/source health into ranking and fallback
- attach all usable subtitles to playback when possible while honoring default language config

### Phase 4: Regression Safety

- attach fixtures and diagnostics expectations to each hardened provider
- document drift response steps and re-research triggers

### Phase 5: Runtime And UX Integration

- extract JIT Playwright into a runtime package
- stream resolution trace events into the TUI
- expose cancel, skip, retry, fallback, source selection, quality selection, and subtitle selection affordances
- show a health map for provider/source availability and likely fault origin

## Acceptance Criteria

- adding a provider no longer starts with code guessing
- every serious provider change begins with an evidence-backed dossier
- runtime contracts can represent more than one stream candidate
- subtitle, quality, and dub handling are modeled explicitly
- provider drift can be diagnosed from stored research and local reports
