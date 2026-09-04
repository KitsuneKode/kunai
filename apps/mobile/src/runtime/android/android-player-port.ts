import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import { resolveAndroidIntentPlan } from "@kunai/core";

import type { MobilePlayerPort } from "../../application/contracts";

export interface AndroidPlayerRuntime {
  readonly which: (command: string) => string | undefined;
  readonly spawn: (argv: readonly string[]) => Promise<{ readonly exitCode: number }>;
}

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
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ exitCode: code ?? 1 }));
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
          termuxOpen: runtime.which("termux-open"),
          termuxOpenUrl: runtime.which("termux-open-url"),
        },
      });
      if (!plan.ok) return { kind: "rejected", reason: plan.reason };
      try {
        const result = await runtime.spawn(plan.argv);
        return result.exitCode === 0
          ? { kind: "accepted", launcher: plan.launcher }
          : { kind: "rejected", reason: "launch-rejected" };
      } catch {
        return { kind: "rejected", reason: "launch-rejected" };
      }
    },
  };
}
