# Provider playback resilience

Residue from the 2026-09-08/09 provider health pass. This tracks what is **not**
closed; the landed work is the commits themselves.

**Framing:** every defect in this pass was the same shape — _a provider reports
success for something that cannot play_. Resolve-time success is not the
contract users care about; decode is. `verifyCandidateStream` is the single seam
that keeps the probed request and the shipped request identical.

## Closed so far

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
  inside its candidate timeout once `providerCycleCandidateTimeoutMs` clamps it.
- **`streamReachabilityVerified` set by a timed-out probe**, which promoted an
  unproven stream to "provider-attested" and switched off playback preflight.
- **Pinned-constant rot is now detectable**: `bun run test:live:allmanga-crypto`
  says whether the pinned AllManga set still works and which half is stale.
- **Rivestream can learn.** It now hands `runProviderCycle` the endpoint-health
  port, and a resolve-gate rejection is marked `endpointScoped` so the
  classifier can treat it as evidence about that one server. Measured caveat:
  no quarantine is observable today because Rivestream's dead mirrors have
  started returning _no sources_ (`candidate-empty`) rather than a dead
  stream, and an empty candidate is deliberately not endpoint evidence — a
  server that simply lacks one title must not be blacklisted. The mechanism
  is proven by `provider-cycle-endpoint-health.test.ts` instead.

## P1 — Miruro: the block is a JS challenge, and the relay is the only way through

Investigated 2026-09-09. What is actually wrong, in order of what was ruled out:

- **Every mirror is Cloudflare-challenged.** `www.miruro.bz`, `.ru`, `.to` and
  `.tv` all answer `403 Just a moment...` — a managed challenge page, not a hard
  block.
- **It is not a TLS fingerprint problem.** Twelve impersonation profiles were
  tried (chrome116/131/136/142/145/146/150, firefox135/144/147, safari153,
  chrome131_android). All twelve get the same challenge, so no newer
  curl-impersonate build will fix it and installing one is not the answer.
- **`miruro.com` is a hub, not the app.** It answers 200, but every path returns
  the SPA shell and it has no `/api/secure/pipe`; its homepage just links to the
  mirrors and a status page.
- **There is no unchallenged API host.** `api.`/`backend.`/`pipe.`/`cdn.`
  subdomains do not resolve on any mirror domain.

So the challenge has to be solved by something that runs JS, or the request has
to come from a network Cloudflare is not challenging.

**The relay path is verified working.** Pointing `KUNAI_RELAY_BASE_URL` at a
local recording stand-in showed the CLI sending four `POST /rpc/miruro` calls
carrying the correct upstream URLs for both mirrors — so the remedy the failure
message names is real, wired end to end, and only needs a relay host outside the
blocked network. (A local relay cannot help: same IP, same challenge.)

One methodological warning for whoever picks this up: `fallbackToDirect`
defaults to **true**, so pointing the relay at a dead port produces the _same_
Cloudflare error as no relay at all. That silently fakes a negative result — use
a recording stand-in, not an unreachable port.

The gate exemption stands for the separate reason below.

## P1 — Miruro cannot host a resolve gate at its current budget

Once `providerCycleCandidateTimeoutMs` clamps it against the attempt budget,
Miruro's per-candidate budget is 4.8-5s, and that must also cover its pipe call.
A three-hop HLS probe costs 2.1-2.9s, so a gate would routinely be cut short,
report `timeout`, and pass everything — coverage in name only. Re-sizing
`MIRURO_CANDIDATE_TIMEOUT_MS` needs a live provider to measure against, and
every Miruro mirror is currently challenged; do not raise the number blind.

## P2 — Schedule the crypto freshness check

`test:live:allmanga-crypto` exists but nothing runs it. It is one request and it
fails with the exact remedy attached, so it belongs on the provider-matrix
workflow's schedule — the point is to learn about a rotation before users do.

## Notes carried forward

- **AniDB** is a site-wide upstream `503`; ani-cli v5 uses the same host and is
  equally down. Its gate is committed but has not been exercised against a live
  ladder — verify when the site returns.
- **AllManga is network-captcha'd, not just rate-limited.** The crypto recovery
  is confirmed working — the episode query now _executes_
  (`PersistedQueryNotFound` is gone and `aaReq` is accepted) — and it resolved
  end to end once, 4 candidates from `video.wixstatic.com` with mpv decoding
  h264 1080p `alang=jpn`. Every attempt since answers `NEED_CAPTCHA`, hours
  later too, so this is a network-level gate of the same shape as Miruro's
  rather than the transient throttle first assumed. The consequence: the resolve
  gate added for AllManga has never met a live source. It is unit-tested and
  shared with four verified providers, so the risk is low, but it is unproven —
  re-run `bun run test:live:allanime` from an ungated network or through a relay.
- **AllManga has no parity reference.** ani-cli `a6ac602` deleted every AllAnime
  path, so the live mkissa chunk is the only source of truth. `AGENTS.md` and
  the dossier now say so.
