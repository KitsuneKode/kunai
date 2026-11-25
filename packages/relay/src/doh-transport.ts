import { gunzipSync, brotliDecompressSync, inflateSync } from "node:zlib";

import { createPinnedRelayTransport, type RelayResolvedAddress } from "./pinned-transport";
import type { RelayFetch, RelayTransport } from "./types";

/**
 * DNS-over-HTTPS through Cloudflare's IP-literal endpoint. The literal means
 * the resolver itself needs no DNS bootstrap, and Cloudflare's certificate
 * covers the IP. Provider frontends and APIs are exactly the domains ISP-grade
 * DNS poisoning sinkholes in the regions that need them most — verified live
 * 2026-11-25: `scrapper.rivestream.app` sinkholed to 49.44.79.236 on the system
 * resolver while answering 200 through DoH resolution on the same network.
 */
const DOH_ENDPOINT = "https://1.1.1.1/dns-query";
const DOH_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 5;
/** Metadata and manifests only — media bytes never flow through this port. */
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 64 * 1024 * 1024;

type DohAnswer = { readonly type?: number; readonly data?: unknown };

async function queryDoh(
  hostname: string,
  type: 1 | 28,
  baseFetch: RelayFetch,
): Promise<readonly RelayResolvedAddress[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
  try {
    const response = await baseFetch(
      `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal: controller.signal },
    );
    if (!response.ok) return [];
    const json = (await response.json()) as { readonly Answer?: readonly DohAnswer[] };
    const family = type === 1 ? 4 : 6;
    return (json.Answer ?? []).flatMap((answer) =>
      answer.type === type && typeof answer.data === "string"
        ? [{ address: answer.data, family: family as 4 | 6 }]
        : [],
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve through DoH, falling back to the system resolver when DoH itself is
 * unreachable. The fallback cannot make things worse than the status quo —
 * poisoned answers are what the system resolver already produces — while a
 * working DoH path is the whole point. v4 is preferred; v6 is only used when
 * no v4 answer exists, matching the happy-eyeballs reality of these CDNs.
 */
export function createDohAddressResolver(
  baseFetch: RelayFetch,
  systemResolve: (hostname: string) => Promise<readonly RelayResolvedAddress[]>,
): (hostname: string) => Promise<readonly RelayResolvedAddress[]> {
  return async (hostname) => {
    const v4 = await queryDoh(hostname, 1, baseFetch);
    if (v4.length > 0) return v4;
    const v6 = await queryDoh(hostname, 28, baseFetch);
    if (v6.length > 0) return v6;
    return systemResolve(hostname);
  };
}

/**
 * A fetch-shaped transport that resolves names through DNS-over-HTTPS and
 * dials the validated answer set directly, following redirects hop by hop.
 * Built on the relay-server-proven pinned transport; adds the two semantics
 * Bun's native fetch has that the raw transport does not: redirect following
 * and content-encoding decompression.
 */
export function createDohTransport(baseFetch: RelayFetch = fetch): RelayTransport {
  const pinned = createPinnedRelayTransport({
    resolveAddresses: createDohAddressResolver(baseFetch, async (hostname) => {
      const { lookup } = await import("node:dns/promises");
      const answers = await lookup(hostname, { all: true, verbatim: true });
      return answers.flatMap(({ address, family }) =>
        family === 4 || family === 6 ? [{ address, family }] : [],
      );
    }),
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    maxResponseBodyBytes: MAX_RESPONSE_BODY_BYTES,
  });

  const once = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const response = await pinned(input, init);
    const encoding = response.headers.get("content-encoding")?.toLowerCase();
    if (!encoding) return response;
    const decompress =
      encoding === "gzip"
        ? gunzipSync
        : encoding === "br"
          ? brotliDecompressSync
          : encoding === "deflate"
            ? inflateSync
            : null;
    if (!decompress) return response;
    const compressed = new Uint8Array(await response.arrayBuffer());
    let plain: Uint8Array;
    try {
      plain = decompress(compressed);
    } catch {
      return new Response(null, { status: 502, statusText: "upstream-body-decode-error" });
    }
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(plain as unknown as BodyInit, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  return async (input, init) => {
    let url = input instanceof URL ? input : new URL(String(input));
    let method = (init?.method ?? "GET").toUpperCase();
    let body = init?.body;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await once(url, {
        ...init,
        method,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      await response.body?.cancel().catch(() => undefined);
      const next = new URL(location, url);
      // Cross-origin redirects drop credentials, matching fetch semantics.
      const headers = new Headers(init?.headers);
      if (next.host !== url.host) {
        headers.delete("authorization");
        headers.delete("cookie");
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          method !== "GET" &&
          method !== "HEAD")
      ) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
        headers.delete("content-length");
      }
      url = next;
      init = { ...init, headers };
    }
    throw new Error(`DoH transport: redirect loop beyond ${MAX_REDIRECTS} hops`);
  };
}
