import { randomBytes } from "node:crypto";

export interface LoopbackOptions {
  readonly redirectUri: string;
  readonly expectedState: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly serviceName: string;
}

export type LoopbackResult =
  | { readonly ok: true; readonly params: URLSearchParams }
  | {
      readonly ok: false;
      readonly reason: "timeout" | "aborted" | "denied" | "state-mismatch";
    };

export interface LoopbackServer {
  readonly port: number;
  readonly result: Promise<LoopbackResult>;
  close(): void;
}

/**
 * A single-use nonce binding the callback to the request that opened it.
 *
 * 32 bytes of CSPRNG output, base64url so it survives a query string unescaped.
 * Without this the loopback listener accepts an authorization code from anything
 * that can reach the port, which on a shared machine is every local process.
 */
export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Listen for one OAuth callback on the exact registered loopback address.
 *
 * The host and port come from the configured redirect URI and are bound as-is.
 * If that port is taken, binding throws rather than falling back to another —
 * a different port cannot match the URI registered with the provider, so
 * "succeeding" on one only defers the failure to the token exchange, which is
 * precisely the bug this replaces.
 */
export function startLoopbackServer(options: LoopbackOptions): LoopbackServer {
  const url = new URL(options.redirectUri);
  const callbackPath = url.pathname;

  let settled = false;
  let resolveResult!: (value: LoopbackResult) => void;
  const result = new Promise<LoopbackResult>((resolve) => {
    resolveResult = resolve;
  });

  /**
   * Deciding the outcome and tearing down the listener are separate steps.
   *
   * A callback still has a response to flush, and force-closing from inside the
   * handler resets the browser's connection — the user sees a failure page for
   * an authorization that actually succeeded. A graceful stop is no better:
   * the browser holds the connection open, so the port stays bound and the next
   * attempt cannot claim the registered address.
   *
   * So the handler only resolves, and the caller closes in a `finally`. Timeout
   * and abort have nothing in flight and tear down immediately.
   */
  const settle = (value: LoopbackResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
    resolveResult(value);
  };

  const teardown = (value: LoopbackResult) => {
    settle(value);
    server.stop(true);
  };

  const onAbort = () => teardown({ ok: false, reason: "aborted" });
  const timer = setTimeout(() => teardown({ ok: false, reason: "timeout" }), options.timeoutMs);

  const server = Bun.serve({
    port: Number(url.port),
    hostname: url.hostname,
    fetch: (request) => {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname !== callbackPath) return new Response("Not found", { status: 404 });

      const params = requestUrl.searchParams;
      if (params.get("error")) {
        settle({ ok: false, reason: "denied" });
        return page(`${options.serviceName} authorization was declined.`);
      }

      // State is compared before the code is read at all. A callback whose
      // state does not match did not come from the request we started, and an
      // absent one is treated the same way: the provider echoes it back, so
      // missing means this is not our redirect.
      if (params.get("state") !== options.expectedState) {
        settle({ ok: false, reason: "state-mismatch" });
        return page(`${options.serviceName} authorization could not be verified.`);
      }

      settle({ ok: true, params });
      // Shown in the user's browser, where it can be screenshotted, shared, or
      // restored from history — so it echoes nothing back.
      return page(`${options.serviceName} authorization complete. You can close this tab.`);
    },
  });

  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener("abort", onAbort, { once: true });

  return {
    port: server.port ?? Number(url.port),
    result,
    close: () => teardown({ ok: false, reason: "aborted" }),
  };
}

function page(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Kunai</title><p>${message}</p>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
