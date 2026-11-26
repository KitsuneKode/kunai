import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import type { KunaiPaths } from "@kunai/storage";
import { isJsonNumber, isJsonObject, isJsonString, type JsonObject } from "@kunai/types";

import { writeAtomicSecretJson } from "../../infra/fs/atomic-write";

export interface AniListTokens {
  readonly accessToken: string;
  readonly userId: number;
  readonly expiresAt?: string;
}

export interface TmdbTokens {
  readonly sessionId: string;
  /** Numeric v3 account id. Account-scoped writes address this, not the name. */
  readonly accountId?: string;
  /** Display handle, kept apart so it can never be used to build a request path. */
  readonly username?: string;
}

export interface SyncTokens {
  readonly anilist?: AniListTokens;
  readonly tmdb?: TmdbTokens;
}

const TRACKER_SLOTS = ["anilist", "tmdb"] as const;

const isOptionalString = <T>(value: T) => value === undefined || isJsonString(value);

function isAniListTokens<T>(value: T): value is T & AniListTokens {
  return (
    isJsonObject(value) &&
    isJsonString(value.accessToken) &&
    value.accessToken.trim().length > 0 &&
    isJsonNumber(value.userId) &&
    Number.isSafeInteger(value.userId) &&
    value.userId > 0 &&
    isOptionalString(value.expiresAt)
  );
}

function isTmdbTokens<T>(value: T): value is T & TmdbTokens {
  return (
    isJsonObject(value) &&
    isJsonString(value.sessionId) &&
    value.sessionId.trim().length > 0 &&
    isOptionalString(value.accountId) &&
    isOptionalString(value.username)
  );
}

/**
 * The tracker records in a stored document that pass their shape check. Each
 * record is judged on its own: an invalid one reads as absent (that tracker
 * shows disconnected) without taking the other tracker down with it.
 */
export function validSyncTokens(document: JsonObject): SyncTokens {
  return {
    ...(isAniListTokens(document.anilist) && { anilist: document.anilist }),
    ...(isTmdbTokens(document.tmdb) && { tmdb: document.tmdb }),
  };
}

/** Refuse to store a malformed record. The message never carries credential bytes. */
export function assertStorableSyncTokens(tokens: SyncTokens): void {
  if (tokens.anilist !== undefined && !isAniListTokens(tokens.anilist)) {
    throw new Error("Refusing to store an invalid AniList credential record");
  }
  if (tokens.tmdb !== undefined && !isTmdbTokens(tokens.tmdb)) {
    throw new Error("Refusing to store an invalid TMDB credential record");
  }
}

/** The stored JSON object, or `undefined` if the text is not one. Never rethrows parse text. */
export function parseSyncTokenDocument(raw: string): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isJsonObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `document` with each tracker slot named in `patch` replaced or removed, and
 * everything else — the other tracker, an invalid record, fields a newer build
 * wrote — carried over untouched.
 */
function patchSyncTokenDocument(document: JsonObject, patch: SyncTokens) {
  const touched = (key: string) =>
    TRACKER_SLOTS.some((slot) => slot === key && Object.hasOwn(patch, slot));
  const kept = Object.entries(document).filter(([key]) => !touched(key));
  const written = TRACKER_SLOTS.flatMap((slot) => {
    const value = patch[slot];
    return Object.hasOwn(patch, slot) && value !== undefined ? [[slot, value] as const] : [];
  });
  return Object.fromEntries([...kept, ...written]);
}

/**
 * File seam for the token store: reading the whole token file and replacing it.
 *
 * Production reads `sync-tokens.json` and rewrites it atomically with
 * owner-only permissions. Tests substitute a controllable in-memory
 * implementation so mutation interleavings are forced rather than raced.
 */
export interface SyncTokenFileIo {
  /**
   * Persisted valid tracker records; `{}` only when the file is absent. Any
   * other read fault rejects, so no mutation proceeds from an invented empty
   * snapshot.
   */
  readonly readTokens: (path: string) => Promise<SyncTokens>;
  /** Replace the whole file with `tokens`. */
  readonly writeTokens: (path: string, tokens: SyncTokens) => Promise<void>;
  /** Optional independently stored tracker slots; omitted keys remain untouched. */
  readonly patchTokens?: (path: string, patch: SyncTokens) => Promise<void>;
}

