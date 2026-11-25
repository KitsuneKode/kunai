import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import type { CredentialSpawn, CredentialVaultPort } from "@/services/persistence/credential-vault";
import { CREDENTIAL_KEYS } from "@/services/persistence/credential-vault";
import {
  createCredentialVault,
  noticeFileFallbackOnce,
} from "@/services/persistence/credential-vault-backends";
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
  // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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

  test("a vault record with the wrong shape reads as absent; the other tracker stays", async () => {
    const vault = fakeVault();
    vault.store.set(CREDENTIAL_KEYS.anilistTokens, JSON.stringify({ accessToken: 1 }));
    vault.store.set(CREDENTIAL_KEYS.tmdbTokens, JSON.stringify({ sessionId: "fixture-tmdb" }));
    const store = new SyncTokenStore(fakePaths(dir), vaultSyncTokenFileIo(vault));

    expect(await store.load()).toEqual({ tmdb: { sessionId: "fixture-tmdb" } });
  });

  test("a patch carrying an invalid record is refused and the vault is untouched", async () => {
    const vault = fakeVault();
    const store = new SyncTokenStore(fakePaths(dir), vaultSyncTokenFileIo(vault));

    await expect(store.patchTmdb({ sessionId: "" })).rejects.toThrow();

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

  test("an invalid plaintext record stays in the file; the valid one migrates", async () => {
    const broken = { accessToken: "", userId: 9 };
    await writeFile(file(dir), JSON.stringify({ anilist: broken, tmdb: plaintext.tmdb }));
    const vault = fakeVault();

    await migrateSyncTokensToVault({ paths: fakePaths(dir), vault });

    expect(vault.store.has(CREDENTIAL_KEYS.anilistTokens)).toBe(false);
    expect(JSON.parse(vault.store.get(CREDENTIAL_KEYS.tmdbTokens)!)).toEqual(plaintext.tmdb);
    expect(JSON.parse(await readFile(file(dir), "utf8"))).toEqual({ anilist: broken });
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

  test("a slow successful probe keeps native credentials instead of selecting an empty file store", async () => {
    const probe = Promise.withResolvers<Awaited<ReturnType<CredentialSpawn>>>();
    const scheduled: (() => void)[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    // Drive premature fallback timers without waiting on wall-clock time.
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      Object.assign(
        (...args: Parameters<typeof originalSetTimeout>) => {
          const [callback, , ...callbackArgs] = args;
          scheduled.push(() => callback(...callbackArgs));
          const timer = originalSetTimeout(...args);
          clearTimeout(timer);
          timers.push(timer);
          return timer;
        },
        { __promisify__: originalSetTimeout.__promisify__ },
      ),
    );
    const fallbacks: string[] = [];
    try {
      const selection = createCredentialVault({
        paths: fakePaths(dir),
        platform: "linux",
        env: {},
        which: (cmd) => (cmd === "secret-tool" ? "/usr/bin/secret-tool" : null),
        spawn: async (argv) =>
          argv.includes("__probe__")
            ? probe.promise
            : {
                exitCode: 0,
                stdout: "fixture-existing-native-secret",
                stderr: "",
                timedOut: false,
              },
        onFallback: (backend) => fallbacks.push(backend),
      });
      for (const run of scheduled) run();
      probe.resolve({ exitCode: 1, stdout: "", stderr: "", timedOut: false });
      const vault = await selection;
      expect(vault.backend).toBe("secret-service");
      expect(await vault.get(CREDENTIAL_KEYS.anilistTokens)).toBe("fixture-existing-native-secret");
      expect(fallbacks).toEqual([]);
    } finally {
      probe.resolve({ exitCode: 1, stdout: "", stderr: "", timedOut: false });
      timerSpy.mockRestore();
      for (const timer of timers) clearTimeout(timer);
    }
  });

  test("a probe killed at its deadline selects file fallback with a notice", async () => {
    const fallbacks: string[] = [];
    const vault = await createCredentialVault({
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

  test("file backend round-trips through an owner-only file", async () => {
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: "file" },
    });
    await vault.set("k", "fixture-vault-value");
    expect(await vault.get("k")).toBe("fixture-vault-value");
    const onDisk = JSON.parse(await readFile(join(dir, "secrets.json"), "utf8"));
    expect(onDisk.k).toBe("fixture-vault-value");
    await vault.delete("k");
    expect(await vault.get("k")).toBeUndefined();
  });

  test("secret-service backend is picked when secret-tool answers", async () => {
    const spawned: string[][] = [];
    const spawn: CredentialSpawn = async (argv) => {
      spawned.push([...argv]);
      // lookup miss still proves the daemon answered
      return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
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

describe("Windows file-fallback notice", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vault-notice-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("prints once per profile, not on every fallback startup", () => {
    const lines: string[] = [];
    const write = (line: string) => lines.push(line);
    const profile = join(dir, "profile-a");
    noticeFileFallbackOnce({ configDir: profile, platform: "win32", write });
    noticeFileFallbackOnce({ configDir: profile, platform: "win32", write });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("user-profile files");
    // A different profile has not seen it yet.
    noticeFileFallbackOnce({ configDir: join(dir, "profile-b"), platform: "win32", write });
    expect(lines).toHaveLength(2);
  });

  test("stays silent off Windows, where the fallback is a debug line", () => {
    const lines: string[] = [];
    noticeFileFallbackOnce({ configDir: dir, platform: "linux", write: (l) => lines.push(l) });
    expect(lines).toEqual([]);
  });
});

describe("secret-service delete reports what really happened", () => {
  function linuxVault(answer: (argv: readonly string[]) => Awaited<ReturnType<CredentialSpawn>>) {
    return createCredentialVault({
      paths: fakePaths("/nonexistent-kunai-test"),
      platform: "linux",
      env: {},
      which: (cmd) => (cmd === "secret-tool" ? "/usr/bin/secret-tool" : null),
      spawn: async (argv) =>
        argv.includes("__probe__")
          ? { exitCode: 1, stdout: "", stderr: "", timedOut: false }
          : answer(argv),
    });
  }

  test("an entry that was already absent deletes cleanly", async () => {
    const vault = await linuxVault(() => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
      timedOut: false,
    }));
    await expect(vault.delete("k")).resolves.toBeUndefined();
  });

  test("a timed-out clear is a failure, not a disconnect", async () => {
    const vault = await linuxVault((argv) =>
      argv[1] === "clear"
        ? { exitCode: 143, stdout: "", stderr: "", timedOut: true }
        : { exitCode: 0, stdout: "still-here", stderr: "", timedOut: false },
    );
    await expect(vault.delete("k")).rejects.toThrow("timed out");
  });

  test("exit 1 with an error message is a daemon fault, not an absent entry", async () => {
    const vault = await linuxVault(() => ({
      exitCode: 1,
      stdout: "",
      stderr: "Cannot autolaunch D-Bus without X11 $DISPLAY",
      timedOut: false,
    }));
    await expect(vault.delete("k")).rejects.toThrow("may still be stored");
    await expect(vault.get("k")).rejects.toThrow("secret-tool lookup failed");
  });

  test("a failed clear whose entry is still readable is reported", async () => {
    const vault = await linuxVault((argv) =>
      argv[1] === "clear"
        ? { exitCode: 2, stdout: "", stderr: "daemon fault", timedOut: false }
        : { exitCode: 0, stdout: "still-here", stderr: "", timedOut: false },
    );
    await expect(vault.delete("k")).rejects.toThrow("may still be stored");
  });
});

function probeReply(argv: readonly string[]) {
  const script = argv.at(-1) ?? "";
  if (!script.includes("'__probe__'")) return undefined;
  return {
    exitCode: 0,
    stdout: script.includes("RetrievePassword") ? "kunai-probe" : "",
    stderr: "",
    timedOut: false,
  };
}

describe("vault read failures abort mutations", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kunai-vault-fail-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const ok = { exitCode: 1, stdout: "", stderr: "", timedOut: false } as const;

  test("a stalled vault get rejects, and the queued patch never deletes the other tracker", async () => {
    // Probe answers (exit 1 = answered, entry absent); real gets stall out.
    const spawn: CredentialSpawn = async (argv) =>
      argv.includes("__probe__") ? ok : { exitCode: 2, stdout: "", stderr: "", timedOut: true };
    const vault = await createCredentialVault({
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
    ["wincred", "pwsh", { exitCode: 44, stdout: "", stderr: "", timedOut: false }],
  ] as const)(
    "%s reads its documented not-found exit as undefined",
    async (backend, cli, result) => {
      const vault = await createCredentialVault({
        paths: fakePaths(dir),
        env: { KUNAI_CREDENTIAL_BACKEND: backend },
        which: () => `/usr/bin/${cli}`,
        spawn: async (argv) => probeReply(argv) ?? result,
      });
      expect(vault.backend).toBe(backend);
      expect(await vault.get(CREDENTIAL_KEYS.anilistTokens)).toBeUndefined();
    },
  );

  test.each([
    ["secret-service", "secret-tool", { exitCode: 2, stdout: "", stderr: "", timedOut: false }],
    [
      "keychain",
      "security",
      { exitCode: 1, stdout: "", stderr: "errSecAuthFailed", timedOut: false },
    ],
    ["wincred", "pwsh", { exitCode: 3, stdout: "", stderr: "", timedOut: false }],
  ] as const)("%s throws on a non-not-found failure", async (backend, cli, result) => {
    const spawn: CredentialSpawn = async (argv) =>
      probeReply(argv) ?? (argv.includes("__probe__") ? ok : result);
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: backend },
      which: () => `/usr/bin/${cli}`,
      spawn,
    });
    expect(vault.backend).toBe(backend);
    await expect(vault.get(CREDENTIAL_KEYS.anilistTokens)).rejects.toThrow();
  });

  test("Keychain receives exactly one quoted command on stdin", async () => {
    const calls: { argv: readonly string[]; input: string }[] = [];
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      env: {},
      platform: "darwin",
      which: () => "security",
      spawn: async (argv, input) => {
        calls.push({ argv, input });
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      },
    });
    await vault.set("anilist.tokens", '{"token":"a b\\\\c"}');
    expect(calls).toEqual([
      {
        argv: ["security", "-i"],
        input:
          String.raw`add-generic-password -U -s kunai -a "anilist.tokens" -w "{\"token\":\"a b\\\\c\"}"` +
          "\n",
      },
    ]);
    await expect(vault.set("key\nother", "a")).rejects.toThrow("delimiter");
    await expect(vault.set("key", "é".repeat(2100))).rejects.toThrow("limit");
    expect(calls).toHaveLength(1);
  });

  test.each(["mismatch", "delete", "unavailable"] as const)(
    "Windows probe cleans up and reports fallback on %s",
    async (fault) => {
      const scripts: string[] = [];
      const notices: string[] = [];
      const vault = await createCredentialVault({
        paths: fakePaths(dir),
        platform: "win32",
        env: {},
        which: (cmd) => (cmd === "powershell.exe" ? cmd : null),
        onFallback: (_, reason) => notices.push(reason),
        spawn: async (argv) => {
          const script = argv.at(-1)!;
          scripts.push(script);
          return {
            exitCode:
              fault === "unavailable" || (fault === "delete" && script.includes("$v.Remove"))
                ? 1
                : 0,
            stdout: fault === "mismatch" ? "other" : "kunai-probe",
            stderr: "",
            timedOut: false,
          };
        },
      });
      expect(vault.backend).toBe("file");
      expect(scripts[0]).toContain("$v.Add");
      expect(scripts.at(-1)).toContain("$v.Remove");
      expect(scripts.every((script) => script.includes("ContentType=WindowsRuntime"))).toBe(true);
      expect(notices).toHaveLength(1);
    },
  );

  test("wincred spawns the resolved shell, not a hardcoded pwsh", async () => {
    const seen: string[][] = [];
    const spawn: CredentialSpawn = async (argv) => {
      seen.push([...argv]);
      return probeReply(argv) ?? { exitCode: 44, stdout: "", stderr: "", timedOut: false };
    };
    // Inbox PowerShell 5.1 machine: no pwsh, only powershell.
    const vault = await createCredentialVault({
      paths: fakePaths(dir),
      env: { KUNAI_CREDENTIAL_BACKEND: "wincred" },
      which: (cmd) =>
        cmd === "pwsh" ? null : "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      spawn,
    });
    expect(vault.backend).toBe("wincred");
    await vault.get(CREDENTIAL_KEYS.anilistTokens);
    expect(seen.length).toBeGreaterThan(0);
    for (const argv of seen) {
      expect(argv[0]).toContain("powershell");
      expect(argv[0]).not.toBe("pwsh");
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
