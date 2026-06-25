import fs from "node:fs";
import path from "node:path";

import {
  computeCliSourceFingerprint,
  computeDocsContentFingerprint,
  computeFeatureStatusRevision,
  resolveCliSourceRevision,
} from "../lib/metadata-fingerprints";

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
  youtubeProviderModule: "youtube",
};

const PROVIDER_ID_CONSTANTS: Record<string, string> = {
  ALLANIME_PROVIDER_ID: "allanime",
  CINEBY_PROVIDER_ID: "cineby",
  MIRURO_PROVIDER_ID: "miruro",
  RIVESTREAM_PROVIDER_ID: "rivestream",
  VIDEOSY_PROVIDER_ID: "videasy",
  VIDLINK_PROVIDER_ID: "vidlink",
  YOUTUBE_PROVIDER_ID: "youtube",
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
  const containerPath = path.join(ROOT_DIR, "apps/cli/src/container/bootstrap-providers.ts");
  const content = fs.readFileSync(containerPath, "utf-8");
  const arrayMatch = content.match(/orderProviderModulesByPriority\(\s*\[([\s\S]*?)\]\s*,/);
  if (!arrayMatch) {
    throw new Error(
      "Could not parse providerModules from apps/cli/src/container/bootstrap-providers.ts",
    );
  }

  const moduleNames = [...arrayMatch[1].matchAll(/(\w+ProviderModule)/g)].map((m) => m[1]);
  if (moduleNames.length === 0) {
    throw new Error("No provider modules found in bootstrap-providers.ts");
  }

  const providers: ProviderMetadata[] = [];
  for (const moduleName of moduleNames) {
    const dir = PROVIDER_MODULE_DIR[moduleName];
    if (!dir) {
      throw new Error(`Unknown provider module in bootstrap-providers.ts: ${moduleName}`);
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
  const cliArgsPath = path.join(ROOT_DIR, "apps/cli/src/cli-args.ts");
  const content = fs.readFileSync(cliArgsPath, "utf-8");
  const helpMatch = content.match(
    /export function buildCliHelpText\([^)]*\): string \{\s*return `([\s\S]*?)`;\s*\}/,
  );
  if (!helpMatch) {
    throw new Error("buildCliHelpText() not found in apps/cli/src/cli-args.ts");
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

type FeatureStatusEntry = {
  readonly id: string;
  readonly label: string;
  readonly status: "shipped" | "beta" | "planned";
  readonly description: string;
};

type RuntimeBaseline = {
  readonly bun: string;
  readonly mpv: string;
};

function parseFeatureStatusYaml(content: string): FeatureStatusEntry[] {
  const features: FeatureStatusEntry[] = [];
  const allowed = new Set(["shipped", "beta", "planned"]);
  let current: Partial<FeatureStatusEntry> | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "features:") continue;

    const listMatch = line.match(/^- id:\s*(.+)$/);
    if (listMatch) {
      if (current?.id && current.label && current.status && current.description) {
        features.push(current as FeatureStatusEntry);
      }
      current = { id: listMatch[1] };
      continue;
    }

    if (!current) continue;
    const propMatch = line.match(/^(label|status|description):\s*(.+)$/);
    if (!propMatch) continue;
    const [, key, value] = propMatch;
    if (key === "label") current.label = value;
    if (key === "status") {
      if (!allowed.has(value)) {
        throw new Error(`Invalid feature status "${value}" for ${current.id}`);
      }
      current.status = value as FeatureStatusEntry["status"];
    }
    if (key === "description") current.description = value;
  }

  if (current?.id && current.label && current.status && current.description) {
    features.push(current as FeatureStatusEntry);
  }

  return features;
}

function syncFeatureStatus(): FeatureStatusEntry[] {
  const yamlPath = path.join(ROOT_DIR, "docs/feature-status.yaml");
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`Missing feature status file: ${yamlPath}`);
  }
  return parseFeatureStatusYaml(fs.readFileSync(yamlPath, "utf-8"));
}

function syncRuntimeBaseline(): RuntimeBaseline {
  const docsPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, "apps/docs/package.json"), "utf-8"),
  ) as { engines?: { bun?: string } };
  const bunEngine = docsPkg.engines?.bun?.replace(/^>=/, "") ?? "1.3.9";
  return {
    bun: bunEngine,
    mpv: "0.38+",
  };
}

function readPackageVersion(): string {
  const pkgPath = path.join(ROOT_DIR, "apps/cli/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

export function buildMetadata(): Record<string, unknown> {
  const providers = syncProvidersFromContainer();
  const commands = syncCommands();
  const cliOptions = syncCliOptionsFromHelp();
  const version = readPackageVersion();
  const featureStatus = syncFeatureStatus();
  const runtimeBaseline = syncRuntimeBaseline();

  return {
    syncedAt: new Date().toISOString(),
    version,
    cliVersion: version,
    cliSourceRevision: resolveCliSourceRevision(ROOT_DIR),
    cliSourceFingerprint: computeCliSourceFingerprint(ROOT_DIR),
    docsContentFingerprint: computeDocsContentFingerprint(ROOT_DIR),
    featureStatusRevision: computeFeatureStatusRevision(ROOT_DIR),
    commandCount: commands.length,
    providerIds: providers.map((p) => p.id),
    providers,
    commands,
    cliOptions,
    featureStatus,
    runtimeBaseline,
  };
}

function main() {
  console.log("Syncing code metadata as source of truth for docs...");
  const metadata = buildMetadata();

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

if (import.meta.main) {
  main();
}
