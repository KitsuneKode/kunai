---
"@kitsunekode/kunai": minor
---

Add KickAssAnime as the anime backup, second after Miruro, and fix dub audio
selection for files that carry several audio tracks.

KickAssAnime has its own catalogue, site and video servers, so a Miruro outage
does not reach it. It picks up a show Kunai found somewhere else by matching the
title's name and year against its own catalogue, and steps aside rather than
guessing when more than one show could be meant.

It is the only anime source with real subtitle tracks instead of subtitles
burned into the picture, so `/tracks` can switch subtitle language during
playback.

Its dubs usually live inside the same video file as extra audio tracks, which
surfaced a bug affecting any such file: switching to Dub wrote the mode itself
into the audio setting, mpv received `--alang=dub`, matched no track, and played
the Japanese audio with nothing said. Dub now resolves to English and Sub to the
file's original audio, and the setting is applied per file so a switch mid-episode
takes effect instead of keeping the value the player started with.
