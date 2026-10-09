---
"@kitsunekode/kunai": patch
---

Stop the installer from saying it will run `apt-get`/`pacman`/winget when it will not.

`curl | bash` and `--yes` print `Run this to install them:` with the exact
command, once. `This will run` is reserved for a real TTY that then asks
`Run it now? [y/N]`.
