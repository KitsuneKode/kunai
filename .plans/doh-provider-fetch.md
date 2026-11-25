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
