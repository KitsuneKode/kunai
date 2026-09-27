import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { EndpointHealthPort, ProviderRuntimeContext } from "@kunai/types";

import { videasyProviderModule } from "../src/videasy/direct";
import { flavorSourceId } from "../src/videasy/flavors";

const passthroughEndpointHealth: EndpointHealthPort = {
  shouldTry: () => true,
  recordFailure: () => {},
  recordSuccess: () => {},
};

const MEDIA_PLAYLIST = ["#EXTM3U", "#EXT-X-TARGETDURATION:6", "#EXTINF:6.0,", "seg0.ts"].join("\n");

// Hostname check, not substring: the fixture's playlist host is
// `moon.ironwallnet.net`, and a bare `.includes("ironwallnet.net")` would also
// match `ironwallnet.net.attacker.example` — the shape CodeQL flags.
function isIronwallPlaylistUrl(raw: string): boolean {
  try {
    const { hostname, pathname } = new URL(raw);
    return (
      (hostname === "ironwallnet.net" || hostname.endsWith(".ironwallnet.net")) &&
      pathname.endsWith(".m3u8")
    );
  } catch {
    return false;
  }
}

describe("videasy resolve-gate attestation (#361)", () => {
  /**
   * Live evidence: this provider's signed CDN URLs answered the resolve-gate
   * probe 200 and then 403 to the immediate next identical request — mpv
   * included. A probe green proves the route answers *some* client, not that
   * it serves the player, so the resolve must ship unattested: downstream
   * health checks re-probe instead of replaying a false green for 5 minutes.
   */
  test("a reachable probe does not set streamReachabilityVerified", async () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/videasy/wings-enc2-neon2.json"), "utf8"),
    ) as { mediaId: number; seed: string; cipher: string };

    const probedUrls: string[] = [];
    const context = {
      now: () => "2026-09-12T00:00:00.000Z",
      signal: AbortSignal.timeout(30_000),
      retryPolicy: { maxAttempts: 1, backoff: "none" as const },
      endpointHealth: passthroughEndpointHealth,
      fetch: {
        runtime: "direct-http" as const,
        fetch: async (input: string | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/seed?")) {
            return new Response(JSON.stringify({ seed: fixture.seed, ttlMs: 30_000 }));
          }
          if (url.includes("sources-with-title")) {
            return new Response(fixture.cipher);
          }
          if (url.endsWith("seg0.ts")) {
            probedUrls.push(url);
            return new Response(new Uint8Array(4096), {
              status: 206,
              headers: { "content-type": "video/mp2t" },
            });
          }
          if (isIronwallPlaylistUrl(url)) {
            probedUrls.push(url);
            return new Response(MEDIA_PLAYLIST, {
              headers: { "content-type": "application/vnd.apple.mpegurl" },
            });
          }
          // TMDB enrich and anything unexpected: degrade, don't hang.
          return new Response("", { status: 404 });
        },
      },
      emit: () => {},
    } satisfies ProviderRuntimeContext;

    const result = await videasyProviderModule.resolve(
      {
        title: { id: "233347", tmdbId: "233347", title: "Probe Fixture", kind: "movie" },
        mediaKind: "movie",
        allowedRuntimes: ["direct-http"],
        startupPriority: "balanced",
        preferredSourceId: flavorSourceId("cineby-neon"),
        intent: "play",
      },
      context,
    );

    expect(result.status).toBe("resolved");
    // The probe really did fetch the playlist and a segment — the 200 it saw is
    // genuine — yet the result must not attest reachability to downstream gates.
    expect(probedUrls.length).toBeGreaterThanOrEqual(2);
    expect(result.streamReachabilityVerified).toBeUndefined();
  });
});
