# Plan 053: Replace crypto-js with a tested EVP_BytesToKey port

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- packages/providers/src/videasy/direct.ts packages/providers/package.json package.json bun.lock`
> Mismatch → re-check the two call sites; someone may have touched the Videasy crypto.

Closes #106.

## Status

- **Priority:** P2
- **Effort:** M
- **Risk:** MED — byte-exact crypto parity is the whole job; a wrong KDF decodes garbage, not an error
- **Depends on:** none — but read "Pre-flight" first; if the guarded/Vidking lanes are demoted to paste-fallback this work loses its value. Check the lane's status before spending it.
- **Category:** dependency / security (deprecated dep on the provider path)
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`crypto-js` is deprecated upstream and has exactly one importer left:
`packages/providers/src/videasy/direct.ts`. Removing it shrinks the provider
attack surface and drops a dead dependency — but both call sites use CryptoJS's
**passphrase** mode, which is OpenSSL `EVP_BytesToKey` (MD5, 1 iteration) plus
an 8-byte `Salted__` header convention. `node:crypto` has no equivalent — it
must be reimplemented byte-exactly. The `vidrock-crypto.test.ts` precedent
("matches the previous crypto-js AES-CBC output byte-for-byte") was the easy
case (explicit key/IV) and does not transfer.

## Current state

```ts
// packages/providers/src/videasy/direct.ts:1967-1982 — decodeVideasyGuardedPayload
if (!payload.startsWith("v2:")) return payload;
if (!sessionToken) throw new Error("Videasy guarded payload requires a session token");
const { default: CryptoJS } = await import("crypto-js");
const key = CryptoJS.SHA256(`g:${sessionToken}`).toString();          // hex string passphrase
const decrypted = CryptoJS.AES.decrypt(payload.slice(3), key).toString(CryptoJS.enc.Utf8);
```

```ts
// :2050-2052 — decodeVidkingPayload (empty passphrase edge case!)
const { default: CryptoJS } = await import("crypto-js");
const decryptedBytes = CryptoJS.AES.decrypt(wasmDecryptedBase64, "");
```

Both are `AES.decrypt(ciphertext, <string>)` → passphrase mode → the payload
must carry `Salted__` + 8-byte salt, key+IV derived via EVP_BytesToKey-MD5.
The empty-passphrase call at :2051 makes the derived key a fixed function of
the salt alone — the parity test must pin that edge exactly.

Manifest entries to remove last:
`packages/providers/package.json:32-33` (`@types/crypto-js`, `crypto-js`) and
root `package.json` catalog `providers` block (:34-37 — also drops
`@assemblyscript/loader`? No — only the crypto-js lines; the loader stays for
the WASM path).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Provider tests | `bun run --cwd packages/providers test` | all pass |
| Full suite | `bun run test --force` | 0 failures |
| Typecheck | `bun run typecheck --force` | exit 0 |
| Audit | `bun audit` | crypto-js gone from dep tree |

## Scope

**In scope:**
- New `packages/providers/src/videasy/openssl-compat.ts` (or `shared/` if another provider needs it — check for other passphrase-mode users first; if none, keep it provider-local)
- `packages/providers/src/videasy/direct.ts` — swap the two call sites
- `packages/providers/test/` — parity test + fixtures
- `packages/providers/package.json`, root `package.json` catalog, `bun.lock`
- `.docs/providers.md` — record the EVP_BytesToKey port (ani-cli parity conventions live there)

**Out of scope:**
- The WASM decode path itself (`loadWasmExports` stays).
- VidLink/AllManga crypto — different schemes entirely.
- Any `crypto-js` import anywhere else — verify none exist first (`grep -rn "crypto-js" --include="*.ts" apps/ packages/` should show only the two videasy sites).

## Pre-flight (do this, then decide)

Per issue #106: the lanes are gated behind a Turnstile-derived session token
that can't be minted automatically. Confirm the guarded/Vidking lanes are
still live code worth keeping — check `git log --oneline -5 -- packages/providers/src/videasy/`
and `.docs/provider-dossiers/` for a demotion decision. If demoted: close this
plan as unneeded and drop the dependency with the lane instead.

## Steps

### Step 1: Capture parity fixtures BEFORE touching anything

Write a throwaway script (do not commit) that runs the *current* crypto-js
path over a fixed input set and records outputs:

- `CryptoJS.AES.encrypt(knownPlaintext, "g:test-token-123")` → base64
  ciphertext with `Salted__` header — this is what the decrypt path must
  reverse.
- Same with `""` passphrase (the vidking edge).
- Also record `CryptoJS.AES.decrypt` output of a real captured `v2:` payload if
  one exists in test fixtures — check `packages/providers/test/` for videasy
  fixture data first.

Commit the *fixtures* (input + expected plaintext) into the test file —
extracted constants, not a crypto-js runtime dep.

### Step 2: Implement `evpBytesToKey` + `aesDecryptCryptoJs`

In `openssl-compat.ts`, using `node:crypto` only:

```
salted payload  = "Salted__" || salt(8) || ciphertext
key+IV          = EVP_BytesToKey_md5(passphrase, salt, keyLen=32, ivLen=16)
                  D_i = MD5(D_{i-1} || passphrase || salt), concat until 48 bytes
