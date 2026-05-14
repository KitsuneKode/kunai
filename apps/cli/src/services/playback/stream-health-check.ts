export type StreamHealthFetch = (url: string, init: RequestInit) => Promise<Response>;

export type StreamHealthCheckInput = {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: StreamHealthFetch;
  readonly timeoutMs?: number;
};

/** Validates that a cached stream URL is still reachable without downloading the full asset. */
export async function checkStreamHealth(input: StreamHealthCheckInput): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;

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
