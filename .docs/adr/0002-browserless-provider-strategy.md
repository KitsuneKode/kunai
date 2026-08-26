# 0002 — Browserless provider strategy, and why Turnstile minting is off the table

Status: accepted
Date: 2026-08-26

## Context

Kunai resolves streams from third-party providers with no browser runtime. Two
questions kept getting re-derived across sessions, each costing real
investigation time:

1. Which movie/TV provider family should Kunai invest in?
2. Can Kunai automate a Cloudflare-Turnstile-derived session token?

The second was investigated properly and answered. Without recording it, the
next agent starts the same expensive dead-end.

## Decision

**Adopt P-Stream / movie-web provider parity for movie and TV sources.** That
family is browserless by construction and covers roughly forty sources, which
matches Kunai's no-browser constraint without a Playwright runtime. Videasy is
demoted rather than removed: it still resolves, but it is not where new effort
goes.

**Do not attempt to automate Turnstile.** The VidKing/Videasy session-token path
needs an `x-session-token` derived from a Cloudflare Turnstile challenge.
Automated minting was tested against Playwright and rebrowser-style stealth
runtimes and **provably does not work** — Cloudflare wins in every configuration
tried. There is no bypass to find; this is not a "try harder" problem. Any
provider that requires a Turnstile-derived token is a paste-a-token fallback at
best, never an automated lane.

The `vidking` provider module itself was retired (the old
`packages/providers/src/vidking/` was removed), but the constraint outlives it —
it applies to any future provider gated the same way.

## Consequences

- New movie/TV provider work starts from P-Stream parity, not from scratch.
- A provider whose auth depends on Turnstile is rejected at intake. Record the
  reason in its dossier rather than opening an investigation.
- If Cloudflare's posture ever changes materially, this ADR is the thing to
  supersede — do not quietly re-litigate it in a provider PR.

See [.docs/providers.md](../providers.md) for the live provider contract and
[.docs/provider-intake.md](../provider-intake.md) for the intake checklist.
