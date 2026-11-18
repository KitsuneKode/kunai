import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { KunaiPaths } from "@kunai/storage";

import { dbg } from "../../logger";
import {
  CREDENTIAL_KEYS,
  type CredentialStoreStatus,
  type CredentialVaultPort,
} from "./credential-vault";
import { realSyncTokenFileIo, type SyncTokenFileIo, type SyncTokens } from "./SyncTokenStore";

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
  readonly tokenStoreFaultReason?: string;
}): CredentialStoreStatus {
  const { vault, migration, vaultFallbackReason, tokenStoreFaultReason } = input;
  const tokenStore =
    tokenStoreFaultReason || !shouldUseVaultTokenStore(vault, migration)
      ? "sync-tokens.json"
      : "vault";
  let reason: string | undefined;
  if (vault.backend === "file") {
    reason = vaultFallbackReason;
  } else if (tokenStoreFaultReason) {
    reason = tokenStoreFaultReason;
  } else if (migration === "pending") {
    reason = "vault migration pending";
  }
  return { vaultBackend: vault.backend, tokenStore, reason };
}

type VaultTokenTombstones = Partial<Record<"anilist" | "tmdb", true>>;

type SyncTokensOnDisk = SyncTokens & { readonly _vaultTombstones?: VaultTokenTombstones };

function stripSyncTokenFileMeta(raw: SyncTokensOnDisk): SyncTokens {
  const { _vaultTombstones: _omit, ...tokens } = raw;
  return tokens;
}

function mergeSyncTokenPatch(current: SyncTokens, patch: SyncTokens): SyncTokens {
  const anilist = Object.hasOwn(patch, "anilist") ? patch.anilist : current.anilist;
  const tmdb = Object.hasOwn(patch, "tmdb") ? patch.tmdb : current.tmdb;
  if (anilist !== undefined && tmdb !== undefined) return { anilist, tmdb };
  if (anilist !== undefined) return { anilist };
  if (tmdb !== undefined) return { tmdb };
  return {};
}

async function readSyncTokensOnDisk(path: string): Promise<SyncTokensOnDisk> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SyncTokensOnDisk;
  } catch {
    return {};
  }
}

