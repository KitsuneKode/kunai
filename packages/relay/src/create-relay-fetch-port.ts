import { RELAYED_RESPONSE_HEADER } from "@kunai/types";

import { resolveEffectiveProviderRelayConfig } from "./resolve-relay-config";
import {
  RELAY_ERROR_CODE_HEADER,
  RELAY_RESULT_HEADER,
  RELAY_RESULT_UPSTREAM,
  type RelayRpcRequest,
} from "./types";
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
      if (entry.manifest.relaySafe !== true) return fetchImpl(input, init);
      if (!options.registry.isHostAllowed(entry.providerId, requestInfo.upstreamUrl, "metadata")) {
        return fetchImpl(input, init);
      }

      // Appended, not resolved against the base: `new URL("/rpc/x", base)`
      // treats a leading slash as absolute and drops the base's own path, so a
      // relay hosted under a sub-path (`https://host/prod`) was called at
      // `/rpc/x` and 404ed into permanent direct fallback. `normalizeRelayBaseUrl`
      // deliberately preserves that path, so it is a supported deployment.
      const relayUrl = new URL(`${baseUrl}/rpc/${encodeURIComponent(entry.providerId)}`);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (relay.token) {
        headers.Authorization = `Bearer ${relay.token}`;
      }

      try {
        const response = await fetchImpl(relayUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestInfo),
          signal: init?.signal,
          /* The relay itself never redirects (`fetchWithValidatedRedirects`
           * follows upstream hops server-side), so a 3xx on the RPC route is a
           * platform-level hop — a login wall or a stale deployment — and must
           * surface instead of being followed into a fake 200. */
          redirect: "manual",
        });
        if (fallbackToDirect && shouldFallbackToDirect(response)) {
          return fetchImpl(input, init);
        }
        return markRelayedResponse(response);
      } catch (error) {
        if (!fallbackToDirect) throw error;
        return fetchImpl(input, init);
      }
    },
  };
}

export { normalizeRelayBaseUrl } from "./normalize-relay-base-url";

/**
 * Mark responses that really came through the relay so a provider cannot
 * silently re-request the same URL direct (issue #460). Responses produced by
 * the port's own direct-fallback branches stay unmarked on purpose — the user
 * already opted into that bypass via `fallbackToDirect`.
 */
function markRelayedResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(RELAYED_RESPONSE_HEADER, "1");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Decide whether the RPC answer means "the relay did not deliver upstream data".
 *
 * A relay that ran proves it on every response: errors carry
 * {@link RELAY_ERROR_CODE_HEADER}, proxied upstream answers carry
 * {@link RELAY_RESULT_HEADER}=upstream. Any error code — auth, refusal, or
 * upstream transport — means the provider never got its upstream answer, so
 * direct is worth a try when the user opted into `fallbackToDirect`.
 *
 * Responses with neither marker are ambiguous: a 2xx is an old relay's proxied
 * success (platform failures never answer 2xx), but an unmarked non-2xx could be
 * an old relay's proxied upstream error *or* a platform crash above the function
 * (`x-vercel-error`, SSO walls, missing routes). Re-asking direct resolves the
 * ambiguity either way: a real upstream error reproduces with the same status,
 * while a dead deployment stops poisoning every provider it fronts.
 */
function shouldFallbackToDirect(response: Response): boolean {
  if (response.headers.has(RELAY_ERROR_CODE_HEADER)) return true;
  if (response.headers.get(RELAY_RESULT_HEADER) === RELAY_RESULT_UPSTREAM) return false;
  return !response.ok;
}

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
    ...(body !== undefined ? { body } : null),
  };
}

function normalizeMethod(method: string): RelayRpcRequest["method"] | null {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "POST" || upper === "HEAD") return upper;
  return null;
}

function mergeHeaders(base: RelayHeadersInit | undefined, override: RelayHeadersInit | undefined) {
  const merged: Record<string, string> = {};
  new Headers(base).forEach((value, key) => {
    merged[key] = value;
  });
  if (override) {
    new Headers(override).forEach((value, key) => {
      merged[key] = value;
    });
  }
  return merged;
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
