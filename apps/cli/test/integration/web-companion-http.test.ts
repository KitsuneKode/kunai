import { expect, test } from "bun:test";

import { disposeContainer } from "@/container";
import {
  CompanionRunState,
  createCompanionFetchHandler,
} from "@/services/web-companion/companion-server";
import { isJsonObject } from "@kunai/types";

import { createIsolatedContainer } from "./helpers/isolated-container";

test("real isolated companion container authenticates HTTP and releases all run resources", async () => {
  const isolated = await createIsolatedContainer("companion-http");
  const run = new CompanionRunState();
  const secret = crypto.randomUUID().replaceAll("-", "");
  let handler: ReturnType<typeof createCompanionFetchHandler> | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => (handler ? handler(request) : new Response(null, { status: 503 })),
  });
  const origin = `http://127.0.0.1:${server.port}`;
  handler = createCompanionFetchHandler({
    container: isolated.container,
    run,
    runSecret: secret,
    bindHost: "127.0.0.1",
    bindPort: server.port!,
  });
  try {
    expect(process.env.DO_NOT_TRACK).toBe("1");
    const page = await fetch(origin);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await page.text();
    expect(html).toContain('id="searchInput"');
    expect(html).not.toContain(secret);
    expect((await fetch(origin + "/api/status")).status).toBe(403);
    expect(
      (
        await fetch(origin + "/api/session", {
          method: "POST",
          headers: { Origin: origin },
          body: JSON.stringify({ token: secret }),
        })
      ).status,
    ).toBe(200);
    const auth = await fetch(origin + "/api/session", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ token: secret }),
    });
    expect(auth.headers.get("set-cookie")).toBeNull();
    // A separate service on the same loopback host must not receive a cookie
    // capable of authorizing API requests to this run.
    const unrelated = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        Response.json({
          cookie: request.headers.get("cookie"),
          authorization: request.headers.get("authorization"),
        }),
    });
    try {
      const seen = await (await fetch(`http://127.0.0.1:${unrelated.port}/`)).json();
      expect(seen).toEqual({ cookie: null, authorization: null });
    } finally {
      unrelated.stop(true);
    }
    expect(
      (
        await fetch(origin + "/api/status", {
          headers: { Cookie: `kunai_companion_session=${secret}` },
        })
      ).status,
    ).toBe(403);
    const response = await fetch(origin + "/api/status", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(response.status).toBe(200);
    const status = await response.json();
    if (!isJsonObject(status) || !Array.isArray(status.providers) || !isJsonObject(status.playback))
      throw new Error("Invalid status shape");
    expect(status.providers.length).toBeGreaterThan(0);
    expect(
      status.providers.every((provider) => isJsonObject(provider) && provider.status === "unknown"),
    ).toBe(true);
    expect(status.playback.state).toBe("idle");
    expect(
      (
        await fetch(origin + "/api/status", {
          headers: { Authorization: `Bearer ${secret}`, Origin: "https://foreign.example.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(origin + "/api/session", {
          method: "POST",
          headers: { Origin: origin },
          body: "x".repeat(16_385),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await fetch(origin + "/proxy?url=https://example.test", {
          headers: { Authorization: `Bearer ${secret}` },
        })
      ).status,
    ).toBe(404);
    const work = run.beginWork("player");
    run.close();
    expect(work.signal.aborted).toBe(true);
    expect(run.gateway).toBeNull();
    expect(isolated.container.config.installId).toBe("");
  } finally {
    run.close();
    server.stop(true);
    await disposeContainer(isolated.container);
    isolated.dispose();
  }
});
