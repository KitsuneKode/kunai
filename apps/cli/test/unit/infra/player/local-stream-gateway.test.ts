import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStreamGateway, type StreamGateway } from "@/infra/player/stream-gateway";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";

const roots: string[] = [];
const gateways: StreamGateway[] = [];

afterEach(async () => {
  for (const gateway of gateways.splice(0)) gateway.stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "kunai-local-gateway-"));
  roots.push(root);
  const source: LocalPlaybackSource = {
    kind: "local",
    jobId: "job",
    titleId: "title",
    titleName: "Example",
    mediaKind: "movie",
    providerId: "fixture",
    filePath: join(root, "movie.mp4"),
    subtitlePath: join(root, "movie.vtt"),
    fileSize: 10,
  };
  await Bun.write(source.filePath, "0123456789");
  await Bun.write(source.subtitlePath!, "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n");
  const gateway = createStreamGateway({
    fetchImpl: async () => {
      throw new Error("no upstream");
    },
  });
  gateways.push(gateway);
  return { source, gateway, root };
}

describe("authorized local stream gateway", () => {
  test("serves exact registered bytes and sidecar through opaque numeric loopback URLs", async () => {
    const { source, gateway } = await fixture();
    const session = await gateway.registerLocalSession({ source });
    expect(session.mediaUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/g\/[0-9a-f]{32}\/media$/);
    expect(await (await fetch(session.mediaUrl)).text()).toBe("0123456789");
    expect(await (await fetch(session.subtitleUrls[0]!)).text()).toContain("Hello");
    expect((await fetch(`${session.mediaUrl}/movie.mp4`)).status).toBe(404);
    expect((await fetch(session.mediaUrl.replace("/media", "/sub/1"))).status).toBe(404);
    expect((await fetch(session.mediaUrl.replace("/media", "/f/L2V0Yy9wYXNzd2Q"))).status).toBe(
      404,
    );
  });

  test.each([
    { range: "bytes=2-5", want: "2345", contentRange: "bytes 2-5/10" },
    { range: "bytes=7-", want: "789", contentRange: "bytes 7-9/10" },
    { range: "bytes=-3", want: "789", contentRange: "bytes 7-9/10" },
    { range: "bytes=8-100", want: "89", contentRange: "bytes 8-9/10" },
  ])("seeks with $range", async ({ range, want, contentRange }) => {
    const { source, gateway } = await fixture();
    const session = await gateway.registerLocalSession({ source });
    const response = await fetch(session.mediaUrl, { headers: { Range: range } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(await response.text()).toBe(want);
  });

  test.each(["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=1-2,4-5", "nonsense"])(
    "rejects unsatisfiable or unsupported range %s without bytes",
    async (range) => {
      const { source, gateway } = await fixture();
      const session = await gateway.registerLocalSession({ source });
      const response = await fetch(session.mediaUrl, { headers: { Range: range } });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
      expect(await response.text()).toBe("");
    },
  );

  test("HEAD has metadata and no body; mutations are refused", async () => {
    const { source, gateway } = await fixture();
    const session = await gateway.registerLocalSession({ source });
    const head = await fetch(session.mediaUrl, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(head.headers.get("content-type")).toContain("video/mp4");
    expect(await head.text()).toBe("");
    expect((await fetch(session.mediaUrl, { method: "POST" })).status).toBe(405);
  });

  test("missing, truncated and replaced files fail closed without leaking paths", async () => {
    const { source, gateway, root } = await fixture();
    const session = await gateway.registerLocalSession({ source });
    await Bun.write(source.filePath, "short");
    expect((await fetch(session.mediaUrl)).status).toBe(409);
    await Bun.write(join(root, "replacement"), "abcdefghij");
    await rename(join(root, "replacement"), source.filePath);
    expect((await fetch(session.mediaUrl)).status).toBe(409);
    await rm(source.filePath);
    const missing = await fetch(session.mediaUrl);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain(root);
  });

  test("invalid source size and absent sidecars reject registration", async () => {
    const { source, gateway } = await fixture();
    await expect(
      gateway.registerLocalSession({ source: { ...source, fileSize: 20 } }),
    ).rejects.toThrow();
    await rm(source.subtitlePath!);
    await expect(gateway.registerLocalSession({ source })).rejects.toThrow();
  });

  test("replacement and session stop revoke only their own tokens", async () => {
    const { source, gateway } = await fixture();
    const first = await gateway.registerLocalSession({ source });
    const second = await gateway.registerLocalSession({ source });
    expect((await fetch(first.mediaUrl)).status).toBe(404);
    first.stop();
    expect(await (await fetch(second.mediaUrl)).text()).toBe("0123456789");
    second.stop();
    expect((await fetch(second.mediaUrl)).status).toBe(404);
    expect(gateway.isStopped()).toBe(false);
  });
});

test("cancelled asynchronous authorization cannot replace the current local token", async () => {
  const { source, gateway } = await fixture();
  const current = await gateway.registerLocalSession({ source });
  const controller = new AbortController();
  const stale = gateway.registerLocalSession({ source, signal: controller.signal });
  controller.abort();
  await expect(stale).rejects.toMatchObject({ name: "AbortError" });
  expect(await (await fetch(current.mediaUrl)).text()).toBe("0123456789");
});
