Output test/vhs/golden/help-overlay.ascii

Set Width 150
Set Height 42
Set FontSize 18
Set Theme "BlexMono Nerd Font Mono"

Hide
Type "cd /home/kitsunekode/Projects/hacking/kitsunesnipe"
Enter
Show

Type "bun run dev -- -a"
Enter
Wait+Screen /Browse your favorite anime/
Type "/"
Type "help"
Enter
Wait+Screen /Global commands, editing, filtering, and playback navigation/
Sleep 500 ms
Screenshot test/vhs/screenshots/help-overlay.png
Ctrl+C
Wait
