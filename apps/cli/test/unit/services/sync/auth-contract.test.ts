import { describe, expect, test } from "bun:test";

import { TMDB_API_KEY } from "@/services/catalog/tmdb-proxy";
import {
  resolveAniListAuth,
  resolveTmdbAuth,
  SHIPPED_ANILIST_CLIENT_ID,
  SHIPPED_ANILIST_REDIRECT_URI,
} from "@/services/sync/auth-contract";

const validClientId = "12345";
const validCallback = "http://127.0.0.1:43863/callback";

/** An override of both, so each test invalidates the one input it is about. */
const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  KUNAI_ANILIST_CLIENT_ID: validClientId,
  KUNAI_ANILIST_REDIRECT_URI: validCallback,
  ...overrides,
});

/**
 * AniList rejects any redirect_uri that is not registered against the client,
 * character for character. The shipped flow bound `port: 0` and derived the URI
 * from whatever port the OS handed back, which cannot match a registration —
 * so `connect()` was structurally incapable of succeeding, and failed at the
 * token exchange rather than anywhere informative.
 *
 * Every branch here therefore fails closed with a reason, rather than inventing
 * a default and discovering the mismatch remotely.
 */
describe("resolveAniListAuth", () => {
  /**
   * Connect works out of the box. AniList's implicit grant needs no client
   * secret, so Kunai ships an application id — an identifier, published in
   * every authorization URL — and no credential at all.
   */
  test("is available with no configuration at all", () => {
    const resolution = resolveAniListAuth({});

    expect(resolution.clientId).toBe(SHIPPED_ANILIST_CLIENT_ID);
    expect(resolution.availability).toEqual({
      available: true,
      redirectUri: SHIPPED_ANILIST_REDIRECT_URI,
      clientIdSource: "shipped-default",
    });
  });

  /** The shipped callback must be the exact shape the loopback listener binds. */
  test("ships a callback the listener can actually bind", () => {
    const url = new URL(SHIPPED_ANILIST_REDIRECT_URI);

    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(url.pathname).toBe("/callback");
  });

  test("prefers an explicit client id when one is set", () => {
    const resolution = resolveAniListAuth(env());

    expect(resolution.clientId).toBe(validClientId);
    expect(resolution.availability).toEqual({
      available: true,
      redirectUri: validCallback,
      clientIdSource: "environment",
    });
  });

  /**
   * An overridden client id means a different registered application, whose
   * callback Kunai cannot know. Inheriting the shipped one would be rejected
   * remotely with nothing useful to say about why.
   */
  test("requires an overriding client id to bring its own callback", () => {
    const resolution = resolveAniListAuth({ KUNAI_ANILIST_CLIENT_ID: validClientId });

    expect(resolution.availability).toEqual({ available: false, reason: "callback-missing" });
  });

  test("accepts localhost as well as 127.0.0.1", () => {
    const resolution = resolveAniListAuth(
      env({ KUNAI_ANILIST_REDIRECT_URI: "http://localhost:43863/callback" }),
    );

    expect(resolution.availability.available).toBe(true);
  });

  /** An empty or placeholder override is a half-finished setup, not a default. */
  test("fails closed on an empty or placeholder client id rather than falling back", () => {
    for (const value of ["", "   ", "your-client-id", "changeme", "xxx"]) {
      const resolution = resolveAniListAuth(env({ KUNAI_ANILIST_CLIENT_ID: value }));
      expect(resolution.clientId, value).toBeNull();
      expect(resolution.availability, value).toEqual({
        available: false,
        reason: "client-id-invalid",
      });
    }
  });

  /** A random or omitted port cannot match a registration. */
  test("rejects a callback without an explicit usable port", () => {
    for (const uri of [
      "http://127.0.0.1/callback",
      "http://127.0.0.1:0/callback",
      "http://127.0.0.1:99999/callback",
    ]) {
      const resolution = resolveAniListAuth(env({ KUNAI_ANILIST_REDIRECT_URI: uri }));
      expect(resolution.availability.available, uri).toBe(false);
    }
  });

  test("rejects a non-loopback host", () => {
    for (const uri of [
      "http://example.com:43863/callback",
      "http://0.0.0.0:43863/callback",
      "http://192.168.1.5:43863/callback",
    ]) {
      const resolution = resolveAniListAuth(env({ KUNAI_ANILIST_REDIRECT_URI: uri }));
      expect(resolution.availability, uri).toEqual({
        available: false,
        reason: "callback-not-loopback",
      });
    }
  });

  test("rejects a wrong scheme, path, query, fragment, or credentials", () => {
    for (const uri of [
      "https://127.0.0.1:43863/callback",
      "http://127.0.0.1:43863/",
      "http://127.0.0.1:43863/callback/extra",
      "http://127.0.0.1:43863/callback?x=1",
      "http://127.0.0.1:43863/callback#frag",
      "http://user:pw@127.0.0.1:43863/callback",
      "not a uri",
    ]) {
      const resolution = resolveAniListAuth(env({ KUNAI_ANILIST_REDIRECT_URI: uri }));
      expect(resolution.availability.available, uri).toBe(false);
    }
  });

  /** Availability reaches settings; a user-supplied value must never ride along. */
  test("availability carries no configured value", () => {
    const { availability } = resolveAniListAuth(
      env({ KUNAI_ANILIST_CLIENT_ID: "private-client-value" }),
    );

    expect(JSON.stringify(availability)).not.toContain("private-client-value");
  });
});

describe("resolveTmdbAuth", () => {
  test("uses the shipped key when no override is set", () => {
    const resolution = resolveTmdbAuth({});

    expect(resolution.apiKey).toBe(TMDB_API_KEY);
    expect(resolution.availability).toEqual({
      available: true,
      apiKeySource: "shipped-fallback",
    });
  });

  test("prefers a valid environment override", () => {
    const resolution = resolveTmdbAuth({ KUNAI_TMDB_API_KEY: "override-key" });

    expect(resolution.apiKey).toBe("override-key");
    expect(resolution.availability).toEqual({ available: true, apiKeySource: "environment" });
  });

  /**
   * An explicitly empty override is a statement, not an absence: silently
   * falling back would ignore what the user configured.
   */
  test("fails closed on an empty or placeholder override rather than falling back", () => {
    for (const value of ["", "   ", "changeme", "your-api-key"]) {
      const resolution = resolveTmdbAuth({ KUNAI_TMDB_API_KEY: value });
      expect(resolution.availability, value).toEqual({
        available: false,
        reason: "api-key-invalid",
      });
      expect(resolution.apiKey).toBeNull();
    }
  });

  test("reports missing when there is no override and no shipped key", () => {
    const resolution = resolveTmdbAuth({}, null);

    expect(resolution.availability).toEqual({ available: false, reason: "api-key-missing" });
    expect(resolution.apiKey).toBeNull();
  });

  test("availability carries no key value", () => {
    const { availability } = resolveTmdbAuth({ KUNAI_TMDB_API_KEY: "secret-key-value" });

    expect(JSON.stringify(availability)).not.toContain("secret-key-value");
  });
});
