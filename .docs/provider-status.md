---
status: current
lastReviewed: "2026-10-03"
---

# Provider status: the daily check and the page that shows it

> Agent-facing (L3). Never linked from published docs. Users: see
> `docs/users/provider-status.mdx` and the `/status` page.

Read this before touching the sweep, the `status-data` branch, the workflow, or
`apps/docs/lib/provider-status*.ts`.

## What it is

A scheduled job resolves a known-good title through every registered provider from
GitHub's network once a day and publishes the result. The docs site shows it at
`/status` (and embedded in the provider-status guide) without a release.

```
provider-status-sweep.yml (06:23 UTC daily, or dispatched by hand)
  └─ packages/providers/scripts/provider-status-sweep.ts      probes every provider
       ├─ generated-provider-status.json            latest result per provider
       └─ generated-provider-status-history.json    one status per provider per day, 60 days
  └─ packages/providers/scripts/status-data-branch.sh publish → `status-data` branch

apps/docs  /status, ProviderStatusBoard
  └─ lib/provider-status-live.ts   fetches the three files from `status-data`, cached 10 min
  └─ lib/provider-status.ts        parses, validates, derives (pure, tested)
```

Three documents feed the page. Each has a bundled seed in `apps/docs/lib/` that the
site falls back to, and a live copy on `status-data`:

| Document                   | Seed in `apps/docs/lib/`                 | Written by            |
| -------------------------- | ---------------------------------------- | --------------------- |
| Latest result per provider | `generated-provider-status.json`         | the sweep             |
| Daily history              | `generated-provider-status-history.json` | the sweep             |
| Notices                    | `status-notices.json`                    | a maintainer, by hand |

The live copy wins only if it parses and is not older than the seed (`chooseStatus`).
Notices have no timestamp to compare and exist to be edited without a release, so a
valid live copy always wins.

## Why a branch

The sweep used to commit its result to `main` and rebase onto it. The rebase was
refused every run (`cannot rebase: You have unstaged changes`, from an install step
rewriting a tracked file), nothing was pushed, and the board went on showing results
three weeks old as though they were current. Three things were wrong at once: the
job could fail silently; an unchanged day produced no commit, so a healthy week and a
dead sweep looked identical; and the site only learned of new data on a rebuild.

On `status-data` the data has one writer and never conflicts with a PR, the daily
commit is the heartbeat (the page's freshness line reads `generatedAt`), and the docs
fetch it at render, so no release is involved. `[skip ci] [vercel skip]` is on every
commit, and `apps/docs/vercel.json` turns the branch's deployments off.

`status-data-branch.sh` does the git work against a worktree, so the caller's checkout
(however dirty) is never touched. `packages/providers/test/status-data-branch.test.ts`
runs it against throwaway remotes, including the dirty-tree case that broke the old
workflow.

## What the page says when things go wrong

| Age of the last result | The page                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| up to 30 hours         | quiet "Checked N hours ago"                                                                                                              |
| 30 to 72 hours         | a calm banner: the check is later than usual                                                                                             |
| over 72 hours          | the overview says **"This board is out of date"**, the ring is greyed and labelled "at the last check", and it links the workflow's runs |

A provider the check has no result for is drawn as **Not checked**, never left out:
a missing row reads as a clean bill of health. A day with no recorded sweep is a
hollow bar in a provider's strip, never a coloured one, and a streak never spans one.

## Posting a notice (no release, no workflow)

Edit `status-notices.json` on the `status-data` branch (the GitHub web editor is
enough). The workflow seeds the file once and never overwrites it.

```json
{
  "schemaVersion": 1,
  "notices": [
    {
      "id": "allmanga-keys",
      "level": "warning",
      "title": "AllManga keys rotated",
      "body": "Upstream changed its keys; a fix is in progress.",
      "providers": ["allanime"],
      "since": "2026-10-03T00:00:00Z",
      "until": null
    }
  ]
}
```

`level` is `info`, `warning` or `incident`. `providers` may be empty for the whole
project. `until` is an ISO time or `null` (shown until removed). A file that does not
parse is ignored whole and the page falls back to the bundled one (empty), so check the
JSON. It shows within ten minutes.

## Adding a provider

A registered provider must have a probe, or it never appears with a result.
`apps/docs/test/provider-status.test.ts` fails if a provider in
`generated-metadata.json` has no `id: "<provider>"` line in `provider-status-sweep.ts`.
Add a `PROBES` entry with the provider's front door and a fixture its resolver accepts
(the TMDB-keyed providers take `MOVIE_INPUT`; the anime ones locate a show by name).

## Running it locally

```sh
cd packages/providers
KUNAI_STATUS_DIR=/tmp/status-out bun run scripts/provider-status-sweep.ts
```

That reports **this network's** view, which is useful for a region-gated provider and
wrong as a published result: do not commit it over the seeds. Without
`KUNAI_STATUS_DIR` the sweep writes into `apps/docs/lib/`, the seed location.

To point the page at a different data source (a fixture, another branch), set
`KUNAI_STATUS_DATA_URL` for the docs build or dev server.

## Format contract

`generated-provider-status.json`: `{ generatedAt, schemaVersion: 1, providers: Row[] }`
where a row's `effectiveStatus` is one of `healthy`, `degraded`, `blocked`, `down`,
`dead`. `generated-provider-status-history.json`: `{ schemaVersion: 1, days:
[{ day: "YYYY-MM-DD", providers: { id: status } }] }`, oldest first. The docs parse
both strictly (`parseStatusFile`, `parseHistory`): one malformed row rejects the whole
file, because a board drawn from half a file misstates the providers it claims to know.
