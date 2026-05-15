export type StreamHealthFetch = (url: string, init: RequestInit) => Promise<Response>;

export type StreamHealthCheckInput = {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: StreamHealthFetch;
  readonly timeoutMs?: number;
  readonly methodPreference?: "hls-manifest-get" | "head-then-range";
};

export type StreamPreflightResult =
  | { status: "reachable" }
  | { status: "unreachable"; reason: string; definitive: boolean }
  | { status: "timeout" };

/**
 * Quick pre-flight check for stream URLs before handing to mpv.
 * Uses short timeout to avoid adding latency. On timeout or non-definitive
 * failure, the caller should proceed with mpv anyway to avoid false negatives.
 */
export async function checkStreamPreflight(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 3_000,
): Promise<StreamPreflightResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: headers ?? {},
      signal: controller.signal,
    });
    if (response.status >= 200 && response.status < 300) {
      return { status: "reachable" };
    }
    const definitive = response.status >= 400 && response.status < 500;
    return { status: "unreachable", reason: `HTTP ${response.status}`, definitive };
  } catch (err) {
    if (controller.signal.aborted) {
      return { status: "timeout" };
    }
    const message = err instanceof Error ? err.message : String(err);
    const definitive = isDefinitiveNetworkError(message);
    return { status: "unreachable", reason: message, definitive };
  } finally {
    clearTimeout(timeout);
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
    lower.includes("certificate has expired") ||
    (lower.includes("certificate") && lower.includes("expired")) ||
    lower.includes("unsupported protocol") ||
    lower.includes("unknown scheme") ||
    lower.includes("url using bad/illegal format")
  );
}

/** Validates that a cached stream URL is still reachable without downloading the full asset. */
export async function checkStreamHealth(input: StreamHealthCheckInput): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;

  if (input.methodPreference === "hls-manifest-get") {
    return attemptStreamHealthFetch(fetchImpl, input.url, {
      method: "GET",
      headers: { ...input.headers },
      timeoutMs,
      healthyStatus: (status) => status >= 200 && status < 300,
    });
  }

  if (
    await attemptStreamHealthFetch(fetchImpl, input.url, {
      method: "HEAD",
      headers: { ...input.headers },
      timeoutMs,
      healthyStatus: (status) => status >= 200 && status < 300,
    })
  ) {
    return true;
  }

  return attemptStreamHealthFetch(fetchImpl, input.url, {
    method: "GET",
    headers: { ...input.headers, Range: "bytes=0-0" },
    timeoutMs,
    healthyStatus: (status) => (status >= 200 && status < 300) || status === 206,
  });
}

async function attemptStreamHealthFetch(
  fetchImpl: StreamHealthFetch,
  url: string,
  options: {
    readonly method: "HEAD" | "GET";
    readonly headers: Record<string, string>;
    readonly timeoutMs: number;
    readonly healthyStatus: (status: number) => boolean;
  },
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
    });
    return options.healthyStatus(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
