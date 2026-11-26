# Setup wizard walkthrough — network-free, renders from local capability state.
# Run via: bun run --cwd apps/cli test:vhs:setup
Output test/vhs/captures/setup.gif

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
Type "./test/vhs/isolated-kunai.sh --setup"
Enter
Wait+Screen /get you watching/
Sleep 1400ms

# welcome -> system -> prefs-audio -> prefs-subtitle -> downloads -> tips
Enter
Sleep 1300ms
Enter
Sleep 1100ms
Enter
Sleep 1100ms
Enter
Sleep 1100ms
Enter
Sleep 2200ms

Ctrl+C
Wait
