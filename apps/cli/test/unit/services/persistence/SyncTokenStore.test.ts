import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SyncTokenStore,
  type AniListTokens,
  type SyncTokenFileIo,
  type SyncTokens,
  type TmdbTokens,
} from "@/services/persistence/SyncTokenStore";
import { getKunaiPaths, type KunaiPaths } from "@kunai/storage";

const ANILIST: AniListTokens = { accessToken: "anilist-access", userId: 7 };
const ANILIST_REFRESHED: AniListTokens = { accessToken: "anilist-rotated", userId: 7 };
const TMDB: TmdbTokens = { sessionId: "tmdb-session", accountId: "42" };

/**
 * Resolve after a fixed number of microtask turns. Every seam in these tests is
 * in-memory, so ordering is decided by the microtask queue alone: the
 * interleaving is forced on every run instead of raced against real IO.
 */
async function turns(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

interface Gate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

function createGate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** In-memory stand-in for `sync-tokens.json` with controllable write timing. */
class FakeTokenFile {
  /** Every value handed to the writer, in commit order. */
  readonly writes: SyncTokens[] = [];

  private contents: SyncTokens = {};
  private pendingFailure: string | undefined;
  private gate: Gate | undefined;

  readonly io: SyncTokenFileIo = {
    readTokens: async (): Promise<SyncTokens> => {
      await turns();
      return this.snapshot();
    },
    writeTokens: async (_path: string, tokens: SyncTokens): Promise<void> => {
      await turns();
      if (this.gate) {
        await this.gate.promise;
      }
      const failure = this.pendingFailure;
      if (failure !== undefined) {
        this.pendingFailure = undefined;
        throw new Error(failure);
      }
      // Round-trip through JSON so `undefined` members disappear exactly as
      // they do in the real file.
      this.contents = JSON.parse(JSON.stringify(tokens)) as SyncTokens;
      this.writes.push(this.contents);
    },
  };

  snapshot(): SyncTokens {
    return JSON.parse(JSON.stringify(this.contents)) as SyncTokens;
  }

  failNextWrite(message: string): void {
    this.pendingFailure = message;
  }

  blockWrites(): Gate {
    const gate = createGate();
    this.gate = gate;
    return {
      promise: gate.promise,
      release: () => {
        this.gate = undefined;
        gate.release();
      },
    };
  }
}

function fakePaths(): KunaiPaths {
  return getKunaiPaths({ platform: "linux", homeDir: "/fake-home", env: {} });
}

describe("SyncTokenStore mutation serialization", () => {
  test("concurrent AniList and TMDB connects both survive", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);

    await Promise.all([store.patchAniList(ANILIST), store.patchTmdb(TMDB)]);

    expect(await store.load()).toEqual({ anilist: ANILIST, tmdb: TMDB });
  });

  test("each mutation re-reads inside its own turn, so writes stack", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);

    await Promise.all([
      store.patchAniList(ANILIST),
      store.patchTmdb(TMDB),
      store.patchAniList(ANILIST_REFRESHED),
    ]);

    expect(file.writes).toEqual([
      { anilist: ANILIST },
      { anilist: ANILIST, tmdb: TMDB },
      { anilist: ANILIST_REFRESHED, tmdb: TMDB },
    ]);
    expect(await store.load()).toEqual({ anilist: ANILIST_REFRESHED, tmdb: TMDB });
  });

  test("a disconnect racing another tracker's connect removes only its own tokens", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);
    await store.save({ anilist: ANILIST });

    await Promise.all([store.patchAniList(undefined), store.patchTmdb(TMDB)]);

    expect(await store.load()).toEqual({ tmdb: TMDB });
  });

  test("clear queued after a patch wins, and a patch queued after clear survives", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);

    await Promise.all([store.patchAniList(ANILIST), store.clear()]);
    expect(await store.load()).toEqual({});

    await Promise.all([store.clear(), store.patchTmdb(TMDB)]);
    expect(await store.load()).toEqual({ tmdb: TMDB });
  });

  test("save is ordered against concurrent patches instead of interleaving", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);

    await Promise.all([store.save({ anilist: ANILIST }), store.patchTmdb(TMDB)]);

    expect(await store.load()).toEqual({ anilist: ANILIST, tmdb: TMDB });
  });

  test("load waits for a mutation that is still in flight", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);

    const pending = store.patchAniList(ANILIST);
    expect(await store.load()).toEqual({ anilist: ANILIST });

    await pending;
  });

  test("a failed write rejects its caller without wedging later mutations", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);
    file.failNextWrite("disk full");

    const failed = store.patchAniList(ANILIST);
    const queuedBehindTheFailure = store.patchTmdb(TMDB);

    await expect(failed).rejects.toThrow("disk full");
    await queuedBehindTheFailure;

    expect(await store.load()).toEqual({ tmdb: TMDB });
    expect(file.writes).toEqual([{ tmdb: TMDB }]);
  });

  test("whenIdle waits for queued mutations and survives a rejected one", async () => {
    const file = new FakeTokenFile();
    const store = new SyncTokenStore(fakePaths(), file.io);
    const gate = file.blockWrites();

    const queued = [store.patchAniList(ANILIST), store.patchTmdb(TMDB)];
    await turns(20);
    expect(file.snapshot()).toEqual({});

    gate.release();
    await store.whenIdle();
    expect(file.snapshot()).toEqual({ anilist: ANILIST, tmdb: TMDB });
    await Promise.all(queued);

    file.failNextWrite("boom");
    const doomed = store.patchAniList(ANILIST_REFRESHED);
    const idle = store.whenIdle();
    await expect(doomed).rejects.toThrow("boom");

    // whenIdle settles rather than rejecting, and the rejected mutation left
    // the previously persisted tokens untouched.
    await idle;
    expect(file.snapshot()).toEqual({ anilist: ANILIST, tmdb: TMDB });
  });
});

describe("SyncTokenStore on the real filesystem", () => {
  let home: string;
  let paths: KunaiPaths;
  let tokenPath: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kunai-sync-tokens-"));
    paths = getKunaiPaths({ platform: "linux", homeDir: home, env: {} });
    tokenPath = join(paths.configDir, "sync-tokens.json");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("concurrent patches both land in an owner-only token file", async () => {
    const store = new SyncTokenStore(paths);

    await Promise.all([store.patchAniList(ANILIST), store.patchTmdb(TMDB)]);

    expect(JSON.parse(await readFile(tokenPath, "utf8"))).toEqual({
      anilist: ANILIST,
      tmdb: TMDB,
    });
    if (process.platform !== "win32") {
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    }
  });

  test("clear empties the file and load reports no tokens", async () => {
    const store = new SyncTokenStore(paths);
    await store.save({ anilist: ANILIST, tmdb: TMDB });

    await store.clear();

    expect(await store.load()).toEqual({});
    expect(JSON.parse(await readFile(tokenPath, "utf8"))).toEqual({});
  });

  test("load returns empty tokens when the file is missing", async () => {
    const store = new SyncTokenStore(paths);

    expect(await store.load()).toEqual({});
  });
});
