import type { MobileTerminalPort } from "../../application/contracts";

export type AndroidReadLineResult = string | null | { readonly kind: "cancelled" };

export type BunTerminalRuntime = {
  readonly write: (value: string) => Promise<void>;
  readonly readLine: () => Promise<AndroidReadLineResult>;
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
          void runtime.cancel().then(
            () => resolve({ kind: "cancelled" }),
            () => resolve({ kind: "cancelled" }),
          );
        };
      });
      const removeInterrupt = runtime.onInterrupt(() => interrupt?.());
      try {
        const result = await Promise.race([runtime.read(), interrupted]);
        if ("kind" in result) return result;
        if (result.done || result.value === undefined) {
          return buffered.length > 0 ? buffered : null;
        }
        buffered += decoder.decode(result.value, { stream: true });
      } finally {
        removeInterrupt();
      }
    }
  };
}

function createDefaultReadLine(): () => Promise<AndroidReadLineResult> {
  const reader = Bun.stdin.stream().getReader();
  return createBufferedAndroidReadLine({
    read: async () => await reader.read(),
    cancel: async () => await reader.cancel(),
    onInterrupt(handler) {
      process.once("SIGINT", handler);
      return () => process.off("SIGINT", handler);
    },
  });
}

export function createBunTerminalPort(
  overrides: Partial<BunTerminalRuntime> = {},
): MobileTerminalPort {
  const runtime: BunTerminalRuntime = {
    write:
      overrides.write ??
      (async (value) => {
        await Bun.write(Bun.stdout, value);
      }),
    readLine: overrides.readLine ?? createDefaultReadLine(),
  };

  return {
    async render(lines) {
      await runtime.write(`${lines.join("\n")}\n`);
    },
    async choose(input) {
      await runtime.write(
        `${input.choices.map((choice, index) => `${index + 1}. ${choice.label}`).join("\n")}\n0. Cancel\n`,
      );
      while (true) {
        await runtime.write(`${input.prompt} `);
        const answer = await runtime.readLine();
        if (answer === null || typeof answer !== "string" || answer === "0") {
          return { kind: "cancelled" };
        }
        const numeric = Number(answer);
        const numericChoice = Number.isInteger(numeric) ? input.choices[numeric - 1] : undefined;
        const choice =
          numericChoice ?? input.choices.find((candidate) => candidate.value === answer);
        if (choice) return { kind: "selected", value: choice.value };
        await runtime.write("Invalid selection. Try again.\n");
      }
    },
  };
}
