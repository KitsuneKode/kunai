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

// Helper to extract values using RegExp
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

// 1. Sync Providers
function syncProviders() {
  // Derived from apps/cli/src/container.ts providerModules registration
  // NOT from packages/providers/src/index.ts barrel — only actively registered modules count.
  const providerDirs = [
    { name: "allmanga", path: "packages/providers/src/allmanga/manifest.ts" },
    { name: "miruro", path: "packages/providers/src/miruro/manifest.ts" },
    { name: "rivestream", path: "packages/providers/src/rivestream/manifest.ts" },
    { name: "videasy", path: "packages/providers/src/videasy/manifest.ts" },
    { name: "vidlink", path: "packages/providers/src/vidlink/manifest.ts" },
  ];

  const providers: ProviderMetadata[] = [];

  for (const entry of providerDirs) {
    const fullPath = path.join(ROOT_DIR, entry.path);
    if (!fs.existsSync(fullPath)) {
      console.warn(`File not found: ${fullPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf-8");

    // Clean up content to make regex matching simple (remove newlines inside arrays)
    const normalizedContent = content.replace(/\n\s*/g, " ");

    const idMatch = content.match(/id:\s*([A-Za-z0-9_]+|["'][^"']+["'])/);
    let id = idMatch ? idMatch[1].replace(/['"]/g, "") : entry.name;
    if (id === "ALLANIME_PROVIDER_ID") id = "allanime";
    if (id === "CINEBY_PROVIDER_ID") id = "cineby";
    if (id === "MIRURO_PROVIDER_ID") id = "miruro";
    if (id === "RIVESTREAM_PROVIDER_ID") id = "rivestream";
    if (id === "VIDEOSY_PROVIDER_ID") id = "videasy";
    if (id === "VIDLINK_PROVIDER_ID") id = "vidlink";

    const displayName = extractString(normalizedContent, "displayName") || entry.name;
    const description = extractString(normalizedContent, "description") || "";
    const domain = extractString(normalizedContent, "domain") || "";
    const recommended = extractBoolean(normalizedContent, "recommended");
    const mediaKinds = extractArray(normalizedContent, "mediaKinds");
    const capabilities = extractArray(normalizedContent, "capabilities");
    const status = extractString(normalizedContent, "status") || "active";
    const notes = extractArray(normalizedContent, "notes");

    providers.push({
      id,
      displayName,
      description,
      domain,
      recommended,
      mediaKinds,
      capabilities,
      status,
      notes,
    });
  }

  return providers;
}

// 2. Sync Commands from apps/cli/src/domain/session/command-registry.ts
function syncCommands() {
  const cmdRegistryPath = path.join(ROOT_DIR, "apps/cli/src/domain/session/command-registry.ts");
  if (!fs.existsSync(cmdRegistryPath)) {
    console.warn(`Command registry not found: ${cmdRegistryPath}`);
    return [];
  }

  const content = fs.readFileSync(cmdRegistryPath, "utf-8");

  // Locate the COMMANDS array
  const startIndex = content.indexOf("export const COMMANDS: readonly AppCommand[] = [");
  if (startIndex === -1) return [];

  // Parse objects manually using regex
  const block = content.slice(startIndex);
  const items: CommandMetadata[] = [];
  const itemRegex =
    /\{\s*id:\s*["']([^"']+)["'],\s*label:\s*["']([^"']+)["'],\s*aliases:\s*\[([^\]]*)\](?:,\s*description:\s*"([^"]*)")?[^}]*\}/g;

  let match;
  while ((match = itemRegex.exec(block)) !== null) {
    const [_, id, label, rawAliases, description] = match;
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

// 3. Sync CLI Options from apps/cli/src/main.ts
function syncCliOptions() {
  const mainPath = path.join(ROOT_DIR, "apps/cli/src/main.ts");
  if (!fs.existsSync(mainPath)) {
    console.warn(`main.ts not found: ${mainPath}`);
    return [];
  }

  const content = fs.readFileSync(mainPath, "utf-8");
  const options: CliOptionMetadata[] = [];

  // Parse lines matching args pattern in parseArgs
  const argRegex =
    /else if\s*\(\s*arg\s*===\s*["']([^"']+)["']\s*(?:\|\|\s*arg\s*===\s*["']([^"']+)["'])?\s*\)/g;
  let match;

  // We can also extract help comments
  const lines = content.split("\n");
  const commentsMap = new Map<string, string>();
  for (const line of lines) {
    const commentMatch = line.match(
      /\/\/\s+(bun run dev\s+--\s+)?(-[A-Za-z]|--[A-Za-z0-9-]+)\s+#\s+(.+)/,
    );
    if (commentMatch) {
      const flag = commentMatch[2];
      const desc = commentMatch[3];
      commentsMap.set(flag, desc);
    }
  }

  // Parse the else if args block
  while ((match = argRegex.exec(content)) !== null) {
    const flag1 = match[1];
    const flag2 = match[2] || "";
    const primary = flag2 || flag1;
    const short = flag2 ? flag1 : "";

    let description = commentsMap.get(primary) || commentsMap.get(short) || "";
    if (!description) {
      if (primary === "--search") description = "Search for movies or tv shows";
      else if (primary === "--id") description = "Specify a title ID directly";
      else if (primary === "--type") description = "Specify media type (movie or tv)";
      else if (primary === "--anime") description = "Enable anime mode";
      else if (primary === "--minimal") description = "Enable minimal footer UI";
      else if (primary === "--zen") description = "Enable zen mode (minimalist UI, quick play)";
      else if (primary === "--quick") description = "Jump to playback immediately";
      else if (primary === "--jump") description = "Directly pick index result";
      else if (primary === "--debug") description = "Enable debug log output";
      else if (primary === "--setup") description = "Run Setup Wizard";
      else if (primary === "--offline") description = "Open offline download library";
      else if (primary === "--discover") description = "Open discovery dashboard";
      else if (primary === "--calendar") description = "Open release calendar";
      else if (primary === "--random") description = "Open random tray selector";
      else if (primary === "--history") description = "Open watch history";
      else if (primary === "--continue") description = "Continue watching newest item";
      else if (primary === "--download") description = "Queue selected item for download";
    }

    options.push({
      short,
      long: primary,
      description,
    });
  }

  // Deduplicate and filter options
  const seen = new Set<string>();
  const uniqueOptions = options.filter((opt) => {
    const key = opt.long;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueOptions;
}

function main() {
  console.log("Syncing code metadata as source of truth for docs...");
  const providers = syncProviders();
  const commands = syncCommands();
  const cliOptions = syncCliOptions();

  const metadata = {
    syncedAt: new Date().toISOString(),
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
