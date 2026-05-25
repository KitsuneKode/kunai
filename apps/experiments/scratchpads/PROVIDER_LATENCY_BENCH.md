# Provider latency bench

Research-only harness for measuring the path Kunai actually cares about:

```text
selected episode -> provider resolve -> first media/manifest evidence -> optional mpv playback
```

Script:

```sh
cd apps/experiments
bun scratchpads/provider-latency-bench.ts
```

## Useful commands

Series providers, no browser:

```sh
bun scratchpads/provider-latency-bench.ts --series --episodes=1,2 --providers=vidking,cineby,rivestream
```

Series with mpv verification that actually plays for 5 seconds:

```sh
bun scratchpads/provider-latency-bench.ts --series --episodes=1 --providers=vidking --mpv --mpv-play-seconds=5
```

Compare subtitle startup cost:

```sh
bun scratchpads/provider-latency-bench.ts --series --episodes=8 --providers=vidking --mpv --mpv-play-seconds=5 --mpv-sub-mode=none
bun scratchpads/provider-latency-bench.ts --series --episodes=8 --providers=vidking --mpv --mpv-play-seconds=5 --mpv-sub-mode=primary
bun scratchpads/provider-latency-bench.ts --series --episodes=8 --providers=vidking --mpv --mpv-play-seconds=5 --mpv-sub-mode=all
```

Compare minimal mpv args with Kunai-like cache/reconnect args:

```sh
bun scratchpads/provider-latency-bench.ts --series --episodes=8 --providers=vidking --mpv --mpv-play-seconds=5 --mpv-sub-mode=none --mpv-profile=clean
bun scratchpads/provider-latency-bench.ts --series --episodes=8 --providers=vidking --mpv --mpv-play-seconds=5 --mpv-sub-mode=none --mpv-profile=kunai
```

Try a lower selected quality:

```sh
bun scratchpads/provider-latency-bench.ts --series --episodes=1 --providers=vidking --quality=720 --mpv --mpv-play-seconds=5
```

Browser comparison, when needed:

```sh
bun scratchpads/provider-latency-bench.ts --series --episodes=1 --providers=vidking,cineby,rivestream --web --web-ms=6000
```

Stealth browser comparison, only when you specifically want web-player evidence:

```sh
bun scratchpads/provider-latency-bench.ts --series --episodes=1 --providers=vidking,cineby,rivestream --web --stealth --web-ms=6000
```

Anime smoke:

```sh
bun scratchpads/provider-latency-bench.ts --anime --query='solo leveling' --episodes=1 --providers=allanime,miruro
```

Pin anime identity when comparing providers:

```sh
bun scratchpads/provider-latency-bench.ts --anime --query='solo leveling' --episodes=1 --providers=allanime --search-index=1
bun scratchpads/provider-latency-bench.ts --anime --query='solo leveling' --episodes=1 --providers=miruro --anilist=151807 --mpv --mpv-play-seconds=5
```

## What it records

- `providerOk`: provider module returned a resolved stream inventory.
- `mediaOk`: selected media probe was playable by direct manifest fetch, or by mpv when `--mpv` is enabled.
- `search`: provider search/mapping time, currently used for AllManga anime.
- `list`: provider `listEpisodes` time when the provider exposes it.
- `resolve`: provider module `resolve()` time.
- `manifest`: direct fetch of the selected stream URL.
- `mpv`: time until mpv prints `KUNAI_MPV_PLAYING`.
- `http`: count of fetches routed through the injected provider fetch port.
- `streams`, `subs`, `host`: normalized provider result facts.

Reports are written under:

```text
apps/experiments/scratchpads/latency-reports/
```

Those JSON reports are raw lab output and are intentionally ignored by Git.

## Findings from 2026-05-25

The Boys (`tmdb:76479`) direct provider path:

| Provider | Resolve | First media/manifest | mpv playing marker |
| -------- | ------- | -------------------- | ------------------ |
| VidKing | 600-1200 ms | 30-80 ms | ~8.5-8.9 s |
| Cineby wrapper | 300-900 ms | 20-60 ms | ~8.9 s |
| Rivestream | 250-800 ms | sometimes 10-20 s via direct fetch | ~3.9 s in mpv |

Important interpretation:

- VidKing/Cineby provider resolution is not the main good-path delay.
- mpv startup on the selected Videasy HLS host is currently the larger good-path delay.
- In the main app, the 30s "elapsed" screenshot was on the subtitle phase, not provider resolve. VidKing returned 3 streams and 26 subtitles, then mpv startup had been asked to attach every remote subtitle file. The fix is to put only the selected subtitle in initial mpv args and attach extra inventory after the player is alive.
- Rivestream can start mpv faster even when a separate direct media fetch looks slow.
- Bad VidKing paths are still a major problem: one missing fixture produced 48 Videasy calls and 37.7 s before exhaustion.

Focused S01E08 A/B:

