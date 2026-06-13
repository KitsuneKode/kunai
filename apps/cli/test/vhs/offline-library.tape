# Offline library + download queue — network-free (`--offline` makes no provider
# calls). Run via: bun run --cwd apps/cli test:vhs:offline
Output test/vhs/golden/offline-library.gif

Set Width 1600
Set Height 900
Set FontSize 18
Set Theme "Catppuccin Macchiato"
Set Padding 24
Set Margin 24
Set MarginFill "#12121a"
Set BorderRadius 10
Set Framerate 30
Set PlaybackSpeed 0.8

Hide
Type "clear"
Enter
Show

Sleep 600ms
Type "bun run dev -- --zen --offline"
Enter
Wait+Screen /Offline library/
Sleep 1600ms
Type "/"
Sleep 250ms
Type "downloads"
Sleep 250ms
Enter
Sleep 1600ms
Ctrl+C
Wait
