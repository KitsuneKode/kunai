import { afterEach, describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";
import { isRelayOwnedError, markRelayOwnedError } from "@kunai/types";

import { ProviderHttpError } from "../src/runtime/fetch";
import {
  providerFetchText,
  ProviderRelayedUpstreamError,
  type ProviderTransportKind,
  ProviderTransportError,
  transportKindFromFetchError,
} from "../src/shared/provider-http-transport";

const NOW = "2026-01-01T00:00:00.000Z";
const URL_UNDER_TEST = "https://provider.example/search?keyword=secret-title";

/**
 * Plain curl resolved for a test — no PATH probing, no real binary. The argv
 * is fake but the spawn seam below controls the outcome anyway.
 */
const CURL_ENV = {
  which: (command: string) => (command === "curl" ? "/fake/curl" : null),
  listPathEntries: (): readonly string[] => [],
};

function contextWith(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): ProviderRuntimeContext {
  return {
    now: () => NOW,
    fetch: { runtime: "direct-http", fetch: fetchImpl },
  } satisfies ProviderRuntimeContext;
}

function stubContext(status: number, body: string, headers?: Record<string, string>) {
  return contextWith(async () => new Response(body, { status, headers }));
}

function relayedContext(status: number, body: string) {
  return stubContext(status, body, { "X-Kunai-Relayed": "1" });
}

const POLICY = {
  providerId: "testprovider",
  label: "testprovider fetch",
  userAgent: "test-ua",
  referer: "https://provider.example/",
} as const;

/** Assert `thrown` is a `Ctor` and return it narrowed — replaces `(thrown as Ctor)` probes. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the whole point is probing an untyped rejection value
function mustBe<T>(thrown: unknown, Ctor: abstract new (...args: never[]) => T): T {
  expect(thrown).toBeInstanceOf(Ctor);
  if (!(thrown instanceof Ctor)) throw new Error(`unreachable after toBeInstanceOf`);
  return thrown;
}

let savedFetch: typeof fetch | undefined;

function stubRawFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): () => void {
  savedFetch = globalThis.fetch;
  // SAFETY: deliberately partial test stub — only the call shape is exercised.
  globalThis.fetch = impl as never;
  return () => {
    if (savedFetch) globalThis.fetch = savedFetch;
  };
}

afterEach(() => {
  if (savedFetch) globalThis.fetch = savedFetch;
  savedFetch = undefined;
});

describe("providerFetchText — context leg", () => {
  test("a clean answer returns its text", async () => {
    const text = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: stubContext(200, "page body"),
    });
    expect(text).toBe("page body");
  });

  test("a relayed non-OK status is final — no curl, no direct retry", async () => {
    const restore = stubRawFetch(async () => {
      throw new Error("SENTINEL: direct upstream request happened");
    });
    let curlRan = false;
    try {
      const thrown = await providerFetchText(URL_UNDER_TEST, {
        ...POLICY,
        context: relayedContext(403, "upstream says no"),
        curlEnvironment: CURL_ENV,
        spawnCurl: async () => {
          curlRan = true;
          return { stdout: "x\n200", stderr: "", exitCode: 0 };
        },
      }).then(
        () => null,
        (error) => error,
      );
      expect(thrown).toBeInstanceOf(ProviderRelayedUpstreamError);
      expect(mustBe(thrown, Error).message).toContain("via relay");
      expect(mustBe(thrown, ProviderRelayedUpstreamError).status).toBe(403);
      expect(mustBe(thrown, ProviderRelayedUpstreamError).code).toBe("blocked");
      expect(curlRan).toBe(false);
    } finally {
      restore();
    }
  });

  test("a relayed challenge page is final and classified blocked", async () => {
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: relayedContext(200, "<html>Just a moment...</html>"),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => {
        throw new Error("SENTINEL: curl ran on a relayed challenge");
      },
    }).then(
      () => null,
      (error) => error,
    );
    expect(thrown).toBeInstanceOf(ProviderRelayedUpstreamError);
    expect(mustBe(thrown, ProviderRelayedUpstreamError).code).toBe("blocked");
    expect(mustBe(thrown, ProviderRelayedUpstreamError).retryable).toBe(false);
  });

  test("a relayed 5xx classifies as server-error, not a generic blip", async () => {
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: relayedContext(503, "down"),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => {
        throw new Error("SENTINEL");
      },
    }).then(
      () => null,
      (error) => error,
    );
    expect(thrown).toBeInstanceOf(ProviderRelayedUpstreamError);
    expect(mustBe(thrown, ProviderRelayedUpstreamError).code).toBe("provider-unavailable");
    expect(mustBe(thrown, ProviderRelayedUpstreamError).retryable).toBe(true);
  });

  test("a non-final relayed status settles over curl (anidb stale-relay hedge)", async () => {
    const text = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: relayedContext(404, "relay says unknown-provider"),
      relayedStatusIsFinal: (status) => status !== 404,
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({ stdout: "real page\n200", stderr: "", exitCode: 0 }),
    });
    expect(text).toBe("real page");
  });

  test("a relay-owned throw never falls to curl or a direct retry", async () => {
    /* `fallbackToDirect: false` is the user's privacy promise — the relay port
     * marks its throws so this layer rethrows instead of touching upstream. */
    let curlRan = false;
    const restore = stubRawFetch(async () => {
      throw new Error("SENTINEL: direct upstream request happened");
    });
    let thrown: unknown;
    try {
      await providerFetchText(URL_UNDER_TEST, {
        ...POLICY,
        context: contextWith(async () => {
          throw markRelayOwnedError(new TypeError("fetch failed"));
        }),
        curlEnvironment: CURL_ENV,
        spawnCurl: async () => {
          curlRan = true;
          return { stdout: "x\n200", stderr: "", exitCode: 0 };
        },
      });
    } catch (error) {
      thrown = error;
    } finally {
      restore();
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(isRelayOwnedError(thrown)).toBe(true);
    expect(curlRan).toBe(false);
  });

  test("a mid-body disconnect on a relayed response reports via relay, not via curl", async () => {
    /* Reading the relayed body is still relay traffic — a disconnect there
     * must not become a fresh direct request for the same URL. */
    let curlRan = false;
    let thrown: unknown;
    try {
      await providerFetchText(URL_UNDER_TEST, {
        ...POLICY,
        context: contextWith(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("socket hung up mid-body"));
                },
              }),
              { status: 200, headers: { "X-Kunai-Relayed": "1" } },
            ),
        ),
        curlEnvironment: CURL_ENV,
        spawnCurl: async () => {
          curlRan = true;
          return { stdout: "x\n200", stderr: "", exitCode: 0 };
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderTransportError);
    expect(thrown).toMatchObject({ message: expect.stringContaining("via relay") });
    expect(curlRan).toBe(false);
  });
});

