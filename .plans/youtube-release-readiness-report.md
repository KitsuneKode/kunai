# YouTube v1 Release Readiness Report

**Date:** 2026-06-25  
**Scope:** YouTube Phase 4 + release reliability sweep  
**Recommendation:** **Go** (with documented limitations)

---

## Gate results

| Gate                        | Result | Notes                                                                                                                         |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `bun run fmt:check`         | Pass   |                                                                                                                               |
| `bun run lint`              | Pass\* | 0 errors, 3 pre-existing warnings; oxlint occasionally SIGSEGV/SIGBUS in this environment after completing                    |
| `bun run test`              | Pass   | 2399 pass, 7 skip, 0 fail                                                                                                     |
| `bun run typecheck`         | Pass   |                                                                                                                               |
| `bun run build`             | Pass   | `dist/kunai.js` 2.3 MiB (budget raised to 2560 KiB for YouTube bundle)                                                        |
| `bun run pkg:check`         | Pass   |                                                                                                                               |
| `bun run release:dry-run`   | Pass   |                                                                                                                               |
| `bun run test:live:youtube` | Pass   | `streamResolved: true`, `streamHost: www.youtube.com`; `parse-failed` in failureCodes is non-blocking when watch URL resolves |

\*Re-run lint if the runner crashes with SIGSEGV after reporting 0 errors.

---

## Layer inventory

| Layer                                           | Status                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Provider** (`packages/providers/src/youtube`) | Invidious/Piped/ytsearch search, yt-dlp resolve gate, live/upcoming mapping, SponsorBlock ytdl args, fixture tests     |
| **CLI services**                                | Invidious health probe, diagnostics events, download cookie/SponsorBlock parity, configure-youtube rebind              |
| **Shell UI**                                    | Settings YouTube section, diagnostics panel rows, setup yt-dlp required copy, stats `video` kind, `#N` playlist labels |
| **Storage**                                     | `youtube_metadata_cache`, history `mediaKind: video`, watch stats                                                      |
| **Tests**                                       | Provider fixtures, panel-data probe test, stats video test, `youtube.smoke.ts`, provider matrix entry                  |
| **Docs**                                        | `providers.md`, `release-reliability-gate.md`, roadmap, plan-implementation-truth, changeset                           |

---

## Known limitations

- **Piped live badge:** Piped search maps `liveStatus: "none"`; live badges come from Invidious or yt-dlp paths only.
- **Invidious instance churn:** Public instance pool rotates; custom `youtubeMetadata.instanceUrl` recommended for reliability.
- **Age-restricted content:** Requires user-supplied cookies via settings; no shipped defaults.
- **Live smoke parse-failed:** Metadata extract can warn while watch URL + ytdl playback still resolves (fixture: Me at the zoo).
- **Manual golden path:** SponsorBlock skip and full 12-step matrix require manual verification (documented in release gate).

---

## Blockers

None for YouTube v1 release candidate.

---

## Manual golden path checklist

Operator should verify before tagging release (see `.docs/release-reliability-gate.md` YouTube section):

- [ ] Mode cycle to youtube lane
- [ ] Search, play, quality, continue
- [ ] Playlist `#N` labels and playback
- [ ] Share round-trip
- [ ] Download with optional subs
- [ ] SponsorBlock (manual)
- [ ] Diagnostics probes visible
- [ ] Settings rebind without restart
- [ ] Missing yt-dlp blocks play with actionable message
