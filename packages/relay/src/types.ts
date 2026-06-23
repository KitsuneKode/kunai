import type { CoreProviderManifest } from "@kunai/core";
import type {
  ProviderFetchPort,
  ProviderId,
  ProviderRelayConfig,
  RelayProfile,
} from "@kunai/types";

export type {
  ProviderRelayConfig,
  ProviderRelayProviderConfig,
  RelayErrorCode,
  RelayMethod,
  RelayProfile,
  RelayRpcErrorBody,
  RelayRpcRequest,
} from "@kunai/types";

export type RelayableProviderManifest = CoreProviderManifest & {
  readonly relayProfile?: RelayProfile;
};

export interface RelayProviderEntry {
  readonly providerId: ProviderId;
  readonly manifest: RelayableProviderManifest;
  readonly profile: RelayProfile;
}

export interface ProviderRelayRegistry {
  readonly providers: readonly RelayProviderEntry[];
  get(providerId: string): RelayProviderEntry | undefined;
  findByUpstreamUrl(url: string | URL): RelayProviderEntry | undefined;
  isHostAllowed(providerId: string, url: string | URL, kind: "metadata" | "media"): boolean;
}

export type RelayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RelayHandlerOptions {
  readonly providerId: string;
  readonly registry: ProviderRelayRegistry;
  readonly fetch?: RelayFetch;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
}

export interface RelayFetchPortOptions {
  readonly relayConfig: ProviderRelayConfig | undefined;
  readonly env?: {
    readonly baseUrl?: string;
    readonly token?: string;
  };
  readonly registry: ProviderRelayRegistry;
  readonly fetch?: RelayFetch;
  readonly providerId?: string;
}

export type RelayFetchPort = ProviderFetchPort;

export const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024;
export const DEFAULT_MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_RELAY_TIMEOUT_MS = 20_000;
