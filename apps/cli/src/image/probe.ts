import { debugImage } from "./debug";

/**
 * What the terminal said it can do, rather than what its name suggests.
 *
 * Environment variables cannot express "this build supports sixel", so
 * name-based detection has to guess, and it guessed conservatively: Windows
 * Terminal gained sixel in 1.22 but nothing in the environment reports a
 * version, so every Windows Terminal user was given the half-block fallback.
 * Asking the terminal directly is what chafa, timg, and yazi all do.
 */
export type TerminalGraphicsSupport = {
  readonly sixel: boolean;
  readonly kittyGraphics: boolean;
};

/** Primary Device Attributes. A conforming terminal replies `ESC [ ? … c`. */
const DA1_QUERY = "[c";

/**
 * Kitty graphics support query. Sent *before* DA1 so the DA1 reply acts as a
 * terminator: a terminal that ignores this one still answers DA1, so the probe
 * always ends on a real reply rather than on the timeout.
 */
const KITTY_QUERY = "_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\\";

/**
 * Attribute `4` in a DA1 reply means sixel. The reply is
 * `ESC [ ? <ps> ; <ps> ; … c`, so match the parameter list and look for an
 * exact `4` — a substring test would also match `14` or `40`.
 */
export function parseDeviceAttributes(reply: string): TerminalGraphicsSupport {
  const da1 = /\[\?([0-9;]*)c/.exec(reply);
  const sixel = da1?.[1] ? da1[1].split(";").includes("4") : false;

  // Kitty answers `ESC _ G i=31;OK ESC \`. Any `;OK` response to our id counts;
  // an error response (`;EBADF` and friends) means the protocol is understood
  // but the payload was rejected, which still proves support.
  const kittyGraphics = /_G[^]*;(OK|E[A-Z]+)/.test(reply);

  return { sixel, kittyGraphics };
}

/** True when it is safe to write escape bytes and read a reply. */
export function canProbeTerminal(
  env: NodeJS.ProcessEnv = process.env,
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout,
): boolean {
  // Writing a query to a non-TTY dumps escape bytes into the user's pipe.
  if (!stdin.isTTY || !stdout.isTTY) return false;
  if (env.KUNAI_IMAGE_PROBE && ["0", "false"].includes(env.KUNAI_IMAGE_PROBE.toLowerCase())) {
    return false;
  }
  // CI never has a terminal worth asking, and `dumb` cannot answer.
  if (env.CI) return false;
  if (!env.TERM || env.TERM === "dumb") return false;
  return true;
}

let probed: TerminalGraphicsSupport | null = null;

export function getProbedGraphicsSupport(): TerminalGraphicsSupport | null {
  return probed;
}

/**
 * Ask the terminal what it supports, once, before the Ink tree mounts.
 *
 * Never throws and never leaves the terminal in raw mode: a probe that broke
 * stdin would be far worse than a missing poster. Resolves null when the
 * terminal does not answer within the deadline, which leaves the existing
 * name-based detection in charge.
 */
export async function probeTerminalGraphics(
  options: {
    readonly timeoutMs?: number;
    readonly stdin?: NodeJS.ReadStream;
    readonly stdout?: NodeJS.WriteStream;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<TerminalGraphicsSupport | null> {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  if (probed) return probed;
  if (!canProbeTerminal(env, stdin, stdout)) return null;

  const wasRaw = stdin.isRaw === true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onData: ((chunk: Buffer | string) => void) | undefined;

  try {
    return await new Promise<TerminalGraphicsSupport | null>((resolve) => {
      let buffer = "";
      const finish = (value: TerminalGraphicsSupport | null): void => {
        if (timer) clearTimeout(timer);
        if (onData) stdin.off("data", onData);
        resolve(value);
      };

      onData = (chunk) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("latin1");
        // The DA1 reply terminates the exchange; replies can arrive split
        // across reads, so only settle once the terminator is present.
        if (/\[\?[0-9;]*c/.test(buffer)) {
          finish(parseDeviceAttributes(buffer));
        }
      };

      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.on("data", onData);

      // A terminal that answers nothing must cost this once, not block startup.
      timer = setTimeout(() => finish(null), options.timeoutMs ?? 100);
      stdout.write(KITTY_QUERY + DA1_QUERY);
    });
  } catch (error) {
    debugImage(`Terminal graphics probe failed: ${String(error)}`);
    return null;
  } finally {
    // Unconditional: a thrown probe must never strand the terminal in raw mode.
    if (!wasRaw) stdin.setRawMode?.(false);
    stdin.pause();
  }
}

/** Run the probe once and remember it for `detectImageCapability`. */
export async function initTerminalGraphicsProbe(options?: {
  readonly timeoutMs?: number;
}): Promise<TerminalGraphicsSupport | null> {
  const result = await probeTerminalGraphics(options ?? {});
  if (result) {
    probed = result;
    debugImage(`Terminal graphics probe: sixel=${result.sixel} kitty=${result.kittyGraphics}`);
  }
  return result;
}

export const __testing = {
  reset: (): void => {
    probed = null;
  },
  setProbed: (value: TerminalGraphicsSupport | null): void => {
    probed = value;
  },
};
