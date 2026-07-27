import { describe, expect, test } from "bun:test";

import { terminateMpvProcess } from "@/infra/player/mpv-process-registry";

function createDeferredProcess(options: { exitOn: NodeJS.Signals }) {
  let resolveExit!: (code: number) => void;
  const signals: NodeJS.Signals[] = [];
  const process = {
    exited: new Promise<number>((resolve) => {
      resolveExit = resolve;
    }),
    exitCode: null as number | null,
    kill(signal: NodeJS.Signals = "SIGTERM") {
      signals.push(signal);
      if (signal !== options.exitOn || this.exitCode !== null) return;
      this.exitCode = signal === "SIGTERM" ? 0 : 137;
      resolveExit(this.exitCode);
    },
  };
  return { process, signals };
}

describe("mpv process termination", () => {
  test("waits for graceful termination before releasing process ownership", async () => {
    const fake = createDeferredProcess({ exitOn: "SIGTERM" });

    const result = await terminateMpvProcess(fake.process, {
      gracefulTimeoutMs: 1,
      forceTimeoutMs: 1,
      sleep: async () => {},
    });

    expect(fake.signals).toEqual(["SIGTERM"]);
    expect(result).toEqual({ exited: true, exitCode: 0, signal: "SIGTERM" });
  });

  test("escalates an unresponsive player before allowing fallback", async () => {
    const fake = createDeferredProcess({ exitOn: "SIGKILL" });

    const result = await terminateMpvProcess(fake.process, {
      gracefulTimeoutMs: 1,
      forceTimeoutMs: 1,
      sleep: async () => {},
    });

    expect(fake.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result).toEqual({ exited: true, exitCode: 137, signal: "SIGKILL" });
  });
});
