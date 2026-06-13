# Command-palette tour — network-free. Launches the offline shell (no provider
# calls) and walks the palette through help, diagnostics, and history overlays.
# Run via: bun run --cwd apps/cli test:vhs:palette
Output test/vhs/golden/command-palette.gif

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
Type "bun run dev -- --offline"
Enter
Wait+Screen /Offline library/
Sleep 1200ms

# Open the palette and let the command list breathe
Type "/"
Sleep 1400ms

# Help overlay
Type "help"
Sleep 300ms
Enter
Wait+Screen /Global commands/
Sleep 1600ms
Escape
Sleep 500ms

# Diagnostics overlay
Type "/"
Sleep 400ms
Type "diagnostics"
Sleep 300ms
Enter
Wait+Screen /Diagnostics/
Sleep 1800ms
Escape
Sleep 500ms

# Watch history
Type "/"
Sleep 400ms
Type "history"
Sleep 300ms
Enter
Sleep 1800ms

Ctrl+C
Wait
