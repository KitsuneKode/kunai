import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  type DebridFetchFunction,
  AllDebridClient,
  DebridAuthError,
  DebridError,
  DebridNotCachedError,
  DebridRateLimitError,
  DebridSubscriptionExpiredError,
} from "../../../src/debrid";

describe("AllDebridClient", () => {
  const dummyApiKey = "ad-test-key-99999";

  describe("Constructor & Authentication Validation", () => {
    test("throws DebridAuthError when apiKey is missing or empty", () => {
      expect(() => new AllDebridClient("")).toThrow(DebridAuthError);
      expect(() => new AllDebridClient({ apiKey: "   " })).toThrow(DebridAuthError);
      expect(() => new AllDebridClient({ apiKey: "" })).toThrow(DebridAuthError);
    });

    test("initializes successfully with a string key or options", () => {
      const client1 = new AllDebridClient(dummyApiKey);
      expect(client1.serviceId).toBe("all-debrid");

      const client2 = new AllDebridClient({ apiKey: dummyApiKey });
      expect(client2.serviceId).toBe("all-debrid");
    });
  });

  describe("getUser() - Account Info (active vs expired/free)", () => {
    test("returns active premium account info", async () => {
      const mockFetch: DebridFetchFunction = async (url, init) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/user");
        expect(u.searchParams.get("agent")).toBe("kunai");
        expect(u.searchParams.get("apikey")).toBe(dummyApiKey);

        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe(`Bearer ${dummyApiKey}`);

        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              user: {
                username: "ad_user_prime",
                email: "ad_prime@example.com",
                isSubscribed: true,
                isTrial: false,
                premiumUntil: 4102444799, // 2099-12-31
              },
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const account = await client.getUser();

      expect(account.username).toBe("ad_user_prime");
      expect(account.email).toBe("ad_prime@example.com");
      expect(account.premium).toBe(true);
      expect(account.expirationDate).toBeDefined();
    });

    test("returns non-premium when isSubscribed is false", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              user: {
                username: "free_ad_user",
                email: "free@example.com",
                isSubscribed: false,
                isTrial: false,
                premiumUntil: 0,
              },
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const account = await client.getUser();

      expect(account.username).toBe("free_ad_user");
      expect(account.premium).toBe(false);
    });

    test("returns non-premium when premiumUntil timestamp is in the past", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              user: {
                username: "expired_ad_user",
                isSubscribed: true,
                isTrial: false,
                premiumUntil: 1577836800, // 2020-01-01
              },
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const account = await client.getUser();

      expect(account.username).toBe("expired_ad_user");
      expect(account.premium).toBe(false);
    });

    test("throws DebridAuthError on invalid apiKey error response", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response(
          JSON.stringify({
            status: "error",
            error: {
              code: "AUTH_BAD_APIKEY",
              message: "Invalid API key",
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      await expect(client.getUser()).rejects.toThrow(DebridAuthError);
    });
  });

  describe("checkInstantAvailability()", () => {
    test("returns empty array for empty input without calling fetch", async () => {
      let called = false;
      const mockFetch: DebridFetchFunction = async () => {
        called = true;
        return new Response("{}", { status: 200 });
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const result = await client.checkInstantAvailability([]);
      expect(result).toEqual([]);
      expect(called).toBe(false);
    });

    test("queries instant availability for magnets", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

      const mockFetch: DebridFetchFunction = async (url, init) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/magnet/instant");
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("magnets[]=");

        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              magnets: [
                {
                  magnet,
                  hash: "0123456789abcdef0123456789abcdef01234567",
                  instant: true,
                  files: [{ n: "Video_1080p.mkv", s: 1500000000 }],
                },
              ],
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const result = await client.checkInstantAvailability([magnet]);

      expect(result.length).toBe(1);
      expect(result[0]?.instant).toBe(true);
      expect(result[0]?.files?.[0]?.n).toBe("Video_1080p.mkv");
    });
  });

  describe("Magnet Upload & Status Operations", () => {
    test("uploadMagnet posts magnets and returns identifiers", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

      const mockFetch: DebridFetchFunction = async (url, init) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/magnet/upload");
        expect(init?.method).toBe("POST");

        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              magnets: [
                {
                  magnet,
                  hash: "0123456789abcdef0123456789abcdef01234567",
                  name: "Video Release",
                  id: 456789,
                  ready: true,
                },
              ],
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const uploaded = await client.uploadMagnet([magnet]);

      expect(uploaded.length).toBe(1);
      expect(uploaded[0]?.id).toBe(456789);
    });

    test("uploadMagnet throws if empty array is passed", async () => {
      const client = new AllDebridClient(dummyApiKey);
      await expect(client.uploadMagnet([])).rejects.toThrow(DebridError);
    });

    test("getMagnetStatus queries status by id", async () => {
      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/magnet/status");
        expect(u.searchParams.get("id")).toBe("456789");

        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              magnets: {
                id: 456789,
                filename: "Video_1080p.mkv",
                size: 1500000000,
                status: "Ready",
                statusCode: 4,
                links: [
                  {
                    link: "https://alldebrid.com/service/link1",
                    filename: "Video_1080p.mkv",
                    size: 1500000000,
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const status = await client.getMagnetStatus(456789);

      expect(status.id).toBe(456789);
      expect(status.statusCode).toBe(4);
      expect(status.status).toBe("Ready");
      expect(status.links?.[0]?.filename).toBe("Video_1080p.mkv");
    });
  });

  describe("unlockLink()", () => {
    test("unlocks hoster or service link into direct download link", async () => {
      const mockFetch: DebridFetchFunction = async (url, init) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/link/unlock");
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("link=");

        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              link: "https://alldebrid.com/service/link1",
              host: "rapidgator",
              filename: "Show_S01E01_1080p.mkv",
              filesize: 1200000000,
              download: "https://storage.alldebrid.com/dl/Show_S01E01_1080p.mkv",
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const unlocked = await client.unlockLink("https://alldebrid.com/service/link1");

      expect(unlocked.download).toContain("storage.alldebrid.com");
      expect(unlocked.filename).toBe("Show_S01E01_1080p.mkv");
      expect(unlocked.filesize).toBe(1200000000);
    });

    test("throws DebridError on invalid link format", async () => {
      const client = new AllDebridClient(dummyApiKey);
      await expect(client.unlockLink("ftp://invalid.com")).rejects.toThrow(DebridError);
    });
  });

  describe("resolveStream() - Orchestration & Magnet Statuses", () => {
    test("resolves cached ready magnet into streamable direct URL", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Show_1080p";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        if (u.pathname === "/v4/magnet/instant") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: [{ magnet, instant: true }],
              },
            }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/magnet/upload") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: [{ id: 777, ready: true }],
              },
            }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/magnet/status") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: {
                  id: 777,
                  status: "Ready",
                  statusCode: 4,
                  links: [
                    {
                      link: "https://alldebrid.com/service/l1",
                      filename: "Show_1080p.mkv",
                      size: 2000000000,
                    },
                  ],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/link/unlock") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                download: "https://storage.alldebrid.com/dl/Show_1080p.mkv",
                filename: "Show_1080p.mkv",
                filesize: 2000000000,
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u.pathname}`);
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const result = await client.resolveStream(magnet);

      expect(result.service).toBe("all-debrid");
      expect(result.cached).toBe(true);
      expect(result.stream.url).toBe("https://storage.alldebrid.com/dl/Show_1080p.mkv");
      expect(result.stream.quality).toBe("1080p");
      expect(result.stream.streamable).toBe(true);
    });

    test("resolves direct hoster link with cached=true", async () => {
      const hosterUrl = "https://1fichier.com/?abcdef12345";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/link/unlock");
        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              download: "https://storage.alldebrid.com/dl/Movie_4k.mkv",
              filename: "Movie_4K.mkv",
              filesize: 5000000000,
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      const result = await client.resolveStream(hosterUrl);

      expect(result.service).toBe("all-debrid");
      expect(result.cached).toBe(true);
      expect(result.stream.quality).toBe("2160p");
      expect(result.stream.url).toContain("Movie_4k.mkv");
    });

    test("throws DebridNotCachedError when magnet status is downloading/processing (code 0..3)", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        if (u.pathname === "/v4/magnet/instant") {
          return new Response(JSON.stringify({ status: "success", data: { magnets: [] } }), {
            status: 200,
          });
        }
        if (u.pathname === "/v4/magnet/upload") {
          return new Response(
            JSON.stringify({ status: "success", data: { magnets: [{ id: 888 }] } }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/magnet/status") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: {
                  id: 888,
                  status: "Downloading",
                  statusCode: 1,
                  processingPerc: 45,
                },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u.pathname}`);
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      await expect(client.resolveStream(magnet)).rejects.toThrow(DebridNotCachedError);
    });

    test("throws DebridError when magnet status code indicates a processing error (code 5..11)", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        if (u.pathname === "/v4/magnet/instant") {
          return new Response(JSON.stringify({ status: "success", data: { magnets: [] } }), {
            status: 200,
          });
        }
        if (u.pathname === "/v4/magnet/upload") {
          return new Response(
            JSON.stringify({ status: "success", data: { magnets: [{ id: 999 }] } }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/magnet/status") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: {
                  id: 999,
                  status: "Upload fail",
                  statusCode: 5,
                },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u.pathname}`);
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      await expect(client.resolveStream(magnet)).rejects.toThrow(DebridError);
    });

    test("throws DebridSubscriptionExpiredError when upload indicates MUST_BE_PREMIUM", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        if (u.pathname === "/v4/magnet/instant") {
          return new Response(JSON.stringify({ status: "success", data: { magnets: [] } }), {
            status: 200,
          });
        }
        if (u.pathname === "/v4/magnet/upload") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: [
                  {
                    id: 0,
                    error: {
                      code: "MUST_BE_PREMIUM",
                      message: "You must be premium to download magnets",
                    },
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u.pathname}`);
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      await expect(client.resolveStream(magnet)).rejects.toThrow(DebridSubscriptionExpiredError);
    });

    test("throws DebridError on unhandled magnet status code", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        if (u.pathname === "/v4/magnet/instant") {
          return new Response(JSON.stringify({ status: "success", data: { magnets: [] } }), {
            status: 200,
          });
        }
        if (u.pathname === "/v4/magnet/upload") {
          return new Response(
            JSON.stringify({ status: "success", data: { magnets: [{ id: 1111 }] } }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/magnet/status") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: {
                  id: 1111,
                  status: "Mysterious Status",
                  statusCode: 99,
                },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request to ${u.pathname}`);
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      await expect(client.resolveStream(magnet)).rejects.toThrow(DebridError);
    });

    test("probes stream with verifyCandidateStream when context is provided", async () => {
      const hosterUrl = "https://1fichier.com/?abcdef12345";
      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/link/unlock");
        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              download: "https://storage.alldebrid.com/dl/Movie_4k.mkv",
              filename: "Movie_4K.mkv",
              filesize: 5000000000,
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
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
      expect(result.stream.url).toBe("https://storage.alldebrid.com/dl/Movie_4k.mkv");
    });

    test("throws DebridError if stream probe fails when context is provided", async () => {
      const hosterUrl = "https://1fichier.com/?abcdef12345";
      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe("/v4/link/unlock");
        return new Response(
          JSON.stringify({
            status: "success",
            data: {
              download: "https://storage.alldebrid.com/dl/Movie_4k.mkv",
              filename: "Movie_4K.mkv",
              filesize: 5000000000,
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
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

  describe("Rate Limiting & Error Responses", () => {
    test("throws DebridRateLimitError on FREE_TRIAL_LIMIT_REACHED or 429", async () => {
      const mockFetch: DebridFetchFunction = async () => {
        return new Response(
          JSON.stringify({
            status: "error",
            error: {
              code: "FREE_TRIAL_LIMIT_REACHED",
              message: "Daily free trial limit reached",
            },
          }),
          { status: 200 },
        );
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      await expect(client.getUser()).rejects.toThrow(DebridRateLimitError);
    });

    test("redacts apikey in both message and error cause properties", async () => {
      const secretKey = ["super", "secret", "alldebrid", "key", "xyz"].join("_");
      const rawError = new TypeError("fetch failed");
      // Simulate Bun/Node TypeError with path property containing apikey
      Reflect.set(
        rawError,
        "path",
        `https://api.alldebrid.com/v4/user?apikey=${secretKey}&agent=kunai`,
      );

      const mockFetch: DebridFetchFunction = async () => {
        throw rawError;
      };

      const client = new AllDebridClient({ apiKey: secretKey, maxRetries: 0, fetch: mockFetch });

      try {
        await client.getUser();
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(DebridError);
        // SAFETY: err is verified as DebridError by toBeInstanceOf check above
        const debridErr = err as DebridError;
        expect(debridErr.message).not.toContain(secretKey);
        // SAFETY: cause is typed as unknown on Error and inspected for test verification
        const causeObj = debridErr.cause as { readonly path?: string } | undefined;
        expect(causeObj).toBeDefined();
        if (causeObj && String(causeObj.path) === causeObj.path) {
          expect(causeObj.path).not.toContain(secretKey);
          expect(causeObj.path).toContain("apikey=REDACTED");
        }
        const inspected = Bun.inspect(debridErr);
        expect(inspected).not.toContain(secretKey);
      }
    });

    test("cleans up uploaded magnet via deleteMagnet on failure", async () => {
      const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";
      let deleteCalled = false;

      const mockFetch: DebridFetchFunction = async (url) => {
        const u = new URL(String(url));
        if (u.pathname === "/v4/magnet/instant") {
          return new Response(JSON.stringify({ status: "success", data: { magnets: [] } }), {
            status: 200,
          });
        }
        if (u.pathname === "/v4/magnet/upload") {
          return new Response(
            JSON.stringify({ status: "success", data: { magnets: [{ id: 54321 }] } }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/magnet/status") {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                magnets: {
                  id: 54321,
                  status: "Upload fail",
                  statusCode: 5,
                },
              },
            }),
            { status: 200 },
          );
        }
        if (u.pathname === "/v4/magnet/delete") {
          expect(u.searchParams.get("id")).toBe("54321");
          deleteCalled = true;
          return new Response(JSON.stringify({ status: "success" }), { status: 200 });
        }
        throw new Error(`Unexpected request to ${u.pathname}`);
      };

      const client = new AllDebridClient({ apiKey: dummyApiKey, fetch: mockFetch });
      await expect(client.resolveStream(magnet)).rejects.toThrow(DebridError);
      expect(deleteCalled).toBe(true);
    });
  });
});
