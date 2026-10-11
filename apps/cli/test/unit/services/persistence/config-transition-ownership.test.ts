import { expect, test } from "bun:test";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";
import { CREDENTIAL_KEYS, type CredentialVaultPort } from "@/services/persistence/credential-vault";

const ID = "11111111-2222-4333-8444-555555555555";
const ROTATED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("startup migration cannot overwrite a sibling consent transaction", async () => {
  let disk: Partial<KitsuneConfig> = { ...DEFAULT_CONFIG, analytics: "enabled", installId: ID };
  delete disk.analyticsNoticeShown;
  const read = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let firstRead = true;
  let tail = Promise.resolve();
  const store = {
    load: async () => {
      const snapshot = { ...disk };
      if (firstRead) {
        firstRead = false;
        read.resolve();
        await release.promise;
      }
      return snapshot;
    },
    save: async (value: KitsuneConfig) => {
      disk = { ...value };
    },
    reset: async () => {},
    withLock: async <T>(fn: () => Promise<T>): Promise<T> => {
      const next = tail.then(fn);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  const starting = ConfigServiceImpl.load(store);
  await read.promise;
  const sibling = store.withLock(async () => {
    disk = {
      ...disk,
      analytics: "enabled",
      analyticsNoticeShown: true,
      installId: ROTATED,
      footerHints: "minimal",
    };
  });
  release.resolve();
  await Promise.all([starting, sibling]);
  const persisted = await store.load();
  expect(persisted.analytics).toBe("enabled");
  expect(persisted.installId).toBe(ROTATED);
  expect(persisted.analyticsNoticeShown).toBe(true);
  expect(persisted.footerHints).toBe("minimal");
});

test("an unrelated save never writes a hydrated stale token over a native-vault rotation", async () => {
  let disk = { ...DEFAULT_CONFIG };
  const tokens = new Map<string, string>([
    [CREDENTIAL_KEYS.videasySessionToken, "fixture-old-token"],
  ]);
  let writes = 0;
  const vault: CredentialVaultPort = {
    backend: "secret-service",
    get: async (key) => tokens.get(key),
    set: async (key, value) => {
      writes += 1;
      tokens.set(key, value);
    },
    delete: async (key) => {
      tokens.delete(key);
    },
  };
  const config = await ConfigServiceImpl.load(
    {
      load: async () => ({ ...disk }),
      save: async (value) => {
        disk = { ...value };
      },
      reset: async () => {},
    },
    vault,
  );
  tokens.set(CREDENTIAL_KEYS.videasySessionToken, "fixture-new-token");
  await config.update({ footerHints: "minimal" });
  const saved = config.save();
  await config.flushPending();
  await saved;
  expect(tokens.get(CREDENTIAL_KEYS.videasySessionToken)).toBe("fixture-new-token");
  expect(writes).toBe(0);
  expect(disk.videasySessionToken).toBe("");
  expect(disk.footerHints).toBe("minimal");
});

test("failed native token rotation preserves the replacement across later unrelated saves", async () => {
  let disk = { ...DEFAULT_CONFIG };
  const vault: CredentialVaultPort = {
    backend: "secret-service",
    get: async () => "old-native-token",
    set: async () => {
      throw new Error("native store unavailable");
    },
    delete: async () => {},
  };
  const config = await ConfigServiceImpl.load(
    {
      load: async () => ({ ...disk }),
      save: async (value) => {
        disk = { ...value };
      },
      reset: async () => {},
    },
    vault,
  );
  await config.update({ videasySessionToken: "replacement-token" });
  let saved = config.save();
  await config.flushPending();
  await saved;
  expect(disk.videasySessionToken).toBe("replacement-token");
  await config.update({ footerHints: "minimal" });
  saved = config.save();
  await config.flushPending();
  await saved;
  expect(disk.videasySessionToken).toBe("replacement-token");
  const reloaded = await ConfigServiceImpl.load(
    { load: async () => ({ ...disk }), save: async () => {}, reset: async () => {} },
    vault,
  );
  expect(reloaded.videasySessionToken).toBe("replacement-token");
});

test("a failed native clear reports failure and remains retryable", async () => {
  let disk = { ...DEFAULT_CONFIG };
  let token: string | undefined = "native-token";
  let denied = true;
  let saves = 0;
  const vault: CredentialVaultPort = {
    backend: "secret-service",
    get: async () => token,
    set: async () => {},
    delete: async () => {
      if (denied) throw new Error("native clear denied");
      token = undefined;
    },
  };
  const config = await ConfigServiceImpl.load(
    {
      load: async () => ({ ...disk }),
      save: async (value) => {
        saves += 1;
        disk = { ...value };
      },
      reset: async () => {},
    },
    vault,
  );
  await config.update({ videasySessionToken: "" });
  const saved = config.save();
  const failed = Promise.allSettled([saved, config.flushPending()]);
  expect((await failed).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(saves).toBe(0);
  expect(token).toBe("native-token");
  denied = false;
  const retried = config.save();
  await config.flushPending();
  await retried;
  expect(token).toBeUndefined();
  expect(disk.videasySessionToken).toBe("");
});

test("an explicit clear deletes a token added by another window after hydration", async () => {
  let token: string | undefined;
  const vault: CredentialVaultPort = {
    backend: "secret-service",
    get: async () => token,
    set: async () => {},
    delete: async () => {
      token = undefined;
    },
  };
  const config = await ConfigServiceImpl.load(
    { load: async () => ({ ...DEFAULT_CONFIG }), save: async () => {}, reset: async () => {} },
    vault,
  );
  token = "sibling-token";
  await config.update({ videasySessionToken: "" });
  const saved = config.save();
  await config.flushPending();
  await saved;
  expect(token).toBeUndefined();
});
