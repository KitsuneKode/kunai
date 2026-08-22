---
"@kitsunekode/kunai": patch
"@kunai/providers": patch
"@kunai/relay": patch
---

Privacy hardening, and a consent bug in the installer.

- **Diagnostics no longer leak signed-CDN tokens or your IP address.**
  Redaction judged only the parameter _name_, so anything the CDN keyed
  differently — `?q=<token>`, `?md5=<hash>`, `?ip=`, `?client_ip=` — passed
  through intact into the debug log, the diagnostics store, and the support
  bundle people paste into GitHub issues. Values are now judged too: an
  unbroken high-entropy blob is redacted, while readable values like
  `?q=Dune` survive so traces stay useful.
- **Analytics sends a hash, never your install id.** The ping now carries
  `sha256(installId)`; the id itself never leaves your machine. The payload is
  still exactly five keys. Because the hash input changed, installs from
  before this release are counted once more.
- **You can rotate your install id** from Settings while staying opted in.
  The new id is freshly random, so earlier pings cannot be linked to it.
  Disabling analytics still clears the id entirely.
- **The installer no longer treats "no terminal" as a yes.** `curl … | bash`
  in CI, a container, or a sandbox would auto-answer the optional-dependency
  prompts and run `sudo apt-get/pacman/dnf install` unattended, because
  `-r /dev/tty` tests permission bits rather than a controlling terminal and a
  failed read fell through to the default. `--yes` is now the only thing that
  accepts on your behalf; a skipped step says so.
- **The public usage page works.** `/analytics` on the docs site showed
  "not published yet" permanently while the ingest was serving real data,
  because the metrics URL had no default and the page is prerendered.
- **The relay's private-host guard covers IPv4-mapped IPv6.**
  `::ffff:169.254.169.254` — the cloud metadata endpoint — normalizes to a hex
  form that matched none of the literal checks. The host allowlist already
  blocked it in practice; the backstop now holds on its own.
- **AllAnime survives a bad response instead of failing the provider.** A
  GraphQL error body or `{"data":null}` threw past the retry loop on the one
  lane with no fallback, turning a recoverable response into a dead provider.
