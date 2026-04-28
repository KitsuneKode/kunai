// =============================================================================
// Config Store Implementation (File-based)
// =============================================================================

import type { ConfigStore, KitsuneConfig } from "./ConfigStore";
import type { StorageService } from "@/infra/storage/StorageService";
import { DEFAULT_CONFIG } from "./ConfigStore";

const STORAGE_KEY = "config";

export class ConfigStoreImpl implements ConfigStore {
  constructor(private storage: StorageService) {}

  async load(): Promise<Partial<KitsuneConfig>> {
    return (await this.storage.read<Partial<KitsuneConfig>>(STORAGE_KEY)) ?? {};
  }

  async save(config: KitsuneConfig): Promise<void> {
    await this.storage.write(STORAGE_KEY, config);
  }

  async reset(): Promise<void> {
    await this.storage.write(STORAGE_KEY, DEFAULT_CONFIG);
  }
}
