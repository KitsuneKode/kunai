import { describe, expect, test } from "bun:test";

import { TMDB_API_KEY } from "@/services/catalog/tmdb-proxy";
import { resolveAniListAuth, resolveTmdbAuth } from "@/services/sync/auth-contract";

const validClientId = "12345";
const validCallback = "http://127.0.0.1:43863/callback";

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
  test("resolves when both the client id and an exact loopback callback are set", () => {
    const resolution = resolveAniListAuth({
      KUNAI_ANILIST_CLIENT_ID: validClientId,
      KUNAI_ANILIST_REDIRECT_URI: validCallback,
    });

    expect(resolution.clientId).toBe(validClientId);
    expect(resolution.availability).toEqual({
      available: true,
      redirectUri: validCallback,
      clientIdSource: "environment",
    });
  });

  test("accepts localhost as well as 127.0.0.1", () => {
    const resolution = resolveAniListAuth({
      KUNAI_ANILIST_CLIENT_ID: validClientId,
      KUNAI_ANILIST_REDIRECT_URI: "http://localhost:43863/callback",
    });

    expect(resolution.availability.available).toBe(true);
  });

  test("fails closed when the client id is missing, empty, or a placeholder", () => {
    for (const value of [undefined, "", "   ", "your-client-id", "changeme", "xxx"]) {
      const resolution = resolveAniListAuth({
        ...(value === undefined ? {} : { KUNAI_ANILIST_CLIENT_ID: value }),
        KUNAI_ANILIST_REDIRECT_URI: validCallback,
      });
      expect(resolution.clientId, String(value)).toBeNull();
      expect(resolution.availability.available).toBe(false);
    }
  });

  test("requires the callback to be configured rather than defaulting one", () => {
    const resolution = resolveAniListAuth({ KUNAI_ANILIST_CLIENT_ID: validClientId });

    expect(resolution.availability).toEqual({ available: false, reason: "callback-missing" });
  });

  /** A random or omitted port is the exact defect being removed. */
  test("rejects a callback without an explicit usable port", () => {
    for (const uri of [
      "http://127.0.0.1/callback",
      "http://127.0.0.1:0/callback",
      "http://127.0.0.1:99999/callback",
    ]) {
      const resolution = resolveAniListAuth({
        KUNAI_ANILIST_CLIENT_ID: validClientId,
        KUNAI_ANILIST_REDIRECT_URI: uri,
      });
      expect(resolution.availability.available, uri).toBe(false);
    }
  });

  test("rejects a non-loopback host", () => {
    for (const uri of [
      "http://example.com:43863/callback",
      "http://0.0.0.0:43863/callback",
      "http://192.168.1.5:43863/callback",
    ]) {
      const resolution = resolveAniListAuth({
        KUNAI_ANILIST_CLIENT_ID: validClientId,
        KUNAI_ANILIST_REDIRECT_URI: uri,
      });
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
      const resolution = resolveAniListAuth({
        KUNAI_ANILIST_CLIENT_ID: validClientId,
        KUNAI_ANILIST_REDIRECT_URI: uri,
      });
      expect(resolution.availability.available, uri).toBe(false);
    }
  });

  /** Availability reaches settings; a credential must never ride along. */
  test("availability carries no credential value", () => {
    const { availability } = resolveAniListAuth({
      KUNAI_ANILIST_CLIENT_ID: "super-secret-client",
      KUNAI_ANILIST_REDIRECT_URI: validCallback,
    });

    expect(JSON.stringify(availability)).not.toContain("super-secret-client");
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
