---
status: current
lastReviewed: "2026-08-26"
---

# AllAnime parity history

> Agent-facing (L3). Never linked from published docs.

Dated incidents behind the ani-cli parity policy in
[.docs/providers.md](../providers.md). Kept because AllAnime breaks the same way
repeatedly: the crypto and endpoint history is what makes the next break
diagnosable. Newest last.

### AllAnime NEED_CAPTCHA (2026-08-13)

The "valid episode catalog, zero extracted streams" symptom is **not** a crypto or
parity defect. Measured against the production constants (`api.mkissa.net` +
`https://mkissa.to` referer + build id 81):

- Bootstrap succeeds, `keyHex` and `queryHash` are both 64 chars, the `aaReq`
  attestation is accepted, and **no** `AA_CRYPTO_*` error is returned.
- The episode **catalog** query resolves normally (11 episodes for the
  Demon Slayer fixture, titles and all).
- The episode **sources** query returns `NEED_CAPTCHA` on every valid host/referer
  pair — `api.mkissa.net` ← `mkissa.to` and `api.allanime.day` ← `allmanga.to` both
  return it; `api.allanime.day` ← `allanime.to` is a flat HTTP 403.

That asymmetry — catalog ungated, sources gated — is exactly what produced a full
episode list next to zero streams.

`NEED_CAPTCHA` was previously unhandled anywhere in the codebase: it fell through
the retry loop, `rawSources` stayed empty, and the user saw
`No streams extracted from AllManga for episode N`. It is now
`AllMangaCaptchaError`, classified as **`blocked` and non-retryable** (a captcha is
not a network fault and retrying or re-bootstrapping cannot clear it), with a
message naming the one thing that does help — a user-owned relay in an ungated
region. It is checked _before_ the crypto-staleness and rate-limit branches so it
cannot be mistaken for either.

A relay running on the same machine as the client does **not** clear the gate,
because the egress IP is unchanged; a relay deployed to an ungated region is the
untested variable. AllAnime was dropped from the automatic anime lane on
2026-08-13 while staying a registered, manually selectable production module.

The 2026-08-24 build-140 repair makes AllAnime usable again where the source
endpoint is not captcha-gated. No priority-default change is needed:
`animeProviderPriority` is ordering rather than an allowlist, so registered
providers omitted from the array remain available after its named entries. The
NEED_CAPTCHA classification and relay hint stay because geo/bot-gated networks
can still hit the gate.

**Do not restore historical crypto.** Build 140, the current mask constants,
HMAC `x-aa-boot`, and AES-256-GCM are the verified contract. The older build 81
or 119 material, epoch/partB query construction, and AES-CTR decryption must not
be restored.

### AllAnime via user relay (2026-08-17)

With a user-owned relay in place, AllAnime works end-to-end. `bun run
test:live:relay-allanime` passes with real streams (e.g. `video.wixstatic.com`
1080p mp4 via the `Default` source).

- The relay egress (Vercel `iad1` in the reference deployment) reaches
  `api.mkissa.net` and `cdn.mkissa.net` without a Cloudflare challenge and is
  **not** captcha-gated for the episode sources query.
