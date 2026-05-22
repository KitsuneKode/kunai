# Active Playback

Approved direction:

```text
Active playback = episode control surface
```

Kunai should not pretend to be the video player. mpv owns video. Kunai owns session state, progress, recovery, and next actions.

## Layout

Show:

- current episode identity
- short current-watch summary
- playback health
- provider/source facts only if useful
- active tracks/subtitle state
- autoplay/autoskip state
- compact startup trail after play starts
- episode thumbnail or season poster fallback
- up next
- progress

Do not leave a blank void. Do not show a noisy bootstrap dashboard after playback has started.

## Footer

```text
[space] pause   [q] stop   [☰ e] episodes   [≋ t] tracks   [/] commands
```

Recovery/fallback stay in command palette unless playback is in trouble. When trouble happens, promote recover/fallback into body and footer temporarily.

## Trouble States

If stream stalls:

- show `Stream stalled`
- show subtitle state if relevant
- promote fallback/recover

If mpv exits before playback starts:

- route to Playback Issue state
- do not mark watched
- do not offer next as primary

If near end:

- apply configured quit-near-end behavior
- explain only if user needs to act

## Loading And Startup

Startup can show a subtle step trail:

- search
- scrape
- resolve
- play

Once playing, compress it into health context or hide it.
