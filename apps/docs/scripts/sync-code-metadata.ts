import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(__dirname, "../../..");
const DOCS_LIB_DIR = path.join(ROOT_DIR, "apps/docs/lib");

type ProviderMetadata = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly mediaKinds: readonly string[];
  readonly capabilities: readonly string[];
  readonly status: string;
  readonly notes: readonly string[];
};

type CommandMetadata = {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly description: string;
};

type CliOptionMetadata = {
  readonly short: string;
  readonly long: string;
  readonly description: string;
};

const PROVIDER_MODULE_DIR: Record<string, string> = {
  videasyProviderModule: "videasy",
  vidlinkProviderModule: "vidlink",
  rivestreamProviderModule: "rivestream",
  allmangaProviderModule: "allmanga",
  miruroProviderModule: "miruro",
};

const PROVIDER_ID_CONSTANTS: Record<string, string> = {
  ALLANIME_PROVIDER_ID: "allanime",
  CINEBY_PROVIDER_ID: "cineby",
  MIRURO_PROVIDER_ID: "miruro",
  RIVESTREAM_PROVIDER_ID: "rivestream",
  VIDEOSY_PROVIDER_ID: "videasy",
  VIDLINK_PROVIDER_ID: "vidlink",
};

function formatGeneratedFile(filePath: string) {
  const result = Bun.spawnSync(["oxfmt", "--write", filePath], {
    cwd: ROOT_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`Failed to format generated metadata${stderr ? `: ${stderr}` : ""}`);
  }
}

