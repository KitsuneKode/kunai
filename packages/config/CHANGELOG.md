# @kunai/config

## 0.1.1

### Patch Changes

- [#591](https://github.com/KitsuneKode/kunai/pull/591) [`f17f55a`](https://github.com/KitsuneKode/kunai/commit/f17f55a9b1103736cd03572e27073007e29b28d3) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - fix: subagent-driven hardening across providers, shell, config merge, and the update lock

  Providers: HiAnime embed URLs scraped from upstream markup now pass the same
  literal-target gate AniDB uses, so a hostile embed payload cannot steer fetch
  or curl at LAN/loopback/file: targets. HiAnime and Miruro curl children killed
  by Ctrl-C (exit 130/143) or a caller abort now surface as AbortError-class
  cancellations instead of retryable network faults, every curl argv terminates
  options with `--` before the upstream URL, Miruro's pipe decode failures map to
  non-retryable `candidate-parse`, and its curl spawn takes the abort signal
  directly so a mid-spawn abort cannot strand the child. AniDB's HLS master
  expansion no longer follows redirects inside curl (`-sL`): it walks each hop
  itself so the per-hop blocklist applies. `curl_` wrapper discovery is
  case-insensitive so `Curl_chrome150.bat` resolves on Windows.

  Shell: the settings draft now flushes on unmount instead of losing a change
  made inside the 300 ms debounce, provider-supplied track labels are sanitized
  in the two-pane layout, the provider memory panel stops duplicating the
  "skipped in auto-fallback" note, the image-capability memo key covers every
  environment input it reads, and keyed inflight tasks clean up without spawning
  an unhandled rejection on failure.

  Config and updater: `mergeKitsuneConfig` overlays object-valued keys instead of
  replacing them, so a hand-edited `{"sync": {"anilist": null}}` or a partial
  language profile can no longer crash `x.y.z` readers or silently drop sibling
  keys. Version-lock stale reclaim is serialized through a claim file and rewrites
  the lock in place after re-verifying file identity — a live lock can no longer
  be deleted out from under a racing winner, and abandoned claims are swept.
  `curl --version` feature probes are time-bounded, and the HLS relay rejects any
  non-zero curl exit instead of relaying a truncated body that still carried a
  parseable status trailer.

- Updated dependencies [[`8174aae`](https://github.com/KitsuneKode/kunai/commit/8174aae3c5e2effcdfcfa52e420393fc103debc9)]:
  - @kunai/types@0.1.1
  - @kunai/schemas@0.1.1
