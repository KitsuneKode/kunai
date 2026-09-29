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
  isHostAllowed(providerId: string, url: string | URL, kind: "metadata"): boolean;
}

export type RelayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RelayTransport = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type RelayConnectionDiagnosticCode =
  | "ECONNREFUSED"
  | "ECONNRESET"
  | "EHOSTUNREACH"
  | "ENETUNREACH"
  | "ETIMEDOUT"
  | "CONNECTION_FAILED";

export type RelayDnsDiagnosticCode =
  | "ABORT_ERR"
  | "EAI_AGAIN"
  | "ENOTFOUND"
  | "DNS_LOOKUP_FAILED"
  | "NO_ADDRESSES";

export type RelayTransportDiagnostic =
  | {
      readonly event: "dns-failed";
      readonly providerId?: string;
      readonly hostname: string;
      readonly code: RelayDnsDiagnosticCode;
    }
  | {
      readonly event: "dns-rejected";
      readonly providerId?: string;
      readonly hostname: string;
      readonly answerCount: number;
      readonly families: readonly (4 | 6)[];
      readonly code: "NON_PUBLIC_ADDRESS";
    }
  | {
      readonly event: "connection-failed";
      readonly providerId?: string;
      readonly hostname: string;
      readonly family: 4 | 6;
      readonly attempt: number;
      readonly answerCount: number;
      readonly code: RelayConnectionDiagnosticCode;
    };

export type RelayDiagnosticSink = (diagnostic: RelayTransportDiagnostic) => void;

export type RelayAuthorizationPolicy =
  | { readonly mode: "local-loopback" }
  | { readonly mode: "bearer"; readonly token: string };

export interface RelayHandlerOptions {
  readonly providerId: string;
  readonly registry: ProviderRelayRegistry;
  readonly authorization: RelayAuthorizationPolicy;
  readonly transport?: RelayTransport;
  readonly diagnostics?: RelayDiagnosticSink;
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
export { RELAY_HOP_HEADER } from "@kunai/types";

export const RELAY_ERROR_CODE_HEADER = "X-Kunai-Relay-Error-Code";
