import { describe, expect, test } from "bun:test";

import { startLoopbackServer } from "@/services/sync/oauth-loopback";

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

function submitCollector(loopback: ReturnType<typeof server>, body: string) {
  return fetch(loopback.collectorUrl, {
    method: "POST",
    headers: {
      Origin: `http://127.0.0.1:${PORT}`,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

/**
 * The listener binds the exact registered address and settles once. The shipped
 * flow bound an OS-assigned port, which cannot match a registration, so it was
 * structurally incapable of succeeding.
 *
 * The token arrives on the collect path, handed over by the bridge — the
 * callback itself only ever receives a fragment the browser will not transmit.
 */
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
      const response = await submitCollector(loopback, "access_token=tok-abc&state=expected-state");
      expect(response.status).toBe(200);

      const result = await loopback.result;
      expect(result).toEqual({ ok: true, params: expect.anything() });
      expect(result.ok && result.params.get("access_token")).toBe("tok-abc");
    } finally {
      loopback.close();
    }
  });

  test("rejects a mismatched state", async () => {
    const loopback = server();
    try {
      await submitCollector(loopback, "access_token=tok-abc&state=wrong");
      expect(await loopback.result).toEqual({ ok: false, reason: "state-mismatch" });
    } finally {
      loopback.close();
    }
  });

  test("reports an explicit denial", async () => {
    const loopback = server();
    try {
      await submitCollector(loopback, "error=access_denied&state=expected-state");
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
    } finally {
      loopback.close();
    }
  });
});

/**
 * Implicit-grant mode. The access token arrives after `#`, which browsers never
 * send to a server — so the callback serves a page that reads the fragment and
 * returns it over same-origin loopback.
 */
describe("startLoopbackServer bridge", () => {
  const fragmentServer = (overrides: Record<string, unknown> = {}) =>
    startLoopbackServer({
      redirectUri,
      expectedState: "expected-state",
      signal: new AbortController().signal,
      timeoutMs: 5_000,
      serviceName: "AniList",
      ...overrides,
    });

  test("serves a bridge on the callback without settling", async () => {
    const loopback = fragmentServer({ timeoutMs: 150 });
    try {
      const response = await fetch(redirectUri);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("location.hash");
      // The callback itself carries no answer, so it must not decide anything.
      expect(await loopback.result).toEqual({ ok: false, reason: "timeout" });
    } finally {
      loopback.close();
    }
  });

  test("refuses a GET collector request even when it carries an access token", async () => {
    const loopback = fragmentServer();
    try {
      const response = await fetch(loopback.collectorUrl);
      expect(response.status).toBe(405);
    } finally {
      loopback.close();
    }
  });

  /**
   * AniList's implicit grant rejects the request outright when `state` is sent,
   * so there is no nonce to echo back. Requiring one would make the only
   * working flow unusable; a *wrong* one is still refused.
   */
  test("accepts a missing state but still rejects a wrong one", async () => {
    const without = fragmentServer();
    try {
      await submitCollector(without, "access_token=tok-123");
      expect((await without.result).ok).toBe(true);
    } finally {
      without.close();
    }

    const wrong = fragmentServer();
    try {
      await submitCollector(wrong, "access_token=tok-123&state=forged");
      expect(await wrong.result).toEqual({ ok: false, reason: "state-mismatch" });
    } finally {
      wrong.close();
    }
  });

  test("never writes the token into the bridge document", async () => {
    const loopback = fragmentServer({ timeoutMs: 150 });
    try {
      const html = await (await fetch(redirectUri)).text();
      expect(html).not.toContain("access_token=");
    } finally {
      loopback.close();
    }
  });
});
