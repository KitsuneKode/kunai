import type { MobileHttpPort, MobileHttpRequest } from "../../application/contracts";

type TimeoutToken = unknown;
type AndroidFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type BunHttpRuntime = {
  readonly fetch: AndroidFetch;
  readonly scheduleTimeout: (callback: () => void, milliseconds: number) => TimeoutToken;
  readonly cancelTimeout: (token: TimeoutToken) => void;
};

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function requireHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported protocol");
  }
  return url;
}

async function countBodyBytes(response: Response, maxBytes: number): Promise<number> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("response too large");
  }
  if (!response.body) return 0;

  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return bytes;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("response too large");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createBunHttpPort(overrides: Partial<BunHttpRuntime> = {}): MobileHttpPort {
  const runtime: BunHttpRuntime = {
    fetch: (input, init) => fetch(input, init),
    scheduleTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    cancelTimeout: (token) => clearTimeout(token as ReturnType<typeof setTimeout>),
    ...overrides,
  };

  return {
    async request(request: MobileHttpRequest) {
      const controller = new AbortController();
      const timeout = runtime.scheduleTimeout(
        () => controller.abort("mobile-http-timeout"),
        request.timeoutMs,
      );
      try {
        let url = requireHttpUrl(request.url);
        for (let redirects = 0; ; redirects += 1) {
          const response = await runtime.fetch(url, {
            method: request.method,
            redirect: "manual",
            signal: controller.signal,
          });
          if (!REDIRECT_STATUSES.has(response.status)) {
            return {
              status: response.status,
              bytes: await countBodyBytes(response, request.maxBytes),
            };
          }
          if (redirects >= MAX_REDIRECTS) throw new Error("too many redirects");
          const location = response.headers.get("location");
          if (!location) throw new Error("redirect missing location");
          url = requireHttpUrl(new URL(location, url).toString());
        }
      } finally {
        runtime.cancelTimeout(timeout);
      }
    },
  };
}
