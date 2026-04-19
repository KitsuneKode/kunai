import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export type KitsuneConfig = {
  provider:   string; // provider ID from the registry (e.g. "vidking", "cineby")
  subLang:    string;
  headless:   boolean;
  showMemory: boolean;
  autoNext:   boolean; // auto-advance to next episode on natural EOF
};

export const DEFAULT_CONFIG: KitsuneConfig = {
  provider:   "vidking",
  subLang:    "en",
  headless:   true,
  showMemory: false,
  autoNext:   true,
};

const CONFIG_DIR  = join(process.env.HOME ?? "~", ".config", "kitsunesnipe");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
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
