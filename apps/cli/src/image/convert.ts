import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { debugImage } from "./debug";
import { isPngBytes } from "./png";

const MAGICK_CMD = "magick";

const DEFAULT_MAGICK_TIMEOUT_MS = 30_000;
const MIN_MAGICK_TIMEOUT_MS = 1_000;
const MAX_MAGICK_TIMEOUT_MS = 120_000;

type MagickSpawnOptions = {
  readonly stdout: "pipe";
  readonly stderr: "pipe";
  readonly signal?: AbortSignal;
};

const runtime = {
  which: (command: string): string | null => Bun.which(command),
  spawn: (command: string[], options: MagickSpawnOptions) => Bun.spawn(command, options),
};

function resolveMagickTimeoutMs(): number {
  const raw = process.env.KUNAI_IMAGE_MAGICK_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_MAGICK_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAGICK_TIMEOUT_MS;
  return Math.min(Math.max(n, MIN_MAGICK_TIMEOUT_MS), MAX_MAGICK_TIMEOUT_MS);
}

async function collectStream(stream: ReadableStream | null): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function ensurePngBytes(data: Uint8Array): Promise<Uint8Array | null> {
  if (data.byteLength === 0) return null;
  if (isPngBytes(data)) return data;

  if (!runtime.which(MAGICK_CMD)) {
    debugImage("ImageMagick not available for PNG conversion");
    return null;
  }

  const dir = await mkdtemp(join(tmpdir(), "kunai-poster-"));
  const inputPath = join(dir, "poster.input");
  const outputPath = join(dir, "poster.png");

  const timeoutMs = resolveMagickTimeoutMs();
  const abort = new AbortController();
  const timeoutId = setTimeout(() => {
    debugImage(`ImageMagick timed out after ${timeoutMs}ms`);
    abort.abort();
  }, timeoutMs);

  try {
    await Bun.write(inputPath, data);
    const proc = runtime.spawn([MAGICK_CMD, inputPath, `png:${outputPath}`], {
      stdout: "pipe",
      stderr: "pipe",
      signal: abort.signal,
    });
    const [exitCode, stderr] = await Promise.all([proc.exited, collectStream(proc.stderr)]);
    if (exitCode !== 0) {
      if (!abort.signal.aborted) {
        const errorText = stderr.length > 0 ? new TextDecoder().decode(stderr).trim() : "";
        debugImage(
          `ImageMagick conversion failed (code ${exitCode})${errorText ? `: ${errorText}` : ""}`,
        );
      }
      return null;
    }
    const output = await Bun.file(outputPath).arrayBuffer();
    if (output.byteLength === 0) return null;
    return new Uint8Array(output);
  } catch (error) {
    if (abort.signal.aborted) {
      return null;
    }
    debugImage(
      `ImageMagick conversion failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
    await rm(dir, { recursive: true, force: true });
  }
}

export const __testing = {
  runtime,
  resolveMagickTimeoutMs,
};
