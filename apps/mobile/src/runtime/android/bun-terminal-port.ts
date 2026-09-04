import type { MobileTerminalPort } from "../../application/contracts";
import {
  formatMobileChoiceOptions,
  interpretMobileChoiceAnswer,
  MOBILE_INVALID_SELECTION,
} from "../../application/mobile-choice";

export type AndroidReadLineResult = string | null | { readonly kind: "cancelled" };

export type BunTerminalRuntime = {
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

/**
 * Opens stdin on first use and never before. `--help`, `--version` and a
 * rejected argument list never read a line, and an stdin reader opened for them
 * is a handle nothing ever closes.
 */
function createLazyStdinReadLine(): Pick<BunTerminalRuntime, "readLine" | "close"> {
  let opened:
    | {
        readonly readLine: () => Promise<AndroidReadLineResult>;
        readonly reader: ReadableStreamDefaultReader<Uint8Array>;
      }
    | undefined;

  function open(): NonNullable<typeof opened> {
    if (opened) return opened;
    const reader = Bun.stdin.stream().getReader();
    opened = {
      reader,
      readLine: createBufferedAndroidReadLine({
        read: async () => await reader.read(),
        cancel: async () => await reader.cancel(),
        onInterrupt(handler) {
          process.once("SIGINT", handler);
          return () => process.off("SIGINT", handler);
        },
      }),
    };
    return opened;
  }

  return {
    readLine: () => open().readLine(),
    close: async () => {
      if (!opened) return;
      try {
        await opened.reader.cancel();
      } catch {
        // An already-cancelled reader is the state close() wants; the host is
        // free to exit either way.
      }
    },
  };
}

export function createBunTerminalPort(
  overrides: Partial<BunTerminalRuntime> = {},
): MobileTerminalPort {
  const stdin = createLazyStdinReadLine();
  const runtime: BunTerminalRuntime = {
    write:
      overrides.write ??
      (async (value) => {
        await Bun.write(Bun.stdout, value);
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
        await runtime.write(`${input.prompt} `);
        const answer = await runtime.readLine();
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
