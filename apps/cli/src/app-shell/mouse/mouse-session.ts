import { detectImageCapability } from "@/image";
import {
  CELL_PIXEL_SIZE_QUERIES,
  cellPixelsFromReport,
  setTerminalCellPixels,
} from "@/image/cell-size";
import { canProbeTerminal } from "@/image/probe";

import { MouseSplitStdin } from "./mouse-stdin";
import { MouseDispatcher } from "./MouseRegions";

/** Only graphics renderers need a pixel box. */
export function shouldMeasurePosterCells(): boolean {
  if (!canProbeTerminal()) return false;
  const { renderer } = detectImageCapability();
  return (
    renderer === "kitty-native" ||
    renderer === "kitty-direct" ||
    renderer === "sixel" ||
    renderer === "iterm-inline"
  );
}

/** Own the TTY subscription and exit hook together; disposing either releases both. */
export function startMouseSession(options: {
  readonly stdin: ConstructorParameters<typeof MouseSplitStdin>[0];
  readonly stdout: {
    readonly isTTY?: boolean;
    readonly columns?: number;
    readonly rows?: number;
    write(data: string): void;
  };
  readonly host: {
    once(event: "exit", listener: () => void): void;
    on(event: "SIGWINCH", listener: () => void): void;
    removeListener(event: "exit" | "SIGWINCH", listener: () => void): void;
  };
  readonly disabled: boolean;
  readonly term: string | undefined;
  readonly measureCells?: boolean;
}) {
  if (
    !options.stdin.isTTY ||
    !options.stdout.isTTY ||
    (options.disabled && !options.measureCells) ||
    options.term === "dumb"
  ) {
    return null;
  }
  const tracking = !options.disabled;
  let raw = false;
  let directReport = false;
  let columns = 0;
  let rows = 0;
  let disposed = false;
  const query = () => {
    if (!raw || disposed || !options.measureCells) return;
    directReport = false;
    columns = options.stdout.columns ?? 0;
    rows = options.stdout.rows ?? 0;
    try {
      options.stdout.write(CELL_PIXEL_SIZE_QUERIES);
    } catch {
      // The geometry estimate remains available if the terminal is closing.
    }
  };
  // Read the grid after stdout has refreshed its dimensions for this signal.
  const onResize = () => queueMicrotask(query);
  const dispatcher = new MouseDispatcher();
  const stdin = new MouseSplitStdin(options.stdin, tracking ? dispatcher : null, {
    write: (data) => {
      options.stdout.write(data);
    },
    onRawMode(mode) {
      if (mode === raw) return;
      raw = mode;
      query();
    },
    onCellPixels(report) {
      if (!options.measureCells || !raw) return;
      const isDirect = report[2] === "6";
      if (!isDirect && directReport) return;
      const size = cellPixelsFromReport(report, columns, rows);
      if (!size) return;
      if (isDirect) directReport = true;
      setTerminalCellPixels(size);
    },
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.host.removeListener("exit", dispose);
    if (options.measureCells) {
      options.host.removeListener("SIGWINCH", onResize);
      setTerminalCellPixels(null);
    }
    try {
      stdin.detach();
    } finally {
      dispatcher.clear();
    }
  };
  dispatcher.pressKey = (keys) => stdin.inject(keys);
  stdin.attach();
  options.host.once("exit", dispose);
  if (options.measureCells) options.host.on("SIGWINCH", onResize);
  try {
    if (tracking) stdin.enableTracking();
  } catch (error) {
    dispose();
    throw error;
  }
  return { stdin, dispatcher, dispose, tracking };
}
