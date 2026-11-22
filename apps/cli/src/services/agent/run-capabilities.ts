import { CLI_SUBCOMMANDS, KNOWN_FLAGS } from "@/cli-args";
import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { listThemes } from "@kunai/design";

export interface CapabilitiesProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly lane: "anime" | "series" | "youtube";
  readonly recommended: boolean;
  readonly mediaKinds: readonly string[];
  readonly capabilities: readonly string[];
}

export interface CapabilitiesReport {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly exitCodes: {
    readonly ok: 0;
    readonly error: 1;
    readonly usage: 2;
  };
  readonly subcommands: readonly string[];
  readonly flags: readonly string[];
  readonly themes: readonly string[];
  readonly hdrModes: readonly string[];
  readonly headlessRoutes: readonly string[];
  readonly providerHotfixManifest: {
    readonly schemaVersion: 1;
    readonly signatureAlgorithm: "Ed25519";
  };
  readonly providers: readonly CapabilitiesProviderSummary[];
}

function laneForModule(mediaKinds: readonly string[]): "anime" | "series" | "youtube" {
  if (mediaKinds.includes("anime")) return "anime";
  if (mediaKinds.includes("video")) return "youtube";
  return "series";
}

export async function buildCapabilitiesReport(version: string): Promise<CapabilitiesReport> {
  const modules = await loadProductionProviderModules({
    providerPriority: [],
    animeProviderPriority: [],
  });
  const providers: CapabilitiesProviderSummary[] = modules.map((mod) => ({
    id: mod.manifest.id,
    name: mod.manifest.displayName,
    domain: mod.manifest.domain,
    lane: laneForModule(mod.manifest.mediaKinds),
    recommended: mod.manifest.recommended,
    mediaKinds: [...mod.manifest.mediaKinds],
    capabilities: [...mod.manifest.capabilities],
  }));

  return {
    schemaVersion: 1,
    version,
    exitCodes: { ok: 0, error: 1, usage: 2 },
    subcommands: [...CLI_SUBCOMMANDS],
    flags: [...KNOWN_FLAGS].sort(),
    themes: listThemes().map((theme) => theme.name),
    hdrModes: ["auto", "passthrough", "tone-map", "sdr-only"],
    headlessRoutes: [
      "kunai capabilities --json",
      "kunai providers status --json",
      "kunai providers verify --json",
      "kunai providers update --url <https-url> --dry-run --json",
      "kunai providers rollback --json",
      "kunai providers reset --json",
      "kunai doctor --json",
      "kunai diagnostics recent --format jsonl",
      "kunai -S <query> --json",
      "kunai -a -S <query> --json",
      "kunai -y -S <query> --json",
      "kunai --dry-run",
      "kunai --support-bundle",
      "kunai upgrade --check",
      "kunai completion <shell>",
    ],
    providerHotfixManifest: {
      schemaVersion: 1,
      signatureAlgorithm: "Ed25519",
    },
    providers,
  };
}

export async function runCapabilities(options: {
  readonly version: string;
  readonly json?: boolean;
  readonly write?: (text: string) => void;
}): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const report = await buildCapabilitiesReport(options.version);
  if (options.json) {
    write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const lines = [
    `Kunai ${report.version}`,
    `Providers (${report.providers.length}): ${report.providers.map((p) => `${p.id}[${p.lane}]`).join(", ")}`,
    `Themes (${report.themes.length}): ${report.themes.join(", ")}`,
    `Headless routes: ${report.headlessRoutes.join(" | ")}`,
    `Tip: pass --json for the full machine-readable contract.`,
  ];
  write(`${lines.join("\n")}\n`);
  return 0;
}
