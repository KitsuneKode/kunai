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
    const html = await (await fetch(origin)).text();
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
    const cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
    expect(auth.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    const response = await fetch(origin + "/api/status", { headers: { Cookie: cookie } });
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
          headers: { Cookie: cookie, Origin: "https://foreign.example.test" },
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
      (await fetch(origin + "/proxy?url=https://example.test", { headers: { Cookie: cookie } }))
        .status,
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
