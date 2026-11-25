import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib";

import { proxyAppliesTo, shouldBypassDoh, type DohAddress, type DohResolver } from "@kunai/core";

import { RelayValidationError } from "./forward-headers";
import { createPinnedRelayTransport } from "./pinned-transport";
import type { RelayFetch, RelayTransport } from "./types";

const MAX_REDIRECTS = 5;
/** Metadata and manifests only: media bytes are fetched by the player, never here. */
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 64 * 1024 * 1024;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export interface DohFetchOptions {
  readonly resolver: DohResolver;
  /** What every request falls back to, and what bypassed hosts use: system DNS. */
  readonly baseFetch?: RelayFetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Builds the transport that dials a resolved answer set. Defaults to the
   * relay's pinned transport (TLS verified against the original hostname).
   */
  readonly createTransport?: (answers: readonly DohAddress[]) => RelayTransport;
}

/**
 * A fetch whose public hostnames resolve through DNS-over-HTTPS and whose
 * socket dials the resolved address with TLS still verified against the
 * original hostname (`servername`). Everything that DoH cannot or must not
 * handle goes to `baseFetch` unchanged:
 *
 * - IP literals, `localhost`, single-label and private-suffix names (a
 *   self-hosted addon on `nas.lan`);
 * - requests an `HTTPS_PROXY`/`HTTP_PROXY` would carry;
 * - names DoH cannot answer (breaker open, NXDOMAIN, resolver unreachable);
 * - public names whose DoH answer is a private address.
 *
 * Redirects are followed hop by hop so each new host gets the same decision.
 * `redirect: "manual"` and `"error"` keep fetch semantics.
 */
export function createDohFetch(options: DohFetchOptions): RelayFetch {
  const baseFetch: RelayFetch = options.baseFetch ?? ((input, init) => fetch(input, init));
  const env = options.env ?? process.env;
  const createTransport =
    options.createTransport ??
    ((answers: readonly DohAddress[]) =>
      createPinnedRelayTransport({
        resolveAddresses: async () => answers,
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        maxResponseBodyBytes: MAX_RESPONSE_BODY_BYTES,
      }));

  const hop = async (url: URL, init: RequestInit): Promise<Response> => {
    if (shouldBypassDoh(url.hostname) || proxyAppliesTo(url, env)) {
      return baseFetch(url, { ...init, redirect: "manual" });
    }
    const answers = await options.resolver.resolve(url.hostname, init.signal ?? undefined);
    if (!answers) return baseFetch(url, { ...init, redirect: "manual" });
    const pinned = createTransport(answers);
    try {
      return decodeContent(await pinned(url, init));
    } catch (error) {
      // A public name answering with a private address is either split-horizon
      // DNS or a hostile answer; either way the system resolver is the status quo.
      if (error instanceof RelayValidationError && error.code === "host-not-allowed") {
        return baseFetch(url, { ...init, redirect: "manual" });
      }
      throw error;
    }
  };

  return async (input, init = {}) => {
    const request = input instanceof Request ? input : undefined;
    let url = new URL(request ? request.url : String(input));
    const headers = new Headers(request?.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    let method = (init.method ?? request?.method ?? "GET").toUpperCase();
    let body: RequestInit["body"] =
      init.body ??
      (request && method !== "GET" && method !== "HEAD" ? await request.arrayBuffer() : undefined);
    const signal = init.signal ?? request?.signal;
    const redirectMode = init.redirect ?? request?.redirect ?? "follow";

    for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
      const response = await hop(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        signal,
      });
      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || !location || redirectMode === "manual") {
        return withFinalUrl(response, url, hops > 0);
      }
      await response.body?.cancel().catch(() => undefined);
      if (redirectMode === "error") throw new TypeError(`Redirect to ${location} was refused`);
      const next = new URL(location, url);
      if (next.origin !== url.origin) {
        // Credentials stay with the origin they were sent to, as fetch does.
        headers.delete("authorization");
        headers.delete("cookie");
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === "POST")
      ) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
        headers.delete("content-length");
      }
      url = next;
    }
    throw new TypeError(`Too many redirects (more than ${MAX_REDIRECTS})`);
  };
}

function decoderFor(encoding: string | undefined): ((input: Uint8Array) => Uint8Array) | null {
  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return gunzipSync;
    case "br":
      return brotliDecompressSync;
    case "deflate":
      return inflateSync;
    case "zstd":
      return zstdDecompressSync;
    default:
      return null;
  }
}

/** Bun's fetch decodes `Content-Encoding`; a raw socket does not, so do it here. */
async function decodeContent(response: Response): Promise<Response> {
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  const decode = decoderFor(encoding);
  if (!decode) return response;
  let plain: Uint8Array;
  try {
    plain = decode(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return new Response(null, { status: 502, statusText: "upstream-body-decode-error" });
  }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  // Copy into a plain ArrayBuffer: zlib may hand back a view over shared memory.
  return new Response(Uint8Array.from(plain).buffer, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * A constructed `Response` has an empty `url`; callers read it to learn where
 * a redirect chain ended (same-host checks, relative manifest references).
 */
function withFinalUrl(response: Response, url: URL, redirected: boolean): Response {
  if (response.url === url.href) return response;
  Object.defineProperty(response, "url", { value: url.href });
  if (redirected) Object.defineProperty(response, "redirected", { value: true });
  return response;
}
