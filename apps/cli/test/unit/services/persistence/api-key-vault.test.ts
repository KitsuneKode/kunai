import { describe, expect, test } from "bun:test";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";
import { CREDENTIAL_KEYS, type CredentialVaultPort } from "@/services/persistence/credential-vault";

const TMDB_KEY = "0123456789abcdef0123456789abcdef";
const WYZIE_KEY = "wyzie-fixture-key-1234";

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

describe("user API keys live in the OS credential vault", () => {
  test("plaintext keys in config.json migrate into the vault and are scrubbed from disk", async () => {
    const vault = memoryVault();
    const { state, store } = memoryStore({ tmdbApiKey: TMDB_KEY, wyzieApiKey: WYZIE_KEY });
    const config = await ConfigServiceImpl.load(store, vault);

    expect(vault.entries.get(CREDENTIAL_KEYS.tmdbApiKey)).toBe(TMDB_KEY);
    expect(vault.entries.get(CREDENTIAL_KEYS.wyzieApiKey)).toBe(WYZIE_KEY);
    expect(state.disk.tmdbApiKey).toBe("");
    expect(state.disk.wyzieApiKey).toBe("");
    // Consumers still read the key; they never learn where it lives.
    expect(config.tmdbApiKey).toBe(TMDB_KEY);
    expect(config.wyzieApiKey).toBe(WYZIE_KEY);
  });

  test("a key saved in settings goes to the vault, and clearing it deletes it there", async () => {
    const vault = memoryVault();
    const { state, store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, vault);

    await config.update({ tmdbApiKey: TMDB_KEY });
    await saved(config);
    expect(vault.entries.get(CREDENTIAL_KEYS.tmdbApiKey)).toBe(TMDB_KEY);
    expect(state.disk.tmdbApiKey).toBe("");

    await config.update({ tmdbApiKey: "" });
    await saved(config);
    expect(vault.entries.has(CREDENTIAL_KEYS.tmdbApiKey)).toBe(false);
    expect(config.tmdbApiKey).toBe("");
  });

  test("a later launch reads the key back from the vault", async () => {
    const vault = memoryVault();
    vault.entries.set(CREDENTIAL_KEYS.tmdbApiKey, TMDB_KEY);
    const { store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, vault);
    expect(config.tmdbApiKey).toBe(TMDB_KEY);
  });

  test("a sibling's newer plaintext key is not blanked by a stale vault view", async () => {
    const vault = memoryVault();
    vault.entries.set(CREDENTIAL_KEYS.tmdbApiKey, TMDB_KEY);
    const { state, store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, vault);
    // A sibling window saved a new key but its vault write failed, so the
    // new value stayed in config.json while the vault kept the old one.
    const newer = "fedcba9876543210fedcba9876543210";
    state.disk = { ...state.disk, tmdbApiKey: newer };

    await config.update({ footerHints: "minimal" });
    await saved(config);
    expect(state.disk.tmdbApiKey).toBe(newer);
    expect(state.disk.footerHints).toBe("minimal");
  });

  test("with only the file fallback backend, the key stays in config.json", async () => {
    const vault = memoryVault("file");
    const { state, store } = memoryStore({});
    const config = await ConfigServiceImpl.load(store, vault);
    await config.update({ tmdbApiKey: TMDB_KEY });
    await saved(config);
    expect(state.disk.tmdbApiKey).toBe(TMDB_KEY);
    expect(vault.entries.size).toBe(0);
  });
});
