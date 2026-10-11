export interface AShellJsc {
  readFile(path: string): string;
  writeFile(path: string, content: string): number;
  isFile(path: string): boolean;
  makeFolder(path: string): number;
  delete(path: string): number;
  move(from: string, to: string): number;
  system(command: string): number | string;
}

declare global {
  var jsc: AShellJsc | undefined;
}

const REQUIRED_METHODS = [
  "readFile",
  "writeFile",
  "isFile",
  "makeFolder",
  "delete",
  "move",
  "system",
] as const;

export function requireAShellJsc<T>(value?: T): AShellJsc {
  const host = value ?? globalThis.jsc;
  if (!(host instanceof Object)) {
    throw new Error("a-Shell jsc host is unavailable");
  }
  // SAFETY: candidate is the injected host global; each method is probed
  // before the AShellJsc view is returned.
  const candidate = host as Partial<AShellJsc>;
  // `typeof`, not `instanceof Function`: host functions can come from another
  // realm, where `instanceof` reports a complete host as incomplete.
  if (REQUIRED_METHODS.some((method) => typeof candidate[method] !== "function")) {
    throw new Error("a-Shell jsc host is incomplete");
  }
  // SAFETY: every method on AShellJsc was probed above; the shape assertion
  // only changes the static view of the checked object.
  return candidate as AShellJsc;
}
