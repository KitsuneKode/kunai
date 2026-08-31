import { resolveAndroidIntentPlan } from "@kunai/core";

import type { MobilePlayerPort } from "../../application/contracts";

export interface AndroidPlayerRuntime {
  readonly which: (command: string) => string | undefined;
  readonly spawn: (argv: readonly string[]) => Promise<{ readonly exitCode: number }>;
}

export const defaultAndroidPlayerRuntime: AndroidPlayerRuntime = {
  which: (command) => Bun.which(command) ?? undefined,
  spawn: async (argv) => {
    const child = Bun.spawn([...argv], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return { exitCode: await child.exited };
  },
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
