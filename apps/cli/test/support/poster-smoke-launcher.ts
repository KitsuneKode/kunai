import type { EventEmitter } from "node:events";

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

export async function runPosterSmokeTerminal(
  signals: Pick<EventEmitter, "on" | "off">,
  launcher: Launcher,
): Promise<number> {
  const interrupted = Promise.withResolvers<void>();
  let exitCode = 0;
  const handlers = exitBySignal.map(([signal, code]) => {
    const interrupt = () => {
      exitCode ||= code;
      interrupted.resolve();
    };
    signals.on(signal, interrupt);
    return { signal, interrupt };
  });
  let terminal: ReturnType<Launcher["launch"]> | undefined;
  let terminalExited = false;
  async function run(): Promise<void> {
    terminal = launcher.launch();
    const code = await terminal.exited;
    terminalExited = true;
    if (exitCode) return;
    if (code !== 0) throw new Error(`terminal exited with code ${code}`);
    await launcher.readEvidence();
  }
  try {
    await Promise.race([run(), interrupted.promise]);
  } finally {
    try {
      if (terminal && !terminalExited) {
        terminal.kill("SIGKILL");
        await terminal.exited;
      }
    } finally {
      try {
        await launcher.stopTmux();
      } finally {
        for (const { signal, interrupt } of handlers) signals.off(signal, interrupt);
        launcher.removeHome();
      }
    }
  }
  return exitCode;
}
