# TODO

> **Canonical trackers live elsewhere.** This file is intentionally thin to avoid
> drift. For current status use:
>
> - [.plans/roadmap.md](.plans/roadmap.md) — the only index of active work
> - [AGENTS.md](AGENTS.md) — routing, boundaries, and which folder owns what
>
> When a plan disagrees with the repo, the repo wins. Landed plans live in
> [.plans/archive/](.plans/archive/README.md) and carry no authority.
>
> The old contents of this file described a pre-SQLite / pre-Ink runtime
> (`history.json`, `stream_cache.json`, fzf binary, "SQLite migration deferred").
> All of that has shipped — SQLite storage lives in `packages/storage`, the Ink
> shell is the active runtime. Those entries were removed on 2026-05-28.

## Legacy bug entries to triage (re-verify against the current runtime)

These predate the Ink + SQLite rewrite and may already be resolved. Do not treat
as confirmed-open until reproduced on `main`:

- **`[c]` settings pre-search gate** — described against the old `text()` prompt
  flow; the Ink command bar likely supersedes it. Confirm against the current
  shell before acting.
- **mpv re-open after natural exit** — original suspect was an expired AllAnime/
  wixmp token served from a long-lived cache. The CLI stream cache TTL is now
  15 min (under the ~20 min token lifetime), so this is likely mitigated; re-test
  and close if it no longer reproduces.
- **CinebyAnime `needsClick`** — lived on the Playwright embed-scrape path, now
  quarantined under `archive/legacy/`. Only relevant if/when that path returns.

## Deferred (tracked in plans, not here)

- YouTube provider — [.plans/yt-provider.md](.plans/yt-provider.md)
- Search service decoupling — [.plans/search-service.md](.plans/search-service.md)
- Provider hardening — [.plans/provider-hardening.md](.plans/provider-hardening.md)
