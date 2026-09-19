import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import type { CredentialSpawn, CredentialVaultPort } from "@/services/persistence/credential-vault";
import { CREDENTIAL_KEYS } from "@/services/persistence/credential-vault";
import { createCredentialVault } from "@/services/persistence/credential-vault-backends";
import {
  migrateSyncTokensToVault,
  vaultSyncTokenFileIo,
} from "@/services/persistence/credential-vault-io";
import { SyncTokenStore, type SyncTokens } from "@/services/persistence/SyncTokenStore";

/** In-memory vault with optional failure scripting. */
function fakeVault(overrides: Partial<CredentialVaultPort> = {}): CredentialVaultPort & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    backend: "secret-service",
    store,
    get: async (key) => store.get(key),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    ...overrides,
  };
}

function fakePaths(configDir: string) {
  return { configDir } as never;
}

describe("vault-backed SyncTokenFileIo", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vault-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("stores each tracker as one vault blob; SyncTokenStore stays blind to it", async () => {
    const vault = fakeVault();
    const store = new SyncTokenStore(fakePaths(dir), vaultSyncTokenFileIo(vault));

    await store.patchAniList({ accessToken: "ani-tok", userId: 42 });
    await store.patchTmdb({ sessionId: "tmdb-sess", accountId: "7", username: "kit" });

    const loaded = await store.load();
    expect(loaded.anilist?.accessToken).toBe("ani-tok");
    expect(loaded.tmdb?.sessionId).toBe("tmdb-sess");
    // Vault holds JSON blobs, never plaintext fields
    expect(JSON.parse(vault.store.get(CREDENTIAL_KEYS.anilistTokens)!)).toEqual({
      accessToken: "ani-tok",
      userId: 42,
    });
    // And no sync-tokens.json exists on disk at all
    await expect(readFile(join(dir, "sync-tokens.json"), "utf8")).rejects.toThrow();
  });

  test("patch(undefined) deletes the vault entry; clear() deletes both", async () => {
    const vault = fakeVault();
    const store = new SyncTokenStore(fakePaths(dir), vaultSyncTokenFileIo(vault));

    await store.patchAniList({ accessToken: "a", userId: 1 });
    await store.patchTmdb({ sessionId: "b" });
    await store.patchAniList(undefined);
    expect(await store.load()).toEqual({ tmdb: { sessionId: "b" } });
    expect(vault.store.has(CREDENTIAL_KEYS.anilistTokens)).toBe(false);

    await store.clear();
    expect(vault.store.size).toBe(0);
  });
});

describe("migrateSyncTokensToVault", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vault-mig-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const file = (d: string) => join(d, "sync-tokens.json");
  const plaintext: SyncTokens = {
    anilist: { accessToken: "ani-secret", userId: 9 },
    tmdb: { sessionId: "tmdb-secret" },
  };

  test("write → verify → delete: file removed only after vault round-trip", async () => {
    await writeFile(file(dir), JSON.stringify(plaintext));
    const order: string[] = [];
    const vault = fakeVault({
      set: async (k, v) => {
        order.push(`set:${k}`);
        vault.store.set(k, v);
      },
      get: async (k) => {
        order.push(`get:${k}`);
        return vault.store.get(k);
      },
    });

    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault });

    // every set is verified by a get before the file disappears
    expect(order).toEqual([
      `set:${CREDENTIAL_KEYS.anilistTokens}`,
      `get:${CREDENTIAL_KEYS.anilistTokens}`,
      `set:${CREDENTIAL_KEYS.tmdbTokens}`,
      `get:${CREDENTIAL_KEYS.tmdbTokens}`,
    ]);
    await expect(readFile(file(dir), "utf8")).rejects.toThrow();
    expect(JSON.parse(vault.store.get(CREDENTIAL_KEYS.anilistTokens)!)).toEqual(plaintext.anilist);
  });

  test("read-back mismatch keeps the plaintext (never write→delete)", async () => {
    await writeFile(file(dir), JSON.stringify(plaintext));
    const vault = fakeVault({
      // set lies: what lands isn't what was sent
      set: async (k, v) => {
        vault.store.set(k, `${v}-corrupted`);
      },
    });

    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault });

    const remaining = JSON.parse(await readFile(file(dir), "utf8"));
    expect(remaining.anilist).toEqual(plaintext.anilist);
    expect(remaining.tmdb).toEqual(plaintext.tmdb);
  });

  test("interrupted migration is resumable and idempotent", async () => {
    await writeFile(file(dir), JSON.stringify(plaintext));
    const vault = fakeVault({
      set: async (k, v) => {
        if (k === CREDENTIAL_KEYS.tmdbTokens) throw new Error("vault hiccup");
        vault.store.set(k, v);
      },
    });

    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault });
    // anilist migrated, tmdb kept in the file
    const remaining = JSON.parse(await readFile(file(dir), "utf8")) as SyncTokens;
    expect(remaining.anilist).toBeUndefined();
    expect(remaining.tmdb).toEqual(plaintext.tmdb);

    // Second run with a healthy vault finishes the job — idempotent.
    const healthy = fakeVault();
    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault: healthy });
    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault: healthy });
    await expect(readFile(file(dir), "utf8")).rejects.toThrow();
    expect(JSON.parse(healthy.store.get(CREDENTIAL_KEYS.tmdbTokens)!)).toEqual(plaintext.tmdb);
  });

  test("no-op when the file is absent", async () => {
    const vault = fakeVault();
    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault });
    expect(vault.store.size).toBe(0);
  });

  test("file backend skips migration entirely", async () => {
    await writeFile(file(dir), JSON.stringify(plaintext));
    const vault = fakeVault({ backend: "file" });
    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault });
    expect(JSON.parse(await readFile(file(dir), "utf8"))).toEqual(plaintext);
  });
});

