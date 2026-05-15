Output test/vhs/golden/onboarding.gif

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
Type "bun run dev -- --setup"
Enter
Wait+Screen /Setup Wizard/
Sleep 900ms
Enter
Wait+Screen /Dependency Guide/
Sleep 900ms
Enter
Wait+Screen /Poster Preview/
Sleep 900ms
Enter
Wait+Screen /Offline Downloads/
Sleep 900ms
Down
Enter
Wait+Screen /Download Location/
Sleep 900ms
Enter
Wait+Screen /Setup Complete/
Sleep 1600ms
Ctrl+C
Wait
