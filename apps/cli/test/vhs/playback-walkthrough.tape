# Series + anime playback walkthrough — network-free fixture harness.
# Typed session: search → arrow results → episode list → resolve → play →
# post-play → /anime → repeat. Playback in the app is 1×; PlaybackSpeed below
# only speeds up the gif/mp4 because a two-lane typed tape is long.
# Run via: bun run --cwd apps/cli test:vhs:playback
Output test/vhs/golden/playback-walkthrough.gif
Output test/vhs/golden/playback-walkthrough.mp4

Set Width 1600
Set Height 900
Set FontSize 18
Set Theme "Catppuccin Macchiato"
Set Padding 24
Set Margin 24
Set MarginFill "#12121a"
Set BorderRadius 10
Set Framerate 30
Set PlaybackSpeed 1.5

Hide
Type "clear"
Enter
Show

Sleep 600ms
Type "bun test/harness/playback-walkthrough.ts"
Enter
Wait+Screen /Search for a title/
Sleep 900ms

# Series: type a query, then walk the result list before confirming
Type "Andor"
Sleep 250ms
Enter
Wait+Screen /3 titles/
Sleep 1400ms
Down
Sleep 450ms
Down
Sleep 450ms
Up
Sleep 350ms
Up
Sleep 700ms
Enter
Wait+Screen /Pick episode/
Sleep 900ms
Down
Sleep 400ms
Down
Sleep 800ms
Enter
Sleep 3500ms
Wait+Screen /direct · videasy/
Sleep 4200ms
Type "q"
Wait+Screen /episode complete/
Sleep 900ms
Down
Sleep 800ms

# Palette: switch catalog lane the same way a session does
Type "/"
Sleep 1100ms
Type "anime"
Sleep 400ms
Wait+Screen /Anime Mode/
Enter
Wait+Screen /Search for an anime/
Sleep 900ms

Type "Frieren"
Sleep 250ms
Enter
Wait+Screen /Frieren: Beyond/
Sleep 1400ms
Down
Sleep 450ms
Up
Sleep 700ms
Enter
Wait+Screen /The Journey's End/
Sleep 900ms
Down
Sleep 350ms
Down
Sleep 350ms
Down
Sleep 800ms
Enter
Sleep 3500ms
Wait+Screen /direct · allmanga/
Sleep 4200ms
Type "q"
Wait+Screen /Phantoms of the Dead/
Sleep 1600ms

Ctrl+C
Sleep 500ms
