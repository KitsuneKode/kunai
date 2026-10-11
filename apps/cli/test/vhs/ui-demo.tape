# README UI walkthrough: search → pick → resolve → play → stalled stream → post-play.
# Network-free: the real shells over open-movie fixtures (test/harness/ui-demo-*).
# Run from apps/cli:  vhs test/vhs/ui-demo.tape
# The README assets are this recording cropped to the UI area, e.g.
#   ffmpeg -ss 0.3 -t 19.7 -i test/vhs/golden/ui-demo.mp4 -vf "crop=1080:1020:0:0" \
#     -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart demo-ui-walkthrough.mp4
# (the GIF is the same crop at 12 fps, scaled to 880 px wide, with a generated palette).
# 1080 px wide at 26 px type is a 66-column terminal, which the UI supports.
Output test/vhs/golden/ui-demo.mp4

Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font Mono"
Set FontSize 26
Set Width 1080
Set Height 1100
Set Padding 24
Set Margin 0
Set Framerate 30
Set TypingSpeed 110ms
Set Theme { "name": "Kunai Sakura", "black": "#100b0f", "red": "#ff5d5d", "green": "#54d6a0", "yellow": "#f4c45c", "blue": "#5fb6ff", "magenta": "#c98bff", "cyan": "#4fd1c5", "white": "#f6eff4", "brightBlack": "#473b51", "brightRed": "#ff8a8a", "brightGreen": "#7ee8bc", "brightYellow": "#f8d98a", "brightBlue": "#8fcfff", "brightMagenta": "#dcb4ff", "brightCyan": "#82e3da", "brightWhite": "#ffffff", "background": "#100b0f", "foreground": "#f6eff4", "selection": "#3a2b40", "cursor": "#ff8fb0" }

# The launch command stays out of the recording so it opens on the app itself.
Hide
Type "bun test/harness/ui-demo.ts"
Enter
Wait+Screen@20s /Search/
Sleep 600ms
Show

Sleep 1500ms
Type "Sin"
Sleep 600ms
Enter
Wait+Screen@10s /3 titles/
Sleep 1600ms
Down
Sleep 800ms
Up
Sleep 900ms
Enter

# Resolve (3.2 s), then playing.
Sleep 6700ms

# `x` is the harness-only toggle that shows the real stalled-stream prompt.
Type "x"
Sleep 2500ms
Type "x"
Sleep 1800ms
Type "q"
Sleep 3000ms
