import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import type { MobilePlayerPort } from "../../application/contracts";
import { resolveAndroidIntentPlan } from "./android-intent-plan";

export interface AndroidPlayerRuntime {
  readonly which: (command: string) => string | undefined;
  readonly spawn: (
    argv: readonly string[],
  ) => Promise<{ readonly exitCode: number; readonly output: string }>;
}

// `am` and `termux-am` report intent-resolution failures on stderr/stdout and,
// on some stacks, still exit 0; the exit code alone cannot prove the launch.
const LAUNCH_ERROR_PATTERN =
  /error|denial|exception|unable|does not exist|no activity|not found|not started/iu;

function findExecutable(command: string): string | undefined {
  const candidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, command));
  if (command === "am") candidates.push("/system/bin/am");
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next fixed executable candidate.
    }
  }
  return undefined;
}

export const defaultAndroidPlayerRuntime: AndroidPlayerRuntime = {
  which: findExecutable,
  spawn: async (argv) =>
    await new Promise((resolve, reject) => {
      const [command, ...args] = argv;
      if (!command) {
        reject(new Error("missing Android launcher"));
        return;
      }
      const child = spawn(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const chunks: string[] = [];
      child.stdout?.on("data", (chunk: Buffer | string) => chunks.push(String(chunk)));
      child.stderr?.on("data", (chunk: Buffer | string) => chunks.push(String(chunk)));
      child.once("error", reject);
      child.once("close", (code) => resolve({ exitCode: code ?? 1, output: chunks.join("") }));
    }),
};

export function createAndroidPlayerPort(
  input: {
    readonly runtime?: AndroidPlayerRuntime;
  } = {},
): MobilePlayerPort {
  const runtime = input.runtime ?? defaultAndroidPlayerRuntime;
  return {
    async handoff(request) {
      const plan = resolveAndroidIntentPlan({
        target: request.player,
        url: request.url,
        launchers: {
          termuxAm: runtime.which("termux-am"),
          am: runtime.which("am"),
        },
      });
      if (!plan.ok) return { kind: "rejected", reason: plan.reason };
      try {
        const result = await runtime.spawn(plan.argv);
        return result.exitCode === 0 && !LAUNCH_ERROR_PATTERN.test(result.output)
          ? { kind: "accepted", launcher: plan.launcher }
          : { kind: "rejected", reason: "launch-rejected" };
      } catch {
        return { kind: "rejected", reason: "launch-rejected" };
      }
    },
  };
}
