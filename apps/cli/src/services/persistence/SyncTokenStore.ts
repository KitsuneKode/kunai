import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { KunaiPaths } from "@kunai/storage";

import { writeAtomicSecretJson } from "../../infra/fs/atomic-write";

/**
 * Tracker credentials, stored outside `config.json` in a 0600 file.
 *
 * `username` is cached alongside the token so the sync UI can name the connected
 * account offline, instead of showing a bare account id until the first
 * successful network round-trip.
 */
export interface AniListTokens {
  readonly accessToken: string;
  readonly userId: number;
  readonly username?: string;
  /** ISO timestamp derived from the grant's `expires_in` (implicit grant: ~1 year). */
  readonly expiresAt?: string;
}

export interface TmdbTokens {
  readonly sessionId: string;
  readonly accountId?: number;
  readonly username?: string;
}

export interface SyncTokens {
  readonly anilist?: AniListTokens;
  readonly tmdb?: TmdbTokens;
}

/** Older builds stored `accountId` as the username string; normalize on read. */
function normalizeTmdb(raw: unknown): TmdbTokens | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : undefined;
  if (!sessionId) return undefined;

  const rawAccountId = record.accountId;
  const accountId =
    typeof rawAccountId === "number"
      ? rawAccountId
      : typeof rawAccountId === "string" && /^\d+$/.test(rawAccountId)
        ? Number.parseInt(rawAccountId, 10)
        : undefined;
  const username =
    typeof record.username === "string"
      ? record.username
      : typeof rawAccountId === "string" && !/^\d+$/.test(rawAccountId)
        ? rawAccountId
        : undefined;

  return {
    sessionId,
    ...(accountId !== undefined ? { accountId } : {}),
    ...(username ? { username } : {}),
  };
}

export class SyncTokenStore {
  private readonly path: string;

  constructor(paths: KunaiPaths) {
    this.path = join(paths.configDir, "sync-tokens.json");
  }

  async load(): Promise<SyncTokens> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as SyncTokens;
      const tmdb = normalizeTmdb(parsed.tmdb);
      return {
        ...(parsed.anilist ? { anilist: parsed.anilist } : {}),
        ...(tmdb ? { tmdb } : {}),
      };
    } catch {
      return {};
    }
  }

  async save(tokens: SyncTokens): Promise<void> {
    await writeAtomicSecretJson(this.path, tokens);
  }

  async clear(): Promise<void> {
    await writeAtomicSecretJson(this.path, {});
  }

  async patchAniList(data: AniListTokens | undefined): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, anilist: data });
  }

  async patchTmdb(data: TmdbTokens | undefined): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, tmdb: data });
  }
}
