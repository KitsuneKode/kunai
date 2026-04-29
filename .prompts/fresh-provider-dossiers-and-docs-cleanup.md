# Fresh Agent Prompt: Provider Dossiers And Docs Cleanup

You are working in the Kunai repo as a fresh documentation/research agent.

Goal:
Create production-useful provider dossiers from existing production code and experiment research, then clean obvious documentation drift. This is a read-mostly documentation task. Do not rewrite production provider code.

## Read First

1. `AGENTS.md`
2. `.docs/provider-intake.md`
3. `.docs/provider-examples.md`
4. `.docs/provider-agent-workflow.md`
5. `.docs/templates/provider-research-dossier.md`
6. `.docs/subtitle-resolver-analysis.md`
7. `.docs/providers.md`
8. `.docs/diagnostics-guide.md`
9. `apps/experiments/README.md`
10. `apps/experiments/scratchpads/README.md`

## Production Provider Inputs

Read only the relevant provider files as needed:

1. `apps/cli/src/services/providers/definitions/index.ts`
2. `apps/cli/src/services/providers/definitions/vidking.ts`
3. `apps/cli/src/services/providers/definitions/allanime.ts`
4. `apps/cli/src/services/providers/definitions/allanime-family.ts`
5. `apps/cli/src/services/providers/definitions/cineby.ts`
6. `apps/cli/src/services/providers/definitions/bitcine.ts`
7. `apps/cli/src/services/providers/definitions/braflix.ts`
8. `apps/cli/src/services/providers/definitions/cineby-anime.ts`
9. Existing provider tests, especially AllAnime family tests.

## Experiment Inputs

Use the experiments as evidence, not production truth:

1. `apps/experiments/scratchpads/provider-vidking/HDTODAY_VIDKING_DECRYPT_REPORT.md`
2. `apps/experiments/scratchpads/provider-vidking/VIDKING_NETWORK_ANALYSIS.md`
3. `apps/experiments/scratchpads/provider-vidking/vidking-0-ram-scraper.ts`
4. `apps/experiments/scratchpads/provider-rivestream/RIVESTREAM_DECRYPT_REPORT.md`
5. Relevant `provider-rivestream` scratchpads only if needed.
6. `apps/experiments/scratchpads/provider-anikai/anikai-findings.json`
7. Relevant `provider-anikai` scratchpads only if needed.
8. Relevant `provider-miruro` scratchpads only if needed.

Do not bulk-copy raw logs, minified chunks, captured HTML, or large JSON into docs.

## Write

Create or update:

1. `.docs/provider-dossiers/vidking.md`
2. `.docs/provider-dossiers/allanime-family.md`
3. `.docs/provider-dossiers/cineby.md`
4. `.docs/provider-dossiers/bitcine.md`
5. `.docs/provider-dossiers/braflix.md`
6. `.docs/provider-dossiers/cineby-anime.md`
7. `.docs/provider-dossiers/anikai-candidate.md`
8. `.docs/provider-dossiers/miruro-candidate.md`
9. `.docs/provider-dossiers/rivestream-candidate.md`

Use `*-candidate.md` only for providers that are not active production providers or whose implementation is still experiment-only.

## Required Dossier Sections

Each dossier must include:

- Status: production, experimental, candidate, broken, or unknown.
- Provider ID and domain.
- Supported content: movie, series, anime.
- Runtime class: browser-safe fetch, node fetch, Playwright lease, yt-dlp fallback, debrid, harvest-and-fetch, or unknown.
- Search support.
- Episode/catalog support.
- Stream resolution path.
- Quality/source inventory behavior.
- Header/referrer/user-agent requirements.
- Cache key and TTL recommendations.
- Known failure modes.
- What is proven in production code.
- What is only proven in experiments.
- Minimum tests/fixtures needed before `@kunai/core` extraction.

## Required Subtitle Resolution Section

Every dossier must include a dedicated `Subtitle Resolution` section.

Cover:

- Current production subtitle behavior.
- Experimental/research subtitle findings.
- Exact endpoint or network pattern if known.
- Whether subtitles come from provider payload, Wyzie, embed network sniffing, direct `.vtt`/`.srt`, or are missing.
- Language matching rules.
- SDH/hearing-impaired filtering recommendation.
- CLI/mpv format preference: prefer `.srt` when reliable; `.vtt` is acceptable.
- Future web format preference: `.vtt`.
- Whether subtitle fetch can happen before playback starts.
- Whether subtitle resolution needs Playwright or can be 0-RAM fetch.
- Subtitle list cache TTL recommendation, usually around 24h unless evidence says otherwise.
- Failure modes: empty list, wrong language, lazy-loaded request, Cloudflare block, expired URL, payload mismatch.
- Exact production gap: what is broken, unreliable, missing, or untested today.
- Minimum production fix needed.
- Tests/fixtures needed before claiming subtitle support works.

Important:
Do not just write "supports subtitles." Explain how subtitles are found, selected, cached, validated, and passed to `mpv`.

## Docs Cleanup Scope

After dossiers, do a minimal doc drift cleanup.

Read:

1. `README.md`
2. `AGENTS.md`
3. `.docs/architecture.md`
4. `.docs/architecture-v2.md`
5. `.plans/roadmap.md`
6. `.plans/storage-hardening.md`
7. `.plans/turborepo-and-package-boundaries.md`
8. `.plans/agent-routing-prompts.md`
9. `.docs/quickstart.md`
10. `.docs/diagnostics-guide.md`

Search for stale current-truth wording:

- `@kunai/cache`
- `packages/cache`
- `stream_cache.json` as current/default
- `history.json` as current/default
- `JSON compatibility` as current goal
- remote sync as immediate
- daemon as immediate/core for CLI
- web/desktop as immediate
- old KitsuneSnipe naming in current user-facing docs
- subtitle reliability overclaims

Rules:

- Keep brainstorm historical docs unchanged unless they are linked as current truth.
- Preserve references explicitly marked legacy or historical.
- If subtitles are currently broken or partially unreliable, docs should say subtitle support exists but provider-specific subtitle hardening is in progress.
- Do not claim subtitles are fully reliable until provider-specific tests prove it.

## Hard Boundaries

- Do not edit production provider code.
- Do not edit playback, storage, shell, or package code.
- Do not run live provider checks unless explicitly asked.
- Do not promote scratchpad code into production.
- Mark uncertain claims as uncertain.
- Keep docs factual and concise.

## Verification

Run:

```sh
rg -n "@kunai/cache|packages/cache|stream_cache\\.json|history\\.json|JSON compatibility|remote sync|daemon|web/desktop|KitsuneSnipe|subtitle" README.md AGENTS.md .docs .plans
git diff --check
```

In your final report, explain which remaining hits are acceptable historical/legacy references.

Report:

- Dossiers created/updated.
- Subtitle gaps found.
- Docs drift fixed.
- Remaining uncertain provider claims.
- Verification results.
