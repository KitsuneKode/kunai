---
status: current
lastReviewed: "2026-11-12"
---

# FMHY starred sites and how Kunai providers actually get fixed

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- **Status:** research. No new module is proposed for registration.
- **Page read:** [fmhy.net/video](https://fmhy.net/video) on 2026-11-12. Bold entries are the stars. The grading wiki ([Stream Site Grading](https://github.com/fmhy/FMHY/wiki/Stream-Site-Grading)) scores UI, auto-next, lists, and mobile. A star is not evidence of a direct, probeable media URL.
- **Production roster** is only `loadProductionProviderModules()` in `apps/cli/src/container/bootstrap-providers.ts`: `videasy`, `vidlink`, `vidrock`, `rivestream`, `movy`, `allmanga`, `hianime`, `animegg`, `kickassanime`, `miruro`, `youtube`.

## What full parity means here

A site is at parity when a Kunai module can do all of the following for the lane it claims:

1. Resolve through `CoreProviderModule.resolve` and return only streams that `verifyCandidateStream` has probed. The probed request and the shipped request are the same request.
2. Classify failure with a real `ProviderFailureClass` (`blocked`, `provider-empty`, `rate-limited`, `provider-parse`, …). A dead host and an empty title must not both look like `network`.
3. Movie and series: take a TMDB id. Search and episode lists stay on the catalog, unless the provider's own catalog is the identity (Rivestream is the exception that ships both).
4. Anime: search, 1-based episode list, and sub/dub as separate candidates. Hardsubs are labeled hardsubs.
5. Quality rows, ISO 639-1 audio, and subtitle tracks when the payload actually has them.
6. Downloads use that same inventory.
7. Relay stays metadata-only. A media proxy is not a fix.
8. The other lane gets an explicit "not this provider" decision.
9. Registration happens only after the quality gate. A file under `packages/providers/src/` is not live.

FMHY's star criteria (1080p, subs, auto-next, watchlists, a custom player) overlap items 3–5 and ignore 1, 2, 7, and 9. Most starred aggregators fail 1 because they are a skin over someone else's player.

## Repair map for the providers already here

These are the drifts the dossiers already name. Each one has one repair, and that repair is not "add another site."

| Provider          | Lane          | What breaks                                                                                                                                                                                                                                                                                            | Repair that restores it                                                                                                                                                                                                                                                    | Do not                                                                                                      |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| AllManga / MKissa | anime         | The whole `ALLMANGA_CRYPTO_PROFILE` rotates together (`buildId`, salt, fragments, boot token). `unknown_build_id` means the build moved. `invalid_boot_token` means the constants drifted under a live build. Captcha is `blocked` and not retryable.                                                  | `KUNAI_LIVE_ALLMANGA_ROTATION=1 bun run test:live:allmanga-rotation`, then replace the whole profile from the live `cdn.mkissa.net` chunk that contains `x-aa-boot`. ani-cli v5 deleted this path; the chunk is the reference. See `.docs/providers.md` and `allmanga.md`. | Patch one constant. Compare against ani-cli `master`.                                                       |
| HiAnime           | anime         | Domain and embed host drift (`hianime.at`, `zokoanime.video`, `*.aniwatchtv.uk`). HLS masters with a separate audio rendition.                                                                                                                                                                         | Keep ani-cli's HiAnime lane as the parity reference (`scripts/parity-references.json`). Ship the master URL when a variant has external audio. Re-read search HTML and the episode JSON when the markup moves.                                                             | Split a video-only variant into a selectable quality.                                                       |
| Miruro            | anime         | A rotated XOR `PIPE_KEY` still "decrypts." Cloudflare is `blocked`, not `network-error`. One pipe fronts many backends, so one dead server is not a dead provider.                                                                                                                                     | Re-pin `PIPE_KEY` from the live pipe. Rank and drop empty backends. Dossier: `miruro.md`.                                                                                                                                                                                  | Treat a successful XOR as a probed stream.                                                                  |
| AnimeGG           | anime         | Hardsub only. The `bk` URL is sometimes a direct MP4 and sometimes an mp4upload page.                                                                                                                                                                                                                  | Leave soft subs empty. Use `bk` only after it probes as a direct file.                                                                                                                                                                                                     | Write an embed extractor for the backup.                                                                    |
| KickAssAnime      | anime         | Playable server renamed VidStreaming → CatStream. BirdStream is DASH and is parsed, then never chosen. Listed on FMHY, not starred.                                                                                                                                                                    | Accept either server name (already the production behavior). Add BirdStream only if it becomes a probed direct manifest.                                                                                                                                                   | Assume the old server string.                                                                               |
| Videasy           | movie, series | Seed host rotation. `api.wingsdatabase.com` is gone. Live seed is `api.speedracelight.com`. Session token is optional and user-supplied. OpenSSL `Salted__` envelope.                                                                                                                                  | Add a live mirror to `WINGS_API_BASES` only after `/seed` answers. Token stays `KUNAI_VIDEASY_SESSION_TOKEN` or settings.                                                                                                                                                  | Bake a relay host. Scrape a Turnstile. Treat Cineby or Bitcine as a second provider — both are this family. |
| VidLink           | movie, series | Some TMDB ids return HTTP 200 and JSON `null` (Dune 438631 did this on 2026-10-26; Fight Club and Inception still returned DASH). The `file` lane 429s. `enc-dec.app` is a single dependency. Playback needs `x-playback-environment: webkit` and the payload's `playlistHeaders`.                     | Requalify the DASH contract per title. Exhaust `provider-empty` on `null`. Keep the signed-cookie lane.                                                                                                                                                                    | Switch the default to the MP4 lane to make signoff green. Report a null body as success.                    |
| VidRock           | movie, series | AES-256-GCM key lives in `vidrock.net/assets/index-*.js`. Rotation throws; gated lanes return 400/403. Subtitles exist on `sub.vdrk.site` and are not wired.                                                                                                                                           | Re-extract the hex key when every lane throws. Skip a gated lane. A subtitle follow-up is a separate, probeable client of `sub.vdrk.site`.                                                                                                                                 | Fail the whole provider because one lane is browser-gated.                                                  |
| Rivestream        | movie, series | The watch client calls `scrapper.rivestream.app` (`/api/providers`, then `/api/provider`). `secretKey` is not on that request. A hung directory or a hung source call spends the attempt. `savannah`, `prometheus`, `quasar`, and `solstice` stay demoted. `primevids` returned sources on 2026-11-12. | Dossier `rivestream.md`. Discovery falls back after 1.5s. One source timeout stops the walk. Keep demoted names last.                                                                                                                                                      | Rebuild `generateSecretKey` into the request. Drop demoted names.                                           |
| Movy              | movie, series | Per-lane scraper 500s (`"dallas: title not found on idlix"`). Seed TTL is 30s, re-seeded once on 401. The anime lane (`anikoto/sources-id`) is unwired.                                                                                                                                                | Treat a lane 500 as that lane's miss. Reseed once. Anime stays unwired until Anikoto is a direct source — it is not. See `anikoto-candidate.md`.                                                                                                                           | Register the 16 upstream scrapers as 16 providers.                                                          |
| YouTube           | video         | Extractor drift in yt-dlp.                                                                                                                                                                                                                                                                             | Update the yt-dlp Kunai shells out to.                                                                                                                                                                                                                                     | Route it through the provider relay (`relaySafe: false` on purpose).                                        |

Cross-cutting, in the order they should be tried when a user says "providers are broken":

1. **Read the failure class.** `blocked` is Cloudflare or a captcha (`cloudflare-bypass-strategy.md`: which curl, 2xx challenge vs 4xx, then impersonate-build drift vs IP reputation). A 403 on the media URL with a good API response is Referer or an expired signed URL, and the fix is the header set passed to mpv.
2. **Separate empty from dead.** VidLink's `null` and Movy's per-lane 500 are empty titles or empty lanes. AllManga `unknown_build_id` is a dead contract. A Rivestream timeout on `scrapper.rivestream.app` is the shared front door, not one server name.
3. **Rotate the whole secret, not one field.** AllManga profile, VidRock key, Movy seed. Rivestream's scraper request has no salt.
4. **Requalify on the signoff titles** after the contract change. A green unit run can be a turbo cache hit. Live scripts are opt-in.
5. **Health can look healthy while the streak is down.** `/reset-provider-health` clears a poisoned score. It does not repair the provider.
6. **Do not promote a research module to hide a red signoff.** Cineby is research-only. AniDB was retired on 2026-10-24 (`anidb.app` 302). `rgshows` stopped resolving. The 2026-09-12 VidAPI note in `tmdb-embed-aggregator-research.md` is a dead rescue path (`streamdata.vaplayer.ru` 404).

## Starred on FMHY, and what Kunai should do

Stars below are the bold rows in the streaming, dedicated-server, multi-server, and anime sections. Indexes, lounges, IPTV, torrents, and download sites are out of scope: they are not direct-provider resolve targets.

### Already at parity (starred, and live)

| FMHY row                                                     | Kunai module | Remaining gap inside the module                                       |
| ------------------------------------------------------------ | ------------ | --------------------------------------------------------------------- |
| [Movy](https://www.movy.sx/)                                 | `movy`       | Anime lane unwired. Subtitle arrays often empty upstream.             |
| [Rive](https://www.rivestream.app/) and the CorsFlix mirrors | `rivestream` | Scraper host, not `secretKey`. Demoted backends trail the walk.       |
| [Miruro](https://miruro.cx/) / AniVault                      | `miruro`     | Key rotation looks like success. Thin fixtures per backend.           |
| [MKissa](https://mkissa.to/) / AllManga                      | `allmanga`   | Monthly whole-profile crypto rotation.                                |
| [YouTube](https://www.youtube.com/)                          | `youtube`    | yt-dlp extractor freshness. This is the video lane, not movie/series. |

Videasy, VidLink, and VidRock are not on this page. They are backends. Fixing them covers more frontends than adding any starred skin of them. Cineby is no longer a starred row (only an unstarred `CinebyTV` multi-server). HiAnime's FMHY row is the unstarred Aniwave / `hianimes.ru` line, plus KoToTV's `hianime.help` mirror. Kunai keeps HiAnime because ani-cli did, not because FMHY starred it.

### Starred movie and series frontends — one strategy, not forty modules

**Stream aggregators (starred):** Movy (have), Cinejoy, PopcornMovies, 7Movies, Atlantic, P-Stream forks, ShuttleTV, FlyStream, Vivarium, Rive (have), Flixer, MeowTV, SweetFox, CineLite, ArrowTV, Ghostflix, Spacedom, dulo, Chillflix, Way2Movies, Movie Night, Reelix, moanatv.

**P-Stream forks (starred):** Cinecat, Aether, Basement. They share the movie-web / p-stream source plugins. One source runner covers the section. Each plugin still has to return a URL that survives `verifyCandidateStream`. A plugin that only returns an iframe does not.

**Dedicated server (starred):** NEPU, Cno, PressPlay, arc018. These are the only movie rows worth a fresh dossier, because FMHY grades them as one player rather than a pile of embeds. Intake stops at "is there a JSON or media URL we can reproduce with headers?" If the player only boots inside their JS, they stay research, per the Playwright bar in `.docs/providers.md`.

**Multi-server (starred):** 1Shows, AniCine, ZetMoon, TonkaCine, Anixtv, Primeshows. These are embed pickers (about 8 to 38 third-party hosts). The headless playbook already says not to write a custom extractor for a host that only hands out `mp4upload` or `streamtape` iframes. Movy already cycles that class of upstream and records the miss per lane. A new module here does not add a stream Kunai can probe.

### Starred anime — only the ones that are not a skin of a live module

| Star                                                                  | Verdict                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Miruro, MKissa / AllManga                                             | Live. Repair in place.                                                                                                                                                                                                                  |
| Anikoto / Anisuge                                                     | 2026-11-12 capture in `fmhy-rea-anime.md`. `anikototv.to` does not resolve. `anikoto.cz` is not the September Kiranime / `apnshare` stack. Still not a module. The old apnshare verdict does not transfer.                              |
| animepahe                                                             | Homepage was a Cloudflare 403 on 2026-11-12. That body has no search, episode, or kwik evidence. Still the priority unread site. Do not bypass the challenge, and do not add a module from the challenge page. See `fmhy-rea-anime.md`. |
| Re:ANIME                                                              | `GET /api/flix/20/1` returns five `flixcloud.cc/e/<id>` embeds, including one `H-SUB` row with `hardsub: true`. Not AllManga, HiAnime, or Miruro. The embeds were not opened. Not a provider until a probed media URL exists.           |
| Gotaku, Ani.pm, AnimeX, NekoWatch, AniLight, Anidap, AniXo, Anistream | Holds and unknowns in `fmhy-rea-anime.md`. Anistream has one HiAnime-family lane (`zokoanime.video`) plus other embeds. NekoWatch names `miruro` and `mkissa` as registry keys and its captured player points at ani.pm.                |
| EverythingMoe, Wotaku, The Index, JustIndex                           | Directories. Not providers.                                                                                                                                                                                                             |

KickAssAnime and AnimeGG are live and unstarred. They stay. A star is not the quality gate.

## Order of work

1. Repair the contracts that rot on a timer: AllManga profile (build 189 was current on 2026-11-12), VidRock key, Videasy seed host, HiAnime host triple. Rivestream's live request is the scraper API in `rivestream.md`, not the `secretKey` canary. Live-qualify the signoff titles after each one.
2. Finish gaps inside live modules before new sites: VidRock `sub.vdrk.site`, VidLink empty-vs-dead, Movy lane misses left as misses.
3. A new anime module still needs a probed media URL. animepahe is unread behind a Cloudflare 403 (`fmhy-rea-anime.md`). Re:ANIME's server list is `flixcloud.cc` embeds and was not probed. Hold both. The September Anikoto / `apnshare` note does not describe `anikototv.to`.
4. If a new movie source is still needed, dossier one dedicated-server star (NEPU or Cno) or one p-stream source list — whichever shows a probed media URL in the first capture. Do not dossier the aggregator list one site at a time.

## Sources

- Page: `https://fmhy.net/video` fetched 2026-11-12.
- Grading: `https://github.com/fmhy/FMHY/wiki/Stream-Site-Grading`.
- Roster and crypto policy: `.docs/providers.md`, `apps/cli/src/container/bootstrap-providers.ts`.
- Per-provider evidence: the dossiers named in the tables, plus `packages/providers/src/research.ts` and `tmdb-embed-aggregator-research.md`.
- Anime star capture: `fmhy-rea-anime.md` (2026-11-12). No playlist, segment, or Cloudflare bypass.
