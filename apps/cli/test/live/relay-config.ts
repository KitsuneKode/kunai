import { fileURLToPath } from "node:url";

export interface RawRelayDiagnosticConfig {
  readonly providerRelay?: {
    readonly enabled?: boolean;
    readonly baseUrl?: string;
    readonly token?: string;
    readonly providers?: Record<string, { readonly enabled?: boolean } | undefined>;
  };
}

export type RelayDiagnosticResolution =
  | { readonly kind: "skip"; readonly reason: string }
  | {
      readonly kind: "run";
      readonly baseUrl: string;
      readonly token: string;
      readonly source: "env" | "config";
      readonly displayOrigin: string;
      readonly tokenPresent: boolean;
      readonly forcesAllAnime: boolean;
    };

function present(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function relayDisplayOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("relay URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("relay URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("relay URL must not contain embedded credentials");
  }
  return url.origin;
}

export function resolveRelayDiagnosticConfig(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly config?: RawRelayDiagnosticConfig;
  readonly configPath: string;
}): RelayDiagnosticResolution {
  const relay = input.config?.providerRelay;
  const environmentBaseUrl = present(input.env.KUNAI_RELAY_BASE_URL);
  const configuredBaseUrl = present(relay?.baseUrl);

  if (!environmentBaseUrl) {
    if (!input.config) {
      return { kind: "skip", reason: `no config file at ${input.configPath}` };
    }
    if (!configuredBaseUrl) {
      return {
        kind: "skip",
        reason: `no providerRelay.baseUrl in ${input.configPath} - set one via /settings or pass KUNAI_RELAY_BASE_URL`,
      };
    }
    if (relay?.enabled === false) {
      return {
        kind: "skip",
        reason: `providerRelay.enabled is false in ${input.configPath}`,
      };
    }
  }

  const baseUrl = environmentBaseUrl ?? configuredBaseUrl;
  if (!baseUrl) {
    return { kind: "skip", reason: "relay URL is unavailable" };
  }

  const token = present(input.env.KUNAI_RELAY_TOKEN) ?? present(relay?.token) ?? "";
  const safeFields = {
    kind: "run" as const,
    source: environmentBaseUrl ? ("env" as const) : ("config" as const),
    displayOrigin: relayDisplayOrigin(baseUrl),
    tokenPresent: token.length > 0,
    forcesAllAnime: relay?.providers?.allanime?.enabled === false,
  };

  // The full URL and token are execution-only fields. Keeping them
  // non-enumerable prevents accidental disclosure through JSON diagnostics.
  return Object.defineProperties(safeFields, {
    baseUrl: { value: baseUrl, enumerable: false },
    token: { value: token, enumerable: false },
  }) as RelayDiagnosticResolution;
}

export function relayAllAnimeSmokePath(metaUrl: string): string {
  return fileURLToPath(new URL("./relay-allanime.smoke.ts", metaUrl));
}

export function relayHealthUrl(baseUrl: string): string {
  return new URL("/health", relayDisplayOrigin(baseUrl)).toString();
}

export function relayHealthFailureCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "network-error";
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_-]{1,31}$/.test(code) ? code : "network-error";
}
