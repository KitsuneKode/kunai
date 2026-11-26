// =============================================================================
// Config Store Implementation (File-based)
// =============================================================================

import type { StremioAddonsConsent } from "@/domain/provider/stremio-addons";
import type { StorageService } from "@/infra/storage/StorageService";
import { parseKitsuneConfigPartial } from "@kunai/config";
import { isJsonObject } from "@kunai/types";

import type { ConfigStore, KitsuneConfig } from "./ConfigStore";
import { DEFAULT_CONFIG } from "./ConfigStore";

const STORAGE_KEY = "config";

export class ConfigStoreImpl implements ConfigStore {
  constructor(private storage: StorageService) {}

  async load(): Promise<Partial<KitsuneConfig>> {
    const raw = await this.storage.read<unknown>(STORAGE_KEY);
    if (!raw) return {};
    return parseKitsuneConfigPartial(raw);
  }

  async save(config: KitsuneConfig): Promise<void> {
    await this.storage.write(STORAGE_KEY, config);
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const withLock = this.storage.withLock?.bind(this.storage);
    return withLock ? withLock(STORAGE_KEY, fn) : fn();
  }

  /**
   * The consent pair as the live file records it, normalized exactly the way
   * `load()` would report it. Fail-closed: an absent, unreadable, or
   * non-object file is "off", and a consent key that is missing or malformed
   * in an otherwise healthy file is its default too. Read-only — it never
   * triggers the quarantine or a write.
   */
  readStremioAddonsConsent(): StremioAddonsConsent {
    const raw = this.storage.readJsonSync?.(STORAGE_KEY);
    if (!isJsonObject(raw))
      return { experimentalStremioAddons: false, stremioAddonsRiskAcknowledgedAt: "" };
    const parsed = parseKitsuneConfigPartial(raw);
    return {
      experimentalStremioAddons: parsed.experimentalStremioAddons === true,
      stremioAddonsRiskAcknowledgedAt: parsed.stremioAddonsRiskAcknowledgedAt ?? "",
    };
  }

  async reset(): Promise<void> {
    await this.storage.write(STORAGE_KEY, DEFAULT_CONFIG);
  }
}
