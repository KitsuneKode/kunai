---
"@kitsunekode/kunai": minor
---

### Features

- Added Homebrew (`brew install kitsunekode/tap/kunai`), Scoop
  (`scoop bucket add kitsunekode` + `scoop install kunai`), and AUR
  (`yay -S kunai-bin`) install channels: a `package-channels` workflow renders
  each package deterministically from the release's `SHA256SUMS.archives` and
  publishes it when the channel secrets exist. `kunai upgrade`, `kunai
  uninstall`, and doctor now recognise Homebrew/Scoop/system-package ownership
  and defer to the owning package manager instead of self-replacing its file.
