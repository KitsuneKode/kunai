# Changelog

## v0.4.0

Android handoff now routes headered, cookie, external-subtitle, and deferred-locator streams through a per-playback loopback gateway (127.0.0.1, unguessable token path, normalized headers injected upstream, HLS/DASH URIs rewritten, Range passthrough) — so VLC and mpv-android can play streams that previously failed handoff. yt-dlp-only streams, local files, and non-HTTP schemes still refuse with an explanation.

Add AnimeGG as the anime backup, second after Miruro.

Miruro reaches a dozen streaming servers, but all of them through one site. When
that site is unreachable, so is every one of them. AnimeGG is the source that
shares nothing with it: its own catalogue, its own site, its own video servers,
and no dependency on AniList or AniDB — both of which were unavailable on the
day this was added.

Search, episode lists, sub and dub all come from AnimeGG itself. Subtitles on
subbed episodes are burned into the picture, so there is no separate track to
switch, and Kunai says so in the playback trace when a show has no dub and it
falls back to the subbed version.

Kunai tries it automatically when Miruro cannot play something; you can also
pick it directly in settings.

Add an experimental Android Termux distribution with ARM64 and x64 Bionic binaries, explicit `--player auto|mpv|vlc` selection, and safe direct-stream handoff to VLC or mpv-android.

Detached playback now rejects streams that require managed headers, cookies, subtitles, local files, or deferred extraction, and it does not infer progress, completion, autoplay, provider health, or queue acknowledgement after Android accepts an intent.

Add terminal mouse input for browsing: click to focus/select, click the selected
result to open it, and scroll results with the wheel. Keep keyboard input intact,
shield covered browse controls, and release tracking on shell exit. Set
`KUNAI_NO_MOUSE=1` to keep native terminal selection behavior.

Add the HiAnime anime provider (`hianime`, ani-cli parity lane).

Search, episode catalog, and sub/dub resolves through the ZokoAnime server with HLS quality ladder, external English subtitles, and MAL-anchored auto-skip timing. HiAnime leads the anime lane by default; AniDB stays registered behind it.

### Features

- Added Homebrew (`brew install kitsunekode/tap/kunai`), Scoop
  (`scoop bucket add kitsunekode` + `scoop install kunai`), and AUR
  (`yay -S kunai-bin`) install channels: a `package-channels` workflow renders
  each package deterministically from the release's `SHA256SUMS.archives` and
  publishes it when the channel secrets exist. `kunai upgrade`, `kunai
uninstall`, and doctor now recognise Homebrew/Scoop/system-package ownership
  and defer to the owning package manager instead of self-replacing its file.

Add KickAssAnime as the anime backup, second after Miruro, and fix dub audio
selection for files that carry several audio tracks.

KickAssAnime has its own catalogue, site and video servers, so a Miruro outage
does not reach it. It is also the first anime source that can pick up a show
Kunai found somewhere else: it matches the title by name and year against its
own catalogue, and steps aside rather than guessing when more than one show
could be meant.

It is the only anime source with real subtitle tracks instead of subtitles
burned into the picture, so `/tracks` can switch subtitle language during
playback.

Its dubs usually live inside the same video file as extra audio tracks, which
surfaced a bug affecting any such file: switching to Dub wrote the mode itself
into the audio setting, mpv received `--alang=dub`, matched no track, and played
the Japanese audio with nothing said. Dub now resolves to English and Sub to the
file's original audio, and the setting is applied per file so a switch mid-episode
takes effect instead of keeping the value the player started with.

Make Miruro the default anime provider, with AniDB and AllManga behind it.

anidb.app — the previous default, and the only source ani-cli v5 uses — has been
in maintenance since 3 September. With it selected, anime search came back empty
and nothing played. Miruro fronts roughly a dozen streaming backends behind one
AniList-keyed service, so when one of them goes down Kunai moves to the next
server instead of failing the episode. AniDB and AllManga stay registered and are
tried automatically when Miruro fails.

Anime search now goes through Miruro as well, which matters because AniList's own
API was switched off on 10 September — Kunai's only other anime catalog. If
Miruro's search comes back empty, Kunai still asks AniList.

Miruro could hand out a link to a server that was itself down — one of its
servers kept pointing at AniDB's video host through the maintenance — and that
link won. Kunai now checks the link before accepting it and moves to the next
server when the host answers that it is gone.

Existing installs are moved too. Kunai writes your whole config whenever you
change any setting, so the old AniDB default was saved to disk looking exactly
like a choice you made. On the first launch after this update, a config whose
anime settings are still exactly that old default is moved to the new order,
once. Anime settings you had changed are left alone, and if you pick AniDB again
afterwards, it stays picked.

Adds Movy (movy.sx) as an opt-in provider — a 16-lane STREAMCRYPTO aggregator
whose lanes each wrap a different upstream scraper, surfaced as switchable
sources in the tracks panel.

Failure classification matches the repo's honesty contract: an HTTP answer
from a lane is upstream evidence (5xx/429 retryable, 404/410 a definitive
miss), a decrypt or magic-check failure is a parse failure that does not
retry, and a raw transport error reaches the offline gate unwrapped. A caller
abort records nothing. The per-candidate timeout now actually cancels the
lane fetch instead of leaking the socket past the 15s bound.

Not in `providerPriority` — a new aggregator stays opt-in until the live
smoke proves the wire format on a clean network.

Faster, warmer browse home: resting on a result prefetches its detail so Enter
feels instant, a "new since you left" strip leads the home rows when releases
landed since the last calendar visit, and plain Enter auto-resumes a live
position or advances to the next unwatched episode (`m` still opens the
starting-point menu).

Pressing Enter on a notification now plays the announced episode: the inbox
delivers a launch through the root-overlay channel with
`launchSource: "notification"`, so a notice's "Play now" goes straight to the
episode it describes.

The `/` command palette now lists JUMP TO rows for locally known titles
(history, queue, followed, lists, playlists) — Enter launches the title
directly while commands keep precedence over title matches.

Type-ahead suggestion band in browse search. As you type, matching titles
surface in a band under the input — local corpus instantly, one fast registry
call for the catalog — with a ghost-text completion previewing the top row.
Enter on a highlighted suggestion opens the title directly.

Session undo on `z`: queue adds, list membership changes, follows, and similar
actions journal a reversible entry, and `z` reverts the newest one while a
transient strip says what was undone. Undo is session-local and only covers
actions with a clean inverse.

Once-ever contextual tips: after reaching a feature the long way (via the `/`
palette), a single coaching line names the direct chord, then never repeats.
The seen set persists in config, a Settings toggle (`tipsEnabled`) turns tips
off without clearing it, and Kanna gains "done" voice lines.

Vidrock is back in the production provider set on its rotated API scheme.

The upstream API moved from AES-CBC item ids to a per-lane map of
`base64url(iv ‖ AES-256-GCM ciphertext)` server entries. The adapter ports the
new wire format, verifies the GCM tag (a tampered or stale blob rejects), and
treats "every lane carried ciphertext but none decrypted" as a diagnosable
scheme rotation instead of an honest catalog miss.

Two upstream quirks are now honored end to end: stream requests carry the
single-space `User-Agent` the ngcorp segment hosts require, and TLS-gated lanes
(workers.dev, challenged Orion hosts) are filtered by the resolve-gate probe.
The whitespace UA required a matching fix in the mpv header normalizer, which
used to trim `" "` away — the provider declared the header and playback
silently dropped it.

Stop a lost activation-lock reclaim race from crashing the updater: restoring a
quarantined lock now tolerates the quarantine vanishing mid-race, and Windows
pending-delete/antivirus responses (EPERM, EACCES, EBUSY) retry as contention
instead of failing the acquire.

Restore AllManga anime playback after the upstream crypto rotation.

mkissa rotated its client crypto and every pinned constant moved at once — the
build id, all four mask fragments, the derivation constants, the boot prefix and
separator, the boot payload field order, and the persisted-query hash. Between
rotations the provider failed silently: bootstrap fell back to bundled material,
the episode query decoded nothing, and every resolve reported zero streams,
which reads as "this anime has no sources" rather than "our constants expired".

A rejected persisted-query hash now reports as query drift rather than as an
empty episode, so the failure names the cause instead of looking like a title
with no sources.

`bun run test:live:allmanga-crypto` now answers whether the pinned set still
works and which half is stale, so the next rotation is a lookup rather than an
investigation.

Restore AllAnime playback after mkissa's crypto rotation.

The pinned mkissa `buildId` (140) has been dropped upstream, so every bootstrap
returned `unknown_build_id`, the provider silently fell back to bundled crypto
material, and AllAnime resolved nothing.

Pinning the new build id alone does not fix it. A rotation moves every
derivation constant together: 140 → 171 also changed `saltMul`, `saltAdd`,
`fragMul`, `fragAdd`, the boot prefix, the boot-token separator (`.` → `/`),
the order of the boot-token parts, and all four mask fragments. A token built
from build 171 with the build-140 constants is rejected `invalid_boot_token`.

Everything that rotates now lives in one `ALLMANGA_CRYPTO_PROFILE` object, so a
rotation is a single replacement that cannot be applied halfway, and the
bundled fallback key is pinned to derive under that same profile — a key left
over from an older build is not a degraded fallback, it is a guaranteed
decrypt failure.

The two rotation failures are also distinguishable now instead of surfacing as
the same unexplained crypto miss: `unknown_build_id` reports `build-rotated`
and `invalid_boot_token` reports `token-rejected`, both emitted on the provider
trace. A new opt-in check catches the next rotation before users do:

```sh
KUNAI_LIVE_ALLMANGA_ROTATION=1 bun run test:live:allmanga-rotation
```

An AniDB Cloudflare block is no longer marked retryable.

`blocked` is only produced after the client's inner Bun/fetch → curl
transports are already spent, so the engine's second attempt could never
succeed — it just cost up to ~24s before fallback was considered. Matches
the `retryable: !captchaBlocked` policy allmanga already states.

Report an AniDB outage instead of showing no results.

AniDB answers a site-wide outage with a `503` maintenance page on every route.
Scraping that page for result rows finds none, so search reported zero results
for every query alike — an outage wearing the costume of "no such anime", with
nothing thrown and no signal for provider fallback to act on. Every read now
surfaces its HTTP status, and only the statuses a different TLS fingerprint
could change are retried.

Make the anime lane lead with a provider that answers, and report an AniDB outage as an outage.

Anime search only queries the configured lane default, so a default that cannot
answer is not a slow path — it is a broken entry point. `anidb.app` answers 503
at the origin, and ani-cli itself moved off AniDB onto HiAnime
(`pystardust/ani-cli` c99221d, _"replace anidb with hianime provider"_,
2026-09-11 — a `fix:`, not a `revert:`). The anime lane now leads with HiAnime
and keeps AniDB registered and second, because AniDB still carries the only
verified AID cross-link and XML episode titles. A config that already names
AniDB explicitly is left alone.

Separately, AniDB's browse scrape asked for its HTTP body without asking for the
HTTP status, so a 503 reached the parser as an error page, the parser found no
cards, and `search` returned an empty list. The user saw "No results for …" for
a provider that was down, and the release signoff read the empty failure codes
and filed it as provider drift. It now asks for the status and returns `null` —
the contract's transport-failure channel, which is what HiAnime and AllManga
already do — so an unreachable provider is distinguishable from a title that is
genuinely not on AniDB.

Anime search now fails over across the provider lane and names outages in
empty states.

`searchTitles` used to try exactly one anime provider for a plain query: an
AniDB throw aborted the search even though HiAnime, AllAnime, or Miruro could
have answered, and an empty answer rendered the same "No results" copy as a
typo. The lane now iterates its providers in priority order — a provider that
throws is recorded and the next one is asked — while an honest empty answer
still hands the query to the registry catalog exactly as before. Provider
failures ride the result as `providerSearchFailures`, so the browse empty
state and the diagnostics event can say "Provider search failed (anidb)"
instead of the generic "no results" copy, and `compatible-catalog-unavailable`
advanced searches get their own message. Bootstrap (`-S`) searches pass the
same copy into the shell through a new `initialEmptyMessage` prop.

Cut redundant work on the resolve and watchlist paths.

Selecting an AniList-backed discovery title could pay up to five serial provider
searches, and selecting it again paid them all over — titles that map to nothing
now get a short session-scoped negative marker (keyed by provider and language
profile) so reselection is free. An aborted mapping is deliberately not
recorded: a cancelled lookup is not evidence the title has no match.

The source-inventory read now surfaces the row's real creation time, so a
freshly written entry satisfies the stream-health staleness window and skips
the redundant probe it used to be forced through; a stale entry still probes,
and inventory ports that cannot report age keep the previous forced-probe
behavior. The resolve deadline is also created before the cache and inventory
health checks, so those probes share the one caller-visible bound instead of
running outside it.

Miruro's curl HTTP/2 feature probe no longer stalls the event loop with a
synchronous spawn — it runs async, and it probes the resolved curl binary path
rather than whatever `curl` happens to resolve to on PATH. The watchlist picker
reads latest-per-title history once per dialog instead of once per loop
iteration.

Preserve healthy SQLite databases when startup encounters locks, permissions, or
I/O failures; only recognized corruption errors trigger quarantine and recovery.

Keep episode identifiers in long download filenames and refuse to overwrite or
delete another download's artifact. New downloads use short staging filenames and
exclusive publication; their destination filesystem must support hard links.

Limit the mp4upload TLS compatibility exception to the current file in persistent
mpv sessions, restoring the user's previous TLS setting when playback moves on.

Harden the untrusted-input and shared-tmp surfaces from the security audit.

A `kunai://` handoff link opened by the desktop handler used to run provider
network lookups (anime catalog-id mapping) before the local confirmation prompt.
The confirmation now runs first: an external link can no longer make Kunai emit
catalog ids or session state to providers without consent, and anime anchors map
against the anime lane's own provider instead of whatever lane the session last
used. `--open` combined with `--handoff-url`, and whitespace inside a handoff
URL — both smells of a tokenizing launcher smuggling extra argv — are now usage
errors.

