import type { MobileEnvironment } from "../../application/contracts";
import { createAShellCommandBridge } from "./ashell-command-bridge";
import { requireAShellJsc } from "./ashell-globals";
import { createAShellHttpPort } from "./ashell-http-port";
import { createAShellPlayerPort } from "./ashell-player-port";
import { createAShellStateStore } from "./ashell-state-store";
import { createAShellTerminalPort } from "./ashell-terminal-port";

declare const __KUNAI_MOBILE_VERSION__: string;

export function createMobileEnvironment(jscHost: unknown = globalThis.jsc): MobileEnvironment {
  const jsc = requireAShellJsc(jscHost);
  const bridge = createAShellCommandBridge(jsc);
  return {
    http: createAShellHttpPort({ jsc, bridge }),
    state: createAShellStateStore(jsc),
    terminal: createAShellTerminalPort({ jsc, bridge }),
    player: createAShellPlayerPort({ jsc, bridge }),
  };
}

export function mobileArgv(processHost: unknown = (globalThis as { process?: unknown }).process) {
  if (processHost === null || typeof processHost !== "object") {
    throw new Error("a-Shell process argv is unavailable");
  }
  const argv = (processHost as { argv?: unknown }).argv;
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) {
    throw new Error("a-Shell process argv is invalid");
  }
  return (argv as string[]).slice(2);
}

export function mobileVersion(): string {
  return typeof __KUNAI_MOBILE_VERSION__ === "string" ? __KUNAI_MOBILE_VERSION__ : "0.0.0-dev";
}

export function exitMobile(code: number): void {
  if (code !== 0) throw new Error("Mobile host proof failed");
}
