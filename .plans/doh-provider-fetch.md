---
lastReviewed: 2026-11-25
---

# DoH for the provider fetch port

## Evidence (2026-11-25, this worktree)

- `scrapper.rivestream.app` answers **200** through `curl-impersonate --doh-url
  https://1.1.1.1/dns-query` while the system resolver sinkholes it
  (`49.44.79.236`). Same class: miruro `.to/.tv`, gogoanime, smashystream,
  cinemaos.
- `test:live:rivestream` still fails _after_ the curl-layer DoH commit
  (`cfd97b614`) because rivestream resolves through `context.fetch`, not the
  curl-impersonate path. Curl-layer DoH covers only miruro/hianime/anidb today.
- The single funnel for all provider metadata fetches is `createRelayFetchPort`
  in `packages/relay/src/create-relay-fetch-port.ts` (`fetchImpl = options.fetch
  ?? fetch`). Fixing DNS there covers the whole roster at once.

## Design constraints discovered

- **Fallback-on-throw does not work.** Poisoned sinkholes _hang_; the failure
  surfaces as the provider's own timeout abort. Retrying an aborted request
  breaks cancellation semantics, so DoH must be **first**, not fallback.
- `createPinnedRelayTransport` (`packages/relay/src/pinned-transport.ts`) is the
  correct substrate: self-resolving, IP-dialed with TLS `servername`, retries
  across the answer set, SSRF-validated, bounded. It is relay-server-proven.
- Gaps vs Bun-native fetch that MUST be closed before it can serve as the
  default provider transport:
  1. **Redirect following** (single-hop today; fetch follows up to N).
  2. **Compression** — node:http does not decompress gzip/br/deflate; Bun
     fetch does. Providers read JSON APIs that are gzip-encoded.
  3. Timeout semantics matching the abort contract (no retry after abort).
- DoH resolver: `https://1.1.1.1/dns-query?name=<host>&type=A|AAAA` with
  `accept: application/dns-json` via the IP literal (no bootstrap resolution).
  Filter `Answer` by numeric type 1/28. If DoH itself fails, fall back to
  system `lookup` (current `resolveAllAddresses`) — wrong answers are no worse
  than today's behavior.

## Implementation outline

1. `packages/relay/src/doh-transport.ts`: `resolveDohAddresses()` +
   `createDohPinnedTransport()` = pinned transport + redirect-following wrapper
   (≤5 hops, re-invoke per hop as the transport docstring describes) +
   content-encoding decompression via `node:zlib` when the header asks for it.
2. Wire as the default direct transport in `createRelayFetchPort` behind a
   config key (`providerDoh.enabled`, default true) — declaration must have a
   reader in config normalization, and the reverse state (disable) per
   AGENTS.md seam rules.
3. Verification: `test:live:rivestream` must pass from a poisoned network
   (this machine is one — perfect testbed), hianime/allanime/mpy smokes stay
   green, `packages/relay` unit tests for redirect/compression/fallback, then
   full `bun run test --force` + boundary test.

## Status

Not started. Curl-layer DoH (`--doh-url` on curl-impersonate callsites) is
committed at `cfd97b614` and already covers the miruro/hianime/anidb paths.

## Addendum: anitaku (gogoanime successor) lane — implementation spec

Ecosystem evidence 2026-11-25: gogoanime canonical domains parked/for-sale
(gogoanime.mom, anitaku.pe), anitaku.bz/.to connection-dead even through DoH.
**`anitaku.io` is alive**: 301 → /browse/ → 200, 115KB real catalog HTML.
The backend is the same gogoanime database under the anitaku rebrand.

Implementation notes for the provider build:

- Search: anitaku.io/search.html?keyword= returns list HTML (verify shape —
  first extraction attempt returned empty, needs a real RE pass with the
  page's actual markup)
- Embed chain: gogocdn/vidstreaming-style with AES-encrypted embed params —
  the hardest extraction genre in the scene; keys rotate
- Legal exposure: aniyomi removed this source after DMCA — expect the hottest
  domain-rotation treadmill in the roster. Hotfix-manifest domain override
  support is mandatory, not optional.
- Value despite cost: largest independent anime catalog + real dub coverage,
  and the backend half the FMHY frontends wrap — implementing it directly
  removes the middleman layer those skins add.

Prerequisite decision: confirm whether search extraction is plain HTML or
JS-rendered before scoping. If JS-rendered, the cost likely exceeds the value
vs. fixing allmanga crypto (which restores a multi-host aggregator covering
much of the same catalog).
