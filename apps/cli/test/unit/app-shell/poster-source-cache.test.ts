import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearPosterSourceCache,
  fetchPosterSource,
  isLocalImagePath,
  localPathFromImageRef,
  resolvePosterUrl,
} from "@/app-shell/poster-source-cache";
import { MAX_POSTER_SOURCE_BYTES } from "@/image/native-image";

const realFetch = globalThis.fetch;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  clearPosterSourceCache();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kunai-poster-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * A response whose body streams `chunks` in order. `contentLength` is declared
 * independently so a lying or absent header can be exercised.
 */
function streamingResponse(
  chunks: readonly Uint8Array[],
  options: { contentLength?: number | null; failAfter?: number } = {},
): Response {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const index = pulls;
      pulls += 1;
      if (options.failAfter !== undefined && index >= options.failAfter) {
        controller.error(new Error("connection reset"));
        return;
      }
      const chunk = chunks[index];
      if (!chunk) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  let pulls = 0;

  const headers = new Headers();
  const declared =
    options.contentLength === undefined
      ? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      : options.contentLength;
  if (declared !== null) headers.set("content-length", String(declared));

  const response = new Response(stream, { status: 200, headers });
  Object.defineProperty(response, "__cancelled", { get: () => cancelled });
  return response;
}

function bytesOf(length: number, fill = 0xab): Uint8Array {
  const out = new Uint8Array(length);
  out.fill(fill);
  return out;
}