function readExistingMetadata(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function metadataPayload(value: Record<string, unknown>) {
  const { syncedAt: _syncedAt, ...payload } = value;
  return JSON.stringify(payload);
}

function extractString(content: string, prop: string): string | null {
  const regex = new RegExp(`${prop}:\\s*["']([^"']+)["']`);
  const match = content.match(regex);
  return match ? match[1] : null;
}

function extractBoolean(content: string, prop: string): boolean {
  const regex = new RegExp(`${prop}:\\s*(true|false)`);
  const match = content.match(regex);
  return match ? match[1] === "true" : false;
}

function extractArray(content: string, prop: string): string[] {
  const regex = new RegExp(`${prop}:\\s*\\[([^\\]]+)\\]`);
  const match = content.match(regex);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((val) => val.trim().replace(/['"]/g, ""))
    .filter((val) => val.length > 0);
}

function resolveProviderId(rawId: string, fallbackDir: string): string {
  let id = rawId.replace(/['"]/g, "");
  if (PROVIDER_ID_CONSTANTS[id]) {
    id = PROVIDER_ID_CONSTANTS[id];
  }
  return id || fallbackDir;
}

function parseManifest(manifestPath: string, fallbackDir: string): ProviderMetadata {
  const content = fs.readFileSync(manifestPath, "utf-8");
  const normalizedContent = content.replace(/\n\s*/g, " ");

  const idMatch = content.match(/id:\s*([A-Za-z0-9_]+|["'][^"']+["'])/);
  const id = idMatch ? resolveProviderId(idMatch[1], fallbackDir) : fallbackDir;

  return {
    id,
    displayName: extractString(normalizedContent, "displayName") || fallbackDir,
    description: extractString(normalizedContent, "description") || "",
    domain: extractString(normalizedContent, "domain") || "",
    recommended: extractBoolean(normalizedContent, "recommended"),
    mediaKinds: extractArray(normalizedContent, "mediaKinds"),
    capabilities: extractArray(normalizedContent, "capabilities"),
    status: extractString(normalizedContent, "status") || "active",
    notes: extractArray(normalizedContent, "notes"),
  };
}

function syncProvidersFromContainer(): ProviderMetadata[] {
  const containerPath = path.join(ROOT_DIR, "apps/cli/src/container.ts");
  const content = fs.readFileSync(containerPath, "utf-8");
  const arrayMatch = content.match(/orderProviderModulesByPriority\(\s*\[([\s\S]*?)\],\s*\{/);
  if (!arrayMatch) {
    throw new Error("Could not parse providerModules from apps/cli/src/container.ts");
  }

  const moduleNames = [...arrayMatch[1].matchAll(/(\w+ProviderModule)/g)].map((m) => m[1]);
  if (moduleNames.length === 0) {
    throw new Error("No provider modules found in container.ts");
  }

  const providers: ProviderMetadata[] = [];
  for (const moduleName of moduleNames) {
    const dir = PROVIDER_MODULE_DIR[moduleName];
    if (!dir) {
      throw new Error(`Unknown provider module in container.ts: ${moduleName}`);
    }
    const manifestPath = path.join(ROOT_DIR, `packages/providers/src/${dir}/manifest.ts`);
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Missing manifest for registered provider: ${manifestPath}`);
    }
    providers.push(parseManifest(manifestPath, dir));
  }

  return providers;
}

function syncCommands(): CommandMetadata[] {
  const cmdRegistryPath = path.join(ROOT_DIR, "apps/cli/src/domain/session/command-registry.ts");
  if (!fs.existsSync(cmdRegistryPath)) {
    throw new Error(`Command registry not found: ${cmdRegistryPath}`);
  }

  const content = fs.readFileSync(cmdRegistryPath, "utf-8");
  const startIndex = content.indexOf("export const COMMANDS: readonly AppCommand[] = [");
  if (startIndex === -1) {
    throw new Error("COMMANDS array not found in command-registry.ts");
  }

  const block = content.slice(startIndex);
  const items: CommandMetadata[] = [];
  const itemRegex =
    /\{\s*id:\s*["']([^"']+)["'],\s*label:\s*["']([^"']+)["'],\s*aliases:\s*\[([^\]]*)\](?:,\s*description:\s*"([^"]*)")?[^}]*\}/g;

  let match;
  while ((match = itemRegex.exec(block)) !== null) {
    const [, id, label, rawAliases, description] = match;
    const aliases = rawAliases
      ? rawAliases
          .split(",")
          .map((a: string) => a.trim().replace(/['"]/g, ""))
          .filter(Boolean)
      : [];
    items.push({
      id,
      label,
      aliases,
      description: description || "",
    });
  }

  return items;
}

function parseHelpTextFlags(helpText: string): CliOptionMetadata[] {
  const options: CliOptionMetadata[] = [];
  const lines = helpText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("USAGE") || trimmed.startsWith("LAUNCH")) continue;
    if (trimmed.startsWith("DISPLAY") || trimmed.startsWith("PATHS")) continue;
    if (trimmed.startsWith("DIAGNOSTICS") || trimmed.startsWith("MAINTENANCE")) continue;
    if (trimmed.startsWith("mpv") || trimmed.startsWith("Inside the app")) continue;
    if (trimmed.startsWith("Kunai ")) continue;

    const flagMatch = trimmed.match(
      /^(?:([a-zA-Z0-9-]+),\s+)?(--[a-zA-Z0-9-]+)(?:\s+<[^>]+>)?\s{2,}(.+)$/,
    );
    if (!flagMatch) continue;

    const [, shortPart, longFlag, description] = flagMatch;
    const short = shortPart?.startsWith("-") && !shortPart.startsWith("--") ? shortPart : "";

    options.push({
      short,
      long: longFlag,
      description: description.trim(),
    });
  }

  return options;
}

function syncCliOptionsFromHelp(): CliOptionMetadata[] {
  const mainPath = path.join(ROOT_DIR, "apps/cli/src/main.ts");
  const content = fs.readFileSync(mainPath, "utf-8");
  const helpMatch = content.match(
    /export function buildHelpText\(\): string \{\s*return `([\s\S]*?)`;\s*\}/,
  );
  if (!helpMatch) {
    throw new Error("buildHelpText() not found in main.ts");
  }

  const options = parseHelpTextFlags(helpMatch[1]);
  const download = options.find((opt) => opt.long === "--download");
  if (download) {
    download.description =
      "Download-only flow for a selected title (use with -S or -i; does not open the shell queue)";
  }

  const seen = new Set<string>();
  return options.filter((opt) => {
    if (seen.has(opt.long)) return false;
    seen.add(opt.long);
    return true;
  });
}

function readPackageVersion(): string {
  const pkgPath = path.join(ROOT_DIR, "apps/cli/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function main() {
  console.log("Syncing code metadata as source of truth for docs...");
  const providers = syncProvidersFromContainer();
  const commands = syncCommands();
  const cliOptions = syncCliOptionsFromHelp();
  const version = readPackageVersion();

  const metadata = {
    syncedAt: new Date().toISOString(),
    version,
    commandCount: commands.length,
    providerIds: providers.map((p) => p.id),
    providers,
    commands,
    cliOptions,
  };

  const outputPath = path.join(DOCS_LIB_DIR, "generated-metadata.json");
  const existing = readExistingMetadata(outputPath);
  if (existing && metadataPayload(existing) === metadataPayload(metadata)) {
    formatGeneratedFile(outputPath);
    console.log(`Metadata already up to date at: ${outputPath}`);
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2), "utf-8");
  formatGeneratedFile(outputPath);
  console.log(`Successfully generated metadata at: ${outputPath}`);
}

main();
