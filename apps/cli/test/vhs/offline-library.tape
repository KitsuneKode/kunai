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
Type "cd /home/kitsunekode/Projects/hacking/kitsunesnipe"
Enter
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
Sleep 1400ms
Ctrl+C
Wait
