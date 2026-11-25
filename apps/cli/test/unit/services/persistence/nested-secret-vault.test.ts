import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileStorage } from "@/infra/storage/FileStorage";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";
import { ConfigStoreImpl } from "@/services/persistence/ConfigStoreImpl";
import { CREDENTIAL_KEYS, type CredentialVaultPort } from "@/services/persistence/credential-vault";
import { getKunaiPaths } from "@kunai/storage";

import { storageRootEnv } from "../../../helpers/storage-env";

const PO_TOKEN = "visionos.gvs+fixturePoToken12345";
const RELAY_TOKEN = "relay-fixture-bearer-secret-67890";

function memoryVault(
  backend: CredentialVaultPort["backend"] = "secret-service",
): CredentialVaultPort & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    backend,
    entries,
    get: async (key) => entries.get(key),
    set: async (key, value) => {
      entries.set(key, value);
    },
    delete: async (key) => {
      entries.delete(key);
    },
  };
}

function memoryStore(initial: Partial<KitsuneConfig>) {
  const state = { disk: { ...DEFAULT_CONFIG, ...initial } };
  return {
    state,
    store: {
      load: async () => ({ ...state.disk }),
      save: async (value: KitsuneConfig) => {
        state.disk = { ...value };
      },
      reset: async () => {},
    },
  };
}

async function saved(config: ConfigServiceImpl): Promise<void> {
  const pending = config.save();
  await config.flushPending();
  await pending;
}

