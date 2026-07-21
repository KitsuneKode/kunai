import { expect, test } from "bun:test";

import {
  createProviderEngine,
  defineProviderManifest,
  type CoreProviderModule,
} from "../src/index";
import {
  classifyProviderFailure,
  isOfflineNetworkFailure,
} from "../src/provider-failure-classifier";

const HTTP_503_FAILURE = {
  providerId: "vidking",
  code: "network-error" as const,
  message: "HTTP 503 Service Unavailable",
  retryable: true,
  status: 503,
};

const INPUT = {
  title: { id: "123", kind: "movie" as const, title: "Demo" },
  mediaKind: "movie" as const,
  intent: "play" as const,
  allowedRuntimes: ["direct-http" as const],
};

const baseManifest = {
  description: "Test",
  recommended: true,
  mediaKinds: ["movie", "series"] as const,
  capabilities: ["source-resolve"] as const,
  runtimePorts: [
    {
      runtime: "direct-http" as const,
      operations: ["resolve-stream" as const],
      browserSafe: false,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest" as const,
    scope: "local" as const,
    keyParts: ["provider"],
  },
  browserSafe: false,
  relaySafe: true,
};

test("shared provider failure taxonomy maps codes and HTTP status consistently", () => {
  expect(
    classifyProviderFailure({
      providerId: "vidking",
      code: "timeout",
      message: "Provider did not return a stream within 15s",
      retryable: true,
    }),
  ).toMatchObject({
    failureClass: "timeout",
    fallbackPolicy: "auto-fallback",
    retryable: true,
  });

  expect(
    classifyProviderFailure({
      providerId: "allmanga",
      code: "blocked",
      message: "Provider returned 403",
      retryable: false,
    }),
  ).toMatchObject({
    failureClass: "blocked",
    fallbackPolicy: "guided-action",
    retryable: false,
  });

  expect(
    classifyProviderFailure({
      providerId: "rivestream",
      status: 404,
      message: "HTTP 404",
    }),
  ).toMatchObject({
    failureClass: "provider-empty",
    fallbackPolicy: "auto-fallback",
  });
});

test("HTTP 503 remains provider-local network failure", () => {
  expect(classifyProviderFailure(HTTP_503_FAILURE)).toMatchObject({
    failureClass: "network",
    fallbackPolicy: "auto-fallback",
  });
});

test("ENOTFOUND classifies as offline with no-fallback", () => {
  expect(
    classifyProviderFailure({
      providerId: "vidking",
      code: "network-error",
      message: "getaddrinfo ENOTFOUND api.example.test",
      retryable: true,
    }),
  ).toMatchObject({
    failureClass: "offline",
    fallbackPolicy: "no-fallback",
    retryable: false,
  });
});

test("isOfflineNetworkFailure only matches bounded reliable signatures", () => {
  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "getaddrinfo ENOTFOUND api.example.test",
    }),
  ).toBe(true);
  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "Temporary failure in name resolution EAI_AGAIN",
    }),
  ).toBe(true);
  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "connect ENETUNREACH 1.2.3.4:443",
    }),
  ).toBe(true);
  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "Network is unreachable",
    }),
  ).toBe(true);
  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "ERR_INTERNET_DISCONNECTED",
    }),
  ).toBe(true);
  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "ERR_NAME_NOT_RESOLVED",
    }),
  ).toBe(true);

  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "HTTP 503 Service Unavailable",
    }),
  ).toBe(false);
  expect(
    isOfflineNetworkFailure({
      code: "timeout",
      message: "Provider did not return a stream within 15s",
    }),
  ).toBe(false);
  expect(
    isOfflineNetworkFailure({
      code: "network-error",
      message: "fetch failed: ECONNRESET",
    }),
  ).toBe(false);
  expect(
    isOfflineNetworkFailure({
      code: "parse-failed",
      message: "parse failed: missing sources",
    }),
  ).toBe(false);
});

test("ENOTFOUND stops cross-provider fallback", async () => {
  const attempted: string[] = [];
  const events: Array<{ type: string }> = [];

  // vidking aliases to videasy in the engine registry lookup
  const failing: CoreProviderModule = {
    providerId: "videasy",
    manifest: defineProviderManifest({
      ...baseManifest,
      id: "videasy",
      displayName: "VidKing",
      domain: "videasy.net",
    }),
    async resolve(_input, context) {
      attempted.push("vidking");
      const failure = {
        providerId: "videasy" as const,
        code: "network-error" as const,
        message: "getaddrinfo ENOTFOUND api.example.test",
        retryable: true,
        at: context.now(),
      };
      return {
        status: "exhausted",
        providerId: "videasy",
        streams: [],
        subtitles: [],
        trace: {
          id: "trace:vidking",
          startedAt: context.now(),
          title: _input.title,
          cacheHit: false,
          steps: [],
          failures: [failure],
        },
        failures: [failure],
      };
    },
  };

  const second: CoreProviderModule = {
    providerId: "rivestream",
    manifest: defineProviderManifest({
      ...baseManifest,
      id: "rivestream",
      displayName: "Rivestream",
      domain: "rivestream.app",
    }),
    async resolve() {
      attempted.push("rivestream");
      throw new Error("should not be called");
    },
  };

  const engine = createProviderEngine({
    modules: [failing, second],
    maxAttempts: 3,
    retryDelayMs: 0,
  });

  const result = await engine.resolveWithFallback(
    INPUT,
    ["vidking", "rivestream"],
    undefined,
    (event) => {
      events.push({ type: event.type });
    },
  );

  expect(result.result).toBeNull();
  expect(attempted).toEqual(["vidking"]);
  expect(events.some((event) => event.type === "provider-fallback-started")).toBe(false);
});
