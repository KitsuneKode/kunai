// =============================================================================
// Config Service Implementation
// =============================================================================

import type { ConfigService, KitsuneConfig } from "./ConfigService";
import type { ConfigStore } from "./ConfigStore";
import { DEFAULT_CONFIG } from "./ConfigStore";

function normalizeDefaultSubtitleLanguage(subLang: string | undefined): string {
  if (!subLang || subLang === "none" || subLang === "fzf") {
    return DEFAULT_CONFIG.subLang;
  }
  return subLang;
}

export class ConfigServiceImpl implements ConfigService {
  private config: KitsuneConfig;

  constructor(private store: ConfigStore) {
    this.config = { ...DEFAULT_CONFIG };
  }

  static async load(store: ConfigStore): Promise<ConfigServiceImpl> {
    const service = new ConfigServiceImpl(store);
    const loaded = await store.load();
    service.config = {
      ...DEFAULT_CONFIG,
      ...loaded,
      subLang: normalizeDefaultSubtitleLanguage(loaded.subLang),
    };
    return service;
  }

  // Accessors
  get provider(): string {
    return this.config.provider;
  }

  get defaultMode(): "series" | "anime" {
    return this.config.defaultMode;
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

  get skipRecap(): boolean {
    return this.config.skipRecap;
  }

  get skipIntro(): boolean {
    return this.config.skipIntro;
  }

  get skipPreview(): boolean {
    return this.config.skipPreview;
  }

  get skipCredits(): boolean {
    return this.config.skipCredits;
  }

  get footerHints(): "detailed" | "minimal" {
    return this.config.footerHints;
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
