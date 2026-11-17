import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { KunaiPaths } from "@kunai/storage";

import { dbg } from "../../logger";
import {
  CREDENTIAL_KEYS,
  type CredentialStoreStatus,
  type CredentialVaultPort,
} from "./credential-vault";
import type { SyncTokenFileIo, SyncTokens } from "./SyncTokenStore";

/**
 * `SyncTokenFileIo` over the credential vault: each tracker is one vault entry
 * holding its JSON blob (`anilist.tokens` / `tmdb.tokens`). `writeTokens`
 * replaces the whole set — absent tracker keys delete the vault entry, which
 * is what `patchX(undefined)` and `clear()` map to.
 */
export function vaultSyncTokenFileIo(vault: CredentialVaultPort): SyncTokenFileIo {
  return {
    async readTokens() {
      // A vault fault throws out of `get` — never read as "absent".
      // SyncTokenStore re-reads before every write, so propagating is what
      // stops a stalled daemon from erasing the other tracker's entry.
      const [anilist, tmdb] = await Promise.all([
        vault.get(CREDENTIAL_KEYS.anilistTokens),
        vault.get(CREDENTIAL_KEYS.tmdbTokens),
      ]);
      const tokens: { anilist?: unknown; tmdb?: unknown } = {};
      for (const [slot, raw] of [
        ["anilist", anilist],
        ["tmdb", tmdb],
      ] as const) {
        if (typeof raw !== "string" || !raw) continue;
        try {
          tokens[slot] = JSON.parse(raw);
        } catch {
          // A corrupted vault entry reads as absent — the tracker's reconnect
          // flow handles a missing token; a parse throw must not wedge boot.
        }
      }
      return tokens as SyncTokens;
    },
    async writeTokens(_path, tokens) {
      const jobs: Promise<void>[] = [];
      for (const [slot, key] of [
        ["anilist", CREDENTIAL_KEYS.anilistTokens],
        ["tmdb", CREDENTIAL_KEYS.tmdbTokens],
      ] as const) {
        const value = tokens[slot];
        jobs.push(value === undefined ? vault.delete(key) : vault.set(key, JSON.stringify(value)));
      }
      await Promise.all(jobs);
    },
    async patchTokens(_path, patch) {
      for (const [slot, key] of [
        ["anilist", CREDENTIAL_KEYS.anilistTokens],
        ["tmdb", CREDENTIAL_KEYS.tmdbTokens],
      ] as const) {
        if (!Object.hasOwn(patch, slot)) continue;
        const value = patch[slot];
        if (value === undefined) await vault.delete(key);
        else await vault.set(key, JSON.stringify(value));
      }
    },
  };
}

export type MigrateSyncTokensResult = "skipped" | "complete" | "pending";

export function shouldUseVaultTokenStore(
  vault: CredentialVaultPort,
  migration: MigrateSyncTokensResult,
): boolean {
  return vault.backend !== "file" && migration !== "pending";
}

export function resolveCredentialStoreStatus(input: {
  readonly vault: CredentialVaultPort;
  readonly migration: MigrateSyncTokensResult;
  readonly vaultFallbackReason?: string;
}): CredentialStoreStatus {
  const { vault, migration, vaultFallbackReason } = input;
  const tokenStore = shouldUseVaultTokenStore(vault, migration) ? "vault" : "sync-tokens.json";
  let reason: string | undefined;
  if (vault.backend === "file") {
    reason = vaultFallbackReason;
  } else if (migration === "pending") {
    reason = "vault migration pending";
  }
  return { vaultBackend: vault.backend, tokenStore, reason };
}

/**
 * Move the plaintext `sync-tokens.json` into the vault.
 *
 * Ordering is the contract: vault.set → vault.get → compare → only then remove
 * the plaintext. A crash after set-but-before-delete leaves both copies —
 * the next run re-verifies and finishes; nothing is ever write→delete.
 * Idempotent: absent or empty file is a no-op, leftover entries re-migrate.
 * On any vault failure the plaintext is kept and migration retries next launch.
 */
export async function migrateSyncTokensToVault(options: {
  readonly paths: KunaiPaths;
  readonly vault: CredentialVaultPort;
}): Promise<MigrateSyncTokensResult> {
  if (options.vault.backend === "file") return "skipped";
  const file = join(options.paths.configDir, "sync-tokens.json");
  let plaintext: SyncTokens;
  try {
    plaintext = JSON.parse(await readFile(file, "utf8")) as SyncTokens;
  } catch {
    return "complete"; // absent or unreadable — nothing to migrate
  }

  let migrated = false;
  let pending = false;
  for (const [slot, key] of [
    ["anilist", CREDENTIAL_KEYS.anilistTokens],
    ["tmdb", CREDENTIAL_KEYS.tmdbTokens],
  ] as const) {
    const value = plaintext[slot];
    if (!value) continue;
    const blob = JSON.stringify(value);
    try {
      await options.vault.set(key, blob);
      if ((await options.vault.get(key)) !== blob) {
        dbg("credential-vault", `vault read-back mismatch for ${key}; plaintext kept`);
        pending = true;
        continue;
      }
      // Only now may the plaintext go.
      delete (plaintext as Record<string, unknown>)[slot];
      migrated = true;
    } catch {
      dbg("credential-vault", `vault write failed for ${key}; plaintext kept`);
      pending = true;
    }
  }

  if (!migrated && !pending) return "complete";
  if (!migrated) return "pending";
  if (!plaintext.anilist && !plaintext.tmdb) {
    await rm(file, { force: true }).catch(() => {});
  } else {
    // Partial migration — rewrite the file with only what didn't move.
    const { writeAtomicSecretJson } = await import("../../infra/fs/atomic-write");
    await writeAtomicSecretJson(file, plaintext).catch(() => {});
  }
  return pending ? "pending" : "complete";
}