describe("createCredentialVault backend selection", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vault-sel-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("env override file → file backend, no probe spawn", async () => {
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: "file" },
      which: () => null,
      spawn: (() => {
        throw new Error("should never spawn");
      }) as CredentialSpawn,
    });
    expect(vault.backend).toBe("file");
  });

  test("headless Linux without secret-tool falls back to file with a notice", async () => {
    const fallbacks: string[] = [];
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      platform: "linux",
      env: {},
      which: () => null,
      onFallback: (backend, reason) => fallbacks.push(`${backend}:${reason}`),
    });
    expect(vault.backend).toBe("file");
    expect(fallbacks[0]).toContain("secret-service");
  });

  test("file backend round-trips through an owner-only file", async () => {
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: "file" },
    });
    await vault.set("k", "secret-value");
    expect(await vault.get("k")).toBe("secret-value");
    const onDisk = JSON.parse(await readFile(join(dir, "secrets.json"), "utf8"));
    expect(onDisk.k).toBe("secret-value");
    await vault.delete("k");
    expect(await vault.get("k")).toBeUndefined();
  });

  test("secret-service backend is picked when secret-tool answers", async () => {
    const spawned: string[][] = [];
    const spawn: CredentialSpawn = async (argv) => {
      spawned.push([...argv]);
      return { exitCode: 1, stdout: "", stderr: "" }; // lookup miss still proves the daemon answered
    };
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      platform: "linux",
      env: {},
      which: (cmd) => (cmd === "secret-tool" ? "/usr/bin/secret-tool" : null),
      spawn,
    });
    expect(vault.backend).toBe("secret-service");
    expect(spawned[0]).toEqual(["secret-tool", "lookup", "service", "kunai", "key", "__probe__"]);
  });
});

describe("ConfigService vault lane (#179)", () => {
  function captureStore(initial: Record<string, unknown>) {
    const written: Array<Record<string, unknown>> = [];
    const store = {
      written,
      load: async () => ({ ...DEFAULT_CONFIG, ...initial }),
      save: async (config: Record<string, unknown>) => {
        written.push(config);
      },
      reset: async () => {},
    };
    return store as never as { written: typeof written } & ConstructorParameters<
      typeof ConfigServiceImpl
    >[0];
  }

  test("plaintext videasySessionToken migrates to the vault and leaves config.json", async () => {
    const vault = fakeVault();
    const store = captureStore({ videasySessionToken: "session-secret-1234" });
    const service = await ConfigServiceImpl.load(store, vault);

    // In-memory config keeps serving the token — consumers are vault-blind.
    expect(service.videasySessionToken).toBe("session-secret-1234");
    // The persisted shape was scrubbed.
    expect(store.written.at(-1)?.videasySessionToken).toBe("");
    // And the vault holds it.
    expect(vault.store.get(CREDENTIAL_KEYS.videasySessionToken)).toBe("session-secret-1234");
  });

  test("save() scrubs the token from disk but keeps it in memory", async () => {
    const vault = fakeVault();
    const store = captureStore({});
    const service = await ConfigServiceImpl.load(store, vault);
    await service.update({ videasySessionToken: "fresh-token-9999" } as never);
    await service.save();

    expect(service.videasySessionToken).toBe("fresh-token-9999");
    expect(store.written.at(-1)?.videasySessionToken).toBe("");
    expect(vault.store.get(CREDENTIAL_KEYS.videasySessionToken)).toBe("fresh-token-9999");
  });

  test("clearing the token deletes the vault entry", async () => {
    const vault = fakeVault();
    vault.store.set(CREDENTIAL_KEYS.videasySessionToken, "old-token");
    const store = captureStore({});
    const service = await ConfigServiceImpl.load(store, vault);
    expect(service.videasySessionToken).toBe("old-token"); // hydrated from vault

    await service.update({ videasySessionToken: "" } as never);
    await service.save();
    expect(vault.store.has(CREDENTIAL_KEYS.videasySessionToken)).toBe(false);
  });

  test("vault write failure falls back to plaintext rather than losing the value", async () => {
    const vault = fakeVault({
      set: async () => {
        throw new Error("keyring gone");
      },
    });
    const store = captureStore({ videasySessionToken: "keep-me" });
    const service = await ConfigServiceImpl.load(store, vault);
    await service.save();

    expect(service.videasySessionToken).toBe("keep-me");
    expect(store.written.at(-1)?.videasySessionToken).toBe("keep-me");
  });
});
