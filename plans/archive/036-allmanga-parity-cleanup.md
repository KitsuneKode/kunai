# Plan 036: Reconcile AllManga source parity

> **Drift check:** `git diff --stat 36da54c4..HEAD -- packages/providers/src/allmanga packages/providers/test/allmanga.test.ts .docs/providers.md .docs/architecture.md`

**Goal:** Remove a dead source label and preserve the referer required by active
wixmp streams without changing Kunai's maintained mkissa crypto divergence.

## Status

- **Priority:** P2
- **Effort:** S
- **Risk:** LOW
- **Reference:** local ani-cli tag `v4.15` (`72d7f72`) is the final AllAnime-based
  reference. v5 no longer contains AllAnime code.

## Tasks

- [ ] Add a fixture proving `Luf-Mp4` rows are ignored and no dead candidate reaches
      playback; then remove it from `KNOWN_SOURCES` and the manifest/docs inventory.
- [ ] Add a wixmp URL fixture asserting the mkissa site referer is attached. Extend
      `resolveDirectStreamReferer` for `repackager.wixmp.com` (and only proven aliases).
- [ ] Keep mp4upload's dedicated referer and scoped `--tls-verify=no`; do not broaden
      TLS disabling to every stream.
- [ ] Keep buildId/bootstrap/HMAC crypto. Do not revert to ani-cli's abandoned epoch
      scheme, query constants, or v5 AniDB transport.
- [ ] Update `.docs/providers.md`, `.docs/architecture.md`, and the manifest note in
      the same change so provider truth does not drift.

## Verification

```sh
bun run --cwd packages/providers test test/allmanga.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run test:live:allanime
```

This is parity cleanup, not a default-route blocker. A live AllAnime failure caused
by current regional WAF/network behavior must be reported as such, not hidden by a
unit fixture.
