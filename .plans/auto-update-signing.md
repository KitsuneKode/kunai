# Auto-update signing (Ed25519) + delayed auto-apply

Status: TODO — written for audit-4 follow-up. Blocked on a human key decision.

## Why this matters

The native/binary upgrade path verifies a SHA-256 checksum, but the checksum
manifest (`SHA256SUMS`) is fetched from the **same origin** as the artifact
(`upgrade-planner.ts:80` builds `checksumUrl` under the same `dlBase`). That
proves transport integrity, not release authenticity: anyone who can publish a
binary to the release host can also publish the matching checksum. The update
path is the highest-value single target in the app — a compromised release
endpoint ships code straight into self-replace.

## Scope

- Add an Ed25519 signature per artifact (and/or a signed manifest) at release
  time; verify in `BinaryAutoUpdater` / `run-upgrade.ts` **before** any
  self-replace or manifest write.
- Ship the public key in the binary (it is not a secret). Signature failure is
  a hard stop with an actionable error, not a warning.
- Delayed auto-apply: download + verify now, apply on next launch or on a
  user-confirmed tick — never replace the running binary mid-session. A staged
  update dir + manifest keeps "downloaded but not applied" an explicit,
  inspectable state (reverse-state rule: there must be a way to see and discard
  a staged update).
- `install-manifest.ts` already carries `artifactSha256`/`archiveSha256`;
  extend the provenance record with the signature so rollback keeps verifying
  the same artifact.

## Human gate (do not automate)

Generating the release signing keypair is a one-way decision:

- the **public key** is permanent — it is embedded in every shipped binary;
  rotating it orphans older builds' ability to verify, so plan a key-id /
  grace-window scheme up front;
- the **private key** becomes a release secret (CI secret store, maintainer
  hardware, or threshold custody — needs an owner decision).

Until that decision lands this plan stays TODO; writing code that assumes a
key management story is premature.

## Current state evidence

- `apps/cli/src/services/update/upgrade-planner.ts:37,80` — `checksumUrl` from
  the same `dlBase` as the artifact.
- `apps/cli/src/services/update/install-manifest.ts` — provenance fields to
  extend (`artifactSha256`, `archiveSha256`).
- No `signature`/`ed25519`/`integrity` verification exists under
  `apps/cli/src/services/update/` today (grep, audit-4 pass).
