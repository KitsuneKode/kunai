// =============================================================================
// Config Service
//
// Manages user configuration and preferences.
// =============================================================================

export interface KitsuneConfig {
  provider: string;
  animeProvider: string;
  subLang: string;
  animeLang: "sub" | "dub";
  headless: boolean;
  showMemory: boolean;
  autoNext: boolean;
}

export interface ConfigService extends KitsuneConfig {
  // Raw config access
  getRaw(): KitsuneConfig;
  update(partial: Partial<KitsuneConfig>): Promise<void>;
  save(): Promise<void>;
  reset(): Promise<void>;
}

export interface ConfigStore {
  load(): Promise<Partial<KitsuneConfig>>;
  save(config: KitsuneConfig): Promise<void>;
}
