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
  animeTitlePreference: "english",
  headless: true,
  showMemory: false,
  autoNext: true,
  resumeStartChoicePrompt: true,
  skipRecap: false,
  skipIntro: true,
  skipPreview: false,
  skipCredits: true,
  footerHints: "detailed",
  quitNearEndBehavior: "continue",
  quitNearEndThresholdMode: "credits-or-90-percent",
  mpvKunaiScriptPath: "",
  mpvKunaiScriptOpts: {},
  mpvInProcessStreamReconnect: true,
  mpvInProcessStreamReconnectMaxAttempts: 3,
  discoverShowOnStartup: false,
  discoverMode: "auto",
  discoverItemLimit: 24,
  recommendationRailEnabled: true,
  minimalMode: false,
  presenceProvider: "off",
  presencePrivacy: "full",
  presenceDiscordClientId: "",
  downloadsEnabled: false,
  onboardingVersion: 0,
  downloadPath: "",
  downloadOnboardingDismissed: false,
};