describe("fetchPosterSource — remote bounds", () => {
  test("rejects a declared length over the limit by cancelling, not draining", async () => {
    // Note a stream eagerly pre-fills one chunk at construction, before this
    // code ever sees the response, so "did any pull happen" says nothing. What
    // matters is that the body is cancelled rather than read to completion.
    const declaredHuge = streamingResponse([bytesOf(16), bytesOf(16), bytesOf(16)], {
      contentLength: MAX_POSTER_SOURCE_BYTES + 1,
    });
    globalThis.fetch = (async () => declaredHuge) as unknown as typeof fetch;

    const source = await fetchPosterSource("https://cdn.example.test/huge.jpg");

    expect(source).toBeNull();
    // Content-Length is the cheap rejection: streaming 16 MiB only to discard it
    // wastes the bandwidth the limit exists to protect.
    expect((declaredHuge as unknown as { __cancelled: boolean }).__cancelled).toBe(true);
  });

  test("accepts a body at exactly the limit", async () => {
    globalThis.fetch = (async () =>
      streamingResponse([bytesOf(MAX_POSTER_SOURCE_BYTES)])) as unknown as typeof fetch;

    const source = await fetchPosterSource("https://cdn.example.test/exact.jpg");

    expect(source?.bytes.byteLength).toBe(MAX_POSTER_SOURCE_BYTES);
  });

  test("accepts an undeclared body that stays within the limit", async () => {
    globalThis.fetch = (async () =>
      streamingResponse([bytesOf(1024), bytesOf(1024)], {
        contentLength: null,
      })) as unknown as typeof fetch;

    const source = await fetchPosterSource("https://cdn.example.test/chunked.jpg");

    expect(source?.bytes.byteLength).toBe(2048);
  });

  test("stops reading an undeclared body once it exceeds the limit", async () => {
    // A server that omits or understates Content-Length must still be bounded,
    // otherwise the header is the only defence and it is attacker-controlled.
    const oversized = streamingResponse(
      [bytesOf(MAX_POSTER_SOURCE_BYTES), bytesOf(1), bytesOf(1)],
      { contentLength: null },
    );
    globalThis.fetch = (async () => oversized) as unknown as typeof fetch;

    const source = await fetchPosterSource("https://cdn.example.test/liar.jpg");

    expect(source).toBeNull();
    expect((oversized as unknown as { __cancelled: boolean }).__cancelled).toBe(true);
  });

  test("concatenates chunks in order, byte for byte", async () => {
    const first = Uint8Array.from([1, 2, 3]);
    const second = Uint8Array.from([4, 5]);
    const third = Uint8Array.from([6]);
    globalThis.fetch = (async () =>
      streamingResponse([first, second, third], {
        contentLength: null,
      })) as unknown as typeof fetch;

    const source = await fetchPosterSource("https://cdn.example.test/ordered.jpg");

    expect([...(source?.bytes ?? [])]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("caches nothing when the stream errors mid-body, and retries afterwards", async () => {
    let attempt = 0;
    globalThis.fetch = (async () => {
      attempt += 1;
      return attempt === 1
        ? streamingResponse([bytesOf(8), bytesOf(8)], { contentLength: null, failAfter: 1 })
        : streamingResponse([bytesOf(4)], { contentLength: null });
    }) as unknown as typeof fetch;

    expect(await fetchPosterSource("https://cdn.example.test/flaky.jpg")).toBeNull();
    // A cached failure would make one dropped connection permanent for the
    // process, so the retry has to reach the network again.
    const retried = await fetchPosterSource("https://cdn.example.test/flaky.jpg");

    expect(retried?.bytes.byteLength).toBe(4);
    expect(attempt).toBe(2);
  });

  test("caches nothing for a non-ok response", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    expect(await fetchPosterSource("https://cdn.example.test/missing.jpg")).toBeNull();
    expect(await fetchPosterSource("https://cdn.example.test/missing.jpg")).toBeNull();
    expect(calls).toBe(2);
  });

  test("abandons the read and caches nothing when the caller aborts", async () => {
    const controller = new AbortController();
    const response = streamingResponse([bytesOf(8), bytesOf(8), bytesOf(8)], {
      contentLength: null,
    });
    globalThis.fetch = (async () => {
      controller.abort();
      return response;
    }) as unknown as typeof fetch;

    const source = await fetchPosterSource("https://cdn.example.test/abort.jpg", {
      signal: controller.signal,
    });

    expect(source).toBeNull();
    // A later caller must not be handed a half-read body from the cache.
    globalThis.fetch = (async () =>
      streamingResponse([bytesOf(4)], { contentLength: null })) as unknown as typeof fetch;
    expect((await fetchPosterSource("https://cdn.example.test/abort.jpg"))?.bytes.byteLength).toBe(
      4,
    );
  });

  test("serves a repeat request from cache without refetching", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return streamingResponse([bytesOf(32)], { contentLength: null });
    }) as unknown as typeof fetch;

    const first = await fetchPosterSource("https://cdn.example.test/warm.jpg");
    const second = await fetchPosterSource("https://cdn.example.test/warm.jpg");

    expect(calls).toBe(1);
    expect(second?.bytes.byteLength).toBe(first?.bytes.byteLength);
  });

  test("returns the resolved URL as the source identity", async () => {
    globalThis.fetch = (async () =>
      streamingResponse([bytesOf(16)], { contentLength: null })) as unknown as typeof fetch;

    const source = await fetchPosterSource("/poster.jpg", { cols: 18 });

    // Identity has to be the resolved asset, not the caller's raw path: the
    // prepared cache keys off it, and w342 and w780 are different images.
    expect(source?.identity).toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
  });
});

