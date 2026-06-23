import { resolveEffectiveProviderRelayConfig } from "./resolve-relay-config";
import type { RelayRpcRequest } from "./types";
import type { RelayFetchPort, RelayFetchPortOptions } from "./types";

type RelayHeadersInit = ConstructorParameters<typeof Headers>[0];

export function createRelayFetchPort(options: RelayFetchPortOptions): RelayFetchPort {
  const fetchImpl = options.fetch ?? fetch;
  const relay = resolveEffectiveProviderRelayConfig(options.relayConfig, options.env);
  const baseUrl = relay.baseUrl;
  const fallbackToDirect = relay.fallbackToDirect ?? true;

  return {
    runtime: "direct-http",
    async fetch(input, init) {
      if (!baseUrl) return fetchImpl(input, init);

      const requestInfo = await toRelayRequest(input, init);
      if (!requestInfo) return fetchImpl(input, init);
      const entry = options.providerId
        ? options.registry.get(options.providerId)
        : options.registry.findByUpstreamUrl(requestInfo.upstreamUrl);
      if (!entry) return fetchImpl(input, init);

      const providerConfig = relay.providers?.[entry.providerId];
      if (providerConfig?.enabled === false) return fetchImpl(input, init);
      if (!options.registry.isHostAllowed(entry.providerId, requestInfo.upstreamUrl, "metadata")) {
        return fetchImpl(input, init);
      }

      const relayUrl = new URL(`/rpc/${entry.providerId}`, baseUrl);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (relay.token) {
        headers.Authorization = `Bearer ${relay.token}`;
      }

      try {
        return await fetchImpl(relayUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestInfo),
          signal: init?.signal,
        });
      } catch (error) {
        if (!fallbackToDirect) throw error;
        return fetchImpl(input, init);
      }
    },
  };
}

export { normalizeRelayBaseUrl } from "./normalize-relay-base-url";

async function toRelayRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<RelayRpcRequest | null> {
  const request = input instanceof Request ? input : undefined;
  const upstreamUrl =
    input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
  const method = normalizeMethod(init?.method ?? request?.method ?? "GET");
  if (!method) return null;
  const headers = mergeHeaders(request?.headers, init?.headers);
  const body = method === "GET" || method === "HEAD" ? undefined : await bodyToString(input, init);

  return {
    method,
    upstreamUrl,
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}

function normalizeMethod(method: string): RelayRpcRequest["method"] | null {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "POST" || upper === "HEAD") return upper;
  return null;
}

function mergeHeaders(base: RelayHeadersInit | undefined, override: RelayHeadersInit | undefined) {
  const headers = new Headers(base);
  if (override) {
    new Headers(override).forEach((value, key) => headers.set(key, value));
  }
  return Object.fromEntries(headers.entries());
}

async function bodyToString(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<string | undefined> {
  if (typeof init?.body === "string") return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (init?.body instanceof ArrayBuffer) return new TextDecoder().decode(init.body);
  if (ArrayBuffer.isView(init?.body)) return new TextDecoder().decode(init.body);
  if (init?.body) return new Response(init.body).text();
  if (input instanceof Request) return input.clone().text();
  return undefined;
}
