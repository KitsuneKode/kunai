import type { MobileEnvironment } from "../../application/contracts";
import { createAShellCommandBridge } from "./ashell-command-bridge";
import { requireAShellJsc } from "./ashell-globals";
import { createAShellHttpPort } from "./ashell-http-port";
import { createAShellPlayerPort } from "./ashell-player-port";
import { createAShellStateStore } from "./ashell-state-store";
import { createAShellTerminalPort } from "./ashell-terminal-port";

declare const __KUNAI_MOBILE_VERSION__: string;

const MOBILE_ARGV_COUNT_PATH = ".runtime/argv-count";
const MOBILE_ARGV_PREFIX = ".runtime/argv-";
const MOBILE_ARGV_LIMIT = 32;

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

function removeStagedMobileArgv(
  jsc: ReturnType<typeof requireAShellJsc>,
  argumentCount: number,
): boolean {
  let removed = true;
  for (const path of [
    MOBILE_ARGV_COUNT_PATH,
    `${MOBILE_ARGV_COUNT_PATH}.tmp`,
    ...Array.from({ length: argumentCount }, (_, index) => `${MOBILE_ARGV_PREFIX}${index}`),
  ]) {
    try {
      if (jsc.isFile(path) && (jsc.deleteFile(path) !== 0 || jsc.isFile(path))) removed = false;
    } catch {
      removed = false;
    }
  }
  return removed;
}

export function mobileArgv(jscHost: unknown = globalThis.jsc): readonly string[] {
  const jsc = requireAShellJsc(jscHost);
  let argv: string[] | undefined;
  let cleanupCount = MOBILE_ARGV_LIMIT;
  try {
    if (!jsc.isFile(MOBILE_ARGV_COUNT_PATH)) throw new Error("missing count");
    const rawCount = jsc.readFile(MOBILE_ARGV_COUNT_PATH);
    if (!/^(?:0|[1-9][0-9]?)$/u.test(rawCount)) throw new Error("invalid count");
    const count = Number(rawCount);
    if (count > MOBILE_ARGV_LIMIT) throw new Error("excessive count");
    cleanupCount = count;
    argv = [];
    for (let index = 0; index < count; index += 1) {
      const path = `${MOBILE_ARGV_PREFIX}${index}`;
      if (!jsc.isFile(path)) throw new Error("missing argument");
      argv.push(jsc.readFile(path));
    }
  } catch {
    argv = undefined;
  }
  const removed = removeStagedMobileArgv(jsc, cleanupCount);
  if (!argv || !removed) throw new Error("a-Shell staged arguments are invalid");
  return argv;
}

export function mobileVersion(): string {
  return typeof __KUNAI_MOBILE_VERSION__ === "string" ? __KUNAI_MOBILE_VERSION__ : "0.0.0-dev";
}

export function exitMobile(code: number): void {
  const jsc = requireAShellJsc();
  const exitCode = code === 0 || code === 1 || code === 2 ? code : 1;
  const currentPath = ".runtime/exit-code";
  const temporaryPath = `${currentPath}.tmp`;
  if (jsc.makeFolder(".runtime") !== 0) throw new Error("Mobile host proof failed");
  if (jsc.isFile(temporaryPath) && jsc.deleteFile(temporaryPath) !== 0) {
    throw new Error("Mobile host proof failed");
  }
  if (
    jsc.isFile(currentPath) ||
    jsc.writeFile(temporaryPath, String(exitCode)) !== 0 ||
    !jsc.isFile(temporaryPath) ||
    jsc.readFile(temporaryPath) !== String(exitCode) ||
    jsc.move(temporaryPath, currentPath) !== 0
  ) {
    if (jsc.isFile(temporaryPath)) jsc.deleteFile(temporaryPath);
    throw new Error("Mobile host proof failed");
  }
}
