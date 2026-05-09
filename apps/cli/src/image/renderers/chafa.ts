import { debugImage } from "../debug";
import type { ImageRenderOptions } from "../types";

const runtime = {
  spawn: (command: string[], options?: Bun.SpawnOptions.OptionsObject<any, "pipe", "pipe">) =>
    Bun.spawn(command, options as Bun.SpawnOptions.OptionsObject<any, "pipe", "pipe">),
};

async function runChafa(args: string[]): Promise<void> {
  const proc = runtime.spawn(["chafa", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);

  if (exitCode === 0) {
    if (stdoutBuf.byteLength > 0) {
      process.stdout.write(Buffer.from(stdoutBuf));
    }
    return;
  }

  const stderrText = stderrBuf.byteLength ? new TextDecoder().decode(stderrBuf).trim() : "";
  const message = `chafa failed (code ${exitCode})${stderrText ? `: ${stderrText}` : ""}`;
  debugImage(message);
  throw new Error(message);
}

export async function renderChafaSixels(
  filePath: string,
  options: ImageRenderOptions,
): Promise<void> {
  await runChafa([
    "--format",
    "sixels",
    "--size",
    options.size,
    "--animate",
    "off",
    "--polite",
    "on",
    "--margin-bottom",
    "1",
    filePath,
  ]);
}

export async function renderChafaSymbols(
  filePath: string,
  options: ImageRenderOptions,
): Promise<void> {
  await runChafa([
    "--format",
    "symbols",
    "--size",
    options.size,
    "--animate",
    "off",
    "--polite",
    "on",
    "--colors",
    "full",
    filePath,
  ]);
}

export async function renderChafaKitty(
  filePath: string,
  options: ImageRenderOptions,
): Promise<void> {
  await runChafa([
    "--format",
    "kitty",
    "--size",
    options.size,
    "--animate",
    "off",
    "--polite",
    "on",
    "--margin-bottom",
    "1",
    filePath,
  ]);
}

export const __testing = {
  runtime,
};
