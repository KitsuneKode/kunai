# Anti-slop gate — codify baseline, ratchet, and owner (#472)

Status: TODO — the gate exists and is enforced; the _convention_ around it is
undocumented. Decision needed, not code.

## Why this matters

`bun run lint:anti-slop:baseline` (root `package.json`) already runs in CI and
audit-4 kept the baseline at **zero increased rules** — but nothing written
down answers:

- **Who owns a baseline bump?** Today anyone can run
  `lint:anti-slop:baseline:update` and commit the result; a ratchet only works
  if bumps require an explicit, attributable decision.
- **What is the ratchet convention?** Baseline must never grow; new violations
  in touched files must be fixed in-PR rather than baselined (or: per-rule
  owners burn down their category — pick one and write it down).
- **Where is it enforced?** The script exists; contributing docs do not tell a
  PR author it exists or what to do when it fails. #472 is the tracking issue.

## Scope

1. Write the convention into the contributing/agent docs
   (`.docs/agents/` or `docs/` contributing page — find the doc that owns CI
   gates; do not invent a new home):
   - baseline is append-never: `baseline:update` output needs review sign-off,
   - touched-file violations are fixed, not baselined,
   - per-rule burn-down ownership table (even if the owner is "next PR that
     touches it").
2. Point `lint-staged`/CI messaging at the doc when the baseline check fails,
   so the failure names the rule.
3. Close #472 when the doc lands.

## Evidence

- `package.json` scripts: `lint:anti-slop`, `lint:anti-slop:changed`,
  `lint:anti-slop:baseline`, `lint:anti-slop:baseline:update`;
  `scripts/anti-slop-baseline.ts`, `scripts/anti-slop-changed.ts`;
  `.oxlintrc.anti-slop.json`.
- audit-4 result: baseline at zero increased rules after the hygiene pass —
  the convention is what keeps it there.
