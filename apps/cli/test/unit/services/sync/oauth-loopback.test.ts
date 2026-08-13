import { describe, expect, test } from "bun:test";

import { createOAuthState, startLoopbackServer } from "@/services/sync/oauth-loopback";

const PORT = 43871;
const redirectUri = `http://127.0.0.1:${PORT}/callback`;

function server(overrides: Partial<Parameters<typeof startLoopbackServer>[0]> = {}) {
  return startLoopbackServer({
    redirectUri,
    expectedState: "expected-state",
    signal: new AbortController().signal,
    timeoutMs: 5_000,
    serviceName: "AniList",
    ...overrides,
  });
}

/**
 * State ties the callback to the request that started it. Without it — as the
 * shipped flow did — any page that can reach the loopback port can hand Kunai
 * an authorization code of its choosing.
 */
describe("createOAuthState", () => {
  test("is long, URL-safe, and distinct per call", () => {
    const first = createOAuthState();
    const second = createOAuthState();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("startLoopbackServer", () => {
  /** The whole point: the bound port is the registered one, not an OS pick. */
  test("binds the exact port from the configured redirect URI", async () => {
    const loopback = server();
    try {
      expect(loopback.port).toBe(PORT);
    } finally {
      loopback.close();
    }
  });

  test("accepts a callback whose state matches", async () => {
    const loopback = server();
    try {
      const response = await fetch(`${redirectUri}?code=auth-code&state=expected-state`);
      expect(response.status).toBe(200);

      const result = await loopback.result;
      expect(result).toEqual({ ok: true, params: expect.anything() });
      expect(result.ok && result.params.get("code")).toBe("auth-code");
    } finally {
      loopback.close();
    }
  });

  test("rejects a missing or mismatched state", async () => {
    for (const query of ["?code=auth-code", "?code=auth-code&state=wrong"]) {
      const loopback = server();
      try {
        await fetch(`${redirectUri}${query}`);
        expect(await loopback.result, query).toEqual({ ok: false, reason: "state-mismatch" });
      } finally {
        loopback.close();
      }
    }
  });

  test("reports an explicit denial", async () => {
    const loopback = server();
    try {
      await fetch(`${redirectUri}?error=access_denied&state=expected-state`);
      expect(await loopback.result).toEqual({ ok: false, reason: "denied" });
    } finally {
      loopback.close();
    }
  });

  test("times out and closes", async () => {
    const loopback = server({ timeoutMs: 20 });
    expect(await loopback.result).toEqual({ ok: false, reason: "timeout" });
  });

  test("settles as aborted when the caller cancels", async () => {
    const controller = new AbortController();
    const loopback = server({ signal: controller.signal });
    controller.abort();
    expect(await loopback.result).toEqual({ ok: false, reason: "aborted" });
  });

  /** A settled server must free the port, or the next attempt cannot bind it. */
  test("releases the port so a subsequent attempt can bind it again", async () => {
    const first = server({ timeoutMs: 20 });
    await first.result;

    const second = server();
    try {
      expect(second.port).toBe(PORT);
    } finally {
      second.close();
    }
  });

  test("ignores a request to another path without settling", async () => {
    const loopback = server({ timeoutMs: 200 });
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/not-the-callback`);
      expect(response.status).toBe(404);
      expect(await loopback.result).toEqual({ ok: false, reason: "timeout" });
    } finally {
      loopback.close();
    }
  });

  /** The browser page is shown to the user and may be screenshotted or shared. */
  test("never echoes the code or state into the completion page", async () => {
    const loopback = server();
    try {
      const response = await fetch(`${redirectUri}?code=secret-code&state=expected-state`);
      const html = await response.text();

      expect(html).not.toContain("secret-code");
      expect(html).not.toContain("expected-state");
      await loopback.result;
    } finally {
      loopback.close();
    }
  });
});
