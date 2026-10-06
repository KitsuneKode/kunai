# Plan 052: Move tracker and provider secrets behind an OS credential vault

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/services/persistence/SyncTokenStore.ts apps/cli/src/infra/fs/atomic-write.ts packages/config/src/ apps/cli/src/services/sync/`
> Mismatch → re-locate the token persistence seams before proceeding.

Closes #179.

## Status

- **Priority:** P2
- **Effort:** L (design + implementation + migration)
- **Risk:** HIGH if done carelessly — a botched migration logs or loses credentials; the migration rules below are the plan's core
- **Depends on:** none
- **Category:** security
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

AniList and TMDB credentials persist to `sync-tokens.json`, and
`videasySessionToken` sits in `config.json`. Writes go through
`writeAtomicSecretJson` (owner-only `0600`, Windows user-ACL) — solid file
hygiene, but plaintext at rest. The issue (status: planned) calls for an
OS-backed vault: macOS Keychain, Windows Credential Manager / user-scope
protection, Linux Secret Service — with an explicit headless-Linux fallback so
first run never fails on a server without a keyring.

## Current state

- `apps/cli/src/services/persistence/SyncTokenStore.ts` — the whole token file
  seam is already isolated: `SyncTokenFileIo` (`readTokens`/`writeTokens`) with
  `realSyncTokenFileIo` production impl and in-memory test doubles. Mutations
  serialize through `mutationChain`. **The port boundary already exists — the
  vault plugs into `SyncTokenFileIo`, not into callers.**
- `writeAtomicSecretJson` — `apps/cli/src/infra/fs/atomic-write.ts:257` area;
  mode `0o600` on POSIX, inheritance-free user-only ACL on Windows.
- `videasySessionToken` — `packages/config/src/defaults.ts:77`, read as a
  normal config value; `config.json` is written by ConfigService (find its
  persistence path — same atomic-write family).
- Paths: `getKunaiPaths()` in `packages/storage/src/paths.ts` — never hardcode
  `~/.config`.
- Tokens' consumers: `AniListAdapter`/`TmdbAdapter` read through
  `this.tokenStore.load()`; nothing outside the persistence layer touches the
  file.

House rules that apply (AGENTS.md): data flows one way — never run a
migration against the developer's live profile; isolate tests with
`storageRootEnv` (HOME + XDG + APPDATA), and copy real DBs/config to a shadow
dir for debugging. Secrets never appear in logs or findings — file:line and
credential type only.

## Commands

| Purpose    | Command                               | Expected   |
| ---------- | ------------------------------------- | ---------- |
| Unit tests | `bun run --cwd apps/cli test:unit`    | all pass   |
| Full suite | `bun run test --force`                | 0 failures |
| Typecheck  | `bun run typecheck --force`           | exit 0     |
| Lint/fmt   | `bun run lint --force && bun run fmt` | exit 0     |

## Scope

**In scope:**

- New vault port + backends under `apps/cli/src/services/persistence/` (or a `packages/` home if layering dictates — `services/` may import `infra` and `packages/storage`; check `runtime-boundary-map.md` before placing)
- `SyncTokenStore.ts` — route through the vault port
- The `videasySessionToken` config migration (decide: vault it and drop the config key, or keep a `videasySessionTokenIsInVault` marker — no plaintext once migrated)
- Migration + rollback + disconnect/reset/export/uninstall semantics
- `.docs/` — the owning doc for secrets storage (find it; likely `features/privacy-and-storage.md` or `tracker-sync.md`)
- `.changeset/` — user-facing security improvement

**Out of scope:**

- The AniList/TMDB OAuth flows themselves.
- Relay bearer token storage (user-configured in config.json — document whether it joins the vault now or later; a deferral is acceptable if the port supports it).
- `.release` / installer changes.

## Design contract the implementation must satisfy

From issue #179, verbatim requirements — these are the acceptance bar:

1. One credential-vault port owned by the persistence layer.
2. Backends: macOS Keychain, Windows user-scoped protection or Credential
   Manager, Linux Secret Service **when available**.
3. **Headless Linux fallback is defined and tested** — first run must not fail
   on a machine with no desktop keyring (Secret Service absent → file fallback
   with a loud once-warning, or an opt-in env var; decide and document).
4. Migrate AniList, TMDB, and Videasy secrets without logging or duplicating
   values.
5. Delete plaintext only **after** a verified vault write (write → read-back →
   compare → delete; never write→delete).
6. Migration is restart-safe and idempotent — a crash mid-migration leaves a
   resumable state, not a half-moved credential.
7. Disconnect, reset, export, and uninstall semantics preserved — disconnect
   removes the vault entry; diagnostics export never includes vault contents.
8. Never expose secrets through settings meta (the settings registry surfaces
   config keys — a vault-backed key must render as "set"/"unset", not a value).

## Steps

### Step 1: Spike the backend mechanics (do this first, before the port)

On this Linux machine, verify what `Bun.spawn` can reach: is `secret-tool`
(libsecret) or `busctl`/D-Bus available? Probe `Bun.which("secret-tool")`. For
macOS the backend is `security` CLI (`add-generic-password`/`find-generic-password`);
for Windows, PowerShell `[Windows.Security.Credentials.PasswordVault]` or
DPAPI `ProtectedData`. Record feasibility per platform in the PR description —
the backends are CLI calls, no native deps.

Decision to make and document: backend selection order
(env override → platform backend → file fallback) and where the choice is
remembered (a `credentialBackend` marker in config, or probe each time).

**Verify:** a note in your working diff recording which CLIs exist and which
backend each platform will use — this is the design record, keep it in the PR.

### Step 2: Define `CredentialVaultPort`

Shape (match the codebase's port style — see `SyncTokenFileIo` and
`EndpointHealthPort` for convention):

```ts
export interface CredentialVaultPort {
  readonly backend: "keychain" | "wincred" | "secret-service" | "file";
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Keys: `anilist.accessToken` (+userId/expiresAt as a JSON blob — one vault entry
per tracker, not per field), `tmdb.session`, `videasy.sessionToken`. File
backend = the existing `SyncTokenFileIo` path so fallback loses nothing.

### Step 3: Backends + fallback wiring

Implement the three OS backends over `Bun.spawn` (never `exec` of a composed
string — argv arrays only; secret values go to stdin, never argv, since argv
is world-readable via `ps`). Timeouts on every spawn (the repo's
`DeadlineFactory`/`setTimeout` pattern). File backend wraps the current
`writeAtomicSecretJson` path.

**Verify:** `bun run --cwd apps/cli test:unit` → pass with in-memory fake vault.

### Step 4: Migration

In `SyncTokenStore` (or a `CredentialMigration` helper it calls on first load):

1. Read plaintext stores (`sync-tokens.json`, config `videasySessionToken`).
2. If vault backend != `file` and plaintext exists: vault.set → vault.get →
   compare → only then delete the plaintext key/file entry.
3. Record migration completion so it runs once; idempotent if re-run.
4. On any vault write/read failure: keep plaintext, mark migration pending,
   retry next launch. Never log the value — log key names only.

**Verify:** unit tests drive the full matrix: clean install (no plaintext),
migrated, interrupted-migration restart, vault-unavailable fallback,
disconnect deletes vault entry.

### Step 5: Consumers + settings meta + docs

- `AniListAdapter`/`TmdbAdapter` keep calling `tokenStore.load()` — the vault
  is invisible to them. Verify no other code reads `sync-tokens.json`
  directly (grep).
- Settings registry (`app-shell/settings/registry/`): `videasySessionToken`
  entry must show set/unset, never the value.
- Update the owning `.docs/` file in the same change set.
- Changeset (patch): `feat(security): store tracker credentials in the OS credential vault`.

## Test plan

- New tests under `apps/cli/test/unit/services/persistence/` (or matching the
  port's home): fake vault, scripted-failure vault (write succeeds, read-back
  mismatches → plaintext preserved), migration idempotency, headless fallback
  path (backend probe returns absent → file backend, warning emitted once).
- Isolation: every test that touches paths uses `storageRootEnv` — never the
  live profile (AGENTS.md hazard #1).
- Existing SyncTokenStore tests must keep passing through the vault indirection.

## Done criteria

- [ ] `sync-tokens.json` is not written when a vault backend is active (test asserts)
- [ ] `videasySessionToken` plaintext removed from `config.json` post-migration (test asserts)
- [ ] Headless Linux (no secret-service) still first-runs — file fallback tested
- [ ] No secret value appears in any log/test output — grep the diff for literals
- [ ] `bun run test --force`, `typecheck --force`, `lint --force` exit 0
- [ ] Docs + changeset land in the same PR

## STOP conditions

- No viable Windows backend without a native dep (cmdkey can't store/read
  arbitrary secrets back; PasswordVault via PowerShell may be the only path —
  if it can't round-trip in verification, document Windows as file-fallback
  for now rather than shipping a write-only vault).
- The layering test (`boundary-imports.test.ts`) fails on your port's
  placement — move it, don't weaken the boundary test.
- Migration can't be made idempotent without a schema marker — report the
  design tension before shipping a best-effort migration.

## Maintenance notes

- Future secrets (new trackers, relay bearer if folded in) get one vault key
  each — document the key-naming convention in the port file.
- A reviewer should scrutinize: argv hygiene (secrets via stdin only),
  migration's delete-after-verify ordering, and the headless fallback warning.
- If a distro lacks `secret-tool` but has a running Secret Service daemon,
  note the detection order — presence of the CLI vs presence of the service.
