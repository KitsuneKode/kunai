import { describe, expect, test } from "bun:test";

import {
  createBufferedAndroidReadLine,
  createNodeTerminalPort,
} from "../../../../src/runtime/android/node-terminal-port";

describe("Node Android terminal port", () => {
  test("releases the host input handle on close", async () => {
    let closed = 0;
    const port = createNodeTerminalPort({
      write: async () => {},
      readLine: async () => "1",
      close: async () => {
        closed += 1;
      },
    });

    await port.render(["Usage"]);
    await port.close();
    await port.choose({ prompt: "Continue?", choices: [{ value: "continue", label: "Run" }] });
    await port.close();
    expect(closed).toBe(2);
  });

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

  test("SIGINT wins over buffered partial input even when reader cancellation settles read", async () => {
    let interrupt: (() => void) | undefined;
    let settleRead:
      | ((result: { readonly done: boolean; readonly value?: Uint8Array }) => void)
      | undefined;
    let readCount = 0;
    const readLine = createBufferedAndroidReadLine({
      read: async () => {
        readCount += 1;
        if (readCount === 1) {
          return { done: false, value: new TextEncoder().encode("first\n1") };
        }
        return await new Promise((resolve) => {
          settleRead = resolve;
        });
      },
      cancel: async () => settleRead?.({ done: true }),
      onInterrupt(handler) {
        interrupt = handler;
        return () => {
          interrupt = undefined;
        };
      },
    });

    await expect(readLine()).resolves.toBe("first");
    const pending = readLine();
    interrupt?.();

    await expect(pending).resolves.toEqual({ kind: "cancelled" });
  });

  test("returns an EOF partial line once, then returns null", async () => {
    const readLine = createBufferedAndroidReadLine({
      read: async () => ({ done: true }),
      cancel: async () => {},
      onInterrupt: () => () => {},
    });
    const decoderInput = createBufferedAndroidReadLine({
      read: (() => {
        const results = [
          { done: false, value: new TextEncoder().encode("invalid") },
          { done: true },
          { done: true },
        ];
        return async () => results.shift() ?? { done: true };
      })(),
      cancel: async () => {},
      onInterrupt: () => () => {},
    });

    await expect(decoderInput()).resolves.toBe("invalid");
    await expect(decoderInput()).resolves.toBeNull();
    await expect(readLine()).resolves.toBeNull();
  });

  test("accepts either a choice number or exact value", async () => {
    for (const answer of ["1", "continue"]) {
      const output: string[] = [];
      const port = createNodeTerminalPort({
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
    const port = createNodeTerminalPort({
      write: async () => {},
      readLine: async () => answers.shift() ?? null,
    });
    await expect(
      port.choose({ prompt: "Continue?", choices: [{ value: "continue", label: "Run" }] }),
    ).resolves.toEqual({ kind: "cancelled" });

    for (const answer of [null, { kind: "cancelled" } as const]) {
      const cancelled = createNodeTerminalPort({
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