describe("nested secrets (youtubeMetadata.poToken and providerRelay.token) in the OS vault", () => {
  test("plaintext nested secrets migrate on load, verify via read-back, and scrub from config.json on disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-vault-nested-"));
    try {
      const paths = getKunaiPaths({ env: storageRootEnv(root) });
      const configPath = join(paths.configDir, "config.json");
      const storage = new FileStorage({ config: configPath });
      const store = new ConfigStoreImpl(storage);
      await store.save({
        ...DEFAULT_CONFIG,
        youtubeMetadata: {
          instanceUrl: "https://inv.example",
          poToken: `  ${PO_TOKEN}  `,
        },
        providerRelay: {
          ...DEFAULT_CONFIG.providerRelay,
          baseUrl: "https://relay.example",
          token: `  ${RELAY_TOKEN}  `,
        },
      });

      const vault = memoryVault();
      const config = await ConfigServiceImpl.load(store, vault);

      expect(vault.entries.get(CREDENTIAL_KEYS.youtubePoToken)).toBe(PO_TOKEN);
      expect(vault.entries.get(CREDENTIAL_KEYS.providerRelayToken)).toBe(RELAY_TOKEN);
      // In-memory consumers still see the secrets and sibling fields.
      expect(config.youtubeMetadata.poToken).toBe(PO_TOKEN);
      expect(config.youtubeMetadata.instanceUrl).toBe("https://inv.example");
      expect(config.providerRelay.token).toBe(RELAY_TOKEN);
      expect(config.providerRelay.baseUrl).toBe("https://relay.example");

      // On disk, both secrets are scrubbed while sibling fields survive.
      // SAFETY: config.json was written by ConfigStoreImpl above in this test's isolated temp dir.
      const onDisk = JSON.parse(readFileSync(configPath, "utf8")) as Partial<KitsuneConfig>;
      expect(onDisk.youtubeMetadata?.instanceUrl).toBe("https://inv.example");
      expect(onDisk.youtubeMetadata?.poToken).toBeUndefined();
      expect(onDisk.providerRelay?.baseUrl).toBe("https://relay.example");
      expect(onDisk.providerRelay?.token).toBe("");

      // Next launch hydrates both nested secrets back from the vault.
      const relaunched = await ConfigServiceImpl.load(store, vault);
      expect(relaunched.youtubeMetadata.poToken).toBe(PO_TOKEN);
      expect(relaunched.youtubeMetadata.instanceUrl).toBe("https://inv.example");
      expect(relaunched.providerRelay.token).toBe(RELAY_TOKEN);
      expect(relaunched.providerRelay.baseUrl).toBe("https://relay.example");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("boot reads all vaulted secrets in parallel", async () => {
    const keysSeen: string[] = [];
    const gate = Promise.withResolvers<void>();
    const vault: CredentialVaultPort = {
      backend: "secret-service",
      get: async (key) => {
        keysSeen.push(key);
        if (keysSeen.length === 5) gate.resolve();
        await gate.promise;
        return undefined;
      },
      set: async () => {},
      delete: async () => {},
    };
    const { store } = memoryStore({});
    await ConfigServiceImpl.load(store, vault);
    expect(keysSeen).toContain(CREDENTIAL_KEYS.youtubePoToken);
    expect(keysSeen).toContain(CREDENTIAL_KEYS.providerRelayToken);
    expect(keysSeen).toHaveLength(5);
  });

  test("unverified vault write retains plaintext on disk instead of scrubbing", async () => {
    const vault: CredentialVaultPort = {
      backend: "secret-service",
      get: async () => "mismatched-value",
      set: async () => {},
      delete: async () => {},
    };
    const { state, store } = memoryStore({
      youtubeMetadata: { poToken: PO_TOKEN },
      providerRelay: { ...DEFAULT_CONFIG.providerRelay, token: RELAY_TOKEN },
    });
    const config = await ConfigServiceImpl.load(store, vault);
    expect(config.youtubeMetadata.poToken).toBe(PO_TOKEN);
    expect(config.providerRelay.token).toBe(RELAY_TOKEN);
    expect(state.disk.youtubeMetadata.poToken).toBe(PO_TOKEN);
    expect(state.disk.providerRelay.token).toBe(RELAY_TOKEN);
  });

  test("updating and clearing nested secrets writes and deletes vault entries", async () => {
    const vault = memoryVault();
    const { state, store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, vault);

    await config.update({
      youtubeMetadata: { ...config.youtubeMetadata, poToken: PO_TOKEN },
      providerRelay: {
        ...config.providerRelay,
        baseUrl: "https://relay.example",
        token: RELAY_TOKEN,
      },
    });
    await saved(config);
    expect(vault.entries.get(CREDENTIAL_KEYS.youtubePoToken)).toBe(PO_TOKEN);
    expect(vault.entries.get(CREDENTIAL_KEYS.providerRelayToken)).toBe(RELAY_TOKEN);
    expect(state.disk.youtubeMetadata.poToken).toBeUndefined();
    expect(state.disk.providerRelay.token).toBe("");
    expect(state.disk.providerRelay.baseUrl).toBe("https://relay.example");

    const { poToken: _omitted, ...nextYoutube } = config.youtubeMetadata;
    await config.update({
      youtubeMetadata: nextYoutube,
      providerRelay: { ...config.providerRelay, token: "" },
    });
    await saved(config);
    expect(vault.entries.has(CREDENTIAL_KEYS.youtubePoToken)).toBe(false);
    expect(vault.entries.has(CREDENTIAL_KEYS.providerRelayToken)).toBe(false);
    expect(config.youtubeMetadata.poToken).toBeUndefined();
    expect(config.providerRelay.token).toBe("");
  });

  test("editing sibling sub-fields does not overwrite a rotated vault secret or disk fallback", async () => {
    const vault = memoryVault();
    vault.entries.set(CREDENTIAL_KEYS.youtubePoToken, PO_TOKEN);
    vault.entries.set(CREDENTIAL_KEYS.providerRelayToken, RELAY_TOKEN);
    let setCalls = 0;
    const trackedVault: CredentialVaultPort = {
      backend: "secret-service",
      get: (key) => vault.get(key),
      set: async (key, value) => {
        setCalls += 1;
        await vault.set(key, value);
      },
      delete: (key) => vault.delete(key),
    };
    const { state, store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, trackedVault);

    // Sibling rotated both vault entries, and also left a newer fallback plaintext on disk.
    vault.entries.set(CREDENTIAL_KEYS.youtubePoToken, "rotated-po-token");
    vault.entries.set(CREDENTIAL_KEYS.providerRelayToken, "rotated-relay-token");
    state.disk = {
      ...state.disk,
      providerRelay: { ...state.disk.providerRelay, token: "sibling-fallback-relay" },
    };

    await config.update({
      youtubeMetadata: { ...config.youtubeMetadata, instanceUrl: "https://inv2.example" },
      providerRelay: { ...config.providerRelay, baseUrl: "https://relay2.example" },
    });
    await saved(config);

    expect(setCalls).toBe(0);
    expect(vault.entries.get(CREDENTIAL_KEYS.youtubePoToken)).toBe("rotated-po-token");
    expect(vault.entries.get(CREDENTIAL_KEYS.providerRelayToken)).toBe("rotated-relay-token");
    expect(state.disk.youtubeMetadata.instanceUrl).toBe("https://inv2.example");
    expect(state.disk.youtubeMetadata.poToken).toBeUndefined();
    expect(state.disk.providerRelay.baseUrl).toBe("https://relay2.example");
    expect(state.disk.providerRelay.token).toBe("sibling-fallback-relay");
  });

  test("explicit clear deletes a nested secret added by another window after hydration", async () => {
    const vault = memoryVault();
    const { store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, vault);

    vault.entries.set(CREDENTIAL_KEYS.youtubePoToken, PO_TOKEN);
    vault.entries.set(CREDENTIAL_KEYS.providerRelayToken, RELAY_TOKEN);

    await config.update({
      youtubeMetadata: { ...config.youtubeMetadata },
      providerRelay: { ...config.providerRelay, token: "" },
    });
    await saved(config);

    expect(vault.entries.has(CREDENTIAL_KEYS.youtubePoToken)).toBe(false);
    expect(vault.entries.has(CREDENTIAL_KEYS.providerRelayToken)).toBe(false);
  });

  test("failed native clear rejects save and remains retryable for nested secrets", async () => {
    let relaySecret: string | undefined = RELAY_TOKEN;
    let denied = true;
    const vault: CredentialVaultPort = {
      backend: "secret-service",
      get: async (key) => (key === CREDENTIAL_KEYS.providerRelayToken ? relaySecret : undefined),
      set: async () => {},
      delete: async (key) => {
        if (key !== CREDENTIAL_KEYS.providerRelayToken) return;
        if (denied) throw new Error("native clear denied");
        relaySecret = undefined;
      },
    };
    const { store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, vault);

    await config.update({ providerRelay: { ...config.providerRelay, token: "" } });
    const first = Promise.allSettled([config.save(), config.flushPending()]);
    expect((await first).map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(relaySecret).toBe(RELAY_TOKEN);

    denied = false;
    await saved(config);
    expect(relaySecret).toBeUndefined();
  });

  test("file fallback backend and absent vault keep nested secrets in config.json as today", async () => {
    for (const vault of [memoryVault("file"), undefined]) {
      const { state, store } = memoryStore({});
      const config = await ConfigServiceImpl.load(store, vault);
      await config.update({
        youtubeMetadata: { ...config.youtubeMetadata, poToken: PO_TOKEN },
        providerRelay: { ...config.providerRelay, token: RELAY_TOKEN },
      });
      await saved(config);
      expect(state.disk.youtubeMetadata.poToken).toBe(PO_TOKEN);
      expect(state.disk.providerRelay.token).toBe(RELAY_TOKEN);
      if (vault) expect(vault.entries.size).toBe(0);
    }
  });
});
