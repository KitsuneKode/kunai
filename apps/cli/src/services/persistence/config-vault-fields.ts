import { isJsonString } from "@kunai/types";

import type { KitsuneConfig } from "./ConfigService";
import { CREDENTIAL_KEYS } from "./credential-vault";

/**
 * Config fields whose values live in the OS credential vault (Keychain,
 * Windows Credential Manager, Secret Service) when one is available. The
 * in-memory config keeps serving them, so consumers never learn where they
 * live; config.json carries "" (or omits `poToken`) once the vault holds a
 * verified copy.
 */
export const VAULTED_CONFIG_FIELDS = [
  "videasySessionToken",
  "tmdbApiKey",
  "wyzieApiKey",
  "youtubeMetadata.poToken",
  "providerRelay.token",
] as const;

export type VaultedConfigField = (typeof VAULTED_CONFIG_FIELDS)[number];

export const VAULT_KEY_BY_FIELD = {
  videasySessionToken: CREDENTIAL_KEYS.videasySessionToken,
  tmdbApiKey: CREDENTIAL_KEYS.tmdbApiKey,
  wyzieApiKey: CREDENTIAL_KEYS.wyzieApiKey,
  "youtubeMetadata.poToken": CREDENTIAL_KEYS.youtubePoToken,
  "providerRelay.token": CREDENTIAL_KEYS.providerRelayToken,
} satisfies Record<VaultedConfigField, string>;

const FLAT_VAULTED_FIELDS = ["videasySessionToken", "tmdbApiKey", "wyzieApiKey"] as const;

function trimmedSecret<T>(value: T): string {
  return isJsonString(value) ? value.trim() : "";
}

export function readVaultedField(
  config: Partial<KitsuneConfig>,
  field: VaultedConfigField,
): string {
  switch (field) {
    case "videasySessionToken":
      return trimmedSecret(config.videasySessionToken);
    case "tmdbApiKey":
      return trimmedSecret(config.tmdbApiKey);
    case "wyzieApiKey":
      return trimmedSecret(config.wyzieApiKey);
    case "youtubeMetadata.poToken":
      return trimmedSecret(config.youtubeMetadata?.poToken);
    case "providerRelay.token":
      return trimmedSecret(config.providerRelay?.token);
  }
}

export function writeVaultedField(
  config: KitsuneConfig,
  field: VaultedConfigField,
  value: string,
): KitsuneConfig {
  switch (field) {
    case "videasySessionToken":
    case "tmdbApiKey":
    case "wyzieApiKey":
      return { ...config, [field]: value };
    case "youtubeMetadata.poToken": {
      if (value) {
        return { ...config, youtubeMetadata: { ...config.youtubeMetadata, poToken: value } };
      }
      const { poToken: _omitted, ...rest } = config.youtubeMetadata;
      return { ...config, youtubeMetadata: rest };
    }
    case "providerRelay.token":
      return {
        ...config,
        providerRelay: { ...config.providerRelay, token: value },
      };
  }
}

export function scrubVaultedFields(
  config: KitsuneConfig,
  scrub: ReadonlySet<VaultedConfigField>,
): KitsuneConfig {
  if (scrub.size === 0) return config;
  let scrubbed = config;
  for (const field of scrub) {
    scrubbed = writeVaultedField(scrubbed, field, "");
  }
  return scrubbed;
}

function sameNonSecretYoutubeMetadata(
  prev: KitsuneConfig["youtubeMetadata"],
  next: KitsuneConfig["youtubeMetadata"],
): boolean {
  return (
    prev.instanceUrl === next.instanceUrl &&
    prev.pipedApiUrl === next.pipedApiUrl &&
    prev.cookiesFromBrowser === next.cookiesFromBrowser &&
    prev.cookiesFile === next.cookiesFile &&
    prev.extractorArgs === next.extractorArgs &&
    prev.sponsorblockRemove === next.sponsorblockRemove
  );
}

function sameNonSecretProviderRelay(
  prev: KitsuneConfig["providerRelay"],
  next: KitsuneConfig["providerRelay"],
): boolean {
  return (
    prev.enabled === next.enabled &&
    prev.baseUrl === next.baseUrl &&
    prev.fallbackToDirect === next.fallbackToDirect &&
    JSON.stringify(prev.providers ?? {}) === JSON.stringify(next.providers ?? {})
  );
}

/**
 * Decide which vaulted fields an `update()` call explicitly targeted.
 *
 * Flat fields are targeted whenever they appear in `partial`. Nested objects
 * (`youtubeMetadata`, `providerRelay`) are updated whole by Settings rows, so
 * toggling `providerRelay.enabled` or editing `youtubeMetadata.instanceUrl`
 * carries the existing secret along untouched — that must NOT touch the vault
 * (and must not clobber a sibling window's rotation). The nested secret is
 * dirty when its value actually changed, or when the caller submitted the same
 * object with an empty secret and no other sub-field changed (explicit clear).
 */
export function collectDirtyVaultFields(
  prev: KitsuneConfig,
  next: KitsuneConfig,
  partial: Partial<KitsuneConfig>,
): VaultedConfigField[] {
  const dirty: VaultedConfigField[] = [];
  for (const field of FLAT_VAULTED_FIELDS) {
    if (partial[field] !== undefined) dirty.push(field);
  }
  if (partial.youtubeMetadata !== undefined) {
    const prevPo = readVaultedField(prev, "youtubeMetadata.poToken");
    const nextPo = readVaultedField(next, "youtubeMetadata.poToken");
    if (
      nextPo !== prevPo ||
      (nextPo === "" && sameNonSecretYoutubeMetadata(prev.youtubeMetadata, next.youtubeMetadata))
    ) {
      dirty.push("youtubeMetadata.poToken");
    }
  }
  if (partial.providerRelay !== undefined) {
    const prevToken = readVaultedField(prev, "providerRelay.token");
    const nextToken = readVaultedField(next, "providerRelay.token");
    if (
      nextToken !== prevToken ||
      (nextToken === "" && sameNonSecretProviderRelay(prev.providerRelay, next.providerRelay))
    ) {
      dirty.push("providerRelay.token");
    }
  }
  return dirty;
}

/**
 * When a merge-save writes a nested object (`youtubeMetadata` or
 * `providerRelay`) whose secret sub-field was NOT dirtied by this process,
 * preserve whatever secret is currently on disk instead of overwriting it with
 * our hydrated-at-boot view — a sibling window whose vault write failed may
 * have left newer plaintext on disk that must survive.
 */
export function preserveUnchangedNestedDiskSecrets(
  toWrite: KitsuneConfig,
  onDisk: Partial<KitsuneConfig>,
  dirtyKeys: ReadonlySet<keyof KitsuneConfig>,
  dirtyVaultFields: ReadonlySet<VaultedConfigField>,
): KitsuneConfig {
  let result = toWrite;
  if (dirtyKeys.has("youtubeMetadata") && !dirtyVaultFields.has("youtubeMetadata.poToken")) {
    result = writeVaultedField(
      result,
      "youtubeMetadata.poToken",
      readVaultedField(onDisk, "youtubeMetadata.poToken"),
    );
  }
  if (dirtyKeys.has("providerRelay") && !dirtyVaultFields.has("providerRelay.token")) {
    result = writeVaultedField(
      result,
      "providerRelay.token",
      readVaultedField(onDisk, "providerRelay.token"),
    );
  }
  return result;
}