describe("providerFetchText — transport failures", () => {
  test("a DNS failure in the context leg earns a curl attempt", async () => {
    const text = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: contextWith(async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND provider.example"), {
            code: "ENOTFOUND",
          }),
        });
      }),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({ stdout: "recovered\n200", stderr: "", exitCode: 0 }),
    });
    expect(text).toBe("recovered");
  });

  test("with no curl anywhere, a DNS failure reports offline — not retryable", async () => {
    const restore = stubRawFetch(async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND provider.example"), {
          code: "ENOTFOUND",
        }),
      });
    });
    try {
      const thrown = await providerFetchText(URL_UNDER_TEST, {
        ...POLICY,
        context: contextWith(async () => {
          throw new TypeError("fetch failed", {
            cause: Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
          });
        }),
        // No curl on PATH at all.
        curlEnvironment: { which: () => null, listPathEntries: () => [] },
      }).then(
        () => null,
        (error) => error,
      );
      expect(thrown).toBeInstanceOf(ProviderTransportError);
      expect(mustBe(thrown, ProviderTransportError).transportKind).toBe("offline");
      expect(mustBe(thrown, ProviderTransportError).code).toBe("network-error");
      expect(mustBe(thrown, ProviderTransportError).retryable).toBe(false);
    } finally {
      restore();
    }
  });

  test("the internal deadline timing out is not a caller abort — curl still runs", async () => {
    const text = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: contextWith(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({ stdout: "after timeout\n200", stderr: "", exitCode: 0 }),
    });
    expect(text).toBe("after timeout");
  });

  test("a caller abort during the context leg never buys a curl request", async () => {
    const controller = new AbortController();
    let curlRan = false;
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      signal: controller.signal,
      context: contextWith(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => {
        curlRan = true;
        return { stdout: "\n200", stderr: "", exitCode: 0 };
      },
    }).then(
      () => null,
      (error) => error,
    );
    expect(mustBe(thrown, DOMException).name).toBe("AbortError");
    expect(curlRan).toBe(false);
  });

  test("a caller abort between legs still skips curl", async () => {
    const controller = new AbortController();
    let curlRan = false;
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      signal: controller.signal,
      context: contextWith(async () => {
        controller.abort();
        // Aborting mid-leg surfaces as a transport-shaped rejection.
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
        });
      }),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => {
        curlRan = true;
        return { stdout: "\n200", stderr: "", exitCode: 0 };
      },
    }).then(
      () => null,
      (error) => error,
    );
    expect(thrown).toBeTruthy();
    expect(curlRan).toBe(false);
  });

  test("a mid-body disconnect in the context leg falls to curl", async () => {
    const text = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: contextWith(async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            controller.error(
              Object.assign(new Error("premature close"), { code: "UND_ERR_SOCKET" }),
            );
          },
        });
        return new Response(stream, { status: 200 });
      }),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({ stdout: "whole body\n200", stderr: "", exitCode: 0 }),
    });
    expect(text).toBe("whole body");
  });
});

