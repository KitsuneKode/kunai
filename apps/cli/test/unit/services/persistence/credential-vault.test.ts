import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import type { CredentialSpawn, CredentialVaultPort } from "@/services/persistence/credential-vault";
import {
  CREDENTIAL_KEYS,
  CREDENTIAL_VAULT_PROBE_KEY,
} from "@/services/persistence/credential-vault";
import { createCredentialVault } from "@/services/persistence/credential-vault-backends";
import {
  migrateSyncTokensToVault,
  resolveCredentialStoreStatus,
  shouldUseVaultTokenStore,
  vaultSyncTokenFileIo,
  vaultSyncTokenFileIoWithFileFallback,
} from "@/services/persistence/credential-vault-io";
import {
  realSyncTokenFileIo,
  SyncTokenStore,
  type SyncTokens,
} from "@/services/persistence/SyncTokenStore";

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
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
  return { configDir } as never;
}

const spawnOk = { exitCode: 0, stdout: "", stderr: "", timedOut: false } as const;
const spawnNotFound = { exitCode: 1, stdout: "", stderr: "", timedOut: false } as const;

function argvTouchesProbe(argv: readonly string[]): boolean {
  return (
    argv.includes(CREDENTIAL_VAULT_PROBE_KEY) ||
    argv.some((part) => part.includes(CREDENTIAL_VAULT_PROBE_KEY))
  );
}

function assertBootProbeOnly(spawned: readonly (readonly string[])[]): void {
  const probeSpawns = spawned.filter((argv) => argvTouchesProbe(argv));
  expect(probeSpawns.length).toBe(1);
  for (const argv of probeSpawns) {
    expect(argv.includes("store")).toBe(false);
    expect(argv.includes("add-generic-password")).toBe(false);
    expect(argv.includes("clear")).toBe(false);
    expect(argv.includes("delete-generic-password")).toBe(false);
    expect(argv.some((part) => part.includes("Add(") || part.includes("$v.Add"))).toBe(false);
    expect(argv.some((part) => part.includes("Remove("))).toBe(false);
  }
}

function keychainProbeSpawn(onLive?: CredentialSpawn): CredentialSpawn {
  return async (argv, input, timeoutMs) => {
    if (!argvTouchesProbe(argv)) {
      return onLive ? onLive(argv, input, timeoutMs) : spawnNotFound;
    }
    if (argv.includes("find-generic-password")) {
      return { exitCode: 44, stdout: "", stderr: "could not be found", timedOut: false };
    }
    throw new Error(`unexpected probe mutation: ${argv.join(" ")}`);
  };
}

function wincredProbeSpawn(onLive?: CredentialSpawn): CredentialSpawn {
  return async (argv, input, timeoutMs) => {
    if (argvTouchesProbe(argv)) return spawnNotFound;
    return onLive ? onLive(argv, input, timeoutMs) : spawnNotFound;
  };
}

