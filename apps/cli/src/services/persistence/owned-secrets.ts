import type { KitsuneConfig } from "./ConfigService";
import { CREDENTIAL_KEYS, type CredentialVaultPort } from "./credential-vault";

type OwnedSecretSlot = {
  readonly key: string;
  readonly read: (config: KitsuneConfig) => string;
  readonly write: (config: KitsuneConfig, value: string) => KitsuneConfig;
};

const OWNED_SECRET_SLOTS: readonly OwnedSecretSlot[] = [
  {
    key: CREDENTIAL_KEYS.wyzieApiKey,
    read: (config) => config.wyzieApiKey,
    write: (config, value) => ({ ...config, wyzieApiKey: value }),
  },
  {
    key: CREDENTIAL_KEYS.providerRelayToken,
    read: (config) => config.providerRelay.token ?? "",
    write: (config, value) => ({
      ...config,
      providerRelay: { ...config.providerRelay, token: value },
    }),
  },
  {
    key: CREDENTIAL_KEYS.youtubePoToken,
    read: (config) => config.youtubeMetadata.poToken ?? "",
    write: (config, value) => ({
      ...config,
      youtubeMetadata: { ...config.youtubeMetadata, poToken: value },
    }),
  },
  {
    key: CREDENTIAL_KEYS.youtubeCookiesFromBrowser,
    read: (config) => config.youtubeMetadata.cookiesFromBrowser ?? "",
    write: (config, value) => ({
      ...config,
      youtubeMetadata: { ...config.youtubeMetadata, cookiesFromBrowser: value },
    }),
  },
];

/**
 * Move owned secrets into the vault. A vault that cannot store one turns that
 * feature off: the value is cleared in memory and must not be written back.
 * An empty disk field is filled from the vault and does not need another write.
 */
export async function hydrateOwnedSecrets(
  config: KitsuneConfig,
  vault: CredentialVaultPort | undefined,
): Promise<{ readonly config: KitsuneConfig; readonly needsPersist: boolean }> {
  if (!vault) return { config, needsPersist: false };
  let next = config;
  let needsPersist = false;
  for (const slot of OWNED_SECRET_SLOTS) {
    const current = slot.read(next).trim();
    if (!current) {
      try {
        const vaulted = (await vault.get(slot.key))?.trim();
        if (vaulted) next = slot.write(next, vaulted);
      } catch {
        // Disk is already empty. An unreadable vault leaves the feature off.
      }
      continue;
    }
    needsPersist = true;
    try {
      await vault.set(slot.key, current);
      if ((await vault.get(slot.key)) === current) continue;
    } catch {
      // The feature turns off below.
    }
    next = slot.write(next, "");
  }
  return { config: next, needsPersist };
}

/**
 * Disk copy has the secrets removed after a confirmed vault write. Memory
 * keeps them. A failed write clears both so the secret is not written back.
 */
export async function scrubOwnedSecretsForDisk(
  config: KitsuneConfig,
  vault: CredentialVaultPort | undefined,
): Promise<{ readonly disk: KitsuneConfig; readonly memory: KitsuneConfig }> {
  if (!vault) return { disk: config, memory: config };
  let disk = config;
  let memory = config;
  for (const slot of OWNED_SECRET_SLOTS) {
    const current = slot.read(memory).trim();
    if (!current) continue;
    try {
      await vault.set(slot.key, current);
      if ((await vault.get(slot.key)) === current) {
        disk = slot.write(disk, "");
        continue;
      }
    } catch {
      // Feature off: do not write the secret back.
    }
    disk = slot.write(disk, "");
    memory = slot.write(memory, "");
  }
  return { disk, memory };
}