- On 2026-08-17 the upstream build rotated **81 → 119** and the epoch scale
  moved from 3-day to **7-day** (`epochMs: 604800000`, 1-day grace, plus a
  `switchAt` boundary). The old material answered `AA_CRYPTO_MISSING_BUILD`.
  The new constants (build id `119`, mask fragments, epoch scale, and the
  episode persisted-query hash `ca735f…`) were re-derived from the live site:
  string table + rotation from the crypto chunk (`CA0Qy_FU.js`, 144-entry
  table, rotation verified by recomputing the browser's `x-aa-boot` HMAC) and
  the episode hash from the `_9` GraphQL template in the same chunk, then
  confirmed against a real browser session's network traffic. The same
  procedure applies on the next rotation.
- The episode sources request now also carries `k: "k7"` in `extensions`
  (alongside `persistedQuery` + `aaReq`), matching the live site.

**Relay gaps found and fixed the same day:**

- **The relay metadata allowlist was dropping provider-auth headers.**
  `x-build-id`, `x-aa-boot`, `x-obfuscated`, and `x-session-token` were not in
  `METADATA_HEADER_ALLOWLIST`, so every bootstrap through a relay failed with
  `invalid_boot_token` even when the client material was correct. They are now
  forwarded (header-text validation still applies); `x-obfuscated` is also
  passed through on relay responses for Miruro pipe decoding.
- **Deployed relays go stale with provider manifests.** The relay server builds
  its host registry from `@kunai/providers` manifests at deploy time. A relay
  deployed before the mkissa migration rejects `api.mkissa.net` with
  `host-not-allowed`. After any change to a provider's `relayProfile.upstreamHosts`,
  redeploy the relay. `apps/relay-server` also pins `typescript@5.9.3` because
  Vercel's `@vercel/node` builder crashes on the repo-wide TypeScript 7.

**wixmp referer: current behaviour retained.** Plan 036 proposed attaching the
mkissa site referer for `repackager.wixmp.com`, gated on a fixture proving the
current final-stream fallback insufficient. No such fixture can be built from this
network: the pipeline never reaches source extraction, so there is no live wixmp
row to characterize. Per that gate, `resolveDirectStreamReferer()` is unchanged.
mp4upload keeps its dedicated referer and scoped `--tls-verify=no`; TLS
verification is not broadened to any other host.

### AllAnime crypto rotation 119 → 140 (2026-08-24)

The bootstrap started answering `{error:"unknown_build_id"}` (HTTP 404) — build
**119 is retired**, current build id is **140**. This rotation also changed the
derivation constants, which upstream now ships as a config object (`Fd`) in the
obfuscated crypto chunk instead of hard-coding them:

- `hashBuildId` mixes `(index * saltMul + saltAdd)` = `*250 + 54` (was `*17+31`)
- `deriveMaskKey` mixes `(fragmentIndex * fragMul + byteIndex * fragAdd)` =
  `*16 + *217` (was `*41 + *7`)
- new mask fragments; episode persisted-query hash unchanged
- boot token layout changed: first HMAC message is now `{bootPrefix}{buildId}`
  (prefix `4X2PsZc2r:`), second HMAC covers
  `group.host.lane.buildId.epoch` joined by `.` (was
  `buildId:keyGroup:host:epoch:lane` joined by `:`)

Recovery procedure (worked end-to-end against live bootstrap + episode sources):

1. Fetch the mkissa home page, follow `_app/immutable/entry/*.js`, then the
   chunks they reference on `cdn.mkissa.net`; find the chunk containing
   `/client-crypto/v1/bootstrap`.
2. Slice out the self-contained crypto region between `const _I=` and the
   second string-table client (`const Tt=ms;`), append exports of the scoped
   symbols, and run it under Bun with dynamic `import()` — the chunk's anti-debug
   console patching silences `console.log`, so write through
   `process.stdout.write`. That yields buildId, mask fragments, and the config
   object directly.
3. Verify: computed `x-aa-boot` must return HTTP 200 partB from bootstrap, then
   decrypt a real `tobeparsed` blob with the derived key before shipping.

On a cold resolve, the episode catalog and crypto bootstrap start concurrently.
Baseline source adapters then share a 1.5-second foreground inventory window:
prompt peers are retained, but a dead adapter is aborted instead of holding
already-playable streams until its own request deadline. The individual request
timeouts and stale-material retry policy are unchanged. On 2026-08-24 the same
production cold smoke retained four stream candidates and fell from 12.257 to
2.573 seconds after a dead `Luf-Mp4` adapter was isolated as the 11-second wait.
Trace output records only preparation duration, readiness, link count, and
whether Ak was required—never bootstrap material, attestation, token, or source
URLs.

Note: ani-cli v5 (2026-08-01) left AllAnime/mkissa for **anidb.app** and deleted its AllAnime code
entirely, so **there is no upstream parity reference left** for this provider — the "compare against
ani-cli" step above applies to AniDB only. For mkissa crypto the live JS chunk is the sole source of
truth. Kunai keeps AllManga as a registered secondary anime source with `anidb` as the
default anime provider. See [.docs/research/anidb-provider-dossier.md](./research/anidb-provider-dossier.md).

Parity tip: for AniDB compare against local ani-cli `master`. For mkissa crypto, the live JS chunk is the source of truth when ani-cli no longer tracks it. The API rate-limits bursts (~3s), so stale-material recovery re-bootstraps keys instead of retry-storming.

Recommended workflow:

1. compare behavior with the local ani-cli checkout
2. identify whether the break is shared upstream or Kunai-specific
3. if shared upstream, implement the smallest temporary local fix needed here
4. document the divergence and what should be removed once upstream parity is restored
