# Series + anime playback walkthrough — network-free fixture harness.
# Plays both lanes (search → episode → resolve → 1.5× play → post-play).
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
Wait+Screen /Series playback/
Sleep 12s
Wait+Screen /Anime playback/
Sleep 14s
Wait+Screen /Walkthrough complete/
Sleep 1600ms
Ctrl+C
Sleep 500ms
