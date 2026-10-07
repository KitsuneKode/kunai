---
"@kitsunekode/kunai": patch
---

yt-dlp metadata calls pass a single `--` before the watch URL. The argument list had a second terminator, which yt-dlp reads as a positional operand, and YouTube search now puts `--` before its search target, matching every other yt-dlp invocation.
