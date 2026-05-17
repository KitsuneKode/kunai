import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { KunaiPaths } from "@kunai/storage";

import { writeAtomicSecretJson } from "../../infra/fs/atomic-write";

export interface AniListTokens {
  readonly accessToken: string;
  readonly userId: number;
  readonly expiresAt?: string;
}

export interface TmdbTokens {
  readonly sessionId: string;
  readonly accountId?: string;
}

export interface SyncTokens {
  readonly anilist?: AniListTokens;
  readonly tmdb?: TmdbTokens;
}

export class SyncTokenStore {
  private readonly path: string;

  constructor(paths: KunaiPaths) {
    this.path = join(paths.configDir, "sync-tokens.json");
  }

  async load(): Promise<SyncTokens> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as SyncTokens;
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
