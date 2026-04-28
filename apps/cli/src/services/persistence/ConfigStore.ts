// =============================================================================
// Config Store
//
// Low-level config persistence (file-based).
// =============================================================================

export type { KitsuneConfig } from "./ConfigService";
import type { KitsuneConfig } from "./ConfigService";

export interface ConfigStore {
  load(): Promise<Partial<KitsuneConfig>>;
  save(config: KitsuneConfig): Promise<void>;
  reset(): Promise<void>;
}

// Default configuration
export const DEFAULT_CONFIG: KitsuneConfig = {
  defaultMode: "series",
  provider: "vidking",
  animeProvider: "allanime",
  subLang: "en",
  animeLang: "sub",
  headless: true,
  showMemory: false,
  autoNext: false,
  footerHints: "detailed",
};
