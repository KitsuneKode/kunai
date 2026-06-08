import {
  isHlsPlaylistUrl,
  parseFirstHlsMediaSegmentPath,
  resolveHlsSegmentUrl,
} from "./hls-manifest";

export type StreamReachabilityFetch = (url: string, init: RequestInit) => Promise<Response>;

export type StreamReachabilityProbeResult =
  | { readonly status: "reachable" }
  | { readonly status: "unreachable"; readonly reason: string; readonly definitive: boolean }
  | { readonly status: "timeout" };

export type ProbeStreamReachabilityInput = {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: StreamReachabilityFetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

/** Quick manifest/segment probe used before accepting a provider candidate or handing off to mpv. */
export async function probeStreamReachability(
  input: ProbeStreamReachabilityInput,
): Promise<StreamReachabilityProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(100, deadline - Date.now());
  const headers = input.headers ?? {};

  if (isHlsPlaylistUrl(input.url)) {
    return probeHlsManifest(fetchImpl, input.url, headers, remaining, input.signal);
  }

  try {
    const head = await probeHttpStatus(fetchImpl, input.url, {
      method: "HEAD",
      headers,
      remainingMs: remaining,
      parentSignal: input.signal,
    });
    if (head.status === "reachable") return head;
    if (head.status === "timeout") return head;
    if (head.status === "unreachable" && head.definitive) return head;
  } catch {
    if (Date.now() >= deadline) return { status: "timeout" };
  }

  if (Date.now() >= deadline) return { status: "timeout" };

  return probeHttpStatus(fetchImpl, input.url, {
    method: "GET",
    headers: { ...headers, Range: "bytes=0-0" },
    remainingMs: remaining,
    parentSignal: input.signal,
    healthyStatus: (status) => (status >= 200 && status < 300) || status === 206,
  });
}

/** Provider resolve gates require a reachable selected stream; timeouts are treated as unreachable. */
export function isStreamReachableForResolve(probe: StreamReachabilityProbeResult): boolean {
  return probe.status === "reachable";
}

/** mpv handoff keeps legacy leniency: inconclusive probes should not block playback. */
export function isStreamReachableForPlaybackPreflight(
  probe: StreamReachabilityProbeResult,
): boolean {
  return probe.status === "reachable" || probe.status === "timeout";
}

export function shouldAbortPlaybackForPreflight(
  probe: StreamReachabilityProbeResult,
  ipcConnected: boolean,
): boolean {
  return probe.status === "unreachable" && probe.definitive && !ipcConnected;
}

export function isHlsManifestUrl(url: string): boolean {
  return isHlsPlaylistUrl(url);
}

async function probeHlsManifest(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  headers: Record<string, string>,
  remaining: () => number,
  parentSignal?: AbortSignal,
): Promise<StreamReachabilityProbeResult> {
  if (parentSignal?.aborted || remaining() <= 0) {
    return { status: "timeout" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining());
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  let manifestText = "";
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (response.status < 200 || response.status >= 300) {
      const definitive = response.status >= 400 && response.status < 500;
      return { status: "unreachable", reason: `HTTP ${response.status}`, definitive };
    }
    manifestText = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unreachable",
      reason: message,
      definitive: isDefinitiveNetworkError(message),
    };
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }

  const segmentPath = parseFirstHlsMediaSegmentPath(manifestText);
  if (!segmentPath) {
    return { status: "reachable" };
  }

  const segmentUrl = resolveHlsSegmentUrl(url, segmentPath);
  const segmentProbe = await probeHttpStatus(fetchImpl, segmentUrl, {
    method: "GET",
    headers: { ...headers, Range: "bytes=0-8191" },
    remainingMs: remaining,
    parentSignal,
    healthyStatus: (status) => (status >= 200 && status < 300) || status === 206,
  });

  if (segmentProbe.status !== "reachable") {
    return {
      status: "unreachable",
      reason: `HLS segment unreachable: ${segmentProbe.status === "timeout" ? "timeout" : segmentProbe.reason}`,
      definitive: segmentProbe.status === "unreachable" ? segmentProbe.definitive : false,
    };
  }

  return { status: "reachable" };
}

async function probeHttpStatus(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  options: {
    readonly method: "HEAD" | "GET";
    readonly headers: Record<string, string>;
    readonly remainingMs: () => number;
    readonly parentSignal?: AbortSignal;
    readonly healthyStatus?: (status: number) => boolean;
  },
): Promise<StreamReachabilityProbeResult> {
  if (options.parentSignal?.aborted) {
    return { status: "timeout" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.remainingMs());

  const onParentAbort = () => controller.abort(options.parentSignal?.reason);
  options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const healthyStatus =
    options.healthyStatus ?? ((status: number) => status >= 200 && status < 300);

  try {
    const response = await fetchImpl(url, {
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
    });
    if (healthyStatus(response.status)) {
      return { status: "reachable" };
    }
    if (options.method === "HEAD" && (response.status === 403 || response.status === 405)) {
      throw new Error(`HEAD ${response.status}`);
    }
    const definitive = response.status >= 400 && response.status < 500;
    return { status: "unreachable", reason: `HTTP ${response.status}`, definitive };
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unreachable",
      reason: message,
      definitive: isDefinitiveNetworkError(message),
    };
  } finally {
    clearTimeout(timeout);
    options.parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

function isDefinitiveNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("connection refused") ||
    lower.includes("econnrefused") ||
    lower.includes("name or service not known") ||
    lower.includes("getaddrinfo") ||
    lower.includes("enotfound") ||
    lower.includes("unable to connect") ||
    lower.includes("certificate has expired") ||
    (lower.includes("certificate") && lower.includes("expired")) ||
    lower.includes("unsupported protocol") ||
    lower.includes("unknown scheme") ||
    lower.includes("url using bad/illegal format")
  );
}
