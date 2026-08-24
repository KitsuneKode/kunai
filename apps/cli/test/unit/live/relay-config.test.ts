import { describe, expect, test } from "bun:test";

import {
  relayAllAnimeSmokePath,
  relayDisplayOrigin,
  resolveRelayDiagnosticConfig,
} from "../../live/relay-config";

describe("resolveRelayDiagnosticConfig", () => {
  test("uses the environment URL while independently falling back to the config token", () => {
    const resolution = resolveRelayDiagnosticConfig({
      env: { KUNAI_RELAY_BASE_URL: "https://env.example/rpc?secret=query#fragment" },
      config: {
        providerRelay: {
          baseUrl: "https://config.example",
          token: "config-token",
          providers: { allanime: { enabled: false } },
        },
      },
      configPath: "/profile/config.json",
    });

    expect(resolution).toMatchObject({
      kind: "run",
      source: "env",
      baseUrl: "https://env.example/rpc?secret=query#fragment",
      token: "config-token",
      displayOrigin: "https://env.example",
      tokenPresent: true,
      forcesAllAnime: true,
    });
    const serialized = JSON.stringify(resolution);
    expect(serialized).not.toContain("config-token");
    expect(serialized).not.toContain("query");
    expect(serialized).not.toContain("fragment");
  });

  test("lets the environment token override the stored token", () => {
    const resolution = resolveRelayDiagnosticConfig({
      env: {
        KUNAI_RELAY_BASE_URL: "https://env.example",
        KUNAI_RELAY_TOKEN: "env-token",
      },
      config: { providerRelay: { baseUrl: "https://config.example", token: "config-token" } },
      configPath: "/profile/config.json",
    });

    expect(resolution).toMatchObject({ kind: "run", token: "env-token", tokenPresent: true });
  });

  test("uses an enabled config relay when the environment URL is absent", () => {
    expect(
      resolveRelayDiagnosticConfig({
        env: {},
        config: { providerRelay: { baseUrl: "https://relay.example/path", token: "" } },
        configPath: "/profile/config.json",
      }),
    ).toMatchObject({
      kind: "run",
      source: "config",
      displayOrigin: "https://relay.example",
      tokenPresent: false,
      forcesAllAnime: false,
    });
  });

  test("skips missing, blank, and explicitly disabled stored relays", () => {
    expect(resolveRelayDiagnosticConfig({ env: {}, configPath: "/missing/config.json" })).toEqual({
      kind: "skip",
      reason: "no config file at /missing/config.json",
    });
    expect(
      resolveRelayDiagnosticConfig({
        env: {},
        config: { providerRelay: { baseUrl: "   " } },
        configPath: "/profile/config.json",
      }),
    ).toEqual({
      kind: "skip",
      reason:
        "no providerRelay.baseUrl in /profile/config.json - set one via /settings or pass KUNAI_RELAY_BASE_URL",
    });
    expect(
      resolveRelayDiagnosticConfig({
        env: {},
        config: { providerRelay: { enabled: false, baseUrl: "https://relay.example" } },
        configPath: "/profile/config.json",
      }),
    ).toEqual({
      kind: "skip",
      reason: "providerRelay.enabled is false in /profile/config.json",
    });
  });

  test("an environment URL remains an explicit diagnostic override", () => {
    expect(
      resolveRelayDiagnosticConfig({
        env: { KUNAI_RELAY_BASE_URL: "https://env.example" },
        config: { providerRelay: { enabled: false, baseUrl: "https://config.example" } },
        configPath: "/profile/config.json",
      }),
    ).toMatchObject({ kind: "run", source: "env", baseUrl: "https://env.example" });
  });
});

describe("relay URL safety", () => {
  test("accepts HTTP(S) and displays only the origin", () => {
    expect(relayDisplayOrigin("http://127.0.0.1:8787/rpc?token=hidden#fragment")).toBe(
      "http://127.0.0.1:8787",
    );
  });

  test("rejects unsupported schemes and embedded credentials", () => {
    expect(() => relayDisplayOrigin("not a URL with secret-value")).toThrow("relay URL is invalid");
    expect(() => relayDisplayOrigin("file:///tmp/relay")).toThrow("http or https");
    expect(() => relayDisplayOrigin("https://user:pass@relay.example")).toThrow("credentials");
  });
});

test("relayAllAnimeSmokePath decodes filesystem URLs", () => {
  expect(relayAllAnimeSmokePath("file:///tmp/kunai%20repo/relay-from-config.ts")).toBe(
    "/tmp/kunai repo/relay-allanime.smoke.ts",
  );
});
