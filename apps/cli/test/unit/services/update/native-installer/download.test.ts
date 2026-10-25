import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { getEventListeners } from "node:events";
import { existsSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
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

import { waitUntil } from "../../../../support/wait-until";

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

/** Deliver only stall callbacks explicitly, without scheduling wall-clock races. */
function manualStallTimers(stallMs: number) {
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  const pending = new Map<unknown, () => void>();
  const secondRead = Promise.withResolvers<void>();
  let reads = 0;
  const scheduled = spyOn(globalThis, "setTimeout").mockImplementation(
    Object.assign(
      (...args: Parameters<typeof schedule>) => {
        const timer = schedule(...args);
        if (args[1] === stallMs) {
          cancel(timer);
          const [callback, , ...callbackArgs] = args;
          pending.set(timer, () => callback(...callbackArgs));
          if (++reads === 2) secondRead.resolve();
        }
        return timer;
      },
      { __promisify__: schedule.__promisify__ },
    ),
  );
  const clear = (...args: Parameters<typeof cancel>) => {
    pending.delete(args[0]);
    cancel(...args);
  };
  // SAFETY: all overloads forward their original arguments unchanged to cancel.
  const cancelled = spyOn(globalThis, "clearTimeout").mockImplementation(clear as typeof cancel);
  return {
    secondRead: secondRead.promise,
    get activeCount() {
      return pending.size;
    },
    expire() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    restore() {
      pending.clear();
      cancelled.mockRestore();
      scheduled.mockRestore();
    },
  };
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

function streamResponse(chunks: readonly Uint8Array[]): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) controller.close();
        else controller.enqueue(chunks[index++]!);
      },
    }),
  );
}