/** Scripted secret-tool read-only probe for backend selection tests. */
function secretServiceProbeSpawn(onLive?: CredentialSpawn): CredentialSpawn {
  return async (argv, input, timeoutMs) => {
    if (!argv.includes(CREDENTIAL_VAULT_PROBE_KEY)) {
      return onLive ? onLive(argv, input, timeoutMs) : spawnNotFound;
    }
    if (argv.includes("lookup")) return spawnNotFound;
    throw new Error(`unexpected probe mutation: ${argv.join(" ")}`);
  };
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

  test.each(["anilist", "tmdb"] as const)(
    "patching %s preserves malformed bytes in the other tracker",
    async (tracker) => {
      const vault = fakeVault();
      const otherKey =
        tracker === "anilist" ? CREDENTIAL_KEYS.tmdbTokens : CREDENTIAL_KEYS.anilistTokens;
      vault.store.set(otherKey, "{malformed-credential-fixture");
      const store = new SyncTokenStore(fakePaths(dir), vaultSyncTokenFileIo(vault));
      if (tracker === "anilist") await store.patchAniList({ accessToken: "fixture", userId: 1 });
      else await store.patchTmdb({ sessionId: "fixture" });
      expect(vault.store.get(otherKey)).toBe("{malformed-credential-fixture");
      if (tracker === "anilist") await store.patchAniList(undefined);
      else await store.patchTmdb(undefined);
      expect(vault.store.get(otherKey)).toBe("{malformed-credential-fixture");
      await store.clear();
      expect(vault.store.size).toBe(0);
    },
  );

  test("tracker patches do not read or rewrite an unrelated vault slot", async () => {
    const vault = fakeVault({
      get: async () => {
        throw new Error("unavailable read");
      },
    });
    vault.store.set(CREDENTIAL_KEYS.tmdbTokens, "unchanged-fixture-bytes");
    const store = new SyncTokenStore(fakePaths(dir), vaultSyncTokenFileIo(vault));
    await store.patchAniList({ accessToken: "fixture", userId: 1 });
    expect(vault.store.get(CREDENTIAL_KEYS.tmdbTokens)).toBe("unchanged-fixture-bytes");
    await store.patchAniList(undefined);
    expect(vault.store.has(CREDENTIAL_KEYS.anilistTokens)).toBe(false);
    expect(vault.store.get(CREDENTIAL_KEYS.tmdbTokens)).toBe("unchanged-fixture-bytes");
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
    anilist: { accessToken: "fixture-ani-access", userId: 9 },
    tmdb: { sessionId: "fixture-tmdb-session" },
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

    expect(await migrateSyncTokensToVault({ paths: fakePaths(dir), vault })).toBe("complete");

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
    expect(await migrateSyncTokensToVault({ paths: fakePaths(dir), vault })).toBe("skipped");
    expect(JSON.parse(await readFile(file(dir), "utf8"))).toEqual(plaintext);
  });

  test("a store failure returns pending and keeps shouldUseVaultTokenStore on the file lane", async () => {
    await writeFile(file(dir), JSON.stringify(plaintext));
    const vault = fakeVault({
      set: async (k) => {
        if (k === CREDENTIAL_KEYS.tmdbTokens) throw new Error("store exit 1");
        vault.store.set(k, "ok");
      },
    });
    expect(await migrateSyncTokensToVault({ paths: fakePaths(dir), vault })).toBe("pending");
    expect(shouldUseVaultTokenStore(vault, "pending")).toBe(false);
    expect(resolveCredentialStoreStatus({ vault, migration: "pending" }).tokenStore).toBe(
      "sync-tokens.json",
    );
  });

  test("secret-tool store exit 1 with dbus stderr is a vault fault", async () => {
    const vault = await (
      await createCredentialVault({
        paths: fakePaths(dir),
        platform: "linux",
        env: { KUNAI_CREDENTIAL_BACKEND: "secret-service" },
        which: () => "/usr/bin/secret-tool",
        spawn: secretServiceProbeSpawn(async () => ({
          exitCode: 1,
          stdout: "",
          stderr: "Cannot autolaunch D-Bus session without a $DISPLAY",
          timedOut: false,
        })),
      })
    ).vault;
    expect(vault.backend).toBe("secret-service");
    await expect(vault.get(CREDENTIAL_KEYS.anilistTokens)).rejects.toThrow(
      /secret-tool lookup failed/,
    );
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
    const { vault } = await createCredentialVault({
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
    const { vault, fallbackReason } = await createCredentialVault({
      paths: fakePaths(dir),
      platform: "linux",
      env: {},
      which: () => null,
      onFallback: (backend, reason) => fallbacks.push(`${backend}:${reason}`),
    });
    expect(vault.backend).toBe("file");
    expect(fallbacks[0]).toContain("secret-service");
    expect(fallbackReason).toContain("secret-service");
  });

  test("dbus fault on secret-tool lookup fails the probe and selects file fallback", async () => {
    const fallbacks: string[] = [];
    const spawned: string[][] = [];
    const { vault } = await createCredentialVault({
      paths: fakePaths(dir),
      platform: "linux",
      env: {},
      which: (cmd) => (cmd === "secret-tool" ? "/usr/bin/secret-tool" : null),
      spawn: async (argv) => {
        spawned.push([...argv]);
        return argv.includes("lookup") && argv.includes(CREDENTIAL_VAULT_PROBE_KEY)
          ? {
              exitCode: 1,
              stdout: "",
              stderr:
                "Cannot autolaunch D-Bus session without a $DISPLAY for the default D-Bus session bus",
              timedOut: false,
            }
          : spawnNotFound;
      },
      onFallback: (backend) => fallbacks.push(backend),
    });
    expect(vault.backend).toBe("file");
    expect(fallbacks).toEqual(["file"]);
    assertBootProbeOnly(spawned);
  });

  test("a probe killed at its deadline selects file fallback with a notice", async () => {
    const fallbacks: string[] = [];
    const { vault } = await createCredentialVault({
      paths: fakePaths(dir),
      platform: "linux",
      env: {},
      which: (cmd) => (cmd === "secret-tool" ? "/usr/bin/secret-tool" : null),
      spawn: async () => ({ exitCode: 143, stdout: "", stderr: "", timedOut: true }),
      onFallback: (backend) => fallbacks.push(backend),
    });
    expect(vault.backend).toBe("file");
    expect(fallbacks).toEqual(["file"]);
  });

  test("file backend is a marker — tracker tokens live in sync-tokens.json", async () => {
    const { vault } = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: "file" },
    });
    await expect(vault.set("k", "v")).rejects.toThrow(/sync-tokens\.json/);
    const store = new SyncTokenStore(fakePaths(dir), realSyncTokenFileIo);
    await store.patchAniList({ accessToken: "file-lane", userId: 1 });
    expect(await store.load()).toEqual({ anilist: { accessToken: "file-lane", userId: 1 } });
  });

  test("secret-service backend is picked when secret-tool answers the read-only probe", async () => {
    const spawned: string[][] = [];
    const { vault } = await createCredentialVault({
      paths: fakePaths(dir),
      platform: "linux",
      env: {},
      which: (cmd) => (cmd === "secret-tool" ? "/usr/bin/secret-tool" : null),
      spawn: async (argv, input, timeoutMs) => {
        spawned.push([...argv]);
        return secretServiceProbeSpawn()(argv, input, timeoutMs);
      },
    });
    expect(vault.backend).toBe("secret-service");
    assertBootProbeOnly(spawned);
    expect(spawned[0]).toEqual([
      "secret-tool",
      "lookup",
      "service",
      "kunai",
      "key",
      CREDENTIAL_VAULT_PROBE_KEY,
    ]);
  });

  test.each([
    ["linux", "secret-service", "secret-tool", secretServiceProbeSpawn],
    ["darwin", "keychain", "security", keychainProbeSpawn],
    ["win32", "wincred", "powershell", wincredProbeSpawn],
  ] as const)(
    "boot probe on %s performs one spawn and no vault writes",
    async (
      platform: "linux" | "darwin" | "win32",
      backend: "secret-service" | "keychain" | "wincred",
      cli: string,
      probeSpawn: typeof secretServiceProbeSpawn,
    ) => {
      const spawned: string[][] = [];
      const { vault } = await createCredentialVault({
        paths: fakePaths(dir),
        platform,
        env: { KUNAI_CREDENTIAL_BACKEND: backend },
        which: (cmd) => {
          if (cmd === cli) return `/usr/bin/${cli}`;
          if (platform === "win32" && (cmd === "powershell" || cmd === "powershell.exe"))
            return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
          return null;
        },
        spawn: async (argv, input, timeoutMs) => {
          spawned.push([...argv]);
          return probeSpawn()(argv, input, timeoutMs);
        },
      });
      expect(vault.backend).toBe(backend);
      assertBootProbeOnly(spawned);
    },
  );

  test("runtime vault set fault degrades to sync-tokens.json and keeps the token", async () => {
    const vault = fakeVault({
      set: async () => {
        throw new Error("store exit 1");
      },
    });
    let degradedReason: string | undefined;
    const status = resolveCredentialStoreStatus({ vault, migration: "complete" });
    const store = new SyncTokenStore(
      fakePaths(dir),
      vaultSyncTokenFileIoWithFileFallback(fakePaths(dir), vault, (reason: string) => {
        degradedReason = reason;
        Object.assign(status, { tokenStore: "sync-tokens.json", reason });
      }),
    );
    await store.patchAniList({ accessToken: "saved-anyway", userId: 1 });
    expect(await store.load()).toEqual({ anilist: { accessToken: "saved-anyway", userId: 1 } });
    expect(JSON.parse(await readFile(join(dir, "sync-tokens.json"), "utf8"))).toEqual({
      anilist: { accessToken: "saved-anyway", userId: 1 },
    });
    expect(degradedReason).toContain("keyring write failed");
    expect(status.tokenStore).toBe("sync-tokens.json");
  });
});

