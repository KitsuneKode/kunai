import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  type DebridFetchFunction,
  DebridAuthError,
  DebridError,
  DebridNotCachedError,
  DebridRateLimitError,
  RealDebridClient,
} from "../../../src/debrid";

describe("RealDebridClient", () => {
  const dummyToken = "test-rd-token-12345";

  describe("Constructor & Authentication Validation", () => {
    test("throws DebridAuthError when token is missing or empty", () => {
      expect(() => new RealDebridClient("")).toThrow(DebridAuthError);
      expect(() => new RealDebridClient({ token: "   " })).toThrow(DebridAuthError);
      expect(() => new RealDebridClient({ token: "" })).toThrow(DebridAuthError);
    });

    test("initializes successfully with a string token or options", () => {
      const client1 = new RealDebridClient(dummyToken);
      expect(client1.serviceId).toBe("real-debrid");

      const client2 = new RealDebridClient({ apiKey: dummyToken });
      expect(client2.serviceId).toBe("real-debrid");
    });
  });

  describe("getUser() - Account Info (active vs expired/free)", () => {
    test("returns active premium account info", async () => {
      const mockFetch: DebridFetchFunction = async (url, init) => {
        expect(String(url)).toBe("https://api.real-debrid.com/rest/1.0/user");
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe(`Bearer ${dummyToken}`);

        return new Response(
          JSON.stringify({
            id: 1001,
            username: "kitsune_coder",
            email: "kitsune@example.com",
            points: 1250,
            type: "premium",
            premium: 864000,
            expiration: "2099-12-31T23:59:59.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const account = await client.getUser();

      expect(account.username).toBe("kitsune_coder");
      expect(account.email).toBe("kitsune@example.com");
      expect(account.premium).toBe(true);
      expect(account.expirationDate).toBe("2099-12-31T23:59:59.000Z");
      expect(account.points).toBe(1250);
    });

    test("returns non-premium for free account", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response(
          JSON.stringify({
            id: 1002,
            username: "free_user",
            type: "free",
            premium: 0,
            expiration: undefined,
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const account = await client.getUser();

      expect(account.username).toBe("free_user");
      expect(account.premium).toBe(false);
    });

    test("returns non-premium for expired premium account", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response(
          JSON.stringify({
            id: 1003,
            username: "expired_user",
            type: "premium",
            premium: 0,
            expiration: "2020-01-01T00:00:00.000Z",
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const account = await client.getUser();

      expect(account.username).toBe("expired_user");
      expect(account.premium).toBe(false);
    });

    test("throws DebridAuthError on 401 bad token response", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response(
          JSON.stringify({
            error: "bad_token",
            error_code: 8,
          }),
          { status: 401 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      await expect(client.getUser()).rejects.toThrow(DebridAuthError);
    });
  });

  describe("checkInstantAvailability()", () => {
    test("returns empty map when empty hash list is provided", async () => {
      let fetchCalled = false;
      const mockFetch: DebridFetchFunction = async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const result = await client.checkInstantAvailability([]);
      expect(result).toEqual({});
      expect(fetchCalled).toBe(false);
    });

    test("queries availability with normalized hashes and returns response", async () => {
      const hash1 = "0123456789abcdef0123456789abcdef01234567";
      const hash2 = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";

      const mockFetch: DebridFetchFunction = async (url) => {
        expect(String(url)).toBe(
          `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${hash1}/${hash2.toLowerCase()}`,
        );

        return new Response(
          JSON.stringify({
            [hash1]: {
              rd: [
                {
                  "1": {
                    filename: "Sousou_no_Frieren_E01_1080p.mkv",
                    filesize: 1400000000,
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const result = await client.checkInstantAvailability([hash1, hash2]);

      expect(result[hash1]?.rd?.[0]?.["1"]?.filename).toBe("Sousou_no_Frieren_E01_1080p.mkv");
    });

    test("throws on invalid non-array input", async () => {
      const client = new RealDebridClient(dummyToken);
      // @ts-expect-error testing runtime guard against non-array input
      await expect(client.checkInstantAvailability("not-an-array")).rejects.toThrow(DebridError);
    });
  });

  describe("Magnet Operations & Link Unrestriction", () => {
    test("addMagnet validates URI and posts to Real-Debrid", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Anime";

      const mockFetch: DebridFetchFunction = async (url, init) => {
        expect(String(url)).toBe("https://api.real-debrid.com/rest/1.0/torrents/addMagnet");
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("magnet=");

        return new Response(
          JSON.stringify({
            id: "TORRENT123",
            uri: "https://api.real-debrid.com/rest/1.0/torrents/info/TORRENT123",
          }),
          { status: 201 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const added = await client.addMagnet(magnet);
      expect(added.id).toBe("TORRENT123");
    });

    test("addMagnet rejects invalid magnet links", async () => {
      const client = new RealDebridClient(dummyToken);
      await expect(client.addMagnet("https://invalid.com/not-magnet")).rejects.toThrow(DebridError);
    });

    test("getTorrentInfo fetches torrent metadata", async () => {
      const mockFetch: DebridFetchFunction = async (url) => {
        expect(String(url)).toBe("https://api.real-debrid.com/rest/1.0/torrents/info/TORRENT123");
        return new Response(
          JSON.stringify({
            id: "TORRENT123",
            filename: "Frieren E01 1080p",
            original_filename: "Frieren E01 1080p",
            hash: "0123456789abcdef0123456789abcdef01234567",
            bytes: 1400000000,
            original_bytes: 1400000000,
            host: "real-debrid.com",
            split: 200,
            progress: 100,
            status: "downloaded",
            added: "2026-01-01T00:00:00Z",
            files: [
              {
                id: 1,
                path: "/Frieren_01_1080p.mkv",
                bytes: 1400000000,
                selected: 1,
              },
            ],
            links: ["https://real-debrid.com/d/LINK123"],
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const info = await client.getTorrentInfo("TORRENT123");
      expect(info.status).toBe("downloaded");
      expect(info.links[0]).toBe("https://real-debrid.com/d/LINK123");
    });

    test("selectFiles posts file selection", async () => {
      let called = false;
      const mockFetch: DebridFetchFunction = async (url, init) => {
        expect(String(url)).toBe(
          "https://api.real-debrid.com/rest/1.0/torrents/selectFiles/TORRENT123",
        );
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toBe("files=all");
        called = true;
        return new Response(null, { status: 204 });
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      await client.selectFiles("TORRENT123", "all");
      expect(called).toBe(true);
    });

    test("unrestrictLink converts hoster link to direct stream link", async () => {
      const mockFetch: DebridFetchFunction = async (url, init) => {
        expect(String(url)).toBe("https://api.real-debrid.com/rest/1.0/unrestrict/link");
        expect(init?.method).toBe("POST");

        return new Response(
          JSON.stringify({
            id: "UNRESTRICT123",
            filename: "Frieren_01_1080p.mkv",
            mimeType: "video/x-matroska",
            filesize: 1400000000,
            link: "https://real-debrid.com/d/LINK123",
            host: "real-debrid.com",
            chunks: 1,
            crc: 0,
            download: "https://download.real-debrid.com/d/LINK123/Frieren_01_1080p.mkv",
            streamable: 1,
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const unrestrict = await client.unrestrictLink("https://real-debrid.com/d/LINK123");

      expect(unrestrict.download).toContain("download.real-debrid.com");
      expect(unrestrict.streamable).toBe(1);
    });
  });

  describe("resolveStream() - Orchestration", () => {
    test("successfully resolves cached magnet link into a streamable direct URL", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Anime_1080p";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = String(url);
        if (u.includes("/torrents/instantAvailability/")) {
          return new Response(
            JSON.stringify({
              "0123456789abcdef0123456789abcdef01234567": {
                rd: [{ "1": { filename: "Anime_1080p.mkv", filesize: 2000000000 } }],
              },
            }),
            { status: 200 },
          );
        }
        if (u.endsWith("/torrents/addMagnet")) {
          return new Response(JSON.stringify({ id: "TORRENT_RESOLVE_1" }), { status: 201 });
        }
        if (u.includes("/torrents/selectFiles/")) {
          return new Response(null, { status: 204 });
        }
        if (u.includes("/torrents/info/")) {
          return new Response(
            JSON.stringify({
              id: "TORRENT_RESOLVE_1",
              status: "downloaded",
              files: [{ id: 1, path: "/Anime_1080p.mkv", bytes: 2000000000, selected: 1 }],
              links: ["https://real-debrid.com/d/RESOLVED_LINK"],
            }),
            { status: 200 },
          );
        }
        if (u.endsWith("/unrestrict/link")) {
          return new Response(
            JSON.stringify({
              id: "UNRESTRICT_RESOLVE",
              filename: "Anime_1080p.mkv",
              filesize: 2000000000,
              download: "https://download.real-debrid.com/stream/Anime_1080p.mkv",
              streamable: 1,
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u}`);
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const result = await client.resolveStream(magnet);

      expect(result.service).toBe("real-debrid");
      expect(result.cached).toBe(true);
      expect(result.stream.url).toBe("https://download.real-debrid.com/stream/Anime_1080p.mkv");
      expect(result.stream.filename).toBe("Anime_1080p.mkv");
      expect(result.stream.quality).toBe("1080p");
      expect(result.stream.streamable).toBe(true);
    });

    test("resolves direct hoster link into streamable result", async () => {
      const hosterUrl = "https://rapidgator.net/file/12345/video_720p.mp4";

      const mockFetch: DebridFetchFunction = async (url) => {
        expect(String(url)).toContain("/unrestrict/link");
        return new Response(
          JSON.stringify({
            id: "UNRESTRICT_DIRECT",
            filename: "video_720p.mp4",
            filesize: 800000000,
            download: "https://download.real-debrid.com/direct/video_720p.mp4",
            streamable: 1,
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const result = await client.resolveStream(hosterUrl);

      expect(result.service).toBe("real-debrid");
      expect(result.cached).toBe(true);
      expect(result.stream.quality).toBe("720p");
      expect(result.stream.url).toContain("direct/video_720p.mp4");
    });

    test("throws DebridNotCachedError if torrent is still downloading", async () => {
      const magnet = "magnet:?xt=urn:btih:abcdefabcdefabcdefabcdefabcdefabcdefabcd";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = String(url);
        if (u.includes("/torrents/instantAvailability/")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (u.endsWith("/torrents/addMagnet")) {
          return new Response(JSON.stringify({ id: "UNC_1" }), { status: 201 });
        }
        if (u.includes("/torrents/selectFiles/")) {
          return new Response(null, { status: 204 });
        }
        if (u.includes("/torrents/info/")) {
          return new Response(
            JSON.stringify({
              id: "UNC_1",
              status: "downloading",
              progress: 25,
              links: [],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u}`);
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      await expect(client.resolveStream(magnet)).rejects.toThrow(DebridNotCachedError);
    });

    test("throws DebridError if torrent failed or dead", async () => {
      const magnet = "magnet:?xt=urn:btih:deaddeaddeaddeaddeaddeaddeaddeaddeaddead";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = String(url);
        if (u.includes("/torrents/instantAvailability/")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (u.endsWith("/torrents/addMagnet")) {
          return new Response(JSON.stringify({ id: "DEAD_1" }), { status: 201 });
        }
        if (u.includes("/torrents/selectFiles/")) {
          return new Response(null, { status: 204 });
        }
        if (u.includes("/torrents/info/")) {
          return new Response(
            JSON.stringify({
              id: "DEAD_1",
              status: "magnet_error",
              links: [],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u}`);
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      await expect(client.resolveStream(magnet)).rejects.toThrow(DebridError);
    });

    test("probes stream with verifyCandidateStream when context is provided", async () => {
      const hosterUrl = "https://rapidgator.net/file/12345/video_720p.mp4";
      const mockFetch: DebridFetchFunction = async (url) => {
        expect(String(url)).toContain("/unrestrict/link");
        return new Response(
          JSON.stringify({
            id: "UNRESTRICT_DIRECT",
            filename: "video_720p.mp4",
            filesize: 800000000,
            download: "https://download.real-debrid.com/stream/video_720p.mp4",
            streamable: 1,
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const context: ProviderRuntimeContext = {
        fetch: {
          runtime: "direct-http",
          fetch: async () =>
            new Response("OK", { status: 200, headers: { "Content-Type": "video/mp4" } }),
          resolvesLocally: () => false,
        },
        now: () => new Date().toISOString(),
      };

      const result = await client.resolveStream(hosterUrl, context);
      expect(result.stream.url).toBe("https://download.real-debrid.com/stream/video_720p.mp4");
    });

    test("throws DebridError if stream probe fails when context is provided", async () => {
      const hosterUrl = "https://rapidgator.net/file/12345/video_720p.mp4";
      const mockFetch: DebridFetchFunction = async (url) => {
        expect(String(url)).toContain("/unrestrict/link");
        return new Response(
          JSON.stringify({
            id: "UNRESTRICT_DIRECT",
            filename: "video_720p.mp4",
            filesize: 800000000,
            download: "https://download.real-debrid.com/stream/video_720p.mp4",
            streamable: 1,
          }),
          { status: 200 },
        );
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      const context: ProviderRuntimeContext = {
        fetch: {
          runtime: "direct-http",
          fetch: async () => new Response("Not Found", { status: 404 }),
          resolvesLocally: () => false,
        },
        now: () => new Date().toISOString(),
      };

      await expect(client.resolveStream(hosterUrl, context)).rejects.toThrow(DebridError);
    });
  });

  describe("Error Handling & Rate Limits", () => {
    test("throws DebridRateLimitError on 429 response", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response("Too Many Requests", { status: 429 });
      };

      const client = new RealDebridClient({ token: dummyToken, fetch: mockFetch });
      await expect(client.getUser()).rejects.toThrow(DebridRateLimitError);
    });

    test("retries on 503 and throws DebridError if server unavailable", async () => {
      let attempts = 0;
      const mockFetch: DebridFetchFunction = async () => {
        attempts++;
        return new Response("Service Unavailable", { status: 503 });
      };

      const client = new RealDebridClient({
        token: dummyToken,
        maxRetries: 1,
        fetch: mockFetch,
      });

      await expect(client.getUser()).rejects.toThrow(DebridError);
      expect(attempts).toBe(2);
    });
  });
});
