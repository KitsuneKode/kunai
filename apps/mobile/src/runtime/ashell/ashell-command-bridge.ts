import type { AShellJsc } from "./ashell-globals";

const HELPER_COMMANDS = {
  "read-line": "./kunai-mobile-read-line",
  http: "./kunai-mobile-http",
  "open-vlc": "./kunai-mobile-open-vlc",
} as const;

export type AShellHelperName = keyof typeof HELPER_COMMANDS;

export interface AShellCommandBridge {
  runFixedHelper(name: AShellHelperName): number;
}

export function createAShellCommandBridge(jsc: AShellJsc): AShellCommandBridge {
  return {
    runFixedHelper(name) {
      const command = HELPER_COMMANDS[name];
      if (command === undefined) throw new Error("Unsupported helper");
      const status = jsc.system(command);
      if (typeof status === "number" && Number.isSafeInteger(status)) return status;
      if (typeof status === "string" && /^-?\d+$/u.test(status)) {
        const numericStatus = Number(status);
        if (Number.isSafeInteger(numericStatus)) return numericStatus;
      }
      throw new Error("Invalid helper status");
    },
  };
}
