# Provider playback resilience

Residue from the 2026-09-08/09 provider health pass. This tracks what is **not**
closed; the landed work is described in the commits on
`worktree-provider-health-fixes`.

**Framing:** every defect in this pass was the same shape — _a provider reports
success for something that cannot play_. Resolve-time success is not the
contract users care about; decode is. `bun run test:live:mpv` measures the
difference, and `verifyCandidateStream` is the single seam that keeps the
probed request and the shipped request identical.

## Closed in this pass

- **Videasy shipped a dead URL past its own gate.** It verified with
  `Origin: vidking.net` and shipped `Origin: cineby.at`; the CDN accepts the
  first and refuses the second. The stream origin is now one constant with no
  override. This was in the released build.
- **One resolve gate.** `verifyCandidateStream` takes the candidate, so the two
  request shapes cannot drift. videasy, rivestream, allmanga, anidb and the
  shared direct-stream engine (vidlink) all use it, enforced by
  `provider-resolve-gate-coverage.test.ts`.
- **Gate budgets that could not reach a verdict.** One 6s budget replaces the 3s
  shared default and videasy's tighter 2.5s copy, with tests requiring headroom
  over the measured 2.1-2.9s three-hop probe and requiring each gate to fit
  inside its candidate timeout.
- **`streamReachabilityVerified` set by a timed-out probe**, which promoted an
  unproven stream to "provider-attested" and switched off playback preflight.
- **Pinned-constant rot is now detectable**: `bun run test:live:allmanga-crypto`.
- **The matrix can prove decode**: `KUNAI_MATRIX_PLAYBACK=1 bun run test:live:matrix`
  swaps in the mpv check wherever a provider supports it, and the report says
  which kind of evidence it carries.

## P1 — Miruro cannot host a gate at its current budget

Miruro is the one production provider still exempt from the coverage rule. Once
`providerCycleCandidateTimeoutMs` clamps it against the attempt budget its
per-candidate budget is 4.8-5s (fast/balanced), and that must also cover its
pipe call. A three-hop HLS probe costs 2.1-2.9s, so a gate would routinely be
cut short, report `timeout`, and pass everything — coverage in name only.

Fixing it means re-sizing `MIRURO_CANDIDATE_TIMEOUT_MS` against a live provider,
and Miruro is currently WAF-blocked from this network (403 to plain curl _and_
to full Chrome TLS impersonation, both mirrors). Do it when a relay or an
ungated region makes measurement possible; do not raise the number blind.

## P2 — Schedule the crypto freshness check

`test:live:allmanga-crypto` exists but nothing runs it. It is one request and it
fails with the exact remedy attached, so it belongs on the provider-matrix
workflow's schedule — the point is to learn about a rotation before users do.

## P1 — Rivestream never learns: gate rejections do not reach endpoint health

Measured, not suspected. Two resolves sharing one pinned profile root
(2026-09-09, Breaking Bad S01E01):

    run 1: 4336ms, 9 candidates attempted, 0 skipped
    run 2: 3756ms, 9 candidates attempted, 0 skipped

The second run re-walks every dead mirror. Nothing is skipped as `quarantined`,
and `healthDelta` carries only a provider-level `{outcome: "success"}` — no
per-endpoint verdict. The cause is simple: **`rivestream/direct.ts` never
touches `endpointHealth` at all**, unlike videasy which calls
`endpointHealth.recordFailure(server, …)` on its failure paths. So
`provider_endpoint_health` has nothing to quarantine and the cycle pays the full
walk on every play.

The fix is to record per-server outcomes from the cycle: a gate rejection is a
`route-dead`-shaped failure for that server, a success clears it. It needs a
decision on what identifies a Rivestream endpoint (the service name — `apex`,
`primevids`, `citadel`) and care that a definitive gate rejection is recorded
while a timeout is not, so a slow link cannot quarantine a working mirror.

Cost today is ~4s of dead-mirror walking per resolve, so this is feel rather
than correctness — but it is the difference between a provider that learns and
one that does not.

## Notes carried forward

- **AniDB** is a site-wide upstream `503`; ani-cli v5 uses the same host and is
  equally down. Its gate is committed but has not been exercised against a live
  ladder — verify when the site returns.
- **AllManga's gate is not yet verified live.** The crypto recovery was proven
  end to end (4 candidates from `video.wixstatic.com`, mpv decoding h264 1080p
  with `alang=jpn`), but that was _before_ the resolve gate was added. Repeated
  verification runs then tripped upstream anti-abuse, and every attempt since
  returns `NEED_CAPTCHA` — which is surfaced honestly as `AllMangaCaptchaError`
  but blocks confirmation. Re-run `bun run test:live:allanime` after the rate
  limit clears and confirm the gate does not reject a working wixstatic source.
  The gate itself is unit-tested and shared with three verified providers, so
  the risk is low, but it is unconfirmed.
- **AllManga has no parity reference.** ani-cli `a6ac602` deleted every AllAnime
  path, so the live mkissa chunk is the only source of truth. `AGENTS.md` and
  the dossier now say so.
