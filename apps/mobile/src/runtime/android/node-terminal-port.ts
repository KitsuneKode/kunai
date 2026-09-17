import { Readable } from "node:stream";

import type { MobileTerminalPort } from "../../application/contracts";
import {
  formatMobileChoiceOptions,
  interpretMobileChoiceAnswer,
  MOBILE_INVALID_SELECTION,
} from "../../application/mobile-choice";

export type AndroidReadLineResult = string | null | { readonly kind: "cancelled" };

export type NodeTerminalRuntime = {
  readonly write: (value: string) => Promise<void>;
  readonly readLine: () => Promise<AndroidReadLineResult>;
  readonly close: () => Promise<void>;
};

export type AndroidLineInputRuntime = {
  readonly read: () => Promise<{
    readonly done: boolean;
    readonly value?: Uint8Array;
  }>;
  readonly cancel: () => Promise<void>;
  readonly onInterrupt: (handler: () => void) => () => void;
};

export function createBufferedAndroidReadLine(
  runtime: AndroidLineInputRuntime,
): () => Promise<AndroidReadLineResult> {
  const decoder = new TextDecoder();
  let buffered = "";

  return async () => {
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline).replace(/\r$/u, "");
        buffered = buffered.slice(newline + 1);
        return line;
      }

      let interrupt: (() => void) | undefined;
      const interrupted = new Promise<{ readonly kind: "cancelled" }>((resolve) => {
        interrupt = () => {
          resolve({ kind: "cancelled" });
          void runtime.cancel().catch(() => {
            // Cancellation already owns the result; a closed reader needs no recovery.
          });
        };
      });
      const removeInterrupt = runtime.onInterrupt(() => interrupt?.());
      try {
        const result = await Promise.race([runtime.read(), interrupted]);
        if ("kind" in result) return result;
        if (result.done || result.value === undefined) {
          const line = buffered;
          buffered = "";
          return line.length > 0 ? line : null;
        }
        buffered += decoder.decode(result.value, { stream: true });
      } finally {
        removeInterrupt();
      }
    }
  };
}

function createLazyStdin(): Pick<NodeTerminalRuntime, "readLine" | "close"> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let readLine: (() => Promise<AndroidReadLineResult>) | undefined;

  function open(): () => Promise<AndroidReadLineResult> {
    if (readLine) return readLine;
    const activeReader = (
      Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>
    ).getReader();
    reader = activeReader;
    readLine = createBufferedAndroidReadLine({
      read: async () => await activeReader.read(),
      cancel: async () => await activeReader.cancel(),
      onInterrupt(handler) {
        process.once("SIGINT", handler);
        return () => process.off("SIGINT", handler);
      },
    });
    return readLine;
  }

  return {
    readLine: async () => await open()(),
    close: async () => {
      if (!reader) return;
      try {
        await reader.cancel();
      } catch {
        // An already-closed reader is the desired terminal teardown state.
      }
    },
  };
}

export function createNodeTerminalPort(
  overrides: Partial<NodeTerminalRuntime> = {},
): MobileTerminalPort {
  const stdin = createLazyStdin();
  const runtime: NodeTerminalRuntime = {
    write:
      overrides.write ??
      (async (value) => {
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(value, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }),
    readLine: overrides.readLine ?? stdin.readLine,
    close: overrides.close ?? stdin.close,
  };

  return {
    close: runtime.close,
    async render(lines) {
      await runtime.write(`${lines.join("\n")}\n`);
    },
    async choose(input) {
      await runtime.write(formatMobileChoiceOptions(input));
      while (true) {
        const pendingAnswer = runtime.readLine();
        await runtime.write(`${input.prompt} `);
        const answer = await pendingAnswer;
        const decision = interpretMobileChoiceAnswer(
          input,
          typeof answer === "string" ? answer : undefined,
        );
        if (decision.kind !== "invalid") return decision;
        await runtime.write(MOBILE_INVALID_SELECTION);
      }
    },
  };
}