function stalledResponse(chunk: Uint8Array) {
  let cancellations = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        // Leave the body open without an unresolved async pull callback.
      },
      cancel() {
        cancellations++;
      },
    }),
  );
  return {
    response,
    get cancellations() {
      return cancellations;
    },
  };
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
  test.each(["open", "write"] as const)(
    "local file %s does not consume the response stall budget",
    async (phase) => {
      const { path } = await tempDest();
      const timers = manualStallTimers(40);
      const openFile = fsPromises.open;
      let timersWhileOpening: number | undefined;
      let timersWhileWriting: number | undefined;
      let restoreWrite: (() => void) | undefined;
      const opening = spyOn(fsPromises, "open").mockImplementation(async (...args) => {
        timersWhileOpening = timers.activeCount;
        // Model slow local IO by delivering every currently armed stall callback.
        if (phase === "open") timers.expire();
        const file = await openFile(...args);
        const write = file.write.bind(file);
        const writeWithStallCheck = (...writeArgs: Parameters<typeof write>) => {
          timersWhileWriting = timers.activeCount;
          if (phase === "write") timers.expire();
          return write(...writeArgs);
        };
        // SAFETY: the wrapper preserves every overload's arguments and result.
        const writing = spyOn(file, "write").mockImplementation(
          writeWithStallCheck as typeof write,
        );
        restoreWrite = () => writing.mockRestore();
        return file;
      });
      try {
        await expect(
          downloadToFile({
            url: "https://example.test/ready-body",
            destinationPath: path,
            fetchImpl: async () => textResponse("ok"),
            policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, stallDeadlineMs: 40, maxAttempts: 1 },
          }),
        ).resolves.toMatchObject({ attempts: 1, sizeBytes: 2 });
        expect(timersWhileOpening).toBe(0);
        expect(timersWhileWriting).toBe(0);
        expect(timers.activeCount).toBe(0);
        expect(await Bun.file(path).text()).toBe("ok");
      } finally {
        restoreWrite?.();
        opening.mockRestore();
        timers.restore();
      }
    },
  );

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

  test("successful chunked downloads release abort listeners and the reader lock", async () => {
    const { path } = await tempDest();
    const watchedSignals = new Set<AbortSignal>();
    const originalAdd = AbortSignal.prototype.addEventListener;
    const add = spyOn(AbortSignal.prototype, "addEventListener").mockImplementation(function (
      this: AbortSignal,
      type: string,
      listener: Parameters<AbortSignal["addEventListener"]>[1],
      options?: Parameters<AbortSignal["addEventListener"]>[2],
    ) {
      if (type === "abort") watchedSignals.add(this);
      return originalAdd.call(this, type, listener, options);
    });
    const response = streamResponse(Array.from({ length: 32 }, () => new Uint8Array(16).fill(1)));
    try {
      await downloadToFile({
        url: "https://example.test/chunks",
        destinationPath: path,
        fetchImpl: async () => response,
        policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 1 },
      });
      expect(watchedSignals.size).toBeGreaterThan(0);
      expect({
        abortListeners: Math.max(
          0,
          ...Array.from(watchedSignals, (signal) => getEventListeners(signal, "abort").length),
        ),
        locked: response.body?.locked,
      }).toEqual({ abortListeners: 0, locked: false });
    } finally {
      add.mockRestore();
    }
  });

  test("abort acknowledged with a ready response cannot publish a download", async () => {
    const { path } = await tempDest();
    const controller = new AbortController();
    await expect(
      downloadToFile({
        url: "https://example.test/abort-at-response",
        destinationPath: path,
        signal: controller.signal,
        fetchImpl: async () => {
          controller.abort();
          return textResponse("must-not-publish");
        },
        policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_ABORTED" });
    expect(existsSync(path)).toBe(false);
  });

  test("HTTP rejection cancels its unconsumed response body", async () => {
    const { path } = await tempDest();
    let cancellations = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancellations++;
        },
      }),
      { status: 403 },
    );
    await expect(
      downloadToFile({
        url: "https://example.test/refused",
        destinationPath: path,
        fetchImpl: async () => response,
        policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 1 },
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_HTTP", status: 403 });
    expect(cancellations).toBe(1);
    expect(response.body?.locked).toBe(false);
  });

  test("file-open failure cancels the response and releases its reader", async () => {
    const { path } = await tempDest();
    let cancellations = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancellations++;
        },
      }),
    );
    const open = spyOn(fsPromises, "open").mockRejectedValue(new Error("fixture-open-denied"));
    try {
      await expect(
        downloadToFile({
          url: "https://example.test/open-denied",
          destinationPath: path,
          fetchImpl: async () => response,
          policy: { ...DEFAULT_BINARY_DOWNLOAD_POLICY, maxAttempts: 1 },
        }),
      ).rejects.toThrow("fixture-open-denied");
      expect({ cancellations, locked: response.body?.locked }).toEqual({
        cancellations: 1,
        locked: false,
      });
    } finally {
      open.mockRestore();
    }
  });

  test("stalled response cleans partial file and retries", async () => {
    const { path } = await tempDest();
    const timers = manualStallTimers(40);
    const first = stalledResponse(new TextEncoder().encode("partial"));
    let calls = 0;
    try {
      const pending = downloadToFile({
        url: "https://example.test/stall",
        destinationPath: path,
        fetchImpl: async () => {
          calls++;
          if (calls === 1) return first.response;
          expect(existsSync(path)).toBe(false);
          return textResponse("ok");
        },
        policy: {
          totalDeadlineMs: 5_000,
          stallDeadlineMs: 40,
          maxAttempts: 2,
          maxBytes: 1024,
          retryBaseDelayMs: 0,
        },
      });
      const result = pending.then(
        (value) => ({ value }),
        (cause: unknown) => ({ error: cause }),
      );
      await timers.secondRead;
      expect(await Bun.file(path).text()).toBe("partial");
      expect(timers.activeCount).toBe(1);
      timers.expire();
      expect(await result).toMatchObject({ value: { attempts: 2, sizeBytes: 2 } });
      expect(calls).toBe(2);
      expect(first.cancellations).toBe(1);
      expect(first.response.body?.locked).toBe(false);
      expect(timers.activeCount).toBe(0);
      expect(await Bun.file(path).text()).toBe("ok");
    } finally {
      timers.restore();
    }
  });

  test("stalled final attempt removes partial destination", async () => {
    const { path } = await tempDest();
    const timers = manualStallTimers(40);
    const stalled = stalledResponse(new TextEncoder().encode("x"));
    try {
      const pending = downloadToFile({
        url: "https://example.test/stall-final",
        destinationPath: path,
        fetchImpl: async () => stalled.response,
        policy: {
          totalDeadlineMs: 5_000,
          stallDeadlineMs: 40,
          maxAttempts: 1,
          maxBytes: 1024,
          retryBaseDelayMs: 0,
        },
      });
      const result = pending.then(
        (value) => ({ value }),
        (cause: unknown) => ({ error: cause }),
      );
      await timers.secondRead;
      expect(await Bun.file(path).text()).toBe("x");
      expect(timers.activeCount).toBe(1);
      timers.expire();
      expect(await result).toMatchObject({ error: { code: "DOWNLOAD_STALL" } });
      expect(existsSync(path)).toBe(false);
      expect(stalled.cancellations).toBe(1);
      expect(stalled.response.body?.locked).toBe(false);
      expect(timers.activeCount).toBe(0);
    } finally {
      timers.restore();
    }
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

    await waitUntil(() => calls === 1, { label: "download fetch invoked" });
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
