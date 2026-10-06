# Kunai 0.4.0

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

Add the HiAnime anime provider (`hianime`, ani-cli parity lane).

Search, episode catalog, and sub/dub resolves through the ZokoAnime server with HLS quality ladder, external English subtitles, and MAL-anchored auto-skip timing. HiAnime leads the anime lane by default; AniDB stays registered behind it.

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

Remove a stray NUL byte from `offline-title-identity.ts`.

The dedupe key separator was a literal NUL byte in source, which made the
whole file classify as binary — `rg`/`grep` skipped it and lint passes treated
it as an asset. The separator is now the `\x00` escape, producing the same
runtime string.

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

Keep pending analytics responses from restoring a disabled or rotated install identity or applying stale cadence and retry bookkeeping.

Keep cleared archived notifications from returning when the same signal is refreshed. Atomically suppress cleared identities while preserving active notices and allowing newer episodes.

Make `bun run verify:readme:commands` work with no arguments.

The root script passed no arguments, so the only invocation a developer ever
made printed usage and exited 2 while CI — which passes the full flag form —
looked covered. Bare now resolves fixture mode, the CLI package's own version,
and the host binary `bun run build:binary:host` produces, and says exactly that
when the binary is absent. The explicit `--mode/--version/--binary` form CI
uses is unchanged.

Remove dead provider/config surfaces: drop the unused `Provider.resolveStream`/`capabilities` projection, the `MediaTrackService`/`provider-work-lane-policy`/`download-scope-policy` wrappers, the `provider-relay-settings` re-export shim, test-only `checkStreamHealth`, the `playable-ref` module, `ProviderResolveInput.regionHint`, unused types (`ProviderAbortState`, `PlaybackRecoveryEvent`, `isProviderResolveResultExhausted`, `isProviderStreamReachabilityVerified`, `getProviderResolveStatus`, `getProviderSourceInventory`), and zombie config keys (`headless`, `autoDownload`, `autoDownloadNextCount`, `subLang`, `animeLang`, `powerSaverAllowManualArtwork`, `artworkPreviewsEnabled`) that were persisted and normalized but never read. Narrow `ProviderResolveInput.intent` to the values actually produced (`"play" | "refresh"`), `ProviderRetryPolicy` to the field actually read (`maxAttempts`), and drop `QueuePlaybackIntent.source` — write-only provenance nothing consumed. The tracks panel now surfaces an empty provider section's reason instead of dropping it silently, docs pages only badge `beta`/`planned` (not `shipped`), and the `· current` picker suffix is consolidated into one helper.

Remove the manifest `status` field (`production`/`candidate`) — it was a
display-only label that gated nothing; registration in
`loadProductionProviderModules()` is the real state. Providers no longer render
a `· candidate` suffix in the picker or Tracks panel. The provider-status page
now groups the daily sweep into Working / Limited / Down, with the raw sweep
verdict kept as a detail tag and per-provider limitations in the note column.

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

Fix terminal text measurement for non-ASCII titles and wrap long error text.

Truncation counted UTF-16 code units as terminal columns, so a title in CJK
came out nearly twice the intended width and a clip could split an emoji
surrogate pair. Word-boundary truncation now walks columns — wide characters
count as two, combining marks as zero — and falls back to a column-aware hard
cut when no boundary fits.

The playback-failure panel now wraps the free-text failure message and debug
excerpt to the panel's text width instead of clipping them mid-word at the
edge, so the sentence that says what failed is the one you can read.

Fix provider server cycling skipping rules that never fired.

Rivestream never consulted endpoint health, so a quarantined mirror was
re-requested on every resolve (both the prefetch and the cycle asked it), and
its per-mirror timeout sat above the attempt budget where it could never fire.
It now skips quarantined mirrors before any request, sizes its timeout inside
the attempt budget on every startup profile, and fetches on demand if a mirror
becomes eligible mid-resolve. Miruro joins the same health gate, and its
Cloudflare fail-fast budget tracks the mirror list instead of a hardcoded 2.

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
