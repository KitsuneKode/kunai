---
status: current
lastReviewed: "2026-11-24"
---

# Stremio addons

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

A user can add Stremio addons as movie and series sources. Kunai ships none: an
addon exists only because the user gave its manifest URL. Each installed addon
is one provider in the movies and series lane, ordered and switched off like
any bundled provider.

## What an addon may do

An addon is an HTTPS server that answers two JSON requests. Nothing it sends is
executed, and every field Kunai reads is schema-checked first
(`packages/providers/src/stremio-addon/protocol.ts`).

| Rule                    | Where it is enforced                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| HTTPS, public host only | `parseStremioAddonUrl` on entry and on every load; redirects re-checked in `client.ts` |
| Bounded responses       | `STREMIO_ADDON_LIMITS`: manifest 512 KiB, stream list 2 MiB, 200 streams read          |
| Bounded time            | `STREMIO_ADDON_TIMEOUTS`, inside the shared per-attempt budget                         |
| Direct links only       | `classifyAddonStreams` keeps public http(s) URLs and counts everything else by reason  |
| Probed before success   | `verifyCandidateStream`, with the stream's own request headers                         |
| Never relayed           | the manifest declares `relaySafe: false` and has no relay profile                      |

Torrents (`infoHash`), YouTube ids, external pages, non-http schemes and
private-address URLs are not playable. They are counted in a `source:skipped`
trace event and named in the failure message, never dropped without a trace.

## Identity

Addons are asked by IMDb id: `tt…` for a movie, `tt…:season:episode` for an
episode. The id comes from the title when it carries one, else from TMDB's
`external_ids` record for the title's TMDB id (`resolveImdbIdFromTmdb`). It is
never matched by title text. A title with no IMDb id exhausts the addon with
`unsupported-title`; a catalog that could not be asked is a retryable
`network-error` and is not cached.

Season and episode numbers are sent as Kunai has them, which is TMDB's
numbering. Addons number episodes the way IMDb does. The two agree for most
series; where they differ (specials, split seasons) an addon can answer for a
different episode or with nothing. No remapping is attempted.

Anime mode does not use addons. Kunai's anime lane is keyed on AniList ids and
Stremio anime addons are keyed on Kitsu ids, with no exact map between them
here.

## The manifest URL is a secret

A configured addon often carries the user's settings, and sometimes an account
token, in the URL path. So:

- The provider id is `stremio-<host>-<8 hex of sha256(url)>`: stable, and free
  of the path.
- Only the host is shown, logged, traced or put in an error. Client errors name
  the addon by host and strip any URL from transport messages.
- `kunai addons list` and its JSON never print the URL.
- The URL is stored in `config.json` as `stremioAddons[].url`. It is not in the
  credential vault.

Addon-supplied text (addon name, stream labels) has control characters removed
before it can reach the terminal (`toDisplayText`).

## Lifecycle

| Action            | Takes effect                                                       |
| ----------------- | ------------------------------------------------------------------ |
| Add               | Next start: the provider list is built once per run                |
| Remove            | Next resolve: each module re-reads the stored list (`isInstalled`) |
| Reorder or switch | Immediately, through `providerPriority` and `disabledProviders`    |

A new addon is appended after the bundled providers, so it is a fallback until
the user moves it. Removing one also removes its id from the default provider,
the fallback order, the switches and per-title choices
(`removeStremioAddonFromConfig`).

Startup contacts no addon. The manifest is fetched on the first resolve and
cached for 12 hours; the mapped IMDb id is cached for 30 days. The stream list
is requested on every resolve.

## Entry points

- `kunai addons list | add <url> | remove <n> | check [n]`
  (`apps/cli/src/services/providers/run-addons-command.ts`). `add` reads the
  manifest first and refuses an address that is not an addon, needs
  configuring, or cannot serve movie or series streams by IMDb id.
- Settings → Sources → Stremio addons
  (`apps/cli/src/app-shell/settings/registry/addons.ts`). Adding here does not
  contact the addon; its name is recorded on first use.

## Code

| Piece                                 | Path                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| Protocol schemas and limits           | `packages/providers/src/stremio-addon/protocol.ts`         |
| URL rules, provider id, request paths | `packages/providers/src/stremio-addon/addon-url.ts`        |
| Guarded HTTP client                   | `packages/providers/src/stremio-addon/client.ts`           |
| Stream classification                 | `packages/providers/src/stremio-addon/streams.ts`          |
| Provider module                       | `packages/providers/src/stremio-addon/module.ts`           |
| Stored list helpers                   | `apps/cli/src/domain/provider/stremio-addons.ts`           |
| Module factory, IMDb lookup           | `apps/cli/src/services/providers/stremio-addon-modules.ts` |
| Registration                          | `apps/cli/src/container/bootstrap-providers.ts`            |
