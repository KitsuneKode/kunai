import generated from "./generated-metadata.json";

export type ProviderMetadata = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly mediaKinds: readonly string[];
  readonly capabilities: readonly string[];
  readonly notes: readonly string[];
};

export type CommandMetadata = {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly description: string;
};

export type CliOptionMetadata = {
  readonly short: string;
  readonly long: string;
  readonly description: string;
};

export type FeatureStatusMetadata = {
  readonly id: string;
  readonly label: string;
  readonly status: "shipped" | "beta" | "planned";
  readonly description: string;
};

export type RuntimeBaselineMetadata = {
  readonly bun: string;
  readonly mpv: string;
};

export type PublicShortcutMetadata = {
  readonly id: string;
  readonly scope: string;
  readonly group: string;
  readonly keys: string;
  readonly label: string;
  readonly tier: "core" | "surface";
  readonly order: number;
};

export type ProviderLaneMetadata = {
  readonly defaultProvider: string;
  readonly fallbackPriority: readonly string[];
  readonly order: readonly string[];
};

export type ProviderDefaultsMetadata = {
  readonly revision: number;
  readonly series: ProviderLaneMetadata;
  readonly anime: ProviderLaneMetadata;
  readonly youtube: ProviderLaneMetadata;
};

export type ReleaseTargetMetadata = {
  readonly id: string;
  readonly triple: string;
  readonly out: string;
  readonly os: string;
  readonly arch: string;
  readonly libc: string | undefined;
  readonly supportTier: "supported" | "beta" | "experimental";
  readonly archiveName: string;
};

export type PlayerSupportMetadata = {
  readonly desktopManagedPlayers: readonly string[];
  readonly androidTargets: readonly string[];
};

export type CodeMetadata = {
  readonly version: string;
  readonly cliVersion: string;
  readonly commandCount: number;
  readonly providerIds: readonly string[];
  readonly providers: readonly ProviderMetadata[];
  readonly commands: readonly CommandMetadata[];
  readonly cliOptions: readonly CliOptionMetadata[];
  readonly featureStatus: readonly FeatureStatusMetadata[];
  readonly runtimeBaseline: RuntimeBaselineMetadata;
  readonly shortcuts: readonly PublicShortcutMetadata[];
  readonly providerDefaults: ProviderDefaultsMetadata;
  readonly releaseTargets: readonly ReleaseTargetMetadata[];
  readonly playerSupport: PlayerSupportMetadata;
};

export const codeMetadata = generated as CodeMetadata;