/** Merge a tracker patch into `sync-tokens.json`, recording vault tombstones on disconnect. */
async function patchSyncTokenFile(path: string, patch: SyncTokens): Promise<void> {
  const onDisk = await readSyncTokensOnDisk(path);
  const tombstones = { ...onDisk._vaultTombstones } satisfies VaultTokenTombstones;
  const merged = mergeSyncTokenPatch(stripSyncTokenFileMeta(onDisk), patch);
  for (const slot of ["anilist", "tmdb"] as const) {
    if (!Object.hasOwn(patch, slot)) continue;
    if (patch[slot] === undefined) tombstones[slot] = true;
    else delete tombstones[slot];
  }
  const next: SyncTokensOnDisk =
    Object.keys(tombstones).length > 0 ? { ...merged, _vaultTombstones: tombstones } : merged;
  await realSyncTokenFileIo.writeTokens(path, next);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- vault faults arrive as thrown values of any shape; stringified at the degradation boundary.
function formatVaultFault(error: unknown, backend: CredentialVaultPort["backend"]): string {
  const detail = error instanceof Error ? error.message : String(error);
  const lane =
    backend === "secret-service"
      ? "keyring"
      : backend === "keychain"
        ? "Keychain"
        : backend === "wincred"
          ? "Credential Manager"
          : "vault";
  return `${lane} write failed: ${detail}`;
}

/**
 * Vault-backed tracker tokens with a session-local fallback to
 * `sync-tokens.json` when native get/set/delete faults after boot.
 */
export function vaultSyncTokenFileIoWithFileFallback(
  paths: KunaiPaths,
  vault: CredentialVaultPort,
  onDegrade: (reason: string) => void,
): SyncTokenFileIo {
  const vaultIo = vaultSyncTokenFileIo(vault);
  const tokenPath = join(paths.configDir, "sync-tokens.json");
  let useFile = false;

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- native vault methods throw opaque platform errors; narrowed when surfacing status.
  const degrade = async (error: unknown, tokens?: SyncTokens) => {
    if (useFile) return;
    useFile = true;
    onDegrade(formatVaultFault(error, vault.backend));
    dbg("credential-vault", "tracker token store degraded to sync-tokens.json", {
      backend: vault.backend,
      error,
    });
    if (tokens !== undefined) {
      await realSyncTokenFileIo.writeTokens(tokenPath, tokens).catch(() => {});
    }
  };

  return {
    async readTokens(path: string) {
      if (useFile) return realSyncTokenFileIo.readTokens(path);
      try {
        return await vaultIo.readTokens(path);
      } catch (error) {
        await degrade(error);
        try {
          return await realSyncTokenFileIo.readTokens(path);
        } catch {
          return {};
        }
      }
    },
    async writeTokens(path: string, tokens: SyncTokens) {
      if (useFile) return realSyncTokenFileIo.writeTokens(path, tokens);
      try {
        await vaultIo.writeTokens(path, tokens);
      } catch (error) {
        await degrade(error, tokens);
        await realSyncTokenFileIo.writeTokens(path, tokens);
      }
    },
    async patchTokens(path: string, patch: SyncTokens) {
      if (useFile) {
        await patchSyncTokenFile(path, patch);
        return;
      }
      const vaultPatch = vaultIo.patchTokens;
      if (vaultPatch === undefined) {
        await patchSyncTokenFile(path, patch);
        return;
      }
      try {
        await vaultPatch(path, patch);
      } catch (error) {
        let current: SyncTokens = {};
        try {
          current = await vaultIo.readTokens(path);
        } catch {
          try {
            current = await realSyncTokenFileIo.readTokens(path);
          } catch {
            /* empty */
          }
        }
        const merged = mergeSyncTokenPatch(current, patch);
        await degrade(error, merged);
        await patchSyncTokenFile(path, patch);
      }
    },
  };
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
  let onDisk: SyncTokensOnDisk;
  try {
    onDisk = JSON.parse(await readFile(file, "utf8")) as SyncTokensOnDisk;
  } catch {
    return "complete"; // absent or unreadable — nothing to migrate
  }

  const tombstones = { ...onDisk._vaultTombstones } satisfies VaultTokenTombstones;
  const tombstonedSlots = new Set(
    (["anilist", "tmdb"] as const).filter((slot) => tombstones[slot]),
  );
  const tokens = stripSyncTokenFileMeta(onDisk);
  const hasTokens = Boolean(tokens.anilist || tokens.tmdb);
  const hasTombstones = tombstonedSlots.size > 0;
  if (!hasTokens && !hasTombstones) {
    await rm(file, { force: true }).catch(() => {});
    return "complete";
  }

  let pending = false;

  for (const [slot, key] of [
    ["anilist", CREDENTIAL_KEYS.anilistTokens],
    ["tmdb", CREDENTIAL_KEYS.tmdbTokens],
  ] as const) {
    if (!tombstones[slot]) continue;
    try {
      await options.vault.delete(key);
      delete tombstones[slot];
    } catch {
      dbg("credential-vault", `vault delete failed for ${key}; plaintext kept`);
      pending = true;
    }
  }

  for (const [slot, key] of [
    ["anilist", CREDENTIAL_KEYS.anilistTokens],
    ["tmdb", CREDENTIAL_KEYS.tmdbTokens],
  ] as const) {
    if (tombstonedSlots.has(slot)) continue;
    const value = tokens[slot];
    if (!value) continue;
    const blob = JSON.stringify(value);
    try {
      await options.vault.set(key, blob);
      if ((await options.vault.get(key)) !== blob) {
        dbg("credential-vault", `vault read-back mismatch for ${key}; plaintext kept`);
        pending = true;
      }
    } catch {
      dbg("credential-vault", `vault write failed for ${key}; plaintext kept`);
      pending = true;
    }
  }

  if (pending) return "pending";

  await rm(file, { force: true }).catch(() => {});
  return "complete";
}
