# Plan 046: Route provider episodes from proven season identity

> **For executors:** use test-driven development and verification before
> completion. Do not change AllManga crypto or decoder constants in this plan.

## Goal

AllManga and Miruro must not silently replace a proven season-relative episode
with `absoluteEpisode`. When `{ season, episode, absoluteEpisode }` is present,
the provider receives `episode`; absolute numbering is a fallback only for an
absolute-only input.

## Verified current state

- `packages/providers/src/allmanga/direct.ts` selects
  `absoluteEpisode ?? episode ?? 1`.
- `packages/providers/src/miruro/direct.ts` makes the same choice.
- The CLI deliberately preserves both identities across resolve, queue, share,
  and history handoffs. That does not prove a provider wants the absolute value.
- AniDB has its own explicit season-routing contract and is out of scope.

This is audit finding **K-17**.

## Implementation

1. Add failing provider-package characterization tests for both modules:
   - S2E1 with absolute 13 routes episode `1`.
   - An absolute-only input routes the absolute value.
   - Missing episode identity retains the provider's existing safe default.
2. Extract one small shared provider-side episode-number helper if both modules
   need identical policy. Keep it inside `packages/providers`; do not make the
   CLI adapter provider-aware.
3. Replace both absolute-first expressions with the tested policy.
4. Preserve trace evidence so diagnostics still show the original season,
   episode, and absolute identities.
5. Update `.docs/providers.md` only if its routing description changes.

## Verification

```sh
bun run --cwd packages/providers test
bun run typecheck
bun run lint
bun run fmt
bun run test
```

Run the AllManga and Miruro live smokes once after deterministic tests if the
network permits. Classify a challenge/geo block as provider drift; do not weaken
the routing rule to make a live smoke green.

## Stop conditions

- A provider's documented API proves it requires absolute numbering even when
  a season-relative identity is known. Record that evidence and split the two
  providers instead of forcing one helper.
- A proposed fix touches `packages/providers/src/allmanga/api-client.ts` crypto,
  attestation, or decoder constants.

## Result

- `selectProviderEpisodeNumber()` now owns the shared season-relative-first
  policy used by both AllAnime and Miruro.
- Provider-package regression tests cover S2E1 with absolute 13, absolute-only
  requests, and the missing-identity default.
- The AllAnime live smoke reached its current episode catalog but stream
  resolution was captcha-gated from the test network. The Miruro live smoke was
  blocked by Cloudflare WAF on both mirrors. These are classified provider
  availability failures, not reasons to restore unsafe episode routing.

Status: COMPLETE
