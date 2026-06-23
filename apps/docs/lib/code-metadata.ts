import generated from "./generated-metadata.json";

export type ProviderMetadata = {
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

export type CodeMetadata = {
  readonly syncedAt: string;
  readonly version: string;
  readonly cliVersion: string;
  readonly commandCount: number;
  readonly providerIds: readonly string[];
  readonly providers: readonly ProviderMetadata[];
  readonly commands: readonly CommandMetadata[];
  readonly cliOptions: readonly CliOptionMetadata[];
  readonly featureStatus: readonly FeatureStatusMetadata[];
  readonly runtimeBaseline: RuntimeBaselineMetadata;
};

export const codeMetadata = generated as CodeMetadata;
