/**
 * Loopback OAuth callback server shared by the tracker adapters.
 *
 * Two shapes are needed:
 *
 *  - **Query callbacks** (TMDB) — the value arrives as `?approved=true`, so the
 *    server reads it directly off the request URL.
 *  - **Fragment callbacks** (AniList implicit grant) — the token arrives in the
 *    URL *fragment* (`#access_token=…`), which browsers never send to the
 *    server. The callback page therefore serves a tiny script that copies
 *    `location.hash` into a same-origin POST back to this server.
 *
 * The fragment case is why AniList works at all from a CLI: AniList's
 * authorization-code grant requires a `client_secret`, and a distributed
 * terminal app cannot hold one secretly. The implicit grant needs no secret.
 */

export type LoopbackResult =
  | { readonly ok: true; readonly params: URLSearchParams }
  | { readonly ok: false; readonly reason: "timeout" | "aborted" | "denied" };

export interface LoopbackServer {
  readonly port: number;
  readonly redirectUri: string;
  /** Resolves once the browser hits the callback, or on timeout/abort. */
  readonly result: Promise<LoopbackResult>;
  /** Stop the server early (safe to call more than once). */
  close(): void;
}

export interface LoopbackOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Read the value from the URL fragment instead of the query string. */
  readonly mode?: "query" | "fragment";
  /** Shown on the completion page. */
  readonly serviceName?: string;
}

const DEFAULT_TIMEOUT_MS = 180_000;

function completionPage(serviceName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kunai — ${serviceName}</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;background:#14101a;color:#f4eef8;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  main{text-align:center;max-width:32rem;padding:2rem}
  h1{font-size:1.4rem;margin:0 0 .5rem}
  p{opacity:.75;margin:0}
</style></head>
<body><main><h1>Connected to ${serviceName}</h1>
<p>You can close this tab and return to your terminal.</p></main></body></html>`;
}

/**
 * The fragment-capture page. It POSTs `location.hash` back to `/collect` and
 * then renders the same completion UI, so the user sees one page either way.
 */
function fragmentBridgePage(serviceName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kunai — ${serviceName}</title></head>
<body>
<script>
  (function () {
    var hash = window.location.hash.replace(/^#/, "");
    fetch("/collect", { method: "POST", body: hash })
      .then(function () { document.open(); document.write(${JSON.stringify(
        completionPage("SERVICE"),
      )}.replace("SERVICE", ${JSON.stringify(serviceName)})); document.close(); })
      .catch(function () { document.body.textContent = "Could not reach Kunai. Is it still running?"; });
  })();
</script>
</body></html>`;
}

/**
 * Bind a loopback callback server on an OS-assigned free port.
 *
 * The port is assigned by binding (`port: 0`) rather than probed first, so
 * there is no window in which another process can take the port between the
 * probe and the bind.
 */
export function startLoopbackServer(options: LoopbackOptions = {}): LoopbackServer {
  const mode = options.mode ?? "query";
  const serviceName = options.serviceName ?? "Kunai";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let settled = false;
  let resolveResult!: (value: LoopbackResult) => void;
  const result = new Promise<LoopbackResult>((resolve) => {
    resolveResult = resolve;
  });

  const settle = (value: LoopbackResult): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    // Let the response flush before tearing the socket down.
    setTimeout(() => server.stop(true), 250);
    resolveResult(value);
  };

  const onAbort = () => settle({ ok: false, reason: "aborted" });
  const timeout = setTimeout(() => settle({ ok: false, reason: "timeout" }), timeoutMs);
  options.signal?.addEventListener("abort", onAbort);

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/collect") {
        const body = await req.text();
        const params = new URLSearchParams(body);
        if (params.get("error")) {
          settle({ ok: false, reason: "denied" });
        } else {
          settle({ ok: true, params });
        }
        return new Response("ok");
      }

      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 });
      }

      if (mode === "fragment") {
        // The fragment is not in `req.url`; hand the browser the bridge page.
        return new Response(fragmentBridgePage(serviceName), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.searchParams.get("error") || url.searchParams.get("denied") === "true") {
        settle({ ok: false, reason: "denied" });
      } else {
        settle({ ok: true, params: url.searchParams });
      }
      return new Response(completionPage(serviceName), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  const port = server.port;
  if (port === undefined) {
    clearTimeout(timeout);
    server.stop(true);
    throw new Error("OAuth callback server failed to bind a port");
  }

  return {
    port,
    redirectUri: `http://localhost:${port}/callback`,
    result,
    close: () => settle({ ok: false, reason: "aborted" }),
  };
}
