import type {
  CachePolicy,
  MediaKind,
  ProviderCapability,
  ProviderId,
  ProviderRuntimePort,
} from "@kunai/types";

export interface CoreProviderManifest {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly mediaKinds: readonly MediaKind[];
  readonly capabilities: readonly ProviderCapability[];
  readonly runtimePorts: readonly ProviderRuntimePort[];
  readonly cachePolicy: CachePolicy;
  readonly browserSafe: boolean;
  readonly relaySafe: boolean;
  readonly status: ProviderManifestStatus;
  readonly notes?: readonly string[];
}

export type ProviderManifestStatus = "production" | "candidate" | "experimental" | "research";

export function assertManifestHasRuntimePort(
  manifest: CoreProviderManifest,
  runtime: ProviderRuntimePort["runtime"],
): ProviderRuntimePort {
  const port = manifest.runtimePorts.find((candidate) => candidate.runtime === runtime);
  if (!port) {
    throw new Error(`${manifest.id} does not declare ${runtime} runtime support`);
  }

  return port;
}
