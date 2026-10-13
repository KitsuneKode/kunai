import { MouseSplitStdin } from "./mouse-stdin";
import { MouseDispatcher } from "./MouseRegions";

/** Own the TTY subscription and exit hook together; disposing either releases both. */
export function startMouseSession(options: {
  readonly stdin: ConstructorParameters<typeof MouseSplitStdin>[0];
  readonly stdout: { readonly isTTY?: boolean; write(data: string): void };
  readonly host: {
    once(event: "exit", listener: () => void): void;
    removeListener(event: "exit", listener: () => void): void;
  };
  readonly disabled: boolean;
  readonly term: string | undefined;
}) {
  if (
    !options.stdin.isTTY ||
    !options.stdout.isTTY ||
    options.disabled ||
    options.term === "dumb"
  ) {
    return null;
  }
  const dispatcher = new MouseDispatcher();
  const stdin = new MouseSplitStdin(options.stdin, dispatcher, {
    write: (data) => {
      options.stdout.write(data);
    },
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.host.removeListener("exit", dispose);
    try {
      stdin.detach();
    } finally {
      dispatcher.clear();
    }
  };
  stdin.attach();
  options.host.once("exit", dispose);
  try {
    stdin.enableTracking();
  } catch (error) {
    dispose();
    throw error;
  }
  return { stdin, dispatcher, dispose };
}
