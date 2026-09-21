import generated from "./generated-provider-status.json";

export type ProviderSweepStatus = "healthy" | "degraded" | "blocked" | "down" | "dead";

export type ProviderStatusRow = {
  readonly id: string;
  readonly upstreamHttp: number | null;
  readonly upstreamReachable: boolean;
  readonly resolveStatus: string;
  readonly resolveMs: number | null;
  readonly streams: number;
  readonly qualities: readonly string[];
  readonly servers: readonly string[];
  readonly audioLanguages: readonly string[];
  readonly subtitleLanes: number;
  readonly effectiveStatus: ProviderSweepStatus;
  readonly note: string;
};

export type ProviderStatusFile = {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly providers: readonly ProviderStatusRow[];
};

const file = generated as ProviderStatusFile;

export const providerStatus: ProviderStatusFile = file;
