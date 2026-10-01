---
"@kitsunekode/kunai": patch
---

The relay roster, CLI bootstrap, and status sweep now share one production-provider authority.

The relay server kept its own six-provider list, so a deployment could be missing half the
relay-capable roster while `/health` still reported healthy. The registry is now built from
the exported `PRODUCTION_PROVIDER_MODULES`, `/health` returns the sorted `providerIds` it
serves, and `kunai doctor` diffs that roster against the relay-capable list — a deployment
that predates a provider now warns instead of silently answering `unknown-provider` forever.
A deployment predating coverage reporting is reported as such rather than as missing.

Relay-generated refusals are recognized by the `X-Kunai-Relay-Error-Code` header instead of
two hardcoded status/code pairs, so `unknown-provider` and `host-not-allowed` can no longer
impersonate upstream verdicts. With `fallbackToDirect` off a refusal now surfaces as a
thrown, typed `RelayRefusalError` — terminal, and never a marked response a provider could
read as an upstream verdict — so a stale relay's refusal 404 can no longer be cached as
missing content or answered through a direct/curl bypass. AniDB no longer retries a
relay-generated 404 through curl. The resolve gate probe is now on by default (only
documented exemptions opt out), and the dead `RELAY_HOP_HEADER` constant is gone. The
provider status sweep derives from the same roster, so every production provider is either
probed or explicitly exempted.
