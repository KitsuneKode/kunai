# 021 — Make the provider contract enforced instead of decorative

- **Written against commit**: `01ab215b`
- **Priority**: P2
- **Effort**: L (staged; land finding-by-finding, not in one change)
- **Risk**: MED (touches routing, search, history classification and relay)
- **Depends on**: `apps/cli/test/unit/architecture/contract-conformance.test.ts`
  (already landed) — extend it as each stage lands, so each fix is ratcheted.

## Why this matters

Every provider ships a manifest. **The runtime reads almost none of it.** Verified
by grep across `apps/cli/src` + `packages/*/src`, excluding tests and declarations:

| Declared                                 | Production readers |
| ---------------------------------------- | ------------------ |
| `relaySafe` (12 sites)                   | 0                  |
| `manifest.capabilities` (every provider) | 0                  |
| `detectGeoBlockedProviderResponse`       | 0                  |
| `rewriteStreamUrlForRelay`               | 0                  |
| `Provider.resolveStream`                 | 0                  |

Meanwhile provider identity is hardcoded into nine "agnostic" modules. The net cost:
**adding provider #7 means editing ~7 files outside `packages/providers/`, none of
which the compiler points you at.** Get one wrong and you get a silent mis-route —
wrong search catalog, wrong history label, no relay, no fallback — never a build
error. That is plausibly why `cineby`, `rgshows` and `vidrock` sit finished but
unregistered in `packages/providers/src/experimental.ts`.

## Stages

Land these in order. Each is independently shippable and independently revertable.

---

### Stage 1 — Enforce `relaySafe` (S)

`packages/providers/src/allmanga/manifest.ts:49` and `videasy/manifest.ts:45` both
declare `relaySafe: false`, and their metadata is relayed anyway. The only gate,
`packages/relay/src/create-relay-fetch-port.ts:27`, asks `registry.isHostAllowed(...)`
and never consults the flag. The server-side guard at `packages/relay/src/handler.ts:36`
is `if (!provider.profile)`, which can never be true because `registry.ts:14` already
skips profile-less modules — so `RelayErrorCode` value `"provider-not-relayable"` is
unreachable.

**Decide the semantics first.** There are two `relaySafe` fields — manifest-level
(`packages/core/src/provider-manifest.ts:25`) and `ProviderRuntimePort.relaySafe`
(`packages/types/src/index.ts:429`). Pick one meaning (suggested: manifest-level =
"may traverse a relay at all") and document it on the type.

**STOP and report** before flipping the gate on: enforcing it as written will _stop_
relaying AllAnime metadata, which is the main relay use case today. The two manifests
declaring `false` most likely want `true`. This is a maintainer decision, not an
executor one.

---

### Stage 2 — Wire geo-block detection (M)

`detectGeoBlockedProviderResponse` has zero runtime callers — so geo-blocking, the
one failure the relay exists for, is never detected. A 403 falls through
`classifyProviderFailureClass` (`packages/core/src/provider-failure-classifier.ts:130`)
to a generic `blocked` with no relay hint.

Its allow-list is also already stale: `packages/relay/src/detect-geo-block.ts:19` is
`new Set(["allanime", "allmanga"])` — `"allmanga"` is the _module_ directory name,
not a provider id (the manifest id is `allanime`). And line 35 hardcodes
`api.allanime.day`.

**Fix.** Call the detector from the provider fetch port / failure classifier, and
replace both the allow-list and the host literal with a registry lookup: a provider
has a meaningful relay suggestion iff `registry.get(providerId)?.profile` exists, and
`profile.upstreamHosts` supplies the host match. That makes Miruro, VidLink and
Rivestream — all of which ship `relayProfile`s — work without further edits.

---

### Stage 3 — Fix `listEpisodes`, which is a strictly weaker call than `resolve` (S)

`apps/cli/src/services/providers/ProviderRegistry.ts:99-108` rebuilds the title as
`{ id, kind, title }`, dropping `externalIds`, `anilistId`, `tmdbId`, and never
passing `preferredAudioLanguage` / `preferredSubtitleLanguage` — all of which
`ProviderEpisodeListInput` carries (`packages/types/src/index.ts:593-597`).

Consequences, both user-visible:

- AllAnime: `resolveAnimeAudioIntent(input.preferredAudioLanguage ?? "original")`
  (`packages/providers/src/allmanga/direct.ts:206`) always resolves to the **sub**
  catalog, so dub users get sub episode counts and labels.
- AllAnime + Miruro: the AniList→native bridge
  (`packages/providers/src/allmanga/resolve-show-id.ts:41-53`) and Miruro's
  `title.anilistId ?? title.id.replace("anilist:", "")` (`miruro/direct.ts:1015`) have
  nothing to read, so `listEpisodes` works only when the raw session id happens to
  already be numeric.

`apps/cli/src/app/playback/PlaybackPhase.ts:4114` hides all of it behind a bare
`catch {}` returning `undefined`.

**Fix.** Build the title through `resolveProviderTitleIdentity(...)` with the module's
`catalogIdentity` — the same path `stream-request-adapter.ts` already uses — and
thread the caller's language profile through. Replace the bare `catch {}` with a
logged, classified failure.

Low risk: passing more fields is additive. The one behavior change is AllAnime dub
catalogs appearing where sub was shown, which is the bug being fixed.

---

### Stage 4 — Derive search routing from `catalogIdentity` (S)