describe("vault read failures abort mutations", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vault-fail-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("a stalled vault get rejects, and the queued patch never deletes the other tracker", async () => {
    const spawn: CredentialSpawn = secretServiceProbeSpawn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "Cannot autolaunch D-Bus",
      timedOut: false,
    }));
    const { vault } = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: "secret-service" },
      which: () => "/usr/bin/secret-tool",
      spawn,
    });
    expect(vault.backend).toBe("secret-service");

    const deletes: string[] = [];
    const sets: string[] = [];
    const baseDelete = vault.delete.bind(vault);
    const baseSet = vault.set.bind(vault);
    vault.delete = async (key) => {
      deletes.push(key);
      return baseDelete(key);
    };
    vault.set = async (key, value) => {
      sets.push(key);
      return baseSet(key, value);
    };

    const io = vaultSyncTokenFileIo(vault);
    const store = new SyncTokenStore(fakePaths(dir), io);

    await expect(io.readTokens("ignored")).rejects.toThrow();
    await expect(store.patchAniList({ accessToken: "a", userId: 1 })).rejects.toThrow();
    // The targeted write fails too; it never deletes or rewrites tmdb.tokens.
    expect(deletes).toEqual([]);
    expect(sets).toEqual([CREDENTIAL_KEYS.anilistTokens]);
  });

  test.each([
    ["secret-service", "secret-tool", { exitCode: 1, stdout: "", stderr: "", timedOut: false }],
    ["keychain", "security", { exitCode: 44, stdout: "", stderr: "", timedOut: false }],
    [
      "keychain",
      "security",
      { exitCode: 1, stdout: "", stderr: "could not be found", timedOut: false },
    ],
    ["wincred", "powershell", { exitCode: 1, stdout: "", stderr: "", timedOut: false }],
  ] as const)(
    "%s reads its documented not-found exit as undefined",
    async (backend, cli, result) => {
      const spawn: CredentialSpawn =
        backend === "secret-service"
          ? secretServiceProbeSpawn(async () => result)
          : backend === "keychain"
            ? keychainProbeSpawn(async () => result)
            : wincredProbeSpawn(async () => result);
      const { vault } = await createCredentialVault({
        paths: fakePaths(dir),
        env: { KUNAI_CREDENTIAL_BACKEND: backend },
        which: () => `/usr/bin/${cli}`,
        spawn,
      });
      expect(vault.backend).toBe(backend);
      expect(await vault.get(CREDENTIAL_KEYS.anilistTokens)).toBeUndefined();
    },
  );

  test.each([
    [
      "secret-service",
      "secret-tool",
      { exitCode: 1, stdout: "", stderr: "Cannot autolaunch D-Bus", timedOut: false },
    ],
    [
      "keychain",
      "security",
      { exitCode: 1, stdout: "", stderr: "errSecAuthFailed", timedOut: false },
    ],
    ["wincred", "powershell", { exitCode: 3, stdout: "", stderr: "fault", timedOut: false }],
  ] as const)("%s throws on a non-not-found failure", async (backend, cli, result) => {
    const probeSpawn: CredentialSpawn =
      backend === "wincred"
        ? wincredProbeSpawn(async () => result)
        : backend === "secret-service"
          ? secretServiceProbeSpawn(async () => result)
          : keychainProbeSpawn(async () => result);
    const { vault } = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: backend },
      which: (cmd) =>
        cmd === "pwsh"
          ? null
          : cmd === "powershell"
            ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
            : `/usr/bin/${cli}`,
      spawn: probeSpawn,
    });
    expect(vault.backend).toBe(backend);
    await expect(vault.get(CREDENTIAL_KEYS.anilistTokens)).rejects.toThrow();
  });

  test("wincred uses Windows PowerShell 5.1 and loads WinRT before PasswordVault", async () => {
    const seen: string[][] = [];
    const spawn: CredentialSpawn = async (argv) => {
      seen.push([...argv]);
      return argvTouchesProbe(argv) ? spawnNotFound : spawnNotFound;
    };
    const { vault } = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: "wincred" },
      which: (cmd) =>
        cmd === "pwsh"
          ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
          : "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      spawn,
    });
    expect(vault.backend).toBe("wincred");
    await vault.get(CREDENTIAL_KEYS.anilistTokens);
    expect(seen.length).toBeGreaterThan(0);
    for (const argv of seen) {
      expect(argv[0]).toContain("powershell");
      expect(argv[0]).not.toContain("pwsh");
      expect(String(argv.at(-1))).toContain("ContentType=WindowsRuntime");
    }
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    return store as never as { written: typeof written } & ConstructorParameters<
      typeof ConfigServiceImpl
    >[0];
  }

  test("plaintext videasySessionToken migrates to the vault and leaves config.json", async () => {
    const vault = fakeVault();
    const store = captureStore({ videasySessionToken: "fixture-videasy-session-a" });
    const service = await ConfigServiceImpl.load(store, vault);

    // In-memory config keeps serving the token — consumers are vault-blind.
    expect(service.videasySessionToken).toBe("fixture-videasy-session-a");
    // The persisted shape was scrubbed.
    expect(store.written.at(-1)?.videasySessionToken).toBe("");
    // And the vault holds it.
    expect(vault.store.get(CREDENTIAL_KEYS.videasySessionToken)).toBe("fixture-videasy-session-a");
  });

  test("save() scrubs the token from disk but keeps it in memory", async () => {
    const vault = fakeVault();
    const store = captureStore({});
    const service = await ConfigServiceImpl.load(store, vault);
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    await service.update({ videasySessionToken: "fixture-videasy-session-b" } as never);
    await service.save();

    expect(service.videasySessionToken).toBe("fixture-videasy-session-b");
    expect(store.written.at(-1)?.videasySessionToken).toBe("");
    expect(vault.store.get(CREDENTIAL_KEYS.videasySessionToken)).toBe("fixture-videasy-session-b");
  });

  test("clearing the token deletes the vault entry", async () => {
    const vault = fakeVault();
    vault.store.set(CREDENTIAL_KEYS.videasySessionToken, "fixture-videasy-session-old");
    const store = captureStore({});
    const service = await ConfigServiceImpl.load(store, vault);
    expect(service.videasySessionToken).toBe("fixture-videasy-session-old"); // hydrated from vault

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