| Provider | Subtitle mode | mpv startup |
| -------- | ------------- | ----------- |
| VidKing | none | ~7.5 s |
| VidKing | primary | ~9.7 s |
| VidKing | all 26 tracks | ~30.0 s watchdog |
| VidKing | none, Kunai-like mpv args | ~7.6 s |
| VidKing | 720p/360p, no subtitles | ~9 s |
| Cineby | none | ~21.4 s in one live sample |
| Cineby | all 26 tracks | ~29.5 s |
| Rivestream | none | ~2.1 s |
| Rivestream | all 12 tracks | ~3.8 s |

Interpretation:

- The app's visible 30s delay is reproducible by adding every remote subtitle at mpv launch.
- Removing extra launch-time subtitles should eliminate the catastrophic 26-track startup tax.
- VidKing still misses the target even with no subtitles, so the selected Videasy HLS host remains a startup-latency issue.
- Kunai's cache/reconnect mpv arguments did not materially worsen VidKing startup in this sample.
- Lowering selected quality did not improve VidKing startup in this sample.
- Rivestream is currently the best startup-latency source for this title/episode, despite slow direct manifest probes.

## Caveats

- Browser runs are diagnostic only. Cineby and VidKing can redirect or open anti-debug/player paths, so plain browser timing may miss the activated player. Use `--stealth` only when comparing web behavior.
- Anime comparison needs pinned IDs. A broad query like `solo leveling` currently picks Season 2 in AllManga search at index `0`; Season 1 is index `1` in the 2026-05-25 live result. Use `--search-index=N`, `--allmanga=<id>`, or `--anilist=<id>` before judging speed.
- Some provider modules still use direct global fetch internally, so `http` count is exact for VidKing/Cineby/Rivestream fetch-port paths but incomplete for AllManga/Miruro until their fetch usage is routed through the runtime port.
- mpv timing is measured by `--term-playing-msg=KUNAI_MPV_PLAYING`. With `--mpv-play-seconds=5`, the script lets playback continue for 5 seconds after start to prove it is not a ghost launch.
- A direct manifest fetch can disagree with mpv. Miruro CDN URLs may return HTTP 403 to Bun fetch while mpv may still be the real trust check depending on headers, DNS, and player config. Read `providerOk`, `mediaOk`, `manifestFetch`, and `mpv` together.

mpv reference: the official manual documents `--sub-file` / `--sub-files` for launch-time external subtitles and runtime subtitle addition through `sub-add`. That supports the intended split: selected subtitle at launch, optional extra tracks after playback is alive. See `https://mpv.io/manual/stable/`.

## Anime findings from 2026-05-25

Solo Leveling broad search:

| Provider | Evidence | Interpretation |
| -------- | -------- | -------------- |
| AllManga index 0 | `Ore dake Level Up na Ken Season 2`, AniList `176496` | Broad query selected Season 2, so the first run was not a fair Season 1 benchmark. |
| AllManga index 1 | `Ore dake Level Up na Ken`, AniList `151807`, AllManga id `B6AMhLy6EQHDgYgBF` | Correct Season 1 identity, but current source extraction returned no playable streams. |
| Miruro pinned AniList `151807` | provider resolved in ~300-830 ms after official-domain fallback, 6 streams, selected `vault-06.uwucdn.top` | Provider inventory is fast again. The remaining failure is selected CDN playback: Bun fetch and mpv both hit Cloudflare HTTP 403 from `uwucdn`/`owocdn`. |

AllManga drift detail:

- The live source payload for Solo Leveling S01E01 exposed source names `Ak` and `S-mp4`.
- `S-mp4` returned a cached JSON response with `mp4: true` but no actual `link`.
- `Ak` returned DASH-style `rawUrls` with separate `video/mp4` and `audio/mp4` tracks plus subtitle metadata.
- The production provider currently recognizes `Default`, `Yt-mp4`, `S-mp4`, `Luf-Mp4`, and `Fm-mp4`; it skips `Ak`, so this title exhausts with "No streams extracted".
- Do not patch this by handing mpv a video-only URL. A correct fix needs either a DASH/MPD/EDL handoff that includes audio, or a provider result extension for sidecar audio tracks.

Miruro drift detail:

- `https://www.miruro.tv`, `https://miruro.tv`, and `https://miruro.to` closed Bun fetch sockets in the lab environment.
- Official mirrors `https://miruro.bz` and `https://miruro.ru` responded, and `/api/secure/pipe` remained present.
- Provider resolution should therefore try official mirrors before the legacy TV host.
- The site working in a browser does not prove direct mpv playback is available: the current HLS hosts return Cloudflare 403 outside the browser player path.

## Product implications

1. Keep the hot provider path to one selected source API call where possible.
2. Fix VidKing bad-path retry explosion before adding more sources.
3. Measure mpv startup separately from provider resolve; they are different bottlenecks.
4. Do not attach full remote subtitle inventory before playback starts. Launch selected subtitle only, then attach extra choices after `player-ready` / `playback-started`.
5. Use near-EOF prefetch so next episode resolves before the user reaches handoff.
6. Add startup-health scoring per provider/source/host. Provider resolve speed alone is not enough; `mpv playing` time should influence fallback and source preference.
7. Treat browser/stealth harvest as provider-research tooling, not the runtime playback path.