describe("providerFetchText — curl leg", () => {
  const challengedContext = stubContext(200, "<html>Just a moment...</html>");

  test("an unmarked challenge page earns the curl fingerprint retry", async () => {
    const text = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: challengedContext,
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({ stdout: "cleared page\n200", stderr: "", exitCode: 0 }),
    });
    expect(text).toBe("cleared page");
  });

  test("curl exit 28 retries exactly once, then reports timeout", async () => {
    let attempts = 0;
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: challengedContext,
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => {
        attempts += 1;
        return { stdout: "", stderr: "timed out", exitCode: 28 };
      },
    }).then(
      () => null,
      (error) => error,
    );
    expect(attempts).toBe(2);
    expect(thrown).toBeInstanceOf(ProviderTransportError);
    expect(mustBe(thrown, ProviderTransportError).transportKind).toBe("timeout");
    expect(mustBe(thrown, ProviderTransportError).code).toBe("timeout");
  });

  test("curl exit 6 (DNS) classifies offline and non-retryable", async () => {
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: challengedContext,
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({ stdout: "\n000", stderr: "resolve failed", exitCode: 6 }),
    }).then(
      () => null,
      (error) => error,
    );
    expect(thrown).toBeInstanceOf(ProviderTransportError);
    expect(mustBe(thrown, ProviderTransportError).transportKind).toBe("offline");
    expect(mustBe(thrown, ProviderTransportError).retryable).toBe(false);
  });

  test("a curl challenge body throws the provider's blocked error", async () => {
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: challengedContext,
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({
        stdout: "<html>Just a moment...</html>\n403",
        stderr: "",
        exitCode: 0,
      }),
      blockedError: (impersonated) =>
        new Error(`testprovider blocked (impersonated=${impersonated})`),
    }).then(
      () => null,
      (error) => error,
    );
    expect(mustBe(thrown, Error).message).toBe("testprovider blocked (impersonated=false)");
  });

  test("a curl non-2xx with no challenge throws the status error", async () => {
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: challengedContext,
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => ({ stdout: "gone\n410", stderr: "", exitCode: 0 }),
    }).then(
      () => null,
      (error) => error,
    );
    expect(thrown).toBeInstanceOf(ProviderHttpError);
    expect(mustBe(thrown, ProviderHttpError).status).toBe(410);
    expect(mustBe(thrown, ProviderHttpError).code).toBe("network-error");
  });

  test("statuses outside the curl-retry gate throw immediately (anidb shape)", async () => {
    let curlRan = false;
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: stubContext(503, "maintenance"),
      retryStatusViaCurl: (status) => status === 403 || status === 429,
      statusError: (status) => Object.assign(new Error(`typed status ${status}`), { status }),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => {
        curlRan = true;
        return { stdout: "\n200", stderr: "", exitCode: 0 };
      },
    }).then(
      () => null,
      (error) => error,
    );
    expect(mustBe(thrown, Error).message).toBe("typed status 503");
    expect(curlRan).toBe(false);
  });

  test("a body-declared status outranks challenge detection", async () => {
    const thrown = await providerFetchText(URL_UNDER_TEST, {
      ...POLICY,
      context: stubContext(200, "<title>Under Maintenance</title>"),
      bodyAsStatus: (text) => (/under maintenance/i.test(text) ? 503 : null),
      statusError: (status) => Object.assign(new Error(`typed status ${status}`), { status }),
      curlEnvironment: CURL_ENV,
      spawnCurl: async () => {
        throw new Error("SENTINEL");
      },
    }).then(
      () => null,
      (error) => error,
    );
    expect(mustBe(thrown, Error).message).toBe("typed status 503");
  });
});

describe("transportKindFromFetchError", () => {
  const cases: Array<[string, unknown, ProviderTransportKind]> = [
    [
      "DNS",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("no"), { code: "ENOTFOUND" }),
      }),
      "offline",
    ],
    [
      "EAI_AGAIN",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("no"), { code: "EAI_AGAIN" }),
      }),
      "offline",
    ],
    [
      "refused",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("no"), { code: "ECONNREFUSED" }),
      }),
      "refused",
    ],
    [
      "reset",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("no"), { code: "ECONNRESET" }),
      }),
      "reset",
    ],
    [
      "AggregateError walks errors[]",
      new TypeError("fetch failed", {
        cause: Object.assign(new AggregateError([new Error("x")], "agg"), {
          errors: [Object.assign(new Error("no"), { code: "ETIMEDOUT" })],
        }),
      }),
      "timeout",
    ],
    [
      "TLS via message when errno is hidden",
      new TypeError("fetch failed", { cause: new Error("certificate verify failed") }),
      "tls",
    ],
    ["TimeoutError", new DOMException("timed out", "TimeoutError"), "timeout"],
    ["unknown", new TypeError("fetch failed"), "unknown"],
  ];
  for (const [name, error, kind] of cases) {
    test(name, () => {
      expect(transportKindFromFetchError(error)).toBe(kind);
    });
  }
});
