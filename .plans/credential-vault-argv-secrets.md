# Credential vault — close the argv/secret exposure

Status: TODO — picks up the audit-4 security follow-up and the live residue of
plan 052 (archived, PARTIAL). 052 landed the vault backends; this is what is
left.

## Why this matters

Secrets must not cross a process boundary on argv. argv is world-readable in
`/proc/*/cmdline`, lands in crash dumps and shell/system logs, and survives
the process. Plan 052 shipped `credential-vault.ts` with `keychain` / `wincred`
/ `secret-service` / `file` backends whose spawn shape keeps the secret on
stdin — but the macOS read path still shells out to `security -w`, and the
remaining exposure is exactly the residue 052 named.

## Scope

1. **Native Keychain binding for macOS** — replace the `security -w` subprocess
   read with a native call (or an alternate backend) so the secret never
   transits a spawned process's arguments. Keep the `security` CLI backend as
   fallback while the binding proves out.
2. **Audit every spawn in the vault** — the `SpawnShape` contract
   (`credential-vault.ts:37`, secret on stdin, argv free of secret material)
   is the invariant; add a unit test that inspects constructed argv across
   backends for any secret fragment, so a future backend cannot reintroduce it.
3. **Provider key material** — sweep provider/session secrets that are not yet
   behind the vault (`videasySessionToken` in `config.json`, per plan 052's
   current-state notes) and move them behind the same backend selection.
4. Keep vault spawns **off the first-paint path** — coordinate with plan 060's
   cold-start profile before adding a spawn to any boot sequence.

## Evidence

- `apps/cli/src/services/persistence/credential-vault.ts:11,37` — backend ids
  and the stdin-secret spawn shape.
- `.archive/plans/052-os-credential-vault.md` — landed scope; do not treat as
  current authority for what remains (this file is).
- Roadmap residue: "native Keychain binding to remove `security -w` argv
  exposure; vault spawns off the first-paint path (measure under 060)".
