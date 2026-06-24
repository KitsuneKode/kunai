// =============================================================================
// Config Store Implementation (File-based)
// =============================================================================

import type { StorageService } from "@/infra/storage/StorageService";
import { parseKitsuneConfigPartial } from "@kunai/config";

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

  async reset(): Promise<void> {
    await this.storage.write(STORAGE_KEY, DEFAULT_CONFIG);
  }
}