describe("fetchPosterSource — local bounds", () => {
  test("reads a local sidecar within the limit", async () => {
    const path = join(tempDir(), "poster.jpg");
    await Bun.write(path, bytesOf(2048));

    const source = await fetchPosterSource(path);

    expect(source?.bytes.byteLength).toBe(2048);
    expect(source?.identity).toBe(path);
  });

  test("normalises a file:// URL to an absolute path identity", async () => {
    const path = join(tempDir(), "poster.jpg");
    await Bun.write(path, bytesOf(16));

    const source = await fetchPosterSource(`file://${path}`);

    expect(source?.identity).toBe(path);
  });

  test("rejects a local file whose size exceeds the limit before reading it", async () => {
    const path = join(tempDir(), "huge.jpg");
    // Sparse-ish write: still a real file, and the size check must reject it
    // without pulling it into memory.
    await Bun.write(path, bytesOf(MAX_POSTER_SOURCE_BYTES + 1, 0x01));

    expect(await fetchPosterSource(path)).toBeNull();
  });

  test("returns null for a missing local file and caches nothing", async () => {
    const path = join(tempDir(), "absent.jpg");

    expect(await fetchPosterSource(path)).toBeNull();

    await Bun.write(path, bytesOf(8));
    expect((await fetchPosterSource(path))?.bytes.byteLength).toBe(8);
  });

  test("returns null for an empty local file", async () => {
    const path = join(tempDir(), "empty.jpg");
    await Bun.write(path, new Uint8Array());

    expect(await fetchPosterSource(path)).toBeNull();
  });
});

describe("resolvePosterUrl — geometry policy", () => {
  test.each([
    [18, "preview", "w342"],
    [24, "preview", "w500"],
    [40, "preview", "w780"],
    [24, "detail", "w500"],
    [40, "detail", "w780"],
  ])("cols %i variant %s selects %s", (cols, variant, expected) => {
    const resolved = resolvePosterUrl("/poster.jpg", {
      cols,
      variant: variant as "preview" | "detail",
    });

    expect(resolved).toContain(expected);
  });

  test("never requests the original asset", () => {
    for (const cols of [18, 24, 40, 200, 1000]) {
      for (const variant of ["preview", "detail"] as const) {
        // A terminal pane tops out near 40 cells, so an original costs fetch
        // latency and RAM without changing a single output cell.
        expect(resolvePosterUrl("/poster.jpg", { cols, variant })).not.toContain("original");
      }
    }
  });
});

describe("local path recognition is platform-shaped, not POSIX-only", () => {
  // Asserted as pure string logic so every platform runs every case. These were
  // only caught by Windows CI before, and the failure was silent: a Windows
  // thumbnail path fell through to fetch() and every local poster came back blank.
  test.each([
    ["POSIX absolute", "/home/u/.local/share/kunai/downloads/x.jpg"],
    ["Windows drive backslash", "C:\\Users\\u\\AppData\\Local\\kunai\\x.jpg"],
    ["Windows drive forward slash", "C:/Users/u/kunai/x.jpg"],
    ["Windows lowercase drive", "d:\\media\\x.jpg"],
    ["Windows UNC share", "\\\\server\\share\\x.jpg"],
    ["file URL", "file:///home/u/x.jpg"],
    ["Windows file URL", "file:///C:/Users/u/x.jpg"],
  ])("treats a %s as local", (_label, path) => {
    expect(isLocalImagePath(path)).toBe(true);
  });

  test.each([
    ["https URL", "https://image.tmdb.org/t/p/w342/x.jpg"],
    ["TMDB relative path", "/x.jpg"],
    ["bare filename", "x.jpg"],
    ["protocol-relative URL", "//cdn.example.test/x.jpg"],
  ])("does not treat a %s as local", (_label, path) => {
    expect(isLocalImagePath(path)).toBe(false);
  });

  test("strips the scheme from a Windows file URL down to an openable path", () => {
    // "/C:/Users/x" is not a path Windows can open, so the leading slash a
    // well-formed file URL carries has to go.
    expect(localPathFromImageRef("file:///C:/Users/u/x.jpg")).toBe("C:/Users/u/x.jpg");
    expect(localPathFromImageRef("file:///home/u/x.jpg")).toBe("/home/u/x.jpg");
    expect(localPathFromImageRef("/home/u/x.jpg")).toBe("/home/u/x.jpg");
  });

  test("resolvePosterUrl leaves a Windows path alone instead of treating it as TMDB", () => {
    const windowsPath = "C:\\Users\\u\\kunai\\downloads\\poster.jpg";

    expect(resolvePosterUrl(windowsPath, { cols: 18 })).toBe(windowsPath);
  });
});
