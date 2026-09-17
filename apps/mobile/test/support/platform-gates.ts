import { describe } from "bun:test";

export function isPosixHost(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

export const describePosixOnly = isPosixHost(process.platform) ? describe : describe.skip;
