import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";

export type KitsuneConfig = {
  defaultMode: "series" | "anime";
  provider: string; // provider ID (e.g. "vidking")
  animeProvider: string; // anime provider ID (e.g. "allanime")
  subLang: string; // subtitle language code or "fzf" | "none"
  animeLang: "sub" | "dub"; // preferred audio type for anime
  headless: boolean;
  showMemory: boolean;
  autoNext: boolean;
  resumeStartChoicePrompt: boolean;
  skipRecap: boolean;
  skipIntro: boolean;
  skipPreview: boolean;
  skipCredits: boolean;
  footerHints: "detailed" | "minimal";
  quitNearEndBehavior: "continue" | "pause";
  quitNearEndThresholdMode: "credits-or-90-percent" | "percent-only" | "seconds-only";
  mpvKunaiScriptPath: string;
  mpvKunaiScriptOpts: Record<string, string>;
};

export const DEFAULT_CONFIG: KitsuneConfig = {
  defaultMode: "series",
  provider: "vidking",
  animeProvider: "allanime",
  subLang: "en",
  animeLang: "sub",
  headless: true,
  showMemory: false,
  autoNext: true,
  resumeStartChoicePrompt: true,
  skipRecap: true,
  skipIntro: true,
  skipPreview: true,
  skipCredits: true,
  footerHints: "detailed",
  quitNearEndBehavior: "continue",
  quitNearEndThresholdMode: "credits-or-90-percent",
  mpvKunaiScriptPath: "",
  mpvKunaiScriptOpts: {},
};

const CONFIG_DIR = join(process.env.HOME ?? "~", ".config", "kunai");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DOMAIN_FILE = join(CONFIG_DIR, "providers.json");

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadConfig(): Promise<KitsuneConfig> {
  await ensureConfigDir();
  const file = Bun.file(CONFIG_FILE);
  if (!(await file.exists())) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...(await file.json()) };
  } catch (e) {
    console.error(`[kunai] config.json is corrupt, using defaults: ${e}`);
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(cfg: KitsuneConfig): Promise<void> {
  await writeAtomicJson(CONFIG_FILE, cfg);
}

// providers.json — optional domain overrides per provider ID.
// Format: { "braflix": { "baseUrl": "https://braflix.mov" }, ... }
// Useful when a provider moves to a new domain without a release.
export type DomainOverrides = Record<string, { baseUrl?: string }>;

export async function loadDomainOverrides(): Promise<DomainOverrides> {
  await ensureConfigDir();
  const file = Bun.file(DOMAIN_FILE);
  if (!(await file.exists())) return {};
  try {
    return (await file.json()) as DomainOverrides;
  } catch (e) {
    console.error(`[kunai] providers.json is corrupt, using defaults: ${e}`);
    return {};
  }
}

// Apply loaded overrides to provider globals at startup.
// Individual providers read their base URL from globalThis.__<id>Base.
export function applyDomainOverrides(overrides: DomainOverrides): void {
  for (const [id, cfg] of Object.entries(overrides)) {
    if (cfg.baseUrl) {
      (globalThis as Record<string, unknown>)[`__${id}Base`] = cfg.baseUrl;
    }
  }
}
