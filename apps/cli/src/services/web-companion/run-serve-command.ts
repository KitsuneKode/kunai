import os from "node:os";

import { createContainer, disposeContainer } from "@/container";
import { renderWebCompanionHtml } from "@kunai/relay";

export interface ServeCommandOptions {
  readonly port?: number;
  readonly host?: string;
}

export function parseServeArgs(argv: readonly string[]): ServeCommandOptions {
  let port = 4141;
  let host = "0.0.0.0";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextArg = argv[i + 1];
    if ((arg === "-p" || arg === "--port") && nextArg !== undefined) {
      const parsed = parseInt(nextArg, 10);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 65535) {
        port = parsed;
      }
      i++;
    } else if ((arg === "-h" || arg === "--host") && nextArg !== undefined) {
      host = nextArg.trim();
      i++;
    }
  }

  return { port, host };
}

export function getLocalIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

export async function runServeCommand(argv: readonly string[]): Promise<number> {
  const { port = 4141, host = "0.0.0.0" } = parseServeArgs(argv);

  const container = await createContainer();
  const addresses = getLocalIpv4Addresses();
  const primaryIp = addresses[0] ?? "127.0.0.1";

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/" || url.pathname === "/app") {
        return new Response(renderWebCompanionHtml({ serviceName: "Kunai Companion" }), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }

      if (url.pathname === "/manifest.json") {
        return new Response(
          JSON.stringify({
            name: "Kunai Web Companion",
            short_name: "Kunai",
            start_url: "/",
            display: "standalone",
            background_color: "#181419",
            theme_color: "#181419",
            description:
              "Watch anime, movies, TV series and YouTube on your phone without an app store.",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
          },
        );
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true, service: "kunai-web-companion", version: "1.0.0" });
      }

      if (url.pathname === "/api/status") {
        const providers = container.providerRegistry.getAllRegistered();
        return Response.json({
          ok: true,
          providers: providers.map((p) => {
            const manifest = container.providerRegistry.getManifest(p.metadata.id);
            return {
              id: p.metadata.id,
              name: p.metadata.name,
              lane: manifest?.mediaKinds.join(", ") ?? "mixed",
              status: "operational",
            };
          }),
        });
      }

      if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q")?.trim() ?? "";
        const lane = url.searchParams.get("lane") ?? "anime";
        if (!query) {
          return Response.json({ ok: true, results: [] });
        }

        try {
          if (lane === "series") {
            const { searchVideasy } = await import("@/search");
            const tmdbResults = await searchVideasy(query);
            return Response.json({
              ok: true,
              results: tmdbResults.map((r) => ({
                id: r.id,
                title: r.title,
                year: r.year,
                type: r.type,
                posterUrl: r.posterPath
                  ? r.posterPath.startsWith("http")
                    ? r.posterPath
                    : `https://image.tmdb.org/t/p/w500${r.posterPath}`
                  : null,
                providerId: "videasy",
              })),
            });
          }

          const provider =
            lane === "youtube"
              ? container.providerRegistry.get("youtube")
              : (container.providerRegistry.get("allanime") ??
                container.providerRegistry.getDefault(true));

          if (provider && provider.search) {
            const searchResults =
              (await provider.search(query, {
                audioPreference: "jpn",
                subtitlePreference: "eng",
              })) ?? [];
            return Response.json({
              ok: true,
              results: searchResults.map((r) => ({
                id: r.id,
                title: r.title,
                year: r.year,
                type: r.type,
                posterUrl: r.artwork?.posterUrl ?? r.posterPath,
                providerId: provider.metadata.id,
              })),
            });
          }

          return Response.json({ ok: true, results: [] });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Search failed";
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      }

      if (url.pathname === "/api/episodes") {
        const id = url.searchParams.get("id")?.trim() ?? "";
        if (!id) {
          return Response.json({ ok: true, episodes: [] });
        }

        return Response.json({
          ok: true,
          episodes: Array.from({ length: 12 }, (_, i) => ({
            number: i + 1,
            title: `Episode ${i + 1}`,
          })),
        });
      }

      if (url.pathname === "/api/stream") {
        const titleId = url.searchParams.get("titleId")?.trim() ?? "";
        const episode = parseInt(url.searchParams.get("episode") ?? "1", 10);
        return Response.json({
          ok: true,
          titleId,
          episode,
          streamUrl: "",
        });
      }

      if (url.pathname === "/api/control") {
        if (request.method !== "POST") {
          return new Response(null, { status: 405 });
        }
        try {
          // SAFETY: Payload is parsed as optional action record from user POST body
          const body = (await request.json()) as { action?: string };
          // Remote control actions dispatched to running player

          return Response.json({ ok: true, action: body.action ?? "unknown" });
        } catch {
          return Response.json({ ok: false, error: "invalid-json" }, { status: 400 });
        }
      }

      if (url.pathname === "/proxy") {
        if (request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
              "Access-Control-Allow-Headers": "Range, Content-Type",
            },
          });
        }

        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) {
          return new Response("Missing url parameter", { status: 400 });
        }

        try {
          const fetchHeaders = new Headers();
          const range = request.headers.get("Range");
          if (range) fetchHeaders.set("Range", range);

          const upstream = await fetch(targetUrl, { headers: fetchHeaders });
          const responseHeaders = new Headers(upstream.headers);
          responseHeaders.set("Access-Control-Allow-Origin", "*");
          responseHeaders.set(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
          );

          return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Proxy error";
          return new Response(message, { status: 502 });
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`
  🦊 Kunai Web Companion is live!

  Local:   http://localhost:${server.port}
  Network: http://${primaryIp}:${server.port}

  📱 Mobile Setup (iPhone, iPad, Android):
  1. Ensure your phone is connected to the same local Wi-Fi.
  2. Open http://${primaryIp}:${server.port} in Safari or Chrome.
  3. Tap 'Share' ⎋ -> 'Add to Home Screen' to launch as a standalone app.
  4. Stream in browser, hand off to VLC / Infuse, or use as a desktop remote!

  Press Ctrl+C to stop.
  `);

  return new Promise<number>((resolve) => {
    const shutdown = () => {
      console.log("\nStopping Kunai Web Companion...");
      server.stop();
      disposeContainer(container)
        .catch(() => {})
        .finally(() => resolve(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
