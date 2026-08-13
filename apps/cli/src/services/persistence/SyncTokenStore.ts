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

/**
 * File seam for the token store: reading the whole token file and replacing it.
 *
 * Production reads `sync-tokens.json` and rewrites it atomically with
 * owner-only permissions. Tests substitute a controllable in-memory
 * implementation so mutation interleavings are forced rather than raced.
 */
export interface SyncTokenFileIo {
  /** Persisted tokens, or `{}` when the file is absent or unreadable. */
  readonly readTokens: (path: string) => Promise<SyncTokens>;
  /** Replace the whole file with `tokens`. */
  readonly writeTokens: (path: string, tokens: SyncTokens) => Promise<void>;
}

export const realSyncTokenFileIo: SyncTokenFileIo = {
  async readTokens(path: string): Promise<SyncTokens> {
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as SyncTokens;
    } catch {
      return {};
    }
  },
  writeTokens(path: string, tokens: SyncTokens): Promise<void> {
    return writeAtomicSecretJson(path, tokens);
  },
};

/**
 * Reads and writes `sync-tokens.json`.
 *
 * Every mutation is serialized through one chain. Tracker connects arrive
 * independently -- connecting AniList and TMDB close together used to run two
 * unserialized read-modify-write cycles against the same snapshot, and the
 * later write erased the other tracker's credentials.
 */
export class SyncTokenStore {
  private readonly path: string;
  private readonly io: SyncTokenFileIo;
  /** Tail of the serialized mutation queue. Settled form only -- never rejects. */
  private mutationChain: Promise<void> = Promise.resolve();

  constructor(paths: KunaiPaths, io: SyncTokenFileIo = realSyncTokenFileIo) {
    this.path = join(paths.configDir, "sync-tokens.json");
    this.io = io;
  }

  /** Persisted tokens, read once every mutation queued before this call has settled. */
  async load(): Promise<SyncTokens> {
    await this.mutationChain;
    return this.io.readTokens(this.path);
  }

  /** Replace the whole token file, ordered against concurrent patches. */
  save(tokens: SyncTokens): Promise<void> {
    return this.mutate(() => tokens);
  }

  clear(): Promise<void> {
    return this.mutate(() => ({}));
  }

  patchAniList(data: AniListTokens | undefined): Promise<void> {
    return this.mutate((current) => ({ ...current, anilist: data }));
  }

  patchTmdb(data: TmdbTokens | undefined): Promise<void> {
    return this.mutate((current) => ({ ...current, tmdb: data }));
  }

  /** Resolves once the mutations queued so far have settled, failures included. */
  whenIdle(): Promise<void> {
    return this.mutationChain;
  }

  private mutate(update: (current: SyncTokens) => SyncTokens): Promise<void> {
    const operation = this.applyAfter(this.mutationChain, update);
    // The caller still sees the rejection; the queue keeps a settled handle so
    // one failed write cannot wedge every later mutation.
    this.mutationChain = operation.catch(() => undefined);
    return operation;
  }

  private async applyAfter(
    previous: Promise<void>,
    update: (current: SyncTokens) => SyncTokens,
  ): Promise<void> {
    await previous;
    // Re-read inside this turn: an earlier mutation in the chain may have
    // changed the other tracker's slot since this call was made.
    const current = await this.io.readTokens(this.path);
    await this.io.writeTokens(this.path, update(current));
  }
}