Temporary playback manifests (the rewritten HLS playlist and generated DASH
MPD) embed signed CDN URLs; their tmp dirs and files are now owner-only
(0700/0600) instead of world-readable in a shared `/tmp`. The HLS manifest
prefetch keeps its deadline armed through the body read, caps the body at 2 MiB,
and honors the caller's abort signal. The Windows mpv IPC pipe name carries
128-bit randomness — the only thing between a same-session process and mpv's
`run` command — and the Linux `.desktop` `Exec` line now escapes `%` field-code
characters.

The share codec's optional text fields (`n`, `src`, `sq`, catalog ids) are
truncated to the same bounds `q` already had instead of being accepted
unbounded, and `source_inventory` rows get a structural shape check on read so a
corrupt row is reported as corrupt instead of handing garbage to the playback
path.

Large playlist imports insert their items in one transaction without repeatedly scanning the playlist, reducing delays in the shell.

Preserve mpv IPC command framing under partial socket writes, bound stalled command queues, and prevent expired or closed-session commands from launching later.

Worktree installs now share bun's global link store (`install.globalStore`),
so a fresh `.worktrees/` checkout stops re-materializing ~700 packages per
install. The docs app's Turbopack/tracing root widens to the common ancestor
of the repo and the store so symlinked packages still resolve.

Prevent a downloader from launching after an abort or shutdown request received
during stream resolution, preserving the job's cancellation or paused state.

A cancelled resolve no longer writes provider health.

`PlaybackResolveService` used to persist `healthDelta`s and title-level
`recordFailure`/`recordCleanSuccess` from whatever attempt state the engine
returned, even when the caller had aborted mid-flight. An attempt that settles
while the abort races can still carry a stale failure delta, so navigating away
during a slow resolve could mark a healthy provider down and poison the next
pick. All three health writes now check `resolveSignal.aborted` first — a
cancel is a decision, not evidence.

TMDB access now walks a three-host chain instead of a single fallback.

Every movies/series catalog surface — search, trending, surprise, random,
recommendations, schedules — previously shared one proxy→direct pair. The
videasy proxy has gone NXDOMAIN (upstream wind-down), and the canonical
`api.themoviedb.org` host is intermittently DNS-sinkholed by some ISPs —
measured live: the canonical name resolves to a sinkhole address while
`api.tmdb.org`, the official alias on the same CDN and data, still resolves to
CloudFront. The chain is now proxy → canonical host → alias, with a per-host
circuit breaker (5 minutes) so a dead hop costs one fast failure, not a stall
per request. The breaker only marks availability failures — a transport error
or 5xx advances the chain, a 4xx is a definitive upstream answer identical on
every host and propagates immediately, and a caller abort still marks nothing.

Post-play "more like this" in the anime lane is now anchored to the title that
just ended: AniList's `Media.recommendations` edge supplies genuinely similar
titles instead of generic trending, with trending kept as the fallback for
titles with no recommendations or an upstream miss.

The YouTube `/surprise` tray no longer echoes `/trending` — it draws a random
broad-interest query through Invidious search and falls back to trending only
when search answers nothing.

Make the CI "always" jobs stop passing without running, and three broken root
commands work.

**A pull request that changed no workspace package was typechecked, linted,
format-checked and tested by nothing.** Every always-job runs `--affected` on a
PR, and when a change touches no workspace package turbo selects zero tasks and
exits 0. Reproduced on a branch whose only commit edits `README.md`:

```
$ bunx turbo run typecheck --affected
 WARNING  No tasks were executed as part of this run.
$ echo $?
0
```

`install.sh`, `install.ps1`, `.github/**`, `docs/**`, `.docs/**` and `tools/**`
are all outside every workspace, so those PRs got four green jobs that ran
nothing. The jobs now fall back to the full graph when `--affected` selects
nothing.

The fallback asks the graph whether it selected any task rather than testing a
list of paths, because a path list is a declaration that decays — the next
top-level directory added to the repo would match nothing and silently opt out
of CI again.

**`bun run typecheck` can no longer be a cache replay.** It was the only task in
the blocking chain without `cache: false`, which is the one place AGENTS.md's
"a green gate can be a replay" hazard applied.

**`bun run verify:readme:commands` works when run bare.** The root script passed
no arguments to a script that requires three, so it exited 2 on every
invocation while looking like working coverage — and no doc showed the argument
form. The script now derives the version from the CLI manifest and the binary
from the host build path, and says what to run when the binary is absent.

**`.release-candidate/` and `.delta/` are gitignored.** 268 MB of npm tarballs
and bare clones were neither tracked nor ignored, so `git add -A` staged them.

**A stray NUL byte no longer makes a source file binary to grep.** The
separator in `offline-title-identity.ts` is now written as an escape, so the
file is readable by ripgrep and every lint pass that globs by extension. The
byte at runtime is unchanged.

chore(ci): close the zero-task, cache-replay, and golden-capture gate holes

Four gates used to be green without proving anything:

- `turbo --affected` on a non-package diff selected zero tasks and exited 0, so
  a docs/tools/workflow-only PR passed fmt/lint/typecheck/test having run
  nothing. `scripts/turbo-affected.sh` dry-runs the selection and falls back
  to the full task, and every `--affected` CI leg now goes through it.
- `typecheck` was the only blocking task still cacheable — a green run could
  be a Turbo replay. It is `cache: false` like lint/fmt/test now, and pre-push
  runs the same `bun run ci` chain (four blocking tasks plus the doc
  verifiers) instead of tests alone.
- Root-owned files (`.github/`, `scripts/`, root configs, `docs/`, `.docs/`,
  `.changeset/`) live outside every workspace, so `turbo run fmt:check` never
  saw them. A new `fmt:root`/`fmt:root:check` gate covers them, lint-staged
  formats the same set at commit time, and `.oxfmtrc.json` ignores the frozen
  `.archive/`/`.reference/` trees plus three files where the formatter cannot
  reach a fixed point.
- Committed terminal captures asserted on text nobody could regenerate.
  Every capture script now exports its fixture behind `import.meta.main`, a
  new `golden-captures-live.test.tsx` re-renders all 27 families at the three
  canonical widths and byte-diffs the committed files, and the three orphan
  families with no producer (`discover-sections`, `loading-shell.*`,
  `post-play.baseline`) are deleted rather than kept as vacuous coverage.

Verifier honesty fixes: `verify:build-pipeline` now deletes `dist/bin` before
the cache-restore leg and requires the binary back, not just "cache hit"
output; `verify:doc-coverage` routes on backticked code spans instead of bare
prose mentions; `verify:readme:commands` defaults to fixture mode + the host
binary so bare invocation does something meaningful; and the yt-dlp-gated
YouTube tests are visible `skipIf`s that actually run in CI (the binary is
installed in the test job, never invoked). `.release-candidate/` and `.delta/`
are gitignored.

Stop the CLI from claiming things it did not do.

**A corrupt `config.json` no longer destroys its own backup.** The backup was
written to a fixed `.corrupt.bak`, so every launch overwrote the previous one —
a user who hit this twice lost both the original config and any earlier backup.
Because the unreadable file is never rewritten, each later launch re-detected,
re-warned, and re-clobbered it. Backups are now timestamped, the same way a
corrupt SQLite database is already quarantined. The warning also no longer says
the file "has been reset to defaults" when nothing rewrites it.

**Launching without a terminal no longer prints a React stack trace.** With no
TTY — a pipe, `< /dev/null`, a CI step, a desktop launcher — the shell threw
from Ink's stdin hook and the rejection escaped: a react-reconciler stack on
stdout, two more on stderr, and the absolute install path in the output. Kunai
now says what it needs and exits 1. The check sits at the mount site, after
every pipe-aware route has already returned, so nothing legitimate is refused.

**`kunai doctor` gained `--strict`.** Warnings still do not fail by default —
a missing mpv leaves setup and the non-playback shell working, which is why it
is reported as a warning — but a script asking "is this install healthy?" got
exit 0 for an install that cannot play a video. `--strict` makes any warning
non-zero. Informational findings still pass, so a correct source checkout with
no install manifest is not reported as unhealthy.

**Remediation commands are no longer glued to their labels.** The label column
was padded to a hardcoded width that happened to equal the longest label, so
one platform printed `- openSUSEsudo zypper install mpv` — two commands on one
line, neither runnable. The width is now derived from the table.

Stop accepting malformed invocations at the CLI edge.

An unknown flag used to be a warning that launched anyway — `kunai --tpyo` ran a
search nobody asked for, and `--config <path>` turned the path into the query.
Unknown options, value flags with no value, and a value flag followed by another
flag are now usage errors: a message naming the problem, a pointer to
`kunai --help`, and exit code 2 — the same code `kunai completion` already uses,
so wrappers can tell a typo from a real failure.

A bare word that looks like a mistyped maintenance command is rejected with the
suggestion (`kunai doctro` → "did you mean `kunai doctor`?"); ordinary positional
searches still work, and `-S` stays the explicit escape.

`-i/--id` now validates against the ids the lookup path can actually resolve —
a bare TMDB id, `tmdb:<id>`, or `anilist:<id>`, positive integers. `imdb:` is
rejected rather than minting a title that could never resolve.

And on a read-only config directory, the dependency-capability notice warns once
and keeps launching instead of dying on an unhandled rejection with a raw
absolute path in it.

docs(dossiers): describe the Cloudflare strategy that shipped

The dossier documented a Playwright `cf_clearance` "Harvest & Fetch" pipeline
that was never built — no browser dependency, no clearance harvesting, no
daemon. Rewritten to describe the real implementation: PATH-discovered
`curl_<browser><version>` impersonate wrappers ranked by family, Darwin-only
cipher flags for plain curl, and challenge detection on 2xx bodies; plus the
troubleshooting flow that matches what the code actually does.

fix(shell): wire `/image-pane` to the companion-pane toggle and expose queue commands in the root palette

`/image-pane` was registered with an availability gate but had no handler — the
`TOGGLE_COMPANION_PANE` action existed and nothing dispatched it. `/playlist-add`
and `/queue-season` now list in the root overlay palette beside `/up-next`, where
their existing "select a title/episode first" reasons are discoverable instead
of the commands being invisible outside playback.

Probe selected media before Movy, HiAnime, AnimeGG and KickassAnime report success, derive resolve-gate coverage from the production registry, and preserve requested quality when an anime source lane is pinned.

Make the cross-process config lock survive slow Windows machines. Lock tickets are now published atomically without fsync or per-record ACL rewrites (roughly 30x cheaper per transition), the acquire and release budgets rise from 1s to 5s, and delete-pending ticket files on Windows are treated as still present instead of failing the save with "Config is busy".

feat(security): store tracker credentials in the OS credential vault

