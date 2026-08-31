import { describe, expect, test } from "bun:test";

import {
  createBufferedAndroidReadLine,
  createBunTerminalPort,
} from "../../../../src/runtime/android/bun-terminal-port";

describe("Bun Android terminal port", () => {
  test("cancels the pending stdin read when SIGINT interrupts a prompt", async () => {
    let interrupt: (() => void) | undefined;
    let cancelled = false;
    const readLine = createBufferedAndroidReadLine({
      read: async () => await new Promise<never>(() => {}),
      cancel: async () => {
        cancelled = true;
      },
      onInterrupt(handler) {
        interrupt = handler;
        return () => {
          interrupt = undefined;
        };
      },
    });

    const pending = readLine();
    interrupt?.();

    await expect(pending).resolves.toEqual({ kind: "cancelled" });
    expect(cancelled).toBe(true);
    expect(interrupt).toBeUndefined();
  });

  test("accepts either a choice number or exact value", async () => {
    for (const answer of ["1", "continue"]) {
      const output: string[] = [];
      const port = createBunTerminalPort({
        write: async (value) => {
          output.push(value);
        },
        readLine: async () => answer,
      });

      await expect(
        port.choose({
          prompt: "Continue?",
          choices: [
            { value: "continue", label: "Run proof" },
            { value: "cancel", label: "Cancel" },
          ],
        }),
      ).resolves.toEqual({ kind: "selected", value: "continue" });
      expect(output.join("")).toContain("1. Run proof");
    }
  });

  test("retries invalid input and treats zero, EOF, or cancellation as cancelled", async () => {
    const answers: (string | null)[] = ["invalid", "0"];
    const port = createBunTerminalPort({
      write: async () => {},
      readLine: async () => answers.shift() ?? null,
    });
    await expect(
      port.choose({ prompt: "Continue?", choices: [{ value: "continue", label: "Run" }] }),
    ).resolves.toEqual({ kind: "cancelled" });

    for (const answer of [null, { kind: "cancelled" } as const]) {
      const cancelled = createBunTerminalPort({
        write: async () => {},
        readLine: async () => answer,
      });
      await expect(
        cancelled.choose({
          prompt: "Continue?",
          choices: [{ value: "continue", label: "Run" }],
        }),
      ).resolves.toEqual({ kind: "cancelled" });
    }
  });
});