/**
 * The stored document. Absent (ENOENT) is the only "no tokens"; a read fault
 * (EACCES, EISDIR, EIO) rejects and nothing is moved. Text that is not a JSON
 * object holds no recoverable record, so it is quarantined beside the file
 * (`<path>.corrupt-<ts>.json`, same owner-only directory) before an empty
 * document is returned — and if the move fails, this rejects rather than let a
 * write replace those bytes.
 */
async function readSyncTokenDocument(path: string): Promise<JsonObject> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isJsonObject(error) && error.code === "ENOENT") return {};
    throw error;
  }
  const document = parseSyncTokenDocument(raw);
  if (document) return document;
  await rename(path, `${path}.corrupt-${Date.now()}.json`);
  return {};
}

export const realSyncTokenFileIo: SyncTokenFileIo = {
  async readTokens(path: string): Promise<SyncTokens> {
    return validSyncTokens(await readSyncTokenDocument(path));
  },
  writeTokens(path: string, tokens: SyncTokens): Promise<void> {
    assertStorableSyncTokens(tokens);
    return writeAtomicSecretJson(path, tokens);
  },
  async patchTokens(path: string, patch: SyncTokens): Promise<void> {
    assertStorableSyncTokens(patch);
    const document = await readSyncTokenDocument(path);
    await writeAtomicSecretJson(path, patchSyncTokenDocument(document, patch));
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
  /** The read in flight, and the queue tail it waited on (see `load`). */
  private sharedLoad: { readonly after: Promise<void>; readonly read: Promise<SyncTokens> } | null =
    null;

  constructor(paths: KunaiPaths, io: SyncTokenFileIo = realSyncTokenFileIo) {
    this.path = join(paths.configDir, "sync-tokens.json");
    this.io = io;
  }

  /**
   * Persisted tokens, read once every mutation queued before this call has
   * settled. Concurrent loads with no mutation queued between them share one
   * read: both trackers load at startup, and on a credential vault each read
   * is a subprocess per tracker entry (4 spawns where 2 do).
   */
  load(): Promise<SyncTokens> {
    const after = this.mutationChain;
    if (this.sharedLoad?.after === after) return this.sharedLoad.read;
    const read = after.then(() => this.io.readTokens(this.path));
    const shared = { after, read };
    this.sharedLoad = shared;
    const release = () => {
      if (this.sharedLoad === shared) this.sharedLoad = null;
    };
    read.then(release, release);
    return read;
  }

  /** Replace the whole token file, ordered against concurrent patches. */
  save(tokens: SyncTokens): Promise<void> {
    return this.mutate(() => tokens);
  }

  clear(): Promise<void> {
    return this.mutate(() => ({}));
  }

  patchAniList(data: AniListTokens | undefined): Promise<void> {
    return this.mutate((current) => ({ ...current, anilist: data }), { anilist: data });
  }

  patchTmdb(data: TmdbTokens | undefined): Promise<void> {
    return this.mutate((current) => ({ ...current, tmdb: data }), { tmdb: data });
  }

  /** Resolves once the mutations queued so far have settled, failures included. */
  whenIdle(): Promise<void> {
    return this.mutationChain;
  }

  private mutate(update: (current: SyncTokens) => SyncTokens, patch?: SyncTokens): Promise<void> {
    const operation = this.applyAfter(this.mutationChain, update, patch);
    // The caller still sees the rejection; the queue keeps a settled handle so
    // one failed write cannot wedge every later mutation.
    this.mutationChain = operation.catch(() => undefined);
    return operation;
  }

  private async applyAfter(
    previous: Promise<void>,
    update: (current: SyncTokens) => SyncTokens,
    patch?: SyncTokens,
  ): Promise<void> {
    await previous;
    if (patch && this.io.patchTokens) {
      await this.io.patchTokens(this.path, patch);
      return;
    }
    // Re-read inside this turn: an earlier mutation in the chain may have
    // changed the other tracker's slot since this call was made.
    const current = await this.io.readTokens(this.path);
    await this.io.writeTokens(this.path, update(current));
  }
}
