import type { EventEmitter } from "node:events";

import { storageRootEnv } from "../helpers/storage-env";

const exitBySignal = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const;

type Launcher = {
  launch: () => { exited: Promise<number>; kill: (signal: "SIGKILL") => void };
  stopTmux: () => Promise<void>;
  removeHome: () => void;
  readEvidence: () => Promise<void>;
};

export function posterSmokeWaylandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { WAYLAND_DISPLAY, XDG_RUNTIME_DIR } = env;
  return WAYLAND_DISPLAY && XDG_RUNTIME_DIR ? { WAYLAND_DISPLAY, XDG_RUNTIME_DIR } : {};
}

export function posterSmokeEnv(home: string, host = process.env): NodeJS.ProcessEnv {
  const env = { ...host };
  for (const key of Object.keys(env)) {
    if (key.startsWith("XDG_") || key === "APPDATA") delete env[key];
  }
  Object.assign(env, storageRootEnv(home));
  delete env.CI;
  delete env.CONTINUOUS_INTEGRATION;
  delete env.NO_COLOR;
  return env;
}

export function posterSmokeBunCommand(script: string, ...args: string[]): string[] {
  return [process.execPath, "--no-env-file", script, ...args];
}

export function posterSmokeOption(args: string[], flag: string): string | undefined {
  const offset = args.indexOf(flag);
  if (offset < 0) return;
  const value = args[offset + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export async function finishPosterSmoke(
  releaseTerminal: () => Promise<void>,
  writeEvidence: () => Promise<void>,
  removeProfile: () => void,
): Promise<void> {
  try {
    await releaseTerminal();
    await writeEvidence();
  } finally {
    removeProfile();
  }
}

export async function stopPosterSmokeTmux(
  socket: string,
  killServer = async () => {
    const child = Bun.spawn(["tmux", "-S", socket, "kill-server"], {
      env: { ...process.env, LC_ALL: "C" },
      stdout: "ignore",
      stderr: "pipe",
      timeout: 5_000,
    });
    const [code, stderr] = await Promise.all([child.exited, child.stderr.text()]);
    return { code, stderr };
  },
): Promise<void> {
  const { code, stderr } = await killServer();
  if (code === 0) return;
  const message = stderr.trim();
  if (
    code === 1 &&
    [
      `no server running on ${socket}`,
      `error connecting to ${socket} (No such file or directory)`,
    ].includes(message)
  )
    return;
  throw new Error(`tmux shutdown not confirmed at ${socket} (${code}): ${message}`);
}

export async function withPosterSmokeSignals(
  signals: Pick<EventEmitter, "on" | "off">,
  run: (signal: AbortSignal) => Promise<void>,
): Promise<number> {
  const controller = new AbortController();
  let exitCode = 0;
  const handlers = exitBySignal.map(([signal, code]) => {
    const interrupt = () => {
      if (controller.signal.aborted) return;
      exitCode = code;
      controller.abort(new Error(`poster smoke interrupted by ${signal}`));
    };
    signals.on(signal, interrupt);
    return { signal, interrupt };
  });
  try {
    await run(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted || error !== controller.signal.reason) throw error;
  } finally {
    for (const { signal, interrupt } of handlers) signals.off(signal, interrupt);
  }
  return exitCode;
}

export function runPosterSmokeTerminal(
  signals: Pick<EventEmitter, "on" | "off">,
  launcher: Launcher,
): Promise<number> {
  return withPosterSmokeSignals(signals, async (signal) => {
    let terminal: ReturnType<Launcher["launch"]> | undefined;
    const terminate = () => terminal?.kill("SIGKILL");
    signal.addEventListener("abort", terminate, { once: true });
    try {
      terminal = launcher.launch();
      const code = await terminal.exited;
      signal.throwIfAborted();
      if (code !== 0) throw new Error(`terminal exited with code ${code}`);
      await launcher.readEvidence();
    } finally {
      signal.removeEventListener("abort", terminate);
      // A live server still needs its socket if the shutdown command failed.
      await launcher.stopTmux();
      launcher.removeHome();
    }
  });
}
