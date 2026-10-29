import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  decryptVidrockStreamUrl,
  VIDROCK_KEY_HEX,
  vidrockProviderModule,
} from "../src/vidrock/direct";

// Captured live from GET https://vidrock.net/api/movie/550 on 2026-09-21. The
// upstream path segment rotates, so the assertion is on the stable parts of
// the decrypted URL, not the token.
const LIVE_CIPHERTEXT =
  "NIKrKo4CVDg1AMVqP0O--Gqc3aWs3oAVb7OXXjP4r_YSu20-FcPiShtsCCf8nNwnEy3iSDroInp3MrZRIrg8lG_FvHMEp8-81NzlDkYTA5jBWfIlnMDN1vkWrHZMwPX-LdDOsUi4-3M3MTReq7Q4AqiqYJh2JEW3zaY";

describe("VidRock stream-url decryption", () => {
  test("decrypts a captured AES-256-GCM lane ciphertext to a stream URL", async () => {
    const url = await decryptVidrockStreamUrl(LIVE_CIPHERTEXT);
    expect(url.startsWith("https://cdn.ngcorp.dad/movie/")).toBe(true);
    expect(url.endsWith(".m3u8")).toBe(true);
  });

  test("rejects malformed ciphertexts instead of returning garbage", async () => {
    await expect(decryptVidrockStreamUrl("too-short")).rejects.toThrow();
    await expect(decryptVidrockStreamUrl(`${LIVE_CIPHERTEXT}xx`)).rejects.toThrow();
  });
});

describe("VidRock stream-host header contract", () => {
  test("probes carry the browser UA and vidrock referer, never the legacy space UA", async () => {
    // Regression (verified live 2026-10-13): the CDN hosts 403/404/challenge
    // the old single-space UA and serve valid playlists to browser headers.
    // The gate probes with the candidate's headers verbatim, so asserting the
    // probe request locks both the probe and the mpv handoff.
    const probed: { url: string; headers: Record<string, string> }[] = [];
    // SAFETY: test stub context — supplies only the fetch surface this module calls.
    const ctx: ProviderRuntimeContext = {
      providerId: "vidrock",
      now: () => "2026-10-13T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (url: string | URL | Request, init?: RequestInit) => {
          const href = String(url);
          if (href.includes("/api/")) {
            return new Response(JSON.stringify({ Nova: { url: LIVE_CIPHERTEXT } }), {
              status: 200,
            });
          }
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
            headers[k.toLowerCase()] = String(v);
          }
          probed.push({ url: href, headers });
          return new Response("#EXTM3U\n#EXTINF:5,\nseg.ts\n", {
            status: 200,
            headers: { "content-type": "application/vnd.apple.mpegurl" },
          });
        },
      } as ProviderRuntimeContext["fetch"],
    };
    await vidrockProviderModule.resolve(
      {
        title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
        mediaKind: "movie",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      ctx,
    );
    expect(probed.length).toBeGreaterThan(0);
    for (const probe of probed) {
      expect(probe.headers["user-agent"] ?? "").toMatch(/Chrome\/\d+/);
      expect(probe.headers["user-agent"]).not.toBe(" ");
      expect(probe.headers["referer"] ?? "").toContain("vidrock.net");
      expect(probe.headers["origin"] ?? "").toContain("vidrock.net");
    }
  });
});

