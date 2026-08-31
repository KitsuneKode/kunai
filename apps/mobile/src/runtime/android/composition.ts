import { join } from "node:path";

import type { MobileEnvironment } from "../../application/contracts";
import { createAndroidPlayerPort } from "./android-player-port";
import { createBunHttpPort } from "./bun-http-port";
import { createBunStateStore } from "./bun-state-store";
import { createBunTerminalPort } from "./bun-terminal-port";

declare const __KUNAI_MOBILE_VERSION__: string;

export function resolveAndroidStateRoot(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const home = environment.HOME;
  if (!home) throw new Error("HOME is required for mobile state");
  return join(home, ".local", "share", "kunai-mobile");
}

export function createMobileEnvironment(): MobileEnvironment {
  return {
    http: createBunHttpPort(),
    state: createBunStateStore({ root: resolveAndroidStateRoot(process.env) }),
    terminal: createBunTerminalPort(),
    player: createAndroidPlayerPort(),
  };
}

export function mobileArgv(): readonly string[] {
  return process.argv.slice(2);
}

export function mobileVersion(): string {
  return typeof __KUNAI_MOBILE_VERSION__ === "string" ? __KUNAI_MOBILE_VERSION__ : "0.0.0-dev";
}

export function exitMobile(code: number): void {
  process.exitCode = code;
}
