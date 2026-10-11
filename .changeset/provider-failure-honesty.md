---
"@kitsunekode/kunai": patch
---

Report a blocked provider as blocked, and stop advising a fix that was already applied.

Three failure-classification fixes, all of which were spending retry budget or
misleading the person reading the error.

**A Cloudflare challenge is not retryable.** AniDB reported every failure as
`retryable: true`, including a Cloudflare block. The engine reads that flag to
decide whether to buy a provider a second full attempt — 12 seconds each under
the `balanced` default — so a block that no retry can clear was costing up to
half the resolve budget before any fallback was considered. AniDB now mirrors
the policy AllManga already uses for its captcha gate: a typed `blocked` failure
is not retryable, anything else is. Related: on the no-curl path a challenge
arriving with a 4xx status was never recognised as a challenge, because the
status was read before the body. The body is now read first.

**The `dns` substring no longer means "offline".** Network classification
matched any error message containing the three letters `dns`. A title echoed
into an error, or a path containing `dns`, was enough — and two such failures
across two providers halt every remaining live candidate, including working
ones. The resolver's actual phrasings (`Could not resolve host`, `Name or
service not known`, `no such host`, `dns lookup`) are enumerated instead.

**Errors name the request they failed on.** A hianime resolve is four network
hops; `hianime fetch HTTP 503` did not say which one died. Both providers also
suggested installing curl-impersonate to users already running
curl-impersonate — advice the reader has already followed, which makes a blocked
upstream look like a local misconfiguration.
||||||| parent of 757e29a79 (fix(providers): stop flattening transport and HTTP failures into "empty")

Raise the provider failure floor: classified HTTP and transport errors no
longer degrade to generic network noise or fake "empty" results.

- `resolveDirectStreamSource` unwraps `ProviderHttpError` instead of flattening
  every error to `network-error`/`retryable: true` — a 404, a 429, and a dead
  host now report what they are (helps vidlink today; vidrock/rgshows inherit
  it via the shared engine).
- Rivestream: raw transport failures report `network-error` (was `not-found`),
  offline signatures are non-retryable so the cycle's network-offline
  early-exit fires, the 10s candidate timeout is clamped to the attempt
  budget (it was dead code under `fast`), and a block on the shared
  rivestream.app front door stops the cycle instead of failing every service
  identically.
- AllManga: HTTP statuses and fetch failures throw classified
  `ProviderHttpError` instead of returning an empty source list — a dead
  connection or a 503 no longer reads as "episode has no sources"; rate-limit
  and crypto-refresh exhaustion report `rate-limited`/`provider-unavailable`
  instead of empty.
- VidLink: `HTTP ${status}` strings become `ProviderHttpError` so status
  fidelity survives to the failure record.
- HLS ladder (`expandHlsMasterPlaylist`): transport and HTTP failures throw
  `ProviderHttpError` instead of collapsing into a fake `auto` variant — a
  dead HLS host no longer comes back attested as a resolved stream. The `auto`
  row remains for fetched bodies that are not master playlists.
- Stream probe: unverifiable TLS chains ("unable to verify the first
  certificate", self-signed, missing local issuer) are definitive failures
  like expired certs — a broken chain fails the resolve gate instead of
  retrying and passing through.
- HiAnime: `ProviderHttpError` keeps its fidelity through failure mapping
  (`not-found`/`blocked`/`provider-unavailable` instead of generic
  `network-error`), and `provider-unavailable` joins the retryable allowlist
  since upstream 5xx maintenance windows heal.
- AniDB: `searchAnidb` and the HLS ladder fetch report HTTP status, so a 503
  maintenance page surfaces `provider-unavailable` instead of parsing as an
  empty catalog; per-mode settles classify `AnidbHttpStatusError` by status.
- AllManga: per-source link fetches throw classified `ProviderHttpError`, and
  when every adapter lane refuses with a real status (403/429/5xx) the refusal
  surfaces instead of an empty list; 404s stay lane-scoped so the required-Ak
  fallback still fires.
- Live matrix parser: multi-JSON stdout (YouTube emits report + ladder +
  shorts checks) and stderr reports now parse instead of reading as harness
  failures.
- New conformance test bans raw `candidateTimeoutMs` literals — the clamp bug
  has shipped three times.
