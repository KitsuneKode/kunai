import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { debugImage } from "./debug";
import { isPngBytes } from "./png";

const MAGICK_CMD = "magick";
const runtime = {
  which: (command: string): string | null => Bun.which(command),
  spawn: (command: string[], options?: Bun.SpawnOptions.OptionsObject<any, "pipe", "pipe">) =>
    Bun.spawn(command, options as Bun.SpawnOptions.OptionsObject<any, "pipe", "pipe">),
};

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

  try {
    await Bun.write(inputPath, data);
    const proc = runtime.spawn([MAGICK_CMD, inputPath, `png:${outputPath}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([proc.exited, collectStream(proc.stderr)]);
    if (exitCode !== 0) {
      const errorText = stderr.length > 0 ? new TextDecoder().decode(stderr).trim() : "";
      debugImage(
        `ImageMagick conversion failed (code ${exitCode})${errorText ? `: ${errorText}` : ""}`,
      );
      return null;
    }
    const output = await Bun.file(outputPath).arrayBuffer();
    if (output.byteLength === 0) return null;
    return new Uint8Array(output);
  } catch (error) {
    debugImage(
      `ImageMagick conversion failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const __testing = {
  runtime,
};
