import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_BINARY_DOWNLOAD_POLICY,
  DownloadError,
  downloadToFile,
  isRetryableDownloadError,
  writeAllBytes,
} from "@/services/update/native-installer/download";

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempDest(name = "artifact.bin"): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "kunai-dl-"));
  made.push(root);
  return { root, path: join(root, name) };
}

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function streamResponse(
  chunks: readonly Uint8Array[],
  init: {
    status?: number;
    headers?: Record<string, string>;
    delayMs?: number;
    stallAfterChunk?: number;
  } = {},
): Response {
  let index = 0;
  const delayMs = init.delayMs ?? 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Stall check first so we can hang after N chunks without closing.
      if (init.stallAfterChunk !== undefined && index === init.stallAfterChunk) {
        await new Promise(() => {});
        return;
      }
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      if (delayMs > 0) await Bun.sleep(delayMs);
      controller.enqueue(chunks[index]!);
      index += 1;
    },
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

describe("download policy defaults", () => {
  test("binary defaults match global S6 policy", () => {
    expect(DEFAULT_BINARY_DOWNLOAD_POLICY).toEqual({
      totalDeadlineMs: 300_000,
      stallDeadlineMs: 30_000,
      maxAttempts: 3,
      maxBytes: 256 * 1024 * 1024,
      retryBaseDelayMs: 1_000,
    });
  });
});

