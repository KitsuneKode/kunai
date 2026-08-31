export interface AShellJsc {
  readFile(path: string): string;
  writeFile(path: string, content: string): number;
  isFile(path: string): boolean;
  makeFolder(path: string): number;
  deleteFile(path: string): number;
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
  "deleteFile",
  "move",
  "system",
] as const;

export function requireAShellJsc(value: unknown = globalThis.jsc): AShellJsc {
  if (value === null || typeof value !== "object") {
    throw new Error("a-Shell jsc host is unavailable");
  }
  const candidate = value as Record<string, unknown>;
  if (REQUIRED_METHODS.some((method) => typeof candidate[method] !== "function")) {
    throw new Error("a-Shell jsc host is incomplete");
  }
  return value as AShellJsc;
}
