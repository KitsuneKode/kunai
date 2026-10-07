---
"@kitsunekode/kunai": patch
---

Strip terminal OSC sequences that end with the string terminator (`ESC \`), not
only BEL, so a provider title can no longer smuggle a hyperlink payload into the
screen. The sanitizer also stays linear on text packed with unterminated escape
introducers, which previously made it rescan the whole string per escape.
