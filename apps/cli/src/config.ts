import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type KitsuneConfig = {
  defaultMode: "series" | "anime";
  provider: string; // provider ID (e.g. "vidking")
  animeProvider: string; // anime provider ID (e.g. "allanime")
  subLang: string; // subtitle language code or "fzf" | "none"
  animeLang: "sub" | "dub"; // preferred audio type for anime
  headless: boolean;
  showMemory: boolean;
  autoNext: boolean;
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

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export async function loadConfig(): Promise<KitsuneConfig> {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(CONFIG_FILE, "utf-8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(cfg: KitsuneConfig): Promise<void> {
  ensureDir();
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
}

// providers.json — optional domain overrides per provider ID.
// Format: { "braflix": { "baseUrl": "https://braflix.mov" }, ... }
// Useful when a provider moves to a new domain without a release.
export type DomainOverrides = Record<string, { baseUrl?: string }>;

export async function loadDomainOverrides(): Promise<DomainOverrides> {
  if (!existsSync(DOMAIN_FILE)) return {};
  try {
    return JSON.parse(await readFile(DOMAIN_FILE, "utf-8")) as DomainOverrides;
  } catch {
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
