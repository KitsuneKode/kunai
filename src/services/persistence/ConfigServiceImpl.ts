// =============================================================================
// Config Service Implementation
// =============================================================================

import type { ConfigService, KitsuneConfig } from "./ConfigService";
import type { ConfigStore } from "./ConfigStore";
import { DEFAULT_CONFIG } from "./ConfigStore";

export class ConfigServiceImpl implements ConfigService {
  private config: KitsuneConfig;
  
  constructor(private store: ConfigStore) {
    this.config = { ...DEFAULT_CONFIG };
  }
  
  static async load(store: ConfigStore): Promise<ConfigServiceImpl> {
    const service = new ConfigServiceImpl(store);
    const loaded = await store.load();
    service.config = { ...DEFAULT_CONFIG, ...loaded };
    return service;
  }
  
  // Accessors
  get provider(): string {
    return this.config.provider;
  }
  
  get animeProvider(): string {
    return this.config.animeProvider;
  }
  
  get subLang(): string {
    return this.config.subLang;
  }
  
  get animeLang(): "sub" | "dub" {
    return this.config.animeLang;
  }
  
  get headless(): boolean {
    return this.config.headless;
  }
  
  get showMemory(): boolean {
    return this.config.showMemory;
  }
  
  get autoNext(): boolean {
    return this.config.autoNext;
  }
  
  getRaw(): KitsuneConfig {
    return { ...this.config };
  }
  
  async update(partial: Partial<KitsuneConfig>): Promise<void> {
    this.config = { ...this.config, ...partial };
  }
  
  async save(): Promise<void> {
    await this.store.save(this.config);
  }
  
  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.store.save(this.config);
  }
}