AniList/TMDB sync tokens and the Videasy session token now persist through a
credential-vault port: macOS Keychain, Windows Credential Manager, or Linux
Secret Service when reachable, with an owner-only file fallback on headless
machines. Existing `sync-tokens.json` and `config.json` values migrate on
first launch — write, read-back, compare, then delete — and every migration
step is restart-safe and idempotent ([#179](https://github.com/KitsuneKode/kunai/issues/179)).

chore: remove declarations with no production reader ([#474](https://github.com/KitsuneKode/kunai/issues/474))

- `provider-resolve-retry.ts` deleted — the engine's own retry loop owns
  attempts now; this was a pre-engine leftover kept alive by its tests.
- `provider-shadow-probe.ts` deleted — the selector shipped without its
  executor; the handoff plan now records Slice B as unwritten.
- `servedFromCacheAfterFailure` and the "Using cached source" copy removed —
  the only event that could feed it fires at resolve commit, after the wait
  surface it described is gone; the post-resolve note already covers it.
- The async `isMuslEnvironment` probe removed — every runtime ships
  `process.report.glibcVersionRuntime`, so the sync check is the whole job.
- `attentionInbox`/`queueRecovery`/`newEpisodeProjection` gained
  `KUNAI_*` env kill switches — declared flags that only tests could set are
  now real operator controls.
- `research.ts`: videasy's source host corrected to api.speedracelight.com.
- `curl-impersonate.ts`: dropped the unreachable `Number.isFinite` guard.
- `experimental.ts` kept — it is a deliberate lab-only package export.

Harden the debug log and atomic config writes.

`--debug`'s `logs.txt` carried everything the session touched — titles,
providers, paths — at whatever the umask left, typically world-readable. The
file is now created owner-only (0600), an existing permissive log is tightened
on open, and growth is capped at 4 MB with a single `.old` generation kept.

Config and secret writes create their temporary file exclusively with
`O_EXCL`/`O_NOFOLLOW` and retry on collision, so a planted symlink at a
predicted temp name fails instead of being written through, and a colliding
entry is never unlinked.

Shutdown cleanup no longer deletes any `mpvKunaiScriptPath` that happens to
live under the temp dir — only a direct child of the OS temp directory named
`kunai-mpv-keys-*.lua` qualifies.

Refresh runtime and tooling dependencies within compatible ranges.

React and react-dom move to 19.3.0 alongside the matching type packages, and
zod, Bun types, Node types, turbo, and lint-staged take their in-range bumps.
The Bun runtime pin moves to 1.4.2 (engines floor likewise): Bun 1.4.0's
bundler emits a development bundle ~400 KiB larger than 1.4.2 from identical
inputs, which is what pushed `dist/kunai.js` over its budget in CI while local
1.4.2 builds stayed well under it.
The docs stack updates to Next 16.3.6 and Fumadocs 16.15.14 / fumadocs-mdx
15.4.5, with motion unified on 13.4.4 — the version fumadocs-ui already
requires — so the docs site no longer installs two major versions side by side.

One transitive pin carries a caveat: `mdast-util-to-markdown` is overridden to
2.1.2 because 2.1.3 regresses Fumadocs' MDX stringifier into infinite
recursion (RangeError: call stack) on `strong` nodes across the docs set. The
pin can drop once upstream fixes the regression.

Say missing mpv once.

First launch no longer prints `mpv not found` from both a dedicated
`console.error` and the capability-issue list. `kunai doctor` still reports the
gap once, with remediation labels that keep a space after `openSUSE`.

fix(downloads): English-anime downloads re-resolve to the dub catalog

`persistLanguageHintsFromEnqueueInput` mapped every non-"dub" audio value to
`anime_lang: "sub"`, so a profile with `animeLanguageProfile.audio: "en"` (the
documented "Prefer English audio" option) stored `"sub"` on its download jobs —
and repair/runway re-resolves then pulled the sub catalog instead of the dub the
user asked for. The hint now derives from `resolveAnimeAudioIntent`, the same
mapping the resolver uses, so `"en"` and `"dub"` both record the dub catalog.

fix(providers): movy records gate evidence per lane and stops re-walking dead lanes

Movy's resolve gate refusal carried `endpointScoped` into a cycle that never
received `endpointHealth`, so the flag was dropped and a definitively-dead lane
was re-fetched on every resolve. The cycle now gets `endpointHealth`/`titleId`
keyed by lane (each lane is a distinct upstream scraper), and cycle failures are
pushed into the resolve's failure list like Rivestream does.

Stop a repairable download showing up twice in the download manager.

`repairable` was returned by both `listCompleted()` and `listFailed()`, so one
job rendered as two rows sharing an id and index-based selection acted on a
phantom row.

A repairable job is completed work carrying a repair, not a failure:
`markRepairable` sets `progress_percent = 100` and stamps `completed_at`,
because the media downloaded and is playable — only the sidecars need another
pass. So it now lists as completed, and the repair sweep reads a dedicated
`listRepairable()` instead of filtering failures. The three lists are disjoint
by status.

Diagnostics keep the signal: repairable jobs are counted under
`downloadSummary.repairable` and still drive the downloads health row to
`recoverable` with its own wording, rather than being reported as failures.

Refine the Ember Dusk palette: secondary text stays readable on the selected row, and unrelated signals stop sharing a colour.

`muted` text measured 3.99:1 on the selected-row band, under the 4.5:1 body floor, so it is now slightly lighter and passes everywhere (4.57:1 on the band). The brand, the surfaces and the rose accent are unchanged.

The milestone, anime, movie and series colours moved apart on the hue wheel. The milestone periwinkle sat 20° from the anime orchid and read as one purple; it is now 46° away.

On 16-colour terminals the accent, the anime kind, the milestone and the mixed-day blend were all the same `magenta`, and the warning and movie kind were both `yellow`. Each signal now has its own colour, and a test fails if two of them collapse again.

There is a new `lineControl` token for control edges (inputs, outlined buttons, toggles) at 3:1 against the surface they sit on.

fix(catalog): log provenance when a non-integer episode count is dropped

The `readEpisodeCount` guards dropped fractional values silently, so the
"episodes 448.2" producer stayed anonymous. Both ingestion sites (TMDB season
rows, AniList media) now emit one `dbg` record naming the site, the raw value,
and the title id when a present-but-invalid count is rejected ([#273](https://github.com/KitsuneKode/kunai/issues/273)).

The playback failure panel's cell buffer now counts terminal columns, not
code points ([#465](https://github.com/KitsuneKode/kunai/issues/465)).

`ErrorShell` laid row text into a one-cell-per-code-point buffer and clipped
at `width` cells, so an unwrapped CJK row (waterfall entries are never
wrapped) rendered nearly twice its allotted width — and `rowEndColumns`
mismeasured where text ended, letting sakura petals land inside text lanes.
Each cell is now a real column: a wide glyph claims its second column as an
empty cell, combining marks fuse onto the glyph they modify, and the petal
lanes and width clip measure actual screen space.

refactor(providers): drop crypto-js for an EVP_BytesToKey port

The videasy/vidking guarded lanes only needed CryptoJS passphrase-mode AES —
the OpenSSL `Salted__` + MD5 EVP_BytesToKey envelope — which is ~60 lines on
node:crypto. Byte-exact parity fixtures generated against real crypto-js pin
both lanes (empty passphrase, sha256-hex passphrase, unicode plaintext).
Removes `crypto-js` + `@types/crypto-js` from the dependency tree entirely.

Fix the provider fallback cycle end to end: live progress, honest attempts, one semantic for ⇧F.

The fallback audit found the cycle sound in `provider-engine` but nearly invisible
and partly misleading at the surfaces:

- **Live progress.** The loading shell now narrates `provider-fallback-started`,
  `provider-hedge-started`, and `provider-fallback-halted` as they happen instead
  of sitting on "Resolving via X" for the whole chain — including the
  "network looks offline, fallback paused" case that used to look like a hang.
- **Aborted attempts are recorded.** Candidates cancelled mid-flight (user
  cancel, deadline, or a hedged sibling winning) now land in `attempts` with an
  `aborted` marker and a dedicated `attempt-aborted` timeline event — no more
  silent gaps or fabricated provider failures where the last act used to vanish.
- **⇧F is session-scoped everywhere.** It hops to the next compatible provider
  without persisting a per-title preference (the `/provider` picker keeps that
  job) and without clearing the title's provider health memory. Each press walks
  forward through providers not yet tried this episode — no ping-ponging between
  the top two — and skips providers marked `down`. It is not offered during
  local file playback or when no eligible candidate exists.
- **Provider picker wins mid-resolve.** Confirming a pick while a resolve is in
  flight cancels the old resolve so its late result is discarded instead of
  playing the provider you just navigated away from.
- **Dead keys fixed.** Copy that said "press f for fallback" now says `⇧F`
  (bare `f` has never been bound), the hardcoded "VidKing" in failure copy uses
  the actual provider name, and `/recover` + `/recompute` during an in-flight
  resolve restart resolution instead of silently doing nothing.
- **Honest failure surfacing.** `buildProviderResolveProblem` classifies the
  last meaningful typed failure rather than regexing concatenated messages, and
  no longer recommends `pick-stream` when nothing resolved or
  `try-next-provider` when every candidate already ran.
- **Dead code removed.** `resolveProviderStreamWithRetries` was unreachable and
  retried every untyped error if revived; it is gone along with its test.

Preserve another window's analytics opt-out or identity rotation when a pending ping finishes. Complete cadence updates under the shared config lock, and refuse sends or payload previews for invalid stored identities until explicit consent repairs them.

Fence download workers by durable claim token and generation, isolate attempt files, and prevent retired workers from launching or completing a successor's download. Preserve asynchronous copy fallback with an exclusive destination reservation and crash-recovery identity checks; incomplete or replaced files are never reported as completed, and replacing a completed file prevents destructive artifact deletion. Legacy recovery requires ownership evidence before validating or deleting a destination; unproved files are preserved with visible recovery guidance.

Fence Android terminal session acquisition, crash recovery, and release with shared transition tickets and unique ownership generations. Preserve a successor's lock and retain corrupt or uncertain ownership for explicit recovery. Update the real-device guide to distinguish Android recovery from iOS.

Capture the destination profile for search history writes, preserve concurrent
session appends under a file transition lock, and flush pending history on exit.
Keep corrupt history intact and isolate history tests on every platform.

yt-dlp metadata calls pass a single `--` before the watch URL. The argument list had a second terminator, which yt-dlp reads as a positional operand, and YouTube search now puts `--` before its search target, matching every other yt-dlp invocation.

Make the unit suite pass on a fresh machine with no yt-dlp and no assumed DNS.

Stubbed `fetch` no longer trips the stream-target DNS guard, YouTube PO-token
assertions no longer share process-global provider config under `--parallel`,
and download tests refuse to spawn a real yt-dlp. npm-launcher integration
tests skip when `node` is Bun's PATH shim, so they do not spawn the compiled
app in place of the vendor stand-in. The README now shows the GitHub Actions
CI badge for the ubuntu/macOS/Windows workflow.

Fix two holes in hianime's relay routing.

- Relayed responses now carry an `X-Kunai-Relayed` marker, and the hianime
  client treats a marked response as final. Previously a relayed 403 or
  Cloudflare challenge fell through to a direct upstream request — silently
  bypassing the relay a geo-gated user deployed, and re-fetching definitive
  statuses for nothing. Unmarked responses (relay off, authorized direct
  fallback) still fall through to local curl/impersonate.
- HiAnime is added to the per-provider relay settings list. It declared
  `relayProfile` but was omitted, leaving it permanently relay-routed with no
  way to disable it and making the "all relay-capable" summary wrong. A
  contract test now pins the list against the production roster ×
  `relayProfile`.

fix(providers): parse #EXT-X-MEDIA renditions into audio/subtitle inventory

`expandHlsMasterPlaylist` only read `#EXT-X-STREAM-INF` rows, so alternate
audio and subtitle renditions declared on HLS masters never reached the Tracks
panel. `expandHlsMasterInventory` now returns variants plus rendition tracks;
muxed audio (no `URI`) still contributes its language to `audioLanguages`, and
vidlink HLS streams carry the manifest subtitles the provider omitted ([#189](https://github.com/KitsuneKode/kunai/issues/189)).

Installer and doctor fixes from the issue backlog.

- `install.sh` now honors the documented environment fallbacks —
  `KUNAI_INSTALL_METHOD`, `KUNAI_INSTALL_VERSION`, `KUNAI_INSTALL_YES`,
  `KUNAI_INSTALL_DRY_RUN`, and `KUNAI_SKIP_DEPS` join the already-working
  `KUNAI_SKIP_PATH_UPDATE`, matching `install.ps1`'s contract ([#453](https://github.com/KitsuneKode/kunai/issues/453)).
- Both installers refuse to run as root / elevated by default. A `sudo` or
  Administrator install lands Kunai in the wrong profile and the user never
  gets it on PATH — with no error anywhere. Containers and deliberate system
  installs opt in via `KUNAI_INSTALL_ALLOW_ROOT=1` /
  `KUNAI_INSTALL_ALLOW_ELEVATED=1`; a root `--dry-run` still prints the plan
  ([#454](https://github.com/KitsuneKode/kunai/issues/454)).
- `install.sh --help` works under the documented `curl | bash -s --` route:
  `usage()` no longer `sed`s `$0` when it is the shell instead of the script
  ([#455](https://github.com/KitsuneKode/kunai/issues/455)).
- `kunai doctor` exits non-zero when mpv is missing — the one dependency
  playback cannot run without — while lane-conditional gaps (yt-dlp, ffmpeg,
  curl) remain warnings ([#452](https://github.com/KitsuneKode/kunai/issues/452)). Doctor's remediation table also stops gluing
  `openSUSE` onto `sudo zypper …`: the label pad is now computed from the
  longest label instead of a fixed 8.

Stop the installer from saying it will run `apt-get`/`pacman`/winget when it will not.

`curl | bash` and `--yes` print `Run this to install them:` with the exact
command, once. `This will run` is reserved for a real TTY that then asks
`Run it now? [y/N]`.

Find curl-impersonate on Windows wherever the installer provisioned it, even in a terminal opened before the install or after an npm/bun install, so anime search clears Cloudflare without a PATH edit; the installer now provisions its helpers for every install method. Episode and season pickers open with a row selected, so Enter plays straight away instead of doing nothing until you press ↓. The details card beside search results no longer prints text over text at medium widths, and shows the selected title immediately. Quitting in the end credits marks the episode watched again instead of offering to resume the credits. Plays through any anime-only provider are recorded as anime in history and stats. Stream credentials no longer appear on mpv's command line, provider curl calls ignore `~/.curlrc`, and post-play no longer labels `/` as search.

Preserve KickAssAnime HTTP failure classes and cancellation instead of treating every failed catalog or player request as a retryable network error.

test(cli): pin the production provider roster and capability↔operation parity

The resolve-gate coverage class of bug — a registered production provider
silently absent from a hardcoded coverage list — now fails on main: the roster
is pinned to the 8 module ids `loadProductionProviderModules()` returns, and
every `capabilities` entry must have a runtime-port operation that implements
it. That check immediately caught two real drifts: youtube declared
`search`/`episode-list` capabilities its runtime ports never admitted, and
miruro declared `episode-list`/`subtitle-resolve` while listing only
`resolve-stream`. Both manifests now name the operations they actually run.

Create the temp directories that feed mpv privately.

Both playback materializers built a temp directory name from
`Date.now()` plus `Math.random()` and created it with
`mkdir(..., { recursive: true })`. `recursive: true` succeeds on a path that
already exists, and `Math.random` is not a CSPRNG, so on a shared machine
another local user could pre-create or symlink that path and read or rewrite
the HLS playlist or MPD that mpv was about to load.

Both now use a single `createPrivateTempDir` helper built on `mkdtemp`, which
fails on collision rather than adopting an existing directory and creates with
mode 0700 instead of 0755. The two materializers were carrying identical copies
of the helper, so this removes the duplicate as well.

Resolved streams whose HLS master host is definitively dead are dropped from
the source inventory instead of offered as playable rows. Only an explicit
HTTP answer (5xx/404/410) marks a host dead — timeouts, DNS failures, and TCP
resets keep the adaptive fallback because they say nothing about the host.

The check applies across every ladder-expanding adapter: miruro, rivestream,
vidlink, hianime, anidb, and allmanga.

Play the English dub on Miruro when you ask for it.

Asking for a dub on Miruro played the Japanese audio whenever any server had
the subtitled version, and then reported that no dub was available. A
preference for burned-in subtitles, which every anime request carries, was
allowed to outrank the audio you chose. It now only decides between servers
offering the audio you asked for.

Start anime from Miruro in about a second instead of about four.

Two things were costing every episode. Kunai checked each Miruro backend before
playing it, and for the one that plays most reliably right now that check could
never get an answer — so it waited out its full timeout every time, for nothing.
And a backend that was down got checked again on every single episode.

The check now skips the backend it cannot judge, and a backend that keeps
failing is set aside for an hour instead of being asked again, the same way
Kunai already does for its movie and series sources. While it is set aside the
source list shows it as temporarily unavailable, and it is tried again once the
hour is up.

Skip a Miruro server whose backend is rate-limiting, instead of handing it to the player.

Miruro fronts about a dozen streaming backends, and its first choice was
answering "too many requests" to everyone — so anime resolved successfully and
then failed the moment playback started, with the recovery only kicking in after
the player had opened.

Kunai already skipped a server whose backend was down or gone; a rate-limited
one now counts too. It moves on to the next backend and plays from there.

Miruro's intermittent Cloudflare challenge now earns one jittered refetch
(400–800ms) before Kunai pays for a curl-impersonate subprocess — the same
request that 403s during a challenged window often answers cleanly seconds
later. A sibling mirror already seeing a challenge still suppresses the retry,
so a region-wide block is never re-polled, and an abort landing inside the
retry wait short-circuits the whole leg instead of falling through to a curl
subprocess whose deadline outlives the caller.

fix(player): find mpv through Flatpak when PATH has no mpv

Six call sites did a bare `Bun.which("mpv")` and reported "not installed" on
Steam Deck / Flatpak-only hosts where `flatpak run io.mpv.Mpv` plays fine. New
`mpv-discovery.ts` walks an ordered ladder — PATH binary, then the
`io.mpv.Mpv` flatpak app dirs at system (`/var/lib/flatpak`) and user
(`~/.local/share/flatpak`) scope — and returns a full spawn argv, so launch,
persistent sessions, trailer playback, capability probes, and the support
bundle's version probe all agree on the same discovery.

feat(cli): `-i` accepts namespaced catalog ids (`anilist:21`, `mal:`,
`youtube:`)

A bare `-i` id was TMDB-only, and a namespaced one was parsed then dropped —
`kunai -i anilist:21` did nothing. Namespaced ids now reuse the share-link
`cat=ns:id` vocabulary: they carry `externalIds` into provider resolution, and
`anilist:`/`mal:`/`youtube:` imply their lane so `-a`/`-y` is not needed. A
namespace that conflicts with a lane flag, or an unknown namespace, warns on
stderr instead of silently ignoring the id. `imdb:` is rejected until a TMDB
/find resolution exists.

`NETWORK_ERROR_PATTERNS` no longer matches the bare substring `"dns"`.

Any provider error containing those three letters — a URL on a `dns.*` host,
a title name echoed into an error — classified as `offline`, and two such
false positives across distinct providers tripped the engine's consecutive-
offline threshold and halted every live candidate. The list now matches the
phrasings transports actually produce (`could not resolve`,
`name or service not known`, `temporary failure in name resolution`,
`getaddrinfo`, …).

Check external strings without coercing malformed objects or invoking conversion hooks, so provider and credential decoding remains predictable.

Remove a stray NUL byte from `offline-title-identity.ts`.

The dedupe key separator was a literal NUL byte in source, which made the
whole file classify as binary — `rg`/`grep` skipped it and lint passes treated
it as an asset. The separator is now the `\x00` escape, producing the same
runtime string.

Keep downloaded playback tied to the selected provider-native episode and season, resume only matching episode history, avoid remote preparation for validated local Continue choices, and retain observed duration through mpv shutdown position events.

Make `/reset-provider-health` actually clear endpoint quarantines.

Quarantined provider endpoints (1h server-error, 24h dead-route) lived in
`provider_endpoint_health`, which no reset scope touched - so the reset
confirmation said "retry" while the cycle kept skipping the same mirrors.
Every reset scope now clears the endpoint rows it owns (provider, lane, all,
or per-show rows the title contributed to), and the confirmation names how
many quarantined endpoints were lifted.

Point the published `homepage` at the docs site rather than the README anchor.

npm renders `homepage` as the "Homepage" link on the package page, and it is the
first thing someone evaluating the CLI clicks. `github.com/KitsuneKode/kunai#readme`
sends them to a raw README anchor; `kunai.kitsunekode.in` is the site that actually
documents installing and using Kunai. The field propagates from the CLI manifest into
all eight platform packages, so every published package now points at the same place.

Keep startup config migration and explicit native credential changes under the shared config lock. Avoid replacing another window's rotated token during unrelated saves, retain failed replacements, and reject unverified native clears.

The command palette now matches queries against a command's canonical id, not
just its aliases — `image-pane` answers "Image Pane" as expected instead of
vanishing because the hyphenated id was never a match target.

chore(scripts): pin upstream parity references and verify cites against them

`scripts/parity-references.json` records the reference checkout's real
version (`version_number`, since upstream git tags lag it) and
`verify:parity-references` enforces it two ways: semver cites of a reference
in manifests/dossiers must match the pin or carry a full date/historical
wording, and when the local checkout exists its `version_number` must match
the pin. The stale `5.1.2` cites this flagged (hianime manifest, dossier,
client comment) are now `5.1.4`, and the allmanga parity policy no longer
points at `master` for code upstream deleted in v5.0.

Connect guarded stream requests to the validated DNS address on every redirect,
retaining the original HTTP authority and TLS name without an unchecked DNS retry.

Keep provider deadline health evidence while ignoring cancelled user requests.
Apply live Tracks subtitle choices and Off without stopping playback, and retain
the selected row only after the player accepts the change.

Typing into the playback command palette no longer fires playback keys.

Opening the `/` palette during playback and typing a command name ran the playback
keys behind it, one letter at a time: `q` stopped playback, and `n`, `p`, `a` and
`u` skipped, rewound, or toggled autoplay and autoskip. Typing `quit` or `next`
could end the stream before the command ever ran. The palette now owns the
keyboard while it is open, and closing it with Escape hands the keys back.

Playback preflight no longer trusts resolve age alone.

The `playback-preflight` health plan used to waive its probe for any stream
younger than `playbackTrustMs` (5m), verified or not. Providers without a
resolve-gate hand playback URLs that no code has ever fetched, and
episode-to-episode autoplay replacements trusted the same plan — a dead or
expired URL could go straight to mpv within the window. The waiver now applies
only to `streamReachabilityVerified` streams inside the trust window; every
other stream probes at handoff. The probe already races mpv's `loadfile`, so a
healthy stream adds no wait, and a definitive failure only aborts when mpv
itself also failed — the fix converts a silent black window into a named
stream-unreachable error.

Keep details shortcuts from rewriting external link targets, and reject control characters before handing a URL to the desktop opener.

Preserve the local resume point when quitting in the credits. Automatic completion requires a clean natural EOF and trusted progress past the completion threshold; explicit mark-watched remains available. Preserve the actual quit position and stop resume/continuation readers from overriding unfinished history using near-end ratios.

fix: subagent-driven hardening across providers, shell, config merge, and the update lock

Providers: HiAnime embed URLs scraped from upstream markup now pass the same
literal-target gate AniDB uses, so a hostile embed payload cannot steer fetch
or curl at LAN/loopback/file: targets. HiAnime and Miruro curl children killed
by Ctrl-C (exit 130/143) or a caller abort now surface as AbortError-class
cancellations instead of retryable network faults, every curl argv terminates
options with `--` before the upstream URL, Miruro's pipe decode failures map to
non-retryable `candidate-parse`, and its curl spawn takes the abort signal
directly so a mid-spawn abort cannot strand the child. AniDB's HLS master
expansion no longer follows redirects inside curl (`-sL`): it walks each hop
itself so the per-hop blocklist applies. `curl_` wrapper discovery is
case-insensitive so `Curl_chrome150.bat` resolves on Windows.

Shell: the settings draft now flushes on unmount instead of losing a change
made inside the 300 ms debounce, provider-supplied track labels are sanitized
in the two-pane layout, the provider memory panel stops duplicating the
"skipped in auto-fallback" note, the image-capability memo key covers every
environment input it reads, and keyed inflight tasks clean up without spawning
an unhandled rejection on failure.

Config and updater: `mergeKitsuneConfig` overlays object-valued keys instead of
replacing them, so a hand-edited `{"sync": {"anilist": null}}` or a partial
language profile can no longer crash `x.y.z` readers or silently drop sibling
keys. Version-lock stale reclaim is serialized through a claim file and rewrites
the lock in place after re-verifying file identity — a live lock can no longer
be deleted out from under a racing winner, and abandoned claims are swept.
`curl --version` feature probes are time-bounded, and the HLS relay rejects any
non-zero curl exit instead of relaying a truncated body that still carried a
parseable status trailer.

perf(providers): persist stable provider metadata across sessions ([#205](https://github.com/KitsuneKode/kunai/issues/205))

AniDB external ids (MAL/AniList/official aid + poster) and official episode
metadata now ride `context.cache` instead of dying with the process, and
VidLink's deterministic enc-dec ids persist within their existing 30-minute
TTL. Stream URLs and signed credentials stay memory-only by contract.

Add `providerDefaultsRevision` so future default changes reach existing users.

Every setting save writes the whole merged config, which means the shipped anime
provider default is baked into `config.json` for anyone who has ever launched —
indistinguishable from a deliberate choice. A revision stamp is now written on
load, and `ConfigServiceImpl` migrates a config whose anime pair is exactly what
a release once shipped (`anidb`/`["anidb"]`, `["anidb", "allanime"]`, or a
config older than the priority key) to the current defaults, once. Any other
pair is left alone, and picking a provider afterwards sticks.

This changes nothing user-visible yet — it is the mechanism a future
default-provider change uses instead of stranding existing installs.

Report a blocked provider as blocked, and stop advising a fix that was already applied.

Three failure-classification fixes, all of which were spending retry budget or
misleading the person reading the error.

**A Cloudflare challenge is not retryable.** AniDB reported every failure as
`retryable: true`, including a Cloudflare block. The engine reads that flag to
decide whether to buy a provider a second full attempt — 12 seconds each under
the `balanced` default — so a block that no retry can clear was costing up to
half the resolve budget before any fallback was considered. AniDB now mirrors
the policy AllManga already uses for its captcha gate: a typed `blocked` failure
is not retryable, anything else is. Related: on the no-curl path a challenge
arriving with a 4xx status was never recognised as a challenge, because the
status was read before the body. The body is now read first.

**The `dns` substring no longer means "offline".** Network classification
matched any error message containing the three letters `dns`. A title echoed
into an error, or a path containing `dns`, was enough — and two such failures
across two providers halt every remaining live candidate, including working
ones. The resolver's actual phrasings (`Could not resolve host`, `Name or
service not known`, `no such host`, `dns lookup`) are enumerated instead.

**Errors name the request they failed on.** A hianime resolve is four network
hops; `hianime fetch HTTP 503` did not say which one died. Both providers also
suggested installing curl-impersonate to users already running
curl-impersonate — advice the reader has already followed, which makes a blocked
upstream look like a local misconfiguration.
||||||| parent of 757e29a79 (fix(providers): stop flattening transport and HTTP failures into "empty")

Raise the provider failure floor: classified HTTP and transport errors no
longer degrade to generic network noise or fake "empty" results.

- `resolveDirectStreamSource` unwraps `ProviderHttpError` instead of flattening
  every error to `network-error`/`retryable: true` — a 404, a 429, and a dead
  host now report what they are (helps vidlink today; vidrock/rgshows inherit
  it via the shared engine).
- Rivestream: raw transport failures report `network-error` (was `not-found`),
  offline signatures are non-retryable so the cycle's network-offline
  early-exit fires, the 10s candidate timeout is clamped to the attempt
  budget (it was dead code under `fast`), and a block on the shared
  rivestream.app front door stops the cycle instead of failing every service
  identically.
- AllManga: HTTP statuses and fetch failures throw classified
  `ProviderHttpError` instead of returning an empty source list — a dead
  connection or a 503 no longer reads as "episode has no sources"; rate-limit
  and crypto-refresh exhaustion report `rate-limited`/`provider-unavailable`
  instead of empty.
- VidLink: `HTTP ${status}` strings become `ProviderHttpError` so status
  fidelity survives to the failure record.
- HLS ladder (`expandHlsMasterPlaylist`): transport and HTTP failures throw
  `ProviderHttpError` instead of collapsing into a fake `auto` variant — a
  dead HLS host no longer comes back attested as a resolved stream. The `auto`
  row remains for fetched bodies that are not master playlists.
- Stream probe: unverifiable TLS chains ("unable to verify the first
  certificate", self-signed, missing local issuer) are definitive failures
  like expired certs — a broken chain fails the resolve gate instead of
  retrying and passing through.
- HiAnime: `ProviderHttpError` keeps its fidelity through failure mapping
  (`not-found`/`blocked`/`provider-unavailable` instead of generic
  `network-error`), and `provider-unavailable` joins the retryable allowlist
  since upstream 5xx maintenance windows heal.
- AniDB: `searchAnidb` and the HLS ladder fetch report HTTP status, so a 503
  maintenance page surfaces `provider-unavailable` instead of parsing as an
  empty catalog; per-mode settles classify `AnidbHttpStatusError` by status.
- AllManga: per-source link fetches throw classified `ProviderHttpError`, and
  when every adapter lane refuses with a real status (403/429/5xx) the refusal
  surfaces instead of an empty list; 404s stay lane-scoped so the required-Ak
  fallback still fires.
- Live matrix parser: multi-JSON stdout (YouTube emits report + ladder +
  shorts checks) and stderr reports now parse instead of reading as harness
  failures.
- New conformance test bans raw `candidateTimeoutMs` literals — the clamp bug
  has shipped three times.

When a lane's configured default provider is persistently `down`, Kunai now
drops a one-row inbox notice naming it and suggesting a healthier alternative
— the difference between a user debugging their network and a user switching
provider.

The suggestion is lane-aware: an anime default that dies recommends an anime
provider, never rivestream. Priority order comes from `providerPriorityForLane`
and candidates are filtered to providers actually loaded for that lane.

Keep validated downloaded files playable after their recorded provider is retired.
Local episode navigation and autoplay preserve resume, timing, and subtitles without
provider resolution or remote release metadata refreshes.

Keep local files out of HTTP preflight, retain duration when mpv clears terminal
properties, and show downloaded-file facts in Tracks without replaying rejected
provider switches.

Three call sites re-derived the lane predicate as `isAnimeProvider === (mode
=== "anime")` — a two-way boolean that treats the YouTube lane as "series".

The provider picker in YouTube mode offered and persisted series providers,
the post-play provider count included them, and a "series lane" health reset
silently cleared YouTube's failure memory. All three now use the canonical
`providerMetadataMatchesLane(metadata, shellModeToProviderLane(mode))`, and
the health-reset lane boundary is pinned by a test.

Stop a provider that answers "nothing" from failing as an internal error.

Some provider APIs reply `200 OK` with a body of `null` when they have no
source for a title — VidLink does it for every title right now. Kunai read a
field off that reply and threw, so instead of moving on to the next provider it
reported an error from inside itself.

Four providers read a response this way — VidLink, Videasy, AllManga's title
lookup and its key bootstrap — and all four now treat an empty reply as "no
source here" and hand over to the next one.

Harden provider stream resolution and mpv playback handoff:

- **Miruro & Rivestream failover**: Probe stream reachability during candidate cycle resolution, automatically failing over from unreachable or rate-limited (HTTP 429) CDN endpoints to healthy mirror servers before returning to mpv.
- **Rivestream DASH & Origin headers**: Accurately detect `.mpd` manifests as DASH (`protocol: "dash"`, `container: "mpd"`) instead of misclassifying as MP4, and supply CORS `Origin` headers.
- **AniDB maintenance detection**: Safely detect HTTP 503 and HTML maintenance pages during search, preventing false 0-result displays by marking the provider offline.
- **AllAnime persisted query drift**: Classify `PersistedQueryNotFound` as upstream GraphQL hash drift with clear non-retryable diagnostics rather than collapsing into empty sources.
- **YouTube playback hardening**: Add `/ba` audio fallback to yt-dlp format selectors (`bv*+ba/b/ba`) for audio-only and podcast uploads, explicitly set `--ytdl=yes` on one-shot mpv spawn, and fail closed early on rental/payment-required videos.

fix(providers): revive KickAssAnime on the CatStream rotation and wire AllManga into endpoint health

KickAssAnime's servers list renamed `VidStreaming` to `CatStream` on the same
cat-player page, and its manifest now arrives protocol-relative
(`//bl.krussdomi.com/…`) rather than double-slashed — both names are playable
and the URL normalizer pins the bare `//` form to https. AllManga's source
cycle now keys candidates on each stream's own host and feeds the shared
endpoint quarantine, so a mirror host refused by the resolve-gate probe is
skipped on the next resolve instead of being re-probed forever. The status
sweep probes all twelve production modules (vidrock, movy, animegg and
kickassanime were missing) and a roster-parity test fails loudly if the lists
drift again.

Confirm destructive Up Next actions and strip terminal escapes from untrusted surfaces.

Pressing `x`, `c`, or `C` in the Up Next queue acted immediately — one keypress
from an accident, next to Ctrl+C, with no status feedback. The first press now
arms (naming the target and count in the status line) and only the second press
mutates, keyed by row id so a resort between presses cannot retarget the
confirm; leaving the queue or pressing any other queue key disarms. Empty
states report honestly instead of silently no-opping.

Provider-controlled text reaching the terminal is now stripped at three more
choke points: playback-failure rows (provider names, titles, failure details),
overlay titles/subtitles (episode-picker subtitles embed the current title),
and `kunai://` handoff descriptions (the search query is shown pre-confirm).
The trailer spawn also terminates mpv option parsing with `--`, matching every
other mpv invocation.

Provider cache bounds: the five AniDB TTL caches and the two AllManga
show/source caches now carry entry ceilings (256/512), so a long session
browsing many titles cannot grow them without bound. The shared
`HealthTracker` also takes an injectable clock like `TTLCache`, so cooldown
expiry is unit-testable without real time.

Settings saves are no longer silent: a failed persist surfaces in the settings
error row and the diagnostics bundle, and exiting settings within the 300ms
debounce window flushes the pending draft on unmount instead of dropping it.

Keep pending analytics responses from restoring a disabled or rotated install identity or applying stale cadence and retry bookkeeping.

Keep cleared archived notifications from returning when the same signal is refreshed. Atomically suppress cleared identities while preserving active notices and allowing newer episodes.

Make secondary text readable, and honour reduced motion in the loading spinner.

Hints, placeholders, pending steps and metadata labels were drawn in colors that
passed the usual contrast ratio but were barely legible on a dark terminal. The
dimmest tier was barely above the level at which text is discernible at all on a
selected row. The three secondary text tiers are brighter now (same hue, lightness only),
the 256-colour fallbacks match, and a test keeps them there. Where a hint also
set the terminal's own "faint" attribute on top of its color, which dimmed it a
second time, that is removed.

`KUNAI_REDUCED_MOTION=0` no longer turns reduced motion on, and the loading
spinner now stops animating when `KUNAI_REDUCED_MOTION` or `NO_MOTION` is set.
Both variables are documented under Customization.

Make error and series-complete text readable, and keep every text tier readable on a selected row.

Error messages were drawn in a red, and series-complete labels in an indigo, that were
much darker than the accent, warning and info colors beside them and hard to read on a
dark terminal. Both now use a lighter shade of the same hue. The red on the error
banner's border and in the falling petals is unchanged.

The three secondary text tiers are also a touch brighter, so hints and labels reach
their readability targets on a selected row, not only on the plain background.

Make `bun run verify:readme:commands` work with no arguments.

The root script passed no arguments, so the only invocation a developer ever
made printed usage and exited 2 while CI — which passes the full flag form —
looked covered. Bare now resolves fixture mode, the CLI package's own version,
and the host binary `bun run build:binary:host` produces, and says exactly that
when the binary is absent. The explicit `--mode/--version/--binary` form CI
uses is unchanged.

Preserve live sibling queues at startup, detect reused process IDs using persisted owner identity, and fence recovery and restore against concurrent owner changes.

Reject configuration saves after lock contention instead of writing unlocked.
Guard acquisition, stale recovery and release with generation-specific ownership;
retain live or foreign owners and allow a later retry after contention clears.

Remove dead provider/config surfaces: drop the unused `Provider.resolveStream`/`capabilities` projection, the `MediaTrackService`/`provider-work-lane-policy`/`download-scope-policy` wrappers, the `provider-relay-settings` re-export shim, test-only `checkStreamHealth`, the `playable-ref` module, `ProviderResolveInput.regionHint`, unused types (`ProviderAbortState`, `PlaybackRecoveryEvent`, `isProviderResolveResultExhausted`, `isProviderStreamReachabilityVerified`, `getProviderResolveStatus`, `getProviderSourceInventory`), and zombie config keys (`headless`, `autoDownload`, `autoDownloadNextCount`, `subLang`, `animeLang`, `powerSaverAllowManualArtwork`, `artworkPreviewsEnabled`) that were persisted and normalized but never read. Narrow `ProviderResolveInput.intent` to the values actually produced (`"play" | "refresh"`), `ProviderRetryPolicy` to the field actually read (`maxAttempts`), and drop `QueuePlaybackIntent.source` — write-only provenance nothing consumed. The tracks panel now surfaces an empty provider section's reason instead of dropping it silently, docs pages only badge `beta`/`planned` (not `shipped`), and the `· current` picker suffix is consolidated into one helper.

Remove the manifest `status` field (`production`/`candidate`) — it was a
display-only label that gated nothing; registration in
`loadProductionProviderModules()` is the real state. Providers no longer render
a `· candidate` suffix in the picker or Tracks panel. The provider-status page
now groups the daily sweep into Working / Limited / Down, with the raw sweep
verdict kept as a detail tag and per-provider limitations in the note column.

Preserve Up Next priority after reordering, keep claimed items out of the next
playback selection, and dispatch due downloads even behind many deferred jobs.
Keep the playback watchdog active during cache starvation, give the command
palette ownership of playback keys, and cancel the weekly digest dismissal
timer when its shell unmounts.

Limit startup cleanup to compiled Kunai binaries and preserve foreign files
during native uninstall.

Stop Rivestream selecting a source that cannot play.

Rivestream reported success for a playlist whose segments were refused by a
third-party CDN, so cycling stopped at the first server that merely responded
and never reached one that plays. It now proves a source before accepting it,
walking that source's qualities and moving to the next server only when every
distinct host has refused.

A refusal is also recorded against that server, so a mirror proven dead is
skipped on later plays instead of being re-walked every time.

Small runtime correctness fixes.

A malformed `kunai-track-changed` value from the mpv bridge used to surface in
the UI as "track switched (id NaN)". The router now accepts only the exact
`<audio|sub>:<id>` shape the bridge emits and drops anything else, still
clearing the property so a bad value cannot stick.

Musl detection no longer probes `/proc/self/exe`, `ldd`, or
`/proc/self/maps` at all — it reads
`process.report.getReport().header.glibcVersionRuntime`, which Bun and Node
populate on glibc builds and omit on musl. It is the one check that does not
depend on filesystem layout, and it is the same predicate Bun's own test
harness uses.

A dead `?? 0` in the HLS variant ranker is removed; `currentBandwidth` was
always a number.

Filtered provider search now routes through the provider's `catalogIdentity`
instead of a hardcoded compatibility list — vidlink and rivestream searches
were silently dead after videasy went dark because their catalogs were never
declared compatible. Every future provider gets working filtered search by
declaring its catalog, not by editing a list.

The videasy catalog endpoint walks the known mirror chain (db.wingsdatabase.com
first) instead of hitting the dead canonical host, and search-cache eviction
now skips overwritten entries and expires the earliest-deadline row first.

feat(catalog): season→entry resolution contract over the relation graph ([#266](https://github.com/KitsuneKode/kunai/issues/266))

`TitleIdentity` gains `relations` + `aliases`, and `resolveSeasonEntryId` walks
the prequel/sequel graph deterministically — continuations ("Part 2") and
movies are traversed but never counted as seasons, so the AoT chain resolves
S4 to Final Season rather than S3 Part 2. Ambiguous graphs fail closed.
Graph population and the AniDB consumer land as follow-ups.

Stop provider-supplied URLs from steering Kunai's own fetches at private
network targets.

Every URL a provider hands back — a stream candidate, an HLS master playlist,
a subtitle file — is untrusted markup. Until now the stream probe, the HLS
rendition ladder, the playback-time manifest prefetch, and the subtitle
downloader all fetched those URLs (and whatever playlists derived from them)
without checking where they pointed. A hostile or compromised page could name
`http://169.254.169.254`, a LAN address, or `localhost` and Kunai would issue
the request itself.

All of those fetches now run through a shared target guard: http(s) only, no
loopback / link-local / private / CGNAT / multicast literals for IPv4 or IPv6
(including IPv4-mapped and NAT64 forms), no `localhost`-family or single-label
intranet names, and — when the real fetch is used — DNS answers are checked so
a public-looking name cannot resolve to a private address. Redirects are
followed by hand and re-validated at every hop (bounded at 3), and credentials
headers no longer cross origins on a redirect. A blocked target reports as a
definitive unreachable probe, so the resolve gate rejects the candidate and
the player never sees the URL.

Classify provider HTTP failures structurally instead of by message text.

Every non-OK provider response now throws `ProviderHttpError` — status, error
code, and retryability attached — from a shared contract in `@kunai/types`.
HiAnime, AniDB, Videasy, Miruro, VidLink, VidRock, RGShows, and the YouTube
lane (Invidious + Piped) all carry the structure, and Miruro preserves it when
wrapping a status error.

The cycle engine reads the structure first: a 429 classifies as
`candidate-rate-limited`, a 5xx as `candidate-server-error`, and a 401/403 or
Cloudflare/WAF block as `candidate-blocked` — instead of degrading to a
retryable "network blip" that spins to the attempt cap. Rate-limited and
server-error failures now reach endpoint-health quarantine as real evidence,
while provider-wide blocks stay out so a session guard cannot poison a healthy
mirror. Wrapped errors keep the original classification, and direct-layer
classifiers prefer the structured fields over message matching.

Keep searching for preferred subtitles when English was attached as a fallback, and match three-letter subtitle language codes during automatic selection.

Fix terminal text measurement for non-ASCII titles and wrap long error text.

Truncation counted UTF-16 code units as terminal columns, so a title in CJK
came out nearly twice the intended width and a clip could split an emoji
surrogate pair. Word-boundary truncation now walks columns — wide characters
count as two, combining marks as zero — and falls back to a column-aware hard
cut when no boundary fits.

The playback-failure panel now wraps the free-text failure message and debug
excerpt to the panel's text width instead of clipping them mid-word at the
edge, so the sentence that says what failed is the one you can read.

Measure terminal text in display cells and truncate complete grapheme clusters.
Keep joined emoji, flags, keycaps and combining accents intact while aligning
multilingual titles and metadata.

Strip terminal OSC sequences that end with the string terminator (`ESC \`), not
only BEL, so a provider title can no longer smuggle a hyperlink payload into the
screen. The sanitizer also stays linear on text packed with unterminated escape
introducers, which previously made it rescan the whole string per escape.

Fix provider server cycling skipping rules that never fired.

Rivestream never consulted endpoint health, so a quarantined mirror was
re-requested on every resolve (both the prefetch and the cycle asked it), and
its per-mirror timeout sat above the attempt budget where it could never fire.
It now skips quarantined mirrors before any request, sizes its timeout inside
the attempt budget on every startup profile, and fetches on demand if a mirror
becomes eligible mid-resolve. Miruro joins the same health gate, and its
Cloudflare fail-fast budget tracks the mirror list instead of a hardcoded 2.

Preserve unrelated tracker credentials when connecting or disconnecting through the native credential vault.

Allow Tracks to resolve declared but deferred sources from warm inventories while continuing to reject removed source and stream choices.

Keep download and offline asset records when file removal fails or another instance has claimed the job. Commit job and asset removal together before notifying listeners, and let Library and Downloads show retained-file results instead of optimistic deletion. Downloads confirmation follows the selected job identity across list refreshes.

Keep missing titles from damaging provider availability, and remove streams refused by the resolve gate from selectable quality inventories.

Print a clean `--version` channel.

`kunai --version` from a source checkout no longer wraps the channel in nested
`(detected)` parens, and running `bun run src/main.ts --version` from `apps/cli`
no longer reports `unknown`. Source runs print `(source)`, packaged binaries
print `(binary)` (or the `install.json` / managed-package method when present),
and leftover undetermined script runs print `(dev)`.

Fix Videasy handing the player a stream the CDN refuses.

Videasy carries two origins that are not interchangeable: the front-end we
impersonate when calling its API (`cineby.at`), and the origin the media CDN's
hotlink rule accepts. The resolve path reused the first as the second, so the
default movie/series provider shipped a URL that answered 403 the instant it was
resolved — while its own resolve gate probed the correct origin and reported
success, which suppressed falling back to a source that would have played.

The stream origin is now a single constant with no override, so the request that
is verified and the request that is played cannot drift apart.

Videasy no longer attests `streamReachabilityVerified` from its resolve-gate
probe.

Issue [#361](https://github.com/KitsuneKode/kunai/issues/361) showed the probe's 200 does not survive to the player on this
provider's signed CDN URLs — the next identical request, mpv included, gets 403. Shipping `verified: true` made downstream health checks trust the false
green for five minutes and replayed the dead URL from cache instead of failing
over. The probe still runs as a negative gate (definitive failures still move
to the next flavor), but a green probe now ships the result unattested so
resolve-gate and cache-revalidate re-probe rather than trust it.

Fix Videasy shipping streams that could not be opened, on the server it picks most often.

Videasy checked each candidate stream before offering it, and reported the check
had passed — then playback failed immediately. The check and the player were not
asking the same thing: the check sent one `Origin` header and the stream Kunai
handed to mpv carried another, and the CDN behind Videasy's Yoru server accepts
the first and refuses the second. So the provider verified a request that was
never made, and the failure only appeared once the player had already started.

Both now send the origin of the player these sites actually embed, taken from
one place so they cannot drift apart again. Where this was failing it now plays;
the other Videasy servers accept either header and are unaffected.

fix(vidlink): classify HTTP failures and honor endpoint quarantines on both legs

VidLink's `enc-dec.app → vidlink.pro` chain collapsed every non-OK status into
a retryable network error — a persistent 429/403 retry-stormed on every resolve
and wrote misleading health. Failures now classify through `ProviderHttpError`
(rate-limited/blocked/not-found/provider-unavailable), and both legs consult
`endpointHealth`: quarantined endpoints are skipped without spending a request,
and 404s — the service not carrying the title — never record health evidence.

Move the shipped lane defaults to providers that answer: VidLink for
movies/series, HiAnime for anime.

Two upstreams the 0.3.0 defaults leaned on have gone dark:

- `api.videasy.to` no longer resolves at DNS (NXDOMAIN, globally — not an ISP
  block). It hosts the provider's TMDB-mirror DB and its legacy non-wings
  endpoints, so a Videasy-led lane loses title-metadata enrichment and part of
  its source inventory. The wings stream endpoints on `api.speedracelight.com`
  still answer, so Videasy stays registered as the lane's last fallback.
- `anidb.app` answers 503 at the origin; ani-cli made the same switch in
  c99221d ("replace anidb with hianime provider", a `fix:`). The AniDB search
  path also used to parse that error page into an empty result list, so an
  outage looked like "no results". `searchAnidb` now reports HTTP status —
  503 surfaces as `AnidbHttpStatusError` instead of `[]`, and a 404 from the
  context fetch is answered inline instead of spending a curl fallback on it.

`providerDefaultsRevision` moves to 2 and the migration now covers both lanes:
a config still carrying a shipped pair (`videasy` + `["rivestream","vidlink"]`,
or `anidb` + its shipped lists, including a `vidking`-era provider id) is moved
to the new defaults once. A reordered list, a non-default pick, or a config
already stamped is left alone, and a user who re-picks Videasy or AniDB
afterwards keeps it.

Videasy stays registered (last in the series lane) so a resurrected domain is a
fallback again; AniDB stays second in the anime lane for its AID cross-link and
XML episode titles. TMDB lookups gain a proxy circuit breaker: after the Videasy
proxy fails once it is skipped for five minutes rather than adding a stalled
DNS/TCP miss in front of every direct call, and a caller abort no longer counts
as evidence the proxy is down.

Stop the HLS relay from failing on Windows when curl has no HTTP/2.

The relay spawns the literal `curl` from PATH and always passed `--http2`.
Windows' System32 build is Schannel with no nghttp2, and it rejects that flag
outright (`the installed libcurl version doesn't support this`, exit 4) rather
than negotiating down, so every stream routed through the relay failed on a
stock Windows host. The relay now probes the binary's feature list and drops
the flag instead of the request.

The installer also stopped hiding the `cURL.cURL` upgrade prompt when
curl-impersonate is installed. They are different binaries solving different
problems: curl-impersonate clears Cloudflare for the provider clients, and
carries no `curl.exe` of its own.

Install yt-dlp and curl-impersonate on Windows one-click installs.

`irm … | iex` left YouTube and anime search broken: `winget install yt-dlp`
matches both the real package and a Microsoft Store listing, so it refuses to
run, and curl-impersonate has no Windows package at all. The native installer
now drops verified GitHub binaries into `%LOCALAPPDATA%\kunai\deps\` and puts
those folders on the User PATH. `mpv` is still a package-manager prompt.
`-SkipDeps` skips the helpers. Doctor's copy-paste fallback is
`winget install --id yt-dlp.yt-dlp -e`.

Managed helper digests are retained and rechecked on later installs, so an
interrupted or modified helper is repaired instead of accepted by filename.

## v0.3.0

Give Kunai a mascot, and one of her rather than two.

Kanna is a rose kitsune. A **kanna** (鉋) is a Japanese hand plane. You run it
over rough wood and the roughness leaves in one curl. Kunai is the blade; she is
who holds it.

- **She appears where waiting happens, and nowhere else.** Setup, the setup
  summary, the goodbye screen, and (as one short line of text) every empty and
  error state. That text tier is the one that matters: the illustrated fox needs
  a graphics protocol and reaches four terminals, while copy reaches all of them.
  She is silent on `loading`, `info` and `success`, which already say what is
  happening.
- **`KUNAI_PET=off` retires her entirely**, text included; `glyph` pins the
  portable 🦊; non-TTY output gets neither, instead of a stray emoji in a pipe.
- **Quitting is no longer slower for people who never see her.** The exit
  animation budget had tripled as a constant, so every user paid 440ms on every
  quit for a still that most terminals would never paint. It is now derived from
  whether the still will actually render.

Kunai had been shipping two mascots. A pixel-grid generator called itself the
source of truth and fed the README hero, both social cards, the GitHub preview
and the Discord icon, so everything a person met _before_ installing was a
different animal from the one inside the program. There is now a single traced
vector source, and every one of those surfaces renders from it.

She appears in the terminal where the session is actually waiting: while
providers are being raced, on the beat where a stream is handed to mpv, and when
a resolve fails. One rule keeps that from becoming clutter: she never competes
with content artwork, so where a poster renders she does not. Failure is the one
exception, because a surface explaining what went wrong outranks a picture.

Every surface reports what the session is _doing_ and a single host decides what
to draw. That is what retires the three poses which were embedded in the binary
with no way to reach them, and it is enforced: one test fails if an embedded pose
becomes undrawable, another if a moment has no reporter.

On the docs site she roams, and she is an animal with attention rather than a
cursor mirror. She has to notice a movement (small ones are ignored), take a beat
to decide, walk over, and settle _beside_ you rather than on you; anything that
lands under the pointer reads as cursor decoration. Changing direction mid-walk
costs her a moment of speed instead of snapping. At rest she watches you, gets
bored, and only then curls up. She is goofier there than in the terminal on
purpose: the CLI is her at work, where a chatty line in someone's shell is a bug.

The browser tab is hers too: the favicon is Kanna rather than the blade mark,
which stays as the insignia on badges and the cards.

Fixes found while building it, all pre-existing:

- **Ctrl-K search on the docs site returned nothing for every term.** The route
  declared `dynamic = "force-static"` while exporting a `GET` that answers one
  `?query=` per request, so Next prerendered it once with no query and served
  that forever. The built payload was two bytes.
- **A failed clipboard write still reported success.** The copy button did not
  await `writeText`, so a rejected write (insecure context, denied permission,
  no clipboard API) still said "Copied" and still fired the event the fox
  reacts to.
- **Discord presence printed its status twice** on the shell boot line, both
  settings actions, and the diagnostics reason: "unavailable · unavailable ·
  Could not connect to…". Four surfaces composed that line by hand and all four
  repeated a status the detail already carried.
- **The social card drew its type row on top of the mascot.** The layout was
  written for a corner peek on a dark square with empty space beside it; the art
  changed to a centred bust and the layout did not follow.
- **The installer Docker matrix was failing every scenario on both libc
  variants** with `release companion not found`: the build job uploaded raw
  executables while the fixture installs from the archive.

Security, honesty, and platform fixes from a full codebase review.

Provider source reliability and lower cold-start waiting.

- **AniDB:** source inventory now comes from exact per-episode `jpn`/`eng`
  evidence. The requested audio mode resolves first; optional alternate audio is
  skipped in fast mode and bounded in balanced/quality-first modes, so a slow or
  missing alternate cannot hold a playable requested stream or appear as a
  selectable source.
- **AllAnime:** the mkissa build-140 crypto rotation is locked with independent
  known-answer vectors and exact bootstrap-header tests. Cold episode-catalog
  and crypto preparation now overlap, and baseline source adapters share a 1.5
  second inventory window so a dead mirror cannot hold already-playable peers.
  The production cold smoke kept four candidates while dropping from 12.257 to
  2.573 seconds; request retries and their individual deadlines are unchanged.
- **Relay diagnostics:** `bun run test:relay` reads the user's existing relay
  config without modifying it, preflights `/health` through Bun itself, then
  runs the AllAnime smoke in an isolated profile. It reports only the relay
  origin, token presence, provider count, and bounded failure code; full URLs,
  URL queries, fragments, embedded credentials, and tokens are not logged.
- **Provider ordering:** the default remains `animeProviderPriority: ["anidb"]`.
  The field is documented as ordering rather than an allowlist; registered
  AllAnime and Miruro providers remain available behind AniDB.

Launch flags, discovery, and the queue.

- **`-S <query>` shows its results.** The search ran, but the view and the shell
  were both chosen from a state snapshot taken before it finished, and that
  snapshot is empty by construction, so a successful search landed on the empty
  search surface and looked like the query had merely been typed for you.
- **A search on launch now shows a loader.** The idle surface rendered the
  welcome screen regardless of search state, so the header said "searching" over
  a screen with no sign of work in flight.
- **`-i/--id` says when it is ignored.** An id without a usable `-t`, or under
  `-a`, was dropped with a debug-only warning, so the run looked normal and the
  flag silently did nothing.
- **`/random` and `/surprise` honour your Discover tray size** and are on the
  browse palette next to `/trending`. The tray was clamped to five picks while
  the setting's smallest option is twelve, so no configured value could ever
  take effect; a uniform shuffle also discarded the stratification that keeps
  one source from filling the tray.
- **`/up-next` opens during playback.** The queue was reachable everywhere
  except the one activity that consumes it.
- **`--dry-run` prints the plan instead of starting a session.** The flag was
  documented as a general launch flag and read in exactly two places
  (`--install-protocol-handler` and `rollback`), so `kunai -S "Dune" --dry-run`
  parsed it, discarded it, and mounted the full interactive shell, starting the
  session it had just promised not to. It now prints the resolved mode, surface,
  query or title, auto-pick, and any flag it will ignore, and exits before
  anything is created: no version lock, no version pruning, no database, no
  terminal probe.
- **`--zen` no longer plays a title you did not pick.** Zen is documented as a
  bare layout, but it set `--quick`, which is not a layout flag at all; it means
  "auto-pick result #1". `kunai -S "Dune" --zen` skipped the result list and
  started playing the top hit. Zen now changes chrome only; use `--zen --quick`
  for the old behaviour.
- **Finishing a title no longer triggers a search you did not ask for.**
  Launching with both a query and a direct target (`-S "Dune" --history`, a
  share link, `-i` with `-t`) left the query armed after the chosen title
  played, so the session bounced into a stale search when playback ended, and
  with the auto-pick index still set, under `--quick` that search immediately
  played its first hit, writing a history row and a tracker sync for a title
  nobody selected.
- **The library footer stops advertising a key that did nothing.** `m` was
  registered for a title-control menu and shown as available; no handler read
  it, so the keystroke was typed into the filter box instead.

Privacy hardening, and a consent bug in the installer.

- **Diagnostics no longer leak signed-CDN tokens or your IP address.**
  Redaction judged only the parameter _name_, so anything the CDN keyed
  differently (`?q=<token>`, `?md5=<hash>`, `?ip=`, `?client_ip=`) passed
  through intact into the debug log, the diagnostics store, and the support
  bundle people paste into GitHub issues. Values are now judged too: an
  unbroken high-entropy blob is redacted, while readable values like `?q=Dune`
  survive so traces stay useful.
- **Analytics sends a hash, never your install id.** The ping now carries
  `sha256(installId)`; the id itself never leaves your machine. The payload is
  still exactly five keys. Because the hash input changed, installs from before
  this release are counted once more.
- **You can rotate your install id** from Settings while staying opted in. The
  new id is freshly random, so earlier pings cannot be linked to it. Disabling
  analytics still clears the id entirely.
- **The installer no longer treats "no terminal" as a yes.** `curl … | bash` in
  CI, a container, or a sandbox would auto-answer the optional-dependency
  prompts and run `sudo apt-get/pacman/dnf install` unattended, because
  `-r /dev/tty` tests permission bits rather than a controlling terminal and a
  failed read fell through to the default. `--yes` is now the only thing that
  accepts on your behalf; a skipped step says so.
- **`kunai` works in the next terminal you open.** The installer printed a PATH
  line and stopped, which changes nothing in your shell, so on macOS and
  Alpine, where `~/.local/bin` is not already on PATH, the install "succeeded"
  and the command was not found. It now writes your shell profile (opt out with
  `--skip-path-update`) and prints one `source` line for the current shell.
- **Apple Silicon binaries run.** Release binaries are cross-compiled on Linux
  and therefore arrive unsigned, which arm64 macOS refuses to execute; the
  shell reports only `killed: 9`. The installer now ad-hoc signs on your Mac.
- **The public usage page works.** `/analytics` on the docs site showed
  "not published yet" permanently while the ingest was serving real data.
- **AllAnime survives a bad response** instead of failing the provider, and the
  relay's private-host guard covers IPv4-mapped IPv6 such as
  `::ffff:169.254.169.254`.
- **Discord Rich Presence can no longer end your session.** A malformed frame
  from Discord reached `JSON.parse` inside the socket callback, and a throw
  there is an uncaught exception rather than a rejected promise, which Kunai
  escalates to a fatal shutdown. A cosmetic, optional integration was able to
  print a stack trace over the UI and stop playback. Unreadable frames are now
  dropped, and a frame claiming an implausible size drops the connection instead
  of buffering toward it.
- **An unplugged drive no longer kills the session or strands the download.**
  When the download folder became unwritable or disappeared mid-session,
  preparing the output directory threw past the point where the job was claimed:
  the job stayed claimed for the rest of the run (displayed as queued, never
  startable again), and the error surfaced as an unhandled rejection, which is
  also a fatal shutdown. The job is now paused with a readable reason and picked
  up on a later attempt.
- **Reordering Up Next is all-or-nothing.** Positions were written one row at a
  time outside a transaction, so an interruption part-way left the queue with
  duplicate positions rather than a stale-but-valid order.
- **Anime playback stops stalling the interface between segments.** The relay
  decoded every video segment into a JavaScript string twice (once to find a
  status trailer, once to check whether the bytes were a playlist), which for a
  6 MiB segment cost about 50 ms of blocked main thread and 60 MiB of garbage,
  on the same thread that reads your keystrokes. Both checks now work on bytes.
- **The relay's CDN allowlist is a domain check again.** The patterns matched
  any hostname _containing_ the allowed name, so a crafted stream URL could
  point the local relay at an attacker's host.
- **The mpv control socket lives in a private directory.** It sat in the shared
  temp directory; on systems with a group-writable umask that left mpv's
  command interface reachable by another process running as the same group.
  It now uses `$XDG_RUNTIME_DIR/kunai`, falling back to an owner-only temp
  subdirectory (macOS sets no runtime dir). Windows is unaffected: it uses a
  named pipe.
- **Links open only if they are links.** External URLs went straight to
  `xdg-open`/`open`/`explorer.exe` whatever their scheme, and a value beginning
  with `-` was read by the opener as a flag. Only `http`, `https`, and `kunai`
  URLs are opened now; anything else is still shown and copyable.

- **Downloads:** provider stream URLs and headers are guarded before reaching
  yt-dlp (scheme check, leading-dash rejection, `--` terminator, CRLF-stripped
  headers), closing an argv option-injection path the mpv lane already blocked.
- **Storage:** the data and cache SQLite files (plus `-wal`/`-shm`) are chmod'd
  to owner-only on every open, matching config and token handling.
- **Windows:** every install path now installs real mpv instead of mpv.net.
  mpv.net ships `mpvnet.exe`, but Kunai probes for `mpv` and drives playback
  over mpv's IPC socket and Lua bridge, so a "successful" dependency install
  could still leave playback reporting mpv as missing.
- **CLI:** `--jump` help says what the flag does (auto-pick the n-th search
  result) and warns on invalid values; headless download failures and rejected
  `--handoff-url` values exit nonzero.
- **Playback:** one-shot mpv launches attach the full collected subtitle
  inventory and report the real track count; prefetched and back-navigation
  streams are re-resolved when blocked or older than five minutes instead of
  replaying a possibly expired URL.
- **AniSkip:** the TMDB to MAL fallback is refused beyond season 1, so
  split-cour anime no longer risk wrong auto-skip windows.
- **Docs:** the command-honesty gate counts the browse palette; user docs stop
  promising `/sync` as a typed command; the
  keybindings doc's post-playback table matches the code; provider descriptions
  state adapter roles instead of speed or "recommended" claims.

New in this release: `kunai completion <shell>` prints a completion script for
bash, zsh, fish, and PowerShell, covering every flag and maintenance
subcommand. `/docs` now opens the published documentation site at
https://kunai.kitsunekode.in instead of the GitHub tree.

Make shared playback targets easy to open outside an existing Kunai install.

- Copy browser-safe, catalog-anchored HTTPS links from `/share` and mpv.
- Add a stateless web handoff with native install guidance and no share-page analytics.
- Accept compact checksummed share codes and render scannable HTTPS QR codes with `/share --qr`.

Persist expensive provider intermediate data across restarts.

- Add a general `ProviderCachePort` (namespace + TTL) to the provider runtime
  context, backed by a SQLite `provider_cache` table, so a provider's expensive
  but stable intermediate data survives a restart instead of dying with the
  process.
- Miruro's episode catalog now reads memory → persistent → network, so the cold
  Cloudflare-gated pipe call (~6–13s) is paid once per catalog per TTL rather
  than once per session.

- The persist TTL is derived from the catalog's own air dates: a finished show
  persists for 12h, while an airing show persists until its approximate next air
  date (clamped to 2h–1 week), so a newly-aired episode is never hidden behind a
  stale cache.
- Only a non-empty catalog is persisted; a failed or empty body is never cached.
  The cache degrades to a no-op on any store error; a broken cache slows a
  resolve, never fails it. Stream/source URLs stay in-memory and are never
  persisted.

Warm the top anime result's episode cache during search.

- After an anime search, Kunai warms the persistent episode cache for the single
  top anime result in the background, so the Cloudflare-gated catalog fetch
  (~6s) is already paid by the time you pick it. It is fire-and-forget: it never
  blocks, delays, or fails the search. Deduped so a title is warmed once per
  session, and limited to one gated call per search to stay gentle on the WAF.

Keep the anime auto-skip and provider-relay paths working after upstream rotations.

- AniSkip now resolves a MAL id for AniDB titles, so opening and ending skips work on the default anime provider instead of silently never firing. The lookup shares the provider package's Cloudflare-aware transport and overlaps stream resolution, so it adds no serial request to playback start.
- AllAnime tracks the upstream `mkissa` rotation to build 119 and 7-day epochs; the previous constants failed every stream request with `AA_CRYPTO_MISSING_BUILD`.
- A relay no longer strips the provider-auth headers (`x-build-id`, `x-aa-boot`, `x-obfuscated`, `x-session-token`) that AllAnime bootstrap and Miruro decoding depend on, which previously made every bootstrap through a relay fail with `invalid_boot_token`.
- A Miruro request blocked by Cloudflare now names the user-owned relay workaround rather than reporting an unexplained failure.

Show posters on every terminal, including Windows.

- New half-block renderer decodes JPEG/PNG in process and paints two pixels per
  cell with truecolour SGR, so posters no longer require `chafa`, which is
  effectively never installed on Windows, where posters previously never
  appeared at all.
- Windows Terminal no longer auto-selects sixel: support only landed in 1.22 and
  the environment reports no version, so an older build rendered raw escape
  bytes. `KUNAI_IMAGE_PROTOCOL=sixel` still forces it.
- Poster cache moved onto the shared OS cache root (`getKunaiPaths`) instead of a
  hand-rolled `$HOME/.cache`, which is not a location Windows has.
- `KUNAI_IMAGE_PROTOCOL=half-block` forces the new renderer anywhere.

Playback reliability, calendar navigation, and shell responsiveness.

- Startup source failover walks the ordered source list before hopping providers, so a dead stream retries the next source instead of looping the same one.
- Resolve cancellation is honest end to end: abort reasons ride on the signal, late feedback from a cancelled resolve is dropped, and a stream that arrives after cancellation is never handed to mpv.
- Every exit routes through one phased shutdown coordinator with conventional exit codes (130/143/129), quiescing services and preserving playback, config, queue, and download state before disposal.
- Calendar navigation scrolls minimally instead of re-anchoring on every keypress, fixing the sliding rows and laggy arrows.
- The title-control menu (`m`) opens during playback instead of rendering underneath it, and cancel stays live across the whole bootstrap and failure window.
- The episode picker no longer collapses to a single entry when a provider listing fails or when continuing from history.
- Miruro resolves against the working mirrors only; Videasy reorders its first-phase servers and segment-probes HLS before attesting reachability.
- Search shows a query-aware loading skeleton, post-play artwork retries after a transient fetch failure, and quitting no longer pauses autoplay.
- Provider fallback moves to a deliberate `Shift+F` chord so a stray keypress cannot switch providers mid-session.

A last review pass over the release train, from real sessions:

- **A malformed language tag can no longer take down a resolve.** `Intl.DisplayNames.of()`
  throws on anything that is not a well-formed BCP-47 tag, and several values reaching it are
  not: YouTube's `a.en` auto-caption codes, `live_chat`, and `none`, which Kunai ships as its
  own default subtitle preference. Labels now degrade instead of throwing, YouTube's dotted
  auto-caption tags resolve to the real language, and the `live_chat` metadata track is dropped
  before it can reach the picker.
- **Setup keeps a language per media type.** Shows, Movies, Anime, and YouTube each hydrate from
  and write back to their own profile, so rerunning `/setup` no longer flattens choices made in
  Settings. `Tab`/`Shift+Tab` cycle the lane, `←`/`→` switch audio and subtitles, and `a` copies
  the active profile to all four lanes. Playback toggles start off until the recommendation is
  chosen. Accepting remaining defaults now lands on the final review screen before saving.
- **YouTube results identify what will open.** Videos, Shorts, playlists, and channels retain
  their shape through search, filters, and the details panel. `type:short` narrows YouTube search,
  preferring backends that provide an explicit Shorts signal, while live/upcoming/post-live
  status remains a separate badge so a collection or live entry is not mistaken for a regular
  video. Backends that omit a signal remain labelled conservatively.
- **YouTube live streams play.** mpv's ytdl hook turns each `ytdl-raw-options` entry into a bare
  `--flag` when its value is empty, so Kunai's `live-from-start=no` reached yt-dlp as
  `--live-from-start no` and `no` was read as a second URL. Live playback now joins at the live
  edge, holds a short demuxer buffer to stay there (at spawn and on every in-session
  replacement alike) and suppresses every seek that assumes a fixed position: the start
  argument, the loadfile offset, the watch-later resume prompt, and the seek that used to fire
  after an in-process reconnect.

- **YouTube quality is no longer capped at 360p, and a PO token is actually used.** The default
  player clients now lead with `visionos`, matching yt-dlp's own default: it is the one client
  with no Proof-of-Origin requirement, and yt-dlp skips rather than attempts formats whose token
  is missing, so a token-gated client in front spent a whole failover lane on formats that were
  never going to be offered. A configured PO token now survives a restart, reaches downloads as
  well as playback, and is written in the single-prefix form yt-dlp can actually parse; before,
  it was dropped by config normalization, omitted by downloads, and malformed on the wire.
- **A YouTube premiere says it has not started.** Opening one reports that instead of handing
  mpv a stream that cannot play yet, and rows carry view counts, humanized upload times, and
  live state.
- **Post-play keeps its escape hatches visible.** `/analytics`, `/sync`, and diagnostics are
  available from the command palette after playback, so a stopped session can inspect telemetry,
  tracker state, or recovery details without returning to browse.
- **A tracker sign-in can be cancelled.** Linking now runs in its own screen with visible
  progress, `esc` to cancel, and `r` to retry a failure. It previously passed a signal from a
  controller nobody held, so cancelling was impossible and the wizard waited on an unresponsive
  screen until the tracker's own deadline expired.
- **Stopping early shows where you stopped.** The post-play bar read season progress ("3 / 10"
  after 23 seconds of an episode), and films got no bar at all. It now reads elapsed position
  over runtime for both, without a misleading percentage or a season fallback when runtime is
  unavailable.
- **Discord presence clears when Kunai exits.** A single Discord IPC frame was allowed ten
  seconds while shutdown force-exits after four, and the clear also queued behind any update
  already in flight, so the card outlived the session. It now runs first and within the
  shutdown budget.
- **A withdrawn release says so.** Marking one withdrawn now lists it as withdrawn on the docs
  site with the rollback command and withholds its install commands, rather than dropping it
  from the page while its detail view still offered them.
- **AniDB understands a show's final season without guessing.** A standalone `Final Season`
  routes after the highest exact numbered sibling, while movies, split parts, spin-offs, and
  ambiguous story arcs remain excluded instead of becoming false season evidence.
- **Advertised queue and sync commands are reachable.** `/playlist-add` and `/queue-season`
  now appear during playback and post-play, where the current title is trustworthy; `/sync`
  opens the public sync surface, and failed setup links point back to Settings → Sync rather
  than a deliberately hidden nested command.
- **Windows install guidance names the real mpv package.** The README, npm package page, and
  platform guide use `mpv-player.mpv-CI.MSVC`, which provides the `mpv.exe` Kunai probes and
  controls, instead of the ambiguous package name that can leave only `mpvnet.exe` available.
- **History consolidation keeps the furthest watch state.** When an opaque row and its catalog
  row resolve to the same episode, the newer identity still wins while progress, completion,
  duration, and first-watched time keep the most useful evidence from both rows.
- **Legacy YouTube history keeps its poster while migrating.** Rekeying an older video row no
  longer drops its thumbnail from Library and Continue Watching.
- **Installer recovery refuses unsafe staging paths.** Bash now matches the TypeScript
  installer: abandoned transactions cannot escape the cache through traversal, prefix-sharing
  siblings, or a staging-directory symlink before cleanup.
- **Silent persistence and fallback failures are closed.** Shutdown waits for an in-flight
  settings save; failed discovery fetches are not cached as empty; absolute-numbered anime works
  in retention, cleanup, and crash resume; analytics rejects insecure overrides; relay sub-paths
  are preserved; Windows paths are measured before tightening; AniSkip survives an untimed
  IntroDB segment; unreadable config is not overwritten; and sandbox paths resolve only when used.

Also new since 0.2.5, the last release you could install:

- **YouTube lane.** Search, playlists and channels play through the same shell as
  everything else, with live/upcoming handling, SponsorBlock and cookie settings,
  and video watch history counted in your stats.
- **Playback that recovers.** Persistent mpv sessions, provider fallback with
  endpoint-health diagnostics, and honest cancellation: a dead source retries
  the next one instead of looping.
- **Share links.** `kunai://` round trips, so a title (and timestamp) can be
  handed to someone else or reopened later.
- **Offline and downloads.** Downloaded episodes play through the same path as
  streamed ones, so resume, subtitles and history behave identically.
- **New surfaces.** Up Next queue, playlists, notifications, release calendar and
  a details sheet, plus a reworked settings shell.
- **Native installer.** Self-contained binaries with a versioned layout and
  channel-aware `kunai upgrade` / `kunai uninstall`.

Retire the dead Videasy seed mirror and cover every production provider in the live matrix. `api.wingsdatabase.com` is NXDOMAIN on public resolvers and could never win the seed race, so it only spent a request slot and then occupied the host penalty box after every cold resolve. The live matrix now exercises all seven registered providers, including the default anime lane, which it previously skipped.

Give the Discord presence card a play button distinct from the catalog link. For a movie, or an anime known only by an AniList id, the poster, title, state row, and single button all resolved to one identical URL, and the play target was reachable only as presence text. Presence now leads with **Play on Kunai** over the https web-share route, and links the state row only when the episode page is a different destination.

Make `kunai diagnostics recent` readable in a terminal. A new `pretty` format groups events under a date heading, prints each session id once per run, and renders context as `key=value`. It is the default only when stdout is a terminal, so a pipe or redirect still receives `jsonl`. Colour follows the terminal and respects `NO_COLOR` and `--no-color`.

Reject untrusted or downgraded HLS relay redirects before requesting them, and bound yt-dlp streaming output.

Bound GitHub and npm update-metadata requests to 15 seconds, use the injected request path for every install channel, and reject malformed registry versions.

Preserve exact provider-native anime episode identities from catalog selection through playback, caching, downloads, and offline recovery.

- Keep Kunai's episode picker 1-based while resolving AllAnime episode zero, OVA, and special labels with their exact provider values.
- Prevent cache, selection, prefetch, dead-stream, download, and offline-library state from aliasing different provider episodes at the same UI position.
- Preserve existing numeric fallback behavior for legacy downloads and selections that predate provider-native episode identity storage.

Rebuild first-run setup as seven framed slides that write what they ask for: every control starts from your current configuration, so rerunning `/setup` no longer disconnects linked AniList or TMDB accounts or rewinds preferences to factory defaults; the language choice reaches anime, shows, films, and YouTube alike; `[s]` applies the slide's recommendation instead of committing whatever the cursor sat on; leaving asks before discarding answers and re-offers setup next launch if you left on the first slide; and tracker sync is only marked enabled once the browser handoff actually succeeds. The usage-ping slide stays recommended and pre-selected, and remains impossible to enable by skipping, accepting all defaults, or stepping onto the slide and back off it.

Serialize native installer activation across the in-process updater and the Bash and PowerShell installers, preserving launcher and manifest consistency during concurrent upgrades and recovery failures.

Download verified platform archives for native self-updates, safely extract one bounded executable in-process, and preserve rollback-compatible provenance while migrating schema-1 install manifests.

Install verified compressed native release assets from Bash and PowerShell, reject unsafe or oversized archive contents, and retain a 404/410-only fallback for older raw releases.

Redact standalone opaque credential values from diagnostics even when an upstream field uses an unrecognized name.

Keep unexpected background download-queue failures inside the download
subsystem so they cannot terminate playback.

YouTube plays at the quality you chose on the persistent player path. The format selector was set on mpv's `ytdl` option, which is a yes/no flag; mpv answered `unsupported format for accessing property` and dropped it, so the ceiling silently never applied while the spawn path honoured it. The two player paths now agree.

Tracker credentials are private on Windows and survive a power cut everywhere. The owner-only permission was applied under a POSIX-only branch, so on Windows `sync-tokens.json` and `config.json` kept whatever `%APPDATA%` inherited; they now get an inheritance-free, user-only ACL. Neither file was ever flushed either, so an atomic rename could reach the journal while the data sat in the page cache; a power loss left a correctly named, empty config. Both are now flushed before the rename and the directory entry after it.

`-i/--id` no longer leaves a placeholder title in your history, and a partial write can no longer erase external ids that were already resolved. Continue-watching rows keep the identity they were saved with.

A malformed Discord IPC frame can no longer end your session. Rich Presence is optional, but a bad frame from the socket could terminate playback or grow memory without a bound; the frame reader is now contained and bounded, and a presence failure degrades to no presence instead of taking the player with it.

Choosing a title shows the loader while it resolves, instead of a still screen that looked like nothing had happened.

AllAnime now reports a captcha-gated stream request as a blocked, non-retryable failure naming the relay workaround, instead of silently returning no streams next to a full episode list. It is also demoted out of the automatic anime fallback lane while staying manually selectable.

Keep anime films in the anime profile while preserving their movie structure through history, downloads, and offline playback. Unknown one-shot anime formats now stay episodic until their episode count is known, and HTML cleanup cannot turn encoded markup back into tags.

Repair the default AniDB anime route across current browse parsing, provider-native identity, season and absolute-episode routing, and production-derived release signoff.

Report `curl` in `kunai doctor` and setup. AniDB is the default anime provider and needs a curl (plain or curl-impersonate) to get past Cloudflare, so its absence could previously make anime search return nothing with no diagnostic anywhere.

Present movie, series, anime, and video positions consistently; persist movie downloads as title-level jobs; and keep download and calendar surfaces responsive through width, poster, loading, retry, and cancellation changes.

Make anonymous usage analytics explicit opt-in. Setup now defaults to off, Settings can enable or disable collection, and disabling removes the local install identifier.

### Privacy

- Do not send analytics before consent, without an interactive terminal, or when DNT or CI blocks it.
- Send only to the Kunai-owned HTTPS endpoint after explicit consent; reject insecure overrides
  without falling back to the default.

Recover active playback from transient buffer, stall, and seek states while rejecting stale mpv cycle events and presence updates.

Make Miruro resolution evidence truthful: stream reachability is attested only from an explicit probe, AniList identity is parsed once and strictly, the server try order has a single authority, every pipe decode stage raises its own redacted failure code, and subtitle format is inferred from evidence instead of defaulting to SRT.

Route every poster through one bounded Bun-native preparation seam, add iTerm2/VS Code inline images, and remove the chafa and ImageMagick runtime requirements. Posters now need nothing installed on any supported terminal.

Recognize Bun connection failures as offline, keep confirmed offline state until a successful request, and return failed searches with visible retry and offline-library guidance instead of silently replaying them.

Keep verified offline downloads on their trusted local media and subtitle paths, without provider recovery or remote playback metadata requests, and harden cancellation and reconnect handling around the mpv handoff.

Make the shell's own surfaces reachable and readable at the terminal sizes people actually use.

- `/analytics` and `/presence` answered "no matching commands" from the resume and starting-point pickers while the footer still advertised `[/] commands`. Both govern data leaving the machine, so being told they do not exist was the wrong answer. Picker command sets now come from one registry context instead of three hand-written arrays that had drifted apart.
- The Settings section tabs were unreadable at 80 columns: twelve names were squeezed into two-character stumps that wrapped onto a second line, hiding which sections exist. The strip now scrolls around the active section, which is always shown in full, with `‹`/`›` marking what is off-screen.

Rebuild tracker sync on a generation-safe SQLite outbox with typed tracker
identities and idempotent desired-state writes, so a redelivery converges
instead of toggling and a late completion cannot overwrite newer intent.

AniList now connects with no configuration at all: the implicit grant needs no
client secret, so Kunai ships an application id and nothing else. Delivery is
paced against AniList's published rate-limit headers, and a `429` defers the
whole batch for that tracker using the server's own wait rather than retrying
into it. Sync can be paused for a while (distinct from turning a tracker off),
with work still queueing while paused.

Favourites and watchlist now reach the right tracker. A list change carries the
title's catalogue ids instead of dropping them, and AniList is resolved from an
explicit id rather than from the lane a row arrived through; anime almost always
arrives as a TMDB-typed `series`, so the old lane check rejected the very titles
it existed to route while TMDB accepted them. Favouriting an anime wrote to TMDB
and never to AniList; more often it queued nothing at all and still reported
success. A title no tracker can address now says so instead of looking identical
to one that synced, and AniList takes precedence over TMDB when both resolve, so
one keypress files one title in one account.

Every TMDB write was rejected as unauthenticated: the adapter sent the v3 API key
as a bearer token and invented an `X-Session-Id` header, then addressed the
account by username. Auth moves to the query string TMDB v3 documents, the
numeric account id addresses the account, and an identity stored under the old
shape is repaired on next start rather than needing a reconnect.

Fixes several silent failures: removing a title from a watchlist reported
success when the lookup had actually been rejected; `ToggleFavourite` could fire
after an unreadable lookup, turning a redelivery into a flip-flop; TMDB's
"push watched" removed titles from the watchlist; validation errors retried
forever instead of dead-lettering; and an offline start silently unlinked a
connected AniList account. Permanently undeliverable changes are now reported on
the sync page, which previously read "up to date" while they sat there.

List membership is a set again: `(list_id, title_id)` is unique, so adding a
title twice keeps one row instead of two invisible ones, and the membership check
gets a covering index. Existing duplicates collapse onto the earliest row.

In the shell, the favourite mark moves to its own accent-tinted column on the
right; prefixed into the title, it took the title's colour and pushed every
favourited row a glyph out of alignment. A toggle now reports which way it
went, and where it synced, instead of "Updated favourites" for both directions.
Favourites reach the screens where you actually spend time: `l` toggles during
loading and playback, and the playing rail and post-play panel both show the
mark. The details panel gained a Favourite line beside Watchlist, which had
been describing one half of a pair.

Connecting TMDB no longer hangs when the API is unreachable. Artwork and
metadata try a mirror before going direct, so they can work on a network where
account linking cannot; linking must be direct, because a request token and
session id are account credentials. That now fails in seconds with an
explanation instead of stalling forever with no output.

Sync gains a settings page (the first reachable Connect surface) with a status
badge in the root crumb. It is marked experimental: the delivery path is covered
by tests but has not yet been verified against a live tracker account.

Harden Videasy's active path: TMDB identity must be a complete positive decimal, the selected-route cache policy has a single owner instead of being silently rebuilt, and Wings seed transport state is bounded. Cancelling a playback no longer marks both Wings hosts unhealthy for five minutes.

Harden installers and release asset completion checks.

- `install.sh` / `install.ps1` `--dry-run` / `-DryRun` compute paths without creating directories.
- Empty or incomplete release assets fail with specific messages and npm / Bun / source / pinned-version recovery guidance.
- GitHub Releases require all eight binaries plus `SHA256SUMS` (`fail_on_unmatched_files`, post-upload contract assertion).

Ship the npm postinstall registration hook in the published tarball and verify a clean global install, update check, and package-manager uninstall.

Ship the npm package as a minimal Node launcher with exact-version optional
platform binaries, and preserve the correct npm or Bun managed-install
ownership in the compiled CLI.

## v0.2.5

A large reliability + experience pass: continuous play, offline parity, smarter
anime classification, a rebuilt calendar, downloads that don't eat your RAM, and
a long tail of UX fixes.

### Highlights

- **Continuous play (Up Next).** Auto-continue into the next episode → your queue
  → a recommendation when caught up (cancelable countdown). `/queue` opens the Up
  Next panel; reorder queued items (move up/down); save the queue as a playlist;
  import/export.
- **Offline parity.** Downloaded episodes now play through the _same_ path as
  online: full resume **offer** (not a forced seek), auto-skip, OSD, track
  control, autoplay into the next downloaded episode, and history.
- **Smarter anime.** Deterministic TMDB anime classifier (research-validated)
  tags results as _Anime_; it is authoritative for the persisted content kind, so
  an anime watched via a series provider is still classified as anime. Fix a wrong
  label any time with `/mark-anime` · `/mark-series`.
- **Rebuilt calendar.** Rolling ±7-day schedule (past week + upcoming), type tabs
  (All/Anime/Series/Movies/Tracked), per-day navigation, `/anime-calendar` and
  `/series-calendar` shortcuts, boxed day chips with a distinct _today_ highlight,
  and aligned columns that no longer shift on long titles.
- **Share links.** `/share` copies a catalog-anchored `kunai://` URL for the current title;
  `/watch` opens a `kunai://` link from your clipboard. Use `kunai --open` for trusted terminal launch.

### Features

- Up Next: auto-continue (episode → queue → recommendation), queue reorder,
  `/queue` panel, active-playback "up next" hint.
- Offline: persistent-play pipeline, autoplay into next downloaded, partial-download
  badges (`↓ n/total`), availability index, pause-on-quit + auto-resume on return.
- Downloads: parallel N-worker pool (`maxConcurrentDownloads`, default 3, 1–5).
- Anime: TMDB classifier + "Anime" label, `/mark-anime` / `/mark-series` override,
  Miruro server labels.
- Calendar: 7-day past archive (+ prune), `/anime-calendar` / `/series-calendar`,
  `useCalendarState` hook.
- OSD: resume prompt anchored top-right; dismiss (Esc / left-click) and resume
  (Enter / middle-click).
- Tracks: `/audio` + `/subtitles` deep-links, favorite sources (auto-select prefers
  them), two-pane tracks panel.
- Settings: persist-on-change (no Ctrl+S), red destructive rows.
- CLI: `--help` / `--version`.

### Fixes

- **Config:** an explicit `vidking` provider choice now persists (was reverted every
  load).
- **Progress:** episode progress and series progress are now separate; finishing
  one episode no longer mislabels a whole series "Completed"; `unknown` release
  state → Continue, not falsely Completed.
- **Downloads:** runaway RAM + orphaned `yt-dlp` fixed (bounded fragment buffering,
  SIGKILL children on exit, socket timeout).
- **Calendar:** chronological day strip, no phantom "Nothing on schedule" days,
  enter-at-today navigation, no layout shift on long titles, ±7-day clamp.
- **Classification:** content-derived kind on the write path (drama-on-anime-provider
  no longer labeled anime).
- **Presence:** Discord shows a real progress bar only when duration is known.
- **Library:** offline episodes ordered by season/episode, not download time.
- **Playback:** failed-to-start stream no longer pauses autoplay; single-season
  episode-list escape no longer loops.
- **AllManga:** correct thumbnail CDN; ak-only fallback capped at 4s; next-episode
  prefetch no longer voided by a `startupPriority` mismatch.

### Performance

- App-shell list passes combined; independent cleanup + recommendation profiling
  parallelized; duplicate history fetch removed; O(n) offline-status grouping;
  trimmed preview/calendar model work.