decrypt         = createDecipheriv("aes-256-cbc", key, iv) over ciphertext
```

Details that bite: passphrase is the raw string bytes (UTF-8), not hex —
`CryptoJS.SHA256(...).toString()` produces a hex *string*, which is then used
as the passphrase (so `g:` + token is hashed to hex, and THAT hex string is
the passphrase fed to EVP_BytesToKey). Get this wrong and every decode fails.
No padding quirks: CryptoJS uses PKCS7, same as node default. Validate the
`Salted__` magic before reading the salt; throw a clear error otherwise.

### Step 3: Parity test

`packages/providers/test/videasy-openssl-compat.test.ts` (model after
`vidrock-crypto.test.ts`): assert byte-for-byte `decrypt(encrypt(x, pass)) == x`
using the Step-1 fixture ciphertexts, including the empty-passphrase case and
a no-`Salted__` rejection case.

**Verify:** `bun run --cwd packages/providers test` → new parity tests pass.

### Step 4: Swap call sites + drop the dep

Replace both `import("crypto-js")` blocks with the new module. Then remove
`crypto-js`/`@types/crypto-js` from `packages/providers/package.json` and the
root catalog, `bun install` to regenerate `bun.lock`.

**Verify:** `bun run --cwd packages/providers test`, `bun run typecheck --force`,
`bun audit` (crypto-js absent), `bun run test --force`.

### Step 5: Docs + changeset

`.docs/providers.md` — note the EVP_BytesToKey port and that it replaces
crypto-js passphrase mode byte-exactly (the parity convention this repo
requires for provider crypto). Changeset: patch.

## Test plan

- Parity fixtures from Step 1 are the test — byte-exact decrypt of
  crypto-js-produced ciphertext, both passphrases.
- Edge: malformed payload (no `Salted__`, truncated salt) → clean throw.
- Pattern: `vidrock-crypto.test.ts`.

## Done criteria

- [ ] `grep -rn "crypto-js" packages/ apps/` → no source matches
- [ ] Parity test passes on recorded fixtures including empty-passphrase
- [ ] `bun.lock` no longer resolves crypto-js; `bun run test --force` green
- [ ] `.docs/providers.md` records the port

## STOP conditions

- A third crypto-js call site exists that audit missed — re-scope, don't
  half-remove.
- Fixtures can't be captured because no working crypto-js environment remains
  (e.g. dep already yanked) — report; the EVP_BytesToKey spec is public, but
  parity confidence drops to spec-derived vectors.
- The guarded lanes are demoted mid-work — re-check Pre-flight and stop.

## Maintenance notes

- If mkissa/vidking rotate their crypto again, the parity-fixture workflow
  here (capture → port → pin) is the template — same as the AllManga drift
  smoke approach.
- Reviewer: the passphrase-vs-key distinction is the trap — check the test
  proves string-passphrase mode, not raw-key mode.
