export type ProviderResearchStatus =
  | "production"
  | "candidate"
  | "legacy-fallback"
  | "research-only";

export type ProviderMigrationAction =
  | "promote-direct-provider"
  | "keep-as-fallback"
  | "implement-from-scratchpad"
  | "hold-for-future-runtime";

export interface ProviderResearchProfile {
  readonly providerId: string;
  readonly status: ProviderResearchStatus;
  readonly migrationAction: ProviderMigrationAction;
  readonly migrationRank: number;
  readonly dossierPath: string;
  readonly evidencePaths: readonly string[];
  readonly runtimeClass: string;
  readonly implementationSource: "production-code" | "scratchpad-report" | "mixed";
  readonly supportedContent: readonly ("movie" | "series" | "anime")[];
  readonly sourceStrategy: string;
  readonly subtitleStrategy: string;
  readonly productionGap: string;
}

export const providerResearchProfiles = [
  {
    providerId: "vidking",
    status: "production",
    migrationAction: "promote-direct-provider",
    migrationRank: 10,
    dossierPath: ".docs/provider-dossiers/vidking.md",
    evidencePaths: [
      "packages/providers/src/vidking/direct.ts",
      "apps/experiments/scratchpads/provider-vidking/HDTODAY_VIDKING_DECRYPT_REPORT.md",
      "apps/experiments/scratchpads/provider-vidking/VIDKING_NETWORK_ANALYSIS.md",
    ],
    runtimeClass: "direct-http Videasy payload decode",
    implementationSource: "mixed",
    supportedContent: ["movie", "series"],
    sourceStrategy:
      "Direct api.videasy.net sources-with-title payload; select highest-ranked source.",
    subtitleStrategy:
      "Prefer provider payload subtitle inventory, then use Wyzie only as a fallback when direct subtitles are missing.",
    productionGap: "Move direct resolver and WASM asset ownership behind the Provider SDK package.",
  },
  {
    providerId: "allanime",
    status: "production",
    migrationAction: "promote-direct-provider",
    migrationRank: 20,
    dossierPath: ".docs/provider-dossiers/allmanga.md",
    evidencePaths: ["packages/providers/src/allmanga/api-client.ts", "~/Projects/osc/ani-cli"],
    runtimeClass: "direct-http GraphQL + AES-256-CTR decode",
    implementationSource: "production-code",
    supportedContent: ["anime"],
    sourceStrategy:
      "Native GraphQL catalog/search plus decoded sourceUrls/tobeparsed stream links.",
    subtitleStrategy:
      "Provider payload or embedded HLS subtitle tracks; hard-sub streams must be labeled.",
    productionGap:
      "Keep ani-cli parity tests around search, episode lookup, tobeparsed, and source extraction.",
  },
  {
    providerId: "rivestream",
    status: "candidate",
    migrationAction: "implement-from-scratchpad",
    migrationRank: 30,
    dossierPath: ".docs/provider-dossiers/rivestream.md",
    evidencePaths: [
      "apps/experiments/scratchpads/provider-rivestream/RIVESTREAM_DECRYPT_REPORT.md",
      "apps/experiments/scratchpads/provider-rivestream/rivestream-headless.ts",
    ],
    runtimeClass: "direct-http secretKey hash API",
    implementationSource: "scratchpad-report",
    supportedContent: ["movie", "series"],
    sourceStrategy:
      "Generate secretKey locally, call backendfetch APIs, and expose direct stream variants.",
    subtitleStrategy:
      "Dedicated backendfetch subtitle endpoint returning direct subtitle inventory.",
    productionGap: "Promote hash-generation fixtures before production registration.",
  },
  {
    providerId: "miruro",
    status: "candidate",
    migrationAction: "implement-from-scratchpad",
    migrationRank: 40,
    dossierPath: ".docs/provider-dossiers/miruro.md",
    evidencePaths: [
      "apps/experiments/scratchpads/provider-miruro/MIRURO_BACKEND_REPORT.md",
      "apps/experiments/scratchpads/provider-miruro/miruro-0-ram-scraper.ts",
    ],
    runtimeClass: "direct-http pipe API by AniList ID",
    implementationSource: "mixed",
    supportedContent: ["anime"],
    sourceStrategy:
      "Bypass frontend Cloudflare by calling backend episode/media APIs with AniList IDs.",
    subtitleStrategy:
      "Provider payload or embedded HLS subtitle tracks; verify English selection through mpv.",
    productionGap:
      "Keep expanding fixtures around animal server subtitle delivery and dub/source availability.",
  },
  {
    providerId: "anikai",
    status: "candidate",
    migrationAction: "hold-for-future-runtime",
    migrationRank: 50,
    dossierPath: ".docs/provider-dossiers/anikai-candidate.md",
    evidencePaths: [
      "apps/experiments/scratchpads/provider-anikai/ANIKAI_WRAPPER_REPORT.md",
      "apps/experiments/scratchpads/provider-anikai/anikai-headless.ts",
    ],
    runtimeClass: "harvest-and-fetch with JIT Playwright fallback",
    implementationSource: "scratchpad-report",
    supportedContent: ["anime"],
    sourceStrategy:
      "Harvest Cloudflare/session state, extract AJAX link wrappers, then loop provider-local servers.",
    subtitleStrategy:
      "Treat hard-sub/server language as first-class until soft-sub endpoint is proven.",
    productionGap: "Keep out of beta until a future optional browser runtime package exists.",
  },
  {
    providerId: "cineby",
    status: "research-only",
    migrationAction: "keep-as-fallback",
    migrationRank: 70,
    dossierPath: ".docs/provider-dossiers/cineby.md",
    evidencePaths: [
      "archive/legacy/apps/cli/src/providers/cineby.ts",
      "apps/experiments/scratchpads/provider-cineby/cineby.ts",
    ],
    runtimeClass: "direct-http VidKing flavor wrapper",
    implementationSource: "mixed",
    supportedContent: ["movie", "series"],
    sourceStrategy:
      "Research wrapper targets Videasy-compatible endpoints through the VidKing direct engine.",
    subtitleStrategy:
      "Provider subtitle payload from VidKing engine; Wyzie remains the higher-level fallback.",
    productionGap:
      "Keep out of default fallback order until live validation proves endpoint stability.",
  },
  {
    providerId: "bitcine",
    status: "legacy-fallback",
    migrationAction: "keep-as-fallback",
    migrationRank: 80,
    dossierPath: ".docs/provider-dossiers/bitcine.md",
    evidencePaths: ["archive/legacy/apps/cli/src/providers/bitcine.ts"],
    runtimeClass: "Playwright legacy Cineby mirror",
    implementationSource: "production-code",
    supportedContent: ["movie", "series"],
    sourceStrategy: "Legacy Cineby mirror path; not a target SDK reference implementation.",
    subtitleStrategy: "Network sniffing only; superseded by direct provider/Wyzie handling.",
    productionGap: "Keep out of the first Provider SDK migration except as compatibility fallback.",
  },
  {
    providerId: "cineby-anime",
    status: "legacy-fallback",
    migrationAction: "keep-as-fallback",
    migrationRank: 90,
    dossierPath: ".docs/provider-dossiers/cineby-anime.md",
    evidencePaths: ["archive/legacy/apps/cli/src/providers/cineby-anime.ts"],
    runtimeClass: "Playwright legacy wrapper",
    implementationSource: "production-code",
    supportedContent: ["anime"],
    sourceStrategy: "Legacy wrapper path; prefer AllAnime now and Miruro/Anikai after promotion.",
    subtitleStrategy: "Network sniffing only; not reliable enough for the SDK reference path.",
    productionGap: "Keep out of the first Provider SDK migration except as compatibility fallback.",
  },
] as const satisfies readonly ProviderResearchProfile[];

export function getProviderResearchProfile(
  providerId: string,
): ProviderResearchProfile | undefined {
  return providerResearchProfiles.find((profile) => profile.providerId === providerId);
}

export function getProviderMigrationQueue(): readonly ProviderResearchProfile[] {
  return [...providerResearchProfiles].sort(
    (left, right) => left.migrationRank - right.migrationRank,
  );
}