## Root-cause ledger

### Confirmed: app-visible 30s wait is reproducible without slow provider resolve

Evidence:

- VidKing S01E08 resolves in under 1 second and returns 3 streams plus 26 subtitle tracks.
- The same selected stream reaches mpv playback in ~7.5 seconds with no launch subtitles.
- The same selected stream reaches mpv playback in ~9.7 seconds with one selected subtitle.
- The same selected stream hits the ~30 second watchdog path when all 26 remote subtitles are attached before playback.

Conclusion:

- The provider resolver is not the main bottleneck on the good VidKing/Cineby path.
- Full remote subtitle fanout at launch is a startup blocker and directly matches the user-visible "30s elapsed" report.
- The runtime should preserve the full subtitle inventory, but the fast path should only attach the selected/primary subtitle before playback. Extra subtitle choices should be attached after `player-ready` / `playback-started`, or only when the user opens/changes subtitles.

### Confirmed: VidKing/Videasy host startup is still above target

Evidence:

- With subtitles removed from launch, VidKing still takes ~7.5-9 seconds before mpv emits the playing marker.
- Lower selected quality did not materially improve this in the S01E08 sample.
- Kunai-like mpv cache/reconnect args did not materially worsen the sample compared with clean/minimal args.

Conclusion:

- Removing subtitle fanout should eliminate the catastrophic 30s case, but VidKing still misses the desired 5-6 second target on this sample.
- The next ranking signal should be actual `mpv playing` time per provider/source/host, not only provider resolve time or direct manifest fetch time.

### Confirmed: Rivestream has a different latency shape

Evidence:

- Rivestream direct manifest fetch can take ~10-12 seconds in the bench.
- The same Rivestream candidate reaches mpv playback in ~2-4 seconds.

Conclusion:

- A plain `fetch()` manifest probe is not enough to rank startup health.
- mpv playback proof is the more product-relevant metric for startup scoring.

### Confirmed: Miruro inventory is fast, direct CDN playback is the blocker

Evidence:

- Official Miruro mirrors `miruro.bz` and `miruro.ru` respond for the pipe endpoint shape.
- Miruro can resolve Solo Leveling S01E01 inventory quickly when an official pipe mirror is available.
- The selected `uwucdn` / `owocdn` streams return HTTP 403 in direct media probes and mpv playback in the lab environment.

Conclusion:

- Miruro is not primarily a resolver-speed problem after mirror fallback.
- The unresolved question is whether a direct mpv-compatible media handoff is available without browser-only state. If the public browser player needs browser-held state for the CDN, mark Miruro as browser-only/fallback instead of pretending it is a reliable direct provider.

### Confirmed: AllManga failure is source-shape drift, not simple slowness

Evidence:

- Correct Solo Leveling Season 1 identity is AllManga search index 1 / AniList `151807`.
- Live AllManga sources for S01E01 include `Ak` and `S-mp4`.
- `S-mp4` reports an mp4-shaped response with no usable link.
- `Ak` returns DASH-style separate video/audio tracks plus subtitles.
- Current extraction recognizes the ani-cli-era source families but does not hand off separate audio/video DASH candidates.

Conclusion:

- Do not "fix" this by returning a video-only URL.
- The proper path is either DASH/MPD/EDL handoff support or a provider result extension that can represent sidecar audio tracks.

### Confirmed: diagnostics currently hide the true phase

Evidence:

- Loading copy classifies any wait at or beyond 20 seconds as "Slow source".
- Playback internals emit more precise events (`mpv-process-started`, `player-ready`, `playback-started`, subtitle events, buffering/stall events), but the visible state does not expose the phase ladder clearly enough.

Conclusion:

- The diagnostics panel should eventually show a timing ladder:
  `search -> provider resolve -> stream selected -> subtitle primary attached -> mpv spawned -> IPC ready -> playback-started -> late subtitles`.
- Until that exists, "Slow source" can be a misleading label for subtitle fanout, CDN startup, or buffering.

## Next no-production experiments

1. Run the subtitle A/B across 3-5 episodes and both VidKing/Cineby to verify the 26-track fanout pattern is not episode-specific.
2. Add a bench score column for `startupHealth = mpvPlayingMs + failurePenalty`, grouped by provider/source/host.
3. Add a Miruro browser-visible capture that records only public player requests and compares selected server/host/referer with the pipe API output. Do not use this as a Cloudflare bypass path.
4. Add an AllManga source-shape fixture for the `Ak` response and prototype an experiment-only MPD/EDL handoff before touching provider contracts.
5. Add a small app-side tracing scratchpad that replays one `StreamInfo` through mpv with modes `none`, `primary`, and `all` subtitles so app behavior and bench behavior stay comparable.