describe("downloadToFile", () => {
  test("streams bytes, hashes, and reports attempts", async () => {
    const { path } = await tempDest();
    const bytes = new TextEncoder().encode("hello-kunai");
    const result = await downloadToFile({
      url: "https://example.test/bin",
      destinationPath: path,
      fetchImpl: async () => streamResponse([bytes]),
      policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 1, maxBytes: 64 },
    });

    expect(result.attempts).toBe(1);
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.path).toBe(path);
    expect(await Bun.file(path).text()).toBe("hello-kunai");
    expect(Bun.file(path).size).toBe(result.sizeBytes);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("stalled response cleans partial file and retries", async () => {
    const { path } = await tempDest();
    let calls = 0;
    const firstChunk = new TextEncoder().encode("partial");

    await expect(
      downloadToFile({
        url: "https://example.test/stall",
        destinationPath: path,
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return streamResponse([firstChunk], { stallAfterChunk: 1, delayMs: 5 });
          }
          return textResponse("ok");
        },
        policy: {
          totalDeadlineMs: 2_000,
          stallDeadlineMs: 40,
          maxAttempts: 2,
          maxBytes: 1024,
          retryBaseDelayMs: 10,
        },
      }),
    ).resolves.toMatchObject({ attempts: 2, sizeBytes: 2 });

    expect(calls).toBe(2);
    expect(await Bun.file(path).text()).toBe("ok");
  });

  test("stalled final attempt removes partial destination", async () => {
    const { path } = await tempDest();

    await expect(
      downloadToFile({
        url: "https://example.test/stall-final",
        destinationPath: path,
        fetchImpl: async () =>
          streamResponse([new TextEncoder().encode("x")], { stallAfterChunk: 1 }),
        policy: {
          totalDeadlineMs: 500,
          stallDeadlineMs: 30,
          maxAttempts: 1,
          maxBytes: 1024,
          retryBaseDelayMs: 1,
        },
      }),
    ).rejects.toThrow(/stall/i);

    expect(existsSync(path)).toBe(false);
  });

  test("Content-Length over limit fails without retry", async () => {
    const { path } = await tempDest();
    let calls = 0;

    await expect(
      downloadToFile({
        url: "https://example.test/too-big-header",
        destinationPath: path,
        fetchImpl: async () => {
          calls += 1;
          return textResponse("x".repeat(8), {
            headers: { "content-length": "100" },
          });
        },
        policy: {
          ...DEFAULT_BINARY_DOWNLOAD_POLICY,
          maxAttempts: 3,
          maxBytes: 16,
          retryBaseDelayMs: 1,
        },
      }),
    ).rejects.toThrow(/size|limit|bytes/i);

    expect(calls).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  test("chunked body over limit fails without retry", async () => {
    const { path } = await tempDest();
    let calls = 0;
    const chunk = new Uint8Array(12).fill(1);

    await expect(
      downloadToFile({
        url: "https://example.test/too-big-chunked",
        destinationPath: path,
        fetchImpl: async () => {
          calls += 1;
          return streamResponse([chunk, chunk]);
        },
        policy: {
          ...DEFAULT_BINARY_DOWNLOAD_POLICY,
          maxAttempts: 3,
          maxBytes: 16,
          retryBaseDelayMs: 1,
        },
      }),
    ).rejects.toThrow(/size|limit|bytes/i);

    expect(calls).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  test("zero-byte body fails without retry", async () => {
    const { path } = await tempDest();
    let calls = 0;

    await expect(
      downloadToFile({
        url: "https://example.test/empty",
        destinationPath: path,
        fetchImpl: async () => {
          calls += 1;
          return textResponse("");
        },
        policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 3, retryBaseDelayMs: 1 },
      }),
    ).rejects.toThrow(/empty|zero/i);

    expect(calls).toBe(1);
  });

  test("404 is not retried", async () => {
    const { path } = await tempDest();
    let calls = 0;

    await expect(
      downloadToFile({
        url: "https://example.test/missing",
        destinationPath: path,
        fetchImpl: async () => {
          calls += 1;
          return textResponse("nope", { status: 404 });
        },
        policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 3, retryBaseDelayMs: 1 },
      }),
    ).rejects.toThrow(/404/);

    expect(calls).toBe(1);
  });

  test("429 and 5xx are retried then succeed", async () => {
    const { path } = await tempDest();
    const statuses = [429, 503, 200];
    let calls = 0;

    const result = await downloadToFile({
      url: "https://example.test/retry",
      destinationPath: path,
      fetchImpl: async () => {
        const status = statuses[calls] ?? 200;
        calls += 1;
        return textResponse(status === 200 ? "done" : "wait", { status });
      },
      policy: {
        totalDeadlineMs: 5_000,
        stallDeadlineMs: 1_000,
        maxAttempts: 3,
        maxBytes: 64,
        retryBaseDelayMs: 5,
      },
    });

    expect(calls).toBe(3);
    expect(result.attempts).toBe(3);
    expect(await Bun.file(path).text()).toBe("done");
  });

  test("caller abort is not retried", async () => {
    const { path } = await tempDest();
    let calls = 0;
    const controller = new AbortController();

    const pending = downloadToFile({
      url: "https://example.test/abort",
      destinationPath: path,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        calls += 1;
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing signal"));
            return;
          }
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        return textResponse("never");
      },
      policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 3, retryBaseDelayMs: 1 },
    });

    await Bun.sleep(10);
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(calls).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  test("one total deadline spans all attempts", async () => {
    const { path } = await tempDest();
    let calls = 0;

    await expect(
      downloadToFile({
        url: "https://example.test/budget",
        destinationPath: path,
        fetchImpl: async () => {
          calls += 1;
          await Bun.sleep(80);
          return textResponse("fail", { status: 503 });
        },
        policy: {
          totalDeadlineMs: 150,
          stallDeadlineMs: 1_000,
          maxAttempts: 5,
          maxBytes: 64,
          retryBaseDelayMs: 1,
        },
      }),
    ).rejects.toThrow(/deadline|timeout|time/i);

    expect(calls).toBeLessThan(5);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe("writeAllBytes", () => {
  test("retries until injectable short writer drains the buffer", async () => {
    const source = new TextEncoder().encode("abcdef");
    const sink: number[] = [];
    let calls = 0;

    await writeAllBytes(async (chunk, offset, length) => {
      calls += 1;
      // Simulate FileHandle short writes of 1–2 bytes.
      const n = Math.min(2, length);
      for (let i = 0; i < n; i += 1) sink.push(chunk[offset + i]!);
      return n;
    }, source);

    expect(calls).toBe(3);
    expect(new TextDecoder().decode(Uint8Array.from(sink))).toBe("abcdef");
  });

  test("zero-byte write fails as DOWNLOAD_INCOMPLETE", async () => {
    try {
      await writeAllBytes(async () => 0, new TextEncoder().encode("x"));
      expect.unreachable("expected DOWNLOAD_INCOMPLETE");
    } catch (error) {
      expect(error).toBeInstanceOf(DownloadError);
      expect((error as DownloadError).code).toBe("DOWNLOAD_INCOMPLETE");
    }
  });
});

describe("isRetryableDownloadError", () => {
  test("classifies retryable vs terminal failures", () => {
    expect(
      isRetryableDownloadError(Object.assign(new Error("x"), { code: "DOWNLOAD_STALL" })),
    ).toBe(true);
    expect(
      isRetryableDownloadError(
        Object.assign(new Error("x"), { code: "DOWNLOAD_HTTP", status: 429 }),
      ),
    ).toBe(true);
    expect(
      isRetryableDownloadError(
        Object.assign(new Error("x"), { code: "DOWNLOAD_HTTP", status: 404 }),
      ),
    ).toBe(false);
    expect(isRetryableDownloadError(Object.assign(new Error("x"), { code: "DOWNLOAD_SIZE" }))).toBe(
      false,
    );
    expect(
      isRetryableDownloadError(Object.assign(new Error("x"), { code: "DOWNLOAD_EMPTY" })),
    ).toBe(false);
    expect(
      isRetryableDownloadError(Object.assign(new Error("x"), { code: "DOWNLOAD_INCOMPLETE" })),
    ).toBe(true);
  });
});
