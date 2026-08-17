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
  /** Private single-attempt endpoint used only by the bridge document. */
  readonly collectorUrl: string;
  readonly result: Promise<LoopbackResult>;
  close(): void;
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
  const collectorNonce = crypto.randomUUID();
  const collectPath = `${callbackPath}/collect/${collectorNonce}`;
  const collectorUrl = new URL(collectPath, url.origin).toString();

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
    fetch: async (request) => {
      const requestUrl = new URL(request.url);

      // The callback lands here first with nothing readable: the token is after
      // `#`, which the browser never transmits. Serve the bridge and wait for it
      // to call back.
      if (requestUrl.pathname === callbackPath) {
        return bridgePage(collectPath, options.serviceName);
      }
      if (requestUrl.pathname !== collectPath) return new Response("Not found", { status: 404 });
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      if (request.headers.get("origin") !== url.origin) {
        return new Response("Forbidden", { status: 403 });
      }
      const fetchSite = request.headers.get("sec-fetch-site");
      if (fetchSite !== null && fetchSite !== "same-origin") {
        return new Response("Forbidden", { status: 403 });
      }

      const params = new URLSearchParams(await request.text());
      if (params.get("error")) {
        settle({ ok: false, reason: "denied" });
        return bridgeAck();
      }

      /** State binds this browser response to the one attempt that opened it. */
      const returnedState = params.get("state");
      if (returnedState !== options.expectedState) {
        settle({ ok: false, reason: "state-mismatch" });
        return bridgeAck();
      }

      settle({ ok: true, params });
      return bridgeAck();
    },
  });

  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener("abort", onAbort, { once: true });

  return {
    port: server.port ?? Number(url.port),
    collectorUrl,
    result,
    close: () => teardown({ ok: false, reason: "aborted" }),
  };
}

/**
 * The bridge's reply goes to a `fetch`, not to a person — the browser is
 * already showing the page that made the call, so there is nothing to render
 * and nothing to echo back.
 */
function bridgeAck(): Response {
  return new Response("ok");
}

/**
 * Moves the fragment from the browser to the listener.
 *
 * The token is handed over via same-origin `fetch` rather than a redirect or a
 * form, so it never becomes a navigation the browser records. The address bar
 * is then rewritten to drop the fragment, keeping the token out of history, and
 * nothing is ever written into the visible document.
 */
function bridgePage(collectPath: string, serviceName: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Kunai</title>
<p id="m">Completing ${serviceName} authorization…</p>
<script>
(async () => {
  const hash = location.hash.slice(1);
  try {
    await fetch(${JSON.stringify(collectPath)}, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: hash,
      credentials: "omit",
    });
    history.replaceState(null, "", location.pathname);
    document.getElementById("m").textContent =
      ${JSON.stringify(serviceName)} + " authorization complete. You can close this tab.";
  } catch {
    document.getElementById("m").textContent =
      "Could not reach Kunai. Return to the terminal and try again.";
  }
})();
</script>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