describe("VidRock key pin", () => {
  test("pinned key is a 256-bit hex constant", () => {
    // Rotation canary: the GCM key is 32 bytes recovered from the player
    // bundle — a redeploy with a new key fails the decrypt test above, and
    // this shape pin says which half is stale. Recovery:
    // `.docs/provider-dossiers/vidrock.md` (key rotation).
    expect(VIDROCK_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
    expect(VIDROCK_KEY_HEX.length / 2).toBe(32);
  });

  test("all-null lanes exhaust as not-found, not as a rotation signal", async () => {
    // Upstream outage shape (seen 2026-10-13: every lane {"url":null} for all
    // probed titles): no ciphertext anywhere means "nothing listed", which must
    // read as a title miss — not the all-decrypt-failed rotation alarm.
    // SAFETY: test stub context — supplies only the fetch surface this module calls.
    const ctx: ProviderRuntimeContext = {
      providerId: "vidrock",
      now: () => "2026-10-13T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async () =>
          new Response(
            JSON.stringify({
              Nova: { url: null, type: null },
              Atlas: { url: null, type: null },
              Luna: { url: null, type: null },
              Orion: { url: null, type: null },
              Astra: { url: null, type: null },
            }),
            { status: 200 },
          ),
      } as ProviderRuntimeContext["fetch"],
    };
    const result = await vidrockProviderModule.resolve(
      {
        title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
        mediaKind: "movie",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      ctx,
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures?.[0]?.code).toBe("not-found");
  });

  test("every lane failing decrypt is a diagnosable rotation signal, not a title miss", async () => {
    const ctx: ProviderRuntimeContext = {
      providerId: "vidrock",
      now: () => "2026-09-21T00:00:00.000Z",
      // SAFETY: test stub — supplies only the fetch surface this module calls.
      fetch: {
        runtime: "direct-http",
        fetch: async () =>
          new Response(
            JSON.stringify({
              primary: { url: "!!!not-base64!!!" },
              backup: { url: "e30=" },
            }),
            { status: 200 },
          ),
      } as ProviderRuntimeContext["fetch"],
    };
    const result = await vidrockProviderModule.resolve(
      {
        title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
        mediaKind: "movie",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      ctx,
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures?.[0]?.code).toBe("parse-failed");
    expect(result.failures?.[0]?.retryable).toBe(false);
    expect(result.failures?.[0]?.message).toMatch(/rotat/);
  });
});

async function encryptLaneUrl(url: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(VIDROCK_KEY_HEX, "hex"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(url),
  );
  return Buffer.concat([iv, new Uint8Array(encrypted)]).toString("base64url");
}

test("VidRock detects extensionless HLS from bounded playlist bytes and exposes real quality URLs", async () => {
  const ciphertext = await encryptLaneUrl("https://worker.example/opaque");
  const result = await vidrockProviderModule.resolve(
    {
      title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      providerId: "vidrock",
      now: () => "2026-10-24T00:00:00Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (target) => {
          const url = String(target);
          if (url.includes("/api/")) return Response.json({ Luna: { url: ciphertext } });
          if (url.endsWith("/opaque"))
            return new Response(
              '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",URI="en.vtt"\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n720.m3u8\n',
            );
          if (url.endsWith(".m3u8")) return new Response("#EXTM3U\n#EXTINF:5,\nsegment.ts\n");
          return new Response(new Uint8Array(2048));
        },
      },
    },
  );
  expect(result.status).toBe("resolved");
  expect(result.streams.map((s) => s.url)).toEqual([
    "https://worker.example/1080.m3u8",
    "https://worker.example/720.m3u8",
  ]);
  expect(result.streams.map((s) => s.qualityLabel)).toEqual(["1080p", "720p"]);
  expect(result.streams.every((s) => s.protocol === "hls")).toBe(true);
  expect(result.subtitles.map((s) => s.url)).toEqual(["https://worker.example/en.vtt"]);
});

test("VidRock does not declare arbitrary worker bytes to be HLS", async () => {
  const ciphertext = await encryptLaneUrl("https://worker.example/opaque");
  const result = await vidrockProviderModule.resolve(
    {
      title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["direct-http"],
    },
    {
      providerId: "vidrock",
      now: () => "2026-10-24T00:00:00Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (target) =>
          String(target).includes("/api/")
            ? Response.json({ Luna: { url: ciphertext } })
            : new Response(new Uint8Array(2048)),
      },
    },
  );
  expect(result.streams.every((s) => s.protocol !== "hls")).toBe(true);
});

test.each(["playlist-failure", "dead-hls-host"])(
  "a decrypted but unavailable lane is not a GCM rotation: %s",
  async (kind) => {
    const ciphertext = await encryptLaneUrl(
      kind === "playlist-failure"
        ? "https://cdn.example/playlist/fixture"
        : "https://cdn.example/master.m3u8",
    );
    const result = await vidrockProviderModule.resolve(
      {
        title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
        mediaKind: "movie",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      {
        providerId: "vidrock",
        now: () => "2026-10-29T00:00:00.000Z",
        fetch: {
          runtime: "direct-http",
          fetch: async (url) => {
            if (String(url).includes("/api/"))
              return Response.json({ good: { url: ciphertext }, bad: { url: "!!!not-base64!!!" } });
            if (kind === "playlist-failure") throw new Error("fixture transport unavailable");
            return new Response("missing", { status: 404 });
          },
        },
      },
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures?.[0]?.code).not.toBe("parse-failed");
    expect(result.failures?.[0]?.message).not.toContain("GCM");
  },
);
