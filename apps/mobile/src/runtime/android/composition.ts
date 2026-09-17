import { join } from "node:path";

import type { MobileEnvironment } from "../../application/contracts";
import { createAndroidPlayerPort } from "./android-player-port";
import { createNodeHttpPort } from "./node-http-port";
import { acquireNodeSession } from "./node-session";
import { createNodeStateStore } from "./node-state-store";
import { createNodeTerminalPort } from "./node-terminal-port";

declare const __KUNAI_MOBILE_VERSION__: string;

export function resolveAndroidStateRoot(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const home = environment.HOME;
  if (!home) throw new Error("HOME is required for mobile state");
  return join(home, ".local", "share", "kunai-mobile");
}

export function createMobileEnvironment(): MobileEnvironment {
  const root = resolveAndroidStateRoot(process.env);
  const state = createNodeStateStore({ root });
  const terminal = createNodeTerminalPort();
  let release: (() => void) | undefined;
  return {
    http: createNodeHttpPort(),
    state: {
      async load() {
        release ??= acquireNodeSession(root);
        return state.load();
      },
      async commit(next) {
        if (!release) throw new Error("Mobile session is not owned");
        await state.commit(next);
      },
    },
    terminal: {
      render: terminal.render,
      choose: terminal.choose,
      async close() {
        try {
          await terminal.close();
        } finally {
          release?.();
        }
      },
    },
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