`compatibleProviders` decides which search catalog a provider gets, and the lists have
drifted. Registered providers are `videasy, vidlink, rivestream, allanime, miruro,
youtube`. The lists say `["allanime","allmanga","miruro","hianime"]` and
`["videasy"]` — `hianime` **does not exist**, `allmanga` is a module alias, and
`vidlink` / `rivestream` / `youtube` appear nowhere.

Duplicated across four files: `services/search/definitions/index.ts:19,29`,
`definitions/anilist.ts:35`, `definitions/tmdb.ts:19`, plus a stale fifth copy at
legacy `search.ts:369`.

Unlisted providers fall through `getForProvider` → `getDefault()` → TMDB. For
vidlink/rivestream that is accidentally right. For YouTube it is not: if YouTube's
native search is unavailable, YouTube-mode search returns TMDB movie rows tagged
`resolvedLane: "youtube"` (`SearchRoutingService.ts:159`), which `defaultCanHandle`
then rejects at playback.

**Fix.** `packages/core/src/provider-manifest.ts:35-40` already returns exactly
`"anilist" | "tmdb" | "provider-native"`. Replace `compatibleProviders` with a
`catalogIdentity` field on each search definition, have `getForProvider` read
`providerRegistry.getMetadata(id).catalogIdentity`, and make the no-match case
explicit rather than silently defaulting to TMDB.

---

### Stage 5 — Move the `allanime:` prefix out of core title identity (S, MED risk)

`packages/core/src/title-identity.ts` strips a literal `allanime:` prefix in **four**
functions (lines ~75, 87, 113, 176), with the same literal repeated in
`apps/cli/src/app/bootstrap/title-identity-persist.ts:14` and
`apps/cli/src/services/history-metadata/HistoryMetadataHealer.ts:77`.

`resolveProviderTitleIdentity` is the single generic hook mapping a stored title into
a provider's namespace — the one function that must be provider-neutral. The provider
module already handles its own prefix correctly at
`packages/providers/src/allmanga/resolve-show-id.ts:37`, so core's copy is redundant
as well as leaky.

**Fix.** Add an optional `nativeIdPrefix` / `normalizeNativeId` to
`ProviderCatalogIdentity`, pass it into `resolveProviderTitleIdentity`, and normalize
legacy rows once at the storage boundary.

**Risk.** History rows persisted with `allanime:`-prefixed ids exist in the wild.
Removing the strip needs a one-time migration or a read-time normalization shim.
**Test against a copy of a real DB, never the live one** (copy to `/tmp` first).

---

### Stage 6 — Honor the failure classifier in the fallback loop (M, MED risk)

`packages/core/src/provider-engine.ts:307` breaks out of `resolveWithFallback` only on
`isOfflineNetworkFailure(failure)` — a `message.toLowerCase().includes(...)` over six
string literals (`provider-failure-classifier.ts:11-17`).

The rich `fallbackPolicyForProviderFailureClass` (`:44-56`) computes
`"no-fallback" | "auto-fallback" | "guided-action"` and its only consumers are
**display**: a `retryable` badge and final summary copy in `PlaybackResolveService.ts`
(~1013, ~1024).

So a `guided-action` failure (blocked, sub-dub-mismatch, title-episode-gap) burns the
full candidate list — `maxAttempts` × N providers × attempt timeout — before telling
the user it needed their input all along. And a provider whose transport reports
offline differently never short-circuits.

**Fix.** Consult `classifyProviderFailure(failure).fallbackPolicy` and break on
`no-fallback` / `guided-action`, returning the classification so the caller can
present the guided action. Replace the substring heuristic with a structured
`code`/`cause` check as the primary signal.

Extend the classification tests **first** — this changes observable recovery behavior.

---

### Stage 7 — Delete the engine-bypassing second resolve path (S)

`apps/cli/src/services/providers/Provider.ts:88` gives every provider
`resolveStream: opts.resolveStream ?? defaultResolveStream(module, opts.mode)`.
`defaultResolveStream` (`:113-116`) calls `module.resolve` with a bare context: no
`fetch` (no relay), no `auth` (no Videasy session token), no `endpointHealth`, no
`titleBridge`, no retry, no timeout, no `emit`.

It has **zero call sites** — but it is on the `Provider` interface (`:34`), so it is
the natural thing for a contributor to call, and doing so silently bypasses
everything. `capabilities` (`:78-82`) is built alongside and is likewise read only by
`DiagnosticsServiceImpl.ts:121`.

**Fix.** Remove `resolveStream` from the interface, or reimplement it in terms of
`engine.resolve(...)` so exactly one resolve path exists.

## Done criteria

Per stage: `bun run typecheck && bun run lint && bun run test`, plus the stage's own
test. Additionally, after each stage, delete the corresponding baseline entry from
`apps/cli/test/unit/architecture/contract-conformance.test.ts` — the suite fails if a
baselined symbol gains a reader, so a stale baseline cannot survive.

**Acceptance test for the whole plan:** promote one provider from
`packages/providers/src/experimental.ts` (suggest `rgshows`). It should require zero
edits outside `packages/providers/` plus one line in `bootstrap-providers.ts`. If it
does not, the contract is still not enforced.

## Maintenance note

The mechanisms already exist and are unused: `resolveProviderCatalogIdentity`,
`resolveProviderLaneFromModule`, `ProviderCapability`, `ProviderTitleBridgePort`,
`buildProviderRelayRegistry`. This plan is mostly _reading what is already declared_,
not designing something new. Prefer wiring an existing mechanism over inventing one.
